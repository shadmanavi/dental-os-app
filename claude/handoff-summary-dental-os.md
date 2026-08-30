# Handoff Summary — Dental OS / TC Charting

**Owner:** Shad
**Last updated:** 29 August 2026
**Session focus:** Moved onto Claude Code. Wrote the missing migration, built a PDF reader for payer fee schedules and loaded 6 of them into both offices, added payment recording from the tablet, and built the Hygiene Dashboard. A parallel chat built the Production Dashboard on 29 August.

**Working from the repo now.** Claude Code runs inside
`C:\Users\shadm\dental-os-app\dental-os-app`, so it reads the real files
rather than a packed copy, deploys through the CLI and queries Supabase in
the same session. The zip and the sync pack are no longer how work starts.
Keep this summary current, because a new session begins with no memory of
the last one.

---

## 1. How to work with me (always follow)

| Rule | Detail |
|---|---|
| Response length | Max 5 lines of prose per response. This wins whenever rules collide |
| Content | Conclusion first, then the one decision I need to make, phrased so I can answer yes or no |
| Recitation | Never recite inventory, lists or details I already have unless I ask for them |
| Caveats | None, unless I ask |
| Problem dumps | When I dump a pile of problems, topics or issues, hand back a plain numbered list of what we had before plus what I just added. Nothing else. Ask me to pick — then work through my picks one at a time, finishing each before starting the next. This is the only time you list things back to me unprompted |
| Plain language | Talk in simple plain full sentences, not labels or shorthand. On anything complex, one to three points at a time, then stop and check I'm with you |
| Describing changes | Tell me what changes on the screen and who notices it, not what the code is called |
| Instructions | Write out every step of an instruction in full. Never send me back to an earlier message. 1–3 steps at a time; wait before continuing. Step-by-step instructions are exempt from the recitation rule |
| Approval | Ask before every build, code change, or deliverable |
| File delivery | Don't ask me to edit files unless there's no other way. Build the finished file and give it to me. One file → deliver it alone with its exact path. More than one → a zip in the correct folder structure. Complete files always, never snippets |
| Uncertainty | Ask a question instead of guessing |
| Invention | Never invent file paths, function names, IDs, or data |
| Verification | Syntax-check every code file before delivery; state the check ran |
| Preference | If a data fix solves it, prefer that over a code fix |
| Naming | Reference records by human-readable identity, never internal record IDs |
| Numbers | Write numbers as digits, not words |
| Versioning | Bump version + changelog on every build; diff results after to catch regressions |
| Voice | No tables when I'm on voice — I connect from the car often |
| Time estimates | Don't give them. Size work by shape |

---

## 2. Current status

| State | Item | Note |
|---|---|---|
| **Deployed** | `od-plan` **v11** (function version 12) | Dead `set_note` stripped, layman's term added |
| **Deployed** | `od-chart` **v15** (function version 17) | Tooth-state tiles toggle. Confirmed on 25 August by fetching the deployed source, not the version header |
| **Deployed** | `app/chart/page.tsx` **v19.8** | Baby teeth, the plain-English plan, and the Financing tab that takes a payment |
| **Live in database** | 70 tile renames to the layman's terms | No deploy needed; anyone opening the chart sees them |
| **Live in database** | Socket Bone Graft tile | Oral Surgery, Diagnosed, both offices |
| **Live in database** | Silver Filling tiles | Fillings, Diagnosed and Existing, both offices |
| **Live in database** | Primary / Permanent tile | Missing & Other, Existing, both offices. Write proved on patient 17 |
| **Live in database** | `chart_tiles.initial_type` widened to allow Primary | Schema change, applied by hand |
| **Live in database** | Row-level security enabled on `dos_code_names`, `dos_codenum_map`, `dos_write_log` | Closed a Supabase critical security alert. No table in `public` is open now |
| **Deployed** | `od-hygiene` **v15** and the Hygiene Dashboard **v15** at `/hygiene` | Third tile on the home page. Slots from the roster, booked from the midnight snapshot, showed only where a cleaning **and** an exam were both posted, SRP and NH/NE in their own columns, missed carried per day so a twice-missed rebooking counts twice. Every figure — day or month total — opens the patients behind it, each human counted once with a ×N where they recur. Audited against hand-built days at both offices; row and panel come from the same query and one verdict |
| **Deployed** | `od-production` **v1** and the Production Dashboard **v1** at `/production` | Built by a parallel chat, 29 August, commit `6ad2e36`. Fourth tile on the home page |
| **Deployed** | `od-payment` **v2** and chart page **v19.8** | Records a card already taken on the Clover terminal, stamped with the presenter. Proved on patient 17 |
| **Deployed** | `fee-schedule-push` **v3** | A create refused as already existing becomes an update |
| **In the repo** | `scripts/fee-schedule-pdf.mjs` **v5** | Turns a payer's PDF into the CSV the upload screen takes |
| **Live in OpenDental** | 6 payer fee schedules at both offices | Cigna, Delta, MetLife, TriCare TDP, United Concordia Advantage Plus, United Healthcare |
| Complete | Both probe functions deleted | `od-tp-probe`, `od-benefit-probe`, plus their local folders and `od-chart-probe` |
| **Recorded in repo** | Migration `021_tile_names_tooth_state_and_rls` | Written 25 August, commit `ff56f3d`. The repo and the live database agree again |
| Blocked | Declined work, autho, TPi fresh start | Waits on the OpenDental upgrade |
| Parked | Clinician role, instructional video | Unchanged |

