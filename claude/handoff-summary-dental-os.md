# Handoff Summary — Dental OS / TC Charting

**Owner:** Shad
**Last updated:** 17 August 2026, end of the autho session
**Session focus:** The authorization process — how OpenDental records it, why it wasn't visible, and what the app should do about it. Ended with two things built and neither deployed.

---

## 1. How to work with me (always follow)

| Rule | Detail |
|---|---|
| Response length | Max 5 lines of prose per response |
| Content | Conclusion first, then a brief reason |
| Caveats | None, unless I ask for them |
| Format | Lists and tables over paragraphs, conversational tone |
| Instructions | 1–3 steps at a time; wait for "next" before continuing |
| Approval | Ask before every build, code change, or deliverable |
| Code delivery | **One file → deliver it alone and state the exact path it goes in. More than one → a zip with repo-correct paths.** Complete files always, never snippets |
| Uncertainty | Ask a question instead of guessing |
| Invention | Never invent file paths, function names, IDs, or data |
| Verification | Syntax-check every code file before delivery; state the check ran |
| Preference | If a data fix solves it, prefer that over a code fix |
| Naming | Reference records by human-readable identity, never internal record IDs |
| Versioning | Bump version + changelog on every build; diff results after to catch regressions |
| Voice/driving | Flowing sentences, no tables — I often connect from the car |
| Time estimates | Don't give them. Size work by shape |

**Session opening protocol:** ask for the module name if not given, ask whether this is a Cowork session (stop if yes), confirm the pack version before proceeding.

---

## 2. Current status

| State | Item | Note |
|---|---|---|
| **Built, not deployed** | `app/chart/page.tsx` **v18.5** | Autho dropdown removed; autho rows exempted from the accept flip and the `unpaired` guard. Confirmed working on Shad's local dev server. **Not pushed — Vercel still runs v18.4** |
| **Built, not deployed** | `supabase/functions/od-tp-probe/index.ts` **v1** | New throwaway probe answering H1–H5. Nothing written to OpenDental yet |
| Complete | Autho priorities un-hidden | Both offices, by Shad, 17 August |
| Complete | Autho investigation | See section 5 |
| Complete | Treatment plan structure investigation | See section 5 |
| Complete | Consolidated working list | `claude/working-list-tc-charting.md` — sections A–G |
| In progress | Fee schedule pipeline | Separate module. Not tracked here |
| Blocked | User management | Waiting on the clinician/hygienist role decision |
| Parked | Carrier bucketing query | Shad retrieving context from older chats |
| Backlog | Instructional video | Playwright demo + narration |
| Backlog | Tablet fleet rollout | 5 units (3 Downey, 2 Maywood) plus a floater. Two test units installed |

**Live defect:** production still blocks signing on any ticked autho row. v18.5 fixes it and is not deployed. This is the only thing on the list that is broken right now.

---

## 3. Next steps (prioritized)

1. **Deploy v18.5** — `npm run build`, then `_session-sync.bat`. Fixes the live signing defect. Nothing depends on it
2. **Answer D1 and D2** (section 9) — cheap, and they shape what the probe should test
3. **Deploy and run `od-tp-probe`** — `dry_run: true` first, then live on patient 17. Answers H1–H5
4. **Design C1 and C2** once the probe reports
5. **Build 8 Diag + 8 Acc priorities** at both offices — Shad's work in OpenDental, no code
6. **Trial all 19 priorities** in TC Charting before building a filter table for them
7. **DIAGS title row** — reflow fix and redesign, one pass
8. Everything else in section 3 of the working list

---

## 4. Key decisions

