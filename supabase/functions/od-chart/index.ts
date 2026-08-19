// =====================================================================
// Dental OS - Edge Function: od-chart
//
// The server side of the chairside charting screen. Everything the
// tablet does goes through here, so the OpenDental keys never leave
// Supabase and no PHI is written to the Dental OS database.
//
// Deploy path: supabase/functions/od-chart/index.ts
// Version: 12
// Changelog:
//   v1  patients / open / commit / undo, built on what od-chart-probe
//       established against the live Downey database.
//   v2  OpenDental refused ProcStatus 'EC' on both POST and PUT, so the
//       existing bucket commits at EO. A knowing compromise: EC means
//       the work was done here, EO means another provider did it, and
//       the API only offers the latter. DELETE on a row at EO also
//       returned 400, so undo does not work on existing entries.
//   v3  Adds "schedule", the Today tab on the patient picker.
//
//       GET /appointments returns the whole day but no patient names,
//       and those extra calls cannot be hidden behind concurrency: 31
//       fired at once took 6661ms with the slowest single call at
//       6659ms, because OpenDental serves them one after another. One
//       joined ShortQuery returned the same 32 rows, names included, in
//       305ms.
//
//       AptStatus is an integer (1 Scheduled and 5 Broken confirmed);
//       the arrival, seating and dismissal timestamps are populated, so
//       presence is derived, and an unset one reads as midnight.
//   v4  Migration 010 moved the tile tree from the office up to the
//       organization. There is now one tree, and each tile carries the
//       offices it is available at. Paired tiles and add-ons arrive
//       with it, so commit returns a lines array.
//   v5  Search takes a date of birth or a patient number as well as a
//       surname. The schedule query joins the provider table, so rows
//       name the dentist or hygienist rather than showing initials.
//   v6  Unparks the fee split. Reading fee schedules 409 and 410
//       returned D2751 at $476 under Denti-Cal and $1,366 under the
//       Dental Masters Membership, with every delivery code at zero —
//       exactly the shape Shad described. A paired tile posts half on
//       each line, halved in whole cents with the remainder to the
//       base, so the two always add back. A missing fee row is not a
//       zero, so a paired tile whose base code has no row refuses to
//       commit and names the code.
//   v7  Adds "set_fee", so a fee can be corrected on the line itself
//       after it has been written. It sends ProcFee and nothing else,
//       and reads the row back rather than trusting the response.
//   v8  The search box takes a first name too: two words are read as
//       surname then first name, comma optional.
//   v9  Tried falling back to a first-name search only when the surname
//       search came back empty.
//   v10 v9's fallback was the wrong shape, and testing found it out.
//
//       Searching "shad" returned "Shadde, Roger" — LName matches on a
//       prefix, so the surname search was not empty and the first-name
//       retry never ran. Shad himself was not in the list. Making the
//       fallback conditional on an empty result only works if surnames
//       never share a prefix with first names, which is not a property
//       anyone can rely on.
//
//       A single word now searches both fields every time and merges
//       the results, deduplicated by PatNum. It costs one extra call on
//       single-word searches and cannot miss anyone regardless of who
//       else happens to match.
//   v11 The provider list leaves the patient open.
//
//       open read every provider in the practice on every patient. That
//       is fetchAllProviders, and it is not one call: /providers pages
//       at 100 with overlapping pages, so Downey's 284 providers cost
//       three or four round trips — and OpenDental serialises them, so
//       three round trips is three waits. Paid once per patient, for a
//       list that changes when somebody is hired.
//
//       It moves to a providers action the screen calls once when the
//       office is chosen. Still per office, because the two offices
//       have separate provider tables and separate ProvNums.
//
//       Nothing about the resolved provider changes, and it could not:
//       resolved_provider was never read from that list. It comes from
//       today's appointment's provAbbr, or the patient record's
//       priProvAbbr, both already inside the payload open was fetching
//       anyway. The patient's own provider is still read on open, per
//       patient, exactly as before.
//
//       open still returns a providers key, now empty, so a caller
//       built against v10 gets the shape it expects rather than
//       undefined.
//   v12 Region entry: whole mouth, quadrant and arch.
//
//       Half the work done at Downey does not belong to one tooth, and
//       until now this function had no way to record where it belongs.
//       Worse, it was silently wrong: a tile carried whatever ToothNum
//       the caller happened to send, so an exam charted with tooth 30
//       lit was written onto tooth 30, and scaling and root planing was
//       written onto a single tooth with no quadrant at all.
//
//       The tile's treat_area now decides the shape, and the shape
//       decides which fields are written. Verified against live Downey
//       data rather than assumed:
//
//         1, 2  tooth      ToothNum, Surf holds the surfaces
//         4     quadrant   Surf holds UR, UL, LR or LL. No ToothNum
//         6     arch       Surf holds U or L. No ToothNum
//         0, 3  mouth      neither field written
//         7     tooth range  refused for now, nothing writes ToothRange
//
//       A caller cannot override this. A tooth sent with a whole-mouth
//       tile is dropped, and a region sent with a tooth tile is dropped,
//       because the tile is the authority on what it is.
//
//       One region per call. Four quadrants of scaling are four
//       procedures in OpenDental, so they are four calls.
//
// What the probe settled, and why this file looks the way it does:
//
//   - POST /procedurelogs wants procCode (the CDT string). CodeNum is a
//     GET filter only, and sending it returns "procCode is required."
//   - ProvNum is sent only when the caller picked one. Omitted,
//     OpenDental falls back to the patient's primary provider.
//   - ProcStatus EC cannot be written. Existing entries go in at EO.
//   - A missing tooth is not a procedure. It is a toothinitial row with
//     InitialType 'Missing'. Missing and Hidden are independent flags.
//   - GET /providers pages, and the pages overlap. Reading one page
//     misses providers; reading pages without deduplicating counts them
//     twice.
//   - The fee table's schedule column is FeeSched. information_schema
//     cannot be consulted: OpenDental rejects any query containing the
//     word SCHEMA.
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
//     birthdate if it parses as one, a surname and first name if it has
//     two parts, and both name fields at once if it is a single word.
//   { "office":"downey", "action":"open", "pat_num":17 }
//   { "office":"downey", "action":"commit", "pat_num":17,
//     "tile_id":"<uuid>", "tooth_num":"30", "surfaces":["M","O"],
//     "addon_ids":["<uuid>"], "prov_num":2118, "fee_override":900,
//     "dry_run":true }
//   { "office":"downey", "action":"set_fee", "od_id":1081426,
//     "fee":683 }
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
// the REST wording, so only those two are marked verified.
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

