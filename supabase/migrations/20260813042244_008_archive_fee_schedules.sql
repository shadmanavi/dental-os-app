alter table fee_schedules
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id);

create index fee_schedules_archived_at_idx
  on fee_schedules (archived_at)
  where archived_at is null;

comment on column fee_schedules.archived_at is
  'Set when hidden from the uploads list. Pushed schedules are archived rather than deleted so fee_push_log keeps its link.';;
