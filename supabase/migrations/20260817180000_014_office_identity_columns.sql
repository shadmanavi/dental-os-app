-- 014_office_identity_columns
--
-- Adds the office letterhead columns to public.offices.
--
-- These three columns hold what OpenDental already maintains under
-- Setup -> Practice and Setup -> Email, so an office that moves or
-- changes its number updates one place, not two.
--
-- Reconstructed on 17 August 2026 from the live schema. The original
-- file was blanked by "supabase migration fetch" reading a history row
-- whose statements column had been left null. The columns below match
-- information_schema.columns on the live database exactly: all three
-- nullable, no defaults.

alter table public.offices
  add column if not exists fax                text;

alter table public.offices
  add column if not exists email              text;

alter table public.offices
  add column if not exists identity_synced_at timestamptz;

comment on column public.offices.fax                is 'Practice fax, synced from OpenDental. Stored but not printed on the treatment plan.';
comment on column public.offices.email              is 'Practice email, synced from the default OpenDental emailaddress row.';
comment on column public.offices.identity_synced_at is 'When od_sync_offices() last wrote this row from OpenDental.';
;
