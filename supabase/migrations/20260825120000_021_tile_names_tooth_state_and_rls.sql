-- 021 — Tile names in plain English, the 4 tiles added by hand, and RLS on
--        the 3 CDT cleanup tables
--
-- Everything in this file was applied straight to the live database on 20 and
-- 23 August 2026 through execute_sql, so no migration ever recorded it. A
-- rebuild from the migration files came up with the old tile names, without
-- the 4 new tiles, and with the 3 cleanup tables wide open. This file closes
-- that gap. It changes nothing on a database that is already up to date.
--
-- Every statement is written to be safe to re-run.
--
-- The names are written out literally rather than read back out of
-- dos_code_names. Two reasons. That table is a 20 August snapshot that will
-- keep moving as the CDT cleanup continues, so a rebuild months from now
-- would not reproduce today's screen. And the Perio pair has since been
-- changed by hand: dos_code_names still says "Deep Cleaning 4+" and "Deep
-- Cleaning 1-3", while the tiles read "Gum Treatment 4+" and "Gum Treatment
-- 1-3". The tiles win here, because the tile is what is on the screen.
--
-- The 6 multi-code tiles keep their hand-written names — Composite x2, Root
-- canal x2 and Root canal retreatment x2 each pick between several codes, so
-- no single layman's term fits. Missing tooth has no code at all.
--
-- treat_area carries OpenDental's own procedurecode.TreatArea unchanged:
--   0 no area   1 surface   2 tooth   3 mouth
--   4 quadrant  6 arch      7 tooth range

begin;
-- ---------------------------------------------------------------------
-- 1. Let a tile mark a tooth Primary
--
-- The guard was written when Missing and Hidden were the only two tooth
-- states, and it silently blocked the Primary / Permanent tile in section 2.
-- ---------------------------------------------------------------------

alter table public.chart_tiles
  drop constraint if exists chart_tiles_initial_type_check;

alter table public.chart_tiles
  add constraint chart_tiles_initial_type_check
  check (initial_type = any (array['Missing'::text, 'Hidden'::text, 'Primary'::text]));
-- ---------------------------------------------------------------------
-- 2. The 4 tiles added by hand
--
--   Socket Bone Graft    D7953, ridge preservation, which belongs with the
--                        extractions. D4263 is the perio graft and is not
--                        this one.
--   Silver Filling       Amalgam, one tile rather than a front-and-back
--                        split, because D2140 to D2161 cover every tooth.
--                        Diagnosed and Existing both.
--   Primary / Permanent  Marks a baby tooth. No code — it writes a
--                        toothinitial row on the permanent number, which is
--                        what makes the letter appear.
-- ---------------------------------------------------------------------

with org as (
  select organization_id as id from public.offices where slug = 'downey' limit 1
),
tile_src (bucket, category, label, entry_kind, initial_type, needs_surfaces,
          treat_area, code_rule, sort_order) as (
  values
    ('diagnosed', 'Oral Surgery',    'Socket Bone Graft',   'procedure',     null::text,
       false, 2::smallint,
       '{"type": "fixed", "code": "D7953"}'::jsonb, 70),

    ('diagnosed', 'Fillings',        'Silver Filling',      'procedure',     null::text,
       true,  1::smallint,
       '{"type": "surface_count", "all": ["D2140", "D2150", "D2160", "D2161"]}'::jsonb, 20),

    ('existing',  'Fillings',        'Silver Filling',      'procedure',     null::text,
       true,  1::smallint,
       '{"type": "surface_count", "all": ["D2140", "D2150", "D2160", "D2161"]}'::jsonb, 20),

    ('existing',  'Missing & Other', 'Primary / Permanent', 'tooth_initial', 'Primary',
       false, 2::smallint,
       null::jsonb, 20)
)
insert into public.chart_tiles
  (category_id, label, entry_kind, initial_type, needs_surfaces, treat_area,
   code_rule, delivery_code, delivery_posts_at_zero, sort_order, is_active)
select
  c.id, t.label, t.entry_kind, t.initial_type, t.needs_surfaces, t.treat_area,
  t.code_rule, null, true, t.sort_order, true
from tile_src t
join org on true
join public.chart_categories c
  on c.organization_id = org.id
 and c.bucket = t.bucket
 and c.label  = t.category
on conflict (category_id, label) do nothing;
-- ---------------------------------------------------------------------
-- 3. Offer every tile at both offices
-- ---------------------------------------------------------------------

