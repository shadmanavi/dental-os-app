// =====================================================================
// Dental OS - Edge Function: od-kpi
//
// A year of office KPIs in one read: the numbers Maria keys into
// "KPI Office Numbers" by hand every month, pulled live from
// OpenDental instead. Months across, KPIs down, exactly the shape
// of her sheet.
//
// Reads only. Nothing is written to OpenDental or to Supabase.
//
// Deploy path: supabase/functions/od-kpi/index.ts
// Version: 2
//
// v2: provider names read "C. Duong DDS" — first initial, last name,
// and the Suffix column when the office filled it in, RDH for a
// hygienist without one, no credential otherwise.
//
// Actions:
//   { "office":"downey", "action":"year", "year":2026 }
//
// ---------------------------------------------------------------------
// What comes back, and where each figure is read from
//
//   Production, by department. Each provider is filed under a
//   specialty (definition category 35, read by name per office the
//   way od-production does), and the specialties fold into the
//   sheet's departments: GP, Hyg, Ortho, OS, Perio, Endo, Pedo,
//   Other. Per department per month:
//
//     production = gross completed fees less capitation write-offs,
//                  both on the procedure's date
//     adj        = adjustments (their own date) less insurance
//                  write-offs (the date insurance paid)
//     net        = production + adj
//
//   This is od-production v6's proven arithmetic - the one matched
//   to OpenDental's Annual Production and Income report to the
//   penny - regrouped by month for the year. Maria's "-Adj" row is
//   write-offs and adjustments together, and so is this one.
//   Because write-offs sit on the payment date, a past month keeps
//   moving as insurance pays. That is OpenDental's own behaviour.
//
//   Collection, by department, and split patient / insurance.
//   Patient money is paysplits on DatePay; insurance money is
//   claimproc.InsPayAmt on DateCP, Status 1 and 4. Same reads as
//   od-production, grouped by month.
//
//   Exams. Completed exam procedures, the same six codes the
//   hygiene and production dashboards count, classed for the
//   sheet's rows: new (D0150, D0180 - the comprehensives), recall
//   (D0120, C0130 - the periodics), other (D0140, D0170 - limited
//   and re-evaluation).
//
//   Hygiene visits. Distinct (day, patient) pairs with completed
//   work by a provider whose specialty reads Hygienist. One person
//   in the chair twice in a day is one visit.
//
//   Patients seen, and the next-hygiene ratio. Seen is distinct
//   patients with completed work in the month. A seen patient
//   counts as "has next hyg" when any appointment of theirs -
//   scheduled or since completed - sits after the month's end with
//   a hygienist attached (appointment.ProvHyg). Read live, so a
//   past month's ratio reflects the book as it stands today, not
//   as it stood then.
//
//   Provider blocks. Per provider per month: days worked (distinct
//   dates with completed work), patients, exams, diagnosed
//   treatment (DateTP in the month, planned still or completed
//   since, by count and fee), and net production. Prod-per-day and
//   per-exam are the screen's division to do.
//
//   Aging, current snapshot only. The sheet keeps a bucket history;
//   OpenDental keeps balances only as they stand now, so this
//   read reports today and does not pretend to a history.
//   Patient-side buckets come off the patient table's own aging
//   columns (guarantor rows, so families count once). The insurance
//   side is outstanding sent claims aged by DateSent, fee less what
//   insurance has paid.
//
// What is NOT here, deliberately: office goals, Itero scans,
// prime/non-prime hygiene slots, ortho starts and consults,
// membership counts, review counts, schedule notes. OpenDental does
// not hold them. They stay manual until DOS grows a place to key
// them in.
//
// Required secrets:
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
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

const APT_SCHEDULED = 1;
const APT_COMPLETE = 2;
const PROC_COMPLETE = 2;

