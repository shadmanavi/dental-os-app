"use client";

// Chairside charting — v19.6
// A tablet screen for recording existing conditions and diagnosed
// treatment straight into OpenDental from the operatory.
//
// Changelog:
//   v19.6 Tapping a tooth-state tile again takes it off.
//
//       od-chart v15 made those tiles toggles, so the same button
//       marks a tooth primary and unmarks it. This is the screen
//       catching up: a cleared state has to leave the chart, not
//       join it.
//
//       Marking a tooth missing and then unmarking it previously
//       left the tooth struck through until the patient was closed
//       and reopened, because the missing list was only ever added
//       to. It is now removed from on a clear.
//
//       The session list says "removed" rather than listing a
//       deletion as though something had been entered, and offers
//       no undo — there is no id to undo, and the tile itself is
//       the way back.
//
//   v19.5 A refused write says what actually happened.
//
//       "OpenDental would not change D2950 #20" was every failure,
//       worded identically, with nothing to act on. The row it named
//       turned out to be holding the requested values when the
//       database was read afterwards, so the message was not even
//       reliably true — and there was no way to tell that from the
//       screen.
//
//       The information existed the whole time. od-plan reports the
//       field, what was asked for and what it read back, precisely
//       so a write that was accepted and quietly ignored can be told
//       apart from one that worked. Two places threw it away:
//       describeFailure only ever looked at error and detail, and
//       the bulk loop caught the exception and discarded the message
//       with it.
//
//       Both now carry it through, so the same failure reads
//       "Priority: asked for 742, OpenDental kept 146". Reasons are
//       deduplicated — twenty rows refused for one reason is one
//       sentence, not twenty.
//
//       Nothing about when a write is judged to have failed has
//       changed. This only makes the failure legible.
//
//   v19.4 The plan reads in plain English.
//
//       Every list showed OpenDental's Descript, which on a
//       standard code is the official ADA wording. "Resin-based
//       composite - one surface, anterior" is correct on a claim
//       and unreadable across a desk, and the patient is looking at
//       this screen while the coordinator talks.
//
//       od-plan v11 returns the layman's term the office wrote
//       during the code cleanup, so the same row now reads "Front
//       Filling 1". Four places change together, because they are
//       all the same plan rows: the Diags list, the treatment plan
//       tab, the confirmation dialog before a bulk change, and the
//       not-accepted list after signing. The printed plan follows,
//       since it is built from these rows.
//
//       The ADA description is still sent and still there. Nothing
//       that bills reads from this.
//
//       Roughly 350 codes were never named, so nameOf falls back to
//       the description rather than leaving a blank line.
//
//       The session list at the bottom is deliberately unchanged.
//       It reads from od-chart, which would need another OpenDental
//       call on every patient open to say the same thing.
//
//   v19.3 Baby teeth.
//
//       A slot marked primary in OpenDental offers two teeth, not
//       one: the permanent number and the baby letter, both live at
//       once. Patient 37139 at Downey has a crown and a buildup on
//       tooth 4 while A carries two fillings, so this is not a
//       tooth changing identity and the number must not be replaced.
//
//       The letter is drawn directly beneath its number as its own
//       tap target, matching where OpenDental puts it. Tapping 4
//       charts the adult tooth, tapping A charts the baby one, and
//       every tile behaves the same either way. Dots light per
//       tooth, so the adult and the baby tooth carry their own.
//
//       Only the twenty slots with a baby predecessor can show a
//       letter. od-chart decides which, and the letter arrives with
//       the patient rather than being worked out here — the mapping
//       lives in one place so the two cannot disagree.
//
//       A patient with no baby teeth sees no change at all, which
//       is most of them. The rows only grow taller where a letter
//       actually exists.
//
//       Fixed on the way past: every tooth-state entry was being
//       added to the missing list, so marking a tooth primary would
//       have struck it through as if it had been extracted. The two
//       are now told apart by what was actually written.
//
//   v19.2 One tap scales several quadrants.
//
//       v19.1 read a pair of lit quadrants one way only: upper right
//       with upper left was the upper arch and nothing else, so the
//       denture appeared and scaling disappeared. That was backwards
//       for the commoner job — full mouth scaling is four quadrants and
//       is done far more often than a denture is made.
//
//       A selection can now mean more than one thing at once, and the
//       tile decides which reading applies. With the two upper
//       quadrants lit, Complete denture takes it as the upper arch and
//       writes one procedure, while Scaling takes it as two quadrants
//       and writes two — one carrying UR, one carrying UL. All four lit
//       offers scaling across four and the whole-mouth work beside it.
//
//       Any combination of quadrants is now a valid selection. Upper
//       right with lower left is two quadrants of scaling; it is simply
//       not an arch, so no arch tile appears. Nothing is refused for
//       being an odd shape any more.
//
//       Each quadrant is a separate procedure in OpenDental, so one tap
//       produces several rows in the session list, each with its own
//       undo. A quadrant that OpenDental refuses is named, and the ones
//       that succeeded stay.
//
//       Needs od-chart v13 or later.
//   v19.1 Quadrants combine, and the buttons sit where the mouth is.
//
//       The four quadrant buttons are now multi-select, and two of them
//       together mean what they anatomically mean: upper right plus
//       upper left is the upper arch, lower right plus lower left is the
//       lower arch, and all four is the whole mouth. The separate arch
//       buttons are gone, because they said the same thing twice.
//
//       Quadrant work is still entered one quadrant at a time. Four
//       quadrants of scaling are four procedures in OpenDental, and
//       writing four in one tap needs partial-failure handling this
//       screen does not have yet, so with more than one quadrant lit the
//       quadrant tiles step aside and the arch tiles take their place.
//
//       A diagonal pair — upper right with lower left — is not a shape
//       any procedure is charted to, and the panel says so rather than
//       offering nothing without explanation.
//
//       Layout matches the mouth: the right quadrants stack on the left
//       of the screen and the left quadrants on the right, the way the
//       operator sees the patient, with Whole mouth between them.
//   v19 Region charting: quadrant, arch and whole mouth.
//
//       Half the work done at Downey does not belong to one tooth, and
//       none of it could be entered here. Exams, x-rays, cleanings,
//       night guards and referrals had no way in at all, and scaling
//       and root planing went in attached to whichever single tooth
//       happened to be lit, with no quadrant recorded.
//
//       Above the arches there is now a row of region buttons: upper
//       right, upper left, lower right, lower left, upper arch, lower
//       arch, whole mouth. Tapping one clears the lit tooth, and
//       tapping a tooth clears the region, so the screen is only ever
//       in one of the two states.
//
//       The panels then offer only work that fits what is selected.
//       With a tooth lit, fillings and crowns; with a quadrant,
//       scaling and root planing; with whole mouth, exams and x-rays
//       and cleanings. A tile is matched to a selection by the
//       treat_area OpenDental already holds against its code, so
//       nothing here has a list of codes in it.
//
//       Whole-mouth work is all diagnosed, so the existing panel says
//       so rather than sitting empty and looking broken.
//
//       Partial dentures cover a span of teeth and are left out. The
//       tiles do not appear, because od-chart v12 refuses them.
//
//       Needs od-chart v12 or later. Against v11 the region would be
//       ignored without an error and the work would file wrongly.
//   v1  Patient search, tooth chart, twin drill-down panels, surface
//       picker, session ledger with undo. Every OpenDental call goes
//       through the od-chart Edge Function.
//   v2  v1 swallowed the reason a commit failed. The Edge Function
//       already returns OpenDental's own message in `detail`, along with
//       the code it resolved, and v1 showed neither — the user saw
//       "OpenDental rejected that procedure" and nothing else. The error
//       banner now carries the detail and the resolved code.
//   v3  Existing entries now commit at ProcStatus EO, because OpenDental's
//       API will not accept EC on either POST or PUT. It also refuses to
//       DELETE a row at EO, so those rows cannot be undone from here. The
//       undo button is hidden on them and the row says so, rather than
//       offering an action that always fails.
//   v4  Adds a Today tab to the patient picker. Typing a surname was the
//       only way in, which is the wrong gesture for someone already
//       standing at the chair with the patient in front of them. Today
//       lists the day's appointments and one tap opens the chart.
//
//       Nothing downstream changed. A row calls the same openPatient()
//       the search results already called.
//
//       Four things about the data shaped this screen, all settled by
//       probing the live Downey database rather than assumed:
//
//       - The day arrives in one call. od-chart's schedule action reads
//         appointment joined to patient and operatory in a single
//         statement. The obvious alternative, one patient lookup per
//         row, took 6.7 seconds for 31 rows because OpenDental serves
//         those sequentially however they are fired.
//       - Broken appointments are greyed and unopenable. That status is
//         confirmed; the rest of OpenDental's status list is not, so
//         everything else stays tappable rather than being disabled on a
//         guess.
//       - Checked in, in the chair, and dismissed are derived from the
//         arrival, seating and dismissal timestamps rather than from the
//         status, which does not carry them.
//       - The date is computed in local time. The rest of this file used
//         toISOString(), which is UTC, and would have rolled the schedule
//         over to tomorrow every afternoon in California.
//
//   v5  Two things the office asked for after using v4.
//
//       - Search takes a date of birth or a patient number, not just a
//         surname. Today's schedule alone held two Mendozas and two
//         Chavezes, so a surname is often not enough to be sure. One
//         box still: digits are read as a patient number, a date as a
//         birthdate, anything else as a surname. The server decides,
//         so the rule lives in one place rather than two.
//
//       - Providers appear by name. The schedule carried only ProvNum,
//         so a row could say no more than "GP - YK". od-chart v5 joins
//         the provider table, and each row now names the dentist, or
//         the hygienist on a hygiene appointment.
//
//   v6  Shows what things cost, and lets a fee be changed for one
//       procedure on one visit.
//
//       od-chart v6 resolves the patient's fee schedule — insurance
//       first, then the patient record, which is where a membership
//       lands — so the screen can name which schedule is pricing this
//       visit rather than leaving it a mystery.
//
//       A crown is billed across two visits, and od-chart halves the
//       fee between them. The ledger therefore shows both lines, and a
//       committed crown reads as two rows rather than one.
//
//       The override sets the fee for this procedure, this patient,
//       this visit. It does not touch a fee schedule; changing what a
//       code costs for everyone stays in OpenDental. It is offered on
//       paired tiles, where the app is already stating a fee, and left
//       off everything else, where OpenDental prices the line and this
//       screen has no business interfering.
//
//       Not done here: a price on each tile before it is tapped. The
//       menu deliberately does not carry the code rule — resolving a
//       code is the server's job — so the browser cannot look a price
//       up. Showing one needs od-chart to send it per tile.
//   v7  Sized for the tablet it actually runs on, and the fee moved to
//       where it is read.
//
//       On a nine-inch tablet the two panels were stacking instead of
//       sitting side by side, so Existing filled the screen and
//       Diagnosed and the ledger were below the fold. The cause was the
//       breakpoint: the panels split at lg, which is 1024px, and the
//       tablet reports about 960. Everything now splits at md, and the
//       whole screen is denser — shorter teeth, smaller tiles, tighter
//       padding — with the roomier sizes kept for a desktop.
//
//       The fee is now edited by tapping it in the ledger. Asking for
//       it before committing was the wrong moment: the number that
//       needs changing is the one already on screen, and by then it
//       belongs to a procedure rather than to a tile. Editing it there
//       also drops the rule that a crown's two halves stay equal —
//       once both lines exist they are two ordinary procedures.
//   v8  The search box takes a first name. Two words are read as last
//       name then first, which matters because surnames repeat: one
//       day's schedule held two Mendozas and two Chavezes. The server
//       does the interpreting, so the rule lives in one place.
//   v9  Sized properly for the tablet this time.
//
//       v7 split the panels at md and moved the roomier sizes there
//       too, which was the wrong way round: the tablet reports about
//       960px, comfortably above md's 768, so it took the desktop
//       sizing and the tiles stayed large. Every size bump now happens
//       at xl instead, so the tablet keeps the compact set and only a
//       real monitor gets the generous one.
//
//       The tile grid also stretched to fill its panel, which made four
//       buttons occupy the height of eight. It packs to the top now,
//       and the panels size to their contents rather than to a floor.
//
//   v10 Category cards are shorter than tile cards. On the nine-inch
//       tablet they were sized like procedure tiles but carry only a
//       label and a count, so most of each card was empty and the list
//       ran longer than it needed to. 52px still clears the 44px a
//       gloved fingertip needs.
//
//   v11 Four tabs, because this screen now has two jobs rather than one.
//
//       Charting happens at the chair with the doctor. Presenting the
//       plan happens afterwards, sitting down, with the treatment
//       coordinator and the patient looking at the same screen. Those
//       are different conversations and they were sharing one tall
//       page: the coordinator had to scroll past the whole tile picker
//       to reach the ledger, with the patient watching.
//
//       Tabs rather than a wizard. The coordinator moves back and
//       forth while the patient asks questions, so entered work has to
//       stay one tap away rather than behind a Back step.
//
//       This version moves the existing screen into the Procedures tab
//       and changes nothing about how it works. Plan, Financing and
//       Sign are announced but empty; they arrive next, once the
//       restructure is proven not to have disturbed charting.
//
//       The tab strip only appears once a patient is open. There is
//       nothing to present before that.
//
//   v12 Pending work, and the Plan tab it feeds.
//
//       Until now this screen only wrote. It never read back what
//       OpenDental already had planned, so a coordinator opening a
//       patient saw a blank slate and no way to say "we planned a
//       crown on 12 last year". Every planned procedure now appears in
//       a Pending list under the ledger, with what it costs and what
//       insurance is expected to cover.
//
//       Where the money comes from matters. OpenDental freezes a plan's
//       figures only on a Saved treatment plan, and probing proved the
//       API cannot create one: POST accepts TPStatus "Saved" and files
//       the plan as Inactive regardless. The estimates live on the
//       procedures instead, in claimproc, and need no plan at all.
//       od-plan reads them. Nothing here is calculated.
//
//       Items arrive checked and are removed by subtraction, matching
//       how add-ons already behave. Checking is not acceptance and is
//       not written anywhere: it decides what the patient is shown on
//       the Plan tab.
//
//       Delete removes a procedure from OpenDental. It is a soft
//       delete — the row stays and moves to a deleted status — which
//       was confirmed by creating a planned procedure and removing it.
//       Only planned work can be deleted, so a completed procedure
//       cannot be lost from here.
//
//   v13 One list instead of two.
//
//       v12 showed pending work beside a session ledger, and the two
//       disagreed the moment anything was charted: a filling committed
//       at the chair appeared under This visit but not under Pending,
//       which had loaded when the patient was opened. Two lists, two
//       answers to the same question.
//
//       Pending is now the only list of planned work, read from
//       OpenDental and refreshed after every change, so what is on
//       screen is what OpenDental holds. Rows committed in this session
//       carry a small marker rather than living somewhere separate.
//
//       Every row can now be edited in place: the fee, the priority,
//       and whether it is on the plan at all. Both writes were proved
//       against the live server first — this API has accepted a field
//       with 200 and ignored it on three separate occasions, so a
//       control that appears to work and changes nothing is a real
//       risk rather than a theoretical one.
//
//       The priority list comes from the office being worked in. The
//       two offices number theirs differently: Downey's 148 is
//       "Not Accepted" and Maywood's is "Optional". A number carried
//       across would set the wrong thing and look right.
//
//       Existing conditions keep a strip of their own. They commit at
//       EO, are not planned treatment, and have no place on a plan the
//       patient is being shown.
//
//   v14 Three corrections and the presenter picker.
//
//       The session list is gone. v13 kept a strip for existing
//       conditions, but everything a coordinator presents is planned
//       treatment, and two panels invited the same confusion the merge
//       was meant to end. Existing conditions still commit and still
//       show as marks on the tooth chart; they are not treatment and do
//       not belong on a plan.
//
//       New rows now arrive checked. v13 remembered which rows were
//       selected, so a procedure charted after the list loaded was not
//       in that set and appeared unchecked — the opposite of the rule
//       everything else follows, where items arrive on and are removed
//       by subtraction. What is remembered now is what the coordinator
//       has taken off, which makes arriving checked the default rather
//       than a case to handle.
//
//       The presenter is named on the plan. OpenDental will not accept
//       one through its API — UserNumPresenter is read-only there, and
//       proved so against the live server — so the name is carried on
//       the plan the patient signs rather than written to the treatment
//       plan record. The list is OpenDental's own users, because that is
//       who the office recognises.
//
//   v18.5 The authorization control is gone, and an autho row is left
//       alone when a plan is signed.
//
//       The office un-hid Auth Needed, Auth Approved and Auth Denied in
//       OpenDental's own priority list, so authorization is recorded
//       where the office already records it and this screen no longer
//       needs a control of its own. The per-row dropdown and the
//       Pre-Auth bulk button are removed. The priority dropdown picks
//       the three values up unaided, because od-plan builds that list
//       from whatever is not hidden — no code here names them.
//
//       signAndFile would otherwise have refused the whole plan. Its
//       unpaired guard aborts a signature when a ticked row carries a
//       priority with no Acc counterpart, and "Auth Needed" has none, so
//       a single autho procedure blocked the signature for every
//       ordinary row beside it. That guard was written when no autho
//       value existed in the list; un-hiding them made it reachable at
//       both offices on the same day. Autho labels are now exempt from
//       it and from the flip, and pass through untouched.
//
//       Untouched is the point. What a carrier decided is not this
//       screen's to overwrite, and there is no accepted counterpart to
//       move it to. Accepting a plan that contains one files it and
//       prints it; the priority stays exactly as the biller left it.
//
//       Matched by name, never by DefNum. Downey's 159 is Auth Denied
//       and Maywood's 159 is Auth Approved — the same number, opposite
//       answers. /^auth\b/i covers all three at both offices and takes
//       a future "Auth Pending" along with it.
//
//       od-plan is unchanged and stays at v8. Its set_note action and
//       the preauth field it returns are simply no longer called.
//
//       Still open, and deliberately not answered here: what accepting
//       an autho procedure should do, especially a denied one.
//
//   v18.4 The letterhead no longer carries the fax.
//
//       treatmentPlanPdf v7 prints one field per line and dropped the
//       fax, so there is nothing to pass. The column is still selected
//       and still synced — the office row is read whole and the fax is
//       real data — it simply is not part of the printed block.
//
//   v18.3 The treatment plan's letterhead comes from OpenDental.
//
//       The plan used to print the office's Dental OS name and a blank
//       line where the phone number belonged, because officePhone was
//       being passed as an empty string. It now passes the whole office
//       row — name, street, city, state, zip, phone, fax and email —
//       every field of which od_sync_offices() wrote from OpenDental's
//       preference table.
//
//       That makes OpenDental the source of the letterhead as well as
//       the clinical and financial data, which is the standing rule
//       here. An office that moves, changes its number or fixes its fax
//       does it once, in the place it already maintains, and this
//       document follows without anybody touching the app.
//
//       Both practices' clinic tables came back empty when this was
//       probed, so there is no per-location layer to read: on each
//       server the practice is the location.
//
//   v18.2 The office's lists all load together, and Close says what it
//       closes.
//
//       Two more reads move off the patient open, for the same reason
//       the priority and diagnosis lists did in v18: they belong to the
//       office and were being re-read for every person in the chair.
//
//       The provider list was the expensive one. od-chart's open called
//       fetchAllProviders, which pages /providers at 100 with
//       overlapping pages — three or four serialised OpenDental round
//       trips per patient, at Downey's 284 providers, to fill a
//       dropdown that changes when somebody is hired. It is a providers
//       action now, read once per office. The presenter list is one
//       call and moves for the same reason.
//
//       The patient's own provider is untouched. It never came from
//       that list: od-chart resolves it from today's appointment or the
//       patient record, both read on open, and it still is.
//
//       Close is now Close patient. It sits beside a provider dropdown
//       and a presenter dropdown, and one word of it read as "close the
//       screen" rather than "finish with this person".
//
//   v18.1 Four corrections from the first run of v18 against a plan
//       that exceeds its maximum.
//
//       The deductible was never applied. od-plan sent one coverage
//       category per procedure and the plan states its waivers against
//       different ones, so the lookup missed every time and the $50
//       landed on the first x-ray instead of the first crown — which
//       moved where the maximum ran out and put every figure after it
//       out by the same amount. Fixed in od-plan v9 and
//       benefitAllocation v3; this file passes the category list
//       through.
//
//       The deleted flag was being truncated away on rows with a long
//       description, which is exactly the row where it matters. The
//       description now gives way to it rather than the other way
//       round.
//
//       Row contents shifted mid-delete and settled back. The action
//       button's label goes Delete, then an ellipsis, then Gone —
//       three widths — and the description beside it is flex-1, so
//       every control between them moved. The button is a fixed width
//       now.
//
//       The practice's acceptance wording appears above the signature
//       pad, the same words the PDF carries.
//
//   v18 The annual maximum is applied here, the office's lists are read
//       once, deleted rows stand still, and the panels fold away.
//
//       OpenDental's stored insurance estimates are correct for the
//       last ordering a human looked at in its Windows client, and
//       silently wrong after anything is changed at the chair. Nothing
//       in the API recalculates them. So this screen applies the
//       remaining annual maximum itself, over OpenDental's own uncapped
//       per-procedure figures (claimproc.BaseEst), in the order
//       OpenDental consumes benefit: priority ItemOrder, unprioritised
//       last. lib/benefitAllocation.ts does the arithmetic and matches
//       OpenDental row for row on a plan that exceeds its maximum.
//
//       The allocation runs over the whole plan, not the ticked subset.
//       Un-ticking a procedure does not give its benefit back — that
//       work is still planned, and the maximum is still spoken for. The
//       plan and the PDF then show the allocated figures for whatever
//       is ticked.
//
//       Rows a human overrode by hand are passed through untouched. A
//       number somebody typed is not this screen's to recompute.
//
//       The priority and diagnosis lists now load once when the office
//       is chosen, not with every patient. They belong to the office
//       and change about once a year; od-plan v8 takes include_lists
//       false and this asks for it. Still never carried across an
//       office switch — Downey's DefNum 148 is "Not Accepted" and
//       Maywood's is "Optional".
//
//       Display order is frozen. A reload after a write keeps the order
//       already on screen and appends anything new; only Refresh
//       re-reads the order from OpenDental. A priority changed
//       mid-conversation used to move the row out from under the
//       finger that changed it, into whatever the next tap landed on.
//
//       A deleted row stays where it was, flagged, until Refresh, for
//       the same reason. The tooth chart is the opposite case: its dot
//       clears immediately, because the mark is the whole point of the
//       chart. v17 kept session marks per tooth, which could not be
//       taken back, so a deleted procedure left its tooth lit until the
//       patient was closed and opened again. Marks are now held per
//       procedure.
//
//       Existing and Diagnosed fold away. In portrait, and on the
//       eleven-inch class the office runs, the two panels push the
//       planned list below the fold.
//
//   v17 The patient signs, and the plan can be seen before it is filed.
//
//       The signature pad was built in v15 and never mounted. It sits
//       on the Sign tab above the buttons, because a pad below "Accept
//       and file" invites filing first and signing after — which files
//       an unsigned plan and looks like a bug rather than an order of
//       operations.
//
//       An unsigned plan still files. Blocking it would strand the
//       common case: a patient who wants to take the estimate home and
//       think. The filed document is named "Treatment Plan Signed" or
//       "Treatment Plan Unsigned" so the chart says which without
//       anyone opening it.
//
//       The pad reports null rather than a blank image when nothing was
//       drawn. A blank PNG is a real image and would pass a truthiness
//       check, filing an unsigned plan as signed.
//
//       Preview and Print render through buildPdf, the same function
//       filing uses, so the paper and the chart cannot disagree. Both
//       work before signing and after filing. The blob URL is revoked
//       when it is replaced and when the patient is closed: an
//       unrevoked URL pins a PDF full of PHI in memory for the life of
//       the tab.
//
//       Acceptance is no longer only "Diag N to Acc N". A priority
//       named X pairs to one named "X Acc", so "Optional" now becomes
//       "Optional Acc" and declines to invent anything. The rule is
//       general rather than a list with Optional in it, so a priority
//       added next year works by being named for it. Four places tested
//       for a Diag row and all four now ask the same question: does
//       this label have an accepted counterpart.
//
//       Finding that out moved the pairing hooks above the ones that
//       consume them — they were being read during render before they
//       were declared, which is a crash waiting for the office to add
//       the definition.
//
//       D0001 is hidden everywhere. It is the office's documentation
//       code — a $0 line the doctor hangs a note on, not work and not a
//       charge. On a plan it reads as a procedure the patient then asks
//       about, and being tickable it could reach a signed PDF. It is
//       filtered where the rows arrive rather than where they are
//       drawn, so totals, selection and the document cannot see a row
//       the screen does not. od-chart calls the field procCode and
//       od-plan calls it proc_code; filtering the wrong one matches
//       nothing and fails silently, so both are filtered by name.
//
//   v16.2 The authorization order becomes a column.
//
//       Four bulk controls now sit directly above the four per-row
//       controls they act on — authorization, diagnosis, priority,
//       delete — in that order left to right. A bulk control above its
//       own column needs no explaining; one floating elsewhere in the
//       title row does.
//
//       Authorization is a dropdown per row rather than only a bulk
//       button, because changing one procedure should not require
//       ticking it first. It writes through the same set_note call the
//       bulk button uses, so there is one path to OpenDental and not
//       two.
//
//       The amber "autho needed" pill on the second line is gone. The
//       dropdown states the same fact and can change it; two controls
//       reporting one field is how a screen starts to disagree with
//       itself.
//
//       Diagnosis is visible again at every width. v16 hid it below the
//       xl breakpoint to buy horizontal room, which left the tablet —
//       the device this screen exists for — with no diagnosis control
//       at all. Nobody chose that; it fell out of a width fix. The
//       selects are narrower on small screens instead, and the
//       procedure description was already one truncated line.
//
//       Still an order, not a status. Nothing here reports what a
//       carrier answered: that lives on a claim, and at the moment a
//       coordinator ticks this, no claim exists.
//
//   v16.1 Three corrections from the first PC run of v16.
//
//       The master checkbox was sitting mid-row. It was in an ml-auto
//       group beside Refresh, and in a wrapping flex row that put it
//       nowhere in particular — visually detached from the column of
//       checkboxes it controls. It now leads the title row, directly
//       above that column, and Refresh keeps the right edge on its own.
//
//       "Diagnosed or Incomplete" is now "Diags". The long form said
//       what the panel holds; the short form is what the office calls
//       it, and the title row has bulk controls to fit.
//
//       The preauthorization marker was blue, which is this screen's
//       colour for existing work and said nothing. It is amber now, and
//       a pill rather than plain text so it does not blur into the
//       amber "not billed to insurance" beside it. Red was considered
//       and rejected: red is being kept for a denial, which is a
//       different fact, and one that can be true at the same time as
//       this one. An order to seek authorization and a carrier's answer
//       are two axes, not two values on one.
//
//   v16 The action bar moves into the title row, the plan gets signed,
//       and every write leaves through one door.
//
//       The bulk controls used to appear only once something was
//       ticked, which meant the coordinator had to discover them by
//       accident. They now sit in the title row above the columns they
//       act on, greyed until a row is selected, so the screen says what
//       it can do before being asked. The master checkbox replaces the
//       Clear button — it is the same gesture in one control, and it
//       shows an indeterminate state when only some rows are ticked.
//
//       Bulk diagnosis is new. v15 could set a diagnosis one row at a
//       time but not several, which is the wrong way round: a quadrant
//       of caries is one finding entered once, not four.
//
//       Pre-Auth is new and is a toggle. Whether a procedure needs a
//       preauthorization is the one fact about it OpenDental holds
//       nowhere — no field on the code, the fee schedule, the plan, the
//       carrier or the benefit, and no preauth table. It is written as
//       a fixed token in the procedure note, and od-plan v6 both writes
//       and removes it. A one-way mark would be worse than none: a
//       procedure flagged by accident would sit on the biller's
//       worklist forever.
//
//       Presented by moved to the Procedures tab, beside the provider.
//       It belongs where the rest of "who is in the room" already is,
//       and the Plan tab is what the patient reads.
//
//       Signing files the plan. The button flips every Diag row to its
//       Acc twin, then builds the PDF and files it into OpenDental's
//       Imaging module under Treatment Plans. Both steps are named
//       before they run. There is no signature capture yet, so the plan
//       files unsigned and says so on the page — v17 adds the canvas.
//
//       Patient accepted has gone from the Plan tab. Two buttons that
//       both flipped Diag to Acc, only one of which filed anything, was
//       an invitation to accept a plan and file nothing.
//
//       After filing, the Plan tab stops showing Diag work and shows
//       what was signed: the accepted rows, the document it was filed
//       as, and anything left at Diag named as declined and staying on
//       the plan. That last part matters — declined work is not deleted
//       here, it is re-presented next visit, and the screen should say
//       so rather than appear to have lost it.
//
//       The plan is what is ticked. It used to be every row at a Diag
//       priority, chosen for the coordinator, which read well until the
//       patient who accepted a crown in 2023 and never came back walked
//       in again: that crown is at Acc, still undone, and nothing on
//       this screen could put it in front of them a second time.
//       Ticking a row is now the whole rule — Diag, Acc or unprioritised
//       — so re-presenting unfinished work is the same gesture as
//       presenting new work.
//
//       Rows arrive unticked. Everything else in this app arrives
//       checked and is removed by subtraction, and this deliberately
//       does not: the same checkbox drives Delete, and seventeen rows
//       pre-ticked beside a delete button is a bad trade for one saved
//       tap. The master checkbox is one tap when the answer really is
//       everything.
//
//       Only Acc rows dim now. The rule used to dim anything not at
//       Diag, written when Acc barely existed; it meant accepted work
//       — the most settled thing on the chart — looked like the least.
//       Unprioritised rows are no longer dimmed either: nothing has
//       been decided about them, which is not the same as being done
//       with them.
//
//       Signing only flips what needs flipping. A ticked Acc row is
//       already accepted and is left alone; a ticked row with no
//       priority stays as it is, because this screen does not get to
//       invent a sequence number nobody chose. Only Diag rows move, and
//       only a Diag row without an Acc twin is an error worth stopping
//       for.
//
//       Pending is now Diagnosed or Incomplete, which is what the list
//       has always held: OpenDental is asked for ProcStatus 1 and
//       nothing else, so completed work has never appeared here.
//
//       The presenter is remembered per office. There is one treatment
//       coordinator per office most days, and re-choosing the same name
//       after every patient is a tax on the common case. It survives a
//       patient change and a tablet sleeping. It is a name from
//       OpenDental's user list, not patient data, so nothing here
//       breaks the rule about what may be stored on the tablet.
//
//       Tapping Search now puts the cursor in the box and raises the
//       keyboard. It never did: the handler only switched tabs, and the
//       one focus() in the file sat behind a 50ms timer, which is why
//       focus worked after closing a patient and not after tapping the
//       tab. iOS opens the keyboard only when focus() runs
//       synchronously inside the tap gesture, so a timer was never
//       going to work on the iPad however long it waited.
//
//       That means the input has to exist at the moment of the tap, so
//       both panels are mounted at all times and the inactive one is
//       moved off screen rather than switched off. display:none was not
//       an option: an element that is not displayed cannot take focus,
//       which would have left the fix in exactly the same place.
//
//       aria-hidden is deliberately not set on the hidden panel. It
//       would be the honest thing to say about a panel nobody can see,
//       but marking a container hidden while it holds the element about
//       to be focused is worse than saying nothing.
//
//       Every OpenDental write now goes through one function. It is the
//       same synchronous call it was, and nothing about the behaviour
//       changed. It exists so the write queue can be slotted in behind
//       it later without touching thirty call sites. The funnel returns
//       OpenDental's own honoured / stored / present values untouched:
//       this API has accepted a write and ignored it four separate
//       times, and a funnel that reported only success or failure would
//       hide exactly the case worth catching.
//
//   v15 Diagnosis, bulk actions, and the Diag/Acc scheme.
//
//       The priority list stopped being a mixture. Both offices now
//       carry Diag 1-4 and Acc 1-4 and nothing else that this screen
//       writes: the sequence number survives acceptance, so Diag 2
//       becomes Acc 2 and the order the treatment was meant to happen
//       in is not lost at the moment the patient says yes. Authorization
//       left the priority field entirely — OpenDental tracks a preauth
//       on the claim, and a label mirroring it by hand was always going
//       to drift.
//
//       Nothing here hardcodes those numbers. The office's own list
//       arrives with the plan and the pairing is done by name: the Acc
//       entry whose number matches the Diag entry's. Downey's Acc 1 is
//       DefNum 734 and Maywood's is 669, so a hardcoded number would
//       set the wrong thing at one of them and look right at both.
//
//       The checkbox changed meaning. It used to say "this is on the
//       plan", which the priority field now says better and durably.
//       It selects rows for a bulk action instead, and clears once the
//       action runs. What the patient is shown is every Diag row, so a
//       procedure declined at an earlier visit is re-presented rather
//       than quietly dropped.
//
//       Bulk actions confirm; the per-row dropdowns do not. The rule is
//       scope, not danger: one row is one deliberate tap, several rows
//       is worth a look at the list first. Delete is a soft delete in
//       OpenDental, but nobody at a chair knows that, so it names every
//       procedure it is about to take off.
//
//       Diagnosis is the clinical finding behind the procedure, and it
//       is OpenDental's own Dx field, proved writable on ProcNum
//       1081990 before this was built. It is a definition list like
//       priority, per office, and validated server-side. OpenDental
//       stores a one or two letter abbreviation beside each name and
//       prints it in the progress notes; this screen shows the full
//       name, because the coordinator entering it while the doctor
//       dictates should not have to decode Nc.
//
//       Accepting is a button on the Plan tab in this version. It flips
//       every Diag row to its Acc twin, which is exactly what the
//       signature will call once the Sign tab is wired — the mechanism
//       is here so it can be tested before the canvas and the PDF are
//       in front of a patient.
//
// Design notes:
//   - Dark, high-contrast, large targets. The user is standing, gloved,
//     and not going to type.
//   - Panels swap in place rather than cascading. Drill in, drill back.
//   - The fee shown on a committed row is whatever OpenDental returned.
//     This screen never calculates one.
//   - Undo removes the entry from OpenDental, not just from the list.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buildTreatmentPlanPdf } from "@/lib/treatmentPlanPdf";
import type { PlanOffice } from "@/lib/treatmentPlanPdf";
import { CONSENT_TEXT } from "@/lib/treatmentPlanPdf";
import {
  allocateBenefit,
  type AllocatableRow,
  type AllocatedRow,
  type PlanBenefit,
} from "@/lib/benefitAllocation";
import SignaturePad from "@/app/components/SignaturePad";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
// The office as Dental OS holds it. Everything past slug is letterhead,
// written into public.offices by od_sync_offices() from OpenDental's own
// preference table — never typed here. Nullable because a row that has
// not been synced yet is a real state, and the plan should print a short
// header rather than the word "null".
type Office = {
  id: string;
  name: string;
  slug: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
};

