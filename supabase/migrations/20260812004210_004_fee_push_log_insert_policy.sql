-- The audit log had a SELECT policy but no INSERT policy, so RLS silently
-- rejected every write attempt and pushes completed with no audit trail.
-- Only users who may edit fee schedules at that office can write log rows,
-- and the row must be attributed to the caller.

create policy fpl_insert on public.fee_push_log
  for insert
  with check (
    can_edit_fee_schedules(office_id)
    and (attempted_by is null or attempted_by = auth.uid())
  );;
