// =====================================================================
// Dental OS - Edge Function: od-survey
//
// Read-only. Answers "what does this office actually do?" by counting
// completed procedures over a window, so the chart tiles can be seeded
// from real volume instead of from a guess about dentistry in general.
//
// Deploy path: supabase/functions/od-survey/index.ts
// Version: 2
// Changelog:
//   v1  procedure_mix action. One joined SELECT over procedurelog and
//       procedurecode, grouped by code, ordered by count.
//   v2  Adds fee_lookup, for the paired-tile fee split.
//
//       A crown is two lines: the prep and the delivery. Both are
//       created at diagnosis and the fee is divided between them. To
//       divide a fee, Dental OS has to know it — which is a departure
//       from the rule that this system never prices anything. It still
//       never originates a price; it reads OpenDental's and splits it.
//
//       Shad set the rule: an insured patient is priced from the
//       insurance plan's fee schedule, an uninsured one from the fee
//       schedule on the patient record. This action proves that chain
//       resolves on real patients before anything is built on it, by
//       walking patplan to inssub to insplan and showing every step
//       rather than only the answer.
//
//       Four things it deliberately surfaces rather than deciding:
//
//       - Ordinal, IsPending and DateTerm. A patient can carry several
//         plans, one pending and one terminated. Which one counts is a
//         rule, and the raw fields are shown so the rule can be checked
//         against them.
//       - CopayFeeSched, ManualFeeSchedNum and IsBlueBookEnabled. A
//         plan can price through paths other than its FeeSched. If any
//         of these are set on a Greenwood plan, "read insplan.FeeSched"
//         is too simple and the response will show it.
//       - fee rows carry ClinicNum and ProvNum. The same code in the
//         same schedule can hold more than one amount. Every matching
//         row is returned, not the first one found.
//       - Whether a fee row exists at all. A schedule with no row for a
//         code is not a zero fee; it is a gap, and the two must not be
//         confused.
//
// Why SQL rather than the REST endpoints:
//   GET /procedurelogs filters by PatNum. Pulling six months across the
//   whole practice through it would mean walking every patient, and the
//   od-chart-probe timings settled that OpenDental serves those calls
//   sequentially — 31 of them took 6.7 seconds. One ShortQuery returned
//   the same data in 305ms. PUT /queries/ShortQuery rejects anything
//   that is not read-only with a 401, so a SELECT is all this can do.
//
// What counts as "done":
//   ProcStatus 2 is Complete in the procedurelog table. That integer is
//   asserted from OpenDental's schema, not yet confirmed against this
//   office's data, so the response carries a status_census showing every
//   status value present with its count. If 2 does not dominate the way
//   a completed-work status should, the census will say so plainly
//   rather than the number quietly being wrong.
//
// Required secrets (already set for the other od-* functions):
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
//
// Call:
//   POST /functions/v1/od-survey
//   Authorization: Bearer <user access token>
//
//   { "office":"downey", "action":"procedure_mix" }
//     Optional: "months": 6        (1-36, default 6)
//     Optional: "min_count": 1     (drop codes below this, default 1)
//     Optional: "limit": 400       (default 400, max 1000)
//
//   { "office":"downey", "action":"fee_lookup" }
//     Optional: "pat_nums": [5969, 34173]
//               Omitted, it finds one insured and one uninsured patient
//               from recent completed work, so no PatNum has to be
//               hunted down by hand.
//     Optional: "codes": ["D2751","D2751d"]
//
// PHI note: procedure_mix counts codes and selects no patient
// identifiers. fee_lookup selects PatNum and insurance plan structure,
// but no names, birthdates or subscriber IDs. Nothing is written to the
// Dental OS database by either.
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

  if (payload !== undefined) init.body = JSON.stringify(payload);

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

