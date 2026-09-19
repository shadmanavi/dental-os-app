# Dental OS — session status log (newest first)

## 2026-09-19 (same session, later still) — patient.Language wired into the consent picker's default

**What changed**
- Closed the last open gap from the two entries below: the consent
  picker's English/Spanish toggle now defaults off the patient's own
  OpenDental record instead of always opening on English.
- Checked live before wiring anything, per this project's standing
  rule — `patient.Language` does **not** store the spelled-out name.
  Both offices actually hold short codes: `eng`, `spa`, blank, and
  `Declined to Specify`; Maywood also has a handful of `fil`
  (Filipino), `zho` (Chinese), `vie` (Vietnamese), and `fas` (Persian).
  Had this been wired against an assumed value like `"Spanish"` it
  would have silently never matched anything.
- `od-chart` → v18: the `open` action's `patient` block now carries
  `Language` straight through from OpenDental's own `/patients/{id}`
  response. Nothing else reads it yet.
- `app/chart/page.tsx`: `openConsentPicker` reads `patient.Language`,
  matches it against `"spa"` (case-insensitive), and opens the picker
  already on the Spanish form set when it matches — everything else
  (blank, `eng`, any of the other codes, `Declined to Specify`)
  defaults to English, since Spanish is the only second form set that
  exists. Still fully overridable with one tap on the toggle.

**What was verified**
- Live query (temporary reuse of the `od-consent-probe` slot, retired
  immediately after, same as every other discovery this session):
  distinct `patient.Language` values and counts, both offices — this
  is what caught the wrong assumption above before it shipped.
- `npm run build`: green.
- `od-chart` deployed via the Supabase CLI directly from the working
  tree (`npx supabase functions deploy od-chart --project-ref ...`)
  rather than pasted inline — the file is 2,600 lines and there was no
  reason to round-trip that much of it through this conversation just
  to change one field. Confirmed ACTIVE afterward via `list_edge_functions`.
- Dev server reloaded in the Browser pane; `/chart` still loads with no
  new console/server errors.

**What is still open**
- Not yet confirmed live against a real Spanish-language patient — the
  matching logic is right per the live data pulled, but nobody has
  actually opened the picker on such a patient and watched it default
  correctly.
- The layman renaming of OpenDental's consent-form Descriptions (for
  the procedure-category default match) is still the one open item
  from two entries below, still Shad's task.

**Next step**
- Shad: open Consent on a patient whose OpenDental record has Language
  set to Spanish and confirm the picker opens already on the Spanish
  list.

## 2026-09-19 (same session, later) — Consent sign-and-file pipeline built: form text, signature, PDF, procedure note, Imaging upload

**What changed**
- The rest of the pipeline the previous entry left open. `od-consent` →
  v3 (deployed as platform v4 after an intermediate redeploy) adds two
  actions:
  - `get_form_text`: reads a chosen sheetdef's own wording straight
    from OpenDental (`sheetfielddef`, StaticText and the two OutputText
    auto-fill fields these forms use, `patient.nameFL` and
    `dateTime.Today`), grouped into printed lines by proximity in Y
    position — a label and its auto-fill blank sit side by side on the
    real form, not one above the other, so a naive top-to-bottom sort
    would have split them across two lines. Auto-fill tokens come back
    unresolved (od-consent has no patient in scope); the client
    resolves them.
  - `upload_signed_form`: files the rendered PDF into the existing
    "Consent Forms" Imaging category, same by-name-at-read-time
    resolution `od-tp-doc` already uses for "Treatment Plans" (Downey
    392, Maywood 324, confirmed the prior entry — not hardcoded here
    either).
- New `lib/consentPdf.ts`: renders the signed form as its own PDF —
  office letterhead and signature-block layout reused from
  `treatmentPlanPdf.ts` (which now exports `officeLines`/`formatPhone`
  so the two documents' letterheads can't silently drift apart), title
  = the form's own Description, the procedures it covers, its quoted
  wording, its field value (tooth list or notes) if it has one, and the
  signature image. No SigBox, no OpenDental Sheet involved anywhere —
  this is a plain PDF with a picture of a signature on it, exactly the
  design settled two entries below.