| Decision | Reason |
|---|---|
| **Authorization lives in OpenDental's priority list, not in a Dental OS control** | The office already records it there. Auth Needed / Auth Approved / Auth Denied were hidden, not deleted, and were un-hidden at both offices |
| **The app never overwrites an autho row's priority** | What a carrier decided is not the app's to change, and no accepted counterpart exists to move it to |
| **Autho labels matched by name (`/^auth\b/i`), never by DefNum** | Downey's 159 is Auth Denied; Maywood's 159 is Auth Approved. Same number, opposite answers |
| **`od-plan` stays at v9** | Its `set_note` action and `preauth` field are now dead but harmless, so v18.5 shipped with no Edge Function deploy and no deploy-order risk |
| **Deleting procedures from the app is wrong** | Replace with "make inactive" — TPi, which OpenDental already has |
| **A new small probe rather than reviving `od-chart-probe`** | That function turned out not to be deployed at all; its questions are all answered. 772 focused lines beat 1,400 stale ones |
| Never write PHI to the Dental OS database | OpenDental stays the single source of truth |
| Read `BaseEst`, apply only the annual maximum ceiling | Reimplementing OpenDental's full limitation engine is impractical |
| Deductible applied to the fee before the percentage | Matches OpenDental, verified against a live patient |
| Declined work stays at Diag | So it re-presents at the next visit |
| Diag→Acc pairing by name, not DefNum | The same DefNum means different things at each office |
| Badge shows the commit, not a version number | Supplied by Vercel, covers everything |
| Edge Function deploys go through the CLI | Mixing chat-side MCP deploys with CLI deploys caused drift before |
| Office letterhead comes from OpenDental | An office that moves updates the place it already maintains |
| The service worker caches nothing but an offline page | A caching worker would serve yesterday's JavaScript against today's Edge Function |

**Permanently rejected — do not re-propose:**
- Trusting the `// Version: N` header to establish what is deployed — only the deployed artifact is evidence
- **The preauth note token** (`"Autho Needed (DOS Entry)"`) as the authorization record — superseded by the priority field this session
- TPi as the **acceptance** mechanism — note that TPi as the **parking/declined** mechanism is a *different* proposal and is live on the list as C1
- Taking the old frontend down while a new one builds
- Reimplementing OpenDental's frequency limits, waiting periods, age limits and family accumulators
- Emailing signed treatment plans — HIPAA complexity
- The efax/scan lane of the fee schedule PDF pipeline
- Reading the `clinic` table for office details — empty on both servers
- Editing `preference.EmailSenderAddress` by hand — legacy, not exposed in OpenDental's UI

---

## 5. Standing facts & constraints

### Authorization in OpenDental

**There is no approved/denied field anywhere** — not on the claim, claimproc, procedure, plan or carrier. The answer is derivable in two steps:

| Signal | Field | Meaning |
|---|---|---|
| Did an answer come back? | `claim.ClaimStatus = 'R'` | Yes/no only |
| What was the answer? | `claimproc.InsEstTotalOverride` | Positive = approved at that amount · Zero = nothing allowed · −1 = never entered |

- **`InsPayEst` is NOT the answer field.** OpenDental pre-fills it at claim creation — 10,546 of 15,195 *unanswered* rows already carry a positive figure. Using it would have been wrong on two thirds of the data.
- **Accuracy good, coverage poor.** Against the office's own labels: Auth Approved 96.8%, Auth Denied 98.0%. But **8,012 of 9,573** flagged procedures sit on claims still at status `S` — sent, never marked received. Billers update the priority field and never touch the claim.
- **So the priority field is the real record; the claim chain is only a cross-check.**
- The link is exact: `procedurelog` → `claimproc` (`Status = 2`, `ClaimNum > 0`) → `claim` (`ClaimType = 'PreAuth'`). 100% of preauth claimproc rows carry a real `ProcNum`.
- Behavioural confirmation: 45% of "approved" procedures got completed vs 14% of "zero" ones.

### Autho priorities (definition Category 20)

| Office | Auth Needed | Auth Approved | Auth Denied |
|---|---|---|---|
| Downey | 613 | 256 | 159 |
| Maywood | 149 | 159 | 556 |

At Downey these still carry **11,632** treatment-planned procedures: 5,263 Auth Needed, 3,553 Auth Approved, 2,816 Auth Denied.

Downey visible list: Acc 1–4, Diag 1–4, Auth Approved, Auth Denied, Auth Needed, Optional Acc, Optional.
Maywood visible list: same **plus Not Accepted** (DefNum 150) — see open question D4.

Downey has hidden legacy priorities literally named `5`, `6`, `7`, `8` (DefNums 151, 156, 157, 158) holding 2,559 / 1,444 / 992 / 5 TP procedures. Relevant when creating Diag 5–8.

