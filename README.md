# Dental OS — delivery pack, 2026-08-13

Paths below are relative to the repo root:
`C:\Users\shadm\dental-os-app\dental-os-app`

## What you need to do

Only the two frontend files need copying and pushing. Everything under
`supabase/` is **already applied or deployed** — those copies are for the
repo's history, so the code in git matches what is running.

| File | Action |
|---|---|
| `app/chart/page.tsx` | Replace. Chairside charting v5. |
| `app/tiles/page.tsx` | New file — create the `tiles` folder. |
| `supabase/**` | Copy in for the record. Nothing to run. |

Then commit and push; Vercel deploys from GitHub.

## Frontend

### `app/chart/page.tsx` — v5

- **v4** added the Today tab to the patient picker: one call returns the
  whole day already shaped, broken appointments are greyed and
  unopenable, and checked-in / in-chair / dismissed are derived from the
  arrival, seating and dismissal timestamps. It also fixed a real bug —
  the date was computed with `toISOString()`, which is UTC, and would
  have rolled the schedule to tomorrow every afternoon in California.
- **v5** takes a surname, a date of birth, or a patient number in one
  box, and names the provider on each schedule row rather than showing
  initials.

### `app/tiles/page.tsx` — v1

The admin screen behind the chairside tiles. Categories and tiles can be
created, renamed, reordered and deleted; each tile carries its code rule,
treatment area, delivery code, locations and add-ons.

Three choices worth knowing:

- Codes are picked from the synced OpenDental list, never typed. A typo
  here would be discovered at the chair.
- A new tile starts inactive but available at every location. Available
  nowhere would mean it silently never appears; live everywhere would put
  an unfinished tile in front of a clinician.
- A rule with an empty branch can be saved but not switched on, and the
  editor names which branch is missing.

## Edge Functions — already deployed

| Function | Version | Notes |
|---|---|---|
| `od-chart` | 5 | schedule / patients / open / commit / undo |
| `od-survey` | 2 | `procedure_mix`, `fee_lookup`. Read-only. |
| `od-chart-probe` | 9 | Discovery only. Safe to delete once its answers are in the handoff. |

## Migrations — already applied

| Migration | What it did |
|---|---|
| `010_tile_management.sql` | Moved the tile tree from office to organization; added treatment area, delivery codes, per-location availability and add-ons; rewrote RLS. |
| `011_seed_tiles.sql` | Replaced 009's tiles with 55 seeded from Greenwood's own six months of completed procedures. |
| `012_tidy_categories.sql` | Dropped Missing & Other from diagnosed; title-cased category names. |

## What the live data settled

These were measured against Downey and Maywood, not assumed:

- **The day loads in one call.** Reading appointment joined to patient
  and operatory took 305ms for 32 rows. The obvious alternative, one
  patient lookup per row, took 6.7 seconds for 31 — OpenDental serves
  those sequentially however they are fired, so concurrency is not a
  lever on this API.
- **`AptStatus` is an integer.** 1 is Scheduled and 5 is Broken,
  confirmed by matching the raw column against what REST returned. The
  rest of the enum is carried but flagged unverified.
- **The top 40 codes carry 91% of Downey's volume and 94% of Maywood's.**
  That is why the seed is 55 tiles rather than several hundred.
- **A crown is two procedures.** `D2751d` appeared 136 times at Downey
  beside `D2751`, tracking it closely.

## Still open

| Item | Waiting on |
|---|---|
| Fee split between prep and delivery | Parked. Denti-Cal runs as a flat-copay plan and uninsured patients carry no fee schedule, so no split rule is safe yet. Delivery lines post at zero. |
| Private / Cash patient pricing | The office's own process. |
| Showing the resolved fee schedule | The insurance → patient → provider chain. |
| Bridges | Abutments plus pontics priced per unit; left out rather than half-modelled. |
| Add-ons | None seeded. No code for porcelain margins appeared in either office's six months, and inventing one would put a code into OpenDental that Greenwood does not use. |
| User management | Default and permitted locations per user. |
| Nav link to `/tiles` | `TopNav.tsx` has no section for it yet. |
| Maywood code sync | `procedure_codes_cache` holds Downey's 1,151 codes only, so the picker is missing anything Maywood-only. |
