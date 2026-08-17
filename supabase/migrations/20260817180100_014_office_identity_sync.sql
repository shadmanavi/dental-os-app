-- 014_office_identity_sync
--
-- INTENTIONALLY EMPTY. This is not an omission.
--
-- This migration originally created v1 of public.od_sync_offices().
-- That text is gone. It was applied to the database from a chat session
-- rather than through the CLI, so the history row was inserted by hand
-- with a null statements column; "supabase migration fetch" later
-- rewrote this file from that null and blanked it. It reached git
-- already blank (commit b8d64b2), so no earlier copy exists anywhere.
--
-- Nothing is lost in practice. Migration 015, which follows this one,
-- replaced that function wholesale with v2 -- the version running today.
-- A replay from an empty database therefore still arrives at the correct
-- state: 014 adds the columns, this file does nothing, 015 creates the
-- function as it currently exists.
--
-- Do not attempt to reconstruct v1. It would be a guess, and it would be
-- overwritten by the next file regardless.

select 1 where false;
;
