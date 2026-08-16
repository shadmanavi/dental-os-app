-- Multi-tenant hardening, part 2: replace bare is_admin() in policies with
-- checks tied to a specific office or organization.
--
-- Before this, an owner_admin at any organization satisfied is_admin() and so
-- passed permission checks on every organization's rows. Each policy below now
-- names the office or organization the row belongs to.

-- offices -----------------------------------------------------------------
drop policy if exists offices_admin_write on public.offices;
drop policy if exists offices_select on public.offices;

create policy offices_select on public.offices
  for select
  using (has_office_access(id) or is_org_admin(organization_id));

create policy offices_update on public.offices
  for update
  using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));

create policy offices_insert on public.offices
  for insert
  with check (is_org_admin(organization_id));

create policy offices_delete on public.offices
  for delete
  using (is_org_admin(organization_id));

-- users -------------------------------------------------------------------
-- An admin could previously read every user row in the database. Now they see
-- only themselves and people who hold a role in their own organization.
drop policy if exists users_select_self on public.users;
drop policy if exists users_admin_write on public.users;

create policy users_select on public.users
  for select
  using (id = auth.uid() or shares_organization(id));

create policy users_admin_write on public.users
  for all
  using (shares_organization(id) and is_admin())
  with check (shares_organization(id) and is_admin());

-- user_office_roles -------------------------------------------------------
-- Role assignments are visible for your own row, or to an admin of the
-- organization that owns the office in question.
drop policy if exists uor_select on public.user_office_roles;
drop policy if exists uor_admin_write on public.user_office_roles;

create policy uor_select on public.user_office_roles
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.offices o
      where o.id = user_office_roles.office_id
        and is_org_admin(o.organization_id)
    )
  );

create policy uor_admin_write on public.user_office_roles
  for all
  using (is_office_admin(office_id))
  with check (is_office_admin(office_id));

-- roles -------------------------------------------------------------------
-- Role definitions are a shared lookup table; readable by all, writable by
-- nobody through the API.
drop policy if exists roles_admin_write on public.roles;

-- fee_schedules -----------------------------------------------------------
-- Deleting a staged schedule required admin anywhere; now admin at that office.
drop policy if exists fs_delete on public.fee_schedules;

create policy fs_delete on public.fee_schedules
  for delete
  using (is_office_admin(office_id) and status <> 'pushed');;