// ---------------------------------------------------------------------
// Pricing
//
// Dental OS still does not decide what anything costs. It reads the
// number OpenDental already holds and, for a two-visit procedure,
// divides it between the two lines.
//
// Which schedule to read was settled against live data: the insurance
// plan's fee schedule if the patient has a usable plan, otherwise the
// one on the patient record. A membership such as Dental Masters lands
// there, because OpenDental's Discount Plans screen sets
// patient.FeeSched and nothing else. Never the provider's.
// ---------------------------------------------------------------------
type FeeSchedule = {
  source: "insurance plan" | "patient record" | "nothing set";
  fee_sched: number;
  fee_sched_name: string;
};

async function resolveFeeSchedule(
  auth: string,
  patNum: number,
): Promise<FeeSchedule> {
  const today = new Date().toISOString().slice(0, 10);

  const sql =
    `SELECT p.FeeSched AS PatientFeeSched, ` +
    `pfs.Description AS PatientFeeSchedName, ` +
    `ip.FeeSched AS PlanFeeSched, ifs.Description AS PlanFeeSchedName, ` +
    `pp.Ordinal, pp.IsPending, isub.DateTerm, ip.IsMedical ` +
    `FROM patient p ` +
    `LEFT JOIN feesched pfs ON pfs.FeeSchedNum = p.FeeSched ` +
    `LEFT JOIN patplan pp ON pp.PatNum = p.PatNum ` +
    `LEFT JOIN inssub isub ON isub.InsSubNum = pp.InsSubNum ` +
    `LEFT JOIN insplan ip ON ip.PlanNum = isub.PlanNum ` +
    `LEFT JOIN feesched ifs ON ifs.FeeSchedNum = ip.FeeSched ` +
    `WHERE p.PatNum = ${patNum} ` +
    `ORDER BY pp.Ordinal`;

  const call = await odFetch(auth, "PUT", "/queries/ShortQuery", {
    SqlCommand: sql,
  });

  const rows = Array.isArray(call.body)
    ? (call.body as Record<string, unknown>[])
    : [];

  if (rows.length === 0) {
    return { source: "nothing set", fee_sched: 0, fee_sched_name: "" };
  }

  // Rows are ordered by Ordinal, so the primary plan comes first.
  for (const row of rows) {
    const planSched = Number(row.PlanFeeSched ?? 0);
    if (planSched <= 0) continue;
    if (Number(row.IsPending ?? 0) === 1) continue;
    if (Number(row.IsMedical ?? 0) === 1) continue;

    // OpenDental writes 0001-01-01 for "not terminated".
    const term = String(row.DateTerm ?? "").slice(0, 10);
    const active = term === "" || term.startsWith("0001") || term >= today;
    if (!active) continue;

    return {
      source: "insurance plan",
      fee_sched: planSched,
      fee_sched_name: String(row.PlanFeeSchedName ?? ""),
    };
  }

  const patientSched = Number(rows[0].PatientFeeSched ?? 0);
  if (patientSched > 0) {
    return {
      source: "patient record",
      fee_sched: patientSched,
      fee_sched_name: String(rows[0].PatientFeeSchedName ?? ""),
    };
  }

  return { source: "nothing set", fee_sched: 0, fee_sched_name: "" };
}

