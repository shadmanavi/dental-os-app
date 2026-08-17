# Handoff Summary — Dental OS

**Owner:** Shad
**Last updated:** 17 August 2026
**Structure:** Part 1 is common to every module and is the only place a shared fact belongs. Part 2 holds one
block per module. Part 3 is how to open a session.

**Open a session by naming the module** — *"this session is TC Charting only"* — and touch nothing outside
what that block owns, plus the shared items in the ownership map.

---
---

# PART 1 — COMMON

Applies to every module. Do not copy any of it down into a module block; when it changes, it changes here.

## 1.1 What Dental OS is

Dental OS automates tasks in dental offices. It is a custom chairside and practice-management overlay on top
of OpenDental, used by staff — treatment coordinators, billers, front desk — on tablets and PCs.

It is built as a multi-tenant product. **Tenant #1 is Greenwood Dental Services**, which operates two
offices, Downey and Maywood, on two separate OpenDental servers. Other practices or companies may become
tenants later.

**Who owns Dental OS is undecided.** Shad is developing it personally and is the owner of Greenwood. Greenwood
owns the two Dental Masters offices. The question stops being cosmetic when a practice outside Greenwood
becomes a tenant, or if it matters whose resources built the software — both are questions for an attorney
and a CPA, and both can wait until a third tenant is real.

**Naming:** the app displays "Dental Masters & Ortho", which is OpenDental's `PracticeTitle` and what staff
already recognise. Greenwood is the tenant record, not the on-screen name.

**Vocabulary:** Dental OS is the product. Its parts are **modules**, not projects. "Project" was previously
used for both and is retired.

## 1.2 How to work with me (always follow)

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
| Voice/driving | Flowing sentences, no tables — I often connect from the car |
| Time estimates | Don't give them. They have proven unreliable. Size work by shape |
| Deliverables | A zip with repo-correct paths beats loose files |

## 1.3 Module ownership map

A session may touch its own module's files freely. Shared items are declared at the top of the session
before they are touched, and only one live session owns them at a time.

| TC Charting owns | Fee Schedules owns | Shared — declare first |
|---|---|---|
| `app/chart/*` | `app/fee-schedules/*` (incl. `uploads`, `review/[id]`) | `procedure_codes_cache` |
| `lib/benefitAllocation.ts` | `fee-schedule-push`, `fee-schedule-stage` | `offices`, roles and auth |
| `lib/treatmentPlanPdf.ts` | `od-create-fee-schedule` | `od_probe`, `od-test-connection` |
| `od-plan`, `od-chart`, `od-chart-probe`, `od-tp-doc` | `od-list-fee-schedules`, `od-seed-fee-schedule` | Migration history, `_session-sync` |
| `od-benefit-probe`, `od-survey` | `od-sync-procedure-codes`, migration 008 | PWA shell, nav, layout |
| Migration 009 and the `chart_*` tables | | |

**The one place the modules meet:** pricing flows Fee Schedules → `procedure_codes_cache` → TC Charting
estimates. That is the contract between them, and neither side redesigns it alone.

## 1.4 Standing facts & constraints

- **OpenDental is the source of truth** — clinical, financial, and now the office letterhead.
- **Never write PHI to the Dental OS database.** Read live, pass to the browser.
- **Two separate OpenDental servers** (Downey, Maywood), distinct API keys and internal numbering.
- **Multi-tenant is real but undeveloped.** Two offices under one tenant today; the model gets built out
  when a second tenant is actually in view. No module block for it yet.
- **SQL applied from a chat session does not record itself.** The CLI writes the SQL into
  `supabase_migrations.schema_migrations.statements`; a hand-inserted row leaves it null, and
  `migration fetch` then rewrites the local file *from that null* and blanks it. If SQL is applied from
  chat, populate `statements` in the same session. **Sync v1.2 guards this** — step 9 photographs the
  migrations folder, fetches, and stops the run and restores everything if any file comes back empty or
  loses more than half its content.
- **The frontend and the Edge Functions reach production by different roads.** Frontend deploys on push;
  Edge Functions only move on an explicit CLI deploy. Deploy the Edge Function first.
- **A failed Vercel build is never an outage.** The previous deployment stays live.
- **`_session-sync.ps1` does not run `npm run build`.** Building is on Shad, before running it.
- **Migration order matters when a frontend selects new columns.** Apply the migration before pushing the
  frontend, or the select 400s.
- **The service worker caches nothing but an offline page** — a caching worker would serve yesterday's
  JavaScript against today's Edge Function.
- Auth header format: `ODFHIR {DeveloperKey}/{CustomerKey}`
- Roles: `owner_admin` (10), `biller` (20), `front_desk` (30). Clinician/hygienist undecided.
- Anything that scans the project root needs `_sync` excluded explicitly.
- Cowork sessions have no voice mode. This chat can be continued on the phone by dictation.

## 1.5 Key IDs, files & locations