- `app/chart/page.tsx`: the picker grows two more steps. **Sign** shows
  the chosen form's actual wording (tokens resolved to the real patient
  name and today's date), the field value from the pick step, who is
  named as **Presented by** (reusing the office-wide presenter
  selector the treatment-plan flow already has — not a new picker,
  since it's the same fact: who sat with the patient), and the
  signature pad. **Done** reports the filed Document number and any
  procedure whose note failed to update (the filing itself is not
  rolled back if that happens — the PDF is already the record).
- On signing, every procedure the form covers gets a new structured
  first line on its note — `Consent Form Signed (Prosthodontic
  Treatment-Fixed) — Presented by <name> 12/12/2026 4:00PM` — via the
  same `get_note`/`set_note` round trip the Notes editor already uses.
  This is deliberately **not** the `Assistant:` line: per Shad, the
  assistant is whoever helped with the procedure clinically, not
  necessarily whoever handed the patient the tablet. A new
  `insertConsentLine` helper preserves an existing `Assistant:` line
  (if any) and inserts the consent line after it, rather than either
  line displacing the other.
- Also fixed the misc-field gap from the design conversation: the
  pick-step's value box now appears for a `misc` field too (label
  "Notes"), not only `toothNum` — it just never gets pre-filled, per
  the earlier decision.

**What was verified**
- `npm run build`: green.
- `od-consent` deployed ACTIVE at v3 source (platform reports v4 — an
  intermediate redeploy while iterating on `get_form_text`'s row
  grouping, not a second logical version).
- **Live, real end-to-end run by Shad**: picked a patient, ticked a
  diagnosed procedure, ran Consent through pick → read → sign → file.
  Reported back "worked" — no specifics on which form or any rough
  edges in the wording/PDF/note yet, so treat this as "the pipeline
  runs, doesn't error" rather than "every form's text reads cleanly
  and every layout edge case is fine."

**What is still open**
- Not yet tested end-to-end against a real patient: whether the
  grouped form text actually reads sensibly for each of the ~12-13
  forms, whether the PDF paginates cleanly for a longer form, and
  whether the note actually lands correctly in OpenDental.
- The layman renaming of OpenDental's consent-form Descriptions (to
  match `chart_categories` labels for the default match) — still
  Shad's task, still not started.
- `patient.Language` still isn't loaded anywhere in this page — the
  sign step's language toggle is manual-only, same gap as before.
- No retry path if the PDF files successfully but a procedure note
  write fails — the Done screen reports it, but fixing it means
  reopening that procedure's Notes editor and adding the line by hand.

**Next step**
- Shad: pick a patient with a diagnosed procedure, tick it, hit
  Consent, and run one real form through the whole flow — pick, read,
  sign, file — and report what's wrong with the wording, the PDF
  layout, or the note.

## 2026-09-19 (new session) — Consent-form design settled; first slice built (od-consent, form picker with default match)

**What changed**
- Read `FROM-CHAT-2026-09-18-B.md` (tablet consent / Topaz-matching
  signature storage) at session start, per protocol. Its gating
  question — can the API write a real signature into a SigBox field —
  is now answered definitively, and the design decision it was
  blocking has been made. Deleting the file below.
- **Read OpenDental's own GPL source** (github.com/OpenDental/opendental,
  branch `24_3`, close enough to these offices' 24.4.51) rather than
  relying on docs or forum posts: `Sheets.GetSignatureKey` →
  `SigBox.GetSignatureKeySheets` concatenates every non-SigBox field's
  `FieldValue` on the sheet (insertion order) and MD5-hashes it; the
  signature itself is `flag + base64(AES-128/Rijndael, zero IV, of the
  raw "x,y;x,y;..." pen-stroke string)`, confirmed against
  `SheetField.cs`'s own doc comment ("first char 0 or 1 for
  SigIsTopaz, rest is the signature"). A Topaz-flagged (`1`) signature
  is produced by Topaz's own proprietary SigPlusNET DLL — not
  reproducible outside it, OpenDental's own source says they don't
  know the format either. A non-Topaz (`0`) signature is fully public
  math (MD5 + AES-128) and could be computed byte-identical outside
  OpenDental. This didn't change the bottom line: writing either kind
  into `sheetfield.FieldValue` still requires `PUT /sheetfields`,
  which needs OD 25.2+ (not available here) and excludes SigBox even
  there — confirmed a second, independent time.