// Amounts for a set of codes in one schedule, in one call.
//
// A code with no row is left out of the map rather than recorded as
// zero. The two are not the same thing.
const SAFE_PROC_CODE = /^[A-Za-z0-9._-]{1,20}$/;

async function lookupFees(
  auth: string,
  feeSched: number,
  codes: string[],
): Promise<Map<string, number>> {
  const found = new Map<string, number>();

  const safe = codes
    .map((c) => c.trim())
    .filter((c) => SAFE_PROC_CODE.test(c));

  if (feeSched <= 0 || safe.length === 0) return found;

  // Deduplicated, because a menu repeats codes across buckets.
  const unique = [...new Set(safe)];

  const sql =
    `SELECT pc.ProcCode, f.Amount ` +
    `FROM fee f ` +
    `INNER JOIN procedurecode pc ON pc.CodeNum = f.CodeNum ` +
    `WHERE f.FeeSched = ${feeSched} ` +
    `AND pc.ProcCode IN (${unique.map((c) => `'${c}'`).join(",")})`;

  // ShortQuery caps a page at 100 rows and Offset was confirmed to
  // advance, so a menu with more than 100 codes still resolves.
  for (let page = 0; page < 20; page++) {
    const offset = page * 100;
    const call = await odFetch(
      auth,
      "PUT",
      offset === 0
        ? "/queries/ShortQuery"
        : `/queries/ShortQuery?Offset=${offset}`,
      { SqlCommand: sql },
    );

    if (call.http_status < 200 || call.http_status >= 300) break;
    if (!Array.isArray(call.body)) break;

    const rows = call.body as Record<string, unknown>[];
    for (const row of rows) {
      const code = String(row.ProcCode ?? "").trim();
      if (code === "") continue;
      found.set(code, Number(row.Amount ?? 0));
    }

    if (rows.length < 100) break;
  }

  return found;
}

// Halving money. Done in whole cents so a fee ending in an odd cent
// cannot vanish or be invented: the remainder goes to the base line,
// and the two halves always add back to the original.
function splitFee(total: number): { base: number; delivery: number } {
  const cents = Math.round(total * 100);
  const deliveryCents = Math.floor(cents / 2);
  const baseCents = cents - deliveryCents;
  return { base: baseCents / 100, delivery: deliveryCents / 100 };
}