| Item | ID / Path | Notes |
|---|---|---|
| Frontend repo | `shadmanavi/dental-os-app` | Auto-deploys to Vercel on push |
| Local project | `C:\Users\shadm\dental-os-app\dental-os-app` | Dev/test copy |
| Live app | `https://dental-os-app.vercel.app/` | Build badge top-right of the nav |
| Supabase project | `mjctkqoggqrgciufqcvd` | Org `1bad5d52-c311-43ba-9a35-28757da059ca` |
| App login | `shadmanavi@gmail.com` | Not the mydentalmasters address |
| Session sync | `_session-sync.bat` + `_session-sync.ps1` | Run at the handoff moment |
| Sync secrets | `_session-sync.secrets.txt` | Git-ignored. Holds `SUPABASE_DB_PASSWORD` |
| Latest pack | `_sync\latest\dental-os-pack.txt` | Upload this to the next chat |
| `od_probe` | SQL function in Supabase | Read-only OpenDental access, keys in Vault. The correct path for all OpenDental investigation |
| `od_sync_offices()` | SQL function in Supabase | Re-runnable letterhead sync |
| Office identity in OD | Setup → Practice · Setup → Email | Where staff edit what the plan prints |

**Live Edge Functions (13):** `fee-schedule-push`, `fee-schedule-stage`, `od-benefit-probe`, `od-chart`,
`od-chart-probe`, `od-create-fee-schedule`, `od-list-fee-schedules`, `od-plan`, `od-seed-fee-schedule`,
`od-survey`, `od-sync-procedure-codes`, `od-test-connection`, `od-tp-doc`

**Migrations on disk: 18.** History ends at `20260817190000_015_office_email_from_emailaddress`.
Current commit: `e8ddbf7` on `origin/main`.

## 1.6 Shared decisions

| Decision | Reason |
|---|---|
| Never write PHI to the Dental OS database | OpenDental stays the single source of truth |
| Badge shows the commit, not a version number | The commit covers everything and is supplied by Vercel |
| `_sync/` lives inside the project | Laptop is a dev/test copy, not a working copy |
| Edge Function deploys go through the CLI, driven by the batch file | Mixing chat-side MCP deploys with CLI deploys is what caused the drift |
| Office letterhead comes from OpenDental | An office that moves updates the place it already maintains |
| `offices.name` is overwritten with `PracticeTitle` | One name everywhere over a friendly UI label |
| The printed email comes from the default `emailaddress` row | `EmailSenderAddress` is legacy and unexposed |
| Internal names stay `chart_*` while the UI reads "TC Charting" | Renaming 400+ references and every RLS policy is the highest-risk change in the system for zero user gain |

**Permanently rejected — do not re-propose:**
- Trusting the `// Version: N` header to establish what is deployed — only the deployed artifact is evidence
- Taking the old frontend down while a new one builds
- Emailing signed treatment plans — HIPAA complexity, tabled
- Reading the `clinic` table for office details — empty on both servers
- Editing `preference.EmailSenderAddress` by hand — legacy and not exposed in OpenDental's interface
- Renaming the `chart_*` tables or the `od-chart*` Edge Functions
- Guessing at the contents of the lost 014 sync migration

## 1.7 Errors & resolutions

| Error | Fix | Lesson |
|---|---|---|
| `supabase db push` appeared to run but neither 014 migration reached the database | Verified against `list_migrations` and `information_schema`, then applied from chat | "Done" from the person at the keyboard is not evidence. Check the database |
| Three migration files blanked to a single `;` | Rebuilt from the live schema and `pg_get_functiondef()`, then patched `statements` on all three rows | `migration fetch` trusts that column absolutely |
| v1 of `od_sync_offices()` unrecoverable | Left as a documented placeholder | Blanked work is only recoverable if it was committed first |
| supabase-js returned `GenericStringError[]` instead of `Office[]` | The `.select()` string had been split with `+`. Made it one unbroken literal | Concatenation defeats the type parser |
| Couldn't find the practice email field in OpenDental | It isn't there — the live one is the default `emailaddress` row | Check whether the application still uses a field before assuming it's hidden |
| Next build in a sandbox failed fetching Geist from Google Fonts | Verified with `tsc --noEmit` instead | A network failure in a check harness is not a code failure |

---
---

# PART 2 — MODULES

## 2.1 TC Charting

**Purpose:** the chairside treatment-coordinator surface. Presents the treatment plan to the patient,
prices it, shows what insurance is estimated to cover, captures acceptance and a signature, and files the
signed plan back into OpenDental.

**Displayed as "TC Charting". Internally everything is `chart`** — routes, tables, Edge Functions. That is
deliberate; see the shared decisions table.

**State:** live and in daily shape.

| State | Item | Note |
|---|---|---|
| Complete | Charting screen | `app/chart/page.tsx` v18.4 |
| Complete | Benefit allocation | `lib/benefitAllocation.ts` v3 |
| Complete | Treatment plan letterhead | `lib/treatmentPlanPdf.ts` v7 — top left, one field per line, no fax |
| Complete | Tile management | v1 |
| Complete | Tablet install (PWA) | Manifest, iOS meta, icons, offline worker. Confirmed on the Galaxy Tab and the iPad |
| Pending | "Charting" → "TC Charting" labels | 2 strings: nav label, tile title. Not yet built — needs approval |
| Backlog | Instructional video | Playwright demo + narration script |
| Backlog | Tablet fleet rollout | 5 units (3 Downey, 2 Maywood) plus a floater. Two test units installed |

