# Handoff Summary — Dental OS

**Owner:** Shad
**Last updated:** August 16, 2026
**Session focus:** v16.1 → v17 shipped; preauthorization status probed to a conclusion; the annual-maximum problem found, researched against OpenDental's source, and solved.

---

## 1. How to work with me (always follow)

| Rule | Detail |
|---|---|
| Response length | Max 5 lines of prose per response |
| Content | Conclusion only — not the reasoning behind it |
| Caveats | None, unless I ask for them |
| Format | Lists and tables over paragraphs |
| Instructions | 1–3 steps at a time; wait for "next" before continuing |
| Approval | Ask before every build, code change, or deliverable |
| Code delivery | Complete files only — never snippets or edit-in-place instructions |
| Uncertainty | Ask a question instead of guessing |
| Invention | Never invent file paths, function names, IDs, or data |
| Verification | Syntax-check every code file before delivery; state the check ran |
| Preference | If a data fix solves it, prefer that over a code fix |
| Naming | Reference records by human-readable identity, never internal record IDs |
| Versioning | Bump version + changelog on every build; diff results after to catch regressions |
| **Edge Functions** | **Fetch the deployed source before editing. The repo copy may be stale — this cost us an hour today.** |

---

## 2. Current status

| State | Item | Note |
|---|---|---|
| Complete | `app/chart/page.tsx` v17 | Built, PC-tested, pushed. Signature pad, Preview, Print, Optional Acc pairing, D0001 hidden |
| Complete | `lib/treatmentPlanPdf.ts` v3 | Presenter signature line removed; date moved to header; centre date removed |
| Complete | `lib/benefitAllocation.ts` v2 | **Matches OpenDental row-for-row on patient 32569.** Not yet wired into anything |
| Complete | `od-plan` v8 | Deployed. BaseEst, benefits, category deductibles, `lists` action, one union query |
| Complete | Probe cleanup | `od-claim-probe`, `od-chart-probe`, `od-tp-probe`, `od-proc-probe` all deleted |
| In progress | Benefit allocation wiring | `benefitAllocation.ts` exists and is proven; `page.tsx` and the PDF do not call it yet |
| Blocked | Everything OpenDental-timed | API was returning 7–10s per call after midnight. Almost certainly a maintenance window — **re-measure before judging any performance work** |
| Not started | Tablet testing | iPad A16 and Galaxy Tab A11+ in hand. v17 never opened on either |
| Not started | PWA wrapper | Was called "v16.1" in the hardware session — **renumber to v19** |

---

## 3. Next steps (prioritized)

1. **Re-measure OpenDental API speed.** Run the three-call timing test (§6) before any other decision. Last night: plan-with-lists 35.9s, plan-without-lists 20.8s, lists-only 10.1s. `lists` is two indexed queries returning 20 rows — 10s for that is not our code.
2. **Tablet-test v17** on both devices. Watch the Search tab keyboard on iPad specifically, and the four bulk controls fitting in the title row at ~960px.
3. **v18 — wire benefit allocation + list stability.** Scope agreed, see §4.
4. **v19 — PWA wrapper.** Scope carried from the hardware session, see §4.
5. Doctor-signing rule for treatment plans — needs a decision from Shad, not a build.
6. Read filed PDFs back from OpenDental for later viewing — parked at the bottom, deliberately.
7. Maywood procedure code sync (zero tiles seeded).
8. Seven unbucketed carriers in the scheduled production SQL (United Concordia, Cigna, Anthem, Aetna, Principal, Assurant, United Health Care) — resolves the 104 vs 111 recall reconciliation gap.

---

## 4. Key decisions