// ShortQuery caps a page at 100 rows. Offset was confirmed to advance
// rather than being ignored, so walk until a short page lands.
async function shortQueryAll(
  auth: string,
  sql: string,
  calls: OdCall[],
  maxPages = 20,
): Promise<{ ok: boolean; rows: Record<string, unknown>[]; failure?: OdCall }> {
  const PAGE = 100;
  const rows: Record<string, unknown>[] = [];

  for (let page = 0; page < maxPages; page++) {
    const offset = page * PAGE;
    const call = await odFetch(
      auth,
      "PUT",
      offset === 0
        ? "/queries/ShortQuery"
        : `/queries/ShortQuery?Offset=${offset}`,
      { SqlCommand: sql },
    );
    calls.push(call);

    if (call.http_status < 200 || call.http_status >= 300) {
      return { ok: false, rows, failure: call };
    }

    if (!Array.isArray(call.body)) break;
    const batch = call.body as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  return { ok: true, rows };
}

// OpenDental groups codes into categories through definition rows. The
// category name is more useful for seeding tiles than the raw number,
// so it is joined in and passed through untouched.
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
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
    months?: number;
    min_count?: number;
    limit?: number;
    pat_nums?: unknown;
    codes?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const action = (body.action ?? "procedure_mix").toLowerCase().trim();

  const ACTIONS = ["procedure_mix", "fee_lookup"];
  if (!ACTIONS.includes(action)) {
    return json({
      ok: false,
      error: `action must be one of: ${ACTIONS.join(", ")}.`,
    }, 400);
  }

  if (officeId === "" && officeSlug === "") {
    return json({ ok: false, error: "Provide office_id or office." }, 400);
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
      error: "This office has no recognized OpenDental key configured.",
    }, 500);
  }

  const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
  const customerKey = Deno.env.get(secretName);

  if (!developerKey || !customerKey) {
    return json({
      ok: false,
      error: "Missing Edge Function secrets.",
      missing: [
        ...(developerKey ? [] : ["OD_DEVELOPER_KEY"]),
        ...(customerKey ? [] : [secretName]),
      ],
    }, 500);
  }

  const auth = `ODFHIR ${developerKey}/${customerKey}`;
  const calls: OdCall[] = [];

  // ===================================================================
  // fee_lookup — prove the insurance-then-patient fee schedule chain
  // ===================================================================
  if (action === "fee_lookup") {
    // Codes are interpolated into SQL, so anything that is not a plain
    // procedure code is dropped rather than escaped.
    const SAFE_CODE = /^[A-Za-z0-9._-]{1,20}$/;

    const requestedCodes = Array.isArray(body.codes)
      ? (body.codes as unknown[])
        .map((c) => String(c).trim())
        .filter((c) => SAFE_CODE.test(c))
      : [];

    const codes = requestedCodes.length > 0
      ? requestedCodes
      : ["D2751", "D2751d", "D2750", "D2750d", "D2740", "D2740d"];

    const codeList = codes.map((c) => `'${c}'`).join(",");

    // Patients. Given ones win; otherwise find one of each kind so this
    // can be run without hunting for a PatNum first.
    const givenPatNums = Array.isArray(body.pat_nums)
      ? (body.pat_nums as unknown[])
        .map((p) => Math.trunc(num(p)))
        .filter((p) => p > 0)
        .slice(0, 6)
      : [];

    const patNums: number[] = [...givenPatNums];
    let patientsAutoSelected = false;

    if (patNums.length === 0) {
      patientsAutoSelected = true;

      // Recent completed work, so the sample is a patient the office
      // actually treats rather than a dormant record.
      const insuredSql =
        `SELECT DISTINCT pl.PatNum FROM procedurelog pl ` +
        `INNER JOIN patplan pp ON pp.PatNum = pl.PatNum ` +
        `WHERE pl.ProcStatus = 2 ORDER BY pl.ProcDate DESC LIMIT 1`;

      const uninsuredSql =
        `SELECT DISTINCT pl.PatNum FROM procedurelog pl ` +
        `LEFT JOIN patplan pp ON pp.PatNum = pl.PatNum ` +
        `WHERE pl.ProcStatus = 2 AND pp.PatPlanNum IS NULL ` +
        `ORDER BY pl.ProcDate DESC LIMIT 1`;

      for (const sql of [insuredSql, uninsuredSql]) {
        const found = await shortQueryAll(auth, sql, calls, 1);
        if (found.ok) {
          for (const row of found.rows) {
            const n = Math.trunc(num(row.PatNum));
            if (n > 0 && !patNums.includes(n)) patNums.push(n);
          }
        }
      }
    }

    if (patNums.length === 0) {
      return json({
        ok: false,
        error: "No patients to look up. Pass pat_nums explicitly.",
      }, 400);
    }

    const patList = patNums.join(",");

    // ---- The patient's own fee schedule, the fallback in the rule ----
    const patientSql =
      `SELECT p.PatNum, p.FeeSched, fs.Description AS FeeSchedName, ` +
      `fs.FeeSchedType ` +
      `FROM patient p ` +
      `LEFT JOIN feesched fs ON fs.FeeSchedNum = p.FeeSched ` +
      `WHERE p.PatNum IN (${patList})`;

    const patientRes = await shortQueryAll(auth, patientSql, calls, 2);

    if (!patientRes.ok) {
      return json({
        ok: false,
        error: "Could not read the patient records.",
        detail: patientRes.failure?.body ?? null,
        sql: patientSql,
      }, 502);
    }

    // ---- Every plan attached to those patients ----
    // Ordinal, IsPending and DateTerm all come back raw. Deciding which
    // plan counts is a rule, and the rule should be checked against the
    // fields rather than baked in silently.
    const plansSql =
      `SELECT pp.PatNum, pp.PatPlanNum, pp.Ordinal, pp.IsPending, ` +
      `pp.InsSubNum, isub.PlanNum, isub.DateEffective, isub.DateTerm, ` +
      `ip.FeeSched, ip.PlanType, ip.CopayFeeSched, ip.IsMedical, ` +
      `fs.Description AS FeeSchedName, fs.FeeSchedType, ` +
      `c.CarrierName ` +
      `FROM patplan pp ` +
      `LEFT JOIN inssub isub ON isub.InsSubNum = pp.InsSubNum ` +
      `LEFT JOIN insplan ip ON ip.PlanNum = isub.PlanNum ` +
      `LEFT JOIN feesched fs ON fs.FeeSchedNum = ip.FeeSched ` +
      `LEFT JOIN carrier c ON c.CarrierNum = ip.CarrierNum ` +
      `WHERE pp.PatNum IN (${patList}) ` +
      `ORDER BY pp.PatNum, pp.Ordinal`;

    const plansRes = await shortQueryAll(auth, plansSql, calls, 4);

    // A failure here is reported rather than thrown, because the patient
    // half of the answer is still worth having.
    const planRows = plansRes.ok ? plansRes.rows : [];

    const patients = patientRes.rows.map((r) => {
      const patNum = Math.trunc(num(r.PatNum));
      const patientFeeSched = Math.trunc(num(r.FeeSched));

      const plans = planRows
        .filter((pr) => Math.trunc(num(pr.PatNum)) === patNum)
        .map((pr) => ({
          pat_plan_num: Math.trunc(num(pr.PatPlanNum)),
          ordinal: Math.trunc(num(pr.Ordinal)),
          is_pending: Math.trunc(num(pr.IsPending)) === 1,
          plan_num: Math.trunc(num(pr.PlanNum)),
          carrier: text(pr.CarrierName),
          date_effective: text(pr.DateEffective).slice(0, 10),
          date_term: text(pr.DateTerm).slice(0, 10),
          fee_sched: Math.trunc(num(pr.FeeSched)),
          fee_sched_name: text(pr.FeeSchedName),
          fee_sched_type: Math.trunc(num(pr.FeeSchedType)),
          plan_type: text(pr.PlanType),
          copay_fee_sched: Math.trunc(num(pr.CopayFeeSched)),
          is_medical: Math.trunc(num(pr.IsMedical)) === 1,
        }));

      // A terminated plan is one whose DateTerm is a real past date.
      // OpenDental writes 0001-01-01 for "not terminated", so a blank
      // or zero year means still active.
      const today = new Date().toISOString().slice(0, 10);

      const usable = plans.filter((pl) => {
        if (pl.is_pending) return false;
        if (pl.is_medical) return false;
        if (pl.fee_sched <= 0) return false;
        const term = pl.date_term;
        if (term === "" || term.startsWith("0001")) return true;
        return term >= today;
      });

      usable.sort((a, b) => a.ordinal - b.ordinal);
      const chosen = usable.length > 0 ? usable[0] : null;

      return {
        pat_num: patNum,
        patient_fee_sched: patientFeeSched,
        patient_fee_sched_name: text(r.FeeSchedName),
        patient_fee_sched_type: Math.trunc(num(r.FeeSchedType)),
        plan_count: plans.length,
        usable_plan_count: usable.length,
        plans,
        resolved_source: chosen !== null ? "insurance plan" : "patient record",
        resolved_fee_sched: chosen !== null ? chosen.fee_sched : patientFeeSched,
        resolved_fee_sched_name: chosen !== null
          ? chosen.fee_sched_name
          : text(r.FeeSchedName),
        // Set on any plan means "read insplan.FeeSched" is too simple.
        pricing_complications: plans
          .filter((pl) => pl.copay_fee_sched > 0 || pl.plan_type !== "")
          .map((pl) => ({
            plan_num: pl.plan_num,
            plan_type: pl.plan_type,
            copay_fee_sched: pl.copay_fee_sched,
          })),
      };
    });

    // ---- The fees themselves ----
    // Every schedule any patient above resolved to, plus their patient
    // schedules, so a gap is visible rather than inferred.
    const schedNums = new Set<number>();
    for (const p of patients) {
      if (p.resolved_fee_sched > 0) schedNums.add(p.resolved_fee_sched);
      if (p.patient_fee_sched > 0) schedNums.add(p.patient_fee_sched);
    }

    const feeRows: Record<string, unknown>[] = [];
    let feeSql = "";

    if (schedNums.size > 0) {
      feeSql =
        `SELECT f.FeeSchedNum, f.CodeNum, f.Amount, f.ClinicNum, f.ProvNum, ` +
        `pc.ProcCode, pc.Descript, fs.Description AS FeeSchedName ` +
        `FROM fee f ` +
        `INNER JOIN procedurecode pc ON pc.CodeNum = f.CodeNum ` +
        `LEFT JOIN feesched fs ON fs.FeeSchedNum = f.FeeSchedNum ` +
        `WHERE f.FeeSchedNum IN (${[...schedNums].join(",")}) ` +
        `AND pc.ProcCode IN (${codeList}) ` +
        `ORDER BY f.FeeSchedNum, pc.ProcCode`;

      const feeRes = await shortQueryAll(auth, feeSql, calls, 6);
      if (feeRes.ok) feeRows.push(...feeRes.rows);
    }

    const fees = feeRows.map((r) => ({
      fee_sched: Math.trunc(num(r.FeeSchedNum)),
      fee_sched_name: text(r.FeeSchedName),
      code: text(r.ProcCode),
      description: text(r.Descript),
      amount: num(r.Amount),
      clinic_num: Math.trunc(num(r.ClinicNum)),
      prov_num: Math.trunc(num(r.ProvNum)),
    }));

    // What each patient would actually be charged for each code, and
    // whether the pair splits cleanly.
    const resolved = patients.map((p) => {
      const perCode = codes.map((code) => {
        const matches = fees.filter(
          (f) => f.fee_sched === p.resolved_fee_sched && f.code === code,
        );

        return {
          code,
          // A schedule with no row for a code is a gap, not a zero.
          found: matches.length > 0,
          amount: matches.length > 0 ? matches[0].amount : null,
          // More than one row means clinic or provider overrides exist
          // and picking the first is not safe.
          match_count: matches.length,
          variants: matches.length > 1
            ? matches.map((m) => ({
              amount: m.amount,
              clinic_num: m.clinic_num,
              prov_num: m.prov_num,
            }))
            : undefined,
        };
      });

      return {
        pat_num: p.pat_num,
        resolved_source: p.resolved_source,
        resolved_fee_sched: p.resolved_fee_sched,
        resolved_fee_sched_name: p.resolved_fee_sched_name,
        codes: perCode,
      };
    });

    return json({
      ok: true,
      office: officeRow.name,
      office_slug: officeRow.slug,
      action,

      answers: {
        patients_examined: patients.length,
        patients_auto_selected: patientsAutoSelected,
        codes_examined: codes,
        plans_query_ok: plansRes.ok,
        plans_query_error: plansRes.ok ? null : plansRes.failure?.body ?? null,
        fee_rows_found: fees.length,
        // If either is true the simple rule is not enough on its own.
        any_pricing_complications: patients.some(
          (p) => p.pricing_complications.length > 0,
        ),
        any_code_missing_a_fee: resolved.some((r) =>
          r.codes.some((c) => !c.found)
        ),
        any_code_with_multiple_fees: resolved.some((r) =>
          r.codes.some((c) => c.match_count > 1)
        ),
      },

      resolved,
      patients,
      fees,

      sql: {
        patient: patientSql,
        plans: plansSql,
        fee: feeSql,
      },

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

  // ===================================================================
  // procedure_mix — what this office actually does
  // ===================================================================
  const months = Math.min(Math.max(Math.trunc(num(body.months) || 6), 1), 36);
  const minCount = Math.max(Math.trunc(num(body.min_count) || 1), 1);
  const limit = Math.min(Math.max(Math.trunc(num(body.limit) || 400), 1), 1000);

  // The window is computed here rather than in SQL so the response can
  // state exactly which dates were counted.
  const until = new Date();
  const since = new Date(until.getTime());
  since.setMonth(since.getMonth() - months);

  const sinceDate = since.toISOString().slice(0, 10);
  const untilDate = until.toISOString().slice(0, 10);

  // Step 1 — which ProcStatus values are actually in this window, and
  // how many of each? ProcStatus 2 is Complete per the schema, but that
  // is an assertion until the census backs it up.
  const censusSql =
    `SELECT ProcStatus, COUNT(*) AS Cnt ` +
    `FROM procedurelog ` +
    `WHERE ProcDate >= '${sinceDate}' AND ProcDate <= '${untilDate}' ` +
    `GROUP BY ProcStatus ORDER BY Cnt DESC`;

  const census = await shortQueryAll(auth, censusSql, calls, 2);

  if (!census.ok) {
    return json({
      ok: false,
      error: "OpenDental could not run the status census.",
      detail: census.failure?.body ?? null,
    }, 502);
  }

  const statusCensus = census.rows.map((r) => ({
    proc_status: num(r.ProcStatus),
    count: num(r.Cnt),
  }));

  const completedTotal = statusCensus.find((s) => s.proc_status === 2)?.count ?? 0;

  // Step 2 — the mix itself. Grouped in SQL so only one row comes back
  // per code, however many thousands of procedures sit behind it.
  //
  // procedurecode carries the CDT string, the description, the treatment
  // area, and the category. Treatment area is the useful one for tiles:
  // it says whether a code needs a tooth, a surface, a quadrant or
  // nothing at all, which is exactly what decides how a tile behaves.
  const mixSql =
    `SELECT pc.ProcCode, pc.Descript, pc.AbbrDesc, pc.TreatArea, ` +
    `pc.ProcCat, d.ItemName AS CatName, ` +
    `COUNT(*) AS Cnt, ` +
    `MIN(pl.ProcDate) AS FirstDone, MAX(pl.ProcDate) AS LastDone ` +
    `FROM procedurelog pl ` +
    `INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum ` +
    `LEFT JOIN definition d ON d.DefNum = pc.ProcCat ` +
    `WHERE pl.ProcStatus = 2 ` +
    `AND pl.ProcDate >= '${sinceDate}' AND pl.ProcDate <= '${untilDate}' ` +
    `GROUP BY pc.ProcCode, pc.Descript, pc.AbbrDesc, pc.TreatArea, ` +
    `pc.ProcCat, d.ItemName ` +
    `HAVING COUNT(*) >= ${minCount} ` +
    `ORDER BY Cnt DESC ` +
    `LIMIT ${limit}`;

  const mix = await shortQueryAll(auth, mixSql, calls, 20);

  if (!mix.ok) {
    return json({
      ok: false,
      error: "OpenDental could not run the procedure mix query.",
      detail: mix.failure?.body ?? null,
      sql: mixSql,
    }, 502);
  }

  const procedures = mix.rows.map((r) => ({
    code: text(r.ProcCode),
    description: text(r.Descript),
    short_description: text(r.AbbrDesc),
    // Raw integer. The meaning is deliberately not translated here —
    // the mapping has not been confirmed against this office's data,
    // and a wrong label would be worse than a bare number.
    treat_area: num(r.TreatArea),
    category_num: num(r.ProcCat),
    category: text(r.CatName),
    count: num(r.Cnt),
    first_done: text(r.FirstDone).slice(0, 10),
    last_done: text(r.LastDone).slice(0, 10),
  }));

  const countedTotal = procedures.reduce((sum, p) => sum + p.count, 0);

  // A category rollup, since tiles are grouped by category on screen and
  // the volume per category is what decides how many tiles each deserves.
  const byCategory = new Map<
    string,
    { category: string; category_num: number; codes: number; count: number }
  >();

  for (const p of procedures) {
    const key = p.category !== "" ? p.category : `Category ${p.category_num}`;
    const existing = byCategory.get(key);
    if (existing) {
      existing.codes++;
      existing.count += p.count;
    } else {
      byCategory.set(key, {
        category: key,
        category_num: p.category_num,
        codes: 1,
        count: p.count,
      });
    }
  }

  const categories = [...byCategory.values()].sort((a, b) => b.count - a.count);

  // How much of the volume the top codes cover. This is the number that
  // decides how many tiles the screen actually needs: if 40 codes carry
  // 95% of the work, the other 300 do not need buttons.
  function coverageAfter(topN: number): number {
    if (countedTotal === 0) return 0;
    const slice = procedures.slice(0, topN).reduce((s, p) => s + p.count, 0);
    return Math.round((slice / countedTotal) * 1000) / 10;
  }

  return json({
    ok: true,
    office: officeRow.name,
    office_slug: officeRow.slug,
    action,

    window: {
      months,
      since: sinceDate,
      until: untilDate,
    },

    answers: {
      distinct_codes: procedures.length,
      procedures_counted: countedTotal,
      completed_in_window_per_census: completedTotal,
      // These two should agree. A gap means codes were dropped by
      // min_count or limit, and the response says so rather than
      // letting the totals quietly disagree.
      census_matches_mix: completedTotal === countedTotal,
      min_count_applied: minCount,
      limit_applied: limit,
      truncated_by_limit: procedures.length >= limit,
      coverage_top_20_pct: coverageAfter(20),
      coverage_top_40_pct: coverageAfter(40),
      coverage_top_60_pct: coverageAfter(60),
      status_census: statusCensus,
    },

    categories,
    procedures,

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
});