**Nothing is broken in production.**

---

## 3. Next steps (prioritized)

1. **Production Dashboard — built.** Landed 29 August by a parallel chat (`od-production` v1, `/production` v1, commit `6ad2e36`). Its note-vs-procedure checking still depends on the posting decision, item 2. Verify its numbers against the offices the way the hygiene ones were.

2. **Settle how procedures get posted** — open since 21 August and now blocking more than one thing. The 5 options are in section 3a and Shad has not chosen. Claims and preauthorizations both wait on it, the Production Dashboard's note checking depends on it, and the Hygiene Dashboard has already found the symptom: 16 appointments in August completed at Downey with nothing posted to the account at all, and another 62 with only exams and x-rays

3. **Delete the 2 test payments on patient 17 at Downey** — 59587 and 59588, $1.02 each. Shad can remove them in OpenDental
4. **Guardian's fee schedule** — the copy we have is a fax. Pages 4 to 8 are scanned images with no text at all, so it cannot be read reliably. Get a real PDF from Guardian's provider portal
5. **Send the email to Maria and Manuel** about D9630 and D0350. Two drafts were written on 23 August and never saved to file, so they need writing again
6. **Downey D9988** — named the same as D2740 but is actually an all-ceramic upgrade code
7. **Maywood D9955a** — named "Whitening Delivery" but never retired or replaced
8. **Clear the stale Flouridex fees off Maywood M9955** — about 15 insurance schedules at $20, one Denti-Cal at $550, UCR Prior 2022 at $45
9. **Tidy the trailing space on Downey's `[.025] Credit Card - M1`** — invisible, harmless, but there
10. **The bundled chart build, tested with the OpenDental upgrade** — Shad's call to combine these
11. **Session list layman's term** — deliberately skipped. Would cost an extra OpenDental call per patient open

**If the Hygiene Dashboard gets too slow, in this order:**

- Count in SQL rather than returning every row and counting in the function. Measured on Downey's August: 917ms and 466 rows becomes 628ms and 106 rows
- Merge the 2 office lookups — the hygienist specialty and the hygiene columns — into 1 call. They change about once a year
- Remember the last few months in the page, so paging back and forth or switching office and back is instant
- Draw the table as soon as the roster lands and fill the counts in after, so the screen is not blank while the slow part runs

Together that takes a month read from 7 OpenDental round trips to 5, with the 2 costly ones cheaper. Running the calls in parallel would not help — OpenDental serialises them per office key.

**Known gaps, deliberately left:**

- A staged fee upload has no lock. Two browsers pushing the same upload would both claim the same rows. Different offices in different tabs is safe and is how it is used
- A failed row on a staged upload cannot be retried from the review screen. It has to be set back to pending in the database
- Open question for Shad: should NH/NE count days with no RDH rostered? Maywood 13 August shows 29 NH/NE — really doctor production in hygiene chairs on a no-RDH day. Asked 28 August, not yet answered

---

## 3a. Carry-forward — insurance features (from a parallel chat, 21 August 2026)

Not built. The shape of each is settled; posting still needs a decision.

### Preauthorizations