### Treatment plan structure

**The enum most people assume is wrong.** Verified against `Heading` on patient 17:

| `TPStatus` | Means | Membership held in |
|---|---|---|
| 0 | **Saved** — 6,320 legacy frozen plans | `proctp` |
| 1 | **Active** | `treatplanattach` |
| 2 | **Inactive** | `treatplanattach` |

- **One Active plan per patient:** 14,581 of 14,585. Four old exceptions.
- **Membership cross-tab at Downey:**

| Procedure status | Plan status | Rows |
|---|---|---|
| TP (1) | Active | 111,427 |
| TP (1) | Inactive | 5,464 |
| TPi (8) | Inactive | 21,457 |
| TPi (8) | **Active** | **0** |

- **TPi (`ProcStatus 8`) is in long-standing production use** — 20,073 procedures at Downey, **all** attached to a plan, **none** on an Active plan. The invariant is absolute.
- A procedure can be attached to two plans at once — ProcNum 1082014 sits on both.
- `/treatplanattaches` is a valid API resource and GET works. `/treatplanattachs` 404s.

### What the app does with all of this today

**Nothing.** `treatplan`, `treatplanattach`, `TPStatus` and `proctp` appear in the codebase only as four comments explaining why they aren't used. "Create TP" builds a PDF and files a Supabase record; OpenDental never learns a plan was presented.

**The app's visibility filter is `ProcStatus`, not plan membership.** A TP procedure on an Inactive plan still shows (5,464 of them at Downey). Only TPi hides a procedure.

### Environment

- **OpenDental is the source of truth** for clinical, financial and letterhead data
- **Two separate OpenDental servers** (Downey, Maywood), distinct API keys and internal numbering
- **`od_probe` is read-only by design** — GET, or PUT to `/queries/ShortQuery`. It refuses everything else. This is why write questions need a deployed function
- **Frontend and Edge Functions reach production by different roads.** Frontend deploys on push; Edge Functions only on an explicit CLI deploy
- **Deploy the Edge Function before the frontend that depends on it**
- **A failed Vercel build is never an outage** — the previous deployment stays live
- **`_session-sync.ps1` does not run `npm run build`.** Building is on Shad, before running it
- Auth header format: `ODFHIR {DeveloperKey}/{CustomerKey}`
- Roles: `owner_admin` (10), `biller` (20), `front_desk` (30). Clinician/hygienist undecided
- Anything scanning the project root needs `_sync` excluded explicitly

### OpenDental API verified behaviours

- `POST /procedurelogs` requires `procCode` (CDT string), not `CodeNum`
- `POST /procedurelogs` refuses `EC` — the message names TP, C and EO only. `EO` is the known compromise
- `GET /providers` paginates at 100 rows with overlap — deduplicate by `ProvNum`
- `/fees` requires `?FeeSched=`, not `?FeeSchedNum=`
- Deleting a TP procedure is a **soft** delete — the row stays and moves to `ProcStatus 6`
- `ShortQuery` caps a page at 100 rows; `?Offset=` advances
- **This API has accepted values with 200 and kept its own on at least four fields.** Always read back from the database

---

## 6. Key IDs, files & locations

| Item | ID / Path | Notes |
|---|---|---|
| Frontend repo | `shadmanavi/dental-os-app` | Auto-deploys to Vercel on push |
| Local project | `C:\Users\shadm\dental-os-app\dental-os-app` | Dev/test copy |
| Live app | `https://dental-os-app.vercel.app/` | Build badge top-right of the nav |
| Local dev server | `npm run dev` → `http://localhost:3000/chart` | Ctrl+C to stop. Clear `.next` if stale |
| Supabase project | `mjctkqoggqrgciufqcvd` | Org `1bad5d52-c311-43ba-9a35-28757da059ca` |
| App login | `shadmanavi@gmail.com` | |
| Session sync | `_session-sync.bat` + `_session-sync.ps1` | Run at handoff. Does **not** build |
| Sync secrets | `_session-sync.secrets.txt` | Git-ignored. Holds `SUPABASE_DB_PASSWORD` |
| Latest pack | `_sync\latest\dental-os-pack.txt` | Upload to the next chat |
| Working list | `claude\working-list-tc-charting.md` | Sections A–G, created this session |
| `od_probe` | SQL function in Supabase | **Read-only.** GET or PUT to ShortQuery only |
| `od_sync_offices()` | SQL function in Supabase | Re-runnable letterhead sync |
| Sandbox patient | **PatNum 17** — Manavi, Shad, Downey | Approved for probe writes |
| Other test patient | PatNum 32569 — Manavi-insurance, Shad | 21 TP procedures. Benefit allocation was proved against this one |