| Decision | Reason |
|---|---|
| **Dental OS applies the annual maximum itself, over OpenDental's own per-procedure estimates** | OpenDental caps estimates only when its Windows client recalculates. Nothing in the API triggers it. So stored figures are correct for the last ordering a human looked at, and silently wrong after any chairside change |
| Use `claimproc.BaseEst` as the uncapped figure | OpenDental's `ComputeBaseEst` finishes BaseEst and states in source that it is not altered further; the maximum is applied after and writes only `InsEstTotal`/`InsPayEst`. BaseEst therefore survives on rows the maximum zeroed |
| Deductible comes off the **fee**, then the percentage | OpenDental's own order. Off the estimate instead gives $124.50 where OD gives $149.50 on a $349 crown |
| Category deductible waivers are read, never assumed | A plan states "$50, but $0 for Diagnostic and Preventive" as one benefit row per category. Without reading them a $13 x-ray absorbs the deductible and the crown does not |
| Rows with a hand-typed override pass through untouched | A number a person typed is not this app's to recompute. `-1` is OpenDental's "no override" |
| Preauthorization is two independent axes | **Order** (our note, "Autho Needed (DOS Entry)") and **Status** (OpenDental's claim). They coexist — a denial plus a fresh order is normal. The note is never replaced by the badge |
| Preauth status badge shows **Waiting / Sent / Auth $X / Received–no amount** | Never the word "denied" — the data cannot support it, see §5 |
| Frozen display order; Refresh re-sorts | Rows must not move under the coordinator's finger while they work |
| Deleted rows show a **Deleted flag**, disappear on refresh | Strike-through explicitly rejected by Shad |
| Procedure creation stays synchronous, outside the write queue | The ProcNum must return before anything can edit that row |
| Renumber the PWA wrapper to **v19** | The hardware session planned it as "v16.1" without knowing v16.1, v16.2 and v17 already shipped |

**Permanently rejected — do not re-propose:**
- **Reimplementing OpenDental's estimate engine.** `GetLimitationByCode` is ~380 lines and needs full claim history, family accumulators, code ranges, frequency limits, waiting periods and age limits. Two engines that must agree forever, failing silently.
- **Writing `InsEstTotalOverride`.** Overrides are permanent until cleared and stop OpenDental calculating those rows. If our logic is ever wrong it is wrong in writing, in production.
- **Warning-only ("estimates may be stale").** Rejected by Shad as unworkable at the chair.
- **Routing over-max plans away from the tablet.** Removes the tablet from the cases where it is most useful.
- **Timed flush (every 30s) for the write queue.** Widens the drift window; timers freeze when the tablet sleeps.
- **Service Worker Background Sync.** Only works by persisting the queue. PHI rules it out.
- **Email of treatment plans.** Portal WebMail dead (portal unusable); Secure Email is a paid add-on; unsecured needs documented warn-plus-consent per patient. Compliance cost exceeds the benefit for now.
- **Safari/iOS polyfills.** The "white screen below Safari 16.4" belief is **wrong**. New iPad on iPadOS 26.5 runs the app fine; the original failure was navigating to a route without going through `/login`.
- **Strike-through for deleted rows.**
- **TPi as a mechanism** for declined work — it stays at Diag so it re-presents.

---

## 5. Standing facts & constraints

**The annual maximum — the session's central finding**
- OpenDental stores capped estimates but only recalculates inside its Windows client. Triggers: opening the Treatment Plan module, saving from Procedure Info, Recalculate Estimates on a claim.
- **The API has no recalculate endpoint.** The published resource list has none, and `ChartModules` offers only `ProgNotes`, `PatientInfo`, `PlannedAppts`.
- Measured on patient 32569 (Downey): estimates summed to **$2,078.20** against a **$1,500** maximum. Opening the TP module wrote $1,500 back, and it held after closing.
- The Treatment Plan module's "Use Ins Max and Deduct" checkbox is a *display* option, but the recalculation it triggers **is persisted**.
- Plan order = `definition.ItemOrder`, unprioritised last, then ProcDate, then ProcNum. Confirmed against `Procedures.GetOrdered` in source. **This is also the order benefit is consumed in.**

**Preauthorization — probed to conclusion, both offices**
- `ClaimType = 'PreAuth'` exists and is spelled identically at both. Downey 7,689, Maywood 4,320.
- ClaimStatus: `W` waiting to send, `U` unsent, `S` sent, `R` received.
- Procedures attach richly — 1 to 32 per claim. **Per-procedure status is viable.**
- **Partial approval is real**: claim 99670 returned D6010 at $1,084 and D6104 at $0 on the same day. A claim-level badge would be wrong.
- **`claimproc.Status` is 2 on all 33,934 preauth rows and never moves.** `DateCP` is empty. Neither can carry approved/denied.
- **"Denied" is not recordable from the data.** Downey: 3,494 of 6,725 received rows read `InsPayEst` 0. Remarks exist on 2%. `"Allowed amount $99.00"` appears with zero amount; `"DENIED"` appears *with* an amount. `PreAuthString` populated 0 of 2,124.
- `DateSent` is populated even on `W` and `U` claims — cannot be trusted to mean sent.
- Turnaround buckets: 0–7 357, 8–14 612, 15–30 333, 31–60 87, **60+ 727**. The 60+ bulge is almost certainly stale unclosed claims, not slow carriers. Do not build a "late" indicator on this.

**OpenDental API verified behaviours (cumulative)**
- `POST /procedurelogs` requires `procCode` (CDT string), not `CodeNum`; `EC` not accepted on POST/PUT — using `EO` as a knowing compromise.
- `GET /providers` paginates at 100 with overlapping pages; dedupe by `ProvNum`.
- `GET /procedurelogs/{id}` and `/treatplans/{id}` ignore the path ID and return the whole collection — use ShortQuery.
- `GET /definitions?Category=` silently ignores the filter.
- Queries containing "SCHEMA" are refused — `information_schema` unreachable.
- `/fees` requires `?FeeSched=`, not `?FeeSchedNum=`.
- ShortQuery paginates at 100; `Offset` advances.
- **OpenDental serialises API calls.** N calls is N waits. This is why round-trip count matters more than query complexity.
- No native flag anywhere for "requires preauthorization" — the procedure note is the agreed workaround.
- Deleting a planned procedure is a soft delete to `ProcStatus 6`.
- `od-chart` calls the field `procCode`; `od-plan` calls it `proc_code`. Filtering the wrong one fails silently.

**Office info available from OpenDental** (Downey; Maywood is a separate server)
- `PracticeTitle` "Dental Masters & Ortho (Downey)", address 12156 Lakewood Blvd, Downey CA 90242-2658, phone 562-803-1600, fax 562-392-8661.
- **No website field exists.** Would have to be a Dental OS setting.
- No clinics configured — practice-level preferences only.

**Architecture (unchanged)**
- Diag/Acc pairing by name at runtime, never DefNum — the same DefNum means different things at each office.
- Now generalised: `X` pairs to `X Acc`, alongside `Diag N` → `Acc N`.
- Declined work stays at Diag so it re-presents next visit.
- Fee chain: insurance plan fee schedule first, then patient record; never provider-specific.
- Paired tile fees: read full fee, halve in whole cents, remainder to base line.
- **No PHI persisted in the Dental OS database.** Signature and PDF blob are memory-only, cleared with the patient.
- RLS policies one command per operation type — never `FOR ALL`.

---

## 6. Key IDs, files & locations

| Item | ID / Path | Notes |
|---|---|---|
| Supabase project | `mjctkqoggqrgciufqcvd` | |
| Frontend | `https://dental-os-app.vercel.app/` | GitHub `shadmanavi/dental-os-app`, auto-deploys |
| Local repo | `C:\Users\shadm\dental-os-app\dental-os-app` | |
| Offices | `downey`, `maywood` | Separate OD servers, separate keys, separate definition numbering |
| Test patient (no insurance) | PatNum 17 | Shad's own record, Downey |
| **Test patient (insurance)** | **PatNum 32569** | Delta Dental CA, $1,500 max, $50 deductible, crowns 50%. **The record that proved the allocation** |
| Deployed Edge Functions | `od-plan` v8, `od-chart` v10, `od-tp-doc` v1, `od-survey` v5, `od-list-fee-schedules` v3, `fee-schedule-stage` v3, `fee-schedule-push` v2, `od-create-fee-schedule` v2, `od-seed-fee-schedule` v1, `od-sync-procedure-codes` v2, `od-test-connection` v1 | `od-chart` is v10, not v6 as older handoffs said |
| Supabase CLI | Now logged in | `npx supabase functions deploy od-plan --project-ref mjctkqoggqrgciufqcvd` |

**API timing test — run this first tomorrow:**
```js
(async () => {
  const raw = document.cookie.split('; ').find(c => c.startsWith('sb-mjctkqoggqrgciufqcvd-auth-token='))?.split('=').slice(1).join('=');
  let v = decodeURIComponent(raw); if (v.startsWith('base64-')) v = atob(v.slice(7));
  const jwt = JSON.parse(v).access_token;
  const call = async (label, body) => {
    const t = performance.now();
    const r = await fetch('https://mjctkqoggqrgciufqcvd.supabase.co/functions/v1/od-plan', {
      method:'POST', headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},
      body: JSON.stringify(body) });
    const d = await r.json();
    console.log(label, Math.round(performance.now()-t)+'ms', 'rows:', d.count ?? (d.priorities||[]).length);
  };
  await call('plan WITH lists   ', { office:'downey', action:'plan', pat_num:32569 });
  await call('plan WITHOUT lists', { office:'downey', action:'plan', pat_num:32569, include_lists:false });
  await call('lists only        ', { office:'downey', action:'lists' });
})();
```
Baseline to beat: 35.9s / 20.8s / 10.1s (measured during a suspected maintenance window).

---

## 7. Recent changes

| File | Change | Why |
|---|---|---|
| `app/chart/page.tsx` | **v16.1** — master checkbox to front of title row; "Diagnosed or Incomplete" → "Diags"; autho marker blue → amber pill | Checkbox was floating mid-row via `ml-auto` in a wrapping flex; red reserved for denials |
| `app/chart/page.tsx` | **v16.2** — per-row Autho dropdown; Dx unhidden below `xl`; bulk bar reordered to match column order | v16 hid Dx below 1280px, leaving the tablet with no diagnosis control at all |
| `app/chart/page.tsx` | **v17** — SignaturePad mounted; Preview + Print via shared `buildPdf`; blob revoked on replace and patient close; filed doc named "Signed"/"Unsigned"; `X`→`X Acc` pairing; D0001 hidden | Signature pad existed since v15 and was never wired |
| `lib/treatmentPlanPdf.ts` | **v3** — presenter signature line removed; date under presenter in header; centre date removed | A ruled line with a typed name above it reads as a signature nobody gave |
| `lib/benefitAllocation.ts` | **NEW v2** — pure function, no I/O | Applies the remaining annual maximum over OpenDental's own BaseEst |
| `supabase/functions/od-plan/index.ts` | **v7** — BaseEst, EstimateNote, override flag, benefits, category deductibles, per-row coverage category | The data the ceiling needs |
| `supabase/functions/od-plan/index.ts` | **v8** — three ceiling queries folded into one union; `lists` action added; `include_lists` flag | v7 took patient-open from 4 OD calls to 7; v8 brings it to 3 |

---

## 8. Active assumptions

- **Last night's API slowness was a maintenance window, not our code.** Basis: `lists` — two indexed queries, 20 rows — took 10s, which no query plan explains. Downey's Windows client was reportedly fast. **Verify before acting.**
- Benefit year = calendar year. `TimePeriod 2` is what both offices use. Service-year plans are not handled.
- `deductible_used` is reported as 0 rather than derived. The old query double-counted it against `paid_this_year`.
- Secondary insurance passes through as OpenDental left it — the ceiling is applied to the primary only, and flagged.
- The category deductible waiver (Diagnostic/Preventive at $0) is per plan and read per patient — not a universal rule.
- `covspan` first-match-wins mirrors how OpenDental resolves a code to a category.

---

## 9. Open questions

- **Should a doctor sign the treatment plan, and at what point?** No signature block is drawn for one until this is answered.
- The 727 preauth claims sitting at 60+ days — stale and unclosed, or genuinely outstanding? Blocks any "overdue" indicator.
- `DedApplied` reads 0 on rows where OpenDental's screen clearly shows a $50 deductible applied. Not needed for allocation (we compute it), but unexplained.
- Should the write queue's Refresh button signal staleness (e.g. turn amber) once a priority has changed?
- Website for the PDF header — Dental OS setting, since OpenDental has no field for it?

---

## 10. Errors & resolutions

| Error | Fix | Lesson |
|---|---|---|
| **Built od-plan v7 on the stale local v5 instead of the deployed v6** | Fetched deployed source, reapplied all 6 v6 deltas, verified 11 v6 features present | **Fetch deployed source before editing any Edge Function.** I flagged this exact drift at session start and then walked into it. Deploying would have broken the pre-auth toggle silently |
| `Cannot access 'officeLabel' before initialization` | Moved `buildPdf`/`openPdf` below all their dependencies | Hook order must be checked in **both** directions — after dependencies, before consumers. My checker only tested one |
| Deleted `unpaired` declaration while leaving its use | Restored with a defensive filter | Asserted-replacement catches bad matches, not orphaned references |
| Chart filter used `proc_code` where `od-chart` returns `procCode` | Corrected to `procCode` | Would have compiled, run, and hidden nothing |
| Allocation gave x-rays $0 instead of $13 | Read category deductible waivers | Totals matched OpenDental while every row was wrong — the errors cancelled |
| Allocation gave the crown $124.50 vs OD's $149.50 | Deductible off fee, then percentage | The source comment said this and I implemented it backwards |
| od-plan v7 tripled patient-open latency | v8 union + `lists` action | OpenDental serialises calls. Round-trip count is the cost, not query complexity |

---

## 11. Start here next session

1. **Run the API timing test in §6.** Everything else waits on knowing whether last night was a maintenance window.
2. If timings are normal: **tablet-test v17** on the iPad A16 and Galaxy Tab A11+. iPad Search-tab keyboard is the headline check.
3. Then build **v18** — benefit allocation wiring:
   - `page.tsx` calls `lists` once on office load, passes `include_lists: false` on plan
   - `allocateBenefit` feeds the plan totals and the PDF, labelled as an estimate with the remaining maximum stated
   - Frozen display order; Refresh re-sorts
   - Deleted rows show a **Deleted** flag, gone on refresh, excluded from the PDF
   - Write queue: optimistic UI, coalescing per `(procNum, field)`, immediate flush, sequential drain, amber pending dot, red revert with on-row retry, queue count while draining, no success tick, block patient-switch while non-empty
   - If OpenDental is still slow, add a **Calculate** button rather than fetching benefit data on every open
4. Then **v19** — PWA wrapper (from the hardware session, renumbered):
   - `app/manifest.ts` — name, short_name, icons, `display: standalone`, theme_color, `start_url: /login`
   - `app/layout.tsx` — `appleWebApp` metadata + apple-touch-icon link
   - `public/icons/` — 192×192, 512×512, 180×180 PNGs
   - iOS ignores manifest `display`; standalone on iPad needs the Apple meta tags
   - **No service worker.** Offline caching against live OpenDental data is a separate decision
5. Then order the remaining fleet units (3 Downey, 2 Maywood, 11" class).

**Re-upload before starting:** the source pack (full repo including `supabase/functions/`), and this document.

**Do not carry forward:** the "white screen = Safari below 16.4" belief, and the hardware session's "v16.1 = PWA" numbering.