- **Decision made**: a local desktop-side agent (the only way to
  actually write into OpenDental's own Sheet/SigBox mechanism) was
  ruled out by Shad as too much ongoing maintenance. Accepted design
  is the PDF-in-Imaging path instead — tablet captures the signature,
  renders a PDF, files it into OpenDental's Imaging module — reusing
  the exact mechanism `od-tp-doc` already has for treatment plans. No
  unsigned consent Sheet gets created in OpenDental either; Sheets are
  not touched by this feature at all.
- **Confirmed OpenDental has no native procedure-code → consent-form
  link of any kind** — checked directly against `SheetDef.cs` and
  `SheetFieldDef.cs`: neither has a procedure column. Whatever mapping
  exists has to be Dental OS's own.
- **Live discovery, both offices** (temporary reuse of the existing,
  already-retired `od-consent-probe` slot, four short-lived redeploys,
  each retired back to its 410 stub immediately after use — nothing
  new committed to the repo):
  - The real list of consent forms: 13 at Downey, 12 at Maywood (no
    Media Consent there). Field composition **differs by office even
    for the same-named form** — e.g. "General Consent for Treatment"
    is a `misc` field at Downey but a `toothNum` field at Maywood;
    "Endodontic" has a tooth field at Downey, none at Maywood.
  - Which `toothNum` fields are actually designed for a list vs one
    tooth, from their own `UiLabelMobile`/size: Downey's Endodontic
    and Maywood's General Consent + Prosthodontic-Fixed are labeled
    "Tooth Number(s)" with generous field size; Maywood's Delivery
    Consent is a 45×19 box labeled singular "Tooth #".
  - Both offices already have a visible "Consent Forms" Imaging
    category (Downey DefNum 392, Maywood DefNum 324) — nothing new to
    create there; `od-consent`/future filing code resolves it by name
    at read time, same pattern `od-tp-doc` already uses for "Treatment
    Plans".
  - One production-data read was refused by the platform's own safety
    classifier ("Production Reads") — a check of real signed
    consent-sheet `FieldValue`s (length + leading flag character
    only, no PHI, no signature content). Not worked around; the
    source-code reading above answered the same question independently
    and is treated as sufficient.
- **Design settled with Shad, point by point**:
  - Single-select from the full form list per Consent-button press;
    user manually groups procedures needing the same form before
    pressing it (so a crown+filling case is two button presses, two
    picks, two signings — no batching logic needed).
  - The list defaults to a pre-selected form once that form's
    OpenDental Description is renamed to match a Dental OS
    `chart_categories.label` (Fillings, Crown & Bridge, Endo, ...) —
    the same category names the charting tile picker already groups
    procedures under. The rename is the only future step; no mapping
    table, no code change needed later.
  - `toothNum` fields get prefilled (joined, deduped tooth list from
    the ticked procedures); `misc` fields are never prefilled.
  - On signing (not built yet): a structured first line on every
    covered procedure's note, matching the existing `Assistant:`
    split/combine pattern, naming the form and timestamp — e.g.
    "Consent Form Signed (Prosthodontic Treatment-Fixed) 12/12/2026
    4:00PM".
  - No new Dental OS-side storage table for now — OpenDental (note +
    Imaging document) stays the sole system of record, matching every
    other feature in this app.
  - Language: `patient.Language` (the same field OpenDental's own
    sheet-filling logic reads) should default the form list to the
    Spanish ("- SP") set when set. Not wired yet — `Patient` doesn't
    carry `Language` today; the picker built this session defaults to
    English with a manual toggle instead.
- **Built and deployed the first slice** (selection only — no
  signature capture, PDF render, note-write, or Imaging upload; all
  of that is still ahead): new `supabase/functions/od-consent/index.ts`
  v1, one action `list_forms`. Given ticked procedures' codes, it
  resolves their shared `chart_tiles`/`chart_categories` category
  (reusing the same rule-reading approach as `od-chart`'s
  `codesInRule`, rewritten locally since functions here don't share
  code), reads the office's live consent sheetdefs, and returns which
  one (if any) matches by name. `app/chart/page.tsx` gets a `Consent`
  button in the Diags header (enabled once something is ticked) that
  opens a picker: every form as a radio option, the match pre-selected,
  an English/Spanish toggle, and — only for a `toothNum` form — an
  editable, prefilled tooth-list box. Its Continue button is
  deliberately disabled with a tooltip explaining why, since nothing
  past selection exists yet.

**What was verified**
- `npm run build`: green.
- `od-consent` deployed ACTIVE, then committed (`4a72193`) and pushed
  to `main` at Shad's request.
- Dev server started in the Browser pane and `/chart` returned 200;
  bounced to `/login` as expected with no session, matching how every
  other login-gated screen in this app has been left for Shad to
  verify live.
- All four temporary `od-consent-probe` redeploys were retired back to
  their 410 stub immediately after use; none were committed.
- **Live on Vercel, Shad clicked it for real and hit a bug**: the
  category lookup failed outright — "Tile lookup failed: column
  chart_tiles.bucket does not exist." `bucket` lives on
  `chart_categories`, not `chart_tiles` (confirmed against the schema
  pulled earlier this session); v1 filtered the wrong table. Fixed in
  `od-consent` → v2: the `bucket = "diagnosed"` filter moved onto the
  `chart_categories` read, and `chart_tiles` is scoped correctly
  already through the `category_id` list that query hands it. Deployed
  live immediately, then committed and pushed separately from the v1
  commit above.

**What is still open**
- The actual sign-and-file pipeline: signature capture on the tablet,
  rendering the PDF from OpenDental's own approved wording (the forms
  in OpenDental *are* the insurance-approved ones — confirmed by Shad,
  so the PDF should quote them, not invent new copy), the structured
  procedure-note write, and the Imaging upload. None of this is built.
