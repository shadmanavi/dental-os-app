// =====================================================================
// Dental OS - Edge Function: od-benefit-probe
//
// A read-only probe with two unrelated questions, kept in one function
// because both are temporary and both get deleted together.
//
// Deploy path: supabase/functions/od-benefit-probe/index.ts
// Version: 2
//
// ---------------------------------------------------------------------
// Changelog
//
//   v2  BaseEst, and the fields that explain a zero.
//
//       v1 answered the first question and raised a harder one. Opening
//       the Treatment Plan module in the OD client did recalculate and
//       did persist: InsPayEst across patient 32569 went from 2,078.20
//       to exactly 1,500.00, the annual maximum, and stayed there after
//       the module was closed. Nothing this app did triggered it, and
//       the API has no endpoint that can — the published resource list
//       has no recalculate method, and ChartModules offers only
//       ProgNotes, PatientInfo and PlannedAppts.
//
//       That left InsPayEst holding figures capped for one particular
//       ordering. Reordering the plan chairside changes which
//       procedures should get the remaining benefit, and the rows that
//       were zeroed have lost the number needed to redistribute.
//
//       OpenDental's source settles where that number lives.
//       ComputeBaseEst finishes BaseEst and then says so in a comment:
//       the base estimate is done and will not be altered further, and
//       from that point only InsEstTotal changes. The annual maximum is
//       applied after, in Benefits.GetLimitationByCode, and it writes
//       InsEstTotal and InsPayEst alone.
//
//       So BaseEst should be the uncapped figure — fee or allowed,
//       less copay, times the category percentage, with the deductible
//       already taken out. If it survives on the rows the maximum
//       zeroed, a ceiling can be applied over OpenDental's own
//       adjudication without this app ever deciding what a carrier
//       covers.
//
//       EstimateNote comes too. It is where OpenDental writes "Over
//       annual max", "Exclusion" and age limitations in words. A reason
//       read from OpenDental beats one this app infers.
//
//       The override fields are read to confirm they are all -1, which
//       is OpenDental's "no override". A populated override would mean
//       somebody typed a number over the estimate, and that number must
//       never be recalculated by anything.
//
//   v1  Does OpenDental re-price when acceptance changes, and what does
//       it hold about the office.
//
// Call:
//   { "office":"downey", "action":"snapshot", "pat_num":32569 }
//   { "office":"downey", "action":"office" }
//
// ---------------------------------------------------------------------
// Question one: does OpenDental re-price when acceptance changes?
//
//   OpenDental allocates a patient's annual maximum and deductible
//   across their planned procedures. The order it walks them in is the
//   priority order, so a Diag row sitting ahead of an Acc row consumes
//   benefit the accepted work should have had. The patient is then
//   quoted a number that is wrong in the patient's favour or against
//   it, and nobody finds out until the claim comes back.
//
//   Changing the priority through the API changes that order. What is
//   not known is whether it changes the money. OpenDental recalculates
//   estimates on its own triggers inside the Windows client — opening
//   the Treatment Plan module is one of them — and a PUT from outside
//   may reorder the list while leaving every claimproc exactly as it
//   was.
//
//   This function does not test that by writing. It takes a snapshot,
//   and a person does the changing in between. Three snapshots answer
//   it:
//
//     1. before anything            — the baseline
//     2. after accepting a row in Dental OS, immediately
//     3. after opening the Treatment Plan module in the OD client
//
//   Figures moving at 2 means the API write re-prices and the screen
//   can trust itself. Figures moving only at 3 means it cannot, and
//   Dental OS must re-read from OpenDental rather than compute, or
//   present a total it knows may be stale.
//
//   Patient 32569 is the test record for this: Delta Dental of CA,
//   $1,500 annual maximum, $50 deductible, crowns at 50%. The crowns
//   are large enough relative to the maximum that any reallocation
//   shows up in whole dollars rather than rounding.
//
// ---------------------------------------------------------------------
// Question two: what does OpenDental know about the office?
//
//   The treatment plan PDF prints an office name this app was told,
//   not one OpenDental holds. Address, phone and website should come
//   from the same place the office already maintains, so a practice
//   that moves does not have to remember this app exists.
//
//   Practice-level details live in the preference table as name/value
//   rows; per-location details live in clinic. Which of the two an
//   office actually fills in varies, so both are read and the answer
//   is whatever comes back populated.
//
//   None of this is PHI. It is the information already printed on the
//   practice's own letterhead.
//
// ---------------------------------------------------------------------
// This file is temporary and is expected to be deleted once both
// questions are answered.
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

