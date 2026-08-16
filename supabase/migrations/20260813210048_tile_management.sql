-- Migration 010 — Tile management: org-level tree, per-office
-- availability, paired delivery codes, and add-ons. DDL only.

alter table public.chart_categories
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.chart_categories c
set organization_id = o.organization_id
from public.offices o
where o.id = c.office_id
  and c.organization_id is null;

do $$
declare
  orphaned int;
begin
  select count(*) into orphaned
  from public.chart_categories
  where organization_id is null;

  if orphaned > 0 then
    raise exception
      'Migration 010 aborted: % chart_categories rows could not be matched to an organization.',
      orphaned;
  end if;
end $$;

alter table public.chart_categories
  alter column organization_id set not null;

drop policy if exists chart_categories_select on public.chart_categories;
drop policy if exists chart_categories_insert on public.chart_categories;
drop policy if exists chart_categories_update on public.chart_categories;
drop policy if exists chart_categories_delete on public.chart_categories;

drop policy if exists chart_tiles_select on public.chart_tiles;
drop policy if exists chart_tiles_insert on public.chart_tiles;
drop policy if exists chart_tiles_update on public.chart_tiles;
drop policy if exists chart_tiles_delete on public.chart_tiles;

alter table public.chart_categories
  drop column if exists office_id;

create unique index if not exists chart_categories_org_bucket_label_key
  on public.chart_categories (organization_id, bucket, label);

create index if not exists chart_categories_org_idx
  on public.chart_categories (organization_id, bucket, sort_order);

alter table public.chart_tiles
  add column if not exists treat_area smallint,
  add column if not exists delivery_code text,
  add column if not exists delivery_posts_at_zero boolean not null default true,
  add column if not exists notes text;

alter table public.chart_tiles
  add constraint chart_tiles_treat_area_check
  check (treat_area is null or treat_area between 0 and 7)
  not valid;

alter table public.chart_tiles
  validate constraint chart_tiles_treat_area_check;

alter table public.chart_tiles
  add constraint chart_tiles_delivery_needs_procedure_check
  check (delivery_code is null or entry_kind = 'procedure')
  not valid;

alter table public.chart_tiles
  validate constraint chart_tiles_delivery_needs_procedure_check;

create index if not exists chart_tiles_category_idx
  on public.chart_tiles (category_id, sort_order);

create table if not exists public.chart_tile_offices (
  tile_id    uuid not null references public.chart_tiles(id) on delete cascade,
  office_id  uuid not null references public.offices(id)     on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tile_id, office_id)
);

create index if not exists chart_tile_offices_office_idx
  on public.chart_tile_offices (office_id);

create table if not exists public.chart_tile_addons (
  id            uuid primary key default gen_random_uuid(),
  tile_id       uuid not null references public.chart_tiles(id) on delete cascade,
  label         text not null,
  proc_code     text not null,
  is_default_on boolean not null default true,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists chart_tile_addons_tile_code_key
  on public.chart_tile_addons (tile_id, proc_code);

create index if not exists chart_tile_addons_tile_idx
  on public.chart_tile_addons (tile_id, sort_order);

drop trigger if exists chart_tile_addons_touch on public.chart_tile_addons;
create trigger chart_tile_addons_touch
  before update on public.chart_tile_addons
  for each row execute function public.touch_updated_at();

alter table public.chart_tile_offices enable row level security;
alter table public.chart_tile_addons  enable row level security;

create policy chart_categories_select on public.chart_categories
  for select using (organization_id in (select public.current_organization_ids()));

create policy chart_categories_insert on public.chart_categories
  for insert with check (public.is_org_admin(organization_id));

create policy chart_categories_update on public.chart_categories
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy chart_categories_delete on public.chart_categories
  for delete using (public.is_org_admin(organization_id));

create policy chart_tiles_select on public.chart_tiles
  for select using (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and c.organization_id in (select public.current_organization_ids())
    )
  );

create policy chart_tiles_insert on public.chart_tiles
  for insert with check (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and public.is_org_admin(c.organization_id)
    )
  );

create policy chart_tiles_update on public.chart_tiles
  for update using (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and public.is_org_admin(c.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and public.is_org_admin(c.organization_id)
    )
  );

