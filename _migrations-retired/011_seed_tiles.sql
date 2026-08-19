-- =====================================================================
-- Dental OS — Migration 011
-- Seed the tile tree from Greenwood's own six-month procedure history.
--
-- Replaces everything migration 009 created. 009's tiles were written
-- before any live data had been looked at; this seed is built from what
-- Downey and Maywood actually completed between 2026-02-13 and
-- 2026-08-13 — 23,146 procedures at Downey and 12,805 at Maywood.
--
-- How the tiles were chosen
-- ------------------------------------------------------------------
-- The top 40 codes carry 91% of Downey's volume and 94% of Maywood's,
-- so a screen with a few hundred buttons would be mostly dead weight.
-- Every tile below was used at both offices in the window; nothing here
-- is a code someone might do one day.
--
-- Three deliberate exclusions:
--
--   - Admin codes. D0001 Visit Documentation is the single most used
--     code at both offices (5,360 and 2,871) and Monthly Capitation is
--     not far behind, but neither is a clinical finding. They are
--     posted by the front desk, not charted at the chair.
--
--   - Bridges. D6740, D6740d and D6245 are all in live use, but a
--     bridge is abutments plus pontics priced per unit, and modelling
--     half of that would be worse than leaving it out. Added properly
--     later.
--
--   - Amalgam. Eighteen uses in six months, all at Downey, none at
--     Maywood. Below the line where a button earns its place.
--
-- Where the values come from
-- ------------------------------------------------------------------
-- treat_area is OpenDental's own procedurecode.TreatArea for each code,
-- read from the live databases rather than inferred: 0 whole mouth,
-- 1 surface, 2 tooth, 3 mouth, 4 quadrant.
--
-- delivery_code is set on the three crowns that showed a matching
-- delivery code in the data. D2751d appeared 136 times at Downey and
-- 100 at Maywood, tracking D2751 closely — the prep is billed at the
-- first visit and the seat at the second. Those tiles write two lines.
--
-- Buckets
-- ------------------------------------------------------------------
-- Existing and diagnosed do not need the same tiles. A clinician charts
-- an existing crown or a missing tooth; nobody charts an existing
-- prophylaxis on a tooth chart. So restorative, endo, surgery and
-- missing teeth appear in both buckets, while perio, hygiene and
-- radiographs appear only under diagnosed.
--
-- Add-ons
-- ------------------------------------------------------------------
-- None are seeded. Porcelain margins was the worked example, but no
-- code for it appeared in either office's six months, and inventing one
-- would put a code into OpenDental that Greenwood does not use. They go
-- in through the management screen, where the person adding one knows
-- which code they mean.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Clear what 009 seeded
--
-- Tiles, availability rows and add-ons all cascade from the category.
-- ---------------------------------------------------------------------

delete from public.chart_categories
where organization_id = (
  select organization_id from public.offices where slug = 'downey' limit 1
);

-- ---------------------------------------------------------------------
-- 2. Categories
-- ---------------------------------------------------------------------

insert into public.chart_categories (organization_id, bucket, label, sort_order)
select
  (select organization_id from public.offices where slug = 'downey' limit 1),
  v.bucket,
  v.label,
  v.sort_order
from (values
  ('existing',  'Fillings',                10),
  ('existing',  'Crown & bridge',          20),
  ('existing',  'Endo',                    30),
  ('existing',  'Oral surgery',            40),
  ('existing',  'Missing & other',         50),

  ('diagnosed', 'Fillings',                10),
  ('diagnosed', 'Crown & bridge',          20),
  ('diagnosed', 'Endo',                    30),
  ('diagnosed', 'Oral surgery',            40),
  ('diagnosed', 'Perio',                   50),
  ('diagnosed', 'Cleanings & prevention',  60),
  ('diagnosed', 'Exams & x-rays',          70),
  ('diagnosed', 'Missing & other',         80)
) as v(bucket, label, sort_order);