insert into public.chart_tile_offices (tile_id, office_id)
select t.id, o.id
from public.chart_tiles t
join public.chart_categories c on c.id = t.category_id
join public.offices o on o.organization_id = c.organization_id
on conflict (tile_id, office_id) do nothing;
-- ---------------------------------------------------------------------
-- 4. Tile names
--
-- Every tile whose code rule is a single fixed code, keyed by that code.
-- 59 codes across 74 tile rows — a code carries the same name in the
-- Diagnosed list and the Existing list, so some codes name 2 tiles.
--
-- 70 rows changed when this was first run by hand; the rest already read
-- correctly.
-- ---------------------------------------------------------------------

with name_src (proc_code, label) as (
  values
    ('C0130', '3 Month Recall Exam'),
    ('C0151', 'Doctor Re-Eval'),
    ('C0155', 'Surgery Consult'),
    ('D0120', 'Recall Exam'),
    ('D0140', 'Emergency Exam'),
    ('D0150', 'New Patient Exam'),
    ('D0150A', 'Exam New Insurance'),
    ('D0180', 'Perio Exam'),
    ('D0210', 'FMX'),
    ('D0220', 'PA'),
    ('D0230', 'PA Extra'),
    ('D0270', 'BW 1'),
    ('D0272', 'BW 2'),
    ('D0274', 'BW 4'),
    ('D0330', 'Pano'),
    ('D0340', 'Ceph'),
    ('D0350', 'Photos'),
    ('D0470', 'Ortho Models'),
    ('D0801', '3D Scan'),
    ('D1110', 'Cleaning'),
    ('D1120', 'Child Cleaning'),
    ('D1206', 'Fluoride Varnish'),
    ('D1208', 'Fluoride'),
    ('D1351', 'Sealant'),
    ('D2740', 'Zirconia Crown'),
    ('D2750', 'PFG Crown'),
    ('D2751', 'PFM Crown'),
    ('D2920', 'Recement Crown'),
    ('D2950', 'Core Buildup'),
    ('D2952', 'Post & Core'),
    ('D2954', 'Prefab Post & Core'),
    ('D3221', 'Open & Med'),
    ('D4341', 'Gum Treatment 4+'),
    ('D4342', 'Gum Treatment 1-3'),
    ('D4355', 'FMD'),
    ('D4381', 'Arestin'),
    ('D4910', 'Perio Maintenance'),
    ('D5110', 'Upper Denture'),
    ('D5120', 'Lower Denture'),
    ('D5130', 'Imm Upper Denture'),
    ('D5140', 'Imm Lower Denture'),
    ('D7140', 'Simple Extraction'),
    ('D7210', 'Surgical Extraction'),
    ('D7220', 'Impacted Soft Tissue'),
    ('D7230', 'Impacted Partial Bony'),
    ('D7240', 'Impacted Full Bony'),
    ('D7250', 'Root Tip Removal'),
    ('D7953', 'Socket Bone Graft'),
    ('D9110', 'Emergency Treatment'),
    ('D9223', 'Sedation +15 Min'),
    ('D9230', 'Nitrous'),
    ('D9430', 'Office Visit'),
    ('D9940', 'Nightguard'),
    ('D9944', 'Hard Nightguard'),
    ('D9945', 'Soft Nightguard'),
    ('M2018', 'Post-Op Check'),
    ('R0152', 'Perio Referral'),
    ('R0153', 'Endo Referral'),
    ('R0154', 'Ortho Referral')
)
update public.chart_tiles t
set label = n.label, updated_at = now()
from name_src n
where t.code_rule->>'type' = 'fixed'
  and t.code_rule->>'code' = n.proc_code
  and t.label <> n.label;
-- ---------------------------------------------------------------------
-- 5. Row-level security on the 3 CDT cleanup tables
--
-- These 3 came out of the CDT cleanup and were created without RLS, so
-- anyone holding the project URL and the public key could read, change or
-- delete every row. Supabase raised it as a critical alert on 23 August.
--
-- No policies at all is deliberate. Nothing in the app reads these tables,
-- so a policy would only be a way in. The service key ignores RLS, so the
-- Edge Functions and the cleanup work still reach them normally.
--
-- Do not add a policy here unless something in the app starts reading them.
-- ---------------------------------------------------------------------

alter table public.dos_code_names  enable row level security;
alter table public.dos_codenum_map enable row level security;
alter table public.dos_write_log   enable row level security;
commit;
