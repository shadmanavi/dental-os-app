// =====================================================================
// Dental OS - Edge Function: od-chart-probe
//
// Purpose: answer questions about OpenDental's live behaviour before the
// chairside charting tool commits to a design.
//
// This function is a probe, not a product feature. Delete it once the
// answers are recorded in the handoff.
//
// Deploy path: supabase/functions/od-chart-probe/index.ts
// Version: 9
// Changelog:
//   v1  Context read (patient + providers), dry-run preview, live create
//       with ProcFee omitted, read-back, and delete.
//   v2  POST /procedurelogs rejected CodeNum with "procCode is required."
//       CodeNum is a GET filter parameter only; the create endpoint wants
//       the CDT string. Body now takes proc_code and sends procCode.
//   v3  Answered v2's question: OpenDental returned ProcFee 210.00 and
//       ProvNum 2118 for a payload that omitted both. Dental OS therefore
//       never prices a procedure and never needs a fee schedule selector.
//       Two additions here:
//         - "appointment" action, resolving today's treating provider from
//           the patient's appointment rather than from the schedule.
//         - GET /providers now pages. v1 returned 88 rows and the patient's
//           own primary provider (2118) was not among them, because the
//           endpoint caps a page at 100 and there are more than that.
//   v4  v3's paging double-counted. Offset did not advance cleanly, so
//       pages overlapped and ProvNums 2118, 2123 and 2145 each appeared
//       twice; the 552 total was inflated. Now deduplicated on ProvNum,
//       and the walk stops as soon as a page contributes nothing new
//       rather than trusting the page length. Also splits the visible list
//       into dentists and hygienists, since an "HG - " provider is a
//       hygienist and OpenDental carries those on appointment.ProvHyg
//       rather than appointment.ProvNum.
//   v5  Adds a read-only "toothinitials" action. A missing tooth is not a
//       procedure in OpenDental — it lives in the toothinitial table
//       alongside hidden and primary/permanent flags. Missing and Hidden
//       are independent flags; one tooth was observed carrying both.
//   v6  POST /procedurelogs refused ProcStatus 'EC' with: "ProcStatus may
//       only be set to Treatment Planned (TP), Complete (C), or Existing
//       Other Provider (EO)." The published docs list EC as valid, so they
//       describe either PUT or a newer build than this office runs.
//
//       EC is the clinically correct status for work Greenwood did itself
//       before OpenDental, so EO is not an acceptable substitute — it
//       asserts another provider did the work. This action tests whether
//       the status can be reached in two steps: POST at EO, then PUT to
//       EC, then GET to see which status actually stuck.
//
//       Action: "status_test". Always writes, then always deletes what it
//       wrote, whatever the outcome.
//   v7  Adds a read-only "schedule" action, for the Today tab on the
//       charting screen's patient picker. It answers four questions that
//       must be settled before that tab can be built:
//
//         1. Does GET /appointments accept a bare ?date= with no PatNum,
//            and does it return the whole day? Every prior call to this
//            endpoint carried PatNum, so the unfiltered form is untested.
//         2. Does each row carry PatNum plus enough patient identity to
//            render a card without a second call per appointment?
//         3. What AptStatus values actually appear on a real day? The
//            docs and the live build have already disagreed once, on
//            ProcStatus. Broken and cancelled rows must be greyed, not
//            openable, so the exact strings matter.
//         4. ClinicNum is 0 everywhere, so the day cannot be split by
//            office through the API. Operatory is the only lever left.
//            This reads GET /operatories to see whether an operatory
//            names or otherwise identifies its office. That endpoint has
//            not been called before — if it 404s, the response says so
//            plainly rather than hiding it.
//
//       Writes nothing. Reads a whole day of appointments, which is PHI,
//       and returns it to the caller only.
//   v8  v7 answered its four questions. Three came back clean: the bare
//       ?date= form works, every row carries PatNum, and the operatories
//       endpoint exists. The fourth was worse than expected — no row
//       carried any patient name at all. LName, FName and patientName
//       were null on all 32 rows, so rendering the Today tab needs a
//       second call per appointment. Thirty-two sequential calls is too
//       slow to open a screen on.
//
//       Adds a read-only "patients_bulk" action that races three ways of
//       getting those names, on the same real PatNum set, and reports
//       wall time for each:
//
//         A. One GET /patients/{PatNum}. The per-call baseline.
//         B. All of them at once, in parallel. If this is fast enough
//            there is no bulk problem to solve, only a concurrency one.
//         C. PUT /queries/ShortQuery with a read-only SELECT over the
//            patient table for exactly those PatNums. One call for the
//            whole day. The endpoint refuses anything that is not
//            read-only with a 401, so this cannot mutate the database.
//
//       Whichever wins decides how the production schedule action loads
//       names. Writes nothing.
//   v9  v8's answer was decisive and slightly alarming. The 31 parallel
//       calls did not run in parallel: the slowest single call took
//       6659ms against a 6661ms total, so OpenDental served them one
//       after another. Concurrency is not a lever on this API. One
//       ShortQuery returned all 31 rows in 214ms — thirty-one times
//       faster than the REST loop, with LName, FName and Preferred all
//       populated.
//
//       That raises the obvious follow-up: if one query can fetch the
//       names, can one query fetch the entire Today tab? This action
//       joins appointment to patient and operatory in a single statement
//       and compares it against the REST endpoint on three axes:
//
//         1. Row parity. Does the join return the same appointment count
//            the REST call does? A mismatch means the WHERE clause on
//            AptDateTime is not equivalent to REST's ?date=.
//         2. AptStatus. REST returned the words "Scheduled" and
//            "Broken". The underlying column is an integer enum, so raw
//            SQL will return numbers, and the mapping between them has
//            to be read off real data rather than assumed.
//         3. Paging. ShortQuery caps a page at 100 rows. A 32-row
//            Downey day is safe; a heavier day is not. This runs a
//            COUNT, then requests a second page by Offset, to confirm
//            the cap and that Offset actually advances.
//
//       Writes nothing. The statement is a SELECT, and the endpoint
//       rejects anything that is not read-only with a 401.
//
// Required secrets (already set for the other od-* functions):
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
//
// Call:
//   POST /functions/v1/od-chart-probe
//   Authorization: Bearer <user access token>
//
//   Body — read context only:
//     { "office": "downey", "pat_num": 17, "action": "context" }
//
//   Body — a whole day's schedule, no PatNum filter:
//     { "office": "downey", "action": "schedule" }
//     Optional: "date": "2026-08-13" (defaults to today)
//     Optional: "full_rows": true  (returns the raw rows too)
//
//   Body — three ways to fetch today's patient names, timed:
//     { "office": "downey", "action": "patients_bulk" }
//     Optional: "date": "2026-08-13" (defaults to today)
//
//   Body — the whole Today tab in one SQL call, vs the REST endpoint:
//     { "office": "downey", "action": "schedule_join" }
//     Optional: "date": "2026-08-13" (defaults to today)
//
//   Body — preview the create without sending it:
//     { "office": "downey", "pat_num": 17, "proc_code": "D2391",
//       "tooth_num": "30", "surf": "O", "action": "create",
//       "dry_run": true }
//
//   Body — actually create it:
//     ...same with "dry_run": false
//
//   Body — can a procedure reach ProcStatus EC in two steps?
//     { "office":"downey", "pat_num":17, "action":"status_test",
//       "proc_code":"D2750", "tooth_num":"31" }
//
//   Body — how missing, hidden and primary teeth are stored:
//     { "office": "downey", "pat_num": 17, "action": "toothinitials" }
//
//   Body — today's appointment, to resolve the treating provider:
//     { "office": "downey", "pat_num": 17, "action": "appointment" }
//     Optional: "date": "2026-08-13" (defaults to today)
//
//   Body — remove the test procedure afterwards:
//     { "office": "downey", "action": "delete", "proc_num": 12345 }
//
// PHI note: patient fields pass through this function in the response so
// the caller can see what OpenDental applied. Nothing is written to the
// Dental OS database.
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type OdCall = {
  method: string;
  url: string;
  http_status: number;
  elapsed_ms: number;
  body: unknown;
};

