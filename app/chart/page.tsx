"use client";

// Chairside charting — v17
// A tablet screen for recording existing conditions and diagnosed
// treatment straight into OpenDental from the operatory.
//
// Changelog:
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
import SignaturePad from "@/app/components/SignaturePad";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type Office = { id: string; name: string; slug: string };

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

// A planned procedure as od-plan returns it. Every money field came
// from OpenDental; none of it is worked out here.
type PlanRow = {
  od_id: number;
  tooth: string;
  surf: string;
  proc_code: string;
  descript: string;
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
  write_off: number;
  deductible: number;
  pat: number;
  covered: boolean;
  no_bill_ins: boolean;
  estimated: boolean;
  // Marked as needing a preauthorization. Not an OpenDental field —
  // there isn't one — but a fixed token in the procedure note, written
  // and removed by od-plan.
  preauth: boolean;
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
  // Add or remove, decided from what is selected: a set that is
  // already entirely marked is asking to be unmarked.
  | { kind: "preauth"; mode: "add" | "remove" }
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
  const [priorities, setPriorities] = useState<DefOption[]>([]);
  const [diagnoses, setDiagnoses] = useState<DefOption[]>([]);

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
  const [menu, setMenu] = useState<Category[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [resolvedProv, setResolvedProv] = useState<ResolvedProvider | null>(null);
  const [feeSchedule, setFeeSchedule] = useState<FeeSchedule | null>(null);
  const [provOverride, setProvOverride] = useState<number | null>(null);

  const [tooth, setTooth] = useState<string>("");
  const [nav, setNav] = useState<
    Record<Bucket, NavState>
  >({
    existing: { category: null, pending: null, surfaces: [] },
    diagnosed: { category: null, pending: null, surfaces: [] },
  });

  // What this visit has marked, so a tooth lights up the moment it is
  // charted rather than after a reload. The session ledger used to
  // carry this; it is the only job of it that outlived v13.
  const [sessionMarks, setSessionMarks] = useState<
    Record<string, { existing: boolean; diagnosed: boolean }>
  >({});

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
          .select("id, name, slug")
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
    async (patNum: number, keepChoices = false) => {
      setPlanLoading(true);
      setPlanError("");

      try {
        const data = await callPlan({ action: "plan", pat_num: patNum });
        const rows = ((data.procedures ?? []) as PlanRow[]).filter(
          (r) => !isHiddenCode(r.proc_code),
        );

        setPlanRows(rows);
        setPriorities((data.priorities ?? []) as DefOption[]);
        setDiagnoses((data.diagnoses ?? []) as DefOption[]);

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

  // The office's own users. Read once per patient rather than cached,
  // because the two offices keep separate user tables and the screen
  // can change office between patients.
  const loadPresenters = useCallback(async () => {
    try {
      const data = await callPlan({ action: "presenters" });
      setPresenters((data.presenters ?? []) as Presenter[]);
    } catch {
      // A missing presenter list is not worth blocking the plan over.
      setPresenters([]);
    }
  }, [callPlan]);

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
      await loadPlan(patient.PatNum, true);
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

  // The authorization order, one row at a time. The bulk button above
  // does the same write for every ticked row; this is the same call for
  // one, so a coordinator changing their mind about a single procedure
  // does not have to tick it first.
  //
  // It is an order, not a status. Setting it says the office wants a
  // preauthorization for this procedure; it says nothing about what a
  // carrier has answered, and clearing it does not withdraw anything
  // already sent.
  async function setRowPreauth(row: PlanRow, want: boolean) {
    if (patient === null || want === row.preauth) return;

    setSavingRow(row.od_id);
    setPlanError("");

    try {
      await odWrite({
        action: "set_note",
        pat_num: patient.PatNum,
        od_id: row.od_id,
        note: "preauth",
        mode: want ? "add" : "remove",
      });
      await loadPlan(patient.PatNum, true);
    } catch (caught) {
      setPlanError(
        caught instanceof Error
          ? caught.message
          : "Couldn't change that authorization order.",
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

    for (const row of rows) {
      try {
        if (pendingAction.kind === "delete") {
          await odWrite({
            action: "remove",
            pat_num: patient.PatNum,
            od_id: row.od_id,
          });
        } else if (pendingAction.kind === "dx") {
          await odWrite({
            action: "set_dx",
            pat_num: patient.PatNum,
            od_id: row.od_id,
            dx: pendingAction.def_num,
          });
        } else if (pendingAction.kind === "preauth") {
          await odWrite({
            action: "set_note",
            pat_num: patient.PatNum,
            od_id: row.od_id,
            note: "preauth",
            mode: pendingAction.mode,
          });
        } else {
          await odWrite({
            action: "set_priority",
            pat_num: patient.PatNum,
            od_id: row.od_id,
            priority: pendingAction.def_num,
          });
        }
      } catch {
        failed.push(
          `${row.proc_code}${row.tooth === "" ? "" : ` #${row.tooth}`}`,
        );
      }
    }

    setBulkBusy(false);
    setPendingAction(null);
    setSelected(new Set());

    if (failed.length > 0) {
      setPlanError(
        `OpenDental would not change ${failed.join(", ")}. Everything else went through.`,
      );
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
    const toFlip = rows.filter(
      (r) => accForLabel(r.priority_label) !== null,
    );

    // toFlip is built from rows that already have a counterpart, so
    // this is empty by construction. It is kept because the filter
    // above is the only thing making that true, and a later change to
    // it should fail loudly here rather than silently accept work into
    // a priority that does not exist.
    const unpaired = rows.filter(
      (r) =>
        r.priority_label.trim() !== "" &&
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
      setMenu(data.menu ?? []);
      setProviders(data.providers ?? []);
      setResolvedProv(data.resolved_provider ?? null);
      setFeeSchedule(data.fee_schedule ?? null);
      setProvOverride(null);
      setTooth("");
      resetNav();
      setHits([]);
      setQuery("");

      // Not awaited. The chart is usable the moment it is drawn, and
      // pending work is for the conversation afterwards.
      void loadPlan(patNum);
      void loadPresenters();
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Couldn't open that patient.");
    } finally {
      setLoadingPatient(false);
    }
  }

  function closePatient() {
    setPatient(null);
    setProcedures([]);
    setMissingTeeth([]);
    setMenu([]);
    setFeeSchedule(null);
    setTooth("");
    resetNav();
    // The next patient starts at the chair, not mid-presentation.
    setWorkTab("procedures");
    setPlanRows([]);
    setPlanError("");
    setSelected(new Set());
    setPendingAction(null);
    setPriorities([]);
    setDiagnoses([]);
    setSessionIds(new Set());
    setSessionMarks({});
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
      if (!map[p.ToothNum]) map[p.ToothNum] = { existing: false, diagnosed: false };
      if (p.ProcStatus === "TP") map[p.ToothNum].diagnosed = true;
      else if (EXISTING_STATUSES.has(p.ProcStatus)) map[p.ToothNum].existing = true;
    }

    for (const [toothNum, mark] of Object.entries(sessionMarks)) {
      if (toothNum === "") continue;
      if (!map[toothNum]) map[toothNum] = { existing: false, diagnosed: false };
      if (mark.diagnosed) map[toothNum].diagnosed = true;
      if (mark.existing) map[toothNum].existing = true;
    }

    return map;
  }, [procedures, sessionMarks]);

  const missingSet = useMemo(() => new Set(missingTeeth), [missingTeeth]);

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
    if (tooth === "") {
      setCommitError("Pick a tooth first.");
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

      const entries: LedgerEntry[] = returned.map((line, index) => ({
        key: `${data.entry_kind}-${line.od_id ?? "none"}-${stamp}-${index}`,
        bucket,
        entry_kind: data.entry_kind,
        od_id: typeof line.od_id === "number" ? line.od_id : null,
        label: String(line.label ?? tile.label),
        code: String(line.proc_code ?? ""),
        descript: String(line.descript ?? ""),
        tooth: String(line.tooth_num ?? tooth),
        surf: String(line.surf ?? ""),
        fee: line.fee === null || line.fee === undefined
          ? null
          : String(line.fee),
        provAbbr: String(line.prov_abbr ?? ""),
        removing: false,
        undoable: line.undoable !== false,
      }));

      if (data.entry_kind === "tooth_initial") {
        const marked = entries[0]?.tooth ?? tooth;
        setMissingTeeth((prev) =>
          prev.includes(marked) ? prev : [...prev, marked]
        );
      }

      // A line landed and a later one was refused. Nothing is rolled
      // back, so say what is missing rather than looking successful.
      if (data.partial === true) {
        const failed = data.partial_failure as Record<string, unknown> | null;
        setCommitError(
          `${String(failed?.label ?? "A line")} was refused, so it is not in OpenDental. The rest went through.`,
        );
      }

      // Light the tooth immediately.
      setSessionMarks((prev) => {
        const next = { ...prev };
        for (const e of entries) {
          if (e.tooth === "") continue;
          const mark = next[e.tooth] ?? { existing: false, diagnosed: false };
          if (bucket === "diagnosed") mark.diagnosed = true;
          else mark.existing = true;
          next[e.tooth] = mark;
        }
        return next;
      });

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

  // What the Pre-Auth button will do. A selection that is entirely
  // marked is asking to be unmarked; anything else is asking to be
  // marked, so a mixed selection ends up consistent rather than flipped
  // row by row.
  const preauthMode: "add" | "remove" = useMemo(
    () =>
      selectedRows.length > 0 && selectedRows.every((r) => r.preauth)
        ? "remove"
        : "add",
    [selectedRows],
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

  // The office as it is named, for the plan's letterhead.
  const officeLabel = useMemo(
    () => offices.find((o) => o.slug === officeSlug)?.name ?? "",
    [offices, officeSlug],
  );

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
      (acc, r) => ({
        fee: acc.fee + r.fee,
        allowed: acc.allowed + (r.allowed ?? 0),
        pri_ins: acc.pri_ins + r.pri_ins,
        sec_ins: acc.sec_ins + r.sec_ins,
        write_off: acc.write_off + r.write_off,
        pat: acc.pat + r.pat,
      }),
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
  }, [chosenRows]);

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
        officeName: officeLabel,
        officePhone: "",
        heading: "Treatment Plan",
        patientName: `${patient.LName}, ${patient.Preferred || patient.FName}`,
        patientDob: usDate(patient.Birthdate),
        patientNumber: patient.PatNum,
        providerName: shownProviderName,
        presenterName,
        planDate: usDate(localISODate(new Date())),
        rows: rows.map((r) => ({
          priority: accLabelFor(r.priority_label) ?? r.priority_label,
          tooth: r.tooth,
          surf: r.surf,
          code: r.proc_code,
          description: r.descript,
          fee: r.fee,
          allowed: r.allowed,
          priIns: r.pri_ins,
          secIns: r.sec_ins,
          pat: r.pat,
        })),
        totals: {
          fee: chosenTotals.fee,
          allowed: chosenTotals.allowed,
          priIns: chosenTotals.pri_ins,
          secIns: chosenTotals.sec_ins,
          pat: chosenTotals.pat,
        },
        disclaimer:
          "Insurance figures are OpenDental's own estimates and depend on " +
          "the plan's deductible and annual maximum. They are an estimate, " +
          "not a guarantee.",
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
      officeLabel,
      shownProviderName,
      accLabelFor,
      chosenTotals,
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
      (acc, r) => ({
        fee: acc.fee + r.fee,
        allowed: acc.allowed + (r.allowed ?? 0),
        pri_ins: acc.pri_ins + r.pri_ins,
        sec_ins: acc.sec_ins + r.sec_ins,
        write_off: acc.write_off + r.write_off,
        pat: acc.pat + r.pat,
      }),
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
  }, [filed, chosenTotals, acceptedRows]);

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
            >
              Close
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
          {[UPPER, LOWER].map((arch, archIndex) => (
            <div
              key={archIndex}
              className={`grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1 xl:gap-1.5 ${archIndex === 1 ? "mt-1.5 xl:mt-2" : ""}`}
            >
              {arch.map((n) => {
                const key = String(n);
                const mark = marks[key];
                const isMissing = missingSet.has(key);
                const selected = tooth === key;

                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setTooth(selected ? "" : key);
                      resetNav();
                      setCommitError("");
                    }}
                    className={`flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border font-mono text-[11.5px] font-semibold transition-transform active:scale-95 xl:h-14 xl:gap-1 xl:text-[13px] ${
                      selected
                        ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                        : isMissing
                          ? "border-[#2C4E54] bg-[#0F1D20] text-[#4A6165] line-through"
                          : "border-[#2C4E54] bg-[#193034] text-[#8AA6AB]"
                    }`}
                  >
                    <span>{n}</span>
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
          ))}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-[#8AA6AB]">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full bg-[#79B4C4]" /> Existing
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full bg-[#F0A93B]" /> Diagnosed
            </span>
            <span className="ml-auto">
              {tooth === ""
                ? "No tooth selected"
                : `Tooth ${tooth}${missingSet.has(tooth) ? " · missing" : ""} · ${toothProcedures.length} on record`}
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
            const cats = menu.filter((m) => m.bucket === bucket);
            const accent = bucket === "existing" ? "#79B4C4" : "#F0A93B";
            const deep = state.category !== null;

            return (
              <section
                key={bucket}
                className="flex min-h-[200px] flex-col overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326] xl:min-h-[340px]"
              >
                <div className="flex items-center gap-2.5 border-b border-[#2C4E54] px-4 py-3">
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
                </div>

                {deep && (
                  <button
                    type="button"
                    onClick={() => goBack(bucket)}
                    className="border-b border-[#2C4E54] px-4 py-3 text-left text-[13px] text-[#8AA6AB] hover:text-[#EDF3F1]"
                  >
                    ‹ Back
                  </button>
                )}

                {tooth === "" ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                    <strong className="text-[15px] font-medium">Pick a tooth</strong>
                    <span className="max-w-[26ch] text-[13px] text-[#8AA6AB]">
                      Tap a tooth above to start charting.
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
                        : `${state.pending.label} · tooth ${tooth}${
                            state.surfaces.length > 0 ? ` · ${state.surfaces.join("")}` : ""
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

            <button
              type="button"
              onClick={() => patient && loadPlan(patient.PatNum, true)}
              disabled={planLoading}
              className="ml-auto rounded-lg border border-[#2C4E54] px-3 py-1.5 text-xs hover:bg-[#193034] disabled:opacity-40"
            >
              Refresh
            </button>

            {/* Everything from here acts on the ticked rows, in the
                same order as the per-row controls beneath them: a bulk
                control sitting directly above the column it changes
                explains itself without a label.

                Visible always, disabled until there is something to act
                on. */}

            {/* A toggle, not a flag. OpenDental has no preauthorization
                field anywhere, so this writes a fixed token into the
                procedure note — and a mark that could not be taken off
                would sit on the biller's worklist forever. */}
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() =>
                setPendingAction({ kind: "preauth", mode: preauthMode })}
              className="rounded-lg border border-[#2C4E54] px-3 py-1.5 text-xs hover:bg-[#193034] disabled:opacity-30"
              title="Mark or unmark these procedures as needing a preauthorization"
            >
              {preauthMode === "remove" ? "Un-Pre-Auth" : "Pre-Auth"}
            </button>

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
            {planRows.map((row) => {
              const ticked = selected.has(row.od_id);
              // Accepted work is dimmed: it has been agreed and is
              // waiting to be done, so it is the settled part of the
              // list rather than the part needing attention. Dimmed,
              // not hidden — it is still tickable, and re-presenting
              // work the patient accepted and never came back for is
              // the reason this list shows it at all.
              const settled = isAcceptedLabel(row.priority_label);
              const busy = removingId === row.od_id || savingRow === row.od_id;
              const fromThisVisit = sessionIds.has(row.od_id);
              const editing = editingPlanFee === row.od_id;

              return (
                <div
                  key={row.od_id}
                  className={`flex items-center gap-3 px-4 py-2.5 ${
                    settled ? "opacity-55" : ""
                  } ${ticked ? "bg-[#16292D]" : ""} ${
                    busy ? "animate-pulse" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={ticked}
                    onChange={() => toggleSelected(row.od_id)}
                    className="h-5 w-5 shrink-0 accent-[#F0A93B]"
                    aria-label={`Select ${row.proc_code}`}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="font-mono text-[#79B4C4]">
                        {row.proc_code}
                      </span>
                      {row.tooth !== "" && (
                        <span className="ml-2 font-mono text-xs text-[#8AA6AB]">
                          #{row.tooth}
                          {row.surf !== "" ? ` ${row.surf}` : ""}
                        </span>
                      )}
                      <span className="ml-2 text-[#EDF3F1]">{row.descript}</span>
                      {fromThisVisit && (
                        <span
                          className="ml-2 rounded bg-[#193034] px-1.5 py-0.5 font-mono text-[10px] text-[#79B4C4]"
                          title="Charted during this visit"
                        >
                          new
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

                  {/* The authorization order, under the bulk button
                      that does the same thing to every ticked row. A
                      control is easiest to understand when the bulk
                      version sits directly above the individual one.

                      Amber while set, because it is an outstanding
                      instruction rather than a neutral field. It is
                      deliberately not a status: what a carrier said
                      lives on a claim, and no claim exists yet at the
                      moment this is ticked. */}
                  <select
                    value={row.preauth ? "1" : "0"}
                    disabled={busy}
                    onChange={(e) => setRowPreauth(row, e.target.value === "1")}
                    className={`w-24 shrink-0 rounded-lg border bg-[#193034] px-2 py-1.5 text-xs focus:border-[#F0A93B] focus:outline-none disabled:opacity-40 xl:w-32 ${
                      row.preauth
                        ? "border-[#F0A93B] text-[#F0A93B]"
                        : "border-[#2C4E54] text-[#EDF3F1]"
                    }`}
                    title="Whether this office is asking for a preauthorization on this procedure"
                  >
                    <option value="0">Autho —</option>
                    <option value="1">Autho needed</option>
                  </select>

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
                    <div className="font-mono text-[11px] text-[#8AA6AB]">
                      ins {row.allowed === null ? "—" : money(row.pri_ins + row.sec_ins)}
                      {" · "}
                      <span className="text-[#F0A93B]">pt {money(row.pat)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removePending(row)}
                    disabled={busy}
                    title="Remove from the treatment plan in OpenDental"
                    className="shrink-0 rounded-lg border border-[#2C4E54] px-3 py-1.5 text-xs text-[#E4674F] hover:bg-[#193034] disabled:opacity-40"
                  >
                    {busy ? "…" : "Delete"}
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
                      : pendingAction.kind === "preauth"
                        ? pendingAction.mode === "add"
                          ? "Mark as needing authorization"
                          : "Remove the authorization mark"
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
                      {row.descript}
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

              {pendingAction.kind === "preauth" && (
                <p className="border-t border-[#2C4E54] px-5 py-2.5 text-[11px] text-[#8AA6AB]">
                  {pendingAction.mode === "add"
                    ? "This writes a line at the top of each procedure note. It does not create a preauthorization — that is still done in OpenDental, from the Treatment Plan module."
                    : "This takes that line back out. Anything typed by hand around it is kept."}
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
                        : pendingAction.kind === "preauth"
                          ? pendingAction.mode === "add"
                            ? "Mark"
                            : "Unmark"
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
                      {planTabRows.map((row) => (
                        <tr key={row.od_id}>
                          <td className="px-4 py-2.5">
                            <div className="text-[#EDF3F1]">{row.descript}</div>
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
                            {money(row.pri_ins + row.sec_ins)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#F0A93B]">
                            {money(row.pat)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-[#2C4E54] px-4 py-3">
                  <TotalsStrip totals={planTabTotals} emphasisePatient />
                  <p className="mt-2 text-[11px] text-[#8AA6AB]">
                    Insurance figures are OpenDental&apos;s own estimates and
                    depend on the plan&apos;s deductible and annual maximum.
                    They are an estimate, not a guarantee.
                  </p>
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
                          <span className="truncate">{row.descript}</span>
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

                {/* The pad sits above the buttons because the signature
                    has to be on the document the buttons produce. A pad
                    below "Accept and file" would invite filing first and
                    signing after, which files an unsigned plan. */}
                <div className="mt-5">
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


