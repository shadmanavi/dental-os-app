-- 003_organizations.sql
-- Adds an organizations layer above offices. Existing Greenwood offices
-- are backfilled into a single seed organization.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  legal_name text,
  billing_email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_organizations_updated_at
  before update on organizations
  for each row execute function set_updated_at();

insert into organizations (slug, name, legal_name)
values ('greenwood', 'Greenwood Dental Services', 'Greenwood Dental Services')
on conflict (slug) do nothing;

alter table offices
  add column if not exists organization_id uuid references organizations(id);

update offices
set organization_id = (select id from organizations where slug = 'greenwood')
where organization_id is null;

alter table offices
  alter column organization_id set not null;

alter table organizations enable row level security;

create or replace function current_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct o.organization_id
  from user_office_roles uor
  join offices o on o.id = uor.office_id
  where uor.user_id = auth.uid();
$$;

create policy "org members can view their organization"
on organizations for select
using (id in (select current_organization_ids()));
;