// Every procedure code a tile might write, so the screen can show a
// price before anyone taps anything.
function codesInRule(rule: unknown): string[] {
  if (rule === null || typeof rule !== "object") return [];

  const r = rule as Record<string, unknown>;
  const out: string[] = [];

  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim() !== "") out.push(value.trim());
  };

  push(r.code);
  push(r.bicuspid);
  push(r.molar);

  for (const key of ["all", "anterior", "posterior"]) {
    const value = r[key];
    if (Array.isArray(value)) {
      for (const entry of value) push(entry);
    } else {
      push(value);
    }
  }

  return out;
}

// ---------------------------------------------------------------------
// GET /providers caps a page at 100 and the pages overlap, so key on
// ProvNum and stop when a page contributes nothing new.
// The dropdown's shape, in one place, so the providers action and any
// future caller present the same list. Hidden providers are left out:
// the office hides one to retire them, and a retired provider has no
// business in a picker.
function visibleProviderList(
  providers: Record<string, unknown>[],
): {
  ProvNum: number | null;
  Abbr: string;
  LName: string;
  FName: string;
  Suffix: string;
}[] {
  return providers
    .filter((prov) => String(prov.IsHidden ?? "false") !== "true")
    .map((prov) => ({
      ProvNum: (prov.ProvNum as number) ?? null,
      Abbr: String(prov.Abbr ?? ""),
      LName: String(prov.LName ?? ""),
      FName: String(prov.FName ?? ""),
      Suffix: String(prov.Suffix ?? ""),
    }))
    .sort((a, b) => a.Abbr.localeCompare(b.Abbr));
}

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

// ---------------------------------------------------------------------
// Treatment shape
//
// procedurecode.TreatArea, carried through onto the tile unchanged.
// Confirmed against six months of live Downey procedures: quadrant work
// stores UR/UL/LR/LL in Surf with an empty ToothNum, arch work stores
// U/L the same way, and mouth-level work stores neither.
// ---------------------------------------------------------------------
type Shape = "tooth" | "quadrant" | "arch" | "mouth" | "range";

const QUADRANTS = ["UR", "UL", "LR", "LL"];
const ARCHES = ["U", "L"];

function shapeOf(treatArea: number | null): Shape {
  if (treatArea === 1 || treatArea === 2) return "tooth";
  if (treatArea === 4) return "quadrant";
  if (treatArea === 6) return "arch";
  if (treatArea === 7) return "range";
  return "mouth";
}

