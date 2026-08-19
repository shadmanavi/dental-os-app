-- =====================================================================
-- Dental OS — Migration 010
-- Tile management: organization-level tree, per-office availability,
-- paired delivery codes, and add-ons.
--
-- DDL only. No tiles or categories are created here; migration 011
-- carries the seed, so the shape can be reviewed before data lands.
--
-- Why this migration exists
-- ------------------------------------------------------------------
-- 009 hung categories off office_id, which meant Downey and Maywood
-- each needed their own copy of the whole tree and every edit had to be
-- made twice. Greenwood does mostly the same dentistry at both sites;
-- what actually differs is which procedures a given office offers. So
-- the tree moves up to the organization and each tile carries the list
-- of offices it is available at.
--
-- Three things the live OpenDental data forced into the design:
--
--   1. Treatment area is a property of the code, and OpenDental already
--      knows it. procedurecode.TreatArea says whether a code needs a
--      surface, a tooth, a quadrant, an arch, or nothing. The six-month
--      survey showed all of 0, 1, 2, 3, 4 and 6 in live use at both
--      offices. needs_surfaces could only express one of those six, so
--      treat_area replaces it as the source of truth and needs_surfaces
--      becomes a derived convenience.
--
--   2. A crown is two procedures, not one. The survey found D2751d
--      (136 uses at Downey), D2750d and D2740d sitting alongside their
--      base codes: the prep is billed at the first visit and the
--      delivery at the seat. Both lines are created at diagnosis, so a
--      tile needs a delivery code as well as a base one.
--
--   3. Splitting the fee between those two lines is parked. It needs
--      OpenDental's price, and the fee lookup found Denti-Cal running
--      as a flat-copay plan and uninsured patients carrying no fee
--      schedule at all — neither of which divides cleanly. Until that
--      is settled, delivery lines post at zero. The column recording
--      that decision is here so the parked state is explicit rather
--      than implied by its absence.
--
-- Add-ons
-- ------------------------------------------------------------------
-- An add-on is not a procedure the clinician goes looking for; it is
-- something that arrives already attached. Selecting a PFM crown brings
-- porcelain margins with it, pre-checked. The negotiation with the
-- patient is subtraction: if they decline the cost, the clinician
-- unchecks it and it falls away. Some add-ons default on and some
-- default off, so the default is per add-on rather than a global rule.
-- Each surviving add-on posts as its own procedure line.
--
-- What breaks
-- ------------------------------------------------------------------
-- od-chart's open action filters chart_categories on office_id, which
-- does not exist after this runs. od-chart v4 must ship with it.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Categories move from office to organization
-- ---------------------------------------------------------------------

alter table public.chart_categories
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

-- Backfill through the office each category currently belongs to.
update public.chart_categories c
set organization_id = o.organization_id
from public.offices o
where o.id = c.office_id
  and c.organization_id is null;

-- A category with no organization after the backfill would be orphaned
-- by the drop below, so stop rather than lose it.
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

-- The policies below reference office_id, so they have to go before the
-- column can. They are recreated against the organization further down.
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

-- One tree per organization, so a bucket cannot carry the same category
-- name twice.
create unique index if not exists chart_categories_org_bucket_label_key
  on public.chart_categories (organization_id, bucket, label);

create index if not exists chart_categories_org_idx
  on public.chart_categories (organization_id, bucket, sort_order);

-- ---------------------------------------------------------------------
-- 2. Tiles gain treatment area, delivery codes, and a description
-- ---------------------------------------------------------------------

alter table public.chart_tiles
  -- OpenDental's procedurecode.TreatArea, carried through unchanged so
  -- the two systems cannot drift. Null means the tile has not been
  -- classified yet, which the management screen shows as a gap.
  add column if not exists treat_area smallint,

  -- The delivery half of a two-visit procedure. Null for everything
  -- else, so its presence is what makes a tile paired.
  add column if not exists delivery_code text,

  -- Parked decision, recorded rather than assumed. Delivery lines post
  -- at zero until the fee split is resolved.
  add column if not exists delivery_posts_at_zero boolean not null default true,

  -- Free text for the admin, not shown to the clinician.
  add column if not exists notes text;

alter table public.chart_tiles
  add constraint chart_tiles_treat_area_check
  check (treat_area is null or treat_area between 0 and 7)
  not valid;

alter table public.chart_tiles
  validate constraint chart_tiles_treat_area_check;

-- A delivery code only means something on a procedure tile.
alter table public.chart_tiles
  add constraint chart_tiles_delivery_needs_procedure_check
  check (delivery_code is null or entry_kind = 'procedure')
  not valid;

alter table public.chart_tiles
  validate constraint chart_tiles_delivery_needs_procedure_check;

create index if not exists chart_tiles_category_idx
  on public.chart_tiles (category_id, sort_order);

-- ---------------------------------------------------------------------
-- 3. Per-office availability
--
-- A row here means "this tile is offered at this office". A tile with
-- rows for both offices is available at both; the management screen
-- presents that as Downey / Maywood / Both.
--
-- Availability is a separate table rather than a column so that adding
-- a third office is a data change, not a schema change.
-- ---------------------------------------------------------------------

create table if not exists public.chart_tile_offices (
  tile_id    uuid not null references public.chart_tiles(id) on delete cascade,
  office_id  uuid not null references public.offices(id)     on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tile_id, office_id)
);

create index if not exists chart_tile_offices_office_idx
  on public.chart_tile_offices (office_id);

-- ---------------------------------------------------------------------
-- 4. Add-ons
--
-- Each row is a procedure code that rides on a tile. is_default_on says
-- whether it arrives checked. On commit, every add-on still checked
-- posts as its own procedure line beside the base code — confirmed with
-- Shad, who said an add-on is an additional line rather than a
-- modifier of the base one.
-- ---------------------------------------------------------------------

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

create trigger chart_tile_addons_touch
  before update on public.chart_tile_addons
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. Row level security
--
-- Reading follows organization membership. Writing is restricted to an
-- organization admin, because a tile decides which procedure code gets
-- written into OpenDental and that is not a front-desk decision.
-- ---------------------------------------------------------------------

alter table public.chart_tile_offices enable row level security;
alter table public.chart_tile_addons  enable row level security;

-- Categories ----------------------------------------------------------

create policy chart_categories_select on public.chart_categories
  for select using (organization_id in (select public.current_organization_ids()));

create policy chart_categories_insert on public.chart_categories
  for insert with check (public.is_org_admin(organization_id));

create policy chart_categories_update on public.chart_categories
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy chart_categories_delete on public.chart_categories
  for delete using (public.is_org_admin(organization_id));

-- Tiles ---------------------------------------------------------------

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

-- Availability --------------------------------------------------------

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
    -- The office has to belong to the same organization as the tile,
    -- or one tenant could switch on a tile at another tenant's office.
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

-- Add-ons -------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- 6. Existing tiles keep working
--
-- Everything in 009 was created at Downey. Making them available there
-- preserves the current behaviour exactly; nothing becomes visible at
-- Maywood that was not visible before.
-- ---------------------------------------------------------------------

insert into public.chart_tile_offices (tile_id, office_id)
select t.id, o.id
from public.chart_tiles t
join public.chart_categories c on c.id = t.category_id
join public.offices o on o.organization_id = c.organization_id
where o.slug = 'downey'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 7. Documentation
-- ---------------------------------------------------------------------

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
  'Extras that ride on a tile, arriving pre-checked or not per is_default_on. Each one still checked at commit posts as its own procedure line.';

commit;