type PatientHit = {
  PatNum: number;
  LName: string;
  FName: string;
  Preferred: string;
  Birthdate: string;
  ChartNumber: string;
};

type Patient = PatientHit & { PriProv: number | null; priProvAbbr: string };

type Provider = {
  ProvNum: number;
  Abbr: string;
  LName: string;
  FName: string;
  Suffix: string;
};

type Procedure = {
  ProcNum: number;
  ProcStatus: string;
  ProcDate: string;
  ToothNum: string;
  Surf: string;
  procCode: string;
  descript: string;
  ProcFee: string | null;
  provAbbr: string;
};

// ---------------------------------------------------------------------
// Where a procedure lives in the mouth
//
// treat_area is OpenDental's own procedurecode.TreatArea, carried onto
// the tile unchanged. It decides what has to be selected before a tile
// can be tapped, so no list of codes lives on this screen.
// ---------------------------------------------------------------------
type Shape = "tooth" | "quadrant" | "arch" | "mouth" | "range";

const REGION_LABELS: Record<string, string> = {
  UR: "Upper right",
  UL: "Upper left",
  LR: "Lower right",
  LL: "Lower left",
  U: "Upper arch",
  L: "Lower arch",
};

// Universal numbering. 1–8 upper right, 9–16 upper left, 17–24 lower
// left, 25–32 lower right.
const QUADRANT_TEETH: Record<string, number[]> = {
  UR: [1, 2, 3, 4, 5, 6, 7, 8],
  UL: [9, 10, 11, 12, 13, 14, 15, 16],
  LL: [17, 18, 19, 20, 21, 22, 23, 24],
  LR: [25, 26, 27, 28, 29, 30, 31, 32],
};

function shapeOfTreatArea(treatArea: number | null): Shape {
  if (treatArea === 1 || treatArea === 2) return "tooth";
  if (treatArea === 4) return "quadrant";
  if (treatArea === 6) return "arch";
  if (treatArea === 7) return "range";
  return "mouth";
}

type Tile = {
  id: string;
  label: string;
  entry_kind: "procedure" | "tooth_initial";
  initial_type: string | null;
  needs_surfaces: boolean;
  treat_area: number | null;
  delivery_code: string | null;
  is_paired: boolean;
  addons: TileAddon[];
};

type TileAddon = {
  id: string;
  label: string;
  proc_code: string;
  default_on: boolean;
};

type FeeSchedule = {
  source: "insurance plan" | "patient record" | "nothing set";
  fee_sched: number;
  fee_sched_name: string;
};

type Category = {
  id: string;
  bucket: "existing" | "diagnosed";
  label: string;
  tiles: Tile[];
};

// A slot offering a baby tooth as well as the permanent one.
// od-chart reads the flag from OpenDental and derives the letter;
// has_letter is false for the twelve positions that have no baby
// predecessor, where the flag exists but there is nothing to draw.
type PrimaryTooth = {
  tooth_num: string;
  letter: string;
  has_letter: boolean;
};

type ResolvedProvider = {
  source: string;
  ProvNum: number | null;
  provAbbr: string;
};

type LedgerEntry = {
  key: string;
  bucket: "existing" | "diagnosed";
  entry_kind: "procedure" | "tooth_initial";
  od_id: number | null;
  label: string;
  code: string;
  descript: string;
  tooth: string;
  surf: string;
  fee: string | null;
  provAbbr: string;
  removing: boolean;
  // OpenDental refuses to delete a procedure at EO, so an existing entry
  // has to be removed in OpenDental itself.
  undoable: boolean;
};

// What to call a procedure on screen. The office's plain-English
// name where there is one, the ADA description where there is not.
//
// One place rather than the same conditional in five render blocks:
// the confirmation dialog and the printed plan have to agree with
// the list the coordinator ticked from, or a patient signs for
// something worded differently to what they were shown.
function nameOf(row: { layman?: string; descript: string }): string {
  const layman = (row.layman ?? "").trim();
  return layman === "" ? row.descript : layman;
}

// A planned procedure as od-plan returns it. Every money field came
// from OpenDental; none of it is worked out here.
type PlanRow = {
  od_id: number;
  tooth: string;
  surf: string;
  proc_code: string;
  descript: string;
  // The office's own plain-English name, written during the code
  // cleanup. Absent when talking to od-plan v10 or earlier, and
  // empty on the codes nobody named — nameOf covers both.
  layman?: string;
  prov_abbr: string;
  proc_date: string;
  priority_num: number;
  priority_label: string;
  // OpenDental's Dx: the clinical finding behind the procedure. Zero
  // is how it stores "none chosen", and the label is then empty.
  dx_num: number;
  dx_label: string;
  fee: number;
  // null means OpenDental prints an X: not billed to insurance.
  allowed: number | null;
  pri_ins: number;
  sec_ins: number;
  // OpenDental's estimate before any limitation. The annual maximum is
  // applied over these rather than over pri_ins and sec_ins, which
  // already carry whatever cap was in force the last time its Windows
  // client recalculated — and that ordering is not necessarily the one
  // on screen now.
  pri_base: number;
  sec_base: number;
  // True when somebody typed a figure over the estimate by hand. Those
  // rows are never recomputed here.
  has_override: boolean;
  // Every coverage category this procedure's code falls in. A code
  // sits inside several spans at once, and which of them matters is
  // decided by what the plan names — so all of them travel, and the
  // waiver test is a membership test.
  cov_cat_nums: number[];
  // The narrowest live category, for showing a person. Nothing decides
  // money from this one.
  cov_cat_num: number;
  write_off: number;
  deductible: number;
  pat: number;
  covered: boolean;
  no_bill_ins: boolean;
  estimated: boolean;
};

// A definition list belonging to one office. Never hardcoded: the two
// offices number theirs differently, and the same DefNum means
// different things at each. Priority and diagnosis share the shape.
type DefOption = {
  def_num: number;
  label: string;
  order: number;
};

// What a bulk action will do, held while the confirmation is on screen.
// Nothing is written until it is confirmed.
type PendingAction =
  | { kind: "priority"; def_num: number; label: string }
  | { kind: "dx"; def_num: number; label: string }
  | { kind: "delete" };

// What a write into OpenDental came back with. Passed through from the
// Edge Function untouched — honoured is false when OpenDental took the
// call and kept its own value, which it has done on four separate
// fields, and anything that swallowed it would hide the one failure
// worth knowing about.
type OdWriteResult = {
  ok: boolean;
  honoured?: boolean;
  present?: boolean;
  stored?: unknown;
  [key: string]: unknown;
};

// An OpenDental user, for naming who presented the plan.
type Presenter = {
  user_num: number;
  name: string;
};