The OpenDental claims endpoint creates a real preauth by passing ClaimType
`PreAuth` with the patient, an array of ProcNums, plus `InsSubNum` and
`PatRelat` — the last 2 are required **only** for preauths. This is the same
action as the PreAuthorization button in the Treatment Plan module.

**Sending is not possible through the API.** The installed OpenDental program
builds the 837 file and transmits to DentalXChange ClaimConnect using
credentials stored on the desktop. So the app creates the preauth into the
"Waiting to Send" queue and the biller sends the batch from her desk in the
morning, exactly as she does today.

Probes of Downey confirmed her review is genuinely just review. Of 723
preauths in the last 4 months: zero had narratives, zero had attached images,
only 4 had a claim note, and 691 of 723 had the subscriber as the patient.
Across all 7,708 preauths back to 2008, only 2 ever had attached images.
**The X-ray attachment concern is not a real blocker.**

One open question: ask the biller whether she corrects anything the database
does not record, such as a wrong insurance plan.

### Claims

Same endpoint, simpler. ClaimType `P` for primary or `S` for secondary, which
automatically use the patient's matching insurance — so subscriber and
relationship are not needed. `Other` exists but arrived in 25.3.41, beyond the
24.4.51.0 build both offices run.

Same limit: create only, no send.

**Claims cannot be created until procedures are Complete, so this depends on
posting and must follow it.**

### Posting — 5 options, no decision made

1. The coordinator ticks a checkbox to set procedures complete
2. The checkbox plus a warning when the doctor's notes do not match
3. Start from the doctor's note and select the procedures it matches
4. Pre-tick what was treatment planned for that visit
5. The doctor marks completion at the point of care

Claude's instinct was option 1, with the app only ever suggesting, because
inferring completion from notes risks creating false claims. **Shad has not
decided. Do not proceed on posting until he does.**

---

## 4. Key decisions

### New this session

| Decision | Reason |
|---|---|
| **Tile names come from the layman's terms in OpenDental** | The tile reads the same as what the patient sees on their plan. 70 renamed |
| **Multi-code tiles keep their hand-written names** | Composite and Root canal pick between several codes, so no single layman's term fits |
| **The 4 plan lists show the layman's term, the session list does not** | The first 4 all read from `od-plan`, which was already joining the procedure table. The session list reads from `od-chart` and would need another OpenDental call per patient |
| **The ADA description is still sent, never replaced** | Claims need the official wording. `nameOf` chooses for display only |
| **A primary slot shows both teeth, not one** | Verified on patient 37139: tooth 4 carries a crown and a buildup while A carries 2 fillings. The number never goes away |
| **The permanent-to-letter mapping lives in `od-chart`** | One place, so the browser and the server cannot drift |
| **Tooth-state tiles toggle, including Missing** | A tile that toggles for primary but not for missing is harder to explain than one that always toggles. OpenDental offers Not Missing for the same reason |
| **A cleared tooth state is not undoable** | Nothing was created, so there is no id. The tile itself is the way back |
| **Bone graft is D7953, not D4263** | D7953 is ridge preservation and belongs with extractions. D4263 is the perio graft |
| **Amalgam is one tile with no front-and-back split** | D2140 to D2161 cover every tooth, unlike composite |
| **Failure messages carry `requested` and `stored`** | `od-plan` was already reporting them; the screen was throwing them away |
| **The 3 CDT cleanup tables get RLS with no policies at all** | Nothing in the app reads them, so a policy would only be a way in. The service key ignores RLS, so Claude can still work with them |
| **The migration writes the 59 tile names out word for word** | Reading them back out of `dos_code_names` would tie a rebuild to a table that keeps moving as the CDT cleanup continues. The migration should reproduce today's screen, not next year's snapshot |
| **Where the tile and `dos_code_names` disagree, the tile wins** | The Perio pair reads "Gum Treatment 4+" and "Gum Treatment 1-3" on screen while the table still says "Deep Cleaning". The tile is what the patient and the coordinator actually see |
| **A migration is checked by running it against the live database and rolling it back** | It proves the file parses and every join resolves against the real schema, and leaves nothing behind |
| **Hygiene slots come from the roster, not the hygiene tick** | The provider schedule names the columns each hygienist sits in, always 2, so a day with 1 hygienist and a day with 3 both come out right. The tick would have missed HG-PN, who works out of 2 Production columns, and read 28 slots on 29 August where there were 42 |
| **A hygienist is a provider whose specialty is Hygienist** | Definition category 35. DefNum 543 at Downey, 466 at Maywood, so it is resolved by name. The "HG" abbreviation is not reliable — a dentist appears as the hygienist on 5 Downey appointments |
| **Missed is booked less showed, never counted** | A missed appointment is re-dated on its way into the Cancelled column, so its own row no longer says which day it was for |
| **Booked for a past day is the midnight snapshot, from the appointment history** | Not the end of the day: the cancellations are moved out as the day runs, so by closing time the hygiene columns look untouched. Not today's schedule either, for the same reason |
| **A day with no hygienist rostered is not closed** | The doctors see hygiene patients on those days. The day reads 0 slots and still counts what was booked and seen, taken from the hygiene-ticked columns. This is the one place the tick is used |
| **The payment type is a dropdown of the office's own list** | Downey and Maywood spelled the same tender differently until they were made to match. Reading the list live means the name on screen is certain to exist |
| **A payer PDF is read by coordinates, not by extracted text** | The text layer of these PDFs is not in reading order. On Cigna, plain text extractors pair D0145 with $31.00 or $21.00 depending which one you ask |

