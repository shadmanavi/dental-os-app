// =====================================================================
// Dental OS - Edge Function: od-chart
//
// The server side of the chairside charting screen. Everything the
// tablet does goes through here, so the OpenDental keys never leave
// Supabase and no PHI is written to the Dental OS database.
//
// Deploy path: supabase/functions/od-chart/index.ts
// Version: 5
// Changelog:
//   v1  patients / open / commit / undo, built on what od-chart-probe
//       established against the live Downey database.
//   v2  The existing bucket wrote ProcStatus 'EC' and OpenDental refused
//       it: "ProcStatus may only be set to Treatment Planned (TP),
//       Complete (C), or Existing Other Provider (EO)." Probing settled
//       that EC cannot be reached at all through this API — POST rejects
//       it, and so does a PUT on a row already created at EO. Only TP, C
//       and EO are writable.
//
//       The existing bucket therefore commits at EO. This is a knowing
//       compromise: EC means the work was done at this practice, EO means
//       another provider did it, and the API only offers the latter.
//       Revisit if OpenDental opens EC to writes.
//
//       Also: DELETE on a procedure at EO returned 400, so undo does not
//       work on existing entries. The response now says so rather than
//       failing silently.
//   v3  Adds "schedule", the Today tab on the patient picker. A clinician
//       picks from the day's appointments instead of typing a surname.
//
//       Three probe runs decided how this is built:
//
//       - GET /appointments?date= returns the whole day and every row
//         carries PatNum, but no row carries a patient name. Rendering
//         the tab off REST needs one extra call per appointment.
//       - Those extra calls cannot be hidden behind concurrency. Thirty-
//         one of them fired at once took 6661ms, with the slowest single
//         call at 6659ms: OpenDental served them one after another.
//       - One PUT /queries/ShortQuery joining appointment to patient and
//         operatory returned the same 32 rows, with names and operatory
//         names on every one, in 305ms. Row parity was confirmed against
//         both the REST count and a COUNT(*).
//
//       So this action is a single joined read-only SELECT. Thirty-three
//       calls become one, and the screen opens in roughly a third of the
//       time. The endpoint rejects anything that is not read-only with a
//       401, so the statement cannot mutate anything.
//
//       Four things the raw table exposes that REST did not:
//
//       - AptStatus is an integer, not a word. 1 = Scheduled and
//         5 = Broken are confirmed against live data. The rest of the
//         enum is carried here but flagged unverified.
//       - DateTimeArrived / Seated / Dismissed are populated, so checked
//         in, in the chair, and dismissed are derived rather than
//         fetched. An unset one reads as midnight, not null.
//       - IsHygiene and IsHidden come back as 0/1 integers where REST
//         returned strings.
//       - Confirmed is a DefNum, not text. Resolving it needs a join on
//         definition, which this version does not do.
//   v4  Migration 010 moved the tile tree from the office up to the
//       organization, so this file had to move with it. The old query
//       filtered chart_categories on office_id, which no longer exists.
//
//       Greenwood does mostly the same dentistry at both sites; what
//       differs is which procedures each one offers. So there is now one
//       tree, and each tile carries the offices it is available at
//       through chart_tile_offices. This action reads the tree for the
//       organization and filters the tiles to the office being worked
//       in — the clinician sees no difference, but an edit is made once
//       rather than twice.
//
//       Two tile behaviours arrive with it, both found in the six-month
//       procedure survey rather than assumed:
//
//       - Paired tiles. A crown is two procedures. D2751d appeared 136
//         times at Downey beside D2751: the prep is billed at the first
//         visit and the delivery at the seat. Both lines are created at
//         diagnosis, so a tile with a delivery_code posts twice.
//
//         The delivery line posts at zero. Splitting the base fee is
//         parked, because the fee lookup found Denti-Cal running as a
//         flat-copay plan and uninsured patients carrying no fee
//         schedule at all — neither divides cleanly. Whether OpenDental
//         honours a zero has not been established, so the delivery line
//         is read back and the fee it actually stored is returned. If
//         OpenDental overrides it, the response will say so rather than
//         the number being quietly wrong.
//
//       - Add-ons. Selecting a PFM crown brings porcelain margins with
//         it, already checked. The negotiation with the patient is
//         subtraction: decline the cost and the clinician unchecks it.
//         Each add-on still checked at commit posts as its own
//         procedure line, confirmed with Shad.
//
//       Because one tap can now write several lines, commit returns a
//       lines array. The old top-level fields still describe the base
//       line, so a caller that has not been updated keeps working.
//
//       Nothing here writes a fee for a base procedure. That rule is
//       unchanged: OpenDental prices its own work.
//   v5  Two things the office asked for after using v4.
//
//       - Search by date of birth or patient number, not only surname.
//         Greenwood has several thousand patients and surnames repeat;
//         the day's schedule already showed two different Mendozas and
//         two Chavezes. A single box still takes all three: anything
//         that is only digits is read as a patient number, anything
//         that parses as a date is read as a birthdate, and everything
//         else is a surname. A surname and a birthdate together narrow
//         further, which is what OpenDental's own documentation
//         recommends for identifying a patient.
//
//       - Providers by name rather than initials. The schedule returned
//         ProvNum and nothing else, so the screen could only show
//         "GP - YK". The schedule query now joins the provider table
//         for both the dentist and the hygienist, and the patient load
//         already carried full names. Initials are still returned
//         alongside, because that is what the office uses on paper.
//
// What the probe settled, and why this file looks the way it does:
//
//   - POST /procedurelogs wants procCode (the CDT string). CodeNum is a
//     GET filter only, and sending it returns "procCode is required."
//   - ProcFee is omitted deliberately. OpenDental priced a D2391 at
//     210.00 on its own. Greenwood prices through five different
//     mechanisms — patient fee schedule, insurance plan, Blue Book,
//     discount plan, provider default — and reimplementing that chain
//     here would drift from OpenDental within a month.
//   - ProvNum is sent only when the caller picked one. Omitted, OpenDental
//     falls back to the patient's primary provider, which is what the
//     office wants by default.
//   - ProcStatus EC cannot be written. Existing entries go in at EO. See
//     the v2 changelog above.
//   - A missing tooth is not a procedure. It is a toothinitial row with
//     InitialType 'Missing'. Missing and Hidden are independent flags; one
//     tooth was observed carrying both.
//   - GET /providers pages, and the pages overlap. Reading one page misses
//     providers; reading pages without deduplicating counts them twice.
//
// Required secrets (already set for the other od-* functions):
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
//
// Call:
//   POST /functions/v1/od-chart
//   Authorization: Bearer <user access token>
//
//   { "office":"downey", "action":"schedule" }
//     Optional: "date":"2026-08-13" (defaults to today)
//     Optional: "include_hidden_ops":true (default false)
//   { "office":"downey", "action":"patients", "query":"smi" }
//     Optional: "birthdate":"1984-07-02"
//     Optional: "pat_num":5969
//     A bare query is read as a patient number if it is all digits, a
//     birthdate if it parses as one, and a surname otherwise.
//   { "office":"downey", "action":"open", "pat_num":17 }
//   { "office":"downey", "action":"commit", "pat_num":17,
//     "tile_id":"<uuid>", "tooth_num":"30", "surfaces":["M","O"],
//     "addon_ids":["<uuid>"], "prov_num":2118, "dry_run":true }
//   { "office":"downey", "action":"undo", "entry_kind":"procedure",
//     "od_id":1081426 }
//
// PHI note: patient names and procedures pass through this function to
// the browser. Nothing patient-identifying is written to Supabase.
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------
// Tooth classification
//
// Universal numbering. Anterior is 6-11 and 22-27, confirmed with Shad.
// Bicuspids are 4, 5, 12, 13, 20, 21, 28, 29. Everything else that is a
// real tooth number is a molar.
// ---------------------------------------------------------------------
const ANTERIOR = new Set([6, 7, 8, 9, 10, 11, 22, 23, 24, 25, 26, 27]);
const BICUSPID = new Set([4, 5, 12, 13, 20, 21, 28, 29]);

