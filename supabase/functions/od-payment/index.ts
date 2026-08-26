// =====================================================================
// Dental OS - Edge Function: od-payment
//
// Recording a payment the treatment coordinator has already taken on
// the Clover terminal, from the tablet she is already holding, without
// walking the patient to the front desk.
//
// This function does not move money. The card is run on Clover. All
// this does is write the ledger entry into OpenDental afterwards and
// stamp the presenter's name into the note, so payments can later be
// totalled by the person who presented.
//
// Deploy path: supabase/functions/od-payment/index.ts
// Version: 1
//
// Actions:
//   { "office":"downey", "action":"tenders" }
//   { "office":"downey", "action":"create", "pat_num":17,
//     "amount":25.00, "tender":"Credit Card",
//     "presenter":"Maria Lopez", "terminal_ref":"A1B2C3",
//     "note":"paid at chair" }
//
// ---------------------------------------------------------------------
// Changelog
//
//   v1  First build.
//
//       tenders is a read-only list of that office's own payment
//       types. The spec asked for create alone, but the tender has to
//       be resolved by name at runtime rather than by number, and the
//       screen cannot offer a name it has not been told. Reading the
//       office's own list means the names on screen are that office's
//       names, so the lookup afterwards cannot miss.
//
//       Nothing is written to Supabase. This function reads the office
//       row for its OpenDental key and touches nothing else.
//
// ---------------------------------------------------------------------
// Notes on OpenDental
//
//   payment.PayType is a definition number in Category 10. The two
//   offices number their definitions independently, so the number is
//   never carried across offices and never hard-coded here. It is
//   looked up by the name the coordinator picked, in that office's own
//   list, on every call.
//
//   POST /payments is sent without ClinicNum so the payment inherits
//   the patient's own clinic. Splits are not created here: OpenDental
//   allocates them itself according to that office's settings.
//
//   HTTP 200 is not proof. Every create is followed by a read of the
//   stored row, and the stored values are what this returns.
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

// definition.Category 10 is Payment Types. Same category number at both
// offices; the DefNums inside it are not.
const CATEGORY_PAYMENT_TYPE = 10;

// How close together two identical payments have to be before the
// second one is read as a retried tap rather than a second payment.
const DOUBLE_POST_SECONDS = 120;

// The first line of every note this function writes. Fixed, plain
// ASCII, no punctuation beyond the colon, so a report can match it.
const PRESENTER_PREFIX = "Dental OS Presenter: ";
const TERMINAL_PREFIX = "Terminal ref: ";

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

// ShortQuery caps a page at 100 rows and Offset advances from there.
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

const cents = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

// This office's payment types, in the order the office reads them.
// Hidden entries are left out: hiding one is how an office retires it.
async function tenderList(
  auth: string,
): Promise<{ list: { def_num: number; label: string }[]; failed: OdCall | null }> {
  const { rows, failed } = await shortQueryAll(
    auth,
    `SELECT DefNum, ItemName, ItemOrder FROM definition ` +
      `WHERE Category = ${CATEGORY_PAYMENT_TYPE} AND IsHidden = 0 ORDER BY ItemOrder`,
  );

  const list = rows
    .map((r) => ({
      def_num: Number(r.DefNum ?? 0),
      label: String(r.ItemName ?? "").trim(),
    }))
    .filter((d) => d.def_num > 0 && d.label !== "");

  return { list, failed };
}

// A single line of a note. Newlines are stripped so the first line
// stays the first line whatever was typed into a name field upstream.
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

// MySQL 5.5 has no JSON and no parameter binding here, so anything that
// reaches a query is either a number or is quoted and escaped.
function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