### Carried forward

| Decision | Reason |
|---|---|
| Authorization lives in OpenDental's priority list, not a Dental OS control | The office already records it there |
| Autho labels matched by name, never DefNum | Downey's 159 is Auth Denied; Maywood's 159 is Auth Approved |
| Diag→Acc pairing by name at runtime | The same DefNum means different things per office |
| Declined work stays at Diag | So it re-presents at the next visit |
| Never write PHI to the Dental OS database | OpenDental stays the single source of truth |
| Read `BaseEst`, apply only the annual maximum ceiling | Reimplementing the full limitation engine is impractical |
| Edge Function deploys go through the CLI | Mixing chat-side deploys with CLI deploys caused drift |

**Permanently rejected — do not re-propose:**
- Showing TPi procedures on the Diags list — raised and withdrawn this session. They are old inactive plans, one Downey patient has 105, and they all carry a fee of $0.00, so they would read as free treatment and drag the totals down
- Replacing the permanent tooth number with the letter — both stay live and both stay tappable
- A separate Edge Function for TPi — the existing filter in `od-plan` is the whole mechanism
- Trusting a version header to establish what is deployed — fetch the deployed source
- Multi-**tooth** selection on the chart screen
- The preauth note token as the authorization record
- Attaching procedures to an Inactive plan to hide them — on 24.4.51 plan membership hides nothing
- A tile-name suggestion box — superseded by the CDT cleanup

---

## 5. Standing facts & constraints

- OpenDental is always the source of truth. Every write is followed by a read-back; the database value is the only answer that counts
- **Primary teeth:** OpenDental stores baby teeth as letters A to T in the same `ToothNum` column as permanent numbers. A `toothinitial` row of type Primary sits on the **permanent** number and is what makes the letter appear
- **The mapping:** A to J across teeth 4 to 13, K to T across 20 to 29. The other 12 positions have no baby predecessor — marking them is legal and draws nothing, which is why Patricia Ruiz's flags on 3, 14 and 15 showed no letter
- **Baby teeth have no premolars.** C, D, E, F, G, H, M, N, O, P, Q, R are anterior; A, B, I, J, K, L, S, T are molars. A tooth_class rule never resolves to a bicuspid on a lettered tooth
- Downey holds roughly 9,000 procedures on lettered teeth. Until v14 the app refused every one of them
- **OpenDental will not delete the last procedure from a preauthorization.** This is a real business rule, not a bug. The preauth has to go first, in OpenDental
- Both offices run OpenDental **24.4.51.0**. TPi writes need 25.2.21+; 2026 CDT codes need 25.2.62+
- MySQL is **5.5.14** — no JSON functions, `GROUP_CONCAT` capped at 1024 chars
- `/queries/ShortQuery` refuses any query containing the word "SCHEMA", caps at 100 rows, and returns everything from the offset onward on later pages
- The Layman's Term field shows on Treatment Plans, Chart, Account and Statements. Description shows in code lists and claims
- Roughly 350 codes have no layman's term. `nameOf` falls back to the description
- **Neither claims nor preauthorizations can be sent through the API.** The installed OpenDental program builds the 837 file and transmits to DentalXChange ClaimConnect using desktop-stored credentials. The app can only create into the "Waiting to Send" queue
- `Other` as a claim type needs 25.3.41 — a later build than the 25.2 upgrade already planned