// A plan filed into OpenDental during this session. Held in memory
// only: OpenDental is the record, and reopening the patient tomorrow
// should read the plan back from there rather than from anything this
// screen remembered.
type FiledPlan = {
  doc_num: number | null;
  filed_at: string;
  presenter: string;
  od_ids: number[];
  signed: boolean;
};

type PlanTotals = {
  fee: number;
  allowed: number;
  pri_ins: number;
  sec_ins: number;
  write_off: number;
  pat: number;
};

type Bucket = "existing" | "diagnosed";

// A tooth lit by this visit. Held per procedure rather than per tooth:
// a mark that only knew its tooth could not be taken back when that
// procedure was deleted.
type SessionMark = {
  od_id: number | null;
  tooth: string;
  bucket: Bucket;
};

type NavState = {
  category: Category | null;
  pending: Tile | null;
  surfaces: string[];
};

// One row of the day. Shaped by the Edge Function so this file never
// has to know that AptStatus is an integer or that an unset timestamp
// arrives as midnight.
type Appointment = {
  apt_num: number;
  pat_num: number;
  time: string;
  apt_datetime: string;
  duration_minutes: number;
  status: string;
  status_num: number;
  status_verified: boolean;
  openable: boolean;
  presence: "not_arrived" | "checked_in" | "in_chair" | "dismissed";
  operatory_num: number;
  operatory_name: string;
  operatory_abbr: string;
  operatory_hidden: boolean;
  prov_num: number;
  prov_abbr: string;
  prov_name: string;
  prov_hyg: number;
  hyg_abbr: string;
  hyg_name: string;
  is_hygiene: boolean;
  procedures: string;
  last_name: string;
  first_name: string;
  preferred_name: string;
  display_name: string;
};

type OperatoryChip = {
  num: number;
  name: string;
  abbr: string;
  count: number;
};

type PickerTab = "today" | "search";

// The four stages of presenting a plan. Procedures is the chairside
// screen; the other three belong to the conversation that follows.
type WorkTab = "procedures" | "plan" | "financing" | "sign";

const WORK_TABS: { id: WorkTab; label: string }[] = [
  { id: "procedures", label: "Procedures" },
  { id: "plan", label: "Plan" },
  { id: "financing", label: "Financing" },
  { id: "sign", label: "Sign" },
];

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
// The Diag/Acc scheme, matched by name rather than by number. The
// office owns its own list and the DefNums differ between them, so the
// pairing has to be read at runtime: Diag 2 flips to whichever entry is
// called Acc 2 at the office being worked in. Adding Diag 5 later is a
// change in OpenDental, not here.
// Codes this screen never shows, whatever OpenDental returns.
//
// D0001 is the office's documentation code: the doctor enters it to
// hang a note on, not to do work or charge for it. On a treatment plan
// it is noise at best — a $0 line a patient reads as a procedure and
// asks about — and it is tickable, so it can end up on a presented
// plan and in the signed PDF.
//
// Filtered where the rows arrive rather than where they are drawn, so
// nothing downstream — totals, selection, the PDF, the flip to Acc —
// can see a row the screen does not.
const HIDDEN_PROC_CODES = new Set(["D0001"]);

const isHiddenCode = (code: string): boolean =>
  HIDDEN_PROC_CODES.has(code.trim().toUpperCase());

// "Acc 2" is the accepted form of "Diag 2". The number is what pairs
// them, and it is read off the label rather than from a DefNum because
// the same DefNum means different things at the two offices.
const ACC_RE = /^acc\s*(\d+)$/i;

// "Optional Acc" and anything else named for what it accepts. Kept
// separate from ACC_RE so the numbered scheme still matches first:
// "Acc 2" would otherwise be read as accepting a priority called "Acc",
// which does not exist.
const ACC_SUFFIX_RE = /^(.+?)\s+acc$/i;

// Whether a priority label means the work has been accepted. Both
// schemes count, and this is what dims a settled row.
const isAcceptedLabel = (label: string): boolean => {
  const trimmed = label.trim();
  return ACC_RE.test(trimmed) || ACC_SUFFIX_RE.test(trimmed);
};

// "Auth Needed", "Auth Approved", "Auth Denied" — the office's record of
// where a preauthorization stands. A stage of the insurance conversation
// rather than a stage of acceptance, and the two share the one priority
// field, so a row sitting on one of these is not a Diag row waiting to
// become an Acc row. It is left exactly as it is.
//
// Read off the label, like the Acc pairing above, and for the same
// reason: Downey's DefNum 159 is Auth Denied and Maywood's 159 is Auth
// Approved. Keying on the number would write the opposite answer at one
// of the two offices.
const AUTH_RE = /^auth\b/i;

const isAuthLabel = (label: string): boolean => AUTH_RE.test(label.trim());

const UPPER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LOWER = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];
const SURFACES = ["M", "O", "D", "B", "L"];

const EXISTING_STATUSES = new Set(["C", "EC", "EO", "Cn"]);

// AptStatus 5. The one status confirmed against live data as a row that
// must not be opened.
const BROKEN = 5;

// Local time, not UTC. toISOString() would roll the schedule to tomorrow
// from mid-afternoon onwards in California.
function localISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftISODate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return localISODate(date);
}

// The office reads and writes MM/DD/YYYY, which is what OpenDental
// shows in its own Select Patient window, so that is what this screen
// shows too. Values arrive from OpenDental as ISO and sometimes carry a
// time; only the date part is wanted.
function usDate(value: string): string {
  const raw = String(value ?? "").trim();
  if (raw === "") return "";

  const datePart = raw.includes("T") ? raw.split("T")[0] : raw.split(" ")[0];
  const iso = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  // Anything that is not the ISO form is passed through untouched
  // rather than mangled — an unrecognised date is better shown as it
  // came than silently rewritten.
  if (!iso) return raw;

  const [, y, m, d] = iso;

  // OpenDental writes 0001-01-01 for "no date". Showing that as
  // 01/01/0001 would look like real data.
  if (y === "0001") return "";

  return `${m}/${d}/${y}`;
}

function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  return `${weekday} ${usDate(iso)}`;
}

