-- =====================================================================
-- 022 — Partial denture tiles
--
-- Records what was applied to the live database by hand on
-- 14 September 2026, so the repo and the database agree.
--
-- Four tiles in the diagnosed Dentures category, offered at both
-- offices. TreatArea 7 (tooth range): charted on the teeth the partial
-- replaces, written by od-chart v16 from the teeth lit on the tablet.
-- Each pairs with a delivery code that posts at zero, like the
-- complete-denture tiles above them. The three delivery codes that did
-- not exist (Downey D5211d, Downey D5212d, Maywood D5212d) were
-- created in OpenDental the same day through a one-off Edge Function,
-- since deleted.
--
-- Idempotent: a tile that already exists is left alone.
-- =====================================================================

with cat as (
  select id from chart_categories
  where label = 'Dentures' and bucket = 'diagnosed'
),
wanted (label, rule, sort, dcode) as (
  values
    ('Upper Metal Partial', '{"code": "D5213", "type": "fixed"}', 50, 'D5213d'),
    ('Lower Metal Partial', '{"code": "D5214", "type": "fixed"}', 60, 'D5214d'),
    ('Upper Resin Partial', '{"code": "D5211", "type": "fixed"}', 70, 'D5211d'),
    ('Lower Resin Partial', '{"code": "D5212", "type": "fixed"}', 80, 'D5212d')
),
ins as (
  insert into chart_tiles
    (category_id, label, entry_kind, initial_type, needs_surfaces,
     code_rule, sort_order, is_active, treat_area, delivery_code,
     delivery_posts_at_zero)
  select cat.id, w.label, 'procedure', null, false,
         w.rule::jsonb, w.sort, true, 7, w.dcode, true
  from cat, wanted w
  where not exists (
    select 1 from chart_tiles t
    where t.category_id = cat.id and t.label = w.label
  )
  returning id
)
insert into chart_tile_offices (tile_id, office_id)
select ins.id, o.id from ins cross join offices o
on conflict do nothing;
