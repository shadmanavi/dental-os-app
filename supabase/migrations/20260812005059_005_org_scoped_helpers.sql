-- Multi-tenant hardening, part 1: organization-aware helper functions.
--
-- is_admin() answers "is this user an owner_admin anywhere", which was fine
-- with a single tenant but would let an admin at one organization pass
-- permission checks on another organization's rows. These helpers narrow the
-- question to a specific office or organization. is_admin() is left in place
-- so nothing breaks mid-migration; the policies move over in 006.

-- Is the caller an owner_admin at this specific office?
create or replace function public.is_office_admin(target_office uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.user_office_roles uor
    join public.roles r on r.id = uor.role_id
    where uor.user_id = auth.uid()
      and uor.office_id = target_office
      and r.key = 'owner_admin'
  );
$$;

-- Is the caller an owner_admin at any office belonging to this organization?
create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.user_office_roles uor
    join public.roles r on r.id = uor.role_id
    join public.offices o on o.id = uor.office_id
    where uor.user_id = auth.uid()
      and o.organization_id = target_org
      and r.key = 'owner_admin'
  );
$$;

-- Does the caller share an organization with this user?
create or replace function public.shares_organization(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.user_office_roles uor
    join public.offices o on o.id = uor.office_id
    where uor.user_id = target_user
      and o.organization_id in (select public.current_organization_ids())
  );
$$;;
