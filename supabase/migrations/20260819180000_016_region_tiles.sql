-- 016 — Region tiles: whole mouth, quadrant and arch
--
-- TC Charting could only enter work that belongs to a single tooth. Half of
-- the work done at Downey does not: exams, x-rays, cleanings, night guards,
-- referrals, scaling and root planing, dentures. This adds the menu entries
-- for that work. The screen and the write rule are separate builds.
--
-- Nothing here is destructive. Every insert is guarded, so re-running the
-- file changes nothing and none of the existing tiles are touched.
--
-- treat_area carries OpenDental's own procedurecode.TreatArea unchanged:
--   0 no area   1 surface   2 tooth   3 mouth
--   4 quadrant  6 arch      7 tooth range
--
-- Deliberately left out, and why:
--   M9955  In Office Whitening at Downey, Flouridex at Maywood. One code,
--          two different procedures. A single tile would post the wrong
--          thing at one office. Fix the code list first.
--   D9630  Downey calls it medicaments by report, Maywood calls it
--          irrigation. Same CDT code, so it is safe, but the tile name
--          would read wrong at one office.
--   D0350  Photos already has a tile. It is mouth level at Downey and
--          tooth level at Maywood, so it will ask for a tooth at Maywood
--          until that code is corrected there.

begin;
-- ---------------------------------------------------------------------
-- 1. New categories, diagnosed bucket
-- ---------------------------------------------------------------------

insert into public.chart_categories (organization_id, bucket, label, sort_order)
select o.organization_id, v.bucket, v.label, v.sort_order
from (select organization_id from public.offices where slug = 'downey' limit 1) o
cross join (values
  ('diagnosed', 'Appliances',            80),
  ('diagnosed', 'Sedation',              90),
  ('diagnosed', 'Referrals & Consults', 100),
  ('diagnosed', 'Dentures',             110)
) as v(bucket, label, sort_order)
where not exists (
  select 1 from public.chart_categories c
  where c.organization_id = o.organization_id
    and c.bucket = v.bucket
    and c.label = v.label
);
-- ---------------------------------------------------------------------
-- 2. Tiles
-- ---------------------------------------------------------------------

with org as (
  select organization_id as id from public.offices where slug = 'downey' limit 1
),
tile_src (category, label, treat_area, proc_code, delivery_code, sort_order) as (
  values
    -- Exams & X-rays — continues the existing list, which ends at 90
    ('Exams & X-rays', 'Recall exam — 3 month',      0, 'C0130',  null::text, 100),
    ('Exams & X-rays', 'Exam — new insurance',       0, 'D0150A', null::text, 110),
    ('Exams & X-rays', 'Perio evaluation',           0, 'D0180',  null::text, 120),
    ('Exams & X-rays', 'Post-op check',              0, 'M2018',  null::text, 130),
    ('Exams & X-rays', 'Office visit — observation', 0, 'D9430',  null::text, 140),
    ('Exams & X-rays', 'Bitewings — two films',      0, 'D0272',  null::text, 150),
    ('Exams & X-rays', 'Bitewing — single film',     0, 'D0270',  null::text, 160),
    ('Exams & X-rays', 'Cephalometric film',         0, 'D0340',  null::text, 170),
    ('Exams & X-rays', 'Itero scan',                 3, 'D0801',  null::text, 180),
    ('Exams & X-rays', 'Diagnostic casts',           0, 'D0470',  null::text, 190),

    -- Cleanings & Prevention — continues the existing list, which ends at 50
    ('Cleanings & Prevention', 'Fluoride varnish',      3, 'D1206', null::text, 60),
    ('Cleanings & Prevention', 'Full mouth debridement', 0, 'D4355', null::text, 70),

    -- Appliances
    ('Appliances', 'Night guard — hard',        0, 'D9944', 'D9940d', 10),
    ('Appliances', 'Night guard — soft',        0, 'D9945', null::text, 20),
    ('Appliances', 'Occlusal guard — by report', 0, 'D9940', null::text, 30),

    -- Sedation
    ('Sedation', 'Deep sedation',  0, 'D9223', null::text, 10),
    ('Sedation', 'Nitrous oxide',  0, 'D9230', null::text, 20),

    -- Referrals & Consults
    ('Referrals & Consults', 'Ortho referral',       0, 'R0154', null::text, 10),
    ('Referrals & Consults', 'Perio referral',       0, 'R0152', null::text, 20),
    ('Referrals & Consults', 'Endo referral',        0, 'R0153', null::text, 30),
    ('Referrals & Consults', 'Oral surgery consult', 0, 'C0155', null::text, 40),
    ('Referrals & Consults', 'GP re-evaluation',     0, 'C0151', null::text, 50),

    -- Dentures — arch level, so the screen asks for upper or lower
    ('Dentures', 'Complete denture — upper',  6, 'D5110', 'D5110d', 10),
    ('Dentures', 'Complete denture — lower',  6, 'D5120', 'D5120d', 20),
    ('Dentures', 'Immediate denture — upper', 6, 'D5130', 'D5130d', 30),
    ('Dentures', 'Immediate denture — lower', 6, 'D5140', 'D5140d', 40)
)
insert into public.chart_tiles
  (category_id, label, entry_kind, needs_surfaces, treat_area,
   delivery_code, code_rule, sort_order)
select
  c.id,
  t.label,
  'procedure',
  false,
  t.treat_area,
  t.delivery_code,
  jsonb_build_object('type', 'fixed', 'code', t.proc_code),
  t.sort_order
from tile_src t
join org on true
join public.chart_categories c
  on c.organization_id = org.id
 and c.bucket = 'diagnosed'
 and c.label = t.category
on conflict (category_id, label) do nothing;
-- ---------------------------------------------------------------------
-- 3. Offer every new tile at both offices
-- ---------------------------------------------------------------------

insert into public.chart_tile_offices (tile_id, office_id)
select t.id, o.id
from public.chart_tiles t
join public.chart_categories c on c.id = t.category_id
join public.offices o on o.organization_id = c.organization_id
on conflict (tile_id, office_id) do nothing;
commit;
