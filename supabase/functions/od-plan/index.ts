// =====================================================================
// Dental OS - Edge Function: od-plan
//
// The server side of the treatment plan presentation. od-chart serves
// the chair; this serves the conversation that happens afterwards, with
// the treatment coordinator and the patient looking at one screen.
//
// Deploy path: supabase/functions/od-plan/index.ts
// Version: 3
//
// Actions:
//   { "office":"downey", "action":"plan", "pat_num":17 }
//   { "office":"downey", "action":"presenters" }
//   { "office":"downey", "action":"remove", "pat_num":17, "od_id":1081946 }
//   { "office":"downey", "action":"set_priority", "pat_num":17,
//     "od_id":1081990, "priority":153 }
//   { "office":"downey", "action":"set_fee", "pat_num":17,
//     "od_id":1081990, "fee":123.45 }
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
//   - Priority and ProcFee both write. Proved on ProcNum 1081990:
//     Priority 153 read back as "3", and a fee of 123.45 stuck against
//     a schedule fee of 210. Worth stating because three fields on
//     treatplans did the opposite — accepted with 200, changed nothing.
//
//   - The priority list is per office and the numbering does not match.
//     Downey's DefNum 148 is "Not Accepted"; Maywood's 148 is
//     "Optional". Sending a number read from the wrong office would
//     silently set the wrong thing, so plan returns the list alongside
//     the procedures and the screen never carries one between offices.
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
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const action = (body.action ?? "").toLowerCase().trim();

  const ACTIONS = ["plan", "presenters", "remove", "set_priority", "set_fee"];
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
      `SELECT pl.ProcNum, pl.ToothNum, pl.Surf, pl.Priority, ` +
      `pl.ProcDate, pl.ProcFee, ` +
      `d.ItemName AS PriorityName, d.ItemOrder AS PriorityOrder, ` +
      `pc.ProcCode, pc.Descript, ` +
      `pr.Abbr AS ProvAbbr, ` +
      `COUNT(cp.ClaimProcNum) AS EstRows, ` +
      `COALESCE(SUM(CASE WHEN pp.Ordinal = 1 THEN cp.InsPayEst ELSE 0 END), 0) AS PriIns, ` +
      `COALESCE(SUM(CASE WHEN pp.Ordinal > 1 THEN cp.InsPayEst ELSE 0 END), 0) AS SecIns, ` +
      `COALESCE(SUM(cp.WriteOff), 0) AS WriteOff, ` +
      `COALESCE(SUM(cp.DedApplied), 0) AS DedApplied, ` +
      `COALESCE(MAX(cp.NoBillIns), 0) AS NoBillIns ` +
      `FROM procedurelog pl ` +
      `INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum ` +
      `LEFT JOIN provider pr ON pr.ProvNum = pl.ProvNum ` +
      `LEFT JOIN definition d ON d.DefNum = pl.Priority ` +
      `LEFT JOIN claimproc cp ON cp.ProcNum = pl.ProcNum ` +
      `AND cp.Status = ${CLAIMPROC_ESTIMATE} ` +
      `LEFT JOIN patplan pp ON pp.InsSubNum = cp.InsSubNum ` +
      `WHERE pl.PatNum = ${patNum} AND pl.ProcStatus = ${PROC_STATUS_TP} ` +
      `GROUP BY pl.ProcNum, pl.ToothNum, pl.Surf, pl.Priority, pl.ProcDate, ` +
      `pl.ProcFee, d.ItemName, d.ItemOrder, pc.ProcCode, pc.Descript, pr.Abbr ` +
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

    // The dropdown's options, from this office's own definitions. Sent
    // with the plan rather than fetched separately, because a screen
    // holding a list from the other office would set the wrong value
    // without ever looking wrong.
    const priorityList = await shortQueryAll(
      auth,
      `SELECT DefNum, ItemName, ItemOrder FROM definition ` +
        `WHERE Category = 20 AND IsHidden = 0 ORDER BY ItemOrder`,
    );

    const priorities = priorityList.rows.map((r) => ({
      def_num: Number(r.DefNum ?? 0),
      label: String(r.ItemName ?? "").trim(),
      order: Number(r.ItemOrder ?? 999),
    })).filter((p) => p.def_num > 0 && p.label !== "");

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

        fee,
        allowed,
        pri_ins: priIns,
        sec_ins: secIns,
        write_off: writeOff,
        deductible: money(r.DedApplied),
        pat,
        covered,
        // Why it is not covered, so the coordinator can say something
        // more useful than "insurance won't pay".
        no_bill_ins: noBillIns,
        estimated: estRows > 0,
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
      priorities,
      // Named so the screen can say where a number came from rather
      // than presenting it as this app's arithmetic.
      money_source:
        "OpenDental procedure fees and its own insurance estimates (claimproc).",
    });
  }

  // ===================================================================
  // set_priority / set_fee — edit one planned procedure
  //
  // Both fields were proved to write on ProcNum 1081990 before this was
  // built. Each sends one field and nothing else, and reads the row back
  // rather than trusting the response, because this API has form for
  // accepting a value and keeping its own.
  // ===================================================================
  if (action === "set_priority" || action === "set_fee") {
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
    } else {
      const priority = body.priority;
      if (typeof priority !== "number" || !Number.isInteger(priority) ||
        priority < 0
      ) {
        return json({
          ok: false,
          error: "priority must be a definition number, or 0 to clear it.",
        }, 400);
      }

      // The number has to belong to this office's own list. Downey's 148
      // is "Not Accepted" and Maywood's 148 is "Optional", so a value
      // carried across offices would set something nobody chose. Zero is
      // allowed: it is how OpenDental stores "no priority".
      if (priority !== 0) {
        const known = await shortQueryAll(
          auth,
          `SELECT DefNum FROM definition ` +
            `WHERE Category = 20 AND DefNum = ${priority}`,
        );

        if (known.rows.length === 0) {
          return json({
            ok: false,
            error: `${priority} is not a priority at this office.`,
          }, 400);
        }
      }

      requested = priority;
      previous = beforeBody.Priority ?? null;
      payload = { Priority: priority };
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
      `SELECT pl.ProcFee, pl.Priority, d.ItemName AS PriorityName ` +
        `FROM procedurelog pl ` +
        `LEFT JOIN definition d ON d.DefNum = pl.Priority ` +
        `WHERE pl.ProcNum = ${odId}`,
    );

    const stored = (check.rows[0] ?? {}) as Record<string, unknown>;

    const storedValue = action === "set_fee"
      ? Math.round(Number(stored.ProcFee ?? -1) * 100) / 100
      : Number(stored.Priority ?? -1);

    const honoured = action === "set_fee"
      ? Math.round(storedValue * 100) === Math.round(requested * 100)
      : storedValue === requested;

    return json({
      ok: honoured,
      od_id: odId,
      field: action === "set_fee" ? "ProcFee" : "Priority",
      previous,
      requested,
      stored: storedValue,
      priority_label: String(stored.PriorityName ?? "").trim(),
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
