-- =====================================================================
-- Migration 013 — od_probe, part one: extension and audit table
--
-- Lets OpenDental be queried from SQL, so investigating the API no
-- longer needs a browser token and a hand-assembled curl.
--
-- This deliberately widens where the OpenDental keys live: until now
-- they existed only as Edge Function secrets, and after this they are
-- also in Vault. That trade was made knowingly, so the function in
-- part two is built read-only and unreachable from the application.
-- =====================================================================

create extension if not exists http with schema extensions;

-- Request only. The response is returned to the caller and forgotten,
-- because replies routinely carry patient names and Dental OS does not
-- keep PHI.
create table if not exists od_probe_log (
  id            bigserial primary key,
  office_slug   text        not null,
  method        text        not null,
  path          text        not null,
  request_body  jsonb,
  http_status   int,
  elapsed_ms    int,
  row_count     int,
  error         text,
  called_by     text        not null default current_user,
  called_at     timestamptz not null default now()
);

comment on table od_probe_log is
  'Every od_probe call. Requests are kept; responses never are, because they routinely carry PHI.';

alter table od_probe_log enable row level security;

-- No policy on purpose. Nothing in the application should read this.;