type ToothClass = "anterior" | "bicuspid" | "molar";

function toothClass(toothNum: string): ToothClass | null {
  const n = Number(toothNum);
  if (!Number.isInteger(n) || n < 1 || n > 32) return null;
  if (ANTERIOR.has(n)) return "anterior";
  if (BICUSPID.has(n)) return "bicuspid";
  return "molar";
}

function isAnterior(toothNum: string): boolean {
  return toothClass(toothNum) === "anterior";
}

// ---------------------------------------------------------------------
// Appointment status
//
// The REST endpoint returns words; the underlying column is an integer.
// Only 1 and 5 have been seen on live Downey data and matched against
// the REST wording, so only those two are marked verified. The rest come
// from OpenDental's published enum and are flagged unverified, so the
// screen can tell "known" apart from "assumed".
// ---------------------------------------------------------------------
const APT_STATUS: Record<number, { label: string; verified: boolean }> = {
  1: { label: "Scheduled", verified: true },
  2: { label: "Complete", verified: false },
  3: { label: "UnschedList", verified: false },
  4: { label: "ASAP", verified: false },
  5: { label: "Broken", verified: true },
  6: { label: "Planned", verified: false },
  7: { label: "PtNote", verified: false },
  8: { label: "PtNoteCompleted", verified: false },
};

// An unset datetime comes back as midnight on the appointment's own day,
// not null. Anything at exactly 00:00:00 means it never happened.
function isSetTimestamp(value: unknown): boolean {
  const s = String(value ?? "");
  if (s === "") return false;
  if (s.endsWith("T00:00:00") || s.endsWith(" 00:00:00")) return false;
  return true;
}

// Pattern is one character per five minutes: X is provider time, / is
// assistant time. Its length is the whole appointment.
function durationMinutes(pattern: unknown): number {
  const s = String(pattern ?? "");
  return s.length * 5;
}

// Where the patient is right now, derived rather than stored. Checked in
// reverse order so the latest event wins.
function presenceOf(row: Record<string, unknown>): string {
  if (isSetTimestamp(row.DateTimeDismissed)) return "dismissed";
  if (isSetTimestamp(row.DateTimeSeated)) return "in_chair";
  if (isSetTimestamp(row.DateTimeArrived)) return "checked_in";
  return "not_arrived";
}

// "Kaur, Yasmin, DDS" from three columns that may each be empty. An
// empty string is returned rather than a placeholder, so the screen can
// fall back to initials rather than printing something meaningless.
function providerName(first: unknown, last: unknown, suffix: unknown): string {
  const f = String(first ?? "").trim();
  const l = String(last ?? "").trim();
  const s = String(suffix ?? "").trim();

  if (l === "" && f === "") return "";

  const name = l === "" ? f : f === "" ? l : `${l}, ${f}`;
  return s === "" ? name : `${name}, ${s}`;
}

