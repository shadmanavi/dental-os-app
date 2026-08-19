-- =====================================================================
-- Dental OS — Migration 012
-- Category tidy-up.
--
-- 1. A missing tooth is not a diagnosis. It records what is already
--    true about the mouth, which is what the existing bucket is for.
--    Dropping it from diagnosed also means every diagnosed tile is a
--    procedure, so the screen no longer has to ask which kind it is.
--
--    The existing bucket keeps both kinds, and that distinction is
--    real rather than cosmetic: an existing crown is a procedurelog
--    row at status EO, while a missing tooth is a toothinitial row.
--    OpenDental refuses to delete the former and allows the latter.
--
-- 2. Category labels go to title case, to match how the office writes
--    them rather than how a developer typed them.
-- =====================================================================

begin;

delete from public.chart_categories
where bucket = 'diagnosed'
  and label = 'Missing & other';

update public.chart_categories
set label = case label
  when 'Crown & bridge'         then 'Crown & Bridge'
  when 'Oral surgery'           then 'Oral Surgery'
  when 'Missing & other'        then 'Missing & Other'
  when 'Cleanings & prevention' then 'Cleanings & Prevention'
  when 'Exams & x-rays'         then 'Exams & X-rays'
  else label
end
where label in (
  'Crown & bridge', 'Oral surgery', 'Missing & other',
  'Cleanings & prevention', 'Exams & x-rays'
);

commit;