- The layman renaming of OpenDental's consent-form Descriptions to
  match `chart_categories` labels — Shad's task, not started. Until
  it happens, the picker's default match will stay empty for every
  procedure.
- `patient.Language` isn't loaded anywhere in `app/chart/page.tsx`
  today (the `Patient` type has no `Language` field) — the picker's
  language toggle is manual-only for now. Small follow-up once the
  rest of the flow is worth building.
- Everything else already open in the archived entries is unchanged
  by this session; see `docs/status-archive.md` for that history
  (moved there this session, see below).

**Next step**
- Shad: rename the OpenDental consent-form Descriptions to match the
  `chart_categories` labels you want them to default against. Once
  that's done (or even before, if you'd rather build ahead of it),
  the next slice is the sign-and-file pipeline: signature capture,
  PDF render off OpenDental's approved text, the procedure-note line,
  and filing to the existing "Consent Forms" Imaging category.

---

## 2026-09-19 (same session, later) — Assistant dropdown was empty because employee is unused at Downey; switched to userod

**What changed**
- Shad reported the Assistant dropdown empty (just "— none —"). First
  pass added error surfacing (chart v23) rather than guessing at a
  fix, on the theory a silent failure was hiding the real cause.
- Second report after that shipped: still empty, still no error text.
  That absence of an error is itself the diagnosis — the query
  succeeded, `employee` genuinely returned zero rows. That table is
  OpenDental's separate payroll/HR module; this office has never used
  it, which is common. `assistants` (od-plan → v15) now reads
  `userod` instead — the same table `od-staff-login`'s username list
  already proved has real names (37, at this office) — joined to
  `employee` for a nicer full name on the rows where one happens to
  exist. `app/chart/page.tsx` → v24 follows the response shape's field
  rename (`employee_num` → `id`, since it's a UserNum now).

**What was verified**
- `npm run build`: green. `od-plan` v15 deployed.
- Not yet re-verified live — Shad to reopen a note and check the
  dropdown now populates.

**What is still open**
- Confirm the dropdown actually shows names now.
- Everything else in this file is unchanged.

**Next step**
- Shad: reopen a procedure's Notes editor and check the Assistant
  dropdown.

## 2026-09-19 (same session, one more) — Cleanup button wasn't showing for the failure Shad actually hit

**What changed**
- Shad re-ran Sync per the previous entry's instructions. The
  underlying fix held (no more "duplicate key" errors), but the
  "Clean up broken accounts" button never appeared, because round 2
  hit a *different* failure wording than round 1: `createUser` itself
  now refuses with "A user with this email address has already been
  registered" (since the 37 broken accounts from round 1 still exist
  in `auth.users`), rather than the "users row failed" wording round
  1 produced. The button's visibility check only watched for the
  second wording. `app/admin/users/page.tsx`: now shows the button on
  any skip at all, worded neutrally — running `cleanup_orphans` is
  harmless when nothing actually needs removing.

**What was verified**
- `npm run build`: green.

**What is still open**
- Same as the entry below: the 37 broken Downey accounts are still
  there. Shad needs one more pass — Sync, then the now-visible Clean
  up broken accounts button, then Sync again.

**Next step**
- Shad: Sync → Clean up broken accounts → Sync again, on
  `/admin/users` for Downey. Should this still not work, don't repeat
  the exact log-and-fix cycle a third time — apply the same diagnostic
  standard as the first bug (read the actual error, don't guess) before
  changing more code.

