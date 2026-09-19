-- OpenDental-username login: the provisioning ledger.
--
-- This table does not decide who can log in — Supabase Auth's own
-- auth.users decides that, keyed on a synthetic email the login page
-- computes itself (office_slug + od_username, no lookup needed). This
-- table exists so:
--   1. Re-running the sync is idempotent (an already-provisioned OD
--      user is not recreated, and a temp password is not reissued).
--   2. A user whose OpenDental login is later hidden can be found and
--      deprovisioned (the Supabase Auth account is banned, not just
--      this row deleted, so the login stops working even if this row
--      is somehow bypassed).
--   3. An admin has something to look at: whose OD login has been
--      turned into a Dental OS account, and when.

create table public.od_staff_logins (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  od_user_num integer not null,
  od_username text not null,
  full_name text,
  internal_email text not null,
  user_id uuid references public.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (office_id, od_user_num),
  unique (internal_email)
);

comment on table public.od_staff_logins is
  'Provisioning ledger linking one OpenDental userod row to a Supabase Auth account. Login itself does not read this table -- the login page computes the synthetic email directly.';
comment on column public.od_staff_logins.internal_email is
  'The synthetic email actually registered in Supabase Auth: "<office_slug>.<od_username lowercased>@dental-os.internal". Never a real, deliverable address.';
comment on column public.od_staff_logins.is_active is
  'False once the OpenDental user was hidden and this login was deprovisioned. The Supabase Auth account is also banned at that point, so this flag is a record, not the enforcement.';

alter table public.od_staff_logins enable row level security;

-- Admin-only, scoped to the office the login belongs to -- the same
-- is_office_admin() every other office-scoped table in this schema
-- uses (see migration 006).
create policy od_staff_logins_select on public.od_staff_logins
  for select
  using (is_office_admin(office_id));

create policy od_staff_logins_write on public.od_staff_logins
  for all
  using (is_office_admin(office_id))
  with check (is_office_admin(office_id));