// OpenDental hands datetimes back as "2026-08-26 00:12:31". Treating
// that as UTC would be wrong, so it is compared against nothing but
// itself: the server's own clock, read in the same query.
function secondsBetween(a: string, b: string): number | null {
  const parse = (s: string): number | null => {
    const m = s.trim().match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
    );
    if (!m) return null;
    return Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ) / 1000;
  };

  const first = parse(a);
  const second = parse(b);
  if (first === null || second === null) return null;
  return Math.abs(first - second);
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
    amount?: number;
    tender?: string;
    presenter?: string;
    terminal_ref?: string;
    note?: string;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const action = (body.action ?? "").toLowerCase().trim();

  const ACTIONS = ["tenders", "create"];

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
  const officeName = String(officeRow.name ?? officeRow.slug ?? "this office");

  // ===================================================================
  // tenders — the payment types this office offers
  // ===================================================================
  if (action === "tenders") {
    const { list, failed } = await tenderList(auth);

    if (failed) {
      return json({
        ok: false,
        error: "OpenDental could not read this office's payment types.",
        detail: failed.body,
      }, 502);
    }

    return json({ ok: true, office: officeRow.slug, tenders: list });
  }

  // ===================================================================
  // create — record a payment already taken on the terminal
  // ===================================================================
  const patNum = body.pat_num;
  if (typeof patNum !== "number" || !Number.isInteger(patNum) || patNum <= 0) {
    return json({ ok: false, error: "pat_num is required." }, 400);
  }

  const amountCents = cents(body.amount);
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || amountCents <= 0) {
    return json({ ok: false, error: "amount must be greater than zero." }, 400);
  }
  const amount = amountCents / 100;

  const presenter = oneLine(String(body.presenter ?? ""));
  if (presenter === "") {
    return json({
      ok: false,
      error: "A presenter has to be chosen before a payment can be recorded.",
    }, 400);
  }

  const tender = oneLine(String(body.tender ?? ""));
  if (tender === "") {
    return json({ ok: false, error: "A tender type is required." }, 400);
  }

  const terminalRef = oneLine(String(body.terminal_ref ?? ""));
  const typed = String(body.note ?? "").replace(/\r\n/g, "\n").trim();

  // ---- The patient, so a wrong number cannot become a payment ----
  const patient = await odFetch(auth, "GET", `/patients/${patNum}`);

  if (patient.http_status === 404) {
    return json({
      ok: false,
      error: `Patient ${patNum} was not found at ${officeName}.`,
    }, 404);
  }

  if (patient.http_status < 200 || patient.http_status >= 300) {
    return json({
      ok: false,
      error: "OpenDental could not read that patient.",
      detail: patient.body,
    }, 502);
  }

  const patientBody = (patient.body ?? {}) as Record<string, unknown>;
  const patientName = oneLine(
    `${patientBody.FName ?? ""} ${patientBody.LName ?? ""}`,
  );

  // ---- Step 1: the payment type, by name, in this office's list ----
  const { list: tenders, failed: tenderFailed } = await tenderList(auth);

  if (tenderFailed) {
    return json({
      ok: false,
      error: "OpenDental could not read this office's payment types.",
      detail: tenderFailed.body,
    }, 502);
  }

  const matched = tenders.find(
    (t) => t.label.toLowerCase() === tender.toLowerCase(),
  );

  if (!matched) {
    return json({
      ok: false,
      error: `${officeName} has no payment type called "${tender}".`,
      tenders_available: tenders.map((t) => t.label),
    }, 400);
  }

  const payType = matched.def_num;

  // ---- Step 2: has this same payment just been recorded? ----
  //
  // Real money. A tap that was retried because the tablet looked stuck
  // must not become 2 payments. Anything on this patient for the same
  // amount within the last couple of minutes is treated as the payment
  // that is already there, and is handed straight back.
  const guard = await shortQueryAll(
    auth,
    `SELECT PayNum, PayAmt, PayType, PayNote, PayDate, SecDateTEdit, NOW() AS ServerNow ` +
      `FROM payment WHERE PatNum = ${patNum} ` +
      `AND PayDate >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) ` +
      `ORDER BY PayNum DESC`,
  );

  if (guard.failed) {
    // Creating without the guard would risk a second charge on the
    // ledger, so this stops rather than guessing.
    return json({
      ok: false,
      error: "OpenDental could not be checked for a payment already recorded, so nothing was created.",
      detail: guard.failed.body,
    }, 502);
  }

  for (const row of guard.rows) {
    if (cents(row.PayAmt) !== amountCents) continue;

    const age = secondsBetween(
      String(row.SecDateTEdit ?? ""),
      String(row.ServerNow ?? ""),
    );

    // A row whose timestamp cannot be read is still treated as a
    // possible retry. On money, refusing a second post is the safer
    // way to be wrong, and the response says which payment it found.
    if (age === null || age <= DOUBLE_POST_SECONDS) {
      return json({
        ok: true,
        already_recorded: true,
        pay_num: Number(row.PayNum ?? 0),
        pat_num: patNum,
        patient_name: patientName,
        amount: cents(row.PayAmt) / 100,
        pay_type: Number(row.PayType ?? 0),
        note: String(row.PayNote ?? ""),
        timing: age === null
          ? "That payment's timestamp could not be read, so it was treated as the same one."
          : `Recorded ${age} seconds ago.`,
        message: "This payment was already recorded. Nothing new was created.",
      });
    }
  }

  // ---- Step 3: the note ----
  const noteLines = [PRESENTER_PREFIX + presenter];
  if (terminalRef !== "") noteLines.push(TERMINAL_PREFIX + terminalRef);
  if (typed !== "") noteLines.push("", typed);
  const note = noteLines.join("\n");

  // ---- Step 4: create it ----
  //
  // No ClinicNum, so the payment inherits the patient's own. No
  // splits: OpenDental allocates those itself.
  const created = await odFetch(auth, "POST", "/payments", {
    PatNum: patNum,
    PayAmt: amount,
    PayType: payType,
    PayNote: note,
  });

  if (created.http_status < 200 || created.http_status >= 300) {
    return json({
      ok: false,
      error: "OpenDental would not accept that payment. Nothing was recorded.",
      detail: created.body,
    }, 502);
  }

  const createdBody = (created.body ?? {}) as Record<string, unknown>;
  const payNum = Number(createdBody.PayNum ?? 0);

  if (payNum <= 0) {
    return json({
      ok: false,
      error: "OpenDental accepted the payment but did not return its number, so it could not be checked. Look at the patient's account before trying again.",
      detail: created.body,
    }, 502);
  }

  // ---- Step 5: read it back. This is the only answer that counts ----
  const check = await shortQueryAll(
    auth,
    `SELECT p.PayNum, p.PayAmt, p.PayType, p.PayNote, p.PayDate, ` +
      `d.ItemName AS PayTypeName, ` +
      `(SELECT COUNT(*) FROM paysplit s WHERE s.PayNum = p.PayNum) AS SplitCount ` +
      `FROM payment p ` +
      `LEFT JOIN definition d ON d.DefNum = p.PayType ` +
      `WHERE p.PayNum = ${payNum}`,
  );

  if (check.failed) {
    return json({
      ok: false,
      pay_num: payNum,
      error: "The payment was created but could not be read back, so it is unconfirmed. Check the patient's account in OpenDental.",
      detail: check.failed.body,
    }, 502);
  }

  const stored = (check.rows[0] ?? {}) as Record<string, unknown>;

  if (Object.keys(stored).length === 0) {
    return json({
      ok: false,
      pay_num: payNum,
      error: "OpenDental returned a payment number but no payment was found at it. Check the patient's account in OpenDental.",
    }, 502);
  }

  const storedAmount = cents(stored.PayAmt);
  const storedType = Number(stored.PayType ?? 0);
  const storedNote = String(stored.PayNote ?? "");

  const mismatches: {
    field: string;
    requested: unknown;
    stored: unknown;
  }[] = [];

  if (storedAmount !== amountCents) {
    mismatches.push({ field: "PayAmt", requested: amount, stored: storedAmount / 100 });
  }
  if (storedType !== payType) {
    mismatches.push({
      field: "PayType",
      requested: `${matched.label} (${payType})`,
      stored: `${String(stored.PayTypeName ?? "").trim()} (${storedType})`,
    });
  }
  if (storedNote !== note) {
    mismatches.push({ field: "PayNote", requested: note, stored: storedNote });
  }

  const honoured = mismatches.length === 0;

  return json({
    ok: honoured,
    pay_num: payNum,
    pat_num: patNum,
    patient_name: patientName,
    office: officeRow.slug,
    amount: storedAmount / 100,
    tender: String(stored.PayTypeName ?? "").trim(),
    pay_type: storedType,
    presenter,
    note: storedNote,
    pay_date: String(stored.PayDate ?? ""),
    splits: Number(stored.SplitCount ?? 0),
    // False means OpenDental took the call and kept its own values.
    // The screen shows what is stored, never what was asked for.
    honoured,
    mismatches: honoured ? undefined : mismatches,
    error: honoured
      ? undefined
      : "OpenDental recorded the payment but did not keep every value it was given.",
    recorded_by: userData.user.email,
    recorded_at: new Date().toISOString(),
  });
});