**Next steps:** the label build, then the video.

| Decision | Reason |
|---|---|
| Read `BaseEst`, apply only the annual maximum ceiling | Reimplementing OpenDental's limitation engine is impractical |
| Deductible applied to the fee before the percentage | Matches OpenDental, verified against a live patient |
| Preauth marked by appending `"Autho Needed (DOS Entry)"` to the note | No native preauth flag exists; a fixed token is machine-distinguishable |
| Declined work stays at Diag | So it re-presents at the next visit |
| Diag→Acc pairing by name, not DefNum | The same DefNum means different things at each office |
| Insurance plan → patient record for pricing | Never the provider |
| The fax is synced but not printed | Both practices share one number and patients don't fax plans back |
| The route stays `/chart` | The tablets have it installed; renaming it would mean re-adding the app to every home screen |

**Rejected here:** TPi as the acceptance mechanism · reimplementing frequency limits, waiting periods, age
limits and family accumulators.

**Open questions:** should the plan print a website? OpenDental holds none on either server ·
`od-benefit-probe` is marked temporary — delete it, or keep it for the remaining allocation question.

**Assumptions:** both tablets have the PWA installed and launching standalone, confirmed 17 August ·
`offices` holds current letterhead as of the sync at 05:59 UTC on 17 August · test tablets are an iPad A16
on iPadOS 26 and a Galaxy Tab A11+.

## 2.2 Fee Schedules

**Purpose:** update the insurance and non-insurance fee schedules held in OpenDental. Unrelated to charting
beyond the pricing contract in the ownership map.

**State: PARKED.** It got as far as one fee schedule loaded as a test. The PDF-to-CSV lane — reading a
carrier's printed schedule into rows — was deliberately left for later, and that is where it resumes.

| State | Item | Note |
|---|---|---|
| Complete | Single test schedule | "Dental OS TEST 001" at Downey — sandbox, not production |
| Complete | Procedure code cache | `procedure_codes_cache`, 1,151 rows, 25 priced |
| Parked | PDF-to-CSV lane | Lane A only, electronic PDFs via pdfplumber. The efax/scan lane is rejected |
| Parked | First real push | 2026 Delta Dental PPO and Premier were staged but never pushed |

**Next steps:** none until the module is picked up again. Do not propose it as a next step from a
TC Charting session.

| Decision | Reason |
|---|---|
| Lane A, electronic PDFs via pdfplumber | Deterministic extraction |
| AI identifies column mappings only, never touches dollar amounts | A human approves before anything is written |
| Paired-crown fee split halved in whole cents, remainder to the prep | Avoids a rounding drift |

**Rejected here:** the efax/scan lane · a discount-plan table as a middle link in the pricing chain.

## 2.3 User Management

**Purpose:** who can log in, which office they see, and which tiles they get.

**State: BLOCKED** on one decision — is there a clinician/hygienist role, or are clinicians front desk with
a different tile set? And should they see insurance figures and pricing, or clinical only?

This is the single highest-value unblock in the product; nothing else is waiting on anything.

## 2.4 Reporting *(not started)*

Carrier bucketing query — parked, waiting on the query text and the bucket list. Seven carriers currently
land in "Other". Whether that query is still live at all is unconfirmed.

---
---

# PART 3 — STARTING A SESSION

## 3.1 The opening exchange

**Claude does these three things before any work, in order.**

1. **Get the module name.** Shad's first message should name it — TC Charting, Fee Schedules, User
   Management, or Reporting — and that becomes the name of the session. **If it isn't named, Claude asks
   and waits.** No guessing from context, and no starting work "while we sort that out".
2. **Ask whether this is a Cowork session.** If it is, say so plainly and stop — the work moves to a
   regular chat. Claude cannot detect the surface on its own; the answer has to come from Shad.
3. **Ask for the three uploads** in 3.2 and wait for them.

Everything outside the named module's block — plus any shared item not explicitly declared — is out of
scope for that session.

## 3.2 Required uploads

| Upload | Path | Why |
|---|---|---|
| Code pack | `_sync\latest\dental-os-pack.txt` | Full repo state. Check the commit at the top against what's live |

**Pack v6 and later carries `_session-sync.bat` and `_session-sync.ps1` inside it**, so the pack is the
only upload needed. Confirm by checking the header line reads `SOURCE PACK v6`.

**If the pack is v5 or earlier**, those two scripts are not in it — they sit in the project root, outside
every packed subtree — and Claude must ask for them separately. Without them, Claude is reasoning about a
sync routine it cannot read, which is how the `migration fetch` blanking went unnoticed until after it had
been committed.

## 3.3 Standing session rules

- If two sessions run at once, declare file ownership at the start; one migration owner only; no
  simultaneous deploys of the same Edge Function; commit and push before switching.
- `npm run build` before `_session-sync.bat` — the sync script does not build.
- If any SQL is applied from chat, populate `statements` on the history row in the same session.

**If no module is named and Shad has no preference,** the default is the clinician/hygienist role question,
because it unblocks User Management.