// One place for every OpenDental call, so the response can show the whole
// exchange rather than a summary of it.
async function odFetch(
  auth: string,
  method: string,
  path: string,
  payload?: unknown,
): Promise<OdCall> {
  const url = `${OD_BASE_URL}${path}`;
  const startedAt = Date.now();

  const init: RequestInit = {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };

  if (payload !== undefined) {
    init.body = JSON.stringify(payload);
  }

  const response = await fetch(url, init);
  const elapsed = Date.now() - startedAt;
  const text = await response.text();

  let parsed: unknown = text;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = text.slice(0, 500);
  }

  return {
    method,
    url,
    http_status: response.status,
    elapsed_ms: elapsed,
    body: parsed,
  };
}

// GET /providers caps a page at 100 rows. v1 read one page, which is why
// the patient's own primary provider was missing from the result. Walk the
// pages, keyed on ProvNum, and stop when a page contributes nothing new —
// the pages were observed to overlap, so page length is not a stop signal.
async function fetchAllProviders(
  auth: string,
  calls: OdCall[],
): Promise<{ providers: Record<string, unknown>[]; pages: number; duplicates: number }> {
  const byProvNum = new Map<number, Record<string, unknown>>();
  const PAGE = 100;
  const MAX_PAGES = 20;

  let pages = 0;
  let duplicates = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE;
    const call = await odFetch(
      auth,
      "GET",
      offset === 0 ? "/providers" : `/providers?Offset=${offset}`,
    );
    calls.push(call);
    pages++;

    if (!Array.isArray(call.body)) break;

    const rows = call.body as Record<string, unknown>[];
    if (rows.length === 0) break;

    let added = 0;
    for (const row of rows) {
      const provNum = typeof row.ProvNum === "number" ? row.ProvNum : null;
      if (provNum === null) continue;

      if (byProvNum.has(provNum)) {
        duplicates++;
        continue;
      }

      byProvNum.set(provNum, row);
      added++;
    }

    if (added === 0) break;
  }

  return {
    providers: [...byProvNum.values()],
    pages,
    duplicates,
  };
}

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
    dry_run?: boolean;
    pat_num?: number;
    proc_code?: string;
    tooth_num?: string;
    surf?: string;
    proc_num?: number;
    date?: string;
    full_rows?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const action = (body.action ?? "context").toLowerCase().trim();
  const dryRun = body.dry_run !== false;

  if (officeId === "" && officeSlug === "") {
    return json({
      ok: false,
      error: "Provide office_id (uuid) or office (slug).",
    }, 400);
  }

  const ACTIONS = [
    "context",
    "create",
    "delete",
    "appointment",
    "schedule",
    "patients_bulk",
    "schedule_join",
    "toothinitials",
    "status_test",
  ];
  if (!ACTIONS.includes(action)) {
    return json({
      ok: false,
      error: `action must be one of: ${ACTIONS.join(", ")}.`,
    }, 400);
  }

  const officeQuery = supabase
    .from("offices")
    .select("id, slug, name, opendental_customer_key_name, is_active");

  const { data: officeRow, error: officeError } = officeId !== ""
    ? await officeQuery.eq("id", officeId).maybeSingle()
    : await officeQuery.eq("slug", officeSlug).maybeSingle();

  if (officeError) {
    return json({
      ok: false,
      error: `Office lookup failed: ${officeError.message}`,
    }, 500);
  }

  if (!officeRow) {
    return json({
      ok: false,
      error: "That office was not found, or you do not have a role there.",
    }, 403);
  }

  const secretName = officeRow.opendental_customer_key_name ?? "";
  if (!ALLOWED_SECRET_NAMES.has(secretName)) {
    return json({
      ok: false,
      office: officeRow.name,
      error: "This office has no recognized OpenDental key configured.",
    }, 500);
  }

  const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
  const customerKey = Deno.env.get(secretName);

  const missing: string[] = [];
  if (!developerKey) missing.push("OD_DEVELOPER_KEY");
  if (!customerKey) missing.push(secretName);
  if (missing.length > 0) {
    return json({
      ok: false,
      error: "Missing Edge Function secrets.",
      missing,
    }, 500);
  }

  const auth = `ODFHIR ${developerKey}/${customerKey}`;
  const calls: OdCall[] = [];

  // -------------------------------------------------------------------
  // SCHEDULE — a whole day, unfiltered by patient
  //
  // Read-only. Placed before the pat_num guard because the whole point is
  // that it does not take one.
  // -------------------------------------------------------------------
  if (action === "schedule") {
    const day = (body.date ?? "").trim() !== ""
      ? (body.date ?? "").trim()
      : new Date().toISOString().slice(0, 10);

    const appts = await odFetch(auth, "GET", `/appointments?date=${day}`);
    calls.push(appts);

    const accepted = appts.http_status >= 200 && appts.http_status < 300;
    const rows = Array.isArray(appts.body)
      ? (appts.body as Record<string, unknown>[])
      : [];

    // Question 4: is there anything on an operatory that identifies its
    // office? This endpoint has not been called before. A 404 is a valid
    // answer and is reported as one.
    const ops = await odFetch(auth, "GET", "/operatories");
    calls.push(ops);

    const opRows = Array.isArray(ops.body)
      ? (ops.body as Record<string, unknown>[])
      : [];

    const operatories = opRows.map((o) => ({
      OperatoryNum: o.OperatoryNum ?? null,
      OpName: o.OpName ?? "",
      Abbrev: o.Abbrev ?? "",
      ClinicNum: o.ClinicNum ?? null,
      ProvDentist: o.ProvDentist ?? null,
      ProvHygienist: o.ProvHygienist ?? null,
      IsHidden: String(o.IsHidden ?? "false") === "true",
    }));

    // What does a card actually need, and does one row carry it?
    const CARD_FIELDS = [
      "AptNum",
      "PatNum",
      "AptDateTime",
      "AptStatus",
      "Pattern",
      "Op",
      "ProvNum",
      "provAbbr",
      "ProvHyg",
      "IsHygiene",
      "ProcDescript",
      "LName",
      "FName",
      "Preferred",
      "patientName",
      "Note",
      "Confirmed",
      "confirmed",
    ];

    const firstRowFields = rows.length > 0 ? Object.keys(rows[0]) : [];
    const fieldPresence: Record<string, boolean> = {};
    for (const field of CARD_FIELDS) {
      fieldPresence[field] = firstRowFields.includes(field);
    }

    // Question 3: the real AptStatus vocabulary for this build.
    const statusCounts: Record<string, number> = {};
    const opCounts: Record<string, number> = {};
    let rowsWithPatNum = 0;
    let rowsWithAnyName = 0;

    for (const row of rows) {
      const status = String(row.AptStatus ?? "(missing)");
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;

      const op = String(row.Op ?? "(missing)");
      opCounts[op] = (opCounts[op] ?? 0) + 1;

      if (typeof row.PatNum === "number" && row.PatNum > 0) rowsWithPatNum++;

      const hasName = String(row.LName ?? "") !== "" ||
        String(row.FName ?? "") !== "" ||
        String(row.patientName ?? "") !== "";
      if (hasName) rowsWithAnyName++;
    }

    // A small shaped sample, so the answer is readable without wading
    // through a whole day of raw rows.
    const sample = rows.slice(0, 5).map((a) => ({
      AptNum: a.AptNum ?? null,
      PatNum: a.PatNum ?? null,
      AptDateTime: a.AptDateTime ?? "",
      AptStatus: a.AptStatus ?? "",
      Pattern: a.Pattern ?? "",
      Op: a.Op ?? null,
      ProvNum: a.ProvNum ?? null,
      provAbbr: a.provAbbr ?? "",
      ProvHyg: a.ProvHyg ?? null,
      IsHygiene: String(a.IsHygiene ?? "false") === "true",
      ProcDescript: a.ProcDescript ?? "",
      LName: a.LName ?? null,
      FName: a.FName ?? null,
      patientName: a.patientName ?? null,
    }));

    return json({
      ok: accepted,
      office: officeRow.name,
      action: "schedule",
      date: day,

      answers: {
        bare_date_accepted: accepted,
        bare_date_http_status: appts.http_status,
        bare_date_message: accepted ? undefined : appts.body,
        row_count: rows.length,
        rows_carrying_PatNum: rowsWithPatNum,
        rows_carrying_a_patient_name: rowsWithAnyName,
        second_call_per_row_needed: rowsWithAnyName < rows.length,
        apt_status_values: statusCounts,
        appointments_per_operatory: opCounts,
        operatories_endpoint_status: ops.http_status,
        operatories_endpoint_exists: ops.http_status >= 200 &&
          ops.http_status < 300,
        operatory_count: operatories.length,
      },

      fields_on_first_row: firstRowFields,
      card_field_presence: fieldPresence,
      operatories,
      sample,
      rows: body.full_rows === true ? rows : undefined,

      calls: body.full_rows === true ? calls : calls.map((c) => ({
        method: c.method,
        url: c.url,
        http_status: c.http_status,
        elapsed_ms: c.elapsed_ms,
        body: c.http_status >= 300 ? c.body : "(omitted — succeeded)",
      })),

      run_by: userData.user.email,
      run_at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------
  // PATIENTS_BULK — how fast can today's patient names be fetched?
  //
  // Read-only. Takes no pat_num: it derives the PatNum set from the day's
  // appointments, so the test runs against a realistic load rather than a
  // made-up list.
  // -------------------------------------------------------------------
  if (action === "patients_bulk") {
    const day = (body.date ?? "").trim() !== ""
      ? (body.date ?? "").trim()
      : new Date().toISOString().slice(0, 10);

    const appts = await odFetch(auth, "GET", `/appointments?date=${day}`);
    calls.push(appts);

    const apptRows = Array.isArray(appts.body)
      ? (appts.body as Record<string, unknown>[])
      : [];

    // Numbers only. These go into a SQL IN clause below, so anything that
    // is not a positive integer is dropped rather than escaped.
    const patNums: number[] = [];
    for (const row of apptRows) {
      const raw = row.PatNum;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isInteger(n) && n > 0 && !patNums.includes(n)) {
        patNums.push(n);
      }
    }

    if (patNums.length === 0) {
      return json({
        ok: false,
        office: officeRow.name,
        action,
        date: day,
        error: "No PatNums on that day, so there is nothing to time.",
        appointment_row_count: apptRows.length,
        run_by: userData.user.email,
        run_at: new Date().toISOString(),
      });
    }

    const nameFields = ["LName", "FName", "Preferred", "MiddleI"];

    function nameFieldsPresent(
      row: Record<string, unknown> | null,
    ): Record<string, boolean> {
      const out: Record<string, boolean> = {};
      for (const f of nameFields) {
        out[f] = row !== null && row[f] !== undefined && row[f] !== null;
      }
      return out;
    }

    // ---- A. one patient, one call. The per-call baseline. ----
    const singleStart = Date.now();
    const single = await odFetch(auth, "GET", `/patients/${patNums[0]}`);
    const singleElapsed = Date.now() - singleStart;
    calls.push(single);

    const singleRow =
      single.body !== null && typeof single.body === "object" &&
        !Array.isArray(single.body)
        ? (single.body as Record<string, unknown>)
        : null;

    // ---- B. every patient at once. ----
    // If this lands inside a second there is no bulk problem to solve.
    const parallelStart = Date.now();
    const parallelResults = await Promise.all(
      patNums.map((pn) => odFetch(auth, "GET", `/patients/${pn}`)),
    );
    const parallelElapsed = Date.now() - parallelStart;

    const parallelOk = parallelResults.filter(
      (r) => r.http_status >= 200 && r.http_status < 300,
    ).length;
    const parallelFailStatuses = Array.from(
      new Set(
        parallelResults
          .filter((r) => r.http_status < 200 || r.http_status >= 300)
          .map((r) => r.http_status),
      ),
    );
    const slowestParallel = parallelResults.reduce(
      (worst, r) => (r.elapsed_ms > worst ? r.elapsed_ms : worst),
      0,
    );

    // ---- C. one read-only SQL call for the whole day. ----
    // The endpoint returns 401 for anything that is not read-only, so a
    // SELECT is the only thing this can do.
    const sql =
      `SELECT PatNum, LName, FName, Preferred FROM patient WHERE PatNum IN (${
        patNums.join(",")
      })`;

    const queryStart = Date.now();
    const query = await odFetch(auth, "PUT", "/queries/ShortQuery", {
      SqlCommand: sql,
    });
    const queryElapsed = Date.now() - queryStart;
    calls.push(query);

    const queryRows = Array.isArray(query.body)
      ? (query.body as Record<string, unknown>[])
      : [];
    const querySupported = query.http_status >= 200 && query.http_status < 300;

    // Names are PHI. Return three rows so the shape is visible, not all of
    // them — the timings are the point of this run, not the roster.
    const sampleFrom = (rows: Record<string, unknown>[]) =>
      rows.slice(0, 3).map((r) => ({
        PatNum: r.PatNum ?? null,
        LName: r.LName ?? null,
        FName: r.FName ?? null,
        Preferred: r.Preferred ?? null,
      }));

    const winner = (() => {
      const options: { name: string; ms: number }[] = [
        { name: "parallel_singles", ms: parallelElapsed },
      ];
      if (querySupported) {
        options.push({ name: "short_query", ms: queryElapsed });
      }
      options.sort((a, b) => a.ms - b.ms);
      return options[0].name;
    })();

    return json({
      ok: true,
      office: officeRow.name,
      action,
      date: day,

      answers: {
        appointment_row_count: apptRows.length,
        distinct_pat_nums: patNums.length,

        // A
        single_call_ms: singleElapsed,
        single_call_http_status: single.http_status,
        single_call_name_fields: nameFieldsPresent(singleRow),

        // B
        parallel_total_ms: parallelElapsed,
        parallel_calls_made: parallelResults.length,
        parallel_calls_ok: parallelOk,
        parallel_fail_statuses: parallelFailStatuses,
        parallel_slowest_single_ms: slowestParallel,
        parallel_throttling_suspected: parallelFailStatuses.includes(429) ||
          parallelElapsed > slowestParallel * 4,

        // C
        short_query_supported: querySupported,
        short_query_http_status: query.http_status,
        short_query_ms: queryElapsed,
        short_query_row_count: queryRows.length,
        short_query_covers_every_patient: queryRows.length === patNums.length,
        short_query_error: querySupported ? null : query.body,

        fastest_option: winner,
      },

      short_query_sql: sql,
      single_sample: sampleFrom(singleRow === null ? [] : [singleRow]),
      short_query_sample: sampleFrom(queryRows),

      calls: calls.map((c) => ({
        method: c.method,
        url: c.url,
        http_status: c.http_status,
        elapsed_ms: c.elapsed_ms,
        body: c.http_status >= 300 ? c.body : "(omitted — succeeded)",
      })),

      run_by: userData.user.email,
      run_at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------
  // SCHEDULE_JOIN — can one SQL statement render the whole Today tab?
  //
  // Read-only. Compares a single joined query against the REST endpoint
  // it would replace, and probes the 100-row page cap.
  // -------------------------------------------------------------------
  if (action === "schedule_join") {
    const day = (body.date ?? "").trim() !== ""
      ? (body.date ?? "").trim()
      : new Date().toISOString().slice(0, 10);

    // A day is a half-open range on AptDateTime. Computing the next day
    // in JS avoids relying on any particular SQL dialect's date maths.
    const dayStart = `${day} 00:00:00`;
    const nextDate = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(nextDate.getTime())) {
      return json({
        ok: false,
        error: "date must be YYYY-MM-DD.",
      }, 400);
    }
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const dayEnd = `${nextDate.toISOString().slice(0, 10)} 00:00:00`;

    // ---- Baseline: the REST call this would replace. ----
    const restStart = Date.now();
    const rest = await odFetch(auth, "GET", `/appointments?date=${day}`);
    const restElapsed = Date.now() - restStart;
    calls.push(rest);

    const restRows = Array.isArray(rest.body)
      ? (rest.body as Record<string, unknown>[])
      : [];

    // REST reports AptStatus as words. Keep them, so the integers the
    // raw column returns can be lined up against something real.
    const restStatusCounts: Record<string, number> = {};
    for (const row of restRows) {
      const s = String(row.AptStatus ?? "(missing)");
      restStatusCounts[s] = (restStatusCounts[s] ?? 0) + 1;
    }

    // A per-AptNum status map, so the integer→word mapping can be read
    // off matched rows rather than inferred from counts.
    const restStatusByApt = new Map<number, string>();
    for (const row of restRows) {
      const n = typeof row.AptNum === "number" ? row.AptNum : Number(row.AptNum);
      if (Number.isInteger(n)) {
        restStatusByApt.set(n, String(row.AptStatus ?? ""));
      }
    }

    // ---- How many rows are there really? ----
    // Answers whether the 100-row page cap is even in play for this day.
    const countSql =
      `SELECT COUNT(*) AS RowCount FROM appointment WHERE AptDateTime >= '${dayStart}' AND AptDateTime < '${dayEnd}'`;

    const countCall = await odFetch(auth, "PUT", "/queries/ShortQuery", {
      SqlCommand: countSql,
    });
    calls.push(countCall);

    const countRows = Array.isArray(countCall.body)
      ? (countCall.body as Record<string, unknown>[])
      : [];
    const trueRowCount = countRows.length > 0
      ? Number(countRows[0].RowCount ?? countRows[0].rowcount ?? NaN)
      : NaN;

    // ---- The candidate: one statement for the entire tab. ----
    // LEFT JOIN on both sides so a bad PatNum or a deleted operatory
    // drops a field, never a whole appointment. Row parity with REST is
    // one of the things being measured, so nothing may silently vanish.
    const joinSelect =
      `SELECT a.AptNum, a.PatNum, a.AptDateTime, a.AptStatus, a.Pattern, a.Op, ` +
      `a.ProvNum, a.ProvHyg, a.IsHygiene, a.ProcDescript, a.Confirmed, ` +
      `a.DateTimeArrived, a.DateTimeSeated, a.DateTimeDismissed, ` +
      `p.LName, p.FName, p.Preferred, o.OpName, o.Abbrev, o.IsHidden ` +
      `FROM appointment a ` +
      `LEFT JOIN patient p ON p.PatNum = a.PatNum ` +
      `LEFT JOIN operatory o ON o.OperatoryNum = a.Op ` +
      `WHERE a.AptDateTime >= '${dayStart}' AND a.AptDateTime < '${dayEnd}' ` +
      `ORDER BY a.AptDateTime, a.Op`;

    const joinStart = Date.now();
    const join = await odFetch(auth, "PUT", "/queries/ShortQuery", {
      SqlCommand: joinSelect,
    });
    const joinElapsed = Date.now() - joinStart;
    calls.push(join);

    const joinOk = join.http_status >= 200 && join.http_status < 300;
    const joinRows = Array.isArray(join.body)
      ? (join.body as Record<string, unknown>[])
      : [];

    // ---- Does Offset actually advance? ----
    // Asked unconditionally. On a 32-row day page two should come back
    // empty, which is itself proof the parameter is understood rather
    // than ignored — an ignored Offset would return page one again.
    const pageTwo = await odFetch(
      auth,
      "PUT",
      "/queries/ShortQuery?Offset=100",
      { SqlCommand: joinSelect },
    );
    calls.push(pageTwo);

    const pageTwoRows = Array.isArray(pageTwo.body)
      ? (pageTwo.body as Record<string, unknown>[])
      : [];

    const firstAptOnPageOne = joinRows.length > 0
      ? String(joinRows[0].AptNum ?? "")
      : "";
    const firstAptOnPageTwo = pageTwoRows.length > 0
      ? String(pageTwoRows[0].AptNum ?? "")
      : "";

    // ---- The AptStatus integer→word mapping, read off matched rows. ----
    const statusMapping: Record<string, Record<string, number>> = {};
    const joinStatusCounts: Record<string, number> = {};
    let rowsWithName = 0;
    let rowsWithOpName = 0;

    for (const row of joinRows) {
      const raw = String(row.AptStatus ?? "(missing)");
      joinStatusCounts[raw] = (joinStatusCounts[raw] ?? 0) + 1;

      const aptNum = typeof row.AptNum === "number"
        ? row.AptNum
        : Number(row.AptNum);
      const word = restStatusByApt.get(aptNum);
      if (word !== undefined) {
        if (!statusMapping[raw]) statusMapping[raw] = {};
        statusMapping[raw][word] = (statusMapping[raw][word] ?? 0) + 1;
      }

      if (String(row.LName ?? "") !== "" || String(row.FName ?? "") !== "") {
        rowsWithName++;
      }
      if (String(row.OpName ?? "") !== "") rowsWithOpName++;
    }

    // Names are PHI. Three rows show the shape; the timings are the point.
    const sample = joinRows.slice(0, 3).map((r) => ({
      AptNum: r.AptNum ?? null,
      PatNum: r.PatNum ?? null,
      AptDateTime: r.AptDateTime ?? null,
      AptStatus: r.AptStatus ?? null,
      Pattern: r.Pattern ?? null,
      Op: r.Op ?? null,
      OpName: r.OpName ?? null,
      Abbrev: r.Abbrev ?? null,
      ProvNum: r.ProvNum ?? null,
      ProvHyg: r.ProvHyg ?? null,
      IsHygiene: r.IsHygiene ?? null,
      ProcDescript: r.ProcDescript ?? null,
      Confirmed: r.Confirmed ?? null,
      DateTimeArrived: r.DateTimeArrived ?? null,
      DateTimeSeated: r.DateTimeSeated ?? null,
      DateTimeDismissed: r.DateTimeDismissed ?? null,
      LName: r.LName ?? null,
      FName: r.FName ?? null,
      Preferred: r.Preferred ?? null,
    }));

    return json({
      ok: joinOk,
      office: officeRow.name,
      action,
      date: day,

      answers: {
        join_supported: joinOk,
        join_http_status: join.http_status,
        join_error: joinOk ? null : join.body,

        // 1. Row parity
        rest_row_count: restRows.length,
        join_row_count: joinRows.length,
        count_query_says: Number.isNaN(trueRowCount) ? null : trueRowCount,
        row_parity: restRows.length === joinRows.length,

        // Timing
        rest_ms: restElapsed,
        join_ms: joinElapsed,
        rest_calls_for_full_tab: 1 + restRows.length,
        join_calls_for_full_tab: 1,

        // Field coverage — does one row carry everything a card needs?
        fields_on_first_join_row: joinRows.length > 0
          ? Object.keys(joinRows[0])
          : [],
        join_rows_carrying_a_name: rowsWithName,
        join_rows_carrying_an_operatory_name: rowsWithOpName,

        // 2. AptStatus vocabulary
        rest_apt_status_values: restStatusCounts,
        sql_apt_status_values: joinStatusCounts,
        sql_to_rest_status_mapping: statusMapping,

        // 3. Paging
        page_cap_in_play: !Number.isNaN(trueRowCount) && trueRowCount > 100,
        page_two_http_status: pageTwo.http_status,
        page_two_row_count: pageTwoRows.length,
        offset_appears_honoured: pageTwoRows.length === 0 ||
          firstAptOnPageTwo !== firstAptOnPageOne,
      },

      join_sql: joinSelect,
      count_sql: countSql,
      sample,

      calls: calls.map((c) => ({
        method: c.method,
        url: c.url,
        http_status: c.http_status,
        elapsed_ms: c.elapsed_ms,
        body: c.http_status >= 300 ? c.body : "(omitted — succeeded)",
      })),

      run_by: userData.user.email,
      run_at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------
  // DELETE — remove a test procedure created by an earlier run
  // -------------------------------------------------------------------
  if (action === "delete") {
    const procNum = body.proc_num;
    if (typeof procNum !== "number" || procNum <= 0) {
      return json({
        ok: false,
        error: "delete needs proc_num (the ProcNum returned by create).",
      }, 400);
    }

    if (dryRun) {
      return json({
        ok: true,
        office: officeRow.name,
        action: "delete",
        dry_run: true,
        would_call: `DELETE ${OD_BASE_URL}/procedurelogs/${procNum}`,
        note: "Nothing was sent. Send dry_run: false to actually delete.",
      });
    }

    const del = await odFetch(auth, "DELETE", `/procedurelogs/${procNum}`);
    calls.push(del);

    return json({
      ok: del.http_status >= 200 && del.http_status < 300,
      office: officeRow.name,
      action: "delete",
      dry_run: false,
      proc_num: procNum,
      calls,
      run_by: userData.user.email,
      run_at: new Date().toISOString(),
    });
  }

  const patNum = body.pat_num;
  if (typeof patNum !== "number" || patNum <= 0) {
    return json({ ok: false, error: "pat_num is required." }, 400);
  }

  // -------------------------------------------------------------------
  // Tooth initials — missing, hidden, primary
  // -------------------------------------------------------------------
  if (action === "toothinitials") {
    const initials = await odFetch(
      auth,
      "GET",
      `/toothinitials?PatNum=${patNum}`,
    );
    calls.push(initials);

    const rows = Array.isArray(initials.body)
      ? (initials.body as Record<string, unknown>[])
      : [];

    const byType: Record<string, unknown[]> = {};
    for (const row of rows) {
      const type = String(row.InitialType ?? "(no InitialType field)");
      if (!byType[type]) byType[type] = [];
      byType[type].push(row.ToothNum ?? null);
    }

    return json({
      ok: initials.http_status >= 200 && initials.http_status < 300,
      office: officeRow.name,
      action: "toothinitials",
      pat_num: patNum,
      row_count: rows.length,
      fields_on_first_row: rows.length > 0 ? Object.keys(rows[0]) : [],
      teeth_by_type: byType,
      rows,
      calls,
      run_by: userData.user.email,
      run_at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------
  // Status test — can a procedure reach EC?
  //
  // Writes. Cleans up after itself in every branch, including failure.
  // -------------------------------------------------------------------
  if (action === "status_test") {
    const code = (body.proc_code ?? "D2750").trim().toUpperCase();
    const tooth = (body.tooth_num ?? "").trim();
    const today = new Date().toISOString().slice(0, 10);

    const results: Record<string, unknown> = {};
    let procNum: number | null = null;

    // Step 1 — does POST accept EC directly? Confirms the earlier failure
    // rather than taking it on faith.
    const postEc = await odFetch(auth, "POST", "/procedurelogs", {
      PatNum: patNum,
      procCode: code,
      ProcStatus: "EC",
      ProcDate: today,
      ...(tooth !== "" ? { ToothNum: tooth } : {}),
    });
    calls.push(postEc);

    results.post_ec = {
      http_status: postEc.http_status,
      accepted: postEc.http_status >= 200 && postEc.http_status < 300,
      message: postEc.body,
    };

    const ecBody = postEc.body as Record<string, unknown> | null;
    if (typeof ecBody?.ProcNum === "number") procNum = ecBody.ProcNum;

    // Step 2 — POST at EO, which the error message says is allowed.
    if (procNum === null) {
      const postEo = await odFetch(auth, "POST", "/procedurelogs", {
        PatNum: patNum,
        procCode: code,
        ProcStatus: "EO",
        ProcDate: today,
        ...(tooth !== "" ? { ToothNum: tooth } : {}),
      });
      calls.push(postEo);

      const eoBody = postEo.body as Record<string, unknown> | null;
      if (typeof eoBody?.ProcNum === "number") procNum = eoBody.ProcNum;

      results.post_eo = {
        http_status: postEo.http_status,
        accepted: postEo.http_status >= 200 && postEo.http_status < 300,
        status_stored: eoBody?.ProcStatus ?? null,
        fee: eoBody?.ProcFee ?? null,
        message: postEo.http_status >= 300 ? postEo.body : undefined,
      };
    }

    // Step 3 — PUT it to EC.
    if (procNum !== null) {
      const put = await odFetch(auth, "PUT", `/procedurelogs/${procNum}`, {
        ProcStatus: "EC",
      });
      calls.push(put);

      results.put_ec = {
        http_status: put.http_status,
        accepted: put.http_status >= 200 && put.http_status < 300,
        message: put.http_status >= 300 ? put.body : undefined,
      };

      // Step 4 — read it back. The PUT response is not proof; the stored
      // row is.
      const readBack = await odFetch(auth, "GET", `/procedurelogs/${procNum}`);
      calls.push(readBack);

      const rb = readBack.body as Record<string, unknown> | null;
      results.read_back = {
        ProcStatus: rb?.ProcStatus ?? null,
        ProcFee: rb?.ProcFee ?? null,
        ToothNum: rb?.ToothNum ?? null,
        procCode: rb?.procCode ?? null,
      };

      results.verdict = String(rb?.ProcStatus ?? "") === "EC"
        ? "EC is reachable: POST at EO, then PUT to EC."
        : `EC not reached. Row sits at ${rb?.ProcStatus ?? "unknown"}.`;
    } else {
      results.verdict = "Nothing was created; neither EC nor EO was accepted.";
    }

    // Step 5 — always clean up.
    if (procNum !== null) {
      const del = await odFetch(auth, "DELETE", `/procedurelogs/${procNum}`);
      calls.push(del);
      results.cleanup = {
        proc_num: procNum,
        deleted: del.http_status >= 200 && del.http_status < 300,
        http_status: del.http_status,
      };
    }

    return json({
      ok: true,
      office: officeRow.name,
      action: "status_test",
      proc_code: code,
      tooth_num: tooth,
      ...results,
      run_by: userData.user.email,
      run_at: new Date().toISOString(),
    });
  }

  const patient = await odFetch(auth, "GET", `/patients/${patNum}`);
  calls.push(patient);

  const providerFetch = await fetchAllProviders(auth, calls);
  const allProviders = providerFetch.providers;

  const p = patient.body as Record<string, unknown> | null;
  const pricingContext = p && typeof p === "object"
    ? {
      PatNum: p.PatNum ?? null,
      FeeSched: p.FeeSched ?? null,
      PriProv: p.PriProv ?? null,
      priProvAbbr: p.priProvAbbr ?? null,
      ClinicNum: p.ClinicNum ?? null,
      HasIns: p.HasIns ?? null,
    }
    : null;

  function shapeProvider(prov: Record<string, unknown>) {
    return {
      ProvNum: prov.ProvNum ?? null,
      Abbr: prov.Abbr ?? "",
      LName: prov.LName ?? "",
      FName: prov.FName ?? "",
      Suffix: prov.Suffix ?? "",
      FeeSched: prov.FeeSched ?? null,
      ProvStatus: prov.ProvStatus ?? "",
      IsHidden: String(prov.IsHidden ?? "false") === "true",
    };
  }

  const providerList = allProviders
    .filter((prov) => String(prov.IsHidden ?? "false") !== "true")
    .map(shapeProvider)
    .sort((a, b) => String(a.Abbr).localeCompare(String(b.Abbr)));

  const looksHygienist = (abbr: string) =>
    abbr.toUpperCase().startsWith("HG") || abbr.toUpperCase().startsWith("HYG");

  const dentists = providerList.filter((prov) => !looksHygienist(String(prov.Abbr)));
  const hygienists = providerList.filter((prov) => looksHygienist(String(prov.Abbr)));

  const priProvRow = allProviders.find(
    (prov) => prov.ProvNum === (p?.PriProv ?? -1),
  );

  if (action === "context") {
    return json({
      ok: true,
      office: officeRow.name,
      action: "context",
      pricing_context: pricingContext,
      pages_read: providerFetch.pages,
      duplicate_rows_discarded: providerFetch.duplicates,
      unique_providers: allProviders.length,
      visible_provider_count: providerList.length,
      dentist_count: dentists.length,
      hygienist_count: hygienists.length,
      primary_provider_row: priProvRow ? shapeProvider(priProvRow) : null,
      dentists,
      hygienists,
      calls,
      run_by: userData.user.email,
      run_at: new Date().toISOString(),
    });
  }

  if (action === "appointment") {
    const day = (body.date ?? "").trim() !== ""
      ? (body.date ?? "").trim()
      : new Date().toISOString().slice(0, 10);

    const appts = await odFetch(
      auth,
      "GET",
      `/appointments?PatNum=${patNum}&date=${day}`,
    );
    calls.push(appts);

    const apptRows = Array.isArray(appts.body)
      ? (appts.body as Record<string, unknown>[])
      : [];

    const shaped = apptRows.map((a) => ({
      AptNum: a.AptNum ?? null,
      AptStatus: a.AptStatus ?? "",
      AptDateTime: a.AptDateTime ?? "",
      Op: a.Op ?? null,
      ProvNum: a.ProvNum ?? null,
      provAbbr: a.provAbbr ?? "",
      ProvHyg: a.ProvHyg ?? null,
      IsHygiene: String(a.IsHygiene ?? "false") === "true",
      ProcDescript: a.ProcDescript ?? "",
    }));

    const usable = shaped.filter(
      (a) => a.AptStatus === "Scheduled" || a.AptStatus === "Complete",
    );
    const chosen = usable.length > 0 ? usable[0] : null;

    return json({
      ok: true,
      office: officeRow.name,
      action: "appointment",
      date: day,
      appointment_count: shaped.length,
      appointments: shaped,
      resolved_provider: chosen !== null && chosen.ProvNum !== 0
        ? {
          source: "appointment",
          ProvNum: chosen.ProvNum,
          provAbbr: chosen.provAbbr,
        }
        : {
          source: "patient primary provider",
          ProvNum: pricingContext?.PriProv ?? null,
          provAbbr: pricingContext?.priProvAbbr ?? "",
        },
      pricing_context: pricingContext,
      calls,
      run_by: userData.user.email,
      run_at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------
  // Create — ProcFee and ProvNum deliberately omitted
  // -------------------------------------------------------------------
  const procCode = (body.proc_code ?? "").trim().toUpperCase();
  if (procCode === "") {
    return json({ ok: false, error: "proc_code is required for create." }, 400);
  }

  const today = new Date().toISOString().slice(0, 10);

  const payload: Record<string, unknown> = {
    PatNum: patNum,
    procCode: procCode,
    ProcStatus: "TP",
    ProcDate: today,
  };

  if (typeof body.tooth_num === "string" && body.tooth_num.trim() !== "") {
    payload.ToothNum = body.tooth_num.trim();
  }
  if (typeof body.surf === "string" && body.surf.trim() !== "") {
    payload.Surf = body.surf.trim().toUpperCase();
  }

  if (dryRun) {
    return json({
      ok: true,
      office: officeRow.name,
      action: "create",
      dry_run: true,
      pricing_context: pricingContext,
      would_post_to: `${OD_BASE_URL}/procedurelogs`,
      would_post: payload,
      omitted_deliberately: ["ProcFee", "ProvNum"],
      note: "Nothing was written. Send dry_run: false to run it for real.",
      calls,
      run_by: userData.user.email,
      run_at: new Date().toISOString(),
    });
  }

  const created = await odFetch(auth, "POST", "/procedurelogs", payload);
  calls.push(created);

  const createdBody = created.body as Record<string, unknown> | null;
  const procNum = createdBody && typeof createdBody.ProcNum === "number"
    ? createdBody.ProcNum
    : null;

  let readBack: OdCall | null = null;
  if (procNum !== null) {
    readBack = await odFetch(auth, "GET", `/procedurelogs/${procNum}`);
    calls.push(readBack);
  }

  const readBody = readBack?.body as Record<string, unknown> | null;

  return json({
    ok: created.http_status >= 200 && created.http_status < 300,
    office: officeRow.name,
    action: "create",
    dry_run: false,
    posted: payload,
    omitted_deliberately: ["ProcFee", "ProvNum"],
    proc_num: procNum,
    answer: {
      fee_from_post: createdBody?.ProcFee ?? null,
      fee_from_read_back: readBody?.ProcFee ?? null,
      prov_num_assigned: readBody?.ProvNum ?? null,
      prov_abbr_assigned: readBody?.provAbbr ?? null,
      status_stored: readBody?.ProcStatus ?? null,
      tooth_stored: readBody?.ToothNum ?? null,
      surf_stored: readBody?.Surf ?? null,
    },
    pricing_context: pricingContext,
    cleanup: procNum === null
      ? "No ProcNum returned, nothing to clean up."
      : `Call again with { "office": "${officeRow.slug}", "action": "delete", "proc_num": ${procNum}, "dry_run": false }`,
    calls,
    run_by: userData.user.email,
    run_at: new Date().toISOString(),
  });
});