**Live Edge Functions — 12, not 13.** `fee-schedule-push`, `fee-schedule-stage`, `od-benefit-probe`, `od-chart`, `od-create-fee-schedule`, `od-list-fee-schedules`, `od-plan`, `od-seed-fee-schedule`, `od-survey`, `od-sync-procedure-codes`, `od-test-connection`, `od-tp-doc`.

**`od-chart-probe` is NOT deployed** — "Function not found". It exists in the repo only.

**`od-plan` is at v9**, both deployed and in the pack — not v8 as previously recorded.

---

## 7. Recent changes

| File | Change | Why |
|---|---|---|
| `app/chart/page.tsx` | v18.4 → **v18.5** | See below |
| `supabase/functions/od-tp-probe/index.ts` | **New, v1** | Answers H1–H5 |
| `claude/working-list-tc-charting.md` | New | Consolidated list |
| OpenDental, both offices | Auth Needed / Approved / Denied un-hidden | Shad, in OpenDental |
| OpenDental, patient 17 | 8 procedures moved to TPi at 12:58 | Shad, testing the inactive flow |

**v18.5 in detail:**

| Area | Change |
|---|---|
| Per-row Autho dropdown | Removed |
| Bulk Pre-Auth / Un-Pre-Auth button | Removed |
| `setRowPreauth`, `preauthMode`, preauth branches in `runPendingAction` and the confirm dialog | Removed |
| `PlanRow.preauth`, `PendingAction.preauth` | Removed from the types |
| `AUTH_RE = /^auth\b/i` + `isAuthLabel` | **New** |
| `signAndFile` → `unpaired` guard | Autho labels exempt — **this is the live-defect fix** |
| `signAndFile` → `toFlip` | Autho labels excluded explicitly |

Built with a 14-edit asserted-replacement script (each must match exactly once), verified by a 32-check structural verifier, and type-checked with `tsc --noEmit` against the real `tsconfig.json` with real dependencies installed — 0 errors. The type check was proved non-vacuous by deliberately breaking a signature and confirming it threw.

`od-tp-probe` verified the same way: `tsc --noEmit` strict with a Deno shim (0 errors, sanity-checked), plus 17 structural checks.

---

## 8. Active assumptions