-- ---------------------------------------------------------------------
-- 3. Tiles
--
-- buckets says where a tile belongs: 'both' puts it under existing and
-- diagnosed, 'diagnosed' under diagnosed only.
--
-- A code_rule of type fixed holds one code. surface_count splits by
-- anterior/posterior and then by how many surfaces were picked.
-- tooth_class splits by where the tooth sits in the arch — the coder's
-- judgement that OpenDental does not store anywhere.
-- ---------------------------------------------------------------------

with org as (
  select organization_id as id from public.offices where slug = 'downey' limit 1
),
tile_src (category, label, entry_kind, initial_type, needs_surfaces,
          treat_area, delivery_code, code_rule, sort_order, buckets) as (
  values
    -- Fillings -------------------------------------------------------
    -- 323 two-surface posteriors at Downey and 248 at Maywood make this
    -- the busiest restorative tile in the practice. One button, eight
    -- possible codes, resolved by where the tooth is and how many
    -- surfaces the clinician taps.
    ('Fillings', 'Composite', 'procedure', null, true, 1, null,
     '{"type":"surface_count",'
     '"anterior":["D2330","D2331","D2332","D2335"],'
     '"posterior":["D2391","D2392","D2393","D2394"]}'::jsonb, 10, 'both'),

    -- Crown & bridge -------------------------------------------------
    ('Crown & bridge', 'Crown — PFM', 'procedure', null, false, 2, 'D2751d',
     '{"type":"fixed","code":"D2751"}'::jsonb, 10, 'both'),

    ('Crown & bridge', 'Crown — PFM high noble', 'procedure', null, false, 2, 'D2750d',
     '{"type":"fixed","code":"D2750"}'::jsonb, 20, 'both'),

    ('Crown & bridge', 'Crown — all ceramic', 'procedure', null, false, 2, 'D2740d',
     '{"type":"fixed","code":"D2740"}'::jsonb, 30, 'both'),

    ('Crown & bridge', 'Core buildup', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D2950"}'::jsonb, 40, 'both'),

    ('Crown & bridge', 'Post & core — prefab', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D2954"}'::jsonb, 50, 'both'),

    ('Crown & bridge', 'Post & core — indirect', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D2952"}'::jsonb, 60, 'both'),

    ('Crown & bridge', 'Recement crown', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D2920"}'::jsonb, 70, 'both'),

    -- Endo -----------------------------------------------------------
    -- Which root canal code applies depends on the tooth, not on
    -- anything the clinician has to remember.
    ('Endo', 'Root canal', 'procedure', null, false, 2, null,
     '{"type":"tooth_class","anterior":"D3310","bicuspid":"D3320","molar":"D3330"}'::jsonb,
     10, 'both'),

    ('Endo', 'Root canal — retreatment', 'procedure', null, false, 2, null,
     '{"type":"tooth_class","anterior":"D3346","bicuspid":"D3347","molar":"D3348"}'::jsonb,
     20, 'both'),

    ('Endo', 'Pulpal debridement', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D3221"}'::jsonb, 30, 'both'),

    ('Endo', 'Palliative treatment', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D9110"}'::jsonb, 40, 'both'),

    -- Oral surgery ---------------------------------------------------
    ('Oral surgery', 'Extraction — simple', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D7140"}'::jsonb, 10, 'both'),

    ('Oral surgery', 'Extraction — surgical', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D7210"}'::jsonb, 20, 'both'),

    ('Oral surgery', 'Impacted — soft tissue', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D7220"}'::jsonb, 30, 'both'),

    ('Oral surgery', 'Impacted — partial bony', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D7230"}'::jsonb, 40, 'both'),

    ('Oral surgery', 'Impacted — full bony', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D7240"}'::jsonb, 50, 'both'),

    ('Oral surgery', 'Residual roots', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D7250"}'::jsonb, 60, 'both'),

    -- Perio ----------------------------------------------------------
    -- Quadrant procedures, not tooth ones. 878 four-plus-teeth SRPs at
    -- Downey in six months makes this the busiest single clinical code
    -- outside radiographs.
    ('Perio', 'SRP — 4+ teeth', 'procedure', null, false, 4, null,
     '{"type":"fixed","code":"D4341"}'::jsonb, 10, 'diagnosed'),

    ('Perio', 'SRP — 1 to 3 teeth', 'procedure', null, false, 4, null,
     '{"type":"fixed","code":"D4342"}'::jsonb, 20, 'diagnosed'),

    ('Perio', 'Localized antimicrobial', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D4381"}'::jsonb, 30, 'diagnosed'),

    -- Cleanings & prevention -----------------------------------------
    ('Cleanings & prevention', 'Prophy — adult', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D1110"}'::jsonb, 10, 'diagnosed'),

    ('Cleanings & prevention', 'Prophy — child', 'procedure', null, false, 3, null,
     '{"type":"fixed","code":"D1120"}'::jsonb, 20, 'diagnosed'),

    ('Cleanings & prevention', 'Perio maintenance', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D4910"}'::jsonb, 30, 'diagnosed'),

    ('Cleanings & prevention', 'Fluoride', 'procedure', null, false, 3, null,
     '{"type":"fixed","code":"D1208"}'::jsonb, 40, 'diagnosed'),

    -- Sealant is per tooth despite OpenDental filing it as a surface
    -- code, so it asks for a tooth and not for surfaces.
    ('Cleanings & prevention', 'Sealant', 'procedure', null, false, 1, null,
     '{"type":"fixed","code":"D1351"}'::jsonb, 50, 'diagnosed'),

    -- Exams & x-rays -------------------------------------------------
    ('Exams & x-rays', 'Periodic exam', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D0120"}'::jsonb, 10, 'diagnosed'),

    ('Exams & x-rays', 'Comprehensive exam', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D0150"}'::jsonb, 20, 'diagnosed'),

    ('Exams & x-rays', 'Limited exam', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D0140"}'::jsonb, 30, 'diagnosed'),

    ('Exams & x-rays', 'Bitewings — four films', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D0274"}'::jsonb, 40, 'diagnosed'),

    ('Exams & x-rays', 'PA — first film', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D0220"}'::jsonb, 50, 'diagnosed'),

    ('Exams & x-rays', 'PA — additional film', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D0230"}'::jsonb, 60, 'diagnosed'),

    ('Exams & x-rays', 'Full mouth series', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D0210"}'::jsonb, 70, 'diagnosed'),

    ('Exams & x-rays', 'Panoramic', 'procedure', null, false, 3, null,
     '{"type":"fixed","code":"D0330"}'::jsonb, 80, 'diagnosed'),

    ('Exams & x-rays', 'Photos', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D0350"}'::jsonb, 90, 'diagnosed'),

    -- Missing & other ------------------------------------------------
    -- Not a procedure. A missing tooth is a toothinitial row in
    -- OpenDental, which is why this tile carries no code rule.
    ('Missing & other', 'Missing tooth', 'tooth_initial', 'Missing', false, 2, null,
     null::jsonb, 10, 'both')
)
insert into public.chart_tiles
  (category_id, label, entry_kind, initial_type, needs_surfaces,
   treat_area, delivery_code, code_rule, sort_order)
select
  c.id,
  t.label,
  t.entry_kind,
  t.initial_type,
  t.needs_surfaces,
  t.treat_area,
  t.delivery_code,
  t.code_rule,
  t.sort_order
from tile_src t
join org on true
join public.chart_categories c
  on c.organization_id = org.id
 and c.label = t.category
 and (t.buckets = 'both' or c.bucket = t.buckets);

-- ---------------------------------------------------------------------
-- 4. Availability
--
-- Every seeded code was in live use at both offices during the survey
-- window, so every tile starts available at both. Narrowing one to a
-- single office is a decision for the management screen, made by
-- someone who knows why.
-- ---------------------------------------------------------------------

insert into public.chart_tile_offices (tile_id, office_id)
select t.id, o.id
from public.chart_tiles t
join public.chart_categories c on c.id = t.category_id
join public.offices o on o.organization_id = c.organization_id
on conflict do nothing;

commit;