create policy chart_tiles_delete on public.chart_tiles
  for delete using (
    exists (
      select 1 from public.chart_categories c
      where c.id = chart_tiles.category_id
        and public.is_org_admin(c.organization_id)
    )
  );

create policy chart_tile_offices_select on public.chart_tile_offices
  for select using (
    exists (
      select 1
      from public.chart_tiles t
      join public.chart_categories c on c.id = t.category_id
      where t.id = chart_tile_offices.tile_id
        and c.organization_id in (select public.current_organization_ids())
    )
  );

create policy chart_tile_offices_insert on public.chart_tile_offices
  for insert with check (
    exists (
      select 1
      from public.chart_tiles t
      join public.chart_categories c on c.id = t.category_id
      where t.id = chart_tile_offices.tile_id
        and public.is_org_admin(c.organization_id)
    )
    and exists (
      select 1
      from public.offices o
      join public.chart_tiles t on t.id = chart_tile_offices.tile_id
      join public.chart_categories c on c.id = t.category_id
      where o.id = chart_tile_offices.office_id
        and o.organization_id = c.organization_id
    )
  );

create policy chart_tile_offices_delete on public.chart_tile_offices
  for delete using (
    exists (
      select 1
      from public.chart_tiles t
      join public.chart_categories c on c.id = t.category_id
      where t.id = chart_tile_offices.tile_id
        and public.is_org_admin(c.organization_id)
    )
  );

create policy chart_tile_addons_select on public.chart_tile_addons
  for select using (
    exists (
      select 1
      from public.chart_tiles t
      join public.chart_categories c on c.id = t.category_id
      where t.id = chart_tile_addons.tile_id
        and c.organization_id in (select public.current_organization_ids())
    )
  );

create policy chart_tile_addons_insert on public.chart_tile_addons
  for insert with check (
    exists (
      select 1
      from public.chart_tiles t
      join public.chart_categories c on c.id = t.category_id
      where t.id = chart_tile_addons.tile_id
        and public.is_org_admin(c.organization_id)
    )
  );

create policy chart_tile_addons_update on public.chart_tile_addons
  for update using (
    exists (
      select 1
      from public.chart_tiles t
      join public.chart_categories c on c.id = t.category_id
      where t.id = chart_tile_addons.tile_id
        and public.is_org_admin(c.organization_id)
    )
  )
  with check (
    exists (
      select 1
      from public.chart_tiles t
      join public.chart_categories c on c.id = t.category_id
      where t.id = chart_tile_addons.tile_id
        and public.is_org_admin(c.organization_id)
    )
  );

create policy chart_tile_addons_delete on public.chart_tile_addons
  for delete using (
    exists (
      select 1
      from public.chart_tiles t
      join public.chart_categories c on c.id = t.category_id
      where t.id = chart_tile_addons.tile_id
        and public.is_org_admin(c.organization_id)
    )
  );

insert into public.chart_tile_offices (tile_id, office_id)
select t.id, o.id
from public.chart_tiles t
join public.chart_categories c on c.id = t.category_id
join public.offices o on o.organization_id = c.organization_id
where o.slug = 'downey'
on conflict do nothing;

comment on column public.chart_categories.organization_id is
  'The tile tree belongs to the organization. Per-office differences are expressed on the tile, not by duplicating the tree.';

comment on column public.chart_tiles.treat_area is
  'OpenDental procedurecode.TreatArea, carried through unchanged. Observed live at Greenwood: 0 mouth, 1 surface, 2 tooth, 3 mouth, 4 quadrant, 6 arch.';

comment on column public.chart_tiles.delivery_code is
  'The seat/delivery code of a two-visit procedure, e.g. D2751d beside D2751. Both lines are created at diagnosis. Null for single-visit tiles.';

comment on column public.chart_tiles.delivery_posts_at_zero is
  'Delivery lines post at zero fee. Splitting the base fee is parked: Denti-Cal runs as a flat-copay plan and uninsured patients carry no fee schedule, so no split rule is safe yet.';

comment on table public.chart_tile_offices is
  'Which offices offer a tile. A row per office; both rows means available everywhere.';

comment on table public.chart_tile_addons is
  'Extras that ride on a tile, arriving pre-checked or not per is_default_on. Each one still checked at commit posts as its own procedure line.';;
