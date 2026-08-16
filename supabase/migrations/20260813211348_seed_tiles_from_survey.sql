-- Migration 011 — Seed the tile tree from Greenwood's six-month
-- procedure history (2026-02-13 to 2026-08-13). Replaces 009's tiles.

delete from public.chart_categories
where organization_id = (
  select organization_id from public.offices where slug = 'downey' limit 1
);

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

with org as (
  select organization_id as id from public.offices where slug = 'downey' limit 1
),
tile_src (category, label, entry_kind, initial_type, needs_surfaces,
          treat_area, delivery_code, code_rule, sort_order, buckets) as (
  values
    ('Fillings', 'Composite', 'procedure', null, true, 1, null,
     '{"type":"surface_count","anterior":["D2330","D2331","D2332","D2335"],"posterior":["D2391","D2392","D2393","D2394"]}'::jsonb, 10, 'both'),

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

    ('Endo', 'Root canal', 'procedure', null, false, 2, null,
     '{"type":"tooth_class","anterior":"D3310","bicuspid":"D3320","molar":"D3330"}'::jsonb, 10, 'both'),
    ('Endo', 'Root canal — retreatment', 'procedure', null, false, 2, null,
     '{"type":"tooth_class","anterior":"D3346","bicuspid":"D3347","molar":"D3348"}'::jsonb, 20, 'both'),
    ('Endo', 'Pulpal debridement', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D3221"}'::jsonb, 30, 'both'),
    ('Endo', 'Palliative treatment', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D9110"}'::jsonb, 40, 'both'),

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

    ('Perio', 'SRP — 4+ teeth', 'procedure', null, false, 4, null,
     '{"type":"fixed","code":"D4341"}'::jsonb, 10, 'diagnosed'),
    ('Perio', 'SRP — 1 to 3 teeth', 'procedure', null, false, 4, null,
     '{"type":"fixed","code":"D4342"}'::jsonb, 20, 'diagnosed'),
    ('Perio', 'Localized antimicrobial', 'procedure', null, false, 2, null,
     '{"type":"fixed","code":"D4381"}'::jsonb, 30, 'diagnosed'),

    ('Cleanings & prevention', 'Prophy — adult', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D1110"}'::jsonb, 10, 'diagnosed'),
    ('Cleanings & prevention', 'Prophy — child', 'procedure', null, false, 3, null,
     '{"type":"fixed","code":"D1120"}'::jsonb, 20, 'diagnosed'),
    ('Cleanings & prevention', 'Perio maintenance', 'procedure', null, false, 0, null,
     '{"type":"fixed","code":"D4910"}'::jsonb, 30, 'diagnosed'),
    ('Cleanings & prevention', 'Fluoride', 'procedure', null, false, 3, null,
     '{"type":"fixed","code":"D1208"}'::jsonb, 40, 'diagnosed'),
    ('Cleanings & prevention', 'Sealant', 'procedure', null, false, 1, null,
     '{"type":"fixed","code":"D1351"}'::jsonb, 50, 'diagnosed'),

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

    ('Missing & other', 'Missing tooth', 'tooth_initial', 'Missing', false, 2, null,
     null::jsonb, 10, 'both')
)
insert into public.chart_tiles
  (category_id, label, entry_kind, initial_type, needs_surfaces,
   treat_area, delivery_code, code_rule, sort_order)
select
  c.id, t.label, t.entry_kind, t.initial_type, t.needs_surfaces,
  t.treat_area, t.delivery_code, t.code_rule, t.sort_order
from tile_src t
join org on true
join public.chart_categories c
  on c.organization_id = org.id
 and c.label = t.category
 and (t.buckets = 'both' or c.bucket = t.buckets);

insert into public.chart_tile_offices (tile_id, office_id)
select t.id, o.id
from public.chart_tiles t
join public.chart_categories c on c.id = t.category_id
join public.offices o on o.organization_id = c.organization_id
on conflict do nothing;;