// 1 is treatment planned. Completed work is not part of a plan's
// estimate and would only add noise to the comparison.
const PROC_STATUS_TP = 1;

// claimproc.Status 6 is Estimate — the rows holding the money.
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

async function shortQueryAll(
  auth: string,
  sql: string,
  maxPages = 10,
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

type Step = {
  question: string;
  ok: boolean;
  row_count: number;
  rows: Record<string, unknown>[];
  error: string | null;
};

async function step(
  auth: string,
  question: string,
  sql: string,
): Promise<Step> {
  const { rows, failed } = await shortQueryAll(auth, sql);

  if (failed !== null) {
    return {
      question,
      ok: false,
      row_count: 0,
      rows: [],
      error: `HTTP ${failed.http_status}: ${
        typeof failed.body === "string"
          ? failed.body.slice(0, 300)
          : JSON.stringify(failed.body).slice(0, 300)
      }`,
    };
  }

  return { question, ok: true, row_count: rows.length, rows, error: null };
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
    label?: string;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const action = (body.action ?? "snapshot").toLowerCase().trim();

  if (action !== "snapshot" && action !== "office") {
    return json({ ok: false, error: "action must be snapshot or office." }, 400);
  }

  if (officeId === "" && officeSlug === "") {
    return json({ ok: false, error: "Provide office_id or office." }, 400);
  }

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
  // office — what OpenDental holds about the practice
  // ===================================================================
  if (action === "office") {
    const steps: Step[] = [];

    // Practice-level details. The preference table is name/value, and
    // the practice rows all begin with "Practice". Returned as they
    // stand: this is letterhead information, not PHI.
    steps.push(await step(
      auth,
      "Practice preferences — every row whose name begins with Practice",
      `SELECT PrefName, ValueString FROM preference ` +
        `WHERE PrefName LIKE 'Practice%' ORDER BY PrefName`,
    ));

    // A handful of others that are not named Practice but belong on a
    // printed plan. Asked for by name because a LIKE over the whole
    // preference table returns several hundred rows of settings.
    steps.push(await step(
      auth,
      "Other preferences that belong on letterhead",
      `SELECT PrefName, ValueString FROM preference WHERE PrefName IN (` +
        `'PracticeTitle','PracticeAddress','PracticeAddress2','PracticeCity',` +
        `'PracticeST','PracticeZip','PracticePhone','PracticeFax',` +
        `'PracticeBillingAddress','PracticePayToAddress','PracticeDefaultProv',` +
        `'PracticeWebsite','WebsiteURL','EmailSenderAddress',` +
        `'PracticeDefaultBillType','MedicaidID'` +
        `) ORDER BY PrefName`,
    ));

    // Per-location details, for practices that use clinics. Field names
    // are read from a live row so we learn what exists rather than
    // guessing; the values come too, because a clinic's address is
    // public information.
    steps.push(await step(
      auth,
      "Clinics — every clinic this server holds",
      `SELECT * FROM clinic ORDER BY ClinicNum`,
    ));

    return json({
      ok: true,
      office: officeRow.slug,
      office_name: officeRow.name,
      probe: "od-benefit-probe v2, action office — read only",
      steps,
    });
  }

  // ===================================================================
  // snapshot — every planned procedure and its estimate, right now
  // ===================================================================
  const patNum = body.pat_num;

  if (typeof patNum !== "number" || patNum <= 0) {
    return json({ ok: false, error: "pat_num is required." }, 400);
  }

  // The plan as OpenDental currently prices it, ordered as the module
  // orders it.
  const planStep = await step(
    auth,
    "Planned procedures with their current estimates",
    // One row per claimproc rather than one per procedure. v1 summed
    // them, which hid whether a zero was one estimate reduced to
    // nothing or two rows cancelling out. BaseEst only means something
    // per row.
    //
    // Ordered the way OpenDental's Treatment Plan module orders it,
    // confirmed against Procedures.GetOrdered in the source:
    // unprioritised last, then definition.ItemOrder — not the DefNum —
    // then ProcDate, then ProcNum. That order is also the order the
    // annual maximum is consumed in, which is the whole reason it
    // matters here.
    `SELECT pl.ProcNum, pc.ProcCode, pl.Priority, ` +
      `d.ItemName AS PriorityName, d.ItemOrder, pl.ProcFee, ` +
      `cp.ClaimProcNum, cp.BaseEst, cp.InsEstTotal, cp.InsPayEst, ` +
      `cp.DedApplied, cp.WriteOff, cp.WriteOffEst, cp.Percentage, ` +
      `cp.NoBillIns, cp.EstimateNote, ` +
      `cp.InsEstTotalOverride, cp.DedEstOverride, ` +
      `cp.PercentOverride, cp.WriteOffEstOverride, ` +
      `cp.AllowedOverride, cp.CopayOverride ` +
      `FROM procedurelog pl ` +
      `INNER JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum ` +
      `LEFT JOIN definition d ON d.DefNum = pl.Priority ` +
      `LEFT JOIN claimproc cp ON cp.ProcNum = pl.ProcNum ` +
      `AND cp.Status = ${CLAIMPROC_ESTIMATE} ` +
      `WHERE pl.PatNum = ${patNum} AND pl.ProcStatus = ${PROC_STATUS_TP} ` +
      `ORDER BY CASE WHEN pl.Priority = 0 THEN 1 ELSE 0 END, ` +
      `d.ItemOrder, pl.ProcDate, pl.ProcNum`,
  );

  // The benefit itself: annual maximum and deductible as the plan
  // holds them, so a reallocation can be read against a ceiling rather
  // than in isolation.
  const benefitStep = await step(
    auth,
    "Annual maximum and deductible on this patient's plans",
    `SELECT b.BenefitNum, b.PlanNum, b.BenefitType, b.MonetaryAmt, ` +
      `b.Percent, b.CoverageLevel, b.TimePeriod, b.QuantityQualifier, ` +
      `cat.Description AS CategoryName ` +
      `FROM benefit b ` +
      `LEFT JOIN covcat cat ON cat.CovCatNum = b.CovCatNum ` +
      `WHERE b.PlanNum IN (` +
      `SELECT isub.PlanNum FROM patplan pp ` +
      `INNER JOIN inssub isub ON isub.InsSubNum = pp.InsSubNum ` +
      `WHERE pp.PatNum = ${patNum}` +
      `) ORDER BY b.PlanNum, b.BenefitType`,
  );

  // What has already been used this year. The remaining maximum is the
  // number that actually constrains an estimate, and it is not stored —
  // it is the annual maximum less what has been paid.
  const usedStep = await step(
    auth,
    "Insurance already paid this benefit year",
    `SELECT cp.PlanNum, ` +
      `COALESCE(SUM(cp.InsPayAmt), 0) AS PaidThisYear, ` +
      `COALESCE(SUM(cp.DedApplied), 0) AS DeductibleUsed, ` +
      `COUNT(*) AS Rows_ ` +
      `FROM claimproc cp ` +
      `WHERE cp.PatNum = ${patNum} AND cp.InsPayAmt > 0 ` +
      `AND cp.DateCP >= '2026-01-01' ` +
      `GROUP BY cp.PlanNum`,
  );

  type Totals = {
    fee: number;
    base_est: number;
    ins_est_total: number;
    ins_pay_est: number;
    ded_applied: number;
    write_off: number;
  };

  const totals = planStep.rows.reduce<Totals>(
    (acc, r) => ({
      fee: acc.fee + money(r.ProcFee),
      // The uncapped figure and the capped one, side by side. The gap
      // between them is what the annual maximum removed, and it is the
      // number this whole question is about.
      base_est: acc.base_est + money(r.BaseEst),
      ins_est_total: acc.ins_est_total + money(r.InsEstTotal),
      ins_pay_est: acc.ins_pay_est + money(r.InsPayEst),
      ded_applied: acc.ded_applied + money(r.DedApplied),
      write_off: acc.write_off + money(r.WriteOff),
    }),
    {
      fee: 0,
      base_est: 0,
      ins_est_total: 0,
      ins_pay_est: 0,
      ded_applied: 0,
      write_off: 0,
    },
  );

  for (const key of Object.keys(totals) as (keyof Totals)[]) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }

  return json({
    ok: true,
    office: officeRow.slug,
    pat_num: patNum,
    // Free text from the caller, so three snapshots can be told apart
    // in a console without reading timestamps.
    label: String(body.label ?? "").trim(),
    taken_at: new Date().toISOString(),
    probe: "od-benefit-probe v2, action snapshot — read only",
    totals,
    steps: [planStep, benefitStep, usedStep],
  });
});