// ProcFee times its units, floored at 1: a row with no units still
// charged its fee.
const fee = (pl: string) =>
  `(${pl}.ProcFee * GREATEST(${pl}.UnitQty + ${pl}.BaseUnits, 1))`;

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
  const response = await fetch(`${OD_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = text.slice(0, 500);
  }

  return { method, url: path, http_status: response.status, body: parsed };
}

function rowsOf(call: OdCall): Record<string, unknown>[] {
  return Array.isArray(call.body) ? (call.body as Record<string, unknown>[]) : [];
}

// ShortQuery hands back the first 100 rows at offset 0, and then
// everything from the offset onward. A result over 100 rows takes
// exactly 2 calls; walking it in hundreds re-asks for the same rows.
async function shortQueryAll(
  auth: string,
  sql: string,
): Promise<{ rows: Record<string, unknown>[]; failed: OdCall | null }> {
  const first = await odFetch(auth, "PUT", "/queries/ShortQuery", { SqlCommand: sql });

  if (first.http_status < 200 || first.http_status >= 300) {
    return { rows: [], failed: first };
  }

  const rows = rowsOf(first);
  if (rows.length < 100) return { rows, failed: null };

  const rest = await odFetch(auth, "PUT", "/queries/ShortQuery?Offset=100", {
    SqlCommand: sql,
  });

  if (rest.http_status < 200 || rest.http_status >= 300) {
    return { rows, failed: rest };
  }

  return { rows: [...rows, ...rowsOf(rest)], failed: null };
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// The sheet's departments, in the sheet's order. A provider's
// specialty name is folded into one of these; no specialty on file
// reads as general practice rather than being invented into one.
const BUCKETS = [
  "GP", "Hyg", "Ortho", "OS", "Perio", "Endo", "Pedo", "Other",
] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketOf(specialty: string): Bucket {
  const s = specialty.toLowerCase();
  if (s === "" || s.startsWith("general")) return "GP";
  if (s.includes("hygien")) return "Hyg";
  if (s.includes("ortho")) return "Ortho";
  if (s.includes("oral") || s.includes("surg")) return "OS";
  if (s.includes("perio")) return "Perio";
  if (s.includes("endo")) return "Endo";
  if (s.includes("pedo") || s.includes("pedia")) return "Pedo";
  return "Other";
}

// The same exam codes the hygiene and production dashboards count,
// classed for the sheet's New / Recall rows.
const EXAM_CLASS: Record<string, "new" | "recall" | "other"> = {
  D0150: "new",
  D0180: "new",
  D0120: "recall",
  C0130: "recall",
  D0140: "other",
  D0170: "other",
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
    year?: number;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const action = (body.action ?? "").toLowerCase().trim();
  if (action !== "year") {
    return json({ ok: false, error: "action must be year." }, 400);
  }

  const year = num(body.year);
  if (year < 2000 || year > 2100) {
    return json({ ok: false, error: "Give a year." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();

  if (officeId === "" && officeSlug === "") {
    return json({ ok: false, error: "Provide office_id or office." }, 400);
  }

  // ---- Office, through RLS. No role here means no row. ----
  const officeQuery = supabase
    .from("offices")
    .select("id, slug, name, opendental_customer_key_name, is_active");

  const { data: officeRow, error: officeError } = officeId !== ""
    ? await officeQuery.eq("id", officeId).maybeSingle()
    : await officeQuery.eq("slug", officeSlug).maybeSingle();

  if (officeError) {
    return json({ ok: false, error: `Office lookup failed: ${officeError.message}` }, 500);
  }

  if (!officeRow || officeRow.is_active !== true) {
    return json({
      ok: false,
      error: "That office was not found, is inactive, or you have no role there.",
    }, 403);
  }

  const secretName = officeRow.opendental_customer_key_name ?? "";
  if (!ALLOWED_SECRET_NAMES.has(secretName)) {
    return json({ ok: false, error: "This office has no recognized OpenDental key." }, 500);
  }

  const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
  const customerKey = Deno.env.get(secretName);
  if (!developerKey || !customerKey) {
    return json({ ok: false, error: "Missing Edge Function secrets." }, 500);
  }

  const auth = `ODFHIR ${developerKey}/${customerKey}`;

  const first = `${year}-01-01`;
  const afterLast = `${year + 1}-01-01`;

  const fail = (message: string, call: OdCall | null) =>
    json({ ok: false, office: officeRow.slug, error: message, detail: call?.body }, 502);

  // ---- Who the providers are, and what their specialty means ----
  const names = await shortQueryAll(
    auth,
    `SELECT ProvNum, Abbr, FName, LName, Suffix, Specialty FROM provider`,
  );
  if (names.failed) return fail("Could not read this office's providers.", names.failed);

  const specs = await shortQueryAll(
    auth,
    `SELECT DefNum, ItemName FROM definition WHERE Category = 35`,
  );
  if (specs.failed) {
    return fail("Could not read this office's provider specialties.", specs.failed);
  }

  const specNameOf = new Map<number, string>();
  for (const r of specs.rows) {
    specNameOf.set(num(r.DefNum), String(r.ItemName ?? "").trim());
  }

  // "C. Duong DDS": Suffix when filled in, RDH for a hygienist
  // without one, no credential otherwise.
  const provInfo = new Map<number, { name: string; specialty: string; bucket: Bucket }>();
  const hygProvNums: number[] = [];
  for (const r of names.rows) {
    const provNum = num(r.ProvNum);
    const abbr = String(r.Abbr ?? "").trim();
    const fname = String(r.FName ?? "").trim();
    const lname = String(r.LName ?? "").trim();
    const suffix = String(r.Suffix ?? "").trim();
    const specialty = specNameOf.get(num(r.Specialty)) ?? "";
    const bucket = bucketOf(specialty);
    const credential = suffix !== ""
      ? suffix
      : bucket === "Hyg"
      ? "RDH"
      : "";
    const base = fname === "" ? lname : `${fname[0]}. ${lname}`;
    const display = `${base} ${credential}`.trim();
    provInfo.set(provNum, {
      name: display !== "" ? display : abbr || "—",
      specialty,
      bucket,
    });
    if (bucket === "Hyg") hygProvNums.push(provNum);
  }

  const bucketOfProv = (provNum: number): Bucket =>
    provInfo.get(provNum)?.bucket ?? "GP";

  // ---- The year's money, one query per part, grouped by month ----

  // Gross completed fees, with the provider's worked days and
  // distinct patients riding along for the provider blocks.
  const gross = await shortQueryAll(
    auth,
    `SELECT MONTH(pl.ProcDate) AS M, pl.ProvNum AS P, ` +
      `SUM(${fee("pl")}) AS Amt, ` +
      `COUNT(DISTINCT pl.ProcDate) AS Days, ` +
      `COUNT(DISTINCT pl.PatNum) AS Pats ` +
      `FROM procedurelog pl ` +
      `WHERE pl.ProcStatus = ${PROC_COMPLETE} ` +
      `AND pl.ProcDate >= '${first}' AND pl.ProcDate < '${afterLast}' ` +
      `GROUP BY MONTH(pl.ProcDate), pl.ProvNum`,
  );
  if (gross.failed) return fail("Could not read the year's completed work.", gross.failed);

  // Capitation write-offs, on the procedure's date.
  const cap = await shortQueryAll(
    auth,
    `SELECT MONTH(pl.ProcDate) AS M, pl.ProvNum AS P, SUM(cp.WriteOff) AS Amt ` +
      `FROM claimproc cp JOIN procedurelog pl ON pl.ProcNum = cp.ProcNum ` +
      `WHERE cp.Status = 7 AND cp.WriteOff != 0 ` +
      `AND pl.ProcStatus = ${PROC_COMPLETE} ` +
      `AND pl.ProcDate >= '${first}' AND pl.ProcDate < '${afterLast}' ` +
      `GROUP BY MONTH(pl.ProcDate), pl.ProvNum`,
  );
  if (cap.failed) return fail("Could not read the year's capitation write-offs.", cap.failed);

  // Adjustments, on their own date and their own provider.
  const adj = await shortQueryAll(
    auth,
    `SELECT MONTH(a.AdjDate) AS M, a.ProvNum AS P, SUM(a.AdjAmt) AS Amt ` +
      `FROM adjustment a ` +
      `WHERE a.AdjDate >= '${first}' AND a.AdjDate < '${afterLast}' ` +
      `AND a.AdjAmt != 0 ` +
      `GROUP BY MONTH(a.AdjDate), a.ProvNum`,
  );
  if (adj.failed) return fail("Could not read the year's adjustments.", adj.failed);

  // Insurance write-offs, on the date insurance paid.
  const wo = await shortQueryAll(
    auth,
    `SELECT MONTH(cp.DateCP) AS M, cp.ProvNum AS P, SUM(cp.WriteOff) AS Amt ` +
      `FROM claimproc cp ` +
      `WHERE cp.Status IN (1, 4) AND cp.WriteOff != 0 ` +
      `AND cp.DateCP >= '${first}' AND cp.DateCP < '${afterLast}' ` +
      `GROUP BY MONTH(cp.DateCP), cp.ProvNum`,
  );
  if (wo.failed) return fail("Could not read the year's write-offs.", wo.failed);

  // Patient money in, on the day it landed.
  const ptColl = await shortQueryAll(
    auth,
    `SELECT MONTH(ps.DatePay) AS M, ps.ProvNum AS P, SUM(ps.SplitAmt) AS Amt ` +
      `FROM paysplit ps ` +
      `WHERE ps.DatePay >= '${first}' AND ps.DatePay < '${afterLast}' ` +
      `AND ps.SplitAmt != 0 ` +
      `GROUP BY MONTH(ps.DatePay), ps.ProvNum`,
  );
  if (ptColl.failed) return fail("Could not read the year's patient collections.", ptColl.failed);

  // Insurance money in, on the day insurance paid.
  const insColl = await shortQueryAll(
    auth,
    `SELECT MONTH(cp.DateCP) AS M, cp.ProvNum AS P, SUM(cp.InsPayAmt) AS Amt ` +
      `FROM claimproc cp ` +
      `WHERE cp.Status IN (1, 4) AND cp.InsPayAmt != 0 ` +
      `AND cp.DateCP >= '${first}' AND cp.DateCP < '${afterLast}' ` +
      `GROUP BY MONTH(cp.DateCP), cp.ProvNum`,
  );
  if (insColl.failed) return fail("Could not read the year's insurance collections.", insColl.failed);

  // ---- Exams, by month, provider and code ----
  const examIn = Object.keys(EXAM_CLASS).map((c) => `'${c}'`).join(",");
  const exams = await shortQueryAll(
    auth,
    `SELECT MONTH(pl.ProcDate) AS M, pl.ProvNum AS P, pc.ProcCode AS C, ` +
      `COUNT(*) AS N ` +
      `FROM procedurelog pl JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum ` +
      `WHERE pl.ProcStatus = ${PROC_COMPLETE} ` +
      `AND pl.ProcDate >= '${first}' AND pl.ProcDate < '${afterLast}' ` +
      `AND pc.ProcCode IN (${examIn}) ` +
      `GROUP BY MONTH(pl.ProcDate), pl.ProvNum, pc.ProcCode`,
  );
  if (exams.failed) return fail("Could not read the year's exams.", exams.failed);

  // ---- Diagnosed treatment, by the month it was planned ----
  const dx = await shortQueryAll(
    auth,
    `SELECT MONTH(pl.DateTP) AS M, pl.ProvNum AS P, ` +
      `COUNT(*) AS N, SUM(${fee("pl")}) AS Amt ` +
      `FROM procedurelog pl ` +
      `WHERE pl.ProcStatus IN (1, ${PROC_COMPLETE}) ` +
      `AND pl.DateTP >= '${first}' AND pl.DateTP < '${afterLast}' ` +
      `GROUP BY MONTH(pl.DateTP), pl.ProvNum`,
  );
  if (dx.failed) return fail("Could not read the year's diagnosed treatment.", dx.failed);

  // ---- Hygiene visits: distinct (day, patient) under a hygienist ----
  const hygIn = hygProvNums.length > 0 ? hygProvNums.join(",") : "-1";
  const hygVisits = await shortQueryAll(
    auth,
    `SELECT MONTH(pl.ProcDate) AS M, ` +
      `COUNT(DISTINCT CONCAT(pl.ProcDate, ':', pl.PatNum)) AS N ` +
      `FROM procedurelog pl ` +
      `WHERE pl.ProcStatus = ${PROC_COMPLETE} ` +
      `AND pl.ProvNum IN (${hygIn}) ` +
      `AND pl.ProcDate >= '${first}' AND pl.ProcDate < '${afterLast}' ` +
      `GROUP BY MONTH(pl.ProcDate)`,
  );
  if (hygVisits.failed) return fail("Could not read the year's hygiene visits.", hygVisits.failed);

  // ---- Patients seen per month, and their next hygiene visit ----
  //
  // Two flat reads folded here, because a correlated EXISTS across
  // procedurelog and appointment is the kind of query ShortQuery
  // times out on. Seen is every (month, patient) with completed
  // work. The book read is each patient's latest appointment date
  // with a hygienist attached, this year or later; a seen patient
  // has their next hygiene visit when that date sits past the
  // month's end.
  const seen = await shortQueryAll(
    auth,
    `SELECT DISTINCT MONTH(pl.ProcDate) AS M, pl.PatNum AS P ` +
      `FROM procedurelog pl ` +
      `WHERE pl.ProcStatus = ${PROC_COMPLETE} ` +
      `AND pl.ProcDate >= '${first}' AND pl.ProcDate < '${afterLast}'`,
  );
  if (seen.failed) return fail("Could not read the year's patients seen.", seen.failed);

  const nextHyg = await shortQueryAll(
    auth,
    `SELECT a.PatNum AS P, MAX(DATE(a.AptDateTime)) AS D ` +
      `FROM appointment a ` +
      `WHERE a.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
      `AND a.AptDateTime >= '${first}' ` +
      `AND (a.ProvHyg > 0 OR a.ProvNum IN (${hygIn})) ` +
      `GROUP BY a.PatNum`,
  );
  if (nextHyg.failed) return fail("Could not read the hygiene book.", nextHyg.failed);

  // ---- Aging, as it stands today ----
  //
  // Guarantor rows only, so a family counts once; the patient
  // table's aging columns are family balances on the guarantor.
  const ptAging = await shortQueryAll(
    auth,
    `SELECT SUM(p.Bal_0_30) AS B0, SUM(p.Bal_31_60) AS B1, ` +
      `SUM(p.Bal_61_90) AS B2, SUM(p.BalOver90) AS B3, ` +
      `SUM(p.InsEst) AS IE ` +
      `FROM patient p WHERE p.PatNum = p.Guarantor`,
  );
  if (ptAging.failed) return fail("Could not read patient aging.", ptAging.failed);

  // Outstanding sent claims aged by the day they were sent, fee
  // less what insurance has paid on them so far.
  const insAging = await shortQueryAll(
    auth,
    `SELECT ` +
      `SUM(CASE WHEN DATEDIFF(CURDATE(), c.DateSent) < 30 ` +
      `THEN c.ClaimFee - c.InsPayAmt ELSE 0 END) AS B0, ` +
      `SUM(CASE WHEN DATEDIFF(CURDATE(), c.DateSent) >= 30 ` +
      `AND DATEDIFF(CURDATE(), c.DateSent) < 60 ` +
      `THEN c.ClaimFee - c.InsPayAmt ELSE 0 END) AS B1, ` +
      `SUM(CASE WHEN DATEDIFF(CURDATE(), c.DateSent) >= 60 ` +
      `AND DATEDIFF(CURDATE(), c.DateSent) < 90 ` +
      `THEN c.ClaimFee - c.InsPayAmt ELSE 0 END) AS B2, ` +
      `SUM(CASE WHEN DATEDIFF(CURDATE(), c.DateSent) >= 90 ` +
      `THEN c.ClaimFee - c.InsPayAmt ELSE 0 END) AS B3 ` +
      `FROM claim c WHERE c.ClaimStatus = 'S'`,
  );
  if (insAging.failed) return fail("Could not read insurance aging.", insAging.failed);

  // ================== Fold it all into the sheet's shape ==================

  type MoneyCell = { production: number; adj: number };
  const emptyBuckets = <T>(make: () => T): Record<Bucket, T> => {
    const o = {} as Record<Bucket, T>;
    for (const b of BUCKETS) o[b] = make();
    return o;
  };

  type MonthFold = {
    prod: Record<Bucket, MoneyCell>;
    coll: Record<Bucket, number>;
    patient_coll: number;
    ins_coll: number;
    exams: { new: number; recall: number; other: number };
    hyg_visits: number;
    patients_seen: number;
    with_next_hyg: number;
  };

  const months: MonthFold[] = Array.from({ length: 12 }, () => ({
    prod: emptyBuckets(() => ({ production: 0, adj: 0 })),
    coll: emptyBuckets(() => 0),
    patient_coll: 0,
    ins_coll: 0,
    exams: { new: 0, recall: 0, other: 0 },
    hyg_visits: 0,
    patients_seen: 0,
    with_next_hyg: 0,
  }));

  const monthAt = (m: number): MonthFold | null =>
    m >= 1 && m <= 12 ? months[m - 1] : null;

  // Per-provider months for the provider blocks.
  type ProvMonth = {
    days: number;
    patients: number;
    exams: number;
    dx_count: number;
    dx_fees: number;
    production: number;
  };
  const provMonths = new Map<number, ProvMonth[]>();
  const provMonthAt = (provNum: number, m: number): ProvMonth | null => {
    if (m < 1 || m > 12) return null;
    let arr = provMonths.get(provNum);
    if (!arr) {
      arr = Array.from({ length: 12 }, () => ({
        days: 0, patients: 0, exams: 0, dx_count: 0, dx_fees: 0, production: 0,
      }));
      provMonths.set(provNum, arr);
    }
    return arr[m - 1];
  };

  for (const r of gross.rows) {
    const mo = monthAt(num(r.M));
    const pm = provMonthAt(num(r.P), num(r.M));
    if (!mo || !pm) continue;
    const amt = num(r.Amt);
    mo.prod[bucketOfProv(num(r.P))].production += amt;
    pm.production += amt;
    pm.days = num(r.Days);
    pm.patients = num(r.Pats);
  }

  for (const r of cap.rows) {
    const mo = monthAt(num(r.M));
    const pm = provMonthAt(num(r.P), num(r.M));
    if (!mo || !pm) continue;
    mo.prod[bucketOfProv(num(r.P))].production -= num(r.Amt);
    pm.production -= num(r.Amt);
  }

  for (const r of adj.rows) {
    const mo = monthAt(num(r.M));
    const pm = provMonthAt(num(r.P), num(r.M));
    if (!mo || !pm) continue;
    mo.prod[bucketOfProv(num(r.P))].adj += num(r.Amt);
    pm.production += num(r.Amt);
  }

  for (const r of wo.rows) {
    const mo = monthAt(num(r.M));
    const pm = provMonthAt(num(r.P), num(r.M));
    if (!mo || !pm) continue;
    mo.prod[bucketOfProv(num(r.P))].adj -= num(r.Amt);
    pm.production -= num(r.Amt);
  }

  for (const r of ptColl.rows) {
    const mo = monthAt(num(r.M));
    if (!mo) continue;
    mo.coll[bucketOfProv(num(r.P))] += num(r.Amt);
    mo.patient_coll += num(r.Amt);
  }

  for (const r of insColl.rows) {
    const mo = monthAt(num(r.M));
    if (!mo) continue;
    mo.coll[bucketOfProv(num(r.P))] += num(r.Amt);
    mo.ins_coll += num(r.Amt);
  }

  for (const r of exams.rows) {
    const mo = monthAt(num(r.M));
    const pm = provMonthAt(num(r.P), num(r.M));
    if (!mo || !pm) continue;
    const cls = EXAM_CLASS[String(r.C ?? "").trim()] ?? "other";
    mo.exams[cls] += num(r.N);
    pm.exams += num(r.N);
  }

  for (const r of dx.rows) {
    const pm = provMonthAt(num(r.P), num(r.M));
    if (!pm) continue;
    pm.dx_count += num(r.N);
    pm.dx_fees += num(r.Amt);
  }

  for (const r of hygVisits.rows) {
    const mo = monthAt(num(r.M));
    if (mo) mo.hyg_visits = num(r.N);
  }

  // Latest hygiene-attached appointment per patient, then each seen
  // (month, patient) checks whether it sits past the month's end.
  const lastHygOf = new Map<number, string>();
  for (const r of nextHyg.rows) {
    lastHygOf.set(num(r.P), String(r.D ?? ""));
  }

  const endOfMonth = (m: number) =>
    `${year}-${String(m).padStart(2, "0")}-31`;

  for (const r of seen.rows) {
    const m = num(r.M);
    const mo = monthAt(m);
    if (!mo) continue;
    mo.patients_seen += 1;
    const last = lastHygOf.get(num(r.P)) ?? "";
    // A lexicographic compare is a date compare in YYYY-MM-DD, and
    // day 31 caps every month, so "past the month" reads clean.
    if (last > endOfMonth(m)) mo.with_next_hyg += 1;
  }

  // ---- Shape the response ----
  const monthsOut = months.map((mo, i) => {
    const prod: Record<string, { production: number; adj: number; net: number }> = {};
    let net_total = 0;
    for (const b of BUCKETS) {
      const cell = mo.prod[b];
      const net = cell.production + cell.adj;
      net_total += net;
      prod[b] = {
        production: round2(cell.production),
        adj: round2(cell.adj),
        net: round2(net),
      };
    }

    const coll: Record<string, number> = {};
    let coll_total = 0;
    for (const b of BUCKETS) {
      coll[b] = round2(mo.coll[b]);
      coll_total += mo.coll[b];
    }

    return {
      month: i + 1,
      prod,
      net_total: round2(net_total),
      coll,
      coll_total: round2(coll_total),
      patient_coll: round2(mo.patient_coll),
      ins_coll: round2(mo.ins_coll),
      exams: {
        ...mo.exams,
        total: mo.exams.new + mo.exams.recall + mo.exams.other,
      },
      hyg_visits: mo.hyg_visits,
      patients_seen: mo.patients_seen,
      with_next_hyg: mo.with_next_hyg,
    };
  });

  const providersOut = [...provMonths.entries()]
    .map(([provNum, arr]) => {
      const info = provInfo.get(provNum);
      return {
        prov_num: provNum,
        name: info?.name ?? "—",
        specialty: info?.specialty ?? "",
        bucket: info?.bucket ?? "GP",
        total_production: round2(arr.reduce((s, m) => s + m.production, 0)),
        months: arr.map((m) => ({
          days: m.days,
          patients: m.patients,
          exams: m.exams,
          dx_count: m.dx_count,
          dx_fees: round2(m.dx_fees),
          production: round2(m.production),
        })),
      };
    })
    .sort((a, b) => b.total_production - a.total_production);

  const pa = ptAging.rows[0] ?? {};
  const ia = insAging.rows[0] ?? {};

  return json({
    ok: true,
    office: officeRow.slug,
    office_name: officeRow.name,
    year,
    months: monthsOut,
    providers: providersOut,
    aging: {
      as_of: new Date().toISOString().slice(0, 10),
      patient: {
        b0_30: round2(num(pa.B0)),
        b31_60: round2(num(pa.B1)),
        b61_90: round2(num(pa.B2)),
        over90: round2(num(pa.B3)),
        ins_est: round2(num(pa.IE)),
      },
      insurance: {
        b0_30: round2(num(ia.B0)),
        b31_60: round2(num(ia.B1)),
        b61_90: round2(num(ia.B2)),
        over90: round2(num(ia.B3)),
      },
    },
    read_at: new Date().toISOString(),
  });
});
