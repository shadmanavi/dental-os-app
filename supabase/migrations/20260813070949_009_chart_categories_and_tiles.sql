-- =====================================================================
-- Migration 009 — chairside charting: categories and tiles
--
-- The charting screen is a drill-down: a grid of category tiles, each
-- opening a grid of procedure tiles. Both live here rather than in the
-- frontend so they can be edited from an admin screen later without a
-- code change.
--
-- Two facts from the OpenDental probe shape this schema:
--
--   1. An existing condition and a diagnosed treatment use the SAME
--      procedure code. Only ProcStatus differs — EC vs TP. So a tile does
--      not carry a status; the bucket it sits in supplies it.
--
--   2. A missing tooth is not a procedure at all. It is a row in
--      OpenDental's toothinitial table with InitialType 'Missing'. Tiles
--      therefore have an entry_kind, and only 'procedure' tiles carry a
--      code rule.
--
-- Nothing existing is modified.
-- =====================================================================

-- ---------------------------------------------------------------------
-- chart_categories
-- ---------------------------------------------------------------------
create table public.chart_categories (
  id            uuid primary key default gen_random_uuid(),
  office_id     uuid not null references public.offices (id) on delete cascade,

  -- 'existing'  -> commits at ProcStatus EC
  -- 'diagnosed' -> commits at ProcStatus TP
  bucket        text not null check (bucket in ('existing', 'diagnosed')),

  label         text not null check (length(trim(label)) > 0),
  sort_order    integer not null default 0,
  is_active     boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (office_id, bucket, label)
);

comment on table public.chart_categories is
  'Top-level tiles on the chairside charting screen, per office and bucket.';
comment on column public.chart_categories.bucket is
  'existing commits procedures at ProcStatus EC; diagnosed commits at TP.';

create index chart_categories_office_bucket_idx
  on public.chart_categories (office_id, bucket, sort_order)
  where is_active;

-- ---------------------------------------------------------------------
-- chart_tiles
-- ---------------------------------------------------------------------
create table public.chart_tiles (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references public.chart_categories (id) on delete cascade,

  label         text not null check (length(trim(label)) > 0),

  -- 'procedure'     -> POST /procedurelogs, code resolved from code_rule
  -- 'tooth_initial' -> POST /toothinitials, using initial_type
  entry_kind    text not null default 'procedure'
                  check (entry_kind in ('procedure', 'tooth_initial')),

  -- Only for entry_kind = 'tooth_initial'. Values observed live on
  -- patient 17: 'Missing' and 'Hidden'. The two are independent flags,
  -- not exclusive states — tooth 3 carried both.
  initial_type  text check (initial_type in ('Missing', 'Hidden')),

  -- Whether the surface picker opens before the tile commits. Set from
  -- procedure_codes_cache.treat_area = 'Surf' when seeding.
  needs_surfaces boolean not null default false,

  -- How the CDT code is chosen at commit time. Four shapes:
  --
  --   {"type":"fixed","code":"D2750"}
  --
  --   {"type":"surface_count","all":["D2140","D2150","D2160","D2161"]}
  --     index by surface count, 1..4+; used where one series covers both
  --     arches, as amalgam does
  --
  --   {"type":"surface_count",
  --    "anterior":["D2330","D2331","D2332","D2335"],
  --    "posterior":["D2391","D2392","D2393","D2394"]}
  --     anterior is teeth 6-11 and 22-27
  --
  --   {"type":"tooth_class","anterior":"D3310","bicuspid":"D3320",
  --    "molar":"D3330"}
  --
  -- Left null for tooth_initial tiles.
  code_rule     jsonb,

  sort_order    integer not null default 0,
  is_active     boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (category_id, label),

  -- A procedure tile needs a rule; a tooth_initial tile needs a type.
  constraint chart_tiles_rule_matches_kind check (
    (entry_kind = 'procedure'     and code_rule is not null and initial_type is null)
    or
    (entry_kind = 'tooth_initial' and initial_type is not null and code_rule is null)
  )
);

comment on table public.chart_tiles is
  'Individual buttons inside a chart category. Resolves to a CDT code, or to a toothinitial row.';
comment on column public.chart_tiles.code_rule is
  'How the CDT code is chosen at commit time. See migration 009 for the four shapes.';

create index chart_tiles_category_idx
  on public.chart_tiles (category_id, sort_order)
  where is_active;

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger chart_categories_touch
  before update on public.chart_categories
  for each row execute function public.touch_updated_at();

create trigger chart_tiles_touch
  before update on public.chart_tiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- RLS
--
-- Same shape as procedure_codes_cache: anyone with a role at the office
-- reads; only an office admin writes. chart_tiles has no office_id of its
-- own, so it defers to its category.
--
-- Note the lesson from the earlier FOR ALL policy leak: these are written
-- one command at a time, never as a single permissive FOR ALL.
-- ---------------------------------------------------------------------
alter table public.chart_categories enable row level security;
alter table public.chart_tiles      enable row level security;

create policy chart_categories_select on public.chart_categories
  for select using (has_office_access(office_id));

create policy chart_categories_insert on public.chart_categories
  for insert with check (is_office_admin(office_id));

create policy chart_categories_update on public.chart_categories
  for update using (is_office_admin(office_id))
              with check (is_office_admin(office_id));

create policy chart_categories_delete on public.chart_categories
  for delete using (is_office_admin(office_id));

create policy chart_tiles_select on public.chart_tiles
  for select using (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and has_office_access(c.office_id)
    )
  );

create policy chart_tiles_insert on public.chart_tiles
  for insert with check (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and is_office_admin(c.office_id)
    )
  );

create policy chart_tiles_update on public.chart_tiles
  for update using (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and is_office_admin(c.office_id)
    )
  ) with check (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and is_office_admin(c.office_id)
    )
  );

create policy chart_tiles_delete on public.chart_tiles
  for delete using (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and is_office_admin(c.office_id)
    )
  );;