// A birthdate typed in a hurry. Accepts the ISO form OpenDental wants
// and the American form the office writes, and refuses anything else
// rather than guessing — a wrong date silently returns the wrong
// patient, which is worse than saying no.
function toIsoBirthdate(raw: string): string | null {
  const value = raw.trim();

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const us = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

function timeOnly(value: unknown): string {
  const s = String(value ?? "");
  const t = s.includes("T") ? s.split("T")[1] : (s.split(" ")[1] ?? "");
  return t.slice(0, 5);
}

// ---------------------------------------------------------------------
// OpenDental transport
// ---------------------------------------------------------------------
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

// GET /providers caps a page at 100 and the pages overlap, so key on
// ProvNum and stop when a page contributes nothing new.
async function fetchAllProviders(
  auth: string,
): Promise<Record<string, unknown>[]> {
  const byProvNum = new Map<number, Record<string, unknown>>();
  const PAGE = 100;

  for (let page = 0; page < 20; page++) {
    const offset = page * PAGE;
    const call = await odFetch(
      auth,
      "GET",
      offset === 0 ? "/providers" : `/providers?Offset=${offset}`,
    );

    if (!Array.isArray(call.body)) break;
    const rows = call.body as Record<string, unknown>[];
    if (rows.length === 0) break;

    let added = 0;
    for (const row of rows) {
      const provNum = typeof row.ProvNum === "number" ? row.ProvNum : null;
      if (provNum === null || byProvNum.has(provNum)) continue;
      byProvNum.set(provNum, row);
      added++;
    }

    if (added === 0) break;
  }

  return [...byProvNum.values()];
}

// ---------------------------------------------------------------------
// Code resolution
//
// A tile does not hold a single code. Composite splits anterior from
// posterior and then by surface count; a root canal splits by tooth
// class. The rule shapes are documented in migration 009.
// ---------------------------------------------------------------------
type CodeRule = {
  type?: string;
  code?: string;
  all?: string[];
  anterior?: string[] | string;
  posterior?: string[] | string;
  bicuspid?: string;
  molar?: string;
};

type Resolved =
  | { ok: true; procCode: string; why: string }
  | { ok: false; error: string };

function resolveCode(
  rule: CodeRule | null,
  toothNum: string,
  surfaceCount: number,
): Resolved {
  if (rule === null || typeof rule !== "object") {
    return { ok: false, error: "This tile has no code rule." };
  }

  if (rule.type === "fixed") {
    if (typeof rule.code !== "string" || rule.code === "") {
      return { ok: false, error: "Fixed rule is missing its code." };
    }
    return { ok: true, procCode: rule.code, why: "fixed code" };
  }

  if (rule.type === "surface_count") {
    if (surfaceCount < 1) {
      return { ok: false, error: "Pick at least one surface." };
    }

    // Four entries cover 1, 2, 3, and 4-or-more surfaces.
    const index = Math.min(surfaceCount, 4) - 1;

    let series: string[] | undefined;
    let why: string;

    if (Array.isArray(rule.all)) {
      series = rule.all;
      why = `${surfaceCount} surface${surfaceCount === 1 ? "" : "s"}`;
    } else if (toothNum === "") {
      return { ok: false, error: "Pick a tooth first." };
    } else if (isAnterior(toothNum)) {
      series = Array.isArray(rule.anterior) ? rule.anterior : undefined;
      why = `anterior, ${surfaceCount} surface${surfaceCount === 1 ? "" : "s"}`;
    } else {
      series = Array.isArray(rule.posterior) ? rule.posterior : undefined;
      why = `posterior, ${surfaceCount} surface${surfaceCount === 1 ? "" : "s"}`;
    }

    const code = series?.[index];
    if (typeof code !== "string" || code === "") {
      return { ok: false, error: "No code for that surface count." };
    }

    return { ok: true, procCode: code, why };
  }

  if (rule.type === "tooth_class") {
    if (toothNum === "") return { ok: false, error: "Pick a tooth first." };

    const klass = toothClass(toothNum);
    if (klass === null) {
      return { ok: false, error: `Tooth ${toothNum} is not 1-32.` };
    }

    const code = rule[klass];
    if (typeof code !== "string" || code === "") {
      return { ok: false, error: `No code set for a ${klass} tooth.` };
    }

    return { ok: true, procCode: code, why: klass };
  }

  return { ok: false, error: `Unknown code rule type: ${rule.type}.` };
}

// Surface order OpenDental expects, so MO and OM both store as MO.
const SURFACE_ORDER = ["M", "O", "I", "D", "B", "F", "L", "V"];

function normalizeSurfaces(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    const s = String(raw).trim().toUpperCase();
    if (SURFACE_ORDER.includes(s)) seen.add(s);
  }
  return SURFACE_ORDER.filter((s) => seen.has(s));
}

