# Handoff Summary — CDT / Procedure Code Cleanup

**Owner:** Shad
**Last updated:** 20 August 2026, with 3 corrections added on 25 August when this
file was moved into the repo. Everything else is as it stood on 20 August.
**Session focus:** Cleaned up procedure code names, descriptions and treat areas across both offices, and built a live write path into OpenDental to do it.

---

## 1. How to work with me (always follow)

| Rule | Detail |
|---|---|
| Response length | Max 5 lines of prose per response. This wins whenever rules collide |
| Content | Conclusion first, then a brief reason |
| Caveats | None, unless I ask for them |
| Problem dumps | When I dump a pile of problems, topics or issues, hand back a plain numbered list of what we had before plus what I just added. Nothing else. Ask me to pick — then work through my picks one at a time, finishing each before starting the next |
| Plain language | Talk in simple plain full sentences, not labels or shorthand. On anything complex, one to three points at a time, then stop and check I'm with you before building on it |
| Describing changes | Tell me what changes on the screen and who notices it, not what the code is called |
| Instructions | Write out every step of an instruction in full. Never send me back to an earlier message. 1–3 steps at a time; wait for "next" before continuing |
| Approval | Ask before every build, code change, or deliverable |
| File delivery | Don't ask me to edit files unless there's no other way. Build the finished file and give it to me. One file → deliver it alone with its exact path. More than one → a zip in the correct folder structure so I can copy it over. Complete files always, never snippets |
| Uncertainty | Ask a question instead of guessing |
| Invention | Never invent file paths, function names, IDs, or data |
| Verification | Syntax-check every code file before delivery; state the check ran |
| Preference | If a data fix solves it, prefer that over a code fix |
| Naming | Reference records by human-readable identity, never internal record IDs |
| Versioning | Bump version + changelog on every build; diff results after to catch regressions |
| Voice | No tables when I'm on voice |
| Time estimates | Don't give them. Size work by shape |

---

## 2. Current status

| State | Item | Note |
|---|---|---|
| Complete | OpenDental D Codes updater run | Both offices. Official ADA descriptions restored. Downey 1,151 → 1,340 codes; Maywood → 1,394 |
| Complete | Trailing-D delivery codes reviewed | All 43 decided; spreadsheet at `data/trailing-d-codes-decisions.csv` |
| Complete | Layman's terms written | 993 codes across both offices, all read back, zero rejections |
| Complete | Custom code descriptions rewritten | 308 codes (147 Downey, 161 Maywood), zero rejections |
| Complete | Treat areas standardised | 29 codes. Dentures = arch, partials and stayplates = tooth range, inlays/onlays = tooth |
| Complete | Retirements | `6750d`, `D`, `D9955`, `M9960d` at Maywood; `M9960d` at Downey. All in hidden Obsolete category |
| Complete | `od_write` built | Live write path into both OpenDental servers, procedure codes only |
| Complete | Whitening fix at Maywood | `M9955` repurposed from Flouridex to In-Office Whitening, priced to match old `D9955` |
| Not started | Trailing-space codes | Shad chose to skip. See section 9 |
| Not started | Fee tidy-up on Maywood `M9955` | Stale Flouridex fees still on ~15 insurance schedules |
| Blocked | OpenDental upgrade to 25.2+ | Needed for TPi writes and 2026 CDT codes. Currently 24.4.51.0 |

---

## 3. Next steps (prioritized)

1. Send the staff email (two drafts were written in session; not saved to file)
2. Clear the stale Flouridex fees off Maywood `M9955` — about 15 insurance schedules at $20 and one Denti-Cal at $550, plus UCR Prior 2022 still at $45
3. Decide what to do with Maywood `D9955a` (Whitening Delivery, 12 uses) — it was named but not retired or moved to a custom code
4. Upgrade OpenDental to 25.2.62+ at both offices, then re-run the D Codes tool for the 2026 CDT set
5. Return to the main Dental OS work — see [handoff-summary-dental-os.md](handoff-summary-dental-os.md), which is current to 25 August. The v18.5 deploy and the probe functions are long finished

---

## 4. Key decisions

