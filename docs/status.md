# Dental OS — session status log (newest first)

## 2026-09-18 ~19:55 PT — od-plan family-plan estimate fix, closed out

**What changed**
- `supabase/functions/od-plan/index.ts` → v12: the plan-money query's
  `LEFT JOIN patplan` now also requires `pp.PatNum = pl.PatNum`. patplan
  holds one row per covered family member per InsSubNum, so the old join
  multiplied every SUM (PriIns, PriBase, SecIns, WriteOff, DedApplied,
  EstRows) by family size. Seen live on patient 22838 (De Chavez): a
  $40.41 D2920 showed $161.65 insurance (5 × $32.33 exactly) and a
  patient portion of −$121.24 on the treatment-plan screen.
- The fix was deployed to Supabase as od-plan version 13 on 2026-09-05;
  the source was committed as 395dd2d and pushed to main on 2026-09-13.
  This session verified both are still in place and in sync.

**What was verified**
- Supabase `list_edge_functions`: od-plan ACTIVE at version 13, build
  hash matches the v12 deploy — nobody overwrote it since 2026-09-05.
- `git status` clean, `main` even with `origin/main`, HEAD = 395dd2d.
- Not verified end-to-end against Griselda's live chart: the Edge
  Functions require a logged-in user JWT the session doesn't have.
  Diagnosis rests on the exact 5× arithmetic; confirm on screen that
  her plan now shows $32.33 insurance / $8.08 patient per tooth.

**What is still open**
- FROM-CHAT-2026-09-18.md (od-production gross→net: subtract received
  write-offs, add procedure-attached adjustments in three queries) —
  spec only, no code changed. Two decisions still need Shad: unattached
  adjustments (ProcNum=0), and received-only vs estimated write-offs.
- FROM-CHAT-2026-09-18-B.md (consent forms on tablet, Topaz-matching
  signature storage) — research only; the gating question is whether
  the Sheets API can write a real SigBox FieldValue or only the
  "Digitally Signed by developer" text. Verify against live API first.
- Both FROM-CHAT files left in place; nothing in them was executed.

**Next step**
- Apply FROM-CHAT-2026-09-18 to od-production (after Shad answers the
  two open decisions, or defaulting to received-only write-offs and
  attached-only adjustments and saying so on the dashboard).