---

## 6. Key IDs, files & locations

| Item | ID / Path | Notes |
|---|---|---|
| Supabase project | `mjctkqoggqrgciufqcvd` | MCP must be enabled per-chat via the tools icon |
| Repo | `shadmanavi/dental-os-app` | Local: `C:\Users\shadm\dental-os-app\dental-os-app` |
| Live app | `https://dental-os-app.vercel.app/` | Auto-deploys from GitHub |
| Sandbox patient | PatNum 17 at Downey | Approved for probe writes. Tooth 4 is currently marked primary |
| Verified test patient | PatNum 37139 at Downey | Ruiz, Patricia. Proved the primary tooth model |
| Preauth test row | D2950 on tooth 20, patient 17 | Attached to preauth claim 100012. Cannot be deleted |
| Local dev server | `npm run dev` then `http://localhost:3000` | Talks to live Supabase and live OpenDental. Writes are real |

**Deployed Edge Functions (11):** `od-chart`, `od-plan`, `od-tp-doc`, `od-survey`, `od-test-connection`, `od-sync-procedure-codes`, `od-create-fee-schedule`, `od-seed-fee-schedule`, `od-list-fee-schedules`, `fee-schedule-stage`, `fee-schedule-push`

**Database objects used this session:** `chart_tiles`, `chart_categories`, `chart_tile_offices`, `chart_tile_addons`, `dos_code_names`, `procedure_codes_cache`, `od_probe`

---

## 7. Recent changes

| File | Change | Why |
|---|---|---|
| `supabase/functions/od-plan/index.ts` | v10: stripped the dead `set_note` action, `NOTE_TOKENS`, `stripToken`, `preauthByProc` and the `preauth` field | Nothing had called it since the chart page dropped the per-row authorization control. Saves one OpenDental query per patient open |
| `supabase/functions/od-plan/index.ts` | v11: returns `layman` on every row | The plan reads in plain English |
| `supabase/functions/od-chart/index.ts` | v14: accepts letters A to T, returns `primary_teeth` | Baby teeth could not be charted at all before |
| `supabase/functions/od-chart/index.ts` | v15: tooth-state tiles toggle, with the delete read back | There was no way back to permanent from the tablet |
| `app/chart/page.tsx` | v19.3: draws the letter under its number as its own tap target | Both teeth stay chartable, as in OpenDental |
| `app/chart/page.tsx` | v19.4: `nameOf` used in 4 lists and the printed plan | Patients read this screen |
| `app/chart/page.tsx` | v19.5: failure messages carry the field, requested and stored | "OpenDental would not change D2950 #20" told us nothing |
| `app/chart/page.tsx` | v19.6: a cleared tooth state leaves the chart and says "removed" | A toggle needs both directions on screen |
| Database | 70 tile labels renamed to layman's terms | The tile matches the patient's plan |
| Database | Socket Bone Graft, Silver Filling ×2, Primary / Permanent tiles added | Missing from the menu |
| Database | `chart_tiles_initial_type_check` widened to allow Primary | The constraint blocked the tile |
| Database | RLS enabled on `dos_code_names`, `dos_codenum_map`, `dos_write_log` | They were readable and writable by anyone with the project URL and the public key |
| `supabase/migrations/20260825120000_021_tile_names_tooth_state_and_rls.sql` | Records all 4 database changes above in one re-runnable file | A rebuild from the migrations came up with the old names, no new tiles and 3 open tables |
| `scripts/fee-schedule-pdf.mjs` | New. Reads a payer's PDF by coordinates and writes the CSV the upload screen takes | 6 schedules were loaded into both offices from it |
| `supabase/functions/od-payment/index.ts` | New. Records a payment already taken on the terminal, refuses to post the same amount twice inside 2 minutes | The coordinator no longer walks the patient to the front desk |
| `app/chart/page.tsx` | v19.7 and v19.8: the Financing tab takes a payment, with the payment type read live from the office | It was a placeholder reading "Not built yet" |
| `supabase/functions/od-hygiene/index.ts` | New. A month of hygiene per office | Slots from the roster, booked from the midnight snapshot, missed as the subtraction |
| `app/hygiene/page.tsx`, `app/page.tsx`, `app/components/TopNav.tsx` | New Hygiene Dashboard, its home tile and its nav entry | Third tile on the home page |

