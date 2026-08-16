// =====================================================================
// Dental OS - Edge Function: od-plan
//
// The server side of the treatment plan presentation. od-chart serves
// the chair; this serves the conversation that happens afterwards, with
// the treatment coordinator and the patient looking at one screen.
//
// Deploy path: supabase/functions/od-plan/index.ts
// Version: 9
//
// Actions:
//   { "office":"downey", "action":"plan", "pat_num":17 }
//   { "office":"downey", "action":"presenters" }
//   { "office":"downey", "action":"remove", "pat_num":17, "od_id":1081946 }
//   { "office":"downey", "action":"set_priority", "pat_num":17,
//     "od_id":1081990, "priority":153 }
//   { "office":"downey", "action":"set_fee", "pat_num":17,
//     "od_id":1081990, "fee":123.45 }
//   { "office":"downey", "action":"set_dx", "pat_num":17,
//     "od_id":1081990, "dx":115 }
//   { "office":"downey", "action":"set_note", "pat_num":17,
//     "od_id":1082014, "note":"preauth", "mode":"add" }
//   { "office":"downey", "action":"set_note", "pat_num":17,
//     "od_id":1082014, "note":"preauth", "mode":"remove" }
//
// ---------------------------------------------------------------------
// Changelog
//
//   v9  A procedure belongs to every coverage category whose span
//       contains it, not to the first one a query happens to return.
//
//       v7 and v8 kept one category per procedure and took the first
//       row back from the union. Two things at Downey make that wrong,
//       and both are live data rather than theory:
//
//       General spans D0000-D9999 and sits at CovOrder 0, so it
//       contains every procedure in the practice. Any first-match rule
//       ordered by CovOrder puts the whole plan in General.
//
//       Diag/Prev, Basic and Major are retired — covcat.IsHidden = 1 —
//       but their covspan rows were never deleted, and unordered they
//       matched first. So procedures came back as category 1, 2 or 3
//       while the plan states its deductible waivers against 10
//       (Diagnostic) and 11 (Preventive). The numbers could never meet.
//       The waiver was therefore never found, and a $50 deductible that
//       belongs on the first crown landed on the first x-ray instead,
//       moving every figure after it.
//
//       So every matching category is returned, as cov_cat_nums, and
//       whether a deductible applies becomes a question of membership:
//       does this procedure fall inside a category the plan waives.
//       That is what OpenDental's own figures show it doing.
//
//       cov_cat_num and cov_cat_name are still sent, now holding the
//       narrowest non-retired span — the most specific thing OpenDental
//       knows about the code. Crowns rather than Restorative, X-Ray
//       rather than General. They are for display; nothing decides
//       money from them.
//
//   v8  The same answers, in half the round trips.
//
//       v7 was correct and slow. Opening a patient went from four
//       OpenDental calls to seven, and OpenDental serialises them, so
//       seven calls is seven waits — measured previously at 6.7 seconds
//       for 31 sequential reads. The office noticed immediately.
//
//       The three the ceiling needed are now one union: the plan's
//       limits, what has been paid this year, and each procedure's
//       coverage category. The shapes differ so every row carries a
//       kind and the columns are read according to it. Less pleasant to
//       read than three queries; two fewer waits.
//
//       The priority and diagnosis lists moved out of plan altogether,
//       into a lists action the screen calls once when it loads. They
//       belong to the office and change perhaps twice a year, and they
//       were being re-read for every patient. plan still sends them
//       unless asked not to, so a caller built against v7 keeps
//       working.
//
//       Opening a patient is now three calls: the money, the notes, and
//       the ceiling. One fewer than before any of this began.
//
//   v7  The ceiling, and the figure it is applied to.
//
//       OpenDental caps a plan's estimates at the annual maximum, but
//       only when its own Windows client recalculates — opening the
//       Treatment Plan module is one trigger, saving from Procedure
//       Info another. Nothing this API offers will do it: the published
//       resource list has no recalculate method, and ChartModules
//       serves only ProgNotes, PatientInfo and PlannedAppts.
//
//       Measured on patient 32569 at Downey: estimates summed to
//       $2,078.20 against a $1,500 maximum. Opening the module in the
//       client wrote the capped figures back and they held after it was
//       closed. So the stored numbers are correct for whatever ordering
//       was in force the last time a person looked, and silently wrong
//       for any ordering since. That matters because acceptance changes
//       the ordering, and acceptance is what this screen exists to
//       change.
//
//       Four things are added so the screen can apply the ceiling
//       itself rather than present a number it knows may be stale:
//
//       BaseEst per procedure — the estimate before any limitation.
//       OpenDental's ComputeBaseEst finishes it and states in the
//       source that it will not be altered further; the maximum is
//       applied afterwards and writes only InsEstTotal and InsPayEst.
//       It is therefore the one figure that survives a procedure being
//       zeroed, and the only thing that makes reallocation possible
//       without this app deciding what a carrier covers.
//
//       The benefit itself — annual maximum, deductible, and how much
//       of each has gone this year. The remaining maximum is not stored
//       anywhere; it is the difference, and it is what actually
//       constrains today's plan.
//
//       Category deductibles. A plan charging $50 usually waives it for
//       Diagnostic and Preventive, and says so with one benefit row per
//       category. Without them a $13 x-ray absorbs the deductible and
//       the crown behind it does not — which matches OpenDental on the
//       total and on no individual line.
//
//       The coverage category each procedure falls in, read through
//       covspan. Nothing here decides what counts as preventive;
//       OpenDental decided that when the code was set up.
//
//       Also returned: EstimateNote, which is where OpenDental writes
//       "Over annual max" and "Exclusion" in words, and a flag for
//       whether any figure on the row was overridden by hand. An
//       overridden row is passed through untouched — a number a person
//       typed is not this app's to recompute.
//
//       Nothing was removed and nothing changed shape. Every v6 field
//       is still returned under the same name.
//
//   v6  The note comes off again, and the plan says which procedures
//       carry it.
//
//       v5 could add the token and not remove it, which made the
//       screen's preauthorization control a one-way door: a procedure
//       marked by accident stayed marked, and the biller's worklist
//       would carry it forever. Removal takes out the token and
//       nothing else. Everything a person typed around it is kept,
//       matched line by line, because a procedure note is clinical
//       record and this function has no business editing prose.
//
//       plan now returns preauth per procedure. Without it the screen
//       would have to guess the state of its own toggle, or ask once
//       per row — seventeen extra calls on a patient this size, served
//       sequentially by an API that has already been measured doing
//       exactly that at 6.7 seconds for 31.
//
//   v5  The preauthorization note.
//
//       Whether a procedure needs a preauthorization is the one fact
//       about it that OpenDental does not hold anywhere. There is no
//       flag for it on the procedure code, the fee schedule, the
//       insurance plan, the carrier or the benefit — every one of those
//       tables was read and none has a field for it, and there is no
//       preauth table either. A preauthorization is a claim with
//       ClaimType PreAuth, and it does not exist until somebody clicks
//       the button. Everything after that click OpenDental tracks well;
//       nothing before it is tracked at all.
//
//       So the office wrote it in the priority field, where it crowded
//       out the sequence, and in procedure notes, where it was typed
//       five different ways: "Autho Needed", "NO AUTHO", "to be sent
//       for pre-authorization", "need to resubmit for autho", and one
//       procedure reading "Autho Needed || Autho Completed" at once.
//       None of that can be swept.
//
//       Written by this function it is one string, spelled the same
//       way every time. The suffix is what makes the sweep possible:
//       a note carrying "(DOS Entry)" was written here rather than
//       typed, so the biller's worklist can find every procedure
//       needing a preauthorization and check it against the claims
//       that actually exist.
//
//       It is added at the top and everything already there is kept.
//       A procedure note is clinical record and this function has no
//       business editing what a person wrote. procnote is versioned —
//       448,383 rows across 373,424 procedures at Downey — so each
//       write files a new row and the old text stays readable.
//
//       Writing the same token twice is refused rather than duplicated.
//
//   v4  Diagnosis. plan now returns each procedure's Dx and the office's
//       own diagnosis list, and set_dx writes it. Nothing existing
//       changed shape: every v3 field is still returned under the same
//       name, so a screen built against v3 keeps working.
//
//   v3  set_priority and set_fee.
//   v2  remove.
//   v1  plan and presenters.
// ---------------------------------------------------------------------
//
// Why this is a separate function
//   od-chart is a large, working file that serves charting. This serves
//   presenting. Keeping them apart means a change to one cannot break
//   the other, and the two tabs already own different questions.
//
// What live probing settled, and why this file looks the way it does:
//
//   - A Saved treatment plan cannot be created through the API. POST
//     /treatplans accepts TPStatus "Saved" with 201 and files the plan
//     as Inactive anyway; PUT will not move it afterwards. So the
//     proctp table, where OpenDental freezes the money, is unreachable.
//
//   - The money is on the procedures instead, and does not need a plan
//     at all. Every treatment-planned procedure carries claimproc rows
//     at Status 6 (Estimate) holding InsPayEst, DedApplied and WriteOff.
//     Downey had 90,220 such rows at the time of writing.
//
//     Verified against patient 37078, whose printed plan totals
//     $4,516.70 fee, $3,536.70 primary insurance, $980.00 patient. The
//     same figures come out of this query.
//
//   - Primary and secondary are told apart by patplan.Ordinal, reached
//     through the claimproc's InsSubNum. Ordinal 1 is primary.
//
//   - The "X" OpenDental prints in the Allowed column is
//     claimproc.NoBillIns, not a missing estimate row. Patient 37078's
//     two D4260 lines carry an estimate row each, at Status 6, with
//     NoBillIns 1, InsPayEst 0, and the full $490 falling to the
//     patient. The covered D7210 beside them has NoBillIns 0. An
//     earlier guess that an absent estimate row meant "not covered"
//     was tested against that patient and was wrong: every one of his
//     34 planned procedures has an estimate row.
//
//     allowed is therefore returned as null when the procedure is not
//     billed to insurance, and the screen prints X. Null and zero are
//     not the same thing.
//
//   - Order follows OpenDental's printed plan: prioritised work first
//     in the priority list's own sequence, unprioritised work last.
//     The sequence is definition.ItemOrder, not the Priority value
//     itself — that is a DefNum, and its numbering has nothing to do
//     with the order the office reads. DefNum 147 is priority "1" and
//     613 is "Pre-Authorization Needed"; sorting by the number alone
//     puts them in an order nobody recognises.
//
//   - Priority, ProcFee and Dx all write. Priority and ProcFee were
//     proved on ProcNum 1081990: Priority 153 read back as "3", and a
//     fee of 123.45 stuck against a schedule fee of 210. Worth stating
//     because three fields on treatplans did the opposite — accepted
//     with 200, changed nothing. Dx is read back here for the same
//     reason rather than trusted.
//
//   - The priority list is per office and the numbering does not match.
//     Downey's DefNum 148 is "Not Accepted"; Maywood's 148 is
//     "Optional". Sending a number read from the wrong office would
//     silently set the wrong thing, so plan returns the list alongside
//     the procedures and the screen never carries one between offices.
//
//   - The diagnosis list has the same shape and the same trap. It is
//     definition Category 16, which OpenDental's setup screen calls
//     Diagnosis Types. Thirteen of the fifteen DefNums happen to match
//     across the two offices, which is worse than none matching: it
//     would let a careless build work almost everywhere. Downey's 719
//     is Watch/Observe and Maywood's 719 is not, and Maywood has no
//     Leaking Margin at all. So the list is read per office and the
//     value is validated against that office before it is written.
//
//     The field carried 267 rows across 817,000 procedures when this
//     was built, so there is effectively no legacy meaning to preserve.
//
//     OpenDental also stores a one or two letter abbreviation for each
//     diagnosis and prints it in the progress notes. It is deliberately
//     not returned: the office asked for full names on screen, and
//     sending an abbreviation invites a future screen to show it.
//
//   - Deleting a treatment-planned procedure works, and is a soft
//     delete: the row stays and moves to ProcStatus 6. Confirmed by
//     creating ProcNum 1081946 and removing it. This is why "remove"
//     reads the row back rather than trusting the HTTP code, and why
//     it refuses anything not at ProcStatus 1 — OpenDental has already
//     been seen refusing to delete rows at EO.
//
// PHI note: patient data passes through to the browser. Nothing
// patient-identifying is written to Supabase.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OD_BASE_URL = "https://api.opendental.com/api/v1";