function normalizeRegion(input: unknown): string {
  const r = String(input ?? "").trim().toUpperCase();
  if (QUADRANTS.includes(r) || ARCHES.includes(r)) return r;
  return "";
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
    region?: string;
    surfaces?: unknown;
    addon_ids?: unknown;
    prov_num?: number;
    fee_override?: number;
    fee?: number;
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

  const ACTIONS = [
    "schedule",
    "patients",
    "providers",
    "open",
    "commit",
    "set_fee",
    "undo",
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
  // providers — the office's provider list, for the override dropdown
  //
  // Read once when the office is chosen rather than on every patient.
  // /providers pages at 100 and the pages overlap, so Downey's 284
  // providers are three or four round trips; OpenDental serialises
  // them, and open was paying that for every patient to fill a
  // dropdown that changes when somebody is hired.
  //
  // Per office and never carried between them: the two have separate
  // provider tables and a ProvNum from one means nothing at the other.
  // ===================================================================
  if (action === "providers") {
    const providers = await fetchAllProviders(auth);

    return json({
      ok: true,
      office: officeRow.name,
      office_slug: officeRow.slug,
      count: providers.length,
      providers: visibleProviderList(providers),
    });
  }

  // ===================================================================
  // schedule — one day's appointments, for the Today tab
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
        openable: statusNum !== 5 && patNum > 0,
        presence: presenceOf(r),
        operatory_num: Number(r.Op ?? 0),
        operatory_name: String(r.OpName ?? "").trim(),
        operatory_abbr: String(r.Abbrev ?? "").trim(),
        operatory_hidden: Number(r.IsHidden ?? 0) === 1,
        prov_num: Number(r.ProvNum ?? 0),
        prov_abbr: String(r.DrAbbr ?? "").trim(),
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

    // One box, four kinds of answer. The office types whatever they
    // have in front of them rather than choosing a field first.
    let lastName = rawQuery;
    let firstName = "";
    let birthdate = givenBirthdate;
    let patNumLookup = givenPatNum;

    if (givenPatNum === null && /^\d{1,9}$/.test(rawQuery)) {
      patNumLookup = Number(rawQuery);
      lastName = "";
    } else if (givenBirthdate === "" && toIsoBirthdate(rawQuery) !== null) {
      birthdate = toIsoBirthdate(rawQuery) ?? "";
      lastName = "";
    } else if (rawQuery !== "") {
      // Surname first, then first name. A comma is optional because the
      // name is written "Mendoza, Juanita" everywhere else on screen,
      // and someone will type it that way.
      const parts = rawQuery
        .replace(/,/g, " ")
        .split(/\s+/)
        .filter((part) => part !== "");

      if (parts.length >= 2) {
        lastName = parts[0];
        // Anything after the second word is ignored rather than joined:
        // a middle name would only narrow the search to nothing.
        firstName = parts[1];
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

    // ---- By name, birthdate, or a combination ----
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
    if (firstName !== "") params.push(`FName=${encodeURIComponent(firstName)}`);
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

    // A single word could be either name, and LName matches on a prefix,
    // so "shad" finds "Shadde" and looks successful while missing the
    // person actually wanted. Both fields are therefore searched every
    // time rather than only when the first comes back empty.
    let alsoSearchedFirstName = false;

    if (lastName !== "" && firstName === "" && birthdate === "") {
      alsoSearchedFirstName = true;

      const byFirst = await odFetch(
        auth,
        "GET",
        `/patients/Simple?hideInactive=true&FName=${
          encodeURIComponent(lastName)
        }`,
      );

      if (
        byFirst.http_status >= 200 && byFirst.http_status < 300 &&
        Array.isArray(byFirst.body)
      ) {
        // Merged on PatNum. Someone whose first and last name both match
        // should appear once, not twice.
        const seen = new Set<number>(
          rows.map((r) => Number(r.PatNum ?? 0)),
        );

        for (const r of byFirst.body as Record<string, unknown>[]) {
          const n = Number(r.PatNum ?? 0);
          if (n > 0 && !seen.has(n)) {
            seen.add(n);
            rows.push(r);
          }
        }
      }
    }

    // Alphabetical by surname, so a merged list reads like one list.
    rows.sort((a, b) =>
      String(a.LName ?? "").localeCompare(String(b.LName ?? ""))
    );

    // Naming what was actually searched makes a wrong reading obvious:
    // a mistyped date searched as a surname explains itself.
    const searchedByParts: string[] = [];
    if (lastName !== "") {
      searchedByParts.push(
        alsoSearchedFirstName ? "surname or first name" : "surname",
      );
    }
    if (firstName !== "") searchedByParts.push("first name");
    if (birthdate !== "") searchedByParts.push("date of birth");

    const searchedBy = searchedByParts.length === 0
      ? "that"
      : searchedByParts.join(" and ");

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

    // The provider list is gone from here. It was three or four
    // serialised round trips per patient for a list that belongs to the
    // office, and it is read once by the providers action instead.
    //
    // This does not touch the patient's own provider, which is resolved
    // below from the appointment and the patient record — both already
    // in this payload, neither ever read from the list.
    const [patient, procs, initials, appts] = await Promise.all([
      odFetch(auth, "GET", `/patients/${patNum}`),
      odFetch(auth, "GET", `/procedurelogs?PatNum=${patNum}`),
      odFetch(auth, "GET", `/toothinitials?PatNum=${patNum}`),
      odFetch(auth, "GET", `/appointments?PatNum=${patNum}&date=${today}`),
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
    // provider otherwise.
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

    // Tiles come from our own tables, read as the caller so RLS applies.
    // The tree belongs to the organization; chart_tile_offices decides
    // which of its tiles this particular office offers.
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
          treat_area: t.treat_area ?? null,
          delivery_code: t.delivery_code ?? null,
          is_paired: String(t.delivery_code ?? "") !== "",
          // Kept only long enough to gather the codes a tile can write,
          // then stripped before the menu is sent.
          code_rule_raw: t.code_rule ?? null,
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

    // Prices for everything this menu can write, in one call. The
    // schedule is per patient, so this cannot be cached per office.
    const feeSchedule = await resolveFeeSchedule(auth, patNum);

    const menuCodes: string[] = [];
    for (const c of menu) {
      for (const t of c.tiles) {
        menuCodes.push(...codesInRule(t.code_rule_raw));
        if (typeof t.delivery_code === "string") menuCodes.push(t.delivery_code);
        for (const a of t.addons) {
          if (typeof a.proc_code === "string") menuCodes.push(a.proc_code);
        }
      }
    }

    const feeMap = await lookupFees(auth, feeSchedule.fee_sched, menuCodes);

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
      // Read-only. Changing what a code costs is a fee schedule
      // decision and belongs in OpenDental, not at the chair.
      fee_schedule: feeSchedule,
      // Only codes that actually have a row. A code absent from this
      // map has no price in this schedule, which is different from
      // having a price of zero.
      fees: Object.fromEntries(feeMap),
      resolved_provider: resolvedProvider,
      // Empty, deliberately. The list comes from the providers action
      // now; the key stays so a caller built against v10 reads an array
      // rather than undefined.
      providers: [],
      procedures,
      missing_teeth: missingTeeth,
      hidden_teeth: hiddenTeeth,
      menu: menu.map((c) => ({
        ...c,
        tiles: c.tiles.map((t) => {
          const { code_rule_raw: _unused, ...rest } = t;
          return rest;
        }),
      })),
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
    const region = normalizeRegion(body.region);
    const surfaces = normalizeSurfaces(body.surfaces);

    // Read the tile through RLS, and confirm it belongs to this caller's
    // organization and is offered at this office.
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

    // Availability is checked here as well as filtered in the menu. The
    // menu is a convenience; this is the gate.
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
    // The tile decides the shape, and the shape decides which fields are
    // written. Anything the caller sent that does not belong to this
    // shape is dropped rather than trusted.
    // -----------------------------------------------------------------
    const shape = shapeOf(
      typeof tile.treat_area === "number" ? tile.treat_area : null,
    );

    let effectiveTooth = "";
    let effectiveRegion = "";
    let effectiveSurfaces: string[] = [];

    if (shape === "tooth") {
      if (toothNum === "" || toothClass(toothNum) === null) {
        return json({
          ok: false,
          error: `${tile.label} is charted on a tooth. Pick a tooth first.`,
        }, 400);
      }
      effectiveTooth = toothNum;
      effectiveSurfaces = surfaces;
    } else if (shape === "quadrant") {
      if (!QUADRANTS.includes(region)) {
        return json({
          ok: false,
          error: `${tile.label} is charted by quadrant. Pick upper right, upper left, lower right or lower left.`,
        }, 400);
      }
      effectiveRegion = region;
    } else if (shape === "arch") {
      if (!ARCHES.includes(region)) {
        return json({
          ok: false,
          error: `${tile.label} is charted by arch. Pick upper or lower.`,
        }, 400);
      }
      effectiveRegion = region;
    } else if (shape === "range") {
      return json({
        ok: false,
        error: `${tile.label} covers a span of teeth, which cannot be charted here yet. Enter it in OpenDental.`,
      }, 400);
    }

    if (tile.needs_surfaces === true && effectiveSurfaces.length === 0) {
      return json({ ok: false, error: "Pick at least one surface." }, 400);
    }

    const resolved = resolveCode(
      tile.code_rule as CodeRule | null,
      effectiveTooth,
      effectiveSurfaces.length,
    );

    if (!resolved.ok) {
      return json({ ok: false, error: resolved.error }, 400);
    }

    // The bucket decides the status. EO rather than EC: OpenDental's API
    // refuses EC on both POST and PUT.
    const procStatus = category.bucket === "existing" ? "EO" : "TP";
    const procDate = new Date().toISOString().slice(0, 10);

    // Which add-ons survived. The browser sends the ones still checked;
    // anything not belonging to this tile is dropped rather than trusted.
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

      if (effectiveTooth !== "") p.ToothNum = effectiveTooth;
      if (effectiveRegion !== "") p.Surf = effectiveRegion;

      if (typeof body.prov_num === "number" && body.prov_num > 0) {
        p.ProvNum = body.prov_num;
      }

      return p;
    }

    const planned: PlannedLine[] = [];

    // -----------------------------------------------------------------
    // Pricing, and only for a paired tile
    //
    // A single procedure is still priced entirely by OpenDental. A
    // paired tile is the exception, because OpenDental holds the whole
    // fee on the prep and zero on the seat. The halves are a starting
    // point: set_fee can change either line afterwards.
    // -----------------------------------------------------------------
    const deliveryCode = String(tile.delivery_code ?? "").trim();
    const isPaired = deliveryCode !== "";

    const override = typeof body.fee_override === "number" &&
        Number.isFinite(body.fee_override) && body.fee_override >= 0
      ? body.fee_override
      : null;

    let feeSchedule: FeeSchedule | null = null;
    let baseFee: number | null = null;
    let split: { base: number; delivery: number } | null = null;
    let feeSource = "OpenDental";

    if (isPaired || override !== null) {
      feeSchedule = await resolveFeeSchedule(auth, patNum);

      if (override !== null) {
        baseFee = override;
        feeSource = "overridden at the chair";
      } else {
        const fees = await lookupFees(auth, feeSchedule.fee_sched, [
          resolved.procCode,
        ]);

        const found = fees.get(resolved.procCode);

        // Absent is not zero. Half of an unknown number is not a number.
        if (found === undefined) {
          return json({
            ok: false,
            error: isPaired
              ? `${resolved.procCode} has no fee in ${
                feeSchedule.fee_sched_name || "this patient's fee schedule"
              }, so it cannot be split between the two visits. Set the fee in OpenDental, or change it on the line afterwards.`
              : `${resolved.procCode} has no fee in this patient's fee schedule.`,
            resolved_code: resolved.procCode,
            fee_schedule: feeSchedule,
          }, 400);
        }

        baseFee = found;
        feeSource = `${feeSchedule.fee_sched_name || "fee schedule"} (${feeSchedule.source})`;
      }

      if (isPaired) split = splitFee(baseFee);
    }

    // Base. Surfaces belong to this line only.
    const base = basePayload(resolved.procCode);
    if (effectiveSurfaces.length > 0) base.Surf = effectiveSurfaces.join("");

    if (split !== null) {
      base.ProcFee = split.base;
    } else if (override !== null) {
      base.ProcFee = override;
    }

    planned.push({
      role: "base",
      label: tile.label,
      proc_code: resolved.procCode,
      addon_id: null,
      payload: base,
    });

    // Delivery. Created now so the treatment plan shows the whole job.
    if (isPaired) {
      const delivery = basePayload(deliveryCode);
      delivery.ProcFee = split === null ? 0 : split.delivery;

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
        shape,
        region: effectiveRegion,
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
        would_post: planned[0].payload,
        fee_schedule: feeSchedule,
        fee_source: feeSource,
        fee_total: baseFee,
        fee_split: split,
        note: isPaired
          ? "The fee is halved between the two visits, remainder to the prep. Either line can be changed afterwards."
          : override !== null
            ? "The fee was overridden for this procedure only. No fee schedule changed."
            : "ProcFee is omitted on purpose. OpenDental prices it.",
      });
    }

    // -----------------------------------------------------------------
    // Write them, in order, stopping at the first refusal.
    //
    // A partial commit is possible. Rolling back would mean deleting a
    // procedure, and OpenDental has been observed refusing to delete
    // rows at some statuses. So nothing is undone automatically.
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

      // Where a fee was stated, the value that came back is compared
      // with it, so an override shows up here rather than being
      // discovered later in a report.
      let feeHonoured: boolean | null = null;
      const stated = line.payload.ProcFee;
      if (typeof stated === "number") {
        feeHonoured = Math.round(Number(cb.ProcFee ?? -1) * 100) ===
          Math.round(stated * 100);
      }

      written.push({
        role: line.role,
        label: line.label,
        proc_code: String(cb.procCode ?? line.proc_code),
        addon_id: line.addon_id,
        od_id: procNum,
        descript: String(cb.descript ?? ""),
        tooth_num: String(cb.ToothNum ?? effectiveTooth),
        surf: String(cb.Surf ?? ""),
        status: String(cb.ProcStatus ?? procStatus),
        fee: cb.ProcFee ?? null,
        prov_num: cb.ProvNum ?? null,
        prov_abbr: String(cb.provAbbr ?? ""),
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

      fee_schedule: feeSchedule,
      fee_source: feeSource,
      fee_total: baseFee,
      fee_split: split,

      line_count: written.length,
      lines: written,

      partial: failure !== null,
      partial_failure: failure === null ? null : {
        role: failure.line.role,
        label: failure.line.label,
        proc_code: failure.line.proc_code,
        detail: failure.detail,
      },

      // The base line, flat, so an older caller keeps working.
      od_id: baseLine?.od_id ?? null,
      proc_code: baseLine?.proc_code ?? resolved.procCode,
      descript: baseLine?.descript ?? "",
      tooth_num: baseLine?.tooth_num ?? effectiveTooth,
      surf: baseLine?.surf ?? effectiveRegion,
      status: baseLine?.status ?? procStatus,
      undoable: baseLine?.undoable ?? false,
      fee: baseLine?.fee ?? null,
      prov_num: baseLine?.prov_num ?? null,
      prov_abbr: baseLine?.prov_abbr ?? "",

      shape,
      region: effectiveRegion,
      committed_by: userData.user.email,
      committed_at: new Date().toISOString(),
    });
  }

  // ===================================================================
  // set_fee — correct the fee on a procedure already written
  //
  // Deliberately narrow. It sends ProcFee and nothing else, and reads
  // the row back because OpenDental has been observed ignoring values
  // it was sent.
  // ===================================================================
  if (action === "set_fee") {
    const procNum = body.od_id;

    if (typeof procNum !== "number" || procNum <= 0) {
      return json({ ok: false, error: "od_id is required." }, 400);
    }

    const fee = body.fee;

    if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0) {
      return json({
        ok: false,
        error: "fee must be a number of zero or more.",
      }, 400);
    }

    // Whole cents, so the value read back can be compared with what was
    // sent.
    const amount = Math.round(fee * 100) / 100;

    const before = await odFetch(auth, "GET", `/procedurelogs/${procNum}`);

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
    const previousFee = beforeBody.ProcFee ?? null;

    // The patient is checked rather than assumed. An od_id from a stale
    // screen could otherwise reprice someone else's procedure.
    if (typeof patNum === "number" && patNum > 0) {
      if (Number(beforeBody.PatNum ?? 0) !== patNum) {
        return json({
          ok: false,
          error: "That procedure belongs to a different patient.",
        }, 403);
      }
    }

    if (body.dry_run === true) {
      return json({
        ok: true,
        dry_run: true,
        od_id: procNum,
        proc_code: beforeBody.procCode ?? "",
        previous_fee: previousFee,
        would_set_fee: amount,
        would_put_to: `${OD_BASE_URL}/procedurelogs/${procNum}`,
      });
    }

    const put = await odFetch(auth, "PUT", `/procedurelogs/${procNum}`, {
      ProcFee: amount,
    });

    if (put.http_status < 200 || put.http_status >= 300) {
      return json({
        ok: false,
        error: "OpenDental would not change that fee.",
        detail: put.body,
      }, 502);
    }

    // The PUT response is not proof. The stored row is.
    const after = await odFetch(auth, "GET", `/procedurelogs/${procNum}`);
    const afterBody = (after.body ?? {}) as Record<string, unknown>;
    const storedFee = afterBody.ProcFee ?? null;

    const stuck = Math.round(Number(storedFee ?? -1) * 100) ===
      Math.round(amount * 100);

    return json({
      ok: stuck,
      od_id: procNum,
      proc_code: afterBody.procCode ?? beforeBody.procCode ?? "",
      tooth_num: String(afterBody.ToothNum ?? ""),
      previous_fee: previousFee,
      requested_fee: amount,
      stored_fee: storedFee,
      // False means OpenDental accepted the call and then kept its own
      // number. The screen should show what is actually stored.
      fee_honoured: stuck,
      error: stuck
        ? undefined
        : "OpenDental accepted the change but kept its own fee.",
      changed_by: userData.user.email,
      changed_at: new Date().toISOString(),
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