// =====================================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }

  // -------------------------------------------------------------------
  // Authenticate
  // -------------------------------------------------------------------
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

  // -------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------
  let body: {
    office_id?: string;
    office?: string;
    action?: string;
    dry_run?: boolean;
    query?: string;
    birthdate?: string;
    pat_num?: number;
    tile_id?: string;
    tooth_num?: string;
    surfaces?: unknown;
    addon_ids?: unknown;
    prov_num?: number;
    entry_kind?: string;
    od_id?: number;
    date?: string;
    include_hidden_ops?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const action = (body.action ?? "").toLowerCase().trim();

  const ACTIONS = ["schedule", "patients", "open", "commit", "undo"];
  if (!ACTIONS.includes(action)) {
    return json({
      ok: false,
      error: `action must be one of: ${ACTIONS.join(", ")}.`,
    }, 400);
  }

  if (officeId === "" && officeSlug === "") {
    return json({ ok: false, error: "Provide office_id or office." }, 400);
  }

  // -------------------------------------------------------------------
  // Office, through RLS. A user with no role here gets no row.
  // -------------------------------------------------------------------
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

  // ===================================================================
  // schedule — one day's appointments, for the Today tab
  //
  // A single joined SELECT. Placed before the pat_num actions because it
  // deliberately does not take one.
  // ===================================================================
  if (action === "schedule") {
    const requested = (body.date ?? "").trim();
    const day = requested !== ""
      ? requested
      : new Date().toISOString().slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return json({ ok: false, error: "date must be YYYY-MM-DD." }, 400);
    }

    const next = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(next.getTime())) {
      return json({ ok: false, error: "That is not a real date." }, 400);
    }

    const dayStart = `${day} 00:00:00`;
    next.setUTCDate(next.getUTCDate() + 1);
    const dayEnd = `${next.toISOString().slice(0, 10)} 00:00:00`;

    const select =
      `SELECT a.AptNum, a.PatNum, a.AptDateTime, a.AptStatus, a.Pattern, a.Op, ` +
      `a.ProvNum, a.ProvHyg, a.IsHygiene, a.ProcDescript, ` +
      `a.DateTimeArrived, a.DateTimeSeated, a.DateTimeDismissed, ` +
      `p.LName, p.FName, p.Preferred, o.OpName, o.Abbrev, o.IsHidden, ` +
      // The dentist and the hygienist are two different columns on the
      // appointment, so the provider table is joined twice.
      `dr.Abbr AS DrAbbr, dr.LName AS DrLName, dr.FName AS DrFName, ` +
      `dr.Suffix AS DrSuffix, ` +
      `hy.Abbr AS HygAbbr, hy.LName AS HygLName, hy.FName AS HygFName ` +
      `FROM appointment a ` +
      `LEFT JOIN patient p ON p.PatNum = a.PatNum ` +
      `LEFT JOIN operatory o ON o.OperatoryNum = a.Op ` +
      `LEFT JOIN provider dr ON dr.ProvNum = a.ProvNum ` +
      `LEFT JOIN provider hy ON hy.ProvNum = a.ProvHyg ` +
      `WHERE a.AptDateTime >= '${dayStart}' AND a.AptDateTime < '${dayEnd}' ` +
      `ORDER BY a.AptDateTime, a.Op`;

    // ShortQuery caps a page at 100 rows, and Offset was confirmed to
    // advance rather than being ignored. Walk until a short page lands.
    const PAGE = 100;
    const rows: Record<string, unknown>[] = [];

    for (let page = 0; page < 30; page++) {
      const offset = page * PAGE;
      const call = await odFetch(
        auth,
        "PUT",
        offset === 0
          ? "/queries/ShortQuery"
          : `/queries/ShortQuery?Offset=${offset}`,
        { SqlCommand: select },
      );

      if (call.http_status < 200 || call.http_status >= 300) {
        return json({
          ok: false,
          error: "OpenDental could not read that day's schedule.",
          detail: call.body,
        }, 502);
      }

      if (!Array.isArray(call.body)) break;
      const batch = call.body as Record<string, unknown>[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }

    const appointments = rows.map((r) => {
      const statusNum = Number(r.AptStatus ?? -1);
      const status = APT_STATUS[statusNum] ??
        { label: `Status ${statusNum}`, verified: false };

      const last = String(r.LName ?? "").trim();
      const first = String(r.FName ?? "").trim();
      const preferred = String(r.Preferred ?? "").trim();
      const patNum = Number(r.PatNum ?? 0);

      return {
        apt_num: Number(r.AptNum ?? 0),
        pat_num: patNum,
        time: timeOnly(r.AptDateTime),
        apt_datetime: String(r.AptDateTime ?? ""),
        duration_minutes: durationMinutes(r.Pattern),
        status: status.label,
        status_num: statusNum,
        status_verified: status.verified,
        // Broken is the one status confirmed unopenable. Everything else
        // stays live rather than being greyed on an assumption.
        openable: statusNum !== 5 && patNum > 0,
        presence: presenceOf(r),
        operatory_num: Number(r.Op ?? 0),
        operatory_name: String(r.OpName ?? "").trim(),
        operatory_abbr: String(r.Abbrev ?? "").trim(),
        operatory_hidden: Number(r.IsHidden ?? 0) === 1,
        prov_num: Number(r.ProvNum ?? 0),
        prov_abbr: String(r.DrAbbr ?? "").trim(),
        // "Dr. Kaur" rather than "GP - YK". Initials are kept alongside
        // because that is what the office writes on paper.
        prov_name: providerName(r.DrFName, r.DrLName, r.DrSuffix),
        prov_hyg: Number(r.ProvHyg ?? 0),
        hyg_abbr: String(r.HygAbbr ?? "").trim(),
        hyg_name: providerName(r.HygFName, r.HygLName, ""),
        is_hygiene: Number(r.IsHygiene ?? 0) === 1,
        procedures: String(r.ProcDescript ?? "").trim(),
        last_name: last,
        first_name: first,
        preferred_name: preferred,
        display_name: last === "" && first === ""
          ? `Patient ${patNum}`
          : `${last}, ${first}`.replace(/,\s*$/, ""),
      };
    });

    const visible = body.include_hidden_ops === true
      ? appointments
      : appointments.filter((a) => !a.operatory_hidden);

    // Chips for the operatories actually carrying appointments today,
    // rather than all 55 rows of the operatory table.
    const opSeen = new Map<
      number,
      { num: number; name: string; abbr: string; count: number }
    >();

    for (const a of visible) {
      const existing = opSeen.get(a.operatory_num);
      if (existing) {
        existing.count++;
      } else {
        opSeen.set(a.operatory_num, {
          num: a.operatory_num,
          name: a.operatory_name,
          abbr: a.operatory_abbr,
          count: 1,
        });
      }
    }

    return json({
      ok: true,
      office: officeRow.name,
      office_slug: officeRow.slug,
      date: day,
      total_count: visible.length,
      broken_count: visible.filter((a) => a.status_num === 5).length,
      operatories: [...opSeen.values()].sort((a, b) => a.num - b.num),
      appointments: visible,
    });
  }

  // ===================================================================
  // patients — find someone to chart on
  // ===================================================================
  if (action === "patients") {
    const rawQuery = (body.query ?? "").trim();
    const givenBirthdate = (body.birthdate ?? "").trim();
    const givenPatNum = typeof body.pat_num === "number" && body.pat_num > 0
      ? body.pat_num
      : null;

    // One box, three kinds of answer. The office types whatever they
    // have in front of them rather than choosing a field first.
    let lastName = rawQuery;
    let birthdate = givenBirthdate;
    let patNumLookup = givenPatNum;

    if (givenPatNum === null && /^\d{1,9}$/.test(rawQuery)) {
      patNumLookup = Number(rawQuery);
      lastName = "";
    } else if (givenBirthdate === "" && rawQuery !== "") {
      const iso = toIsoBirthdate(rawQuery);
      if (iso !== null) {
        birthdate = iso;
        lastName = "";
      }
    }

    // ---- By patient number: one record, fetched directly ----
    if (patNumLookup !== null) {
      const call = await odFetch(auth, "GET", `/patients/${patNumLookup}`);

      // A number nobody uses is a normal outcome of typing, not a
      // server problem, so it comes back as an empty result.
      if (call.http_status === 404) {
        return json({
          ok: true,
          office: officeRow.name,
          searched_by: "patient number",
          count: 0,
          patients: [],
        });
      }

      if (call.http_status < 200 || call.http_status >= 300) {
        return json({
          ok: false,
          error: "OpenDental could not look up that patient number.",
          detail: call.body,
        }, 502);
      }

      const p = (call.body ?? {}) as Record<string, unknown>;

      return json({
        ok: true,
        office: officeRow.name,
        searched_by: "patient number",
        count: 1,
        patients: [{
          PatNum: p.PatNum ?? null,
          LName: p.LName ?? "",
          FName: p.FName ?? "",
          Preferred: p.Preferred ?? "",
          Birthdate: p.Birthdate ?? "",
          PatStatus: p.PatStatus ?? "",
          ChartNumber: p.ChartNumber ?? "",
        }],
      });
    }

    // ---- By surname, birthdate, or both ----
    if (lastName === "" && birthdate === "") {
      return json({
        ok: false,
        error: "Type a surname, a date of birth, or a patient number.",
      }, 400);
    }

    if (lastName !== "" && lastName.length < 2 && birthdate === "") {
      return json({ ok: false, error: "Type at least two letters." }, 400);
    }

    // Patients GET Simple is the fast path; the full search endpoint runs
    // Patient Select logic and is slow on a database this size.
    const params: string[] = ["hideInactive=true"];
    if (lastName !== "") params.push(`LName=${encodeURIComponent(lastName)}`);
    if (birthdate !== "") params.push(`Birthdate=${encodeURIComponent(birthdate)}`);

    const call = await odFetch(
      auth,
      "GET",
      `/patients/Simple?${params.join("&")}`,
    );

    if (call.http_status < 200 || call.http_status >= 300) {
      return json({
        ok: false,
        error: "OpenDental could not run that search.",
        detail: call.body,
      }, 502);
    }

    const rows = Array.isArray(call.body)
      ? (call.body as Record<string, unknown>[])
      : [];

    const searchedBy = lastName !== "" && birthdate !== ""
      ? "surname and date of birth"
      : birthdate !== ""
        ? "date of birth"
        : "surname";

    return json({
      ok: true,
      office: officeRow.name,
      searched_by: searchedBy,
      count: rows.length,
      patients: rows.slice(0, 40).map((p) => ({
        PatNum: p.PatNum ?? null,
        LName: p.LName ?? "",
        FName: p.FName ?? "",
        Preferred: p.Preferred ?? "",
        Birthdate: p.Birthdate ?? "",
        PatStatus: p.PatStatus ?? "",
        ChartNumber: p.ChartNumber ?? "",
      })),
    });
  }

  // ===================================================================
  // open — everything the screen needs for one patient
  // ===================================================================
  const patNum = body.pat_num;

  if (action === "open") {
    if (typeof patNum !== "number" || patNum <= 0) {
      return json({ ok: false, error: "pat_num is required." }, 400);
    }

    const today = new Date().toISOString().slice(0, 10);

    const [patient, procs, initials, appts, providers] = await Promise.all([
      odFetch(auth, "GET", `/patients/${patNum}`),
      odFetch(auth, "GET", `/procedurelogs?PatNum=${patNum}`),
      odFetch(auth, "GET", `/toothinitials?PatNum=${patNum}`),
      odFetch(auth, "GET", `/appointments?PatNum=${patNum}&date=${today}`),
      fetchAllProviders(auth),
    ]);

    if (patient.http_status < 200 || patient.http_status >= 300) {
      return json({
        ok: false,
        error: "OpenDental could not load that patient.",
        detail: patient.body,
      }, 502);
    }

    const p = (patient.body ?? {}) as Record<string, unknown>;

    // Chart-relevant procedures only. A completed or planned filling
    // matters on the chart; a cancelled one does not.
    const CHART_STATUSES = new Set(["TP", "C", "EC", "EO", "Cn"]);

    const procRows = Array.isArray(procs.body)
      ? (procs.body as Record<string, unknown>[])
      : [];

    const procedures = procRows
      .filter((r) => CHART_STATUSES.has(String(r.ProcStatus ?? "")))
      .map((r) => ({
        ProcNum: r.ProcNum ?? null,
        ProcStatus: r.ProcStatus ?? "",
        ProcDate: r.ProcDate ?? "",
        ToothNum: String(r.ToothNum ?? ""),
        Surf: r.Surf ?? "",
        procCode: r.procCode ?? "",
        descript: r.descript ?? "",
        ProcFee: r.ProcFee ?? null,
        ProvNum: r.ProvNum ?? null,
        provAbbr: r.provAbbr ?? "",
      }));

    const initialRows = Array.isArray(initials.body)
      ? (initials.body as Record<string, unknown>[])
      : [];

    // Missing and Hidden are independent flags. One tooth was seen
    // carrying both, so these are two lists rather than one state.
    const missingTeeth = initialRows
      .filter((r) => String(r.InitialType ?? "") === "Missing")
      .map((r) => String(r.ToothNum ?? ""));

    const hiddenTeeth = initialRows
      .filter((r) => String(r.InitialType ?? "") === "Hidden")
      .map((r) => String(r.ToothNum ?? ""));

    const apptRows = Array.isArray(appts.body)
      ? (appts.body as Record<string, unknown>[])
      : [];

    const liveAppt = apptRows.find((a) =>
      String(a.AptStatus ?? "") === "Scheduled" ||
      String(a.AptStatus ?? "") === "Complete"
    ) ?? null;

    // The provider on today's appointment first; the patient's primary
    // provider otherwise. Greenwood keeps schedules but asked not to lean
    // on them, so the appointment is the signal, not the schedule.
    const apptProv = liveAppt && typeof liveAppt.ProvNum === "number" &&
        liveAppt.ProvNum !== 0
      ? liveAppt.ProvNum
      : null;

    const resolvedProvider = apptProv !== null
      ? {
        source: "appointment",
        ProvNum: apptProv,
        provAbbr: String(liveAppt?.provAbbr ?? ""),
      }
      : {
        source: "patient primary provider",
        ProvNum: (p.PriProv as number) ?? null,
        provAbbr: String(p.priProvAbbr ?? ""),
      };

    const visibleProviders = providers
      .filter((prov) => String(prov.IsHidden ?? "false") !== "true")
      .map((prov) => ({
        ProvNum: prov.ProvNum ?? null,
        Abbr: String(prov.Abbr ?? ""),
        LName: String(prov.LName ?? ""),
        FName: String(prov.FName ?? ""),
        Suffix: String(prov.Suffix ?? ""),
      }))
      .sort((a, b) => a.Abbr.localeCompare(b.Abbr));

    // Tiles come from our own tables, read as the caller so RLS applies.
    //
    // The tree belongs to the organization; chart_tile_offices decides
    // which of its tiles this particular office offers. The !inner on
    // that join is what does the filtering — a tile with no row for this
    // office drops out rather than arriving and being hidden later.
    const { data: categories, error: catError } = await supabase
      .from("chart_categories")
      .select(
        "id, bucket, label, sort_order, " +
          "chart_tiles (id, label, entry_kind, initial_type, needs_surfaces, " +
          "treat_area, delivery_code, code_rule, sort_order, is_active, " +
          "chart_tile_offices!inner (office_id), " +
          "chart_tile_addons (id, label, proc_code, is_default_on, sort_order, is_active))",
      )
      .eq("organization_id", officeRow.organization_id)
      .eq("is_active", true)
      .eq("chart_tiles.chart_tile_offices.office_id", officeRow.id)
      .order("sort_order");

    if (catError) {
      return json({
        ok: false,
        error: `Could not load the chart tiles: ${catError.message}`,
      }, 500);
    }

    type CategoryRow = {
      id: string;
      bucket: string;
      label: string;
      sort_order: number;
      chart_tiles?: Record<string, unknown>[];
    };

    const menu = ((categories ?? []) as unknown as CategoryRow[]).map((c) => ({
      id: c.id,
      bucket: c.bucket,
      label: c.label,
      sort_order: c.sort_order,
      tiles: ((c.chart_tiles ?? []) as Record<string, unknown>[])
        .filter((t) => t.is_active !== false)
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((t) => ({
          id: t.id,
          label: t.label,
          entry_kind: t.entry_kind,
          initial_type: t.initial_type,
          needs_surfaces: t.needs_surfaces === true,
          // OpenDental's own classification of the code, carried through
          // so the screen knows whether to ask for a tooth, a surface, a
          // quadrant or nothing.
          treat_area: t.treat_area ?? null,
          // Present means this tile writes two lines, not one.
          delivery_code: t.delivery_code ?? null,
          is_paired: String(t.delivery_code ?? "") !== "",
          // Add-ons arrive with the tile, already in their default
          // state. The clinician removes rather than adds.
          addons: ((t.chart_tile_addons ?? []) as Record<string, unknown>[])
            .filter((a) => a.is_active !== false)
            .sort((a, b) =>
              Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
            )
            .map((a) => ({
              id: a.id,
              label: a.label,
              proc_code: a.proc_code,
              default_on: a.is_default_on === true,
            })),
        })),
    }));

    return json({
      ok: true,
      office: officeRow.name,
      office_slug: officeRow.slug,
      patient: {
        PatNum: p.PatNum ?? null,
        LName: p.LName ?? "",
        FName: p.FName ?? "",
        Preferred: p.Preferred ?? "",
        Birthdate: p.Birthdate ?? "",
        ChartNumber: p.ChartNumber ?? "",
        PriProv: p.PriProv ?? null,
        priProvAbbr: p.priProvAbbr ?? "",
      },
      resolved_provider: resolvedProvider,
      providers: visibleProviders,
      procedures,
      missing_teeth: missingTeeth,
      hidden_teeth: hiddenTeeth,
      menu,
    });
  }

  // ===================================================================
  // commit — write one entry to OpenDental
  // ===================================================================
  if (action === "commit") {
    if (typeof patNum !== "number" || patNum <= 0) {
      return json({ ok: false, error: "pat_num is required." }, 400);
    }

    const tileId = (body.tile_id ?? "").trim();
    if (tileId === "") {
      return json({ ok: false, error: "tile_id is required." }, 400);
    }

    const dryRun = body.dry_run === true;
    const toothNum = (body.tooth_num ?? "").trim();
    const surfaces = normalizeSurfaces(body.surfaces);

    // Read the tile through RLS, and confirm it belongs to this caller's
    // organization and is offered at this office, rather than trusting
    // the id the browser sent.
    const { data: tile, error: tileError } = await supabase
      .from("chart_tiles")
      .select(
        "id, label, entry_kind, initial_type, needs_surfaces, treat_area, " +
          "delivery_code, delivery_posts_at_zero, code_rule, is_active, " +
          "chart_categories!inner (id, bucket, label, organization_id, is_active), " +
          "chart_tile_offices (office_id), " +
          "chart_tile_addons (id, label, proc_code, is_default_on, is_active)",
      )
      .eq("id", tileId)
      .maybeSingle();

    if (tileError) {
      return json({ ok: false, error: `Tile lookup failed: ${tileError.message}` }, 500);
    }

    if (!tile) {
      return json({ ok: false, error: "That tile was not found." }, 404);
    }

    const category = tile.chart_categories as unknown as {
      bucket: string;
      label: string;
      organization_id: string;
      is_active: boolean;
    };

    if (category.organization_id !== officeRow.organization_id) {
      return json({ ok: false, error: "That tile belongs to another organization." }, 403);
    }

    // Availability is a property of the tile, so it is checked here as
    // well as filtered in the menu. The menu is a convenience; this is
    // the gate.
    const availableAt = ((tile.chart_tile_offices ?? []) as Record<string, unknown>[])
      .map((row) => String(row.office_id ?? ""));

    if (!availableAt.includes(officeRow.id)) {
      return json({
        ok: false,
        error: `${tile.label} is not offered at ${officeRow.name}.`,
      }, 403);
    }

    if (tile.is_active === false || category.is_active === false) {
      return json({ ok: false, error: "That tile is no longer active." }, 400);
    }

    // -----------------------------------------------------------------
    // Missing tooth — a toothinitial row, not a procedure
    // -----------------------------------------------------------------
    if (tile.entry_kind === "tooth_initial") {
      if (toothNum === "" || toothClass(toothNum) === null) {
        return json({ ok: false, error: "Pick a tooth first." }, 400);
      }

      const payload = {
        PatNum: patNum,
        ToothNum: toothNum,
        InitialType: tile.initial_type,
      };

      if (dryRun) {
        return json({
          ok: true,
          dry_run: true,
          entry_kind: "tooth_initial",
          tile: tile.label,
          would_post_to: `${OD_BASE_URL}/toothinitials`,
          would_post: payload,
        });
      }

      const created = await odFetch(auth, "POST", "/toothinitials", payload);

      if (created.http_status < 200 || created.http_status >= 300) {
        return json({
          ok: false,
          error: "OpenDental rejected that entry.",
          detail: created.body,
        }, 502);
      }

      const createdBody = (created.body ?? {}) as Record<string, unknown>;

      return json({
        ok: true,
        dry_run: false,
        entry_kind: "tooth_initial",
        tile: tile.label,
        od_id: createdBody.ToothInitialNum ?? null,
        tooth_num: toothNum,
        initial_type: tile.initial_type,
        undoable: true,
        committed_by: userData.user.email,
        committed_at: new Date().toISOString(),
      });
    }

    // -----------------------------------------------------------------
    // Procedure
    //
    // One tap can now write several lines: the base code, a delivery
    // code if the tile is paired, and one line per surviving add-on.
    // Each is posted separately, and the response lists them all.
    // -----------------------------------------------------------------
    if (tile.needs_surfaces === true && surfaces.length === 0) {
      return json({ ok: false, error: "Pick at least one surface." }, 400);
    }

    const resolved = resolveCode(
      tile.code_rule as CodeRule | null,
      toothNum,
      surfaces.length,
    );

    if (!resolved.ok) {
      return json({ ok: false, error: resolved.error }, 400);
    }

    // The bucket decides the status, and that is why existing and
    // diagnosed share one set of codes.
    //
    // EO rather than EC: OpenDental's API refuses EC on both POST and PUT.
    // EO overstates the case slightly — it implies another provider did
    // the work — but it is the only "already done" status this API will
    // accept alongside TP and C.
    const procStatus = category.bucket === "existing" ? "EO" : "TP";
    const procDate = new Date().toISOString().slice(0, 10);

    // Which add-ons survived. The browser sends the ones still checked;
    // anything not belonging to this tile, or switched off, is dropped
    // here rather than trusted.
    const requestedAddonIds = Array.isArray(body.addon_ids)
      ? (body.addon_ids as unknown[]).map((a) => String(a))
      : null;

    const tileAddons = ((tile.chart_tile_addons ?? []) as Record<string, unknown>[])
      .filter((a) => a.is_active !== false);

    // A caller that sends no addon_ids at all gets the defaults, so an
    // older client does not silently lose the add-ons a tile carries.
    const chosenAddons = requestedAddonIds === null
      ? tileAddons.filter((a) => a.is_default_on === true)
      : tileAddons.filter((a) => requestedAddonIds.includes(String(a.id)));

    // Every line this commit intends to write, base first.
    type PlannedLine = {
      role: "base" | "delivery" | "addon";
      label: string;
      proc_code: string;
      addon_id: string | null;
      payload: Record<string, unknown>;
    };

    function basePayload(procCode: string): Record<string, unknown> {
      const p: Record<string, unknown> = {
        PatNum: patNum,
        procCode,
        ProcStatus: procStatus,
        ProcDate: procDate,
      };

      if (toothNum !== "") p.ToothNum = toothNum;

      // Sent only when the user overrode it. Left out, OpenDental
      // assigns the patient's primary provider.
      if (typeof body.prov_num === "number" && body.prov_num > 0) {
        p.ProvNum = body.prov_num;
      }

      return p;
    }

    const planned: PlannedLine[] = [];

    // Base. Surfaces belong to this line only — a delivery code or an
    // add-on is not a surface restoration.
    const base = basePayload(resolved.procCode);
    if (surfaces.length > 0) base.Surf = surfaces.join("");

    planned.push({
      role: "base",
      label: tile.label,
      proc_code: resolved.procCode,
      addon_id: null,
      payload: base,
    });

    // Delivery. The second visit of a two-visit procedure, created now
    // so the treatment plan shows the whole job.
    const deliveryCode = String(tile.delivery_code ?? "").trim();
    const deliveryAtZero = tile.delivery_posts_at_zero !== false;

    if (deliveryCode !== "") {
      const delivery = basePayload(deliveryCode);

      // Zero is sent explicitly. This is the one place this function
      // states a fee, and it states zero rather than a price — the fee
      // split is parked, not implemented. Whether OpenDental honours it
      // is read back below rather than assumed.
      if (deliveryAtZero) delivery.ProcFee = 0;

      planned.push({
        role: "delivery",
        label: `${tile.label} — delivery`,
        proc_code: deliveryCode,
        addon_id: null,
        payload: delivery,
      });
    }

    // Add-ons. Priced by OpenDental like any other procedure.
    for (const addon of chosenAddons) {
      const code = String(addon.proc_code ?? "").trim();
      if (code === "") continue;

      planned.push({
        role: "addon",
        label: String(addon.label ?? code),
        proc_code: code,
        addon_id: String(addon.id ?? ""),
        payload: basePayload(code),
      });
    }

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        entry_kind: "procedure",
        tile: tile.label,
        bucket: category.bucket,
        resolved_code: resolved.procCode,
        resolved_because: resolved.why,
        would_post_to: `${OD_BASE_URL}/procedurelogs`,
        line_count: planned.length,
        would_post_lines: planned.map((l) => ({
          role: l.role,
          label: l.label,
          proc_code: l.proc_code,
          payload: l.payload,
        })),
        // Kept so a caller written against v3 still sees what it expects.
        would_post: planned[0].payload,
        note: deliveryCode !== ""
          ? "Base and add-on fees are omitted on purpose; OpenDental prices them. Only the delivery line carries a fee, and it is zero."
          : "ProcFee is omitted on purpose. OpenDental prices it.",
      });
    }

    // -----------------------------------------------------------------
    // Write them, in order, stopping at the first refusal.
    //
    // A partial commit is possible: the base can land and a later line
    // be refused. Rolling back would mean deleting a procedure, and
    // OpenDental has already been observed refusing to delete rows at
    // some statuses. So nothing is undone automatically — the response
    // reports exactly which lines exist, and the screen can offer undo
    // on the ones that are undoable.
    // -----------------------------------------------------------------
    type WrittenLine = {
      role: string;
      label: string;
      proc_code: string;
      addon_id: string | null;
      od_id: number | null;
      descript: string;
      tooth_num: string;
      surf: string;
      status: string;
      fee: unknown;
      prov_num: unknown;
      prov_abbr: string;
      undoable: boolean;
      fee_honoured: boolean | null;
    };

    const written: WrittenLine[] = [];
    let failure: { line: PlannedLine; detail: unknown } | null = null;

    for (const line of planned) {
      const created = await odFetch(auth, "POST", "/procedurelogs", line.payload);

      if (created.http_status < 200 || created.http_status >= 300) {
        failure = { line, detail: created.body };
        break;
      }

      const cb = (created.body ?? {}) as Record<string, unknown>;
      const procNum = typeof cb.ProcNum === "number" ? cb.ProcNum : null;

      // For the delivery line, the fee that came back is checked against
      // the zero that was sent. OpenDental prices procedures on its own
      // and may well overwrite it; if so, that shows up here instead of
      // being discovered later in a report.
      let feeHonoured: boolean | null = null;
      if (line.role === "delivery" && deliveryAtZero) {
        feeHonoured = Number(cb.ProcFee ?? -1) === 0;
      }

      written.push({
        role: line.role,
        label: line.label,
        proc_code: String(cb.procCode ?? line.proc_code),
        addon_id: line.addon_id,
        od_id: procNum,
        descript: String(cb.descript ?? ""),
        tooth_num: String(cb.ToothNum ?? toothNum),
        surf: String(cb.Surf ?? ""),
        status: String(cb.ProcStatus ?? procStatus),
        fee: cb.ProcFee ?? null,
        prov_num: cb.ProvNum ?? null,
        prov_abbr: String(cb.provAbbr ?? ""),
        // OpenDental would not delete a procedure sitting at EO during
        // testing, so the screen should not offer undo on those rows.
        undoable: procStatus !== "EO",
        fee_honoured: feeHonoured,
      });
    }

    if (failure !== null && written.length === 0) {
      return json({
        ok: false,
        error: "OpenDental rejected that procedure.",
        resolved_code: resolved.procCode,
        detail: failure.detail,
      }, 502);
    }

    const baseLine = written.find((l) => l.role === "base") ?? null;

    return json({
      ok: true,
      dry_run: false,
      entry_kind: "procedure",
      tile: tile.label,
      bucket: category.bucket,
      resolved_because: resolved.why,

      // Every line that reached OpenDental.
      line_count: written.length,
      lines: written,

      // A later line was refused after an earlier one landed. Nothing is
      // rolled back; the caller is told plainly what is missing.
      partial: failure !== null,
      partial_failure: failure === null ? null : {
        role: failure.line.role,
        label: failure.line.label,
        proc_code: failure.line.proc_code,
        detail: failure.detail,
      },

      // The base line, flat, so a caller written against v3 keeps working.
      od_id: baseLine?.od_id ?? null,
      proc_code: baseLine?.proc_code ?? resolved.procCode,
      descript: baseLine?.descript ?? "",
      tooth_num: baseLine?.tooth_num ?? toothNum,
      surf: baseLine?.surf ?? "",
      status: baseLine?.status ?? procStatus,
      undoable: baseLine?.undoable ?? false,
      fee: baseLine?.fee ?? null,
      prov_num: baseLine?.prov_num ?? null,
      prov_abbr: baseLine?.prov_abbr ?? "",

      committed_by: userData.user.email,
      committed_at: new Date().toISOString(),
    });
  }

  // ===================================================================
  // undo — remove an entry this session just created
  // ===================================================================
  const entryKind = (body.entry_kind ?? "procedure").toLowerCase().trim();
  const odId = body.od_id;

  if (typeof odId !== "number" || odId <= 0) {
    return json({ ok: false, error: "od_id is required to undo." }, 400);
  }

  if (entryKind !== "procedure" && entryKind !== "tooth_initial") {
    return json({
      ok: false,
      error: 'entry_kind must be "procedure" or "tooth_initial".',
    }, 400);
  }

  const path = entryKind === "procedure"
    ? `/procedurelogs/${odId}`
    : `/toothinitials/${odId}`;

  const deleted = await odFetch(auth, "DELETE", path);

  if (deleted.http_status < 200 || deleted.http_status >= 300) {
    return json({
      ok: false,
      error: "OpenDental would not remove that entry. Delete it in OpenDental.",
      detail: deleted.body,
    }, 502);
  }

  return json({
    ok: true,
    entry_kind: entryKind,
    od_id: odId,
    undone_by: userData.user.email,
    undone_at: new Date().toISOString(),
  });
});