| Decision | Reason |
|---|---|
| Layman's Term holds the plain-English name; ADA Description left untouched on standard codes | Patients get plain words, claims keep correct ADA wording |
| Custom codes get the name in both Description and Layman's Term | No ADA wording to protect, and Description is what staff see in lists |
| Short clinical shorthand, not patient prose | Shad's call: "Zirconia Crown", "PFG Crown", "PFM Crown". TCs walk patients through plans anyway |
| Retiring a code = move to hidden "Obsolete" category | OpenDental has no per-code hidden flag; only categories can be hidden. DefNum 114 at both offices |
| `D6750d` means bridge abutment delivery (Downey's reading) | Matches parent `D6750`, a bridge retainer crown. Maywood had drifted to "PFG Del" |
| `D6250d` means pontic delivery (Downey's reading) | Matches parent `D6250`, a pontic. Maywood had it as abutment |
| `M2791` becomes "Upgrade to Zirconia" at both | Maywood's meaning wins; Downey already has `M2271` for PFM upgrade. Fee deliberately left unchanged |
| `D2630d` renamed to onlay, not inlay | Parent `D2630` is an onlay |
| Maywood whitening moves from `D9955` to `M9955` | `D9955` is a real ADA code for oral appliance therapy — billing exposure |
| Treat area review skipped in the OpenDental updater | Would have reopened the exact divergence we were fixing |
| Only codes used in the last 3 years were named | 878 Downey / 570 Maywood ever-used was too many to review |

**Permanently rejected — do not re-propose:**
- Fixing trailing-space codes by renaming — OpenDental will not let you edit a Procedure Code once saved (confirmed on screen). Would require creating twins and retiring originals; Shad chose to skip entirely
- Writing to OpenDental's MySQL directly — the query window is read-only by design, and direct writes skip validation and change logging
- Overwriting official ADA descriptions with plain English — undoes the D Codes updater
- Renaming staff-name codes (`TC*`, `ZZ*`, `ML*`, `RR*`) — same code numbers mean different people at each office

---

## 5. Standing facts & constraints

- OpenDental is always the source of truth. Every write is followed by a SELECT read-back; the database value is the only answer that counts
- Both offices run OpenDental **24.4.51.0**. TPi writes need 25.2.21+. 2026 CDT codes need 25.2.62+
- MySQL is **5.5.14** — no JSON functions, `GROUP_CONCAT` capped at 1024 chars
- MySQL 5.5 ignores trailing spaces in `=` comparisons. To find trailing-space codes use `LENGTH(ProcCode) <> LENGTH(TRIM(ProcCode))`, not `TRIM(x) <> x`
- `/queries/ShortQuery` refuses any query containing the word "SCHEMA"
- ShortQuery returns 100 rows on offset 0 but returns *everything from the offset onward* on later pages — check `row_count`, don't assume 100
- The Layman's Term field shows on Treatment Plans, Chart, Account and Statements. Description shows in code lists and claims. Abbreviation shows on the appointment book
- `PUT /procedurecodes/{CodeNum}` requires version 23.3.25+ and accepts Descript, AbbrDesc, TreatArea, LaymanTerm, ProcCat
- The ADA CDT table is not freely available. OpenDental ships it — Lists → Procedure Codes → Tools → D Codes → Run Now
- Never tick "Treatment Areas" in Procedure Code Tools. Never tick Auto Codes, Procedure Buttons, Appt Procs Quick Add or Recall Types — all say "deletes all current"

---

## 6. Key IDs, files & locations

| Item | ID / Path | Notes |
|---|---|---|
| Supabase project | `mjctkqoggqrgciufqcvd` | MCP must be enabled per-chat via the tools icon |
| Review spreadsheet | `data/code-names-review.xlsx` | 532 codes, sorted busiest first |
| Trailing-D decisions | `data/trailing-d-codes-decisions.csv` | All 43 codes with rulings and notes |
| Raw pulls | `data/downey_all.txt`, `data/maywood_all.txt` | Pipe-delimited: code, description, abbreviation, treat area, uses |
| Obsolete category | DefNum `114` at **both** offices | Already hidden. Same number at both, unusually |
| Sandbox patient | PatNum 17 at Downey | Approved for probe writes |
| Verified test patient | PatNum 37139 at Downey | Two treatment-planned `D2740` crowns, teeth 4 and 5 |

**Database objects created this session:**

| Object | Purpose |
|---|---|
| `od_write(office, codenum, changes, dry_run)` | Writes one procedure code. Whitelisted to Descript, AbbrDesc, TreatArea, LaymanTerm, ProcCat, procCat. Refuses anything else. Defaults to dry run |
| `dos_load_codenums(office)` | Fills `dos_codenum_map` from OpenDental. Re-run if codes are added |
| `dos_apply_layman(office, batch, dry_run)` | Batch-writes Layman's Term. One read-back per batch |
| `dos_apply_descript(office, batch, dry_run)` | Same for Description, custom codes only |
| `dos_code_names` | 512 rows: proc_code, layman, is_custom |
| `dos_codenum_map` | office_slug, proc_code, codenum. Downey 1,340 / Maywood 1,394 |
| `dos_write_log` | Every field write with wanted, stored and verdict |

All 3 `dos_` tables were created without row-level security and were open to
anyone holding the project URL and the public key. Supabase raised it as a
critical alert on 23 August. They are locked now, with no policies at all,
recorded in migration `021_tile_names_tooth_state_and_rls`. The service key
ignores RLS, so `od_write` and the batch functions still reach them. Do not
add a policy unless something in the app starts reading these tables.

Migrations applied: `017_od_write_procedurecode`, `018_code_name_staging`, `019_dos_apply_layman`, `020_dos_apply_descript`.

---

## 7. Recent changes

| File | Change | Why |
|---|---|---|
| OpenDental, both offices | 993 Layman's Terms written | Patients see plain names on plans and statements |
| OpenDental, both offices | 308 custom descriptions rewritten | Staff see consistent names in code lists |
| OpenDental, both offices | 29 treat areas standardised | Same prompt for the same appointment at either office |
| OpenDental, Maywood | `M9955` repurposed to In-Office Whitening | `D9955` is a real ADA code and was being misused |
| OpenDental, 5 codes | Moved to Obsolete | Retired without losing history |

Batch sizes that worked without timing out: 120–130 for Layman's Term, 200 for Description.

---

## 8. Active assumptions

- `dos_codenum_map` is a snapshot from 20 August. If codes are added at either office, re-run `dos_load_codenums` before any further batch
- The 27 codes still marked "auto" in the spreadsheet were generated, not chosen. Mostly Medi-Cal codes with 1–2 uses each
- Downey `D9988` was named "Zirconia Crown", the same as `D2740`. It is actually an all-ceramic **upgrade** code — worth revisiting
- `M9959` differs between offices and was deliberately left alone. Zoom Whitening at Maywood; something else at Downey with 345 uses

---

## 9. Open questions

- Trailing-space codes: 6 at Downey, 4 at Maywood. `M2752 ` has 3,533 uses at Downey and `TC16 ` has 1,556. Shad chose to skip. `D1310 ` and `D0602 ` at Downey collide with the real ADA code and can only be retired
- Maywood `D9955a` — named "Whitening Delivery" but not retired or replaced
- Downey `M2791` fee still priced as a PFM upgrade though the code now means zirconia. Shad declined to change it
- `10XD` — "AI Appointment" at Downey, blank at Maywood. Shad left it alone. What is it?
- ~~Were `od-tp-probe` and `od-benefit-probe` deleted at the desk?~~ Answered on 23 August: both are gone, along with `od-chart-probe`
- Staff confirmation on the real meaning of `M9955`, `D9630` and `D0350` — still outstanding from the 19 August handoff

---

## 10. Errors & resolutions

| Error | Fix | Lesson |
|---|---|---|
| Fees on Maywood `M9955` landed on 10 schedules at $550 instead of just UCR | Corrected Private-Cash Pay to $468 and Dental Masters Membership to $398 by hand | Read fees back per schedule, not just the max |
| First name list would have relabelled Maywood's staff codes with Downey's staff names | Excluded `TC*`, `ZZ*`, `ML*`, `RR*` and everything Shad said to leave alone | A shared name list is only safe where both offices share the meaning |
| `TRIM(ProcCode) <> ProcCode` returned zero rows despite trailing spaces existing | Used `LENGTH(ProcCode) <> LENGTH(TRIM(ProcCode))` | MySQL 5.5 pads on comparison |
| `information_schema` query rejected with HTTP 401 | Queried `definition` directly instead | ShortQuery blocks the word "SCHEMA" |

---

## 11. Start here next session

- Upload this zip and read it before replying
- Confirm whether the staff email went out
- Ask Shad whether the stale Maywood `M9955` fees still need clearing
- If continuing here, re-run `dos_load_codenums` for both offices first — the map is a 20 August snapshot
- If moving back to Dental OS proper, ask for `_sync\latest\dental-os-pack.txt`, which was missing at the start of this session