**Fixed on the way past:** every tooth-state entry was being added to the missing list, so marking a tooth primary would have struck it through as though it had been extracted.

---

## 8. Active assumptions

- The Primary flags on Patricia Ruiz's teeth 3, 14 and 15 were test taps, not clinical intent
- The `dos_code_names` table is a 20 August snapshot. Codes added since are not in it
- The 4 tiles added this session were never tested by committing a real procedure — only the Primary / Permanent write was proved

---

## 9. Open questions

- **Posting — which of the 5 options?** Claims and preauths both wait on this
- **Ask the biller** whether she corrects anything on a preauth that the database does not record, such as a wrong insurance plan
- Should Missing tooth toggle, or only Primary / Permanent? Built as a toggle for both; easy to restrict
- Was the amalgam or bone graft tile ever tested by writing a real procedure?
- The session list at the bottom of the chart still shows ADA wording. Leave it, or pay the extra call?
- Still outstanding from earlier: what is `10XD`, "AI Appointment" at Downey and blank at Maywood?

---

## 10. Errors & resolutions

| Error | Fix | Lesson |
|---|---|---|
| "OpenDental would not change D2950 #20" with no detail | Surfaced `od-plan`'s own `requested` and `stored` in the message. The real reason was that the procedure is the last one on a received preauthorization | The Edge Function was reporting properly; the screen was discarding it |
| `chart_tiles_initial_type_check` rejected Primary | Widened the constraint to Missing, Hidden, Primary | A guard written for 2 values silently blocks the third |
| Tile renames appeared to be 76; actually 70 | Recounted from the database | State counts from the query result, not from a hand tally |
| The pack file's trailing `=====` separator read as a merge conflict marker by `tsc` | Stripped it before building | Files extracted from the pack need the separator removed |
| A replacement was inserted immediately before the line it was meant to replace | Extended the matched block to consume the old lines | An asserted replacement can succeed and still be dead code — read the result back |
| `rowsOf` used in `od-chart`, where it does not exist | Used `od-chart`'s own inline `Array.isArray(body)` pattern | The 2 Edge Functions have different helpers despite similar shapes |
| Supabase critical alert, 23 August: "Table publicly accessible" | Enabled RLS on the 3 CDT cleanup tables. All row counts intact — 512, 2,734 and 1,301 | Tables created outside the migration flow do not inherit the RLS habit the rest of the schema has. Check `relrowsecurity` after adding any table |
| The first live payment reported as failed although it was recorded correctly | Compared the note with the line breaks normalised | OpenDental rewrites a note with Windows line endings whatever it is sent. Left alone, every payment ever taken would have read as a mismatch |
| Delta at Maywood: 2 rows refused, and re-pushing did nothing | `fee-schedule-push` v3 turns a refused create into an update. The failed rows also had to be set back to pending by hand | A new schedule is staged as empty because it does not exist yet, but OpenDental can already hold a fee against that number. And a failed row is never picked up again — the push only claims rows still marked pending |
| United Health Care lost 144 fees, crowns and bridges among them | The money pattern demanded a thousands separator; United Health Care writes $1029.00 | The 5 schedules read before the fix regenerate byte-identical, which is how it was proved nothing already pushed had moved |
| The Hygiene Dashboard read 163% filled and 61% missed | Missed stopped being counted and became booked less showed | A cancelled appointment is parked in the Cancelled column with its date **and time rewritten** — all 10 minutes long, stacked from 06:40 to 18:30, hours past closing. Nothing on the row says which day it was ever for |

---

## 11. Start here next session

- Read this file before replying. Claude Code opens in the repo, so nothing needs uploading
- The Hygiene Dashboard is new and lightly used. Ask whether the numbers have held up against what the offices believe, particularly the missed count
- The 2 test payments on patient 17 may still be sitting on the account
- Check that the working tree is clean and that `git log` matches what this file claims is deployed
- Ask whether the Primary / Permanent toggle was tested on patient 17 tooth 4 — one tap should remove the A, a second should put it back
- Ask whether the 8 stray Primary flags on Patricia Ruiz have been cleared
- Before touching the database, check that nothing has been applied by hand since migration 021. Anything found that way needs a migration written the same day
- If `dos_code_names` is going to be read for anything, re-run `dos_load_codenums` for both offices first — the map is a 20 August snapshot