- v18.5 is on Shad's disk and running on his local dev server — confirmed by him after a `.next` cache clear
- Vercel still runs v18.4
- Patient 17 currently has **1** procedure at TP (D2950 #20 core buildup) and **8** at TPi
- Patient 32569 has 21 procedures at TP, none at TPi
- `procedure_codes_cache` holds 1,151 rows, 25 priced
- Sandbox fee schedule "Dental OS TEST 001" exists at Downey
- Tablet fleet target is 5 units plus a floater. Two test tablets: iPad A16 on iPadOS 26, Galaxy Tab A11+
- The pack in use was commit `e458f8c`, packed 17 August 11:24 — **it predates v18.5 and `od-tp-probe`**

---

## 9. Open questions

**Blocking design work:**

| # | Question |
|---|---|
| D1 | Confirm TPi-as-parking is distinct from "TPi as the acceptance mechanism", which is on the rejected list |
| D2 | A TPi procedure vanishes from TC Charting — `od-plan` reads `ProcStatus = 1` only. Show it dimmed, or hide it? This conflicts with "declined work re-presents at the next visit", and patient 17 is a live example: a $497 endo and two $683 crowns have silently left the presenting surface |
| D3 | What should accepting an autho procedure do, especially a **denied** one? Three options were tabled; the cheapest is adding `Auth Approved Acc` etc. to both offices, which needs no code at all |

**Not blocking:**

| # | Question |
|---|---|
| D4 | Maywood shows "Not Accepted" as visible; Downey hides it. Deliberate? |
| D5 | Clinician/hygienist role — separate role, or front desk with a different tile set? Should they see insurance figures? |
| D6 | Carrier bucketing query — buckets, and is it still live? |
| D7 | `od-benefit-probe` — delete or keep? |
| D8 | Tidy the mixed-format migration filenames? |
| D9 | Should the plan print a website? OpenDental holds none on either server |

**Answered only by the probe (H1–H5):** see section 11.

---

## 10. Errors & resolutions

| Error | Fix | Lesson |
|---|---|---|
| Autho dropdown still showed after installing v18.5 | Stale `.next` cache — stop dev server, `Remove-Item -Recurse -Force .next`, restart, hard-refresh | `npm run dev` compiles lazily; a code change is not a screen change |
| I listed the NULL `statements` migration rows as an **urgent** risk | Checked `supabase_migrations.schema_migrations` — all 18 rows hold real SQL. Already repaired in a later session than the handoff described | **Read the database, not the handoff.** This is the exact mistake that document warns about |
| Recorded as 13 live Edge Functions including `od-chart-probe` | `list_edge_functions` returns 12; `od-chart-probe` is "Function not found" | The deployed artifact is the only evidence |
| Recorded `od-plan` as v8 | Fetched the deployed source — header says v9, and the pack matches | Same lesson |
| Assumed `TPStatus` was Active=0, Inactive=1, Saved=2 | Read `Heading` on a live patient: Saved=0, Active=1, Inactive=2 | Enum order is not guessable |
| Assumed `InsPayEst` held the carrier's answer | Census showed it pre-filled on 10,546 unanswered rows. `InsEstTotalOverride` is the real field | A populated field is not an answered field |
| Tried to POST through `od_probe` | It raised "od_probe is read-only" | A good guardrail, working as designed |
| Overweighted the priority-field overloading as a design problem | Shad pointed out the office has worked that way since 2008; 11,632 rows prove it. The real issue was one undefined branch in the accept flow | Distinguish "this offends the model" from "this breaks something" |

---

## 11. Start here next session

**Upload first:** `_sync\latest\dental-os-pack.txt` — but only if `_session-sync.bat` has been run since this session ended. If it hasn't, the pack is commit `e458f8c` and does **not** contain v18.5 or `od-tp-probe`. Also upload `claude/working-list-tc-charting.md`.

**Then, in this order:**

1. **Deploy v18.5.** `npm run build`, then `_session-sync.bat`. It fixes the only thing currently broken in production
2. **Answer D1 and D2** — they shape the probe
3. **Deploy `od-tp-probe`** via CLI, run with `{"office":"downey","pat_num":17,"dry_run":true}` first, then live

**The five probe questions:**

| # | Question | Blocks |
|---|---|---|
| H1 | Does `PUT /procedurelogs/{n}` accept `ProcStatus` TPi? String and numeric both tried | C1 |
| H2 | Does `/treatplanattaches` accept POST and DELETE? *Skipped if H5 is yes* | C1, C2 |
| H3 | Can an Active plan be created or promoted via API? Prior finding: POST files everything Inactive and PUT won't move it | C2 |
| H4 | Does OpenDental auto-create the Active plan? | C2 |
| H5 | **When a procedure goes TPi, does OpenDental write the attach row itself?** Cheapest question, most valuable answer — if yes, C1 is one call not two | C1 |

**Probe safety notes:** it creates one throwaway `D0230` on patient 17 and possibly one plan headed `DOS PROBE - SAFE TO DELETE`. Cleanup runs in a `finally` even on exception. Whether `/treatplans` accepts DELETE is itself unknown — if it doesn't, the response carries `manual_step_required` and the plan must be deleted in OpenDental by hand.

**Standing rule that earned its keep this session:** download and diff the deployed Edge Function before editing it, every time, whatever the version header says. Doing so is what caught the `od-chart-probe` and `od-plan` errors above.