function clockLabel(time: string): string {
  const [hRaw, minute] = time.split(":");
  const hour = Number(hRaw);
  if (!Number.isFinite(hour)) return time;
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${minute} ${suffix}`;
}

// Who the patient is actually seeing. On a hygiene appointment that is
// the hygienist, otherwise the dentist. Falls back to initials when a
// provider has no name recorded, and to nothing at all rather than
// printing an empty separator.
function whoIsSeeingThem(appt: Appointment): string {
  if (appt.is_hygiene) {
    const hygienist = appt.hyg_name || appt.hyg_abbr;
    if (hygienist !== "") return `${hygienist} · hygiene`;
    return "hygiene";
  }

  return appt.prov_name || appt.prov_abbr || "";
}

// Whole dollars where the cents are zero, because a fee schedule is
// mostly round numbers and "$1,366" reads faster than "$1,366.00".
function money(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return rounded % 1 === 0
    ? `$${rounded.toLocaleString()}`
    : `$${rounded.toFixed(2)}`;
}

// OpenDental's own rejection text arrives in `detail`. Without it the
// user is told only that something failed, which is what v1 did.
function describeFailure(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;

  const parts: string[] = [];
  const main = String(p.error ?? "").trim();
  if (main !== "") parts.push(main);

  const detail = p.detail;
  const detailText = typeof detail === "string"
    ? detail.trim()
    : detail !== undefined && detail !== null
      ? JSON.stringify(detail)
      : "";
  if (detailText !== "" && detailText !== main) parts.push(detailText);

  const code = String(p.resolved_code ?? "").trim();
  if (code !== "") parts.push(`(code ${code})`);

  // What was asked for against what the database actually holds.
  // od-plan sends these on every field write and they are the whole
  // point of reading the row back — without them, a write OpenDental
  // accepted and ignored is indistinguishable from one that worked,
  // which is the failure this app exists to catch.
  const field = String(p.field ?? "").trim();
  const requested = p.requested;
  const stored = p.stored;

  if (
    field !== "" && requested !== undefined && requested !== null &&
    stored !== undefined && stored !== null
  ) {
    parts.push(
      `${field}: asked for ${String(requested)}, ` +
        `OpenDental kept ${String(stored)}`,
    );
  }

  return parts.length > 0 ? parts.join(" — ") : "That didn't work.";
}

// The pill on the right of a schedule row. Broken wins over presence,
// because a broken appointment nobody arrived for is still broken.
function statusPill(appt: Appointment): { label: string; className: string } {
  if (appt.status_num === BROKEN) {
    return {
      label: "Broken",
      className: "border-[#E4674F]/45 bg-[#E4674F]/12 text-[#E4674F]",
    };
  }

  if (appt.presence === "in_chair") {
    return {
      label: "In chair",
      className: "border-[#F0A93B] bg-[#F0A93B] text-[#0B1719]",
    };
  }

  if (appt.presence === "checked_in") {
    return {
      label: "Checked in",
      className: "border-[#79B4C4]/50 bg-[#79B4C4]/15 text-[#79B4C4]",
    };
  }

  if (appt.presence === "dismissed") {
    return {
      label: "Dismissed",
      className: "border-[#2C4E54] bg-transparent text-[#5E7B80]",
    };
  }

  return {
    label: appt.status,
    className: "border-[#2C4E54] bg-transparent text-[#8AA6AB]",
  };
}

// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Totals strip
//
// The same column set OpenDental prints, so a coordinator holding the
// printed plan beside the tablet is reading the same row.
// ---------------------------------------------------------------------
function TotalsStrip({
  totals,
  emphasisePatient = false,
}: {
  totals: PlanTotals;
  emphasisePatient?: boolean;
}) {
  const cells: { label: string; value: number; strong?: boolean }[] = [
    { label: "Fee", value: totals.fee },
    { label: "Allowed", value: totals.allowed },
    { label: "Pri Ins", value: totals.pri_ins },
    { label: "Sec Ins", value: totals.sec_ins },
    { label: "Patient", value: totals.pat, strong: true },
  ];

  return (
    <div className="grid grid-cols-5 gap-px overflow-hidden rounded-lg border border-[#2C4E54] bg-[#2C4E54]">
      {cells.map((c) => (
        <div
          key={c.label}
          className={`px-2 py-1.5 text-right ${
            c.strong && emphasisePatient ? "bg-[#193034]" : "bg-[#122326]"
          }`}
        >
          <div className="text-[10px] uppercase tracking-wide text-[#8AA6AB]">
            {c.label}
          </div>
          <div
            className={`font-mono text-[13px] ${
              c.strong ? "font-bold text-[#F0A93B]" : "text-[#EDF3F1]"
            }`}
          >
            {money(c.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ChartPage() {
  const router = useRouter();

  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSlug, setOfficeSlug] = useState("");
  const [booting, setBooting] = useState(true);

  const [pickerTab, setPickerTab] = useState<PickerTab>("today");
  const [workTab, setWorkTab] = useState<WorkTab>("procedures");

  // Pending work, read back from OpenDental rather than remembered here.
  const [planRows, setPlanRows] = useState<PlanRow[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [removingId, setRemovingId] = useState<number | null>(null);

  // Rows ticked for a bulk action. This is a selection, not a state:
  // it clears once the action runs, and it says nothing about whether
  // the patient accepted anything. Acceptance lives in the priority
  // field, where it survives a reload and OpenDental can see it too.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // The bulk action awaiting confirmation, and whether it is running.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Signing: flip Diag to Acc, then file the PDF. One button, both
  // steps, named before it runs.
  const [signing, setSigning] = useState(false);
  const [signStep, setSignStep] = useState("");
  const [filed, setFiled] = useState<FiledPlan | null>(null);

  // The patient's signature as a PNG data URL, or null when the pad is
  // empty. Null and "blank image" are different things: the pad returns
  // null when nothing was drawn, because a blank PNG is a real image and
  // would pass a truthiness check, filing an unsigned plan as signed.
  //
  // Memory only, and cleared with the patient. It is a picture of a
  // person's signature and has no business surviving the visit.
  const [signature, setSignature] = useState<string | null>(null);

  // The last PDF this screen built, held so Preview and Print show the
  // same bytes that were filed rather than rebuilding and hoping they
  // match. Never persisted — it is a PDF full of PHI.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // The master checkbox needs a ref: indeterminate is a property, not
  // an attribute, so React cannot set it from JSX.
  const masterRef = useRef<HTMLInputElement>(null);

  // Options for the dropdowns, from this office's own definitions.
  // Read when the office loads rather than with each patient: they
  // belong to the office, not the person in the chair.
  const [priorities, setPriorities] = useState<DefOption[]>([]);
  const [diagnoses, setDiagnoses] = useState<DefOption[]>([]);

  // The patient's insurance plans as OpenDental states them: annual
  // maximum, deductible, category waivers and what has been paid this
  // year. The ceiling this screen applies comes from here.
  const [benefits, setBenefits] = useState<PlanBenefit[]>([]);

  // The order the planned list is drawn in, held apart from the rows
  // themselves. A reload after a write keeps this and appends anything
  // new; Refresh replaces it with OpenDental's order. Rows must not
  // move under the finger that is working on them.
  const [displayOrder, setDisplayOrder] = useState<number[]>([]);

  // Rows deleted during this session. They are gone from OpenDental and
  // gone from planRows, and are kept here only so the list can go on
  // showing them, flagged, until Refresh.
  const [deletedRows, setDeletedRows] = useState<PlanRow[]>([]);

  // The same deletions, as ids that outlive Refresh, so the tooth chart
  // stops drawing a dot for work that is no longer there.
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());

  // Whether each charting panel is open. Both start open; on a portrait
  // tablet they are what pushes the planned list off the screen.
  const [panelOpen, setPanelOpen] = useState<Record<Bucket, boolean>>({
    existing: true,
    diagnosed: true,
  });

  // Who is presenting. OpenDental will not take this through its API —
  // UserNumPresenter is accepted and ignored, proved against the live
  // server — so the name rides on the plan the patient signs instead.
  const [presenters, setPresenters] = useState<Presenter[]>([]);
  const [presenterNum, setPresenterNum] = useState<number | null>(null);

  // Procedures written during this session, so a row can say so without
  // needing a list of its own.
  const [sessionIds, setSessionIds] = useState<Set<number>>(new Set());

  // Inline editing on a pending row.
  const [editingPlanFee, setEditingPlanFee] = useState<number | null>(null);
  const [planFeeDraft, setPlanFeeDraft] = useState("");
  const [savingRow, setSavingRow] = useState<number | null>(null);

  const [scheduleDate, setScheduleDate] = useState(() => localISODate(new Date()));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [operatories, setOperatories] = useState<OperatoryChip[]>([]);
  const [opFilter, setOpFilter] = useState<number | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [patient, setPatient] = useState<Patient | null>(null);
  const [loadingPatient, setLoadingPatient] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [missingTeeth, setMissingTeeth] = useState<string[]>([]);
  const [primaryTeeth, setPrimaryTeeth] = useState<PrimaryTooth[]>([]);
  const [menu, setMenu] = useState<Category[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [resolvedProv, setResolvedProv] = useState<ResolvedProvider | null>(null);
  const [feeSchedule, setFeeSchedule] = useState<FeeSchedule | null>(null);
  const [provOverride, setProvOverride] = useState<number | null>(null);

  const [tooth, setTooth] = useState<string>("");
  // Quadrants light independently and combine. Never set at the same
  // time as a tooth.
  const [quads, setQuads] = useState<string[]>([]);
  const [wholeMouth, setWholeMouth] = useState(false);
  const [nav, setNav] = useState<
    Record<Bucket, NavState>
  >({
    existing: { category: null, pending: null, surfaces: [] },
    diagnosed: { category: null, pending: null, surfaces: [] },
  });

  // What this visit has marked, so a tooth lights up the moment it is
  // charted rather than after a reload. The session ledger used to
  // carry this; it is the only job of it that outlived v13.
  //
  // A list of procedures, not a map of teeth. v17 held the latter and
  // could not unmark anything: deleting the only procedure on a tooth
  // left the dot lit until the patient was closed.
  const [sessionMarks, setSessionMarks] = useState<SessionMark[]>([]);

  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");

  // -------------------------------------------------------------------
  // Session and offices
  // -------------------------------------------------------------------
  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const supabase = createClient();
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) {
          router.replace("/login");
          return;
        }

        const { data, error } = await supabase
          .from("offices")
          // One unbroken literal on purpose. supabase-js infers the row
          // type from this string, and a concatenated one defeats the
          // parser — the result comes back as GenericStringError[]
          // instead of Office[].
          .select("id, name, slug, address_line1, address_line2, city, state, postal_code, phone, fax, email")
          .eq("is_active", true)
          .order("name");

        if (!active) return;

        if (error) {
          setLoadError(error.message);
        } else {
          const rows = data ?? [];
          setOffices(rows);
          if (rows.length > 0) setOfficeSlug(rows[0].slug);
        }
      } catch (caught) {
        if (active) {
          setLoadError(
            caught instanceof Error ? caught.message : "Couldn't start up.",
          );
        }
      } finally {
        if (active) setBooting(false);
      }
    }

    boot();
    return () => {
      active = false;
    };
  }, [router]);

  // -------------------------------------------------------------------
  // One place for every call into the Edge Function
  // -------------------------------------------------------------------
  const callChart = useCallback(
    async (payload: Record<string, unknown>) => {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("od-chart", {
        body: { office: officeSlug, ...payload },
      });

      if (error) {
        // A non-2xx from the function arrives here with the body attached.
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            throw new Error(describeFailure(parsed));
          } catch (inner) {
            if (inner instanceof Error && inner.message !== "") throw inner;
          }
        }
        throw new Error("The server didn't respond as expected.");
      }

      if (!data?.ok) throw new Error(describeFailure(data));
      return data;
    },
    [officeSlug],
  );

  // -------------------------------------------------------------------
  // The presentation side lives in its own Edge Function
  //
  // od-chart serves the chair and od-plan serves the conversation
  // afterwards. Separate functions so a change to one cannot break the
  // other; the same error handling either way.
  // -------------------------------------------------------------------
  const callPlan = useCallback(
    async (payload: Record<string, unknown>) => {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("od-plan", {
        body: { office: officeSlug, ...payload },
      });

      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            throw new Error(describeFailure(parsed));
          } catch (inner) {
            if (inner instanceof Error && inner.message !== "") throw inner;
          }
        }
        throw new Error("The server didn't respond as expected.");
      }

      if (!data?.ok) throw new Error(describeFailure(data));
      return data;
    },
    [officeSlug],
  );

  // Filing the signed plan is its own function, because it takes a
  // document rather than a procedure and has nothing to say about
  // treatment.
  const callDoc = useCallback(
    async (payload: Record<string, unknown>) => {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("od-tp-doc", {
        body: { office: officeSlug, ...payload },
      });

      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            throw new Error(describeFailure(parsed));
          } catch (inner) {
            if (inner instanceof Error && inner.message !== "") throw inner;
          }
        }
        throw new Error("The server didn't respond as expected.");
      }

      if (!data?.ok) throw new Error(describeFailure(data));
      return data;
    },
    [officeSlug],
  );

  // -------------------------------------------------------------------
  // One door for every write into OpenDental
  //
  // Reads still call callPlan directly. Writes do not: they come
  // through here, all of them, so there is one place to change when the
  // write queue arrives rather than one place per control.
  //
  // It is deliberately thin. It does not retry, does not reorder, does
  // not batch — OpenDental has no batch endpoint and serialises
  // concurrent calls anyway — and it does not interpret the result. The
  // Edge Function's honoured / stored / present come back untouched,
  // because a write this API accepted and ignored looks exactly like a
  // write that worked unless somebody checks.
  // -------------------------------------------------------------------
  const odWrite = useCallback(
    async (payload: Record<string, unknown>): Promise<OdWriteResult> => {
      const data = await callPlan(payload);
      return data as OdWriteResult;
    },
    [callPlan],
  );

  // -------------------------------------------------------------------
  // Pending work
  //
  // Read every time rather than cached, because committing at the chair
  // changes it and a stale list would show the patient the wrong plan.
  // Everything arrives checked; the coordinator removes rather than adds.
  // -------------------------------------------------------------------
  const loadPlan = useCallback(
    async (patNum: number, keepChoices = false, resort = false) => {
      setPlanLoading(true);
      setPlanError("");

      try {
        const data = await callPlan({
          action: "plan",
          pat_num: patNum,
          // The priority and diagnosis lists come with the office, not
          // the patient. Asking for them again on every open spent
          // about a second and a half of a serialised API's time on two
          // lists that had not moved.
          include_lists: false,
        });
        const rows = ((data.procedures ?? []) as PlanRow[]).filter(
          (r) => !isHiddenCode(r.proc_code),
        );

        setPlanRows(rows);
        setBenefits((data.benefits ?? []) as PlanBenefit[]);

        // Order is frozen unless this is a Refresh. OpenDental returns
        // the plan in the order it consumes benefit — priority
        // ItemOrder, unprioritised last — and a priority changed
        // mid-conversation would otherwise move that row somewhere else
        // in the list the instant it was saved.
        const serverIds = rows.map((r) => r.od_id);

        setDisplayOrder((previous) => {
          if (resort || previous.length === 0) return serverIds;
          const known = new Set(previous);
          return [...previous, ...serverIds.filter((id) => !known.has(id))];
        });

        // Refresh is also what clears the deleted markers. Until then
        // they hold their place in the list.
        if (resort) setDeletedRows([]);

        // A selection belongs to the rows that were on screen when it
        // was made, so a fresh patient clears it.
        if (!keepChoices) setSelected(new Set());
      } catch (caught) {
        setPlanError(
          caught instanceof Error
            ? caught.message
            : "Couldn't read this patient's planned treatment.",
        );
      } finally {
        setPlanLoading(false);
      }
    },
    [callPlan],
  );

  // The office's priority and diagnosis lists. One read when the office
  // is chosen, then held: they are definition lists that change about
  // once a year, and they are the same for every patient in the
  // building.
  //
  // Never carried across an office switch. The same DefNum means
  // different things at the two — Downey's 148 is "Not Accepted" and
  // Maywood's is "Optional" — so the lists are cleared and re-read the
  // moment the office changes, rather than lingering and setting the
  // wrong thing without ever looking wrong.
  useEffect(() => {
    if (officeSlug === "") return;

    let active = true;
    setPriorities([]);
    setDiagnoses([]);

    (async () => {
      try {
        const data = await callPlan({ action: "lists" });
        if (!active) return;
        setPriorities((data.priorities ?? []) as DefOption[]);
        setDiagnoses((data.diagnoses ?? []) as DefOption[]);
      } catch {
        // Empty dropdowns rather than a blocked chair. Changing office
        // and changing back re-reads them.
      }
    })();

    return () => {
      active = false;
    };
  }, [officeSlug, callPlan]);

  // The office's staff and providers. Both belong to the office rather
  // than the patient, and both were being read on every open.
  //
  // The provider list is the one that cost: od-chart pages /providers
  // at 100 with overlapping pages, so Downey's 284 are three or four
  // serialised OpenDental calls — per patient, for a dropdown that
  // changes when somebody is hired.
  //
  // Cleared first and re-read on every office change. The two offices
  // keep separate user and provider tables, and a ProvNum or a UserNum
  // from one means something else at the other.
  useEffect(() => {
    if (officeSlug === "") return;

    let active = true;
    setPresenters([]);
    setProviders([]);

    (async () => {
      try {
        const data = await callPlan({ action: "presenters" });
        if (active) setPresenters((data.presenters ?? []) as Presenter[]);
      } catch {
        // A missing presenter list is not worth blocking the chair
        // over. The plan files without a name on it.
      }

      try {
        const data = await callChart({ action: "providers" });
        if (active) setProviders((data.providers ?? []) as Provider[]);
      } catch {
        // The override dropdown falls back to the provider od-chart
        // resolved for this patient, which is the right one nearly
        // always.
      }
    })();

    return () => {
      active = false;
    };
  }, [officeSlug, callPlan, callChart]);

  // A row that OpenDental has just deleted leaves this screen in two
  // different speeds, on purpose.
  //
  // In the list it stays exactly where it was, flagged, until Refresh.
  // A row that vanished under the finger that deleted it pulls the next
  // row up into whatever that finger taps next, and the next tap is
  // usually another delete.
  //
  // On the tooth chart the dot goes now. The mark is the whole point of
  // the chart, and a lit tooth with nothing on it is a lie about the
  // patient rather than a stale list.
  //
  // No reload: OpenDental was just told, and asking it to say so again
  // is a round trip on an API that serialises them.
  function markDeleted(rows: PlanRow[]) {
    if (rows.length === 0) return;

    const ids = new Set(rows.map((r) => r.od_id));

    setDeletedRows((previous) => [
      ...previous.filter((r) => !ids.has(r.od_id)),
      ...rows,
    ]);
    setRemovedIds((previous) => {
      const next = new Set(previous);
      for (const id of ids) next.add(id);
      return next;
    });
    setPlanRows((previous) => previous.filter((r) => !ids.has(r.od_id)));
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  // Removing a procedure takes it off the plan in OpenDental. It is a
  // soft delete there, so nothing is destroyed, but it is still a write
  // to the clinical record and is confirmed first.
  async function removePending(row: PlanRow) {
    if (patient === null) return;

    const what = `${row.proc_code}${row.tooth === "" ? "" : ` on ${row.tooth}`}`;
    const sure = window.confirm(
      `Remove ${what} from this patient's treatment plan in OpenDental?`,
    );
    if (!sure) return;

    setRemovingId(row.od_id);
    setPlanError("");

    try {
      await odWrite({
        action: "remove",
        pat_num: patient.PatNum,
        od_id: row.od_id,
      });
      markDeleted([row]);
    } catch (caught) {
      setPlanError(
        caught instanceof Error ? caught.message : "Couldn't remove that.",
      );
    } finally {
      setRemovingId(null);
    }
  }

  // Both of these write one field and then reload, so the screen shows
  // what OpenDental stored rather than what was asked for. od-plan
  // reports honoured:false if it kept its own value.
  async function setRowPriority(row: PlanRow, defNum: number) {
    if (patient === null || defNum === row.priority_num) return;

    setSavingRow(row.od_id);
    setPlanError("");

    try {
      await odWrite({
        action: "set_priority",
        pat_num: patient.PatNum,
        od_id: row.od_id,
        priority: defNum,
      });
      await loadPlan(patient.PatNum, true);
    } catch (caught) {
      setPlanError(
        caught instanceof Error ? caught.message : "Couldn't set that priority.",
      );
    } finally {
      setSavingRow(null);
    }
  }

  async function savePlanFee(row: PlanRow) {
    if (patient === null) return;

    const parsed = Number(planFeeDraft.replace(/[^0-9.]/g, ""));

    if (!Number.isFinite(parsed) || parsed < 0) {
      setPlanError("Type a fee of zero or more.");
      return;
    }

    setEditingPlanFee(null);

    if (Math.round(parsed * 100) === Math.round(row.fee * 100)) return;

    setSavingRow(row.od_id);
    setPlanError("");

    try {
      await odWrite({
        action: "set_fee",
        pat_num: patient.PatNum,
        od_id: row.od_id,
        fee: parsed,
      });
      await loadPlan(patient.PatNum, true);
    } catch (caught) {
      setPlanError(
        caught instanceof Error ? caught.message : "Couldn't change that fee.",
      );
    } finally {
      setSavingRow(null);
    }
  }

  // Diagnosis writes the same way, and was proved on the live server
  // first: ProcNum 1081990 took Dx 115 and read back as Caries.
  async function setRowDx(row: PlanRow, defNum: number) {
    if (patient === null || defNum === row.dx_num) return;

    setSavingRow(row.od_id);
    setPlanError("");

    try {
      await odWrite({
        action: "set_dx",
        pat_num: patient.PatNum,
        od_id: row.od_id,
        dx: defNum,
      });
      await loadPlan(patient.PatNum, true);
    } catch (caught) {
      setPlanError(
        caught instanceof Error ? caught.message : "Couldn't set that diagnosis.",
      );
    } finally {
      setSavingRow(null);
    }
  }

  function toggleSelected(odId: number) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(odId)) next.delete(odId);
      else next.add(odId);
      return next;
    });
  }

  // The master checkbox. Anything ticked means the gesture is "clear",
  // which is the button it replaced; nothing ticked means "select all".
  function toggleAll() {
    setSelected((previous) =>
      previous.size > 0 ? new Set() : new Set(planRows.map((r) => r.od_id))
    );
  }

  // One OpenDental call per procedure: there is no batch endpoint, and
  // a failure partway through leaves the rows before it changed. Rather
  // than pretend otherwise, the failures are named and the list is
  // reloaded so the screen shows what actually happened.
  async function runPendingAction() {
    if (patient === null || pendingAction === null) return;

    const rows = planRows.filter((r) => selected.has(r.od_id));
    if (rows.length === 0) {
      setPendingAction(null);
      return;
    }

    setBulkBusy(true);
    setPlanError("");

    const failed: string[] = [];
    const reasons: string[] = [];
    const removed: PlanRow[] = [];

    for (const row of rows) {
      try {
        if (pendingAction.kind === "delete") {
          await odWrite({
            action: "remove",
            pat_num: patient.PatNum,
            od_id: row.od_id,
          });
          removed.push(row);
        } else if (pendingAction.kind === "dx") {
          await odWrite({
            action: "set_dx",
            pat_num: patient.PatNum,
            od_id: row.od_id,
            dx: pendingAction.def_num,
          });
        } else {
          await odWrite({
            action: "set_priority",
            pat_num: patient.PatNum,
            od_id: row.od_id,
            priority: pendingAction.def_num,
          });
        }
      } catch (caught) {
        failed.push(
          `${row.proc_code}${row.tooth === "" ? "" : ` #${row.tooth}`}`,
        );
        // The reason, not just the row. Kept separately and
        // deduplicated: twenty rows refused for the same reason is
        // one sentence worth reading, not twenty worth scrolling.
        const why = caught instanceof Error ? caught.message.trim() : "";
        if (why !== "" && !reasons.includes(why)) reasons.push(why);
      }
    }

    setBulkBusy(false);
    setPendingAction(null);
    setSelected(new Set());

    if (failed.length > 0) {
      const named = `OpenDental would not change ${failed.join(", ")}.`;
      const why = reasons.length > 0 ? ` ${reasons.join(" ")}` : "";
      const rest = rows.length > failed.length
        ? " Everything else went through."
        : "";

      setPlanError(`${named}${why}${rest}`);
    }

    // A delete is settled here rather than by re-reading. The rows hold
    // their place with a flag until Refresh, and OpenDental has already
    // said yes to each one.
    if (pendingAction.kind === "delete") {
      markDeleted(removed);
      return;
    }

    await loadPlan(patient.PatNum, true);
  }

  // Signing. Two writes in order: every Diag row moves to its Acc twin,
  // keeping its number so the sequence the treatment was planned in
  // survives the patient saying yes; then the plan is built as a PDF and
  // filed into OpenDental's Imaging module.
  //
  // The flip goes first on purpose. If the upload fails the acceptance
  // still stands in OpenDental, which is the record that matters, and
  // the document can be filed again. The reverse order would leave a
  // filed plan claiming an acceptance that never got written.
  //
  // The PDF is built from the rows as they were before the flip, with
  // the Acc label substituted. Reading them back first would mean
  // waiting on a reload for figures that a priority change cannot
  // alter.
  async function signAndFile() {
    if (patient === null || chosenRows.length === 0 || signing) return;

    const rows = chosenRows;

    // Only a row with an accepted counterpart moves — "Diag 2" to
    // "Acc 2", "Optional" to "Optional Acc". A ticked row that is
    // already accepted is being re-presented, not re-accepted; a ticked
    // row with no priority stays unprioritised, because a sequence
    // number nobody chose is not this screen's to invent.
    //
    // An autho row has no counterpart and is not looking for one. It is
    // filed and printed with everything else and its priority is left
    // where the biller put it.
    const toFlip = rows.filter(
      (r) =>
        !isAuthLabel(r.priority_label) &&
        accForLabel(r.priority_label) !== null,
    );

    // toFlip is built from rows that already have a counterpart, so
    // this is empty by construction. It is kept because the filter
    // above is the only thing making that true, and a later change to
    // it should fail loudly here rather than silently accept work into
    // a priority that does not exist.
    //
    // Autho labels are exempt. Without the exemption this guard aborts
    // the entire signature — not just the autho row, the whole plan —
    // the moment one ticked procedure sits at Auth Needed.
    const unpaired = rows.filter(
      (r) =>
        r.priority_label.trim() !== "" &&
        !isAuthLabel(r.priority_label) &&
        accForLabel(r.priority_label) === null &&
        !isAcceptedLabel(r.priority_label),
    );

    if (unpaired.length > 0) {
      const names = Array.from(
        new Set(unpaired.map((r) => r.priority_label)),
      ).join(", ");
      setPlanError(
        `This office has no Acc priority matching ${names}. Add it in OpenDental first.`,
      );
      return;
    }

    setSigning(true);
    setPlanError("");
    setSignStep(
      toFlip.length === 0
        ? "Building the plan…"
        : "Accepting in OpenDental…",
    );

    const failed: string[] = [];

    for (const row of toFlip) {
      const target = accForLabel(row.priority_label);
      if (target === null) continue;

      try {
        await odWrite({
          action: "set_priority",
          pat_num: patient.PatNum,
          od_id: row.od_id,
          priority: target,
        });
      } catch {
        failed.push(
          `${row.proc_code}${row.tooth === "" ? "" : ` #${row.tooth}`}`,
        );
      }
    }

    // A plan that is only partly accepted is not a plan to file. The
    // rows that did go through stay accepted — they are written and
    // this screen does not undo clinical writes — but the document
    // would misstate what OpenDental holds.
    if (failed.length > 0) {
      setSigning(false);
      setSignStep("");
      setPlanError(
        `OpenDental would not accept ${failed.join(", ")}, so nothing was filed. ` +
          `Everything else is accepted. Refresh and try again.`,
      );
      await loadPlan(patient.PatNum, true);
      return;
    }

    setSignStep("Building the plan…");

    const presenterName =
      presenters.find((p) => p.user_num === presenterNum)?.name ?? "";

    try {
      const base64 = buildPdf(rows, signature);

      setSignStep("Filing into OpenDental…");

      // The name says whether it was signed. A chart holding two plans
      // for one patient should not need opening to tell which one the
      // patient put their name to, and "Signed" or "Unsigned" is read
      // at a glance in OpenDental's document list.
      const signedWord = signature === null ? "Unsigned" : "Signed";

      const result = await callDoc({
        action: "upload",
        patNum: patient.PatNum,
        base64,
        description:
          `Treatment Plan ${signedWord} ` +
          `${usDate(localISODate(new Date()))}`,
      });

      setFiled({
        doc_num:
          typeof result.docNum === "number" ? result.docNum : null,
        filed_at: new Date().toISOString(),
        presenter: presenterName,
        od_ids: rows.map((r) => r.od_id),
        signed: signature !== null,
      });
    } catch (caught) {
      setPlanError(
        caught instanceof Error
          ? `Accepted in OpenDental, but the plan was not filed: ${caught.message}`
          : "Accepted in OpenDental, but the plan was not filed.",
      );
    } finally {
      setSigning(false);
      setSignStep("");
    }

    await loadPlan(patient.PatNum, true);
  }

  // -------------------------------------------------------------------
  // Today's schedule
  //
  // One call returns the whole day already shaped. The date is always
  // sent explicitly so the server never has to guess the timezone.
  // -------------------------------------------------------------------
  const loadSchedule = useCallback(
    async (date: string) => {
      if (officeSlug === "") return;

      setScheduleLoading(true);
      setScheduleError("");

      try {
        const data = await callChart({ action: "schedule", date });
        setAppointments(data.appointments ?? []);
        setOperatories(data.operatories ?? []);
      } catch (caught) {
        setAppointments([]);
        setOperatories([]);
        setScheduleError(
          caught instanceof Error ? caught.message : "Couldn't load the schedule.",
        );
      } finally {
        setScheduleLoading(false);
      }
    },
    [callChart, officeSlug],
  );

  // Reload whenever the office or the day changes, but only while the
  // picker is actually on screen.
  useEffect(() => {
    if (patient !== null) return;
    if (pickerTab !== "today") return;
    if (officeSlug === "") return;

    setOpFilter(null);
    loadSchedule(scheduleDate);
  }, [officeSlug, scheduleDate, pickerTab, patient, loadSchedule]);

  const visibleAppointments = useMemo(
    () =>
      opFilter === null
        ? appointments
        : appointments.filter((a) => a.operatory_num === opFilter),
    [appointments, opFilter],
  );

  const brokenCount = useMemo(
    () => visibleAppointments.filter((a) => a.status_num === BROKEN).length,
    [visibleAppointments],
  );

  const isToday = scheduleDate === localISODate(new Date());

  // -------------------------------------------------------------------
  // Patient search
  // -------------------------------------------------------------------
  async function runSearch() {
    const q = query.trim();

    // Digits are a patient number and a single one is legitimate, so the
    // two-letter minimum only applies to names. The server does the real
    // interpreting; this is just to avoid a pointless round trip.
    const looksNumeric = /^\d+$/.test(q);

    if (q === "") {
      setSearchError("Type a surname, a date of birth, or a patient number.");
      return;
    }

    if (!looksNumeric && q.length < 2) {
      setSearchError("Type at least two letters of the last name.");
      return;
    }

    setSearching(true);
    setSearchError("");
    setHits([]);

    try {
      const data = await callChart({ action: "patients", query: q });
      setHits(data.patients ?? []);

      if ((data.patients ?? []).length === 0) {
        // Saying which reading was used makes a wrong guess obvious:
        // a mistyped date searched as a surname explains itself.
        const by = String(data.searched_by ?? "that");
        setSearchError(`No patients matched by ${by}.`);
      }
    } catch (caught) {
      setSearchError(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function openPatient(patNum: number) {
    setLoadingPatient(true);
    setLoadError("");
    setCommitError("");

    try {
      const data = await callChart({ action: "open", pat_num: patNum });

      setPatient(data.patient);
      // procCode here, proc_code on the plan rows: od-chart and od-plan
      // name the same field differently, and filtering on the wrong one
      // fails silently by matching nothing.
      setProcedures(
        ((data.procedures ?? []) as Procedure[]).filter(
          (p) => !isHiddenCode(p.procCode ?? ""),
        ),
      );
      setMissingTeeth(data.missing_teeth ?? []);
      setPrimaryTeeth(
        (data.primary_teeth ?? []) as PrimaryTooth[],
      );
      setMenu(data.menu ?? []);
      // The provider list is not read here any more — it is the
      // office's, loaded once when the office was chosen. The provider
      // resolved for this patient still is, and still comes from
      // today's appointment or the patient's own record.
      setResolvedProv(data.resolved_provider ?? null);
      setFeeSchedule(data.fee_schedule ?? null);
      setProvOverride(null);
      setTooth("");
      setQuads([]);
      setWholeMouth(false);
      resetNav();
      setHits([]);
      setQuery("");

      // Not awaited. The chart is usable the moment it is drawn, and
      // pending work is for the conversation afterwards.
      void loadPlan(patNum);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Couldn't open that patient.");
    } finally {
      setLoadingPatient(false);
    }
  }

  // Re-read only which teeth are missing and which carry a baby
  // tooth. Deliberately narrow: the selection, the tile panels and
  // the session list all stay exactly as they were, so nothing the
  // person was in the middle of is disturbed.
  async function refreshToothState() {
    const patNum = patient?.PatNum;
    if (typeof patNum !== "number" || patNum <= 0) return;

    try {
      const data = await callChart({ action: "open", pat_num: patNum });
      setMissingTeeth(data.missing_teeth ?? []);
      setPrimaryTeeth((data.primary_teeth ?? []) as PrimaryTooth[]);
    } catch {
      // The write already succeeded and was read back by od-chart.
      // Failing to redraw is not worth an error over the top of a
      // successful entry; the next patient open will show it.
    }
  }

  function closePatient() {
    setPatient(null);
    setProcedures([]);
    setMissingTeeth([]);
    setPrimaryTeeth([]);
    setMenu([]);
    setFeeSchedule(null);
    setTooth("");
    setQuads([]);
    setWholeMouth(false);
    resetNav();
    // The next patient starts at the chair, not mid-presentation.
    setWorkTab("procedures");
    setPlanRows([]);
    setPlanError("");
    setSelected(new Set());
    setPendingAction(null);
    // The priority and diagnosis lists are the office's and stay. They
    // are cleared when the office changes, which is the only time they
    // can be wrong.
    setBenefits([]);
    setDisplayOrder([]);
    setDeletedRows([]);
    setRemovedIds(new Set());
    setSessionIds(new Set());
    setSessionMarks([]);
    // The presenter is deliberately not cleared. It is the same person
    // for the next patient nearly always, and it is re-read from
    // storage anyway.
    setEditingPlanFee(null);
    setFiled(null);
    setSignStep("");
    // A signature and a rendered plan are both PHI, and both belong to
    // the patient who just left. The blob URL is revoked rather than
    // dropped: an unrevoked URL keeps the PDF alive in memory for the
    // life of the tab.
    setSignature(null);
    setPreviewUrl((previous) => {
      if (previous !== null) URL.revokeObjectURL(previous);
      return null;
    });
    // The same call the tab makes, with no timer. The input is mounted
    // whichever tab is showing, so there is nothing to wait for.
    if (pickerTab === "search") {
      searchRef.current?.focus();
    }
  }

  function resetNav() {
    setNav({
      existing: { category: null, pending: null, surfaces: [] },
      diagnosed: { category: null, pending: null, surfaces: [] },
    });
  }

  // -------------------------------------------------------------------
  // Tooth chart marks
  // -------------------------------------------------------------------
  const marks = useMemo(() => {
    const map: Record<string, { existing: boolean; diagnosed: boolean }> = {};

    for (const p of procedures) {
      if (p.ToothNum === "") continue;
      // The chart is only read when the patient is opened, so without
      // this the dot for a procedure deleted two minutes ago stays lit
      // until the patient is closed and opened again.
      if (removedIds.has(p.ProcNum)) continue;
      if (!map[p.ToothNum]) map[p.ToothNum] = { existing: false, diagnosed: false };
      if (p.ProcStatus === "TP") map[p.ToothNum].diagnosed = true;
      else if (EXISTING_STATUSES.has(p.ProcStatus)) map[p.ToothNum].existing = true;
    }

    for (const mark of sessionMarks) {
      if (mark.tooth === "") continue;
      if (mark.od_id !== null && removedIds.has(mark.od_id)) continue;
      if (!map[mark.tooth]) map[mark.tooth] = { existing: false, diagnosed: false };
      if (mark.bucket === "diagnosed") map[mark.tooth].diagnosed = true;
      else map[mark.tooth].existing = true;
    }

    return map;
  }, [procedures, sessionMarks, removedIds]);

  const missingSet = useMemo(() => new Set(missingTeeth), [missingTeeth]);

  // Permanent tooth number to the baby letter sitting under it. Only
  // the slots that actually have one: a Primary flag on a permanent
  // molar is legal in OpenDental and draws nothing, so it is left
  // out here rather than drawn as an empty box.
  const letterByTooth = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of primaryTeeth) {
      if (p.has_letter && p.letter !== "") map[p.tooth_num] = p.letter;
    }
    return map;
  }, [primaryTeeth]);

  // Whether any letter is on screen at all. A patient with none —
  // most adults — gets exactly the chart they had before.
  const hasPrimary = useMemo(
    () => Object.keys(letterByTooth).length > 0,
    [letterByTooth],
  );

  // The letters themselves, for telling a tapped baby tooth from a
  // tapped permanent one when only the label is in hand.
  const letterSet = useMemo(
    () => new Set(Object.values(letterByTooth)),
    [letterByTooth],
  );

  // What is selected right now. A selection can satisfy more than one
  // shape at the same time — two upper quadrants are both "two
  // quadrants" and "the upper arch" — and the tile that gets tapped
  // decides which reading applies.
  const selection = useMemo((): {
    shapes: Shape[];
    quads: string[];
    archRegion: string;
    label: string;
  } => {
    if (tooth !== "") {
      return {
        shapes: ["tooth"],
        quads: [],
        archRegion: "",
        label: `tooth ${tooth}`,
      };
    }

    if (wholeMouth) {
      return {
        shapes: ["mouth"],
        quads: [],
        archRegion: "",
        label: "whole mouth",
      };
    }

    if (quads.length === 0) {
      return { shapes: [], quads: [], archRegion: "", label: "" };
    }

    // Kept in OpenDental's own order however the buttons were tapped, so
    // the session list always reads upper right before lower left.
    const ordered = ["UR", "UL", "LR", "LL"].filter((q) => quads.includes(q));
    const set = new Set(ordered);

    // Every quadrant selection can take quadrant work. Whether it is
    // also an arch, or the whole mouth, is an extra reading on top.
    const shapes: Shape[] = ["quadrant"];
    let archRegion = "";

    if (ordered.length === 2 && set.has("UR") && set.has("UL")) {
      shapes.push("arch");
      archRegion = "U";
    } else if (ordered.length === 2 && set.has("LR") && set.has("LL")) {
      shapes.push("arch");
      archRegion = "L";
    } else if (ordered.length === 4) {
      shapes.push("mouth");
    }

    const label = ordered.length === 1
      ? (REGION_LABELS[ordered[0]] ?? ordered[0]).toLowerCase()
      : ordered.length === 4
        ? "whole mouth"
        : archRegion === "U"
          ? "upper arch"
          : archRegion === "L"
            ? "lower arch"
            : `${ordered.length} quadrants`;

    return { shapes, quads: ordered, archRegion, label };
  }, [tooth, quads, wholeMouth]);

  const hasSelection = selection.shapes.length > 0;
  const selectionLabel = selection.label;

  // Which regions a given tile writes to, given what is lit. A quadrant
  // tile fans out across every quadrant; an arch tile takes the one arch
  // the pair makes; whole-mouth work carries no region at all.
  function regionsForTile(tile: Tile): string[] {
    const shape = shapeOfTreatArea(tile.treat_area);
    if (shape === "quadrant") return selection.quads;
    if (shape === "arch") {
      return selection.archRegion === "" ? [] : [selection.archRegion];
    }
    return [];
  }

  // What the confirm button and the tile footnote say. A quadrant tile
  // over several quadrants says how many, because one tap is about to
  // create that many procedures.
  function tileScopeLabel(tile: Tile): string {
    const shape = shapeOfTreatArea(tile.treat_area);

    if (shape === "quadrant" && selection.quads.length > 1) {
      return `${selection.quads.length} quadrants`;
    }

    if (shape === "quadrant" && selection.quads.length === 1) {
      return (REGION_LABELS[selection.quads[0]] ?? selection.quads[0])
        .toLowerCase();
    }

    if (shape === "arch") {
      return selection.archRegion === "U" ? "upper arch" : "lower arch";
    }

    if (shape === "mouth") return "whole mouth";

    return selectionLabel;
  }

  // The teeth the selection covers, lit on the chart so it is visible
  // rather than only stated. Whole mouth lights nothing: every tooth
  // outlined reads as a mistake, not a selection.
  const regionTeeth = useMemo(() => {
    if (wholeMouth) return new Set<string>();

    const out = new Set<string>();
    for (const q of quads) {
      for (const n of QUADRANT_TEETH[q] ?? []) out.add(String(n));
    }
    return out;
  }, [quads, wholeMouth]);

  function selectTooth(key: string) {
    setTooth((prev) => (prev === key ? "" : key));
    setQuads([]);
    setWholeMouth(false);
    resetNav();
    setCommitError("");
  }

  function toggleQuadrant(key: string) {
    setQuads((prev) =>
      prev.includes(key) ? prev.filter((q) => q !== key) : [...prev, key]
    );
    setTooth("");
    setWholeMouth(false);
    resetNav();
    setCommitError("");
  }

  function toggleWholeMouth() {
    setWholeMouth((prev) => !prev);
    setTooth("");
    setQuads([]);
    resetNav();
    setCommitError("");
  }

  // A tile is offered only where it can actually be written. Tooth-range
  // work never is: od-chart refuses it, so showing it would be an
  // invitation to an error message.
  const shapedMenu = useMemo(() => {
    if (selection.shapes.length === 0) return [];

    return menu
      .map((c) => ({
        ...c,
        tiles: c.tiles.filter((t) => {
          const shape = shapeOfTreatArea(t.treat_area);
          if (shape === "range") return false;
          // A missing tooth is marked on a tooth whatever its code says.
          if (t.entry_kind === "tooth_initial") {
            return selection.shapes.includes("tooth");
          }
          return selection.shapes.includes(shape);
        }),
      }))
      .filter((c) => c.tiles.length > 0);
  }, [menu, selection]);

  const toothProcedures = useMemo(
    () => (tooth === "" ? [] : procedures.filter((p) => p.ToothNum === tooth)),
    [procedures, tooth],
  );

  // -------------------------------------------------------------------
  // Panel navigation
  // -------------------------------------------------------------------
  function setBucketNav(bucket: Bucket, patch: Partial<NavState>) {
    setNav((prev) => ({ ...prev, [bucket]: { ...prev[bucket], ...patch } }));
  }

  function goBack(bucket: Bucket) {
    const state = nav[bucket];
    if (state.pending !== null) {
      setBucketNav(bucket, { pending: null, surfaces: [] });
    } else {
      setBucketNav(bucket, { category: null });
    }
  }

  function toggleSurface(bucket: Bucket, surface: string) {
    const current = nav[bucket].surfaces;
    setBucketNav(bucket, {
      surfaces: current.includes(surface)
        ? current.filter((s) => s !== surface)
        : [...current, surface],
    });
  }

  function chooseTile(bucket: Bucket, tile: Tile) {
    setCommitError("");

    // Surfaces have to be picked, and a paired tile is worth pausing on
    // because it writes two lines and states a fee. Everything else
    // still commits on one tap.
    if (tile.needs_surfaces || tile.is_paired) {
      setBucketNav(bucket, { pending: tile, surfaces: [] });
      return;
    }

    commit(bucket, tile, []);
  }

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------
  async function commit(bucket: Bucket, tile: Tile, surfaces: string[]) {
    if (!hasSelection) {
      setCommitError("Pick a tooth or a region first.");
      return;
    }

    setCommitting(true);
    setCommitError("");

    try {
      const data = await callChart({
        action: "commit",
        pat_num: patient?.PatNum,
        tile_id: tile.id,
        tooth_num: tooth,
        // The tile decides how the selection is read, so a quadrant
        // tile gets every lit quadrant and an arch tile gets the one
        // arch they make. od-chart applies the same rule from the
        // tile's own treat_area, so the two cannot disagree.
        regions: regionsForTile(tile),
        surfaces,
        ...(provOverride !== null ? { prov_num: provOverride } : {}),
      });

      // A crown writes two lines and an add-on writes another, so one
      // tap can produce several ledger rows. The flat fields are still
      // there for the single-line case.
      const returned = Array.isArray(data.lines) && data.lines.length > 0
        ? (data.lines as Record<string, unknown>[])
        : [{
          role: "base",
          label: tile.label,
          proc_code: data.proc_code ?? "",
          od_id: data.od_id ?? null,
          descript: data.descript ?? "",
          tooth_num: data.tooth_num ?? tooth,
          surf: data.surf ?? "",
          fee: data.fee ?? null,
          prov_abbr: data.prov_abbr ?? "",
          undoable: data.undoable !== false,
        }];

      const stamp = Date.now();

      // A tooth state that was taken off rather than put on. Said
      // plainly in the session list, because "Primary / Permanent"
      // sitting there on its own reads as though a tooth had just
      // been marked when the opposite happened.
      const wasCleared = data.cleared === true;

      const entries: LedgerEntry[] = returned.map((line, index) => ({
        key: `${data.entry_kind}-${line.od_id ?? "none"}-${stamp}-${index}`,
        bucket,
        entry_kind: data.entry_kind,
        od_id: typeof line.od_id === "number" ? line.od_id : null,
        label: wasCleared
          ? `${String(line.label ?? tile.label)} — removed`
          : String(line.label ?? tile.label),
        code: String(line.proc_code ?? ""),
        descript: String(line.descript ?? ""),
        tooth: String(line.tooth_num ?? tooth),
        surf: String(line.surf ?? ""),
        fee: line.fee === null || line.fee === undefined
          ? null
          : String(line.fee),
        provAbbr: String(line.prov_abbr ?? ""),
        removing: false,
        // Nothing was created, so there is nothing to undo. The tile
        // is the way back.
        undoable: !wasCleared && line.undoable !== false,
      }));

      if (data.entry_kind === "tooth_initial") {
        const marked = entries[0]?.tooth ?? tooth;
        const kind = String(data.initial_type ?? "");

        // Missing and Primary both write a tooth-state row, and
        // until now both landed in the missing list — so marking a
        // tooth primary struck it through as if it had come out.
        if (kind === "Primary") {
          // The letter is od-chart's to decide, so the tooth state is
          // re-read rather than guessed at here. One extra call on a
          // rare action, and the chart cannot end up showing a letter
          // the server would not have given it.
          void refreshToothState();
        } else if (wasCleared) {
          // Unmarked. Without this the tooth stayed struck through
          // until the patient was closed and opened again, which
          // reads as the removal having failed.
          setMissingTeeth((prev) => prev.filter((t) => t !== marked));
        } else {
          setMissingTeeth((prev) =>
            prev.includes(marked) ? prev : [...prev, marked]
          );
        }
      }

      // A line landed and a later one was refused. Nothing is rolled
      // back, so say what is missing rather than looking successful.
      if (data.partial === true) {
        const refused = Array.isArray(data.regions_refused)
          ? (data.regions_refused as unknown[]).map((r) => String(r))
          : [];

        if (refused.length > 0) {
          // Named by quadrant, because that is what has to be redone.
          const words = refused
            .map((r) => (REGION_LABELS[r] ?? r).toLowerCase())
            .join(" and ");

          setCommitError(
            `OpenDental refused the ${words}. Everything else went through.`,
          );
        } else {
          const failed = data.partial_failure as Record<string, unknown> | null;
          setCommitError(
            `${String(failed?.label ?? "A line")} was refused, so it is not in OpenDental. The rest went through.`,
          );
        }
      }

      // Light the tooth immediately. One mark per procedure, carrying
      // its OpenDental id where there is one, so deleting that
      // procedure can put the tooth back.
      setSessionMarks((prev) => [
        ...prev,
        ...entries
          .filter((e) => e.tooth !== "")
          .map((e): SessionMark => ({
            od_id: e.od_id,
            tooth: e.tooth,
            bucket,
          })),
      ]);

      // Remember what this session wrote, so those rows can be marked
      // in the pending list rather than kept in a list of their own.
      const written = entries
        .map((e) => e.od_id)
        .filter((id): id is number => typeof id === "number");

      if (written.length > 0) {
        setSessionIds((prev) => {
          const next = new Set(prev);
          for (const id of written) next.add(id);
          return next;
        });
      }

      // Diagnosed work goes onto the plan, so the list is re-read.
      // Without this the two disagree the moment anything is charted,
      // which is exactly what v12 shipped with.
      if (bucket === "diagnosed" && patient !== null) {
        void loadPlan(patient.PatNum, true);
      }

      setBucketNav(bucket, { pending: null, surfaces: [] });
    } catch (caught) {
      setCommitError(caught instanceof Error ? caught.message : "Couldn't save that.");
    } finally {
      setCommitting(false);
    }
  }

  // -------------------------------------------------------------------
  // What the patient is being shown, and what it adds up to
  //
  // Totalled from the chosen rows rather than from the server's total,
  // because unchecking an item has to change the number in front of the
  // patient. Each row's figures are still OpenDental's.
  // -------------------------------------------------------------------
  // What the patient is shown: everything still at a Diag priority.
  // Work declined at an earlier visit is still Diag, so it comes back
  // rather than disappearing — re-presenting it is the point.
  // The plan is what the coordinator ticked. Not what is at Diag:
  // accepted work that never got done is exactly what needs
  // re-presenting, and it is at Acc.
  const chosenRows = useMemo(
    () => planRows.filter((r) => selected.has(r.od_id)),
    [planRows, selected],
  );

  // -------------------------------------------------------------------
  // The annual maximum
  //
  // OpenDental caps its insurance estimates only when its Windows
  // client recalculates, and nothing in the API triggers that. Its
  // stored figures are therefore right for the last ordering somebody
  // looked at on a PC, and silently wrong after anything is changed at
  // the chair. So the ceiling is applied here, over OpenDental's own
  // uncapped per-procedure estimates, in the order OpenDental consumes
  // benefit.
  //
  // Over the whole plan, not the ticked subset: un-ticking a procedure
  // does not hand its benefit back, because that work is still planned
  // and the maximum is still spoken for.
  //
  // Deleted rows are already out of planRows, which is correct — they
  // are out of OpenDental too, and their share of the maximum is free.
  // -------------------------------------------------------------------
  const allocation = useMemo(
    () =>
      allocateBenefit(
        planRows.map((r): AllocatableRow => ({
          od_id: r.od_id,
          pri_base: r.pri_base,
          sec_base: r.sec_base,
          pri_ins: r.pri_ins,
          sec_ins: r.sec_ins,
          write_off: r.write_off,
          fee: r.fee,
          has_override: r.has_override,
          covered: r.covered,
          cov_cat_nums: r.cov_cat_nums ?? [],
        })),
        benefits,
      ),
    [planRows, benefits],
  );

  const allocByRow = useMemo(() => {
    const map = new Map<number, AllocatedRow>();
    for (const r of allocation.rows) map.set(r.od_id, r);
    return map;
  }, [allocation]);

  // What a row is shown as. Allocation covers every row it was given,
  // including the pass-through case where there is no ceiling to apply,
  // so this falls back to OpenDental's own figures only for a row that
  // was never allocated — a deleted one being drawn from its snapshot.
  const figuresFor = useCallback(
    (row: PlanRow) => {
      const allocated = allocByRow.get(row.od_id);

      if (allocated === undefined) {
        return {
          pri_ins: row.pri_ins,
          sec_ins: row.sec_ins,
          pat: row.pat,
          deductible: row.deductible,
          limited: false,
        };
      }

      return {
        pri_ins: allocated.pri_ins,
        sec_ins: allocated.sec_ins,
        pat: allocated.pat,
        deductible: allocated.deductible,
        limited: allocated.limited,
      };
    },
    [allocByRow],
  );

  // The planned list as it is drawn: the frozen order, with rows
  // deleted this session still standing in their places until Refresh,
  // and anything new appended.
  const displayRows = useMemo(() => {
    const live = new Map(planRows.map((r) => [r.od_id, r]));
    const gone = new Map(deletedRows.map((r) => [r.od_id, r]));
    const placed = new Set<number>();
    const out: { row: PlanRow; deleted: boolean }[] = [];

    for (const id of displayOrder) {
      const row = live.get(id);
      if (row !== undefined) {
        out.push({ row, deleted: false });
        placed.add(id);
        continue;
      }

      const removed = gone.get(id);
      if (removed !== undefined) {
        out.push({ row: removed, deleted: true });
        placed.add(id);
      }
    }

    for (const row of planRows) {
      if (!placed.has(row.od_id)) out.push({ row, deleted: false });
    }

    return out;
  }, [planRows, deletedRows, displayOrder]);

  const selectedRows = useMemo(
    () => planRows.filter((r) => selected.has(r.od_id)),
    [planRows, selected],
  );

  // Every priority that is an accepted form, keyed by the label it
  // accepts. Two naming schemes, because the office uses two:
  //
  //   "Diag 2"   pairs to "Acc 2"        — numbered, the original scheme
  //   "Optional" pairs to "Optional Acc" — suffixed, added later
  //
  // The suffix rule is general rather than a list with "Optional" in it,
  // so a priority added next year pairs by being named for it and
  // nobody has to remember this file exists.
  //
  // Keys are lowercased: this matches on what a human typed into
  // OpenDental's definition list, and "optional acc" and "Optional Acc"
  // are the same intent.
  //
  // Pairing is by name at runtime and never by DefNum, because the same
  // DefNum means different things at the two offices — Downey's 148 is
  // "Not Accepted" and Maywood's is "Optional".
  const accByAcceptedLabel = useMemo(() => {
    const map = new Map<string, number>();

    for (const option of priorities) {
      const label = option.label.trim();

      // "Acc 2" accepts "Diag 2".
      const numbered = ACC_RE.exec(label);
      if (numbered !== null) {
        map.set(`diag ${numbered[1]}`.toLowerCase(), option.def_num);
        continue;
      }

      // "Optional Acc" accepts "Optional". The suffix is stripped to
      // find what it accepts, so the pair is discovered rather than
      // hardcoded.
      const suffixed = ACC_SUFFIX_RE.exec(label);
      if (suffixed !== null) {
        const base = suffixed[1].trim().toLowerCase();
        if (base !== "") map.set(base, option.def_num);
      }
    }

    return map;
  }, [priorities]);

  const accForLabel = useCallback(
    (label: string): number | null =>
      accByAcceptedLabel.get(label.trim().toLowerCase()) ?? null,
    [accByAcceptedLabel],
  );

  // How many ticked rows are still awaiting a decision. Everything
  // else ticked is being re-presented rather than accepted for the
  // first time, and the Sign tab should not claim otherwise.
  // The rows that were filed, recovered by their OpenDental ids. The
  // filed record keeps ids rather than rows, so this re-reads them from
  // the current plan — which is also why View reflects OpenDental as it
  // stands rather than a frozen copy.
  const filedRows = useMemo(
    () =>
      filed === null
        ? []
        : planRows.filter((r) => filed.od_ids.includes(r.od_id)),
    [planRows, filed],
  );

  const diagTicked = useMemo(
    () =>
      planRows.filter(
        (r) =>
          selected.has(r.od_id) && accForLabel(r.priority_label) !== null,
      ).length,
    [planRows, selected, accForLabel],
  );

  // The rows the filed plan covers, read back from OpenDental rather
  // than from what was sent, and whatever is still at Diag after it.
  const acceptedRows = useMemo(
    () =>
      filed === null
        ? []
        : planRows.filter((r) => filed.od_ids.includes(r.od_id)),
    [planRows, filed],
  );

  const declinedRows = useMemo(
    () =>
      filed === null
        ? []
        : planRows.filter(
            (r) =>
              !filed.od_ids.includes(r.od_id) &&
              accForLabel(r.priority_label) !== null,
          ),
    [planRows, filed, accForLabel],
  );

  // The presenter, remembered per office. Most days there is one
  // treatment coordinator at each, and choosing the same name after
  // every patient is a tax on the ordinary case. Kept per office
  // because the two have separate user tables and separate staff.
  //
  // A name from OpenDental's user list is not patient data, so this is
  // the one thing on this screen that may outlive the session on the
  // tablet.
  useEffect(() => {
    if (officeSlug === "" || presenters.length === 0) return;

    try {
      const saved = window.localStorage.getItem(
        `dental-os-presenter-${officeSlug}`,
      );
      if (saved === null) return;

      const num = Number(saved);
      // Only if that user still exists at this office. Staff leave, and
      // a stale number would name nobody on a printed plan.
      if (presenters.some((p) => p.user_num === num)) setPresenterNum(num);
    } catch {
      // A tablet with storage disabled just does not remember. Not
      // worth interrupting anyone over.
    }
  }, [officeSlug, presenters]);

  useEffect(() => {
    if (officeSlug === "" || presenterNum === null) return;

    try {
      window.localStorage.setItem(
        `dental-os-presenter-${officeSlug}`,
        String(presenterNum),
      );
    } catch {
      // As above.
    }
  }, [officeSlug, presenterNum]);

  // Indeterminate is a DOM property, not an attribute, so it cannot be
  // set from JSX and has to be written to the node.
  useEffect(() => {
    const node = masterRef.current;
    if (node === null) return;
    node.indeterminate =
      selected.size > 0 && selected.size < planRows.length;
  }, [selected, planRows]);

  // The Acc label a Diag row becomes, for printing on the plan. Read
  // from the office's own list rather than assembled, so a office that
  // spells it differently still prints what OpenDental will hold.
  const accLabelFor = useCallback(
    (label: string): string | null => {
      const defNum = accForLabel(label);
      if (defNum === null) return null;
      return priorities.find((p) => p.def_num === defNum)?.label ?? null;
    },
    [accForLabel, priorities],
  );

  // The office block for the plan's letterhead. The whole row rather
  // than just the name: the PDF prints address, phone, fax and email,
  // and all of it came from OpenDental by way of od_sync_offices().
  //
  // Nulls become empty strings here rather than in the PDF, because the
  // document's rule is that an empty field prints nothing — it should
  // not also have to know what a null is.
  const officeBlock = useMemo<PlanOffice>(() => {
    const row = offices.find((o) => o.slug === officeSlug);

    return {
      name: row?.name ?? "",
      addressLine1: row?.address_line1 ?? "",
      addressLine2: row?.address_line2 ?? "",
      city: row?.city ?? "",
      state: row?.state ?? "",
      postalCode: row?.postal_code ?? "",
      phone: row?.phone ?? "",
      email: row?.email ?? "",
    };
  }, [offices, officeSlug]);

  // The provider the coordinator is looking at in the header — the
  // override if one is set, otherwise whoever od-chart resolved. The
  // plan prints this one, so the paper and the screen agree.
  //
  // Printed as a name rather than as the abbreviation the dropdown
  // shows: the patient is reading this. The parts are OpenDental's own
  // fields joined in order and nothing is rewritten — the credential
  // comes from the Suffix field, so whatever the office typed there is
  // what appears.
  const shownProviderName = useMemo(() => {
    const provNum = provOverride ?? resolvedProv?.ProvNum ?? null;
    const match = providers.find((p) => p.ProvNum === provNum);
    if (match === undefined) return resolvedProv?.provAbbr ?? "";

    const name = [match.LName, match.FName].filter((s) => s !== "").join(", ");
    const full = [name, match.Suffix].filter((s) => s !== "").join(" ").trim();

    return full === "" ? match.Abbr : full;
  }, [providers, provOverride, resolvedProv]);

  const chosenTotals = useMemo(() => {
    const sum = chosenRows.reduce(
      (acc, r) => {
        const figures = figuresFor(r);

        return {
          fee: acc.fee + r.fee,
          allowed: acc.allowed + (r.allowed ?? 0),
          pri_ins: acc.pri_ins + figures.pri_ins,
          sec_ins: acc.sec_ins + figures.sec_ins,
          write_off: acc.write_off + r.write_off,
          pat: acc.pat + figures.pat,
        };
      },
      { fee: 0, allowed: 0, pri_ins: 0, sec_ins: 0, write_off: 0, pat: 0 },
    );

    const round = (n: number) => Math.round(n * 100) / 100;

    return {
      fee: round(sum.fee),
      allowed: round(sum.allowed),
      pri_ins: round(sum.pri_ins),
      sec_ins: round(sum.sec_ins),
      write_off: round(sum.write_off),
      pat: round(sum.pat),
    } as PlanTotals;
  }, [chosenRows, figuresFor]);

  // One place that builds the document, so Preview, Print and the filed
  // copy are the same bytes rather than three renderings that agree
  // most of the time.
  //
  // Rows and signature are arguments rather than read from state: the
  // caller decides what is being rendered, and a Preview taken before
  // signing has to be able to say so.
  const buildPdf = useCallback(
    (rows: PlanRow[], sig: string | null): string => {
      if (patient === null) throw new Error("No patient is open.");

      const presenterName =
        presenters.find((p) => p.user_num === presenterNum)?.name ?? "";

      const { base64 } = buildTreatmentPlanPdf({
        office: officeBlock,
        heading: "Treatment Plan",
        patientName: `${patient.LName}, ${patient.Preferred || patient.FName}`,
        patientDob: usDate(patient.Birthdate),
        patientNumber: patient.PatNum,
        providerName: shownProviderName,
        presenterName,
        planDate: usDate(localISODate(new Date())),
        rows: rows.map((r) => {
          const figures = figuresFor(r);

          return {
            priority: accLabelFor(r.priority_label) ?? r.priority_label,
            tooth: r.tooth,
            surf: r.surf,
            code: r.proc_code,
            // The printed plan says what the screen said. Signing a
            // document worded differently to the one on screen is a
            // consent problem, not a cosmetic one.
            description: nameOf(r),
            fee: r.fee,
            allowed: r.allowed,
            priIns: figures.pri_ins,
            secIns: figures.sec_ins,
            pat: figures.pat,
          };
        }),
        totals: {
          fee: chosenTotals.fee,
          allowed: chosenTotals.allowed,
          priIns: chosenTotals.pri_ins,
          secIns: chosenTotals.sec_ins,
          pat: chosenTotals.pat,
        },
        disclaimer:
          "Insurance figures are estimates based on this plan's benefits " +
          "as they stand today, and depend on the deductible and annual " +
          "maximum. They are an estimate, not a guarantee." +
          (allocation.applied && allocation.remaining_max !== null
            ? " This plan has " +
              money(allocation.remaining_max) +
              " of its annual maximum left for the year, applied to the " +
              "treatment above in the order it is planned."
            : ""),
        // Null when the pad was never drawn on. The pad returns null
        // rather than a blank image precisely so this stays honest: a
        // blank PNG is a real image and would file as a signature.
        signatureDataUrl: sig,
      });

      return base64;
    },
    [
      patient,
      presenters,
      presenterNum,
      officeBlock,
      shownProviderName,
      accLabelFor,
      chosenTotals,
      figuresFor,
      allocation,
    ],
  );

  // A blob URL for the current document, replacing any previous one.
  // Revoking as we go matters: each URL pins a PDF full of PHI in
  // memory until the tab is closed, and a coordinator previewing a
  // dozen plans in a morning would pin all twelve.
  const openPdf = useCallback(
    (rows: PlanRow[], sig: string | null, print: boolean) => {
      try {
        const base64 = buildPdf(rows, sig);

        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);

        setPreviewUrl((previous) => {
          if (previous !== null) URL.revokeObjectURL(previous);
          return url;
        });

        const opened = window.open(url, "_blank");

        if (opened === null) {
          setPlanError(
            "The browser blocked the new tab. Allow pop-ups for this site " +
              "and try again.",
          );
          return;
        }

        // Printing is asked for once the document has actually rendered.
        // Calling print() on an empty tab prints an empty tab.
        if (print) {
          opened.addEventListener("load", () => opened.print());
        }
      } catch (caught) {
        setPlanError(
          caught instanceof Error
            ? caught.message
            : "The plan could not be built.",
        );
      }
    },
    [buildPdf],
  );

  // What the Plan tab is looking at. Before signing that is every Diag
  // row, which is what the patient is being asked about. After signing
  // it is what was filed — by then nothing is at Diag, and a tab that
  // kept filtering on Diag would empty itself at the moment of
  // acceptance and read as though the plan had been lost.
  const planTabRows = useMemo(
    () => (filed === null ? chosenRows : acceptedRows),
    [filed, chosenRows, acceptedRows],
  );

  const planTabTotals = useMemo(() => {
    if (filed === null) return chosenTotals;

    const sum = acceptedRows.reduce(
      (acc, r) => {
        const figures = figuresFor(r);

        return {
          fee: acc.fee + r.fee,
          allowed: acc.allowed + (r.allowed ?? 0),
          pri_ins: acc.pri_ins + figures.pri_ins,
          sec_ins: acc.sec_ins + figures.sec_ins,
          write_off: acc.write_off + r.write_off,
          pat: acc.pat + figures.pat,
        };
      },
      { fee: 0, allowed: 0, pri_ins: 0, sec_ins: 0, write_off: 0, pat: 0 },
    );

    const round = (n: number) => Math.round(n * 100) / 100;

    return {
      fee: round(sum.fee),
      allowed: round(sum.allowed),
      pri_ins: round(sum.pri_ins),
      sec_ins: round(sum.sec_ins),
      write_off: round(sum.write_off),
      pat: round(sum.pat),
    } as PlanTotals;
  }, [filed, chosenTotals, acceptedRows, figuresFor]);

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  if (booting) {
    return (
      <main className="min-h-screen bg-[#0B1719] px-6 py-10 text-[#EDF3F1]">
        <p className="text-[15px] text-[#8AA6AB]">Starting up…</p>
      </main>
    );
  }

  // ---------- patient picker ----------
  if (patient === null) {
    return (
      <main className="min-h-screen bg-[#0B1719] px-6 py-10 text-[#EDF3F1]">
        <div className="mx-auto w-full max-w-3xl">
          <p className="font-mono text-xs tracking-[0.18em] text-[#F0A93B] uppercase">
            Chairside · Charting
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {pickerTab === "today" ? "Today's schedule" : "Find a patient"}
          </h1>

          {/* Tabs + office */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex overflow-hidden rounded-xl border border-[#2C4E54]">
              {(["today", "search"] as PickerTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  // Synchronous, inside the gesture. A setTimeout or a
                  // requestAnimationFrame here breaks the chain iOS
                  // requires and the keyboard stays down, even though
                  // the cursor lands correctly on a PC.
                  onClick={() => {
                    setPickerTab(tab);
                    if (tab === "search") searchRef.current?.focus();
                  }}
                  className={`px-5 py-2.5 text-sm font-semibold transition-colors ${
                    pickerTab === tab
                      ? "bg-[#EDF3F1] text-[#0B1719]"
                      : "bg-[#122326] text-[#8AA6AB] hover:text-[#EDF3F1]"
                  }`}
                >
                  {tab === "today" ? "Today" : "Search"}
                </button>
              ))}
            </div>

            <label htmlFor="office" className="ml-auto text-sm text-[#8AA6AB]">
              Office
            </label>
            <select
              id="office"
              value={officeSlug}
              onChange={(e) => setOfficeSlug(e.target.value)}
              className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
            >
              {offices.map((o) => (
                <option key={o.id} value={o.slug}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          {loadError !== "" && (
            <p className="mt-4 text-sm text-[#E4674F]">{loadError}</p>
          )}

          {/* Both panels stay mounted and the inactive one is moved off
              screen. The search input has to exist before it is tapped,
              because focus() cannot reach an element that is not in the
              document — and it cannot reach a display:none one either,
              which is why this hides by position rather than by
              display. */}

          {/* ---------------- Today ---------------- */}
          <div
            className={
              pickerTab === "today"
                ? ""
                : "pointer-events-none absolute -left-[9999px] top-0 h-0 overflow-hidden"
            }
          >
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleDate(shiftISODate(scheduleDate, -1))}
                  className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#8AA6AB] hover:text-[#EDF3F1]"
                  aria-label="Previous day"
                >
                  ‹
                </button>

                <span className="min-w-[9rem] text-center text-[15px] font-semibold">
                  {isToday ? "Today" : humanDate(scheduleDate)}
                </span>

                <button
                  type="button"
                  onClick={() => setScheduleDate(shiftISODate(scheduleDate, 1))}
                  className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#8AA6AB] hover:text-[#EDF3F1]"
                  aria-label="Next day"
                >
                  ›
                </button>

                {!isToday && (
                  <button
                    type="button"
                    onClick={() => setScheduleDate(localISODate(new Date()))}
                    className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-xs text-[#8AA6AB] hover:text-[#EDF3F1]"
                  >
                    Jump to today
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => loadSchedule(scheduleDate)}
                  disabled={scheduleLoading}
                  className="ml-auto rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#8AA6AB] hover:text-[#EDF3F1] disabled:opacity-40"
                  aria-label="Refresh"
                >
                  {scheduleLoading ? "…" : "⟳"}
                </button>
              </div>

              {/* Operatory chips — only the ones carrying appointments */}
              {operatories.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOpFilter(null)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
                      opFilter === null
                        ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                        : "border-[#2C4E54] bg-[#122326] text-[#8AA6AB] hover:text-[#EDF3F1]"
                    }`}
                  >
                    All · {appointments.length}
                  </button>

                  {operatories.map((op) => (
                    <button
                      key={op.num}
                      type="button"
                      onClick={() => setOpFilter(opFilter === op.num ? null : op.num)}
                      title={op.name}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
                        opFilter === op.num
                          ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                          : "border-[#2C4E54] bg-[#122326] text-[#8AA6AB] hover:text-[#EDF3F1]"
                      }`}
                    >
                      {op.abbr || op.name || `Op ${op.num}`} · {op.count}
                    </button>
                  ))}
                </div>
              )}

              {scheduleError !== "" && (
                <p className="mt-4 text-sm text-[#E4674F]">{scheduleError}</p>
              )}

              <div className="mt-4 space-y-2">
                {scheduleLoading && appointments.length === 0 && (
                  <p className="py-8 text-center text-sm text-[#8AA6AB]">
                    Loading the day…
                  </p>
                )}

                {!scheduleLoading &&
                  scheduleError === "" &&
                  visibleAppointments.length === 0 && (
                    <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#2C4E54] bg-[#122326] p-10 text-center">
                      <strong className="text-[15px] font-medium">
                        Nothing on the schedule
                      </strong>
                      <span className="max-w-[32ch] text-[13px] text-[#8AA6AB]">
                        No appointments for this day. Try another date, or search
                        by name.
                      </span>
                    </div>
                  )}

                {visibleAppointments.map((appt) => {
                  const pill = statusPill(appt);
                  const name = appt.preferred_name !== ""
                    ? `${appt.last_name}, ${appt.preferred_name}`
                    : appt.display_name;

                  return (
                    <button
                      key={appt.apt_num}
                      type="button"
                      disabled={!appt.openable || loadingPatient}
                      onClick={() => openPatient(appt.pat_num)}
                      className={`flex w-full items-center gap-4 rounded-xl border px-5 py-3.5 text-left transition-colors ${
                        appt.openable
                          ? "border-[#2C4E54] bg-[#122326] hover:bg-[#193034]"
                          : "cursor-not-allowed border-[#2C4E54]/60 bg-[#0F1D20] opacity-55"
                      } ${
                        appt.presence === "in_chair" && appt.status_num !== BROKEN
                          ? "border-[#F0A93B]/60"
                          : ""
                      } disabled:opacity-55`}
                    >
                      <span className="w-[5.5rem] flex-none">
                        <span className="block font-mono text-[15px] font-semibold">
                          {clockLabel(appt.time)}
                        </span>
                        <span className="block font-mono text-[11px] text-[#5E7B80]">
                          {appt.duration_minutes} min
                        </span>
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[17px] font-semibold">
                          {name}
                        </span>
                        <span className="block truncate font-mono text-[11.5px] text-[#8AA6AB]">
                          {appt.operatory_abbr || appt.operatory_name || `Op ${appt.operatory_num}`}
                          {whoIsSeeingThem(appt) !== "" ? ` · ${whoIsSeeingThem(appt)}` : ""}
                          {appt.procedures !== "" ? ` · ${appt.procedures}` : ""}
                        </span>
                      </span>

                      <span
                        className={`flex-none rounded-full border px-3 py-1 text-[11px] font-semibold ${pill.className}`}
                      >
                        {pill.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {visibleAppointments.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#5E7B80]">
                  <span className="font-mono">
                    {visibleAppointments.length}{" "}
                    {visibleAppointments.length === 1 ? "appointment" : "appointments"}
                    {brokenCount > 0 ? ` · ${brokenCount} broken` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPickerTab("search");
                      searchRef.current?.focus();
                    }}
                    className="ml-auto text-[#8AA6AB] underline underline-offset-4 hover:text-[#EDF3F1]"
                  >
                    Search by name instead
                  </button>
                </div>
              )}
          </div>

          {/* ---------------- Search ---------------- */}
          <div
            className={
              pickerTab === "search"
                ? ""
                : "pointer-events-none absolute -left-[9999px] top-0 h-0 overflow-hidden"
            }
          >
              <div className="mt-4 flex gap-3">
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch();
                  }}
                  placeholder="Last name, last and first, date of birth, or patient number"
                  autoComplete="off"
                  className="flex-1 rounded-xl border border-[#2C4E54] bg-[#122326] px-4 py-4 text-lg text-[#EDF3F1] placeholder:text-[#5E7B80] focus:border-[#F0A93B] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={runSearch}
                  disabled={searching}
                  className="rounded-xl bg-[#EDF3F1] px-7 py-4 text-lg font-semibold text-[#0B1719] disabled:opacity-40"
                >
                  {searching ? "…" : "Search"}
                </button>
              </div>

              <p className="mt-2.5 text-[12.5px] text-[#5E7B80]">
                Two words are read as last name then first, so
                &ldquo;Mendoza Juanita&rdquo; narrows to one person. Digits are a
                patient number and 08/08/1982 a date of birth; dashes work too.
              </p>

              {searchError !== "" && (
                <p className="mt-4 text-sm text-[#E4674F]">{searchError}</p>
              )}

              <div className="mt-6 space-y-2">
                {hits.map((h) => (
                  <button
                    key={h.PatNum}
                    type="button"
                    onClick={() => openPatient(h.PatNum)}
                    disabled={loadingPatient}
                    className="flex w-full items-center gap-4 rounded-xl border border-[#2C4E54] bg-[#122326] px-5 py-4 text-left hover:bg-[#193034] disabled:opacity-50"
                  >
                    <span className="text-[17px] font-semibold">
                      {h.LName}, {h.Preferred || h.FName}
                    </span>
                    <span className="ml-auto font-mono text-sm text-[#8AA6AB]">
                      {usDate(h.Birthdate) || "—"}
                    </span>
                    <span className="font-mono text-xs text-[#5E7B80]">#{h.ChartNumber}</span>
                  </button>
                ))}
              </div>
          </div>
        </div>
      </main>
    );
  }

  // ---------- charting ----------
  const buckets: Bucket[] = ["existing", "diagnosed"];

  return (
    <main className="min-h-screen bg-[#0B1719] px-3 py-3 text-[#EDF3F1] xl:px-4 xl:py-5">
      <div className="mx-auto w-full max-w-[1400px]">
        {/* Patient bar */}
        <div className="flex flex-wrap items-center gap-4 border-b border-[#2C4E54] pb-3">
          <div>
            <h1 className="text-xl font-semibold">
              {patient.LName}, {patient.Preferred || patient.FName}
            </h1>
            <p className="font-mono text-xs text-[#8AA6AB]">
              #{patient.ChartNumber} · {usDate(patient.Birthdate)}
              {feeSchedule !== null && feeSchedule.fee_sched > 0 && (
                <>
                  {" · "}
                  <span
                    title={`Fees come from this schedule, via the ${feeSchedule.source}. Change it in OpenDental.`}
                  >
                    {feeSchedule.fee_sched_name}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {/* Who is presenting. OpenDental will not take this through
                its API — UserNumPresenter is accepted and ignored,
                proved against the live server — so the name rides on
                the plan that gets filed instead. It sits here rather
                than on the Plan tab because this is where the rest of
                "who is in the room" already is. */}
            <label htmlFor="presenter" className="text-xs text-[#8AA6AB]">
              Presented by
            </label>
            <select
              id="presenter"
              value={presenterNum ?? ""}
              onChange={(e) =>
                setPresenterNum(
                  e.target.value === "" ? null : Number(e.target.value),
                )}
              className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
            >
              <option value="">Choose…</option>
              {presenters.map((p) => (
                <option key={p.user_num} value={p.user_num}>
                  {p.name}
                </option>
              ))}
            </select>

            <label htmlFor="prov" className="text-xs text-[#8AA6AB]">
              Provider
            </label>
            <select
              id="prov"
              value={provOverride ?? ""}
              onChange={(e) =>
                setProvOverride(e.target.value === "" ? null : Number(e.target.value))
              }
              className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
            >
              <option value="">
                {resolvedProv?.provAbbr ?? "Default"} (from {resolvedProv?.source ?? "patient"})
              </option>
              {providers.map((p) => (
                <option key={p.ProvNum} value={p.ProvNum}>
                  {p.Abbr} — {p.LName}
                  {p.FName ? `, ${p.FName}` : ""}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={closePatient}
              className="rounded-lg border border-[#2C4E54] px-4 py-2 text-sm hover:bg-[#193034]"
              title="Finish with this patient and go back to the schedule"
            >
              Close patient
            </button>
          </div>
        </div>

        {/* Stage tabs.
            Each stage owns the screen rather than sharing one long
            scroll, so the coordinator is never scrolling past the tile
            picker with the patient watching. */}
        <div className="mt-3 flex items-end gap-1 overflow-x-auto border-b border-[#2C4E54]">
          {WORK_TABS.map((t) => {
            const active = workTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setWorkTab(t.id)}
                className={`relative -mb-px whitespace-nowrap rounded-t-xl border px-5 py-2.5 text-[13px] font-semibold tracking-[0.03em] transition-colors ${
                  active
                    ? "border-[#2C4E54] border-b-[#122326] bg-[#122326] text-[#EDF3F1]"
                    : "border-transparent text-[#8AA6AB] hover:bg-[#16292D] hover:text-[#EDF3F1]"
                }`}
              >
                {t.label}
                {t.id === "sign" && filed !== null && (
                  <span
                    className="ml-2 rounded bg-[#193034] px-1.5 py-0.5 font-mono text-[10px] text-[#79B4C4]"
                    title="A plan was filed this session"
                  >
                    filed
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {workTab === "procedures" && (
          <>
        {/* Tooth chart */}
        <section className="mt-3 rounded-2xl border border-[#2C4E54] bg-[#122326] p-2 xl:p-3">
          {/* Region buttons, laid out the way the operator sees the
              patient: the right quadrants on the left of the screen,
              the left quadrants on the right, Whole mouth between them.

              They combine. Two on the same arch mean that arch, all
              four mean the whole mouth. */}
          <div className="mb-2 grid grid-cols-3 gap-1 xl:mb-2.5 xl:gap-1.5">
            <div className="grid gap-1 xl:gap-1.5">
              {["UR", "LR"].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleQuadrant(key)}
                  className={`h-10 rounded-lg border text-[12px] font-semibold transition-transform active:scale-95 xl:h-12 xl:text-[13.5px] ${
                    quads.includes(key)
                      ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                      : "border-[#2C4E54] bg-[#193034] text-[#8AA6AB] hover:bg-[#204045]"
                  }`}
                >
                  {REGION_LABELS[key]}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={toggleWholeMouth}
              className={`rounded-lg border text-[13px] font-semibold transition-transform active:scale-95 xl:text-[15px] ${
                wholeMouth
                  ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                  : "border-[#2C4E54] bg-[#193034] text-[#8AA6AB] hover:bg-[#204045]"
              }`}
            >
              Whole mouth
            </button>

            <div className="grid gap-1 xl:gap-1.5">
              {["UL", "LL"].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleQuadrant(key)}
                  className={`h-10 rounded-lg border text-[12px] font-semibold transition-transform active:scale-95 xl:h-12 xl:text-[13.5px] ${
                    quads.includes(key)
                      ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                      : "border-[#2C4E54] bg-[#193034] text-[#8AA6AB] hover:bg-[#204045]"
                  }`}
                >
                  {REGION_LABELS[key]}
                </button>
              ))}
            </div>
          </div>

          {[UPPER, LOWER].map((arch, archIndex) => (
            <div
              key={archIndex}
              className={`grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1 xl:gap-1.5 ${archIndex === 1 ? "mt-1.5 xl:mt-2" : ""}`}
            >
              {arch.map((n) => {
                const key = String(n);
                const letter = letterByTooth[key] ?? "";

                // One cell, one or two teeth. The permanent number
                // always sits on top; the baby letter appears beneath
                // it only where OpenDental says there is one, and
                // each is its own tap target.
                return (
                  <div key={n} className="flex flex-col gap-1">
                    {[key, letter].filter((t) => t !== "").map((t) => {
                      const isLetter = t === letter;
                      const mark = marks[t];
                      // Missing is recorded against the permanent
                      // slot, so it never strikes through a letter.
                      const isMissing = !isLetter && missingSet.has(t);
                      const selected = tooth === t;
                      const inRegion = !isLetter && regionTeeth.has(t);

                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => selectTooth(t)}
                          title={isLetter
                            ? `Baby tooth ${t}`
                            : `Tooth ${t}`}
                          className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border font-mono text-[11.5px] font-semibold transition-transform active:scale-95 xl:gap-1 xl:text-[13px] ${
                            isLetter ? "h-9 xl:h-11" : "h-11 xl:h-14"
                          } ${
                            selected
                              ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                              : inRegion
                                ? "border-[#EDF3F1] bg-[#204045] text-[#EDF3F1]"
                                : isMissing
                                  ? "border-[#2C4E54] bg-[#0F1D20] text-[#4A6165] line-through"
                                  : isLetter
                                    ? "border-[#3C6A5A] bg-[#16292B] text-[#9FC4A8]"
                                    : "border-[#2C4E54] bg-[#193034] text-[#8AA6AB]"
                          }`}
                        >
                          <span>{t}</span>
                          <span className="flex h-1.5 gap-1">
                            {mark?.existing && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[#79B4C4]" />
                            )}
                            {mark?.diagnosed && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[#F0A93B]" />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-[#8AA6AB]">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full bg-[#79B4C4]" /> Existing
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full bg-[#F0A93B]" /> Diagnosed
            </span>
            {hasPrimary && (
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-sm border border-[#3C6A5A] bg-[#16292B]" />
                {" "}Baby tooth
              </span>
            )}
            <span className="ml-auto">
              {tooth !== ""
                ? `${
                  letterSet.has(tooth) ? "Baby tooth" : "Tooth"
                } ${tooth}${missingSet.has(tooth) ? " · missing" : ""} · ${toothProcedures.length} on record`
                : !hasSelection
                  ? "Nothing selected"
                  : `${
                    selectionLabel.charAt(0).toUpperCase() +
                    selectionLabel.slice(1)
                  }${regionTeeth.size > 0 ? ` · ${regionTeeth.size} teeth` : ""}`}
            </span>
          </div>
        </section>

        {commitError !== "" && (
          <div className="mt-3 rounded-lg border border-[#E4674F]/50 bg-[#E4674F]/10 px-4 py-3">
            <p className="text-sm text-[#E4674F]">{commitError}</p>
          </div>
        )}

        {/* Panels */}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {buckets.map((bucket) => {
            const state = nav[bucket];
            const cats = shapedMenu.filter((m) => m.bucket === bucket);
            const accent = bucket === "existing" ? "#79B4C4" : "#F0A93B";
            const deep = state.category !== null;
            const open = panelOpen[bucket];

            return (
              <section
                key={bucket}
                className={`flex flex-col overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326] ${
                  open ? "min-h-[200px] xl:min-h-[340px]" : ""
                }`}
              >
                {/* The header is the fold. Both panels open on a wide
                    screen and both fit; in portrait, and on the
                    eleven-inch class this office runs, they push the
                    planned list off the bottom. Folding one away is
                    quicker than scrolling past it all morning. */}
                <button
                  type="button"
                  onClick={() =>
                    setPanelOpen((previous) => ({
                      ...previous,
                      [bucket]: !previous[bucket],
                    }))}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2.5 border-b border-[#2C4E54] px-4 py-3 text-left hover:bg-[#16292D]"
                >
                  <i
                    className="h-5 w-[3px] rounded-sm"
                    style={{ background: accent }}
                  />
                  <h2
                    className="text-sm font-bold tracking-[0.06em] uppercase"
                    style={{ color: accent }}
                  >
                    {bucket === "existing" ? "Existing" : "Diagnosed"}
                  </h2>
                  <span className="ml-auto truncate text-xs text-[#8AA6AB]">
                    {state.pending
                      ? `${state.category?.label} › ${state.pending.label}`
                      : state.category?.label ?? ""}
                  </span>
                  <span
                    className="shrink-0 font-mono text-xs text-[#8AA6AB]"
                    aria-hidden="true"
                  >
                    {open ? "▾" : "▸"}
                  </span>
                </button>

                {open && (
                  <>
                {deep && (
                  <button
                    type="button"
                    onClick={() => goBack(bucket)}
                    className="border-b border-[#2C4E54] px-4 py-3 text-left text-[13px] text-[#8AA6AB] hover:text-[#EDF3F1]"
                  >
                    ‹ Back
                  </button>
                )}

                {!hasSelection ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                    <strong className="text-[15px] font-medium">
                      Pick a tooth or a region
                    </strong>
                    <span className="max-w-[26ch] text-[13px] text-[#8AA6AB]">
                      Tap a tooth to chart tooth work, or a region above
                      it for a quadrant, an arch, or the whole mouth.
                    </span>
                  </div>
                ) : cats.length === 0 ? (
                  // Nothing in this bucket is charted this way. Said
                  // plainly, because an empty panel reads as broken.
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                    <strong className="text-[15px] font-medium">
                      Nothing here is {selectionLabel} work
                    </strong>
                    <span className="max-w-[28ch] text-[13px] text-[#8AA6AB]">
                      {bucket === "existing"
                        ? "Exams, x-rays and cleanings are recorded as diagnosed, on the right."
                        : "Pick a different tooth or region."}
                    </span>
                  </div>
                ) : state.pending !== null ? (
                  // ---------- confirm: surfaces, and the fee ----------
                  <>
                    {state.pending.needs_surfaces && (
                      <div className="grid grid-cols-5 gap-2 p-3 pb-0">
                        {SURFACES.map((s) => {
                          const on = state.surfaces.includes(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => toggleSurface(bucket, s)}
                              className={`h-[56px] rounded-xl border text-[19px] font-bold transition-transform active:scale-95 xl:h-[74px] xl:text-[22px] ${
                                on
                                  ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                                  : "border-[#2C4E54] bg-[#193034] text-[#EDF3F1]"
                              }`}
                            >
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {state.pending.is_paired && (
                      <p className="m-3 mb-0 rounded-xl border border-[#2C4E54] bg-[#0F1D20] p-3 text-[12.5px] leading-snug text-[#8AA6AB]">
                        Two visits: the prep now and{" "}
                        <span className="font-mono text-[#EDF3F1]">
                          {state.pending.delivery_code}
                        </span>{" "}
                        at the seat. The fee is split evenly, and either
                        line can be changed below once it is written.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        commit(bucket, state.pending!, state.surfaces)}
                      disabled={(state.pending.needs_surfaces &&
                        state.surfaces.length === 0) || committing}
                      className="m-3 rounded-xl bg-[#EDF3F1] p-4 text-[15px] font-semibold text-[#0B1719] disabled:opacity-35"
                    >
                      {committing
                        ? "Saving…"
                        : `${state.pending.label} · ${
                          tileScopeLabel(state.pending)
                        }${
                          state.surfaces.length > 0
                            ? ` · ${state.surfaces.join("")}`
                            : ""
                        }`}
                    </button>
                  </>
                ) : (
                  // ---------- categories or tiles ----------
                  <div className="grid grid-cols-2 content-start gap-2 p-2.5 xl:gap-2.5 xl:p-3">
                    {(state.category ? state.category.tiles : cats).map((item) => {
                      const isCategory = state.category === null;
                      const label = item.label;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={committing}
                          onClick={() => {
                            if (isCategory) {
                              setBucketNav(bucket, {
                                category: item as Category,
                                pending: null,
                                surfaces: [],
                              });
                            } else {
                              chooseTile(bucket, item as Tile);
                            }
                          }}
                          className={`flex flex-col justify-between gap-1 rounded-xl border border-[#2C4E54] bg-[#193034] p-2.5 text-left transition-transform hover:bg-[#204045] active:scale-[0.97] disabled:opacity-50 xl:p-3 ${
                            // A category card carries a label and a count,
                            // so it does not need a procedure tile's height.
                            // Still comfortably above the 44px that a gloved
                            // fingertip needs.
                            isCategory
                              ? "min-h-[52px] xl:min-h-[64px]"
                              : "min-h-[68px] xl:min-h-[92px]"
                          }`}
                        >
                          <span className="text-[13px] leading-tight font-semibold xl:text-[15px]">
                            {label}
                          </span>
                          {isCategory ? (
                            <span className="font-mono text-xs text-[#8AA6AB]">
                              {(item as Category).tiles.length}{" "}
                              {(item as Category).tiles.length === 1
                                ? "option"
                                : "options"} ›
                            </span>
                          ) : (
                            <span className="font-mono text-xs text-[#8AA6AB]">
                              {(item as Tile).entry_kind === "tooth_initial"
                                ? "mark tooth"
                                : shapeOfTreatArea((item as Tile).treat_area) ===
                                    "quadrant" && selection.quads.length > 1
                                  ? `${selection.quads.length} quadrants`
                                  : (item as Tile).needs_surfaces
                                    ? "pick surfaces"
                                    : (item as Tile).is_paired
                                      ? "two visits"
                                      : "one tap"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                  </>
                )}
              </section>
            );
          })}
        </div>

        {/* Pending — what OpenDental already has planned for this
            patient, including work planned at earlier visits. Read
            back rather than remembered, so it reflects what was just
            committed as well as what has been waiting for months. */}
        <section className="mt-3 overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
          {/* Title row. The bulk controls live here rather than in a
              strip that appears once something is ticked: a control
              nobody can see until they have already guessed it exists
              is not discoverable. They sit above the columns they act
              on and are greyed until a row is selected, so the screen
              says what it can do before being asked. */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[#2C4E54] px-4 py-3">
            {/* Everything OpenDental holds at ProcStatus 1 for this
                patient: diagnosed, accepted but not done, or planned
                without a priority. Completed work is never read, so it
                cannot appear here. */}
            {/* Master checkbox, in line with the row checkboxes it
                controls. It sits at the head of that column rather than
                floating mid-row, so the thing it selects is directly
                beneath it. It replaces a Clear button: anything ticked
                means the gesture is clear, nothing ticked means select
                all. */}
            <input
              ref={masterRef}
              type="checkbox"
              checked={planRows.length > 0 && selected.size === planRows.length}
              onChange={toggleAll}
              disabled={planRows.length === 0}
              className="h-5 w-5 shrink-0 accent-[#F0A93B] disabled:opacity-30"
              aria-label="Select every planned procedure"
              title={selected.size > 0 ? "Clear the selection" : "Select all"}
            />

            <h2 className="text-[13px] font-bold tracking-[0.06em] uppercase">
              Diags
            </h2>

            {planRows.length > 0 && (
              <button
                type="button"
                onClick={() => setWorkTab("plan")}
                disabled={chosenRows.length === 0}
                className="rounded-lg bg-[#F0A93B] px-4 py-1.5 text-xs font-semibold text-[#0B1719] hover:bg-[#F5BE63] disabled:opacity-40"
                title="Put the ticked procedures on a plan for the patient to read"
              >
                Create TP {chosenRows.length > 0 ? `(${chosenRows.length})` : ""}
              </button>
            )}

            <span className="font-mono text-xs text-[#8AA6AB]">
              {planLoading
                ? "reading…"
                : selected.size > 0
                  ? `${selected.size} of ${planRows.length} ticked`
                  : `${planRows.length} open · tick what to present`}
            </span>

            {/* Refresh is the only thing that re-sorts. Everything
                else keeps the order that is already on screen, and
                clears the deleted markers with it. */}
            <button
              type="button"
              onClick={() => patient && loadPlan(patient.PatNum, true, true)}
              disabled={planLoading}
              className="ml-auto rounded-lg border border-[#2C4E54] px-3 py-1.5 text-xs hover:bg-[#193034] disabled:opacity-40"
              title="Re-read this patient's plan from OpenDental and re-sort it"
            >
              Refresh
            </button>

            {/* Everything from here acts on the ticked rows, in the
                same order as the per-row controls beneath them: a bulk
                control sitting directly above the column it changes
                explains itself without a label.

                Visible always, disabled until there is something to act
                on. */}

            <select
              value=""
              disabled={selected.size === 0}
              onChange={(e) => {
                const defNum = Number(e.target.value);
                const option = diagnoses.find((d) => d.def_num === defNum);
                if (option === undefined) return;
                setPendingAction({
                  kind: "dx",
                  def_num: option.def_num,
                  label: option.label,
                });
              }}
              className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-1.5 text-xs text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none disabled:opacity-30"
              title="Set the diagnosis on every ticked procedure"
            >
              <option value="">Dx ▾</option>
              {diagnoses.map((d) => (
                <option key={d.def_num} value={d.def_num}>
                  {d.label}
                </option>
              ))}
            </select>

            <select
              value=""
              disabled={selected.size === 0}
              onChange={(e) => {
                const defNum = Number(e.target.value);
                const option = priorities.find((p) => p.def_num === defNum);
                if (option === undefined) return;
                setPendingAction({
                  kind: "priority",
                  def_num: option.def_num,
                  label: option.label,
                });
              }}
              className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-1.5 text-xs text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none disabled:opacity-30"
              title="Set the priority on every ticked procedure"
            >
              <option value="">Priority ▾</option>
              {priorities.map((p) => (
                <option key={p.def_num} value={p.def_num}>
                  {p.label}
                </option>
              ))}
            </select>

            {/* Kept apart from the rest, and last. */}
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => setPendingAction({ kind: "delete" })}
              className="rounded-lg border border-[#E4674F] px-3 py-1.5 text-xs font-semibold text-[#E4674F] hover:bg-[#2A1A18] disabled:opacity-30"
            >
              Delete…
            </button>
          </div>

          {planRows.length > 0 && (
            <div className="border-b border-[#2C4E54] px-4 py-2">
              <TotalsStrip totals={chosenTotals} emphasisePatient />
            </div>
          )}

          {planError !== "" && (
            <p className="px-4 py-3 text-sm text-[#E4674F]">{planError}</p>
          )}

          {!planLoading && planError === "" && planRows.length === 0 && (
            <p className="px-4 py-6 text-sm text-[#8AA6AB]">
              Nothing is planned for this patient yet.
            </p>
          )}

          <div className="divide-y divide-[#2C4E54]">
            {displayRows.map(({ row, deleted }) => {
              const ticked = !deleted && selected.has(row.od_id);
              const figures = figuresFor(row);
              // Accepted work is dimmed: it has been agreed and is
              // waiting to be done, so it is the settled part of the
              // list rather than the part needing attention. Dimmed,
              // not hidden — it is still tickable, and re-presenting
              // work the patient accepted and never came back for is
              // the reason this list shows it at all.
              const settled = isAcceptedLabel(row.priority_label);
              const busy =
                deleted || removingId === row.od_id || savingRow === row.od_id;
              const fromThisVisit = sessionIds.has(row.od_id);
              const editing = editingPlanFee === row.od_id;

              return (
                <div
                  key={row.od_id}
                  className={`flex items-center gap-3 px-4 py-2.5 ${
                    deleted ? "opacity-45" : settled ? "opacity-55" : ""
                  } ${ticked ? "bg-[#16292D]" : ""} ${
                    busy && !deleted ? "animate-pulse" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={ticked}
                    disabled={deleted}
                    onChange={() => toggleSelected(row.od_id)}
                    className="h-5 w-5 shrink-0 accent-[#F0A93B] disabled:opacity-30"
                    aria-label={`Select ${row.proc_code}`}
                  />

                  <div className="min-w-0 flex-1">
                    {/* Only the description gives way. v18 truncated the
                        whole line, which took the flag with it on
                        exactly the rows where it matters — a deleted
                        procedure with a long name looked like a live
                        one. The code, the tooth and the flags hold their
                        width; the description is the part a coordinator
                        can already guess from the code. */}
                    <p className="flex items-baseline gap-2 text-sm">
                      <span className="shrink-0 font-mono text-[#79B4C4]">
                        {row.proc_code}
                      </span>
                      {row.tooth !== "" && (
                        <span className="shrink-0 font-mono text-xs text-[#8AA6AB]">
                          #{row.tooth}
                          {row.surf !== "" ? ` ${row.surf}` : ""}
                        </span>
                      )}
                      <span className="truncate text-[#EDF3F1]">
                        {nameOf(row)}
                      </span>
                      {fromThisVisit && !deleted && (
                        <span
                          className="shrink-0 rounded bg-[#193034] px-1.5 py-0.5 font-mono text-[10px] text-[#79B4C4]"
                          title="Charted during this visit"
                        >
                          new
                        </span>
                      )}
                      {/* Gone from OpenDental, still holding its place
                          here so the list does not move under the next
                          tap. Refresh clears it. */}
                      {deleted && (
                        <span
                          className="shrink-0 rounded bg-[#2A1A18] px-1.5 py-0.5 font-mono text-[10px] text-[#E4674F]"
                          title="Deleted from OpenDental. Refresh to clear it from this list."
                        >
                          deleted
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-[#8AA6AB]">
                      {row.proc_date !== "" && <span>{usDate(row.proc_date)}</span>}
                      {row.no_bill_ins && (
                        <span className="text-[#F0A93B]">not billed to insurance</span>
                      )}
                    </p>
                  </div>

                  {/* Authorization used to have a dropdown of its own
                      here. It is recorded in OpenDental's priority list
                      now — Auth Needed, Auth Approved, Auth Denied —
                      which the priority control two along already
                      offers, because that list is whatever the office
                      has left unhidden. Two controls reporting one
                      field is how a screen starts to disagree with
                      itself. */}

                  {/* Diagnosis — the clinical finding. Entered here
                      because the coordinator types it while the doctor
                      dictates, and it is what a preauth narrative needs
                      later. Full names, not OpenDental's abbreviations.

                      v16 hid this below the xl breakpoint to buy width,
                      which meant the tablet — the device this screen is
                      for — had no diagnosis control at all. It is back
                      at every width, narrower on small screens. */}
                  <select
                    value={row.dx_num}
                    disabled={busy}
                    onChange={(e) => setRowDx(row, Number(e.target.value))}
                    className="w-24 shrink-0 rounded-lg border border-[#2C4E54] bg-[#193034] px-2 py-1.5 text-xs text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none disabled:opacity-40 xl:w-32"
                    title="Diagnosis in OpenDental"
                  >
                    <option value={0}>Dx —</option>
                    {diagnoses.map((d) => (
                      <option key={d.def_num} value={d.def_num}>
                        {d.label}
                      </option>
                    ))}
                  </select>

                  {/* Priority. The options are this office's own, sent
                      with the plan, because the two offices number
                      theirs differently. */}
                  <select
                    value={row.priority_num}
                    disabled={busy}
                    onChange={(e) => setRowPriority(row, Number(e.target.value))}
                    className="w-24 shrink-0 rounded-lg border border-[#2C4E54] bg-[#193034] px-2 py-1.5 text-xs text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none disabled:opacity-40 xl:w-28"
                    title="Priority in OpenDental"
                  >
                    <option value={0}>—</option>
                    {priorities.map((p) => (
                      <option key={p.def_num} value={p.def_num}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  <div className="w-28 shrink-0 text-right">
                    {editing ? (
                      <input
                        autoFocus
                        inputMode="decimal"
                        value={planFeeDraft}
                        onChange={(e) => setPlanFeeDraft(e.target.value)}
                        onBlur={() => savePlanFee(row)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") savePlanFee(row);
                          if (e.key === "Escape") setEditingPlanFee(null);
                        }}
                        className="w-full rounded-lg border border-[#F0A93B] bg-[#0B1719] px-2 py-1 text-right font-mono text-sm text-[#EDF3F1] focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingPlanFee(row.od_id);
                          setPlanFeeDraft(String(row.fee));
                        }}
                        title="Change this fee in OpenDental"
                        className="w-full rounded px-1 text-right font-mono text-sm hover:bg-[#193034] disabled:opacity-40"
                      >
                        {money(row.fee)}
                      </button>
                    )}
                    {/* Insurance and patient are this screen's
                        allocation, not OpenDental's stored figures:
                        those are capped for whatever ordering its
                        Windows client last saw. A row the maximum ran
                        out on says so rather than showing a bare zero. */}
                    <div className="font-mono text-[11px] text-[#8AA6AB]">
                      ins{" "}
                      {row.allowed === null
                        ? "—"
                        : money(figures.pri_ins + figures.sec_ins)}
                      {figures.limited && (
                        <span
                          className="ml-1 text-[#E4674F]"
                          title="The plan's annual maximum is used up before this procedure"
                        >
                          max
                        </span>
                      )}
                      {" · "}
                      <span className="text-[#F0A93B]">pt {money(figures.pat)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removePending(row)}
                    disabled={busy}
                    title={
                      deleted
                        ? "Already deleted from OpenDental"
                        : "Remove from the treatment plan in OpenDental"
                    }
                    /* Fixed width. The label goes Delete, then an
                       ellipsis, then Gone, and letting the button
                       resize between them moved every control on the
                       row — the description beside it is flex-1 and
                       absorbs whatever the button gives up. */
                    className="w-[74px] shrink-0 rounded-lg border border-[#2C4E54] px-2 py-1.5 text-center text-xs text-[#E4674F] hover:bg-[#193034] disabled:opacity-40"
                  >
                    {deleted ? "Gone" : busy ? "…" : "Delete"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
          </>
        )}

        {/* Bulk actions name what they are about to touch. A generic
            "are you sure" gets dismissed reflexively; a list of the
            actual procedures does not. */}
        {pendingAction !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
              <div className="border-b border-[#2C4E54] px-5 py-3">
                <h3 className="text-[13px] font-bold tracking-[0.06em] uppercase">
                  {pendingAction.kind === "delete"
                    ? "Delete from OpenDental"
                    : pendingAction.kind === "dx"
                      ? `Set diagnosis to ${pendingAction.label}`
                      : `Set priority to ${pendingAction.label}`}
                </h3>
                <p className="mt-1 text-xs text-[#8AA6AB]">
                  {selectedRows.length} procedure
                  {selectedRows.length === 1 ? "" : "s"}
                  {pendingAction.kind === "delete"
                    ? " will be taken off this patient's treatment plan."
                    : "."}
                </p>
              </div>

              <ul className="max-h-64 divide-y divide-[#2C4E54] overflow-y-auto">
                {selectedRows.map((row) => (
                  <li
                    key={row.od_id}
                    className="flex items-baseline gap-2 px-5 py-2 text-sm"
                  >
                    <span className="font-mono text-[#79B4C4]">
                      {row.proc_code}
                    </span>
                    {row.tooth !== "" && (
                      <span className="font-mono text-xs text-[#8AA6AB]">
                        #{row.tooth}
                      </span>
                    )}
                    <span className="truncate text-[#EDF3F1]">
                      {nameOf(row)}
                    </span>
                  </li>
                ))}
              </ul>

              {pendingAction.kind === "delete" && (
                <p className="border-t border-[#2C4E54] px-5 py-2.5 text-[11px] text-[#8AA6AB]">
                  OpenDental keeps the record — it moves to a deleted
                  status rather than being destroyed — but it cannot be
                  put back from this screen.
                </p>
              )}

              <div className="flex gap-2 border-t border-[#2C4E54] px-5 py-3">
                <button
                  type="button"
                  onClick={() => setPendingAction(null)}
                  disabled={bulkBusy}
                  className="flex-1 rounded-lg border border-[#2C4E54] px-4 py-2 text-sm hover:bg-[#193034] disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={runPendingAction}
                  disabled={bulkBusy}
                  className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                    pendingAction.kind === "delete"
                      ? "bg-[#E4674F] text-[#0B1719] hover:bg-[#EC8571]"
                      : "bg-[#F0A93B] text-[#0B1719] hover:bg-[#F5BE63]"
                  }`}
                >
                  {bulkBusy
                    ? "Working…"
                    : pendingAction.kind === "delete"
                      ? "Delete"
                      : pendingAction.kind === "dx"
                        ? "Set diagnosis"
                        : "Set priority"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Plan — the same work, laid out for the patient to read.
            No checkboxes and no delete: this is the view they are
            looking at, and editing happens on the Procedures tab. */}
        {workTab === "plan" && (
          <section className="mt-3 overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
            <div className="flex flex-wrap items-center gap-3 border-b border-[#2C4E54] px-4 py-3">
              <h2 className="text-[13px] font-bold tracking-[0.06em] uppercase">
                Treatment plan
              </h2>
              <span className="font-mono text-xs text-[#8AA6AB]">
                {planTabRows.length} procedure
                {planTabRows.length === 1 ? "" : "s"}
                {filed !== null && " · filed"}
              </span>

              <button
                type="button"
                onClick={() => setWorkTab("procedures")}
                className="ml-auto rounded-lg border border-[#2C4E54] px-3 py-1.5 text-xs hover:bg-[#193034]"
              >
                Edit treatment
              </button>
            </div>

            {/* What was filed, once something has been. The tab stops
                showing Diag work at that point: it has been accepted,
                so there is no Diag work left to show, and an empty
                table reading "nothing is at a Diag priority" would look
                like the plan had been lost. */}
            {filed !== null && (
              <div className="border-b border-[#2C4E54] bg-[#16292D] px-4 py-3">
                <p className="text-sm text-[#EDF3F1]">
                  Filed into OpenDental
                  {filed.doc_num !== null && (
                    <span className="ml-2 font-mono text-xs text-[#79B4C4]">
                      document {filed.doc_num}
                    </span>
                  )}
                </p>
                <p className="mt-1 font-mono text-[11px] text-[#8AA6AB]">
                  {new Date(filed.filed_at).toLocaleTimeString()}
                  {filed.presenter !== "" && ` · presenter ${filed.presenter}`}
                  {" · "}
                  {filed.signed ? "signed" : "not signed"}
                </p>
                {!filed.signed && (
                  <p className="mt-1 text-[11px] text-[#F0A93B]">
                    Signature capture is not built yet, so this copy carries no
                    signature. It is in the patient&apos;s chart under Treatment
                    Plans.
                  </p>
                )}
              </div>
            )}

            {planTabRows.length === 0 ? (
              <p className="px-4 py-8 text-sm text-[#8AA6AB]">
                {filed === null
                  ? "Nothing is ticked, so there is nothing to present. Tick the procedures to show on the Procedures tab — accepted work that was never done can go on a plan again."
                  : "The filed plan's procedures are no longer on this patient's chart."}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-[#2C4E54] text-[10px] uppercase tracking-wide text-[#8AA6AB]">
                        <th className="px-4 py-2 text-left font-medium">Treatment</th>
                        <th className="px-2 py-2 text-right font-medium">Fee</th>
                        <th className="px-2 py-2 text-right font-medium">Allowed</th>
                        <th className="px-2 py-2 text-right font-medium">Insurance</th>
                        <th className="px-4 py-2 text-right font-medium">You pay</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2C4E54]">
                      {planTabRows.map((row) => {
                        const figures = figuresFor(row);

                        return (
                          <tr key={row.od_id}>
                            <td className="px-4 py-2.5">
                              <div className="text-[#EDF3F1]">{nameOf(row)}</div>
                              <div className="mt-0.5 font-mono text-[11px] text-[#8AA6AB]">
                                {row.proc_code}
                                {row.tooth !== "" && ` · tooth ${row.tooth}`}
                                {row.surf !== "" && ` ${row.surf}`}
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-right font-mono">
                              {money(row.fee)}
                            </td>
                            <td className="px-2 py-2.5 text-right font-mono text-[#8AA6AB]">
                              {/* X is OpenDental's own mark for work it is
                                  not billing to insurance. */}
                              {row.allowed === null ? "X" : money(row.allowed)}
                            </td>
                            <td className="px-2 py-2.5 text-right font-mono text-[#79B4C4]">
                              {money(figures.pri_ins + figures.sec_ins)}
                              {figures.limited && (
                                <div className="text-[10px] text-[#E4674F]">
                                  annual max reached
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#F0A93B]">
                              {money(figures.pat)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-[#2C4E54] px-4 py-3">
                  <TotalsStrip totals={planTabTotals} emphasisePatient />
                  <p className="mt-2 text-[11px] text-[#8AA6AB]">
                    Insurance figures are estimates based on this plan&apos;s
                    benefits as they stand today, and depend on the deductible
                    and annual maximum. They are an estimate, not a guarantee.
                  </p>

                  {/* Said out loud, with the number, because a patient
                      looking at a reduced estimate deserves the reason
                      rather than a smaller figure than the one they were
                      quoted last visit. */}
                  {allocation.applied && allocation.remaining_max !== null && (
                    <p className="mt-1.5 text-[11px] text-[#F0A93B]">
                      This plan has {money(allocation.remaining_max)} of
                      {allocation.annual_max === null
                        ? " its annual maximum"
                        : ` its ${money(allocation.annual_max)} annual maximum`}{" "}
                      left for the year. It is applied in the order the
                      treatment is planned, and the estimate runs{" "}
                      {money(allocation.over_by)} past it, so procedures beyond
                      that point show reduced or no insurance.
                    </p>
                  )}

                  {allocation.secondary_present && (
                    <p className="mt-1.5 text-[11px] text-[#8AA6AB]">
                      A secondary plan is on file. The maximum above was applied
                      to the primary only.
                    </p>
                  )}
                </div>

                {/* Anything left at Diag after signing was not accepted.
                    It is named rather than dropped: declined work stays
                    on the plan at Diag and is re-presented next visit,
                    and a screen that simply stopped showing it would
                    look like it had been deleted. */}
                {filed !== null && declinedRows.length > 0 && (
                  <div className="border-t border-[#2C4E54] px-4 py-3">
                    <p className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[#8AA6AB]">
                      Not accepted today
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {declinedRows.map((row) => (
                        <li
                          key={row.od_id}
                          className="flex items-baseline gap-2 text-sm text-[#8AA6AB]"
                        >
                          <span className="font-mono text-[#79B4C4]">
                            {row.proc_code}
                          </span>
                          {row.tooth !== "" && (
                            <span className="font-mono text-xs">
                              #{row.tooth}
                            </span>
                          )}
                          <span className="truncate">{nameOf(row)}</span>
                          <span className="ml-auto font-mono text-xs">
                            {money(row.pat)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-[#8AA6AB]">
                      Still planned, still at Diag. It comes back the next time
                      a plan is made rather than being taken off the chart.
                    </p>
                  </div>
                )}

                {/* Signing lives on the Sign tab. One button that both
                    accepts and files, rather than two that each did
                    half of it. */}
                {filed === null && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-[#2C4E54] px-4 py-3">
                    <p className="text-xs text-[#8AA6AB]">
                      Signing files {chosenRows.length} procedure
                      {chosenRows.length === 1 ? "" : "s"} into the
                      patient&apos;s chart
                      {diagTicked > 0 &&
                        `, and moves ${diagTicked} of them from Diag to Acc in OpenDental`}
                      .
                    </p>
                    <button
                      type="button"
                      onClick={() => setWorkTab("sign")}
                      className="ml-auto rounded-lg bg-[#F0A93B] px-5 py-2 text-sm font-semibold text-[#0B1719] hover:bg-[#F5BE63]"
                    >
                      Go to Sign
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {workTab === "sign" && (
          <section className="mt-3 overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
            <div className="flex flex-wrap items-center gap-3 border-b border-[#2C4E54] px-4 py-3">
              <h2 className="text-[13px] font-bold tracking-[0.06em] uppercase">
                Sign
              </h2>
              <span className="font-mono text-xs text-[#8AA6AB]">
                {filed !== null
                  ? "filed"
                  : `${chosenRows.length} procedure${
                      chosenRows.length === 1 ? "" : "s"
                    } · ${money(chosenTotals.pat)} to the patient`}
              </span>
            </div>

            {filed !== null ? (
              <div className="px-4 py-8">
                <p className="text-sm text-[#EDF3F1]">
                  This plan has been filed into OpenDental
                  {filed.doc_num !== null && (
                    <span className="ml-2 font-mono text-xs text-[#79B4C4]">
                      document {filed.doc_num}
                    </span>
                  )}
                  .
                </p>
                <p className="mt-1.5 text-xs text-[#8AA6AB]">
                  It is in the patient&apos;s chart under Treatment Plans, and
                  the accepted work is at an Acc priority. Filing it again would
                  make a second copy, so this screen will not.
                </p>
                {/* Print stays after filing, because this is when the
                    patient usually asks for a copy. It re-renders from
                    the rows that were filed and the same signature, so
                    the paper matches the chart. Nothing is written to
                    OpenDental a second time. */}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setWorkTab("plan")}
                    className="rounded-lg border border-[#2C4E54] px-4 py-2 text-sm hover:bg-[#193034]"
                  >
                    See what was filed
                  </button>

                  <button
                    type="button"
                    onClick={() => openPdf(filedRows, signature, false)}
                    disabled={filedRows.length === 0}
                    className="rounded-lg border border-[#2C4E54] px-4 py-2 text-sm hover:bg-[#193034] disabled:opacity-40"
                  >
                    View filed plan
                  </button>

                  <button
                    type="button"
                    onClick={() => openPdf(filedRows, signature, true)}
                    disabled={filedRows.length === 0}
                    className="rounded-lg border border-[#2C4E54] px-4 py-2 text-sm hover:bg-[#193034] disabled:opacity-40"
                  >
                    Print
                  </button>
                </div>
              </div>
            ) : chosenRows.length === 0 ? (
              <p className="px-4 py-8 text-sm text-[#8AA6AB]">
                Nothing is ticked, so there is nothing to sign. Tick the
                procedures to present on the Procedures tab.
              </p>
            ) : (
              <div className="px-4 py-5">
                <p className="text-sm text-[#EDF3F1]">
                  This does two things, in this order.
                </p>
                <ol className="mt-2 space-y-1.5 text-sm text-[#8AA6AB]">
                  <li>
                    <span className="font-mono text-xs text-[#79B4C4]">1</span>
                    {"  "}
                    {diagTicked === 0
                      ? "Nothing to accept — everything ticked is already accepted or unprioritised."
                      : `Moves ${diagTicked} procedure${
                          diagTicked === 1 ? "" : "s"
                        } from Diag to Acc in OpenDental, each keeping its number.`}
                  </li>
                  <li>
                    <span className="font-mono text-xs text-[#79B4C4]">2</span>
                    {"  "}
                    Builds the plan as a PDF and files it into the
                    patient&apos;s chart under Treatment Plans.
                  </li>
                </ol>

                {presenterNum === null && (
                  <p className="mt-3 text-xs text-[#8AA6AB]">
                    Nobody is named as presenting. Choose a name at the top of
                    the screen and it prints on the plan; filing without one
                    still works.
                  </p>
                )}

                {/* The wording the signature is a signature to, in the
                    same words the PDF carries and directly above the
                    pad. A patient signing on a tablet should be able to
                    read what they are agreeing to without asking for
                    the printout. */}
                <div className="mt-5 rounded-xl border border-[#2C4E54] bg-[#0F1D20] p-3">
                  <p className="text-[11.5px] leading-snug text-[#8AA6AB]">
                    {CONSENT_TEXT}
                  </p>
                </div>

                {/* The pad sits above the buttons because the signature
                    has to be on the document the buttons produce. A pad
                    below "Accept and file" would invite filing first and
                    signing after, which files an unsigned plan. */}
                <div className="mt-4">
                  <SignaturePad
                    onChange={setSignature}
                    disabled={signing}
                    label="Patient signature"
                  />
                  <p className="mt-1.5 text-[11px] text-[#8AA6AB]">
                    {signature === null
                      ? "Unsigned. The plan can still be filed — it will be named Unsigned."
                      : "Signed. The signature prints on the filed copy."}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={signAndFile}
                    disabled={signing || planLoading}
                    className="rounded-lg bg-[#F0A93B] px-5 py-2.5 text-sm font-semibold text-[#0B1719] hover:bg-[#F5BE63] disabled:opacity-40"
                  >
                    {signing ? "Working…" : "Accept and file the plan"}
                  </button>

                  {/* Preview and Print build the same document filing
                      does, from the same function, so what the patient
                      reads on paper is what lands in the chart. Both
                      work before signing: a patient taking an unsigned
                      estimate home to think about it is a normal end to
                      the conversation, not an error. */}
                  <button
                    type="button"
                    onClick={() => openPdf(chosenRows, signature, false)}
                    disabled={signing || planLoading}
                    className="rounded-lg border border-[#2C4E54] px-4 py-2.5 text-sm hover:bg-[#193034] disabled:opacity-40"
                  >
                    Preview
                  </button>

                  <button
                    type="button"
                    onClick={() => openPdf(chosenRows, signature, true)}
                    disabled={signing || planLoading}
                    className="rounded-lg border border-[#2C4E54] px-4 py-2.5 text-sm hover:bg-[#193034] disabled:opacity-40"
                  >
                    Print
                  </button>

                  {signStep !== "" && (
                    <span className="font-mono text-xs text-[#8AA6AB]">
                      {signStep}
                    </span>
                  )}
                </div>

                {planError !== "" && (
                  <p className="mt-3 text-sm text-[#E4674F]">{planError}</p>
                )}
              </div>
            )}
          </section>
        )}

        {workTab === "financing" && (
          <section className="mt-3 rounded-2xl border border-dashed border-[#2C4E54] bg-[#122326] px-6 py-16 text-center">
            <h2 className="text-[13px] font-bold tracking-[0.06em] uppercase text-[#EDF3F1]">
              Financing
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#8AA6AB]">
              How the patient portion gets paid — in full today, or split
              across visits.
            </p>
            <p className="mt-4 font-mono text-[11px] text-[#4A6165]">
              Not built yet
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