const ALLOWED_SECRET_NAMES = new Set([
  "OD_CUSTOMER_KEY_DOWNEY",
  "OD_CUSTOMER_KEY_MAYWOOD",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// OpenDental's own numbering, confirmed by census against live data:
// 1 treatment planned (151,064 rows), 2 complete (666,067),
// 6 deleted (239,291).
const PROC_STATUS_TP = 1;
const PROC_STATUS_DELETED = 6;

// claimproc.Status 6 is Estimate.
const CLAIMPROC_ESTIMATE = 6;

// definition.Category. 20 is Treat' Plan Priorities, 16 is Diagnosis
// Types. Both were found by reading live rows, not from documentation.
const CATEGORY_PRIORITY = 20;
const CATEGORY_DIAGNOSIS = 16;

// The notes this function is allowed to write. A fixed set rather than
// free text: the whole point is that the wording never varies, and a
// note assembled from whatever the browser sent would be back to five
// spellings within a month.
//
// "(DOS Entry)" marks it as written by Dental OS. It is what makes the
// biller's sweep possible, and it distinguishes these from the notes
// staff have been typing by hand for years, which stay untouched.
const NOTE_TOKENS: Record<string, string> = {
  preauth: "Autho Needed (DOS Entry)",
};

// Take one token out of a note and leave everything else exactly as it
// was. The token is matched as a whole line first, which is how this
// function writes it. The embedded case is handled second and only if
// it is still there — someone may have typed around it in OpenDental,
// and the remainder of their sentence is theirs to keep.
function stripToken(note: string, token: string): string {
  const kept = note
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== token);

  let next = kept.join("\r\n").trim();

  if (next.includes(token)) {
    next = next.split(token).join("").trim();
  }

  return next;
}

// The newest note on each of a patient's planned procedures, and
// whether it carries the token. procnote is versioned — 448,383 rows
// across 373,424 procedures at Downey — so the newest version of each
// is selected in SQL rather than every version being read and sorted
// here.
async function preauthByProc(
  auth: string,
  patNum: number,
  token: string,
): Promise<Set<number>> {
  const { rows } = await shortQueryAll(
    auth,
    `SELECT pn.ProcNum, pn.Note FROM procnote pn ` +
      `INNER JOIN ( ` +
      `SELECT ProcNum, MAX(ProcNoteNum) AS MaxNum FROM procnote ` +
      `WHERE ProcNum IN ( ` +
      `SELECT ProcNum FROM procedurelog ` +
      `WHERE PatNum = ${patNum} AND ProcStatus = ${PROC_STATUS_TP}` +
      `) GROUP BY ProcNum` +
      `) latest ON latest.ProcNum = pn.ProcNum ` +
      `AND latest.MaxNum = pn.ProcNoteNum`,
  );

  const marked = new Set<number>();

  for (const row of rows) {
    if (String(row.Note ?? "").includes(token)) {
      marked.add(Number(row.ProcNum ?? 0));
    }
  }

  return marked;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type OdCall = {
  method: string;
  url: string;
  http_status: number;
  body: unknown;
};

async function odFetch(
  auth: string,
  method: string,
  path: string,
  payload?: unknown,
): Promise<OdCall> {
  const url = `${OD_BASE_URL}${path}`;

  const init: RequestInit = {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };

  if (payload !== undefined) init.body = JSON.stringify(payload);

  const response = await fetch(url, init);
  const text = await response.text();

  let parsed: unknown = text;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = text.slice(0, 500);
  }

  return { method, url, http_status: response.status, body: parsed };
}

function rowsOf(call: OdCall): Record<string, unknown>[] {
  return Array.isArray(call.body)
    ? (call.body as Record<string, unknown>[])
    : [];
}

// ShortQuery caps a page at 100 rows and Offset advances, so a patient
// with a long plan still comes back whole.
async function shortQueryAll(
  auth: string,
  sql: string,
  maxPages = 20,
): Promise<{ rows: Record<string, unknown>[]; failed: OdCall | null }> {
  const rows: Record<string, unknown>[] = [];

  for (let page = 0; page < maxPages; page++) {
    const offset = page * 100;
    const call = await odFetch(
      auth,
      "PUT",
      offset === 0
        ? "/queries/ShortQuery"
        : `/queries/ShortQuery?Offset=${offset}`,
      { SqlCommand: sql },
    );

    if (call.http_status < 200 || call.http_status >= 300) {
      return { rows, failed: call };
    }

    const batch = rowsOf(call);
    rows.push(...batch);
    if (batch.length < 100) break;
  }

  return { rows, failed: null };
}

const money = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

// A definition list belonging to one office, in the order that office
// reads it. Hidden entries are left out: the office hides an entry to
// retire it, and a retired entry has no business in a picker.
async function definitionList(
  auth: string,
  category: number,
): Promise<{ list: { def_num: number; label: string; order: number }[]; failed: OdCall | null }> {
  const { rows, failed } = await shortQueryAll(
    auth,
    `SELECT DefNum, ItemName, ItemOrder FROM definition ` +
      `WHERE Category = ${category} AND IsHidden = 0 ORDER BY ItemOrder`,
  );

  const list = rows.map((r) => ({
    def_num: Number(r.DefNum ?? 0),
    label: String(r.ItemName ?? "").trim(),
    order: Number(r.ItemOrder ?? 999),
  })).filter((d) => d.def_num > 0 && d.label !== "");

  return { list, failed };
}

// =====================================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "Missing Authorization bearer token." }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return json({ ok: false, error: "Invalid or expired session." }, 401);
  }

  let body: {
    office_id?: string;
    office?: string;
    action?: string;
    pat_num?: number;
    od_id?: number;
    priority?: number;
    fee?: number;
    dx?: number;
    note?: string;
    mode?: string;
    include_lists?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const action = (body.action ?? "").toLowerCase().trim();

  const ACTIONS = [
    "plan",
    "lists",
    "presenters",
    "remove",
    "set_priority",
    "set_fee",
    "set_dx",
    "set_note",
  ];

  if (!ACTIONS.includes(action)) {
    return json({
      ok: false,
      error: `action must be one of: ${ACTIONS.join(", ")}.`,
    }, 400);
  }

  if (officeId === "" && officeSlug === "") {
    return json({ ok: false, error: "Provide office_id or office." }, 400);
  }

  // ---- Office, through RLS. No role here means no row. ----
  const officeQuery = supabase
    .from("offices")
    .select("id, slug, name, organization_id, opendental_customer_key_name, is_active");

  const { data: officeRow, error: officeError } = officeId !== ""
    ? await officeQuery.eq("id", officeId).maybeSingle()
    : await officeQuery.eq("slug", officeSlug).maybeSingle();

  if (officeError) {
    return json({ ok: false, error: `Office lookup failed: ${officeError.message}` }, 500);
  }

  if (!officeRow) {
    return json({
      ok: false,
      error: "That office was not found, or you do not have a role there.",
    }, 403);
  }

  if (officeRow.is_active !== true) {
    return json({ ok: false, error: "That office is marked inactive." }, 400);
  }

  const secretName = officeRow.opendental_customer_key_name ?? "";
  if (!ALLOWED_SECRET_NAMES.has(secretName)) {
    return json({
      ok: false,
      error: "This office has no recognized OpenDental key configured.",
    }, 500);
  }

  const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
  const customerKey = Deno.env.get(secretName);

  if (!developerKey || !customerKey) {
    return json({ ok: false, error: "Missing Edge Function secrets." }, 500);
  }

  const auth = `ODFHIR ${developerKey}/${customerKey}`;

  // ===================================================================
  // presenters — who can be named as having presented the plan
  //
  // OpenDental's own user list, not this app's. UserNumPresenter is a
  // foreign key to userod, so the name shown has to be one of those.
  //
  // The daily login screen shows the same set: it is a scrolling list
  // of every non-hidden user, which reads as far fewer than it holds.
  // No group filter, because staff are cross-trained and a biller or a
  // manager presents plans as readily as a treatment coordinator.
  // ===================================================================
  // ===================================================================
  // lists — the office's priority and diagnosis definitions
  //
  // Read once when the screen loads rather than on every patient open.
  // They belong to the office and change perhaps twice a year, and two
  // serialised OpenDental calls per patient for data that has not moved
  // since the morning is two waits the coordinator did not need.
  //
  // Still per office and never cached across them: Downey's DefNum 148
  // is "Not Accepted" and Maywood's is "Optional", so a list carried
  // between offices would set the wrong thing without ever looking
  // wrong.
  // ===================================================================
  if (action === "lists") {
    const priorityList = await definitionList(auth, CATEGORY_PRIORITY);
    const diagnosisList = await definitionList(auth, CATEGORY_DIAGNOSIS);

    if (priorityList.failed !== null || diagnosisList.failed !== null) {
      return json({
        ok: false,
        error: "OpenDental could not read this office's definition lists.",
        detail: (priorityList.failed ?? diagnosisList.failed)?.body,
      }, 502);
    }

    return json({
      ok: true,
      office: officeRow.name,
      office_slug: officeRow.slug,
      priorities: priorityList.list,
      diagnoses: diagnosisList.list,
    });
  }

  if (action === "presenters") {
    const { rows, failed } = await shortQueryAll(
      auth,
      `SELECT UserNum, UserName FROM userod ` +
        `WHERE IsHidden = 0 ORDER BY UserName`,
    );

    if (failed !== null) {
      return json({
        ok: false,
        error: "OpenDental could not list its users.",
        detail: failed.body,
      }, 502);
    }

    return json({
      ok: true,
      office: officeRow.name,
      count: rows.length,
      presenters: rows.map((r) => ({
        user_num: Number(r.UserNum ?? 0),
        name: String(r.UserName ?? "").trim(),
      })).filter((u) => u.user_num > 0 && u.name !== ""),
    });
  }

  const patNum = body.pat_num;

  if (typeof patNum !== "number" || patNum <= 0) {
    return json({ ok: false, error: "pat_num is required." }, 400);
  }

  // ===================================================================
  // plan — every treatment-planned procedure, with the money
  // ===================================================================
  if (action === "plan") {
    const sql =
      `SELECT pl.ProcNum, pl.ToothNum, pl.Surf, pl.Priority, pl.Dx, ` +
      `pl.ProcDate, pl.ProcFee, ` +
      `d.ItemName AS PriorityName, d.ItemOrder AS PriorityOrder, ` +
      `dx.ItemName AS DxName, ` +
      `pc.ProcCode, pc.Descript, ` +
      `pr.Abbr AS ProvAbbr, ` +
      `COUNT(cp.ClaimProcNum) AS EstRows, ` +
      `COALESCE(SUM(CASE WHEN pp.Ordinal = 1 THEN cp.InsPayEst ELSE 0 END), 0) AS PriIns, ` +
      `COALESCE(SUM(CASE WHEN pp.Ordinal > 1 THEN cp.InsPayEst ELSE 0 END), 0) AS SecIns, ` +
      // BaseEst is the estimate before any limitation is applied.
      // OpenDental's ComputeBaseEst finishes it and states in the
      // source that it will not be altered further; the annual maximum
      // is applied afterwards and touches only InsEstTotal and
      // InsPayEst. So this is the one figure that survives a procedure
      // being zeroed for running past the maximum, and the only thing
      // that makes reallocation possible without recomputing what a
      // carrier covers.
      `COALESCE(SUM(CASE WHEN pp.Ordinal = 1 THEN cp.BaseEst ELSE 0 END), 0) AS PriBase, ` +
      `COALESCE(SUM(CASE WHEN pp.Ordinal > 1 THEN cp.BaseEst ELSE 0 END), 0) AS SecBase, ` +
      `COALESCE(SUM(cp.WriteOff), 0) AS WriteOff, ` +
      `COALESCE(SUM(cp.DedApplied), 0) AS DedApplied, ` +
      `COALESCE(MAX(cp.NoBillIns), 0) AS NoBillIns, ` +
      // OpenDental's own words for why a figure is what it is: "Over
      // annual max", "Exclusion", an age limitation. Shown rather than
      // inferred — a reason read from the source of truth beats one
      // this app guesses at.
      `COALESCE(MAX(cp.EstimateNote), '') AS EstimateNote, ` +
      // A hand-typed override. OpenDental stores -1 for "none", so
      // anything else means a human decided this number and no
      // reallocation may touch it.
      `MAX(CASE WHEN cp.InsEstTotalOverride <> -1 ` +
      `OR cp.DedEstOverride <> -1 OR cp.PercentOverride <> -1 ` +
      `THEN 1 ELSE 0 END) AS HasOverride, ` +
      `MAX(CASE WHEN pp.Ordinal = 1 THEN cp.PlanNum ELSE NULL END) AS PriPlanNum ` +
      `FROM procedurelog pl ` +
      `INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum ` +
      `LEFT JOIN provider pr ON pr.ProvNum = pl.ProvNum ` +
      `LEFT JOIN definition d ON d.DefNum = pl.Priority ` +
      `LEFT JOIN definition dx ON dx.DefNum = pl.Dx ` +
      `LEFT JOIN claimproc cp ON cp.ProcNum = pl.ProcNum ` +
      `AND cp.Status = ${CLAIMPROC_ESTIMATE} ` +
      `LEFT JOIN patplan pp ON pp.InsSubNum = cp.InsSubNum ` +
      `WHERE pl.PatNum = ${patNum} AND pl.ProcStatus = ${PROC_STATUS_TP} ` +
      `GROUP BY pl.ProcNum, pl.ToothNum, pl.Surf, pl.Priority, pl.Dx, ` +
      `pl.ProcDate, pl.ProcFee, d.ItemName, d.ItemOrder, dx.ItemName, ` +
      `pc.ProcCode, pc.Descript, pr.Abbr ` +
      // Unprioritised work sits at the bottom, as OpenDental prints it.
      `ORDER BY CASE WHEN pl.Priority = 0 THEN 1 ELSE 0 END, ` +
      `d.ItemOrder, pl.Priority, pl.ProcNum`;

    const { rows, failed } = await shortQueryAll(auth, sql);

    if (failed !== null) {
      return json({
        ok: false,
        error: "OpenDental could not read this patient's planned treatment.",
        detail: failed.body,
      }, 502);
    }

    // Both dropdowns' options, from this office's own definitions. Sent
    // with the plan rather than fetched separately, because a screen
    // holding a list from the other office would set the wrong value
    // without ever looking wrong.
    // The two dropdown lists. They belong to the office, not the
    // patient, and change perhaps twice a year — but they were being
    // read on every patient open, which is two serialised OpenDental
    // calls per patient for data that had not moved since the morning.
    //
    // The screen now reads them once, through the lists action, and
    // asks for them here only if it has not. Default is to send them,
    // so a caller that has not been updated keeps working.
    const wantLists = body.include_lists !== false;

    const priorityList = wantLists
      ? await definitionList(auth, CATEGORY_PRIORITY)
      : { list: [], failed: null };

    const diagnosisList = wantLists
      ? await definitionList(auth, CATEGORY_DIAGNOSIS)
      : { list: [], failed: null };

    // Which procedures already carry the preauthorization token. Read
    // separately from the money so that query stays as it was verified.
    const preauthSet = await preauthByProc(
      auth,
      patNum,
      NOTE_TOKENS.preauth,
    );

    // ---------------------------------------------------------------
    // The ceiling, in one round trip.
    //
    // OpenDental applies the annual maximum inside its Windows client
    // and stores the result, but nothing this app can call makes it
    // recalculate. So a plan reordered chairside carries figures capped
    // for an ordering that no longer exists, and the screen has to
    // apply the ceiling itself.
    //
    // Three things are needed for that: the maximum and deductible, how
    // much of each has gone this year, and which coverage category each
    // procedure falls in. v7 asked for them as three queries, which
    // cost three round trips on every patient open — and OpenDental
    // serialises API calls, so three round trips is three waits, not
    // one. Together with the money and the notes that made seven calls
    // to open a patient, and the office felt it.
    //
    // They are unioned instead. The shapes differ, so each row carries
    // a kind and the columns are read according to it — ugly to read,
    // but one wait instead of three.
    //
    // Nothing here decides what a carrier covers. That is BaseEst, read
    // with the money above, and it is never recomputed.
    const yearStart = `${new Date().getFullYear()}-01-01`;

    const ceilingSql =
      // The plan's own limits. BenefitType 5 is the annual maximum and
      // 2 is the deductible. A row with no category is the plan-wide
      // one; rows with a category are the waivers, and a plan charging
      // $50 usually waives it for Diagnostic and Preventive.
      `SELECT 'benefit' AS Kind, b.PlanNum AS NumA, ` +
      `b.BenefitType AS NumB, b.MonetaryAmt AS Amt, ` +
      `b.CovCatNum AS NumC, ` +
      `COALESCE(cat.Description, '') AS Label, ` +
      `COALESCE(pp.Ordinal, 0) AS NumD ` +
      `FROM benefit b ` +
      `LEFT JOIN covcat cat ON cat.CovCatNum = b.CovCatNum ` +
      `INNER JOIN inssub isub ON isub.PlanNum = b.PlanNum ` +
      `INNER JOIN patplan pp ON pp.InsSubNum = isub.InsSubNum ` +
      `WHERE pp.PatNum = ${patNum} AND b.BenefitType IN (2, 5) ` +

      `UNION ALL ` +

      // What the carrier has already paid this benefit year. The
      // maximum that constrains today's plan is what is left of it, and
      // OpenDental does not store that — it is the difference.
      //
      // The benefit year is taken as the calendar year, which is what
      // both offices use. A service-year plan would need its renewal
      // month and is not handled.
      `SELECT 'used' AS Kind, cp.PlanNum AS NumA, ` +
      `0 AS NumB, COALESCE(SUM(cp.InsPayAmt), 0) AS Amt, ` +
      `0 AS NumC, '' AS Label, 0 AS NumD ` +
      `FROM claimproc cp ` +
      `WHERE cp.PatNum = ${patNum} AND cp.DateCP >= '${yearStart}' ` +
      `AND cp.InsPayAmt > 0 GROUP BY cp.PlanNum ` +

      `UNION ALL ` +

      // Every coverage category each planned procedure falls in, which
      // is what decides whether a deductible applies to it. Read rather
      // than inferred: nothing here decides what counts as preventive,
      // OpenDental decided that when the code was set up.
      //
      // All of them, not one. A code sits inside several spans at once
      // — General covers D0000-D9999 — and which one matters depends on
      // what the plan says, not on what a query returns first.
      //
      // NumB carries IsHidden and Amt carries the width of the span, so
      // the caller can tell a retired category from a live one and the
      // narrowest from the broadest without a second round trip.
      `SELECT 'cat' AS Kind, pl.ProcNum AS NumA, ` +
      `cov.IsHidden AS NumB, ` +
      `(CAST(SUBSTRING(cs.ToCode, 2) AS UNSIGNED) - ` +
      `CAST(SUBSTRING(cs.FromCode, 2) AS UNSIGNED)) AS Amt, ` +
      `cov.CovCatNum AS NumC, ` +
      `COALESCE(cov.Description, '') AS Label, 0 AS NumD ` +
      `FROM procedurelog pl ` +
      `INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum ` +
      `INNER JOIN covspan cs ON pc.ProcCode BETWEEN cs.FromCode AND cs.ToCode ` +
      `INNER JOIN covcat cov ON cov.CovCatNum = cs.CovCatNum ` +
      `WHERE pl.PatNum = ${patNum} AND pl.ProcStatus = ${PROC_STATUS_TP}`;

    const ceilingRows = (await shortQueryAll(auth, ceilingSql)).rows;

    const benefitRows = ceilingRows.filter((r) => r.Kind === "benefit");

    const usedByPlan = new Map<number, number>();
    for (const r of ceilingRows.filter((r) => r.Kind === "used")) {
      usedByPlan.set(Number(r.NumA ?? 0), money(r.Amt));
    }

    // A procedure falls in every span whose range contains its code,
    // and that is normally several. Keeping the first was wrong twice
    // over at Downey: General spans D0000-D9999, so it contains
    // everything, and the retired Diag/Prev, Basic and Major still have
    // covspan rows, so they matched while the plan's waivers name
    // Diagnostic and Preventive. Nothing ever matched, and the
    // deductible went to the wrong procedure.
    //
    // So all of them are kept, and whether a deductible applies becomes
    // a membership test the caller can make against what the plan
    // actually states.
    const catsByProc = new Map<number, number[]>();

    // What to show a human: the narrowest live span, which is the most
    // specific thing OpenDental knows about the code. Retired
    // categories are left out of this — they are not what the office
    // reads today — but they stay in the list above, because a plan
    // written years ago may still name one.
    const displayCat = new Map<
      number,
      { num: number; name: string; width: number }
    >();

    for (const r of ceilingRows.filter((r) => r.Kind === "cat")) {
      const procNum = Number(r.NumA ?? 0);
      const covCatNum = Number(r.NumC ?? 0);
      if (procNum === 0 || covCatNum === 0) continue;

      const list = catsByProc.get(procNum) ?? [];
      if (!list.includes(covCatNum)) list.push(covCatNum);
      catsByProc.set(procNum, list);

      if (Number(r.NumB ?? 0) === 1) continue;

      const width = Number(r.Amt ?? 0);
      const best = displayCat.get(procNum);

      if (best === undefined || width < best.width) {
        displayCat.set(procNum, {
          num: covCatNum,
          name: String(r.Label ?? "").trim(),
          width,
        });
      }
    }

    const planNums = Array.from(
      new Set(benefitRows.map((r) => Number(r.NumA ?? 0))),
    ).filter((n) => n > 0);

    const benefits = planNums.map((planNum) => {
      const forPlan = benefitRows.filter(
        (r) => Number(r.NumA ?? 0) === planNum,
      );

      const annualMaxRow = forPlan.find(
        (r) => Number(r.NumB) === 5 && Number(r.NumC ?? 0) === 0,
      );

      // The plan-wide deductible is the one with no category attached.
      const deductibleRow = forPlan.find(
        (r) => Number(r.NumB) === 2 && Number(r.NumC ?? 0) === 0,
      );

      // Categories the plan states a different deductible for. In
      // practice these are the zeroes. Sent as a list rather than
      // folded into one number, because which procedure bears the
      // deductible changes which row on the printed plan shows it, and
      // a coordinator comparing the tablet against OpenDental notices.
      const categoryDeductibles = forPlan
        .filter((r) => Number(r.NumB) === 2 && Number(r.NumC ?? 0) !== 0)
        .map((r) => ({
          cov_cat_num: Number(r.NumC ?? 0),
          category_name: String(r.Label ?? "").trim(),
          amount: money(r.Amt),
        }));

      const paid = usedByPlan.get(planNum) ?? 0;

      // -1 is OpenDental's "not specified". A plan with no stated
      // maximum has no ceiling to apply, and null says that plainly
      // rather than pretending the limit is zero.
      const rawMax = annualMaxRow === undefined ? -1 : money(annualMaxRow.Amt);
      const rawDed = deductibleRow === undefined ? -1 : money(deductibleRow.Amt);

      const annualMax = rawMax > 0 ? rawMax : null;
      const deductible = rawDed >= 0 ? rawDed : null;

      return {
        plan_num: planNum,
        ordinal: Number(forPlan[0]?.NumD ?? 0),
        annual_max: annualMax,
        deductible,
        category_deductibles: categoryDeductibles,
        paid_this_year: paid,
        // OpenDental does not record deductible taken separately from
        // payment on a paid claim in a way this can read reliably, so
        // it is reported as zero rather than guessed at.
        deductible_used: 0,
        remaining_max: annualMax === null
          ? null
          : Math.round((annualMax - paid) * 100) / 100,
        benefit_year_start: yearStart,
      };
    });

    const procedures = rows.map((r) => {
      const fee = money(r.ProcFee);
      const priIns = money(r.PriIns);
      const secIns = money(r.SecIns);
      const writeOff = money(r.WriteOff);
      const estRows = Number(r.EstRows ?? 0);
      const noBillIns = Number(r.NoBillIns ?? 0) === 1;

      // Not billed to insurance, or never estimated at all. Either way
      // there is no allowed amount to show and OpenDental prints an X.
      const covered = estRows > 0 && !noBillIns;
      const allowed = covered ? Math.round((fee - writeOff) * 100) / 100 : null;

      // What the patient owes is what is left once insurance and the
      // PPO adjustment have taken their share.
      const pat = Math.round((fee - priIns - secIns - writeOff) * 100) / 100;

      const priorityNum = Number(r.Priority ?? 0);
      const dxNum = Number(r.Dx ?? 0);

      return {
        od_id: Number(r.ProcNum ?? 0),
        tooth: String(r.ToothNum ?? "").trim(),
        surf: String(r.Surf ?? "").trim(),
        proc_code: String(r.ProcCode ?? "").trim(),
        descript: String(r.Descript ?? "").trim(),
        prov_abbr: String(r.ProvAbbr ?? "").trim(),
        proc_date: String(r.ProcDate ?? "").slice(0, 10),

        // Priority carries both the sequence and, by the office's
        // forward convention, acceptance: 1-8 means accepted, blank
        // means not. Legacy rows do not follow it, so the label is
        // shown as it stands rather than interpreted.
        priority_num: priorityNum,
        priority_label: String(r.PriorityName ?? "").trim(),
        priority_order: Number(r.PriorityOrder ?? 999),

        // The clinical finding behind the procedure. Zero is how
        // OpenDental stores "none chosen", and the label is empty
        // rather than invented.
        dx_num: dxNum,
        dx_label: String(r.DxName ?? "").trim(),

        fee,
        allowed,
        pri_ins: priIns,
        sec_ins: secIns,

        // The uncapped estimate, and whether anything about this row
        // was decided by hand. Both are needed to reallocate a
        // remaining annual maximum honestly; neither is displayed
        // directly.
        pri_base: money(r.PriBase),
        sec_base: money(r.SecBase),
        has_override: Number(r.HasOverride ?? 0) === 1,
        estimate_note: String(r.EstimateNote ?? "").trim(),
        pri_plan_num: Number(r.PriPlanNum ?? 0),

        // Every coverage category this procedure falls in. This is
        // what decides whether the plan's deductible applies to it: the
        // plan waives the deductible per category, and a procedure is
        // waived if it is inside one of those categories.
        cov_cat_nums: catsByProc.get(Number(r.ProcNum ?? 0)) ?? [],

        // The narrowest live category, for showing a person. Nothing
        // decides money from these two.
        cov_cat_num: displayCat.get(Number(r.ProcNum ?? 0))?.num ?? 0,
        cov_cat_name: displayCat.get(Number(r.ProcNum ?? 0))?.name ?? "",
        write_off: writeOff,
        deductible: money(r.DedApplied),
        pat,
        covered,
        // Why it is not covered, so the coordinator can say something
        // more useful than "insurance won't pay".
        no_bill_ins: noBillIns,
        estimated: estRows > 0,

        // Whether this procedure is marked as needing a
        // preauthorization. It is a note written by this app, not an
        // OpenDental field — there is no such field anywhere.
        preauth: preauthSet.has(Number(r.ProcNum ?? 0)),
      };
    });

    const totals = procedures.reduce(
      (acc, p) => ({
        fee: acc.fee + p.fee,
        allowed: acc.allowed + (p.allowed ?? 0),
        pri_ins: acc.pri_ins + p.pri_ins,
        sec_ins: acc.sec_ins + p.sec_ins,
        write_off: acc.write_off + p.write_off,
        pat: acc.pat + p.pat,
      }),
      { fee: 0, allowed: 0, pri_ins: 0, sec_ins: 0, write_off: 0, pat: 0 },
    );

    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      totals[key] = Math.round(totals[key] * 100) / 100;
    }

    return json({
      ok: true,
      office: officeRow.name,
      office_slug: officeRow.slug,
      pat_num: patNum,
      count: procedures.length,
      procedures,
      totals,
      priorities: priorityList.list,
      diagnoses: diagnosisList.list,
      // The ceiling, per plan. Sent alongside the rows rather than
      // folded into them, because applying it is a decision the screen
      // makes and shows its working for, not a number that arrives
      // looking like OpenDental's.
      benefits,
      // Named so the screen can say where a number came from rather
      // than presenting it as this app's arithmetic.
      money_source:
        "OpenDental procedure fees and its own insurance estimates (claimproc).",
    });
  }

  // ===================================================================
  // set_priority / set_fee / set_dx — edit one planned procedure
  //
  // Each sends one field and nothing else, and reads the row back
  // rather than trusting the response, because this API has form for
  // accepting a value and keeping its own.
  // ===================================================================
  if (action === "set_priority" || action === "set_fee" || action === "set_dx") {
    const odId = body.od_id;

    if (typeof odId !== "number" || odId <= 0) {
      return json({ ok: false, error: "od_id is required." }, 400);
    }

    const before = await odFetch(auth, "GET", `/procedurelogs/${odId}`);

    if (before.http_status === 404) {
      return json({
        ok: false,
        error: "That procedure is no longer in OpenDental.",
      }, 404);
    }

    if (before.http_status < 200 || before.http_status >= 300) {
      return json({
        ok: false,
        error: "OpenDental could not read that procedure.",
        detail: before.body,
      }, 502);
    }

    const beforeBody = (before.body ?? {}) as Record<string, unknown>;

    // An od_id from a stale screen must not reach another patient.
    if (Number(beforeBody.PatNum ?? 0) !== patNum) {
      return json({
        ok: false,
        error: "That procedure belongs to a different patient.",
      }, 403);
    }

    let payload: Record<string, unknown>;
    let previous: unknown;
    let requested: number;
    let fieldName: string;

    if (action === "set_fee") {
      const fee = body.fee;
      if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0) {
        return json({
          ok: false,
          error: "fee must be a number of zero or more.",
        }, 400);
      }
      requested = Math.round(fee * 100) / 100;
      previous = beforeBody.ProcFee ?? null;
      payload = { ProcFee: requested };
      fieldName = "ProcFee";
    } else {
      // Priority and Dx are both definition numbers and are validated
      // the same way. The number has to belong to this office's own
      // list: Downey's 148 is "Not Accepted" and Maywood's 148 is
      // "Optional", so a value carried across offices would set
      // something nobody chose. Zero is allowed for either — it is how
      // OpenDental stores "not set".
      const isDx = action === "set_dx";
      const value = isDx ? body.dx : body.priority;
      const category = isDx ? CATEGORY_DIAGNOSIS : CATEGORY_PRIORITY;
      const noun = isDx ? "diagnosis" : "priority";

      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return json({
          ok: false,
          error: `${noun} must be a definition number, or 0 to clear it.`,
        }, 400);
      }

      if (value !== 0) {
        const known = await shortQueryAll(
          auth,
          `SELECT DefNum FROM definition ` +
            `WHERE Category = ${category} AND DefNum = ${value}`,
        );

        if (known.rows.length === 0) {
          return json({
            ok: false,
            error: `${value} is not a ${noun} at this office.`,
          }, 400);
        }
      }

      requested = value;
      previous = (isDx ? beforeBody.Dx : beforeBody.Priority) ?? null;
      payload = isDx ? { Dx: value } : { Priority: value };
      fieldName = isDx ? "Dx" : "Priority";
    }

    const put = await odFetch(auth, "PUT", `/procedurelogs/${odId}`, payload);

    if (put.http_status < 200 || put.http_status >= 300) {
      return json({
        ok: false,
        error: "OpenDental would not accept that change.",
        detail: put.body,
      }, 502);
    }

    // Proof, not the response body.
    const check = await shortQueryAll(
      auth,
      `SELECT pl.ProcFee, pl.Priority, pl.Dx, ` +
        `d.ItemName AS PriorityName, dx.ItemName AS DxName ` +
        `FROM procedurelog pl ` +
        `LEFT JOIN definition d ON d.DefNum = pl.Priority ` +
        `LEFT JOIN definition dx ON dx.DefNum = pl.Dx ` +
        `WHERE pl.ProcNum = ${odId}`,
    );

    const stored = (check.rows[0] ?? {}) as Record<string, unknown>;

    let storedValue: number;
    if (action === "set_fee") {
      storedValue = Math.round(Number(stored.ProcFee ?? -1) * 100) / 100;
    } else if (action === "set_dx") {
      storedValue = Number(stored.Dx ?? -1);
    } else {
      storedValue = Number(stored.Priority ?? -1);
    }

    const honoured = action === "set_fee"
      ? Math.round(storedValue * 100) === Math.round(requested * 100)
      : storedValue === requested;

    return json({
      ok: honoured,
      od_id: odId,
      field: fieldName,
      previous,
      requested,
      stored: storedValue,
      priority_label: String(stored.PriorityName ?? "").trim(),
      dx_label: String(stored.DxName ?? "").trim(),
      // False means OpenDental took the call and kept its own value.
      // The screen should show what is stored, not what was asked for.
      honoured,
      error: honoured
        ? undefined
        : "OpenDental accepted the change and kept its own value.",
      changed_by: userData.user.email,
      changed_at: new Date().toISOString(),
    });
  }

  // ===================================================================
  // set_note — add a fixed note to a procedure
  //
  // Adds at the top and keeps everything already written. procnote is
  // versioned, so this files a new row rather than overwriting one, and
  // the previous text stays readable in OpenDental's history.
  // ===================================================================
  if (action === "set_note") {
    const odId = body.od_id;

    if (typeof odId !== "number" || odId <= 0) {
      return json({ ok: false, error: "od_id is required." }, 400);
    }

    const noteKey = (body.note ?? "").toLowerCase().trim();
    const noteText = NOTE_TOKENS[noteKey];

    if (noteText === undefined) {
      return json({
        ok: false,
        error: `note must be one of: ${Object.keys(NOTE_TOKENS).join(", ")}.`,
      }, 400);
    }

    // Add unless removal is asked for. Defaulting this way keeps every
    // v5 caller working unchanged.
    const mode = (body.mode ?? "add").toLowerCase().trim();

    if (mode !== "add" && mode !== "remove") {
      return json({
        ok: false,
        error: "mode must be add or remove.",
      }, 400);
    }

    // The procedure has to belong to this patient. An od_id from a
    // stale screen could otherwise annotate someone else's chart.
    const before = await odFetch(auth, "GET", `/procedurelogs/${odId}`);

    if (before.http_status === 404) {
      return json({
        ok: false,
        error: "That procedure is no longer in OpenDental.",
      }, 404);
    }

    if (before.http_status < 200 || before.http_status >= 300) {
      return json({
        ok: false,
        error: "OpenDental could not read that procedure.",
        detail: before.body,
      }, 502);
    }

    const beforeBody = (before.body ?? {}) as Record<string, unknown>;

    if (Number(beforeBody.PatNum ?? 0) !== patNum) {
      return json({
        ok: false,
        error: "That procedure belongs to a different patient.",
      }, 403);
    }

    // The note as it stands. procnotes returns every version, newest
    // first is not guaranteed, so the latest is chosen by its own key.
    const existing = await odFetch(auth, "GET", `/procnotes?ProcNum=${odId}`);
    const noteRows = rowsOf(existing);

    let latest = "";
    let latestNum = -1;

    for (const row of noteRows) {
      const num = Number(row.ProcNoteNum ?? 0);
      if (num > latestNum) {
        latestNum = num;
        latest = String(row.Note ?? "");
      }
    }

    const wasPresent = latest.includes(noteText);

    // Nothing to do. Adding a token twice makes the biller's count
    // wrong; removing one that was never there files a pointless
    // version of a clinical note.
    if (wasPresent === (mode === "add")) {
      return json({
        ok: true,
        od_id: odId,
        note: noteText,
        mode,
        present: wasPresent,
        already_present: wasPresent,
        wrote: false,
        changed_by: userData.user.email,
        changed_at: new Date().toISOString(),
      });
    }

    const combined = mode === "remove"
      ? stripToken(latest, noteText)
      : latest.trim() === ""
      ? noteText
      : `${noteText}\r\n${latest}`;

    const posted = await odFetch(auth, "POST", "/procnotes", {
      PatNum: patNum,
      ProcNum: odId,
      Note: combined,
    });

    if (posted.http_status < 200 || posted.http_status >= 300) {
      return json({
        ok: false,
        error: "OpenDental would not accept that note.",
        detail: posted.body,
      }, 502);
    }

    // Proof, not the response body.
    const check = await shortQueryAll(
      auth,
      `SELECT Note FROM procnote WHERE ProcNum = ${odId} ` +
        `ORDER BY ProcNoteNum DESC LIMIT 1`,
    );

    const stored = String(
      (check.rows[0] ?? {}).Note ?? "",
    );

    // What OpenDental now holds, which is the only answer that counts.
    const nowPresent = stored.includes(noteText);
    const honoured = nowPresent === (mode === "add");

    return json({
      ok: honoured,
      od_id: odId,
      note: noteText,
      mode,
      present: nowPresent,
      already_present: false,
      wrote: honoured,
      stored,
      honoured,
      error: honoured
        ? undefined
        : mode === "add"
        ? "OpenDental accepted the note and did not store it."
        : "OpenDental accepted the removal and kept the note.",
      changed_by: userData.user.email,
      changed_at: new Date().toISOString(),
    });
  }

  // ===================================================================
  // remove — take a planned procedure off the plan
  //
  // OpenDental soft-deletes: the row stays and moves to ProcStatus 6.
  // The HTTP code is therefore not the answer, and the row is read back.
  // ===================================================================
  const odId = body.od_id;

  if (typeof odId !== "number" || odId <= 0) {
    return json({ ok: false, error: "od_id is required." }, 400);
  }

  const before = await odFetch(auth, "GET", `/procedurelogs/${odId}`);

  if (before.http_status === 404) {
    return json({
      ok: false,
      error: "That procedure is no longer in OpenDental.",
    }, 404);
  }

  if (before.http_status < 200 || before.http_status >= 300) {
    return json({
      ok: false,
      error: "OpenDental could not read that procedure.",
      detail: before.body,
    }, 502);
  }

  const beforeBody = (before.body ?? {}) as Record<string, unknown>;

  // The patient is checked rather than assumed. An od_id from a stale
  // screen could otherwise remove someone else's treatment.
  if (Number(beforeBody.PatNum ?? 0) !== patNum) {
    return json({
      ok: false,
      error: "That procedure belongs to a different patient.",
    }, 403);
  }

  // Only planned work can be taken off a plan. A completed procedure is
  // a clinical record, and OpenDental refuses to delete some statuses
  // anyway.
  const status = String(beforeBody.ProcStatus ?? "");
  if (status !== "TP") {
    return json({
      ok: false,
      error:
        `That procedure is ${status}, not treatment planned, so it cannot ` +
        `be removed from here. Change it in OpenDental.`,
    }, 400);
  }

  const deleted = await odFetch(auth, "DELETE", `/procedurelogs/${odId}`);

  if (deleted.http_status < 200 || deleted.http_status >= 300) {
    return json({
      ok: false,
      error: "OpenDental would not remove that procedure.",
      detail: deleted.body,
    }, 502);
  }

  // Proof, not optimism.
  const check = await shortQueryAll(
    auth,
    `SELECT ProcStatus FROM procedurelog WHERE ProcNum = ${odId}`,
  );

  const stillPlanned = check.rows.length > 0 &&
    Number(check.rows[0].ProcStatus ?? 0) === PROC_STATUS_TP;

  const softDeleted = check.rows.length > 0 &&
    Number(check.rows[0].ProcStatus ?? 0) === PROC_STATUS_DELETED;

  return json({
    ok: !stillPlanned,
    od_id: odId,
    proc_code: String(beforeBody.procCode ?? ""),
    tooth_num: String(beforeBody.ToothNum ?? ""),
    // Gone from the plan, still on the record. Worth saying plainly:
    // the office can find it again in OpenDental if it was a mistake.
    soft_deleted: softDeleted,
    row_removed: check.rows.length === 0,
    error: stillPlanned
      ? "OpenDental accepted the removal and left the procedure planned."
      : undefined,
    removed_by: userData.user.email,
    removed_at: new Date().toISOString(),
  });
});
