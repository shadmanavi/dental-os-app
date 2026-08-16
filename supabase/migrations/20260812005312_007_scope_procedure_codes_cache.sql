-- procedure_codes_cache leaked across tenants. pcc_admin_write was FOR ALL
-- with a bare is_admin() check, and a permissive ALL policy also grants
-- SELECT, so an owner_admin at any organization could read every office's
-- cached procedure codes regardless of the narrower pcc_select policy.
--
-- Split it into per-command policies scoped to the office that owns the row.

drop policy if exists pcc_admin_write on public.procedure_codes_cache;

create policy pcc_insert on public.procedure_codes_cache
  for insert
  with check (is_office_admin(office_id));

create policy pcc_update on public.procedure_codes_cache
  for update
  using (is_office_admin(office_id))
  with check (is_office_admin(office_id));

create policy pcc_delete on public.procedure_codes_cache
  for delete
  using (is_office_admin(office_id));;
