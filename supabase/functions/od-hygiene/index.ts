// =====================================================================
// Dental OS - Edge Function: od-hygiene
//
// One month of hygiene, a day to a row: how many slots were on offer,
// how many were booked, how many are still open, and once the day has
// been, who turned up and who did not.
//
// Reads only. Nothing is written to OpenDental or to Supabase.
//
// Deploy path: supabase/functions/od-hygiene/index.ts
// Version: 11
//
// Actions:
//   { "office":"downey", "action":"month", "year":2026, "month":8 }
//   { "office":"downey", "action":"day", "year":2026, "month":8, "day":12 }
//
// ---------------------------------------------------------------------
// Changelog
//
//   v11 Restores rowFor, lost when the counting core was replaced in
//       v9. The month read threw ReferenceError and every load came
//       back 500. It slipped through because the syntax check was
//       filtering out the whole error code that the Deno globals also
//       raise - it now filters by name, so a real missing symbol shows.
//
//   v10 The pager was asking for the same rows over and over. ShortQuery
//       returns the first 100 at offset 0 and then everything from the
//       offset onward, so walking it in hundreds made dozens of
//       ever-larger round trips and the month read timed out. A result
//       over 100 rows now takes exactly 2 calls.
//
//   v9  Counting core rewritten. One read of the month's appointments
//       feeds both the day rows and the day panel, so they can no longer
//       disagree - 1 August read 15 in the row and 16 in the list.
//       Everything counts patients, not appointments. Showed is a
//       cleaning and an exam; NH/NE is a visit short of one or both;
//       SRP stands apart. An appointment belongs to the day it sat in a
//       hygiene column on, whatever column it finished in.
//
//   v8  Showed counted hygiene completed by the appointment, wherever it
//       ended up. It was counting only what still sits in the day's own
//       columns, so 1 August read 15 while the day panel could name 26 -
//       the difference being work moved into a column nobody was
//       rostered in and completed there.
//
//   v7  Showed counts a hygiene visit, not an appointment that sat in a
//       hygiene chair. Of 237 completed in Downey's hygiene columns in
//       August, 137 had a cleaning or perio maintenance; 22 were SRP,
//       62 had only exams and x-rays, and 16 had nothing posted at all.
//       Those 3 are returned per day rather than hidden, so a posting
//       that never happened can be found. Every appointment on the day
//       panel carries the same verdict.
//
//   v6  Missed is what the day held at midnight and did not do, rather
//       than booked less showed. A day gains appointments after midnight
//       and those extras were hiding the misses: 5 August held 16, did
//       11, and took 4 more - 5 missed, not 1. Booked is now showed plus
//       missed. The day panel lists only hygiene codes, and SRP is not
//       among them.
//
//   v5  Showed follows the appointment, not the column. Work gets moved
//       between columns during the day, and judging by the column called
//       every one of those a no-show - the 1 August panel listed most of
//       a full day as missed. Both the month and the day panel now read
//       the appointment's own status.
//
//   v4  New action "day": one day, named. Returns who was rostered and
//       every appointment with its patient, column and completed codes,
//       marked showed, booked or missed. The missed ones take their time
//       and column from the history, because the live row has been
//       re-dated. Reads only; nothing is stored.
//
//   v3  A day with no hygienist rostered is no longer closed. The
//       doctors see hygiene patients on those days; the day reads 0
//       slots and still counts what was booked and seen, taken from the
//       office's own hygiene-ticked columns.
//
//   v2  Missed is no longer counted; it is what the day held at midnight
//       less what happened. Counting it directly was wrong: a parked
//       appointment is re-dated on its way into the Cancelled column,
//       so Saturday 8 August read 39 misses against 28 slots. Booked
//       for a day gone now comes from the history snapshot, and for a
//       day ahead from the schedule as it stands.
//
//   v1  First build.
//
// ---------------------------------------------------------------------
// How each number is worked out, and why
//
//   Slots come from the roster, not from the hygiene columns.
//
//     Every hygienist's schedule entry names the columns she sits in,
//     and it is always 2. Multiplying her hours by those columns gives
//     the day's capacity, and it moves correctly on a day with 1
//     hygienist and a day with 3.
//
//     Going by the hygiene tick on the operatory instead would be
//     wrong. On Saturday 29 August at Downey, 3 hygienists worked, and
//     HG-PN sat in OP 9 and OP 10, which are ticked Production. The
//     tick would have found 2 of the 3 and counted 28 slots where
//     there were 42.
//
//     The tick earns its place in one spot only: a day with nobody
//     rostered. The doctors still see hygiene patients then, in the
//     office's own hygiene columns. Such a day reads 0 slots and still
//     counts what was booked and seen, so the work is never lost and
//     the capacity is never invented.
//
//   A hygienist is a provider whose specialty is Hygienist.
//
//     Definition category 35. The DefNum is 543 at Downey and 466 at
//     Maywood, so it is looked up by name every time. The provider
//     abbreviations mostly start "HG", but not reliably enough to key
//     on - Downey has a dentist appearing as the hygienist on 5
//     appointments.
//
//   Showed is the appointment marked Complete.
//
//     Not the arrival clock. Downey stamps a real arrival time on
//     nearly every appointment; Maywood has never used it once.
//
//   Missed is never counted. It is booked less showed.
//
//     Counting it directly does not work. Neither office marks an
//     appointment broken in place; they move it into a column called
//     Cancelled at Downey and BROKEN at Maywood, and on the way in
//     OpenDental rewrites its date and time. Saturday 8 August's are
//     all 10 minutes long and stacked from 06:40 to 18:30, hours past
//     closing, so the row no longer says which day it was ever for.
//
//   Booked is what the day was holding at midnight.
//
//     For a day gone, from the history. Not the end of the day: the
//     cancellations are moved out as the day runs, logged at 07:49,
//     09:11, 12:04 and 15:00 on that Saturday, so by closing time the
//     hygiene columns look almost untouched.
//
//     For a day still ahead, simply what stands in the columns now.
//
//     It never reads below showed. Somebody walks in and is seen on a
//     day the snapshot knew nothing about - 15 August held 26 at
//     midnight and saw 31 - and negative misses would be nonsense.
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

// definition.Category 35 is the provider specialty list.
const CATEGORY_SPECIALTY = 35;
const HYGIENIST = "hygienist";

// What counts as hygiene work on the day panel.
//
// Scaling and root planing is deliberately absent. The offices do not
// count it as hygiene for marketing, so D4341 and D4342 never appear
// here. Everything else a hygienist does on a recall visit is.
const HYGIENE_CODES = [
  "D1110", // cleaning, adult
  "D1120", // cleaning, child
  "D1206", // fluoride varnish
  "D1208", // fluoride
  "D1351", // sealant
  "D4346", // scaling for gingival inflammation
  "D4355", // full mouth debridement
  "D4910", // perio maintenance
];

// Scaling and root planing. Counted, shown, and never called hygiene.
const SRP_CODES = ["D4341", "D4342"];

// The cleaning itself. Perio maintenance counts: it is that patient's
// cleaning. Fluoride and sealants do not - they ride along with one.
const CLEANING_CODES = ["D1110", "D1120", "D4910"];

// An exam of any kind. C0130 is Downey's own 3 month recall exam; if
// Maywood uses a custom code of its own it needs adding here, and the
// number will read low until it is.
const EXAM_CODES = [
  "D0120", // periodic
  "D0140", // limited, problem focused
  "D0150", // comprehensive
  "D0170", // re-evaluation
  "D0180", // perio evaluation
  "C0130", // Downey, 3 month recall exam
];

// appointment.AptStatus, confirmed against live data.
const APT_SCHEDULED = 1;
const APT_COMPLETE = 2;

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
// *everything from the offset onward* on any later page. It does not
// page a hundred at a time.
//
// So a result larger than 100 rows takes exactly 2 calls. Walking it in
// hundreds asks for the same rows again and again: the month read is
// 466 rows, and the old loop made dozens of ever-larger round trips
// until the function timed out and the screen said the server did not
// respond.
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

// "2026-08-29T00:00:00" or "2026-08-29" -> 29
const dayOf = (v: unknown): number => {
  const m = String(v ?? "").match(/^\d{4}-\d{2}-(\d{2})/);
  return m ? Number(m[1]) : 0;
};

const pad = (n: number) => String(n).padStart(2, "0");

// MySQL hands a boolean back as 1 or 0, sometimes as a string.
const isTrue = (v: unknown): boolean =>
  v === true || v === 1 || v === "1" || String(v ?? "").toLowerCase() === "true";

// Today in California, not UTC. toISOString() rolls the date over from
// mid-afternoon onwards and would call today a day gone.
function localDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
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
    year?: number;
    day?: number;
    month?: number;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const action = (body.action ?? "").toLowerCase().trim();
  if (action !== "month" && action !== "day") {
    return json({ ok: false, error: "action must be month or day." }, 400);
  }

  const year = num(body.year);
  const month = num(body.month);

  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return json({ ok: false, error: "Give a year and a month from 1 to 12." }, 400);
  }

  const dayAsked = num(body.day);
  if (action === "day" && (dayAsked < 1 || dayAsked > 31)) {
    return json({ ok: false, error: "Give a day of the month." }, 400);
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

  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = `${year}-${pad(month)}-01`;
  const afterLast = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${pad(month + 1)}-01`;

  const fail = (message: string, call: OdCall | null) =>
    json({ ok: false, office: officeRow.slug, error: message, detail: call?.body }, 502);

  // ---- 1. Which specialty number means hygienist, at this office ----
  const spec = await shortQueryAll(
    auth,
    `SELECT DefNum, ItemName FROM definition WHERE Category = ${CATEGORY_SPECIALTY}`,
  );

  if (spec.failed) return fail("Could not read this office's provider specialties.", spec.failed);

  const hygDef = spec.rows.find(
    (r) => String(r.ItemName ?? "").trim().toLowerCase() === HYGIENIST,
  );

  if (!hygDef) {
    return json({
      ok: false,
      office: officeRow.slug,
      error: `${officeRow.name} has no provider specialty called "Hygienist".`,
      specialties_found: spec.rows.map((r) => String(r.ItemName ?? "").trim()),
    }, 400);
  }

  const hygSpecialty = num(hygDef.DefNum);

  // ===================================================================
  // day — one day, named
  //
  // The month screen shows counts. This turns a count back into people:
  // who was rostered, who came, and who did not.
  //
  // Nothing is stored. Patient names are read from OpenDental and sent
  // to the screen, the same as the chart does, and go no further.
  // ===================================================================
  if (action === "day") {
    const date = `${year}-${pad(month)}-${pad(dayAsked)}`;

    // Who was on, and in which columns.
    const shift = await shortQueryAll(
      auth,
      `SELECT p.Abbr, TIME(s.StartTime) AS St, TIME(s.StopTime) AS Sp, ` +
        `(SELECT GROUP_CONCAT(o.OpName ORDER BY o.OperatoryNum SEPARATOR ' + ') ` +
        ` FROM scheduleop so JOIN operatory o ON o.OperatoryNum = so.OperatoryNum ` +
        ` WHERE so.ScheduleNum = s.ScheduleNum) AS Cols, ` +
        `(SELECT GROUP_CONCAT(so2.OperatoryNum) FROM scheduleop so2 ` +
        ` WHERE so2.ScheduleNum = s.ScheduleNum) AS OpNums ` +
        `FROM schedule s JOIN provider p ON p.ProvNum = s.ProvNum ` +
        `WHERE s.SchedType = 1 AND p.Specialty = ${hygSpecialty} ` +
        `AND s.SchedDate = '${date}' ORDER BY p.Abbr, s.StartTime`,
    );

    if (shift.failed) return fail("Could not read that day's roster.", shift.failed);

    const dayCols = new Set<number>();
    for (const r of shift.rows) {
      for (const op of String(r.OpNums ?? "").split(",")) {
        const n = Number(op.trim());
        if (Number.isFinite(n) && n > 0) dayCols.add(n);
      }
    }

    // Nobody rostered: fall back to the office's own hygiene columns,
    // because a doctor still sees hygiene patients on those days.
    if (dayCols.size === 0) {
      const ticked = await shortQueryAll(
        auth,
        `SELECT OperatoryNum FROM operatory WHERE IsHygiene = 1 AND IsHidden = 0`,
      );
      if (ticked.failed) return fail("Could not read this office's hygiene columns.", ticked.failed);
      for (const r of ticked.rows) {
        const n = num(r.OperatoryNum);
        if (n > 0) dayCols.add(n);
      }
    }

    if (dayCols.size === 0) {
      return json({
        ok: true, office: officeRow.slug, date,
        hygienists: [], appointments: [],
        note: "This office has no hygiene columns and nobody was rostered.",
      });
    }

    const dayColList = [...dayCols].join(",");

    const patientName = `TRIM(CONCAT(pt.LName, ', ', pt.FName))`;
    // Only the hygiene codes. The exams and x-rays that ride along on a
    // recall visit are not what this screen is about, and SRP is not
    // counted as hygiene at all.
    const hygList = HYGIENE_CODES.map((c) => `'${c}'`).join(",");

    const srpList = SRP_CODES.map((c) => `'${c}'`).join(",");

    const codes =
      `(SELECT GROUP_CONCAT(pc.ProcCode ORDER BY pc.ProcCode SEPARATOR ' ') ` +
      ` FROM procedurelog pl JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum ` +
      ` WHERE pl.AptNum = a.AptNum AND pl.ProcStatus = ${APT_COMPLETE} ` +
      `   AND pc.ProcCode IN (${hygList}))`;

    // What the visit turned out to be, from what was posted. A cleaning
    // and an exam together is the whole visit; the rest name what was
    // short, so the front desk can see the charge that went unbilled.
    const has = (list: string) =>
      `EXISTS (SELECT 1 FROM procedurelog pl JOIN procedurecode pc ` +
      `ON pc.CodeNum = pl.CodeNum WHERE pl.AptNum = a.AptNum ` +
      `AND pl.ProcStatus = ${APT_COMPLETE} AND pc.ProcCode IN (${list}))`;

    const cleanList = CLEANING_CODES.map((c) => `'${c}'`).join(",");
    const examList = EXAM_CODES.map((c) => `'${c}'`).join(",");

    const kind =
      `CASE WHEN ${has(cleanList)} AND ${has(examList)} THEN 'hygiene' ` +
      `WHEN ${has(srpList)} THEN 'srp' ` +
      `WHEN ${has(cleanList)} THEN 'no exam' ` +
      `WHEN NOT EXISTS (SELECT 1 FROM procedurelog pl WHERE pl.AptNum = a.AptNum ` +
      `       AND pl.ProcStatus = ${APT_COMPLETE}) THEN 'nothing' ` +
      `ELSE 'no cleaning' END`;

    // What stands in those columns now: the ones that happened, and the
    // ones still to come.
    const standing = await shortQueryAll(
      auth,
      `SELECT a.AptNum, TIME(a.AptDateTime) AS T, o.OpName, a.AptStatus, ` +
        `${patientName} AS Patient, pr.Abbr AS Hyg, ${codes} AS Codes, ` +
        `${kind} AS Kind ` +
        `FROM appointment a ` +
        `JOIN patient pt ON pt.PatNum = a.PatNum ` +
        `LEFT JOIN operatory o ON o.OperatoryNum = a.Op ` +
        `LEFT JOIN provider pr ON pr.ProvNum = a.ProvHyg ` +
        `WHERE a.Op IN (${dayColList}) ` +
        `AND a.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
        `AND DATE(a.AptDateTime) = '${date}' ORDER BY a.AptDateTime`,
    );

    if (standing.failed) return fail("Could not read that day's appointments.", standing.failed);

    // What the day was holding at midnight. The ones here that are not
    // above are the misses - and this is where their real time and
    // column come from, because the live row has been re-dated.
    const held = await shortQueryAll(
      auth,
      `SELECT h.AptNum, TIME(h.AptDateTime) AS T, o.OpName, ` +
        `${patientName} AS Patient, pr.Abbr AS Hyg, ` +
        `a.AptStatus AS LiveStatus, ${codes} AS Codes, ${kind} AS Kind ` +
        `FROM histappointment h ` +
        `JOIN appointment a ON a.AptNum = h.AptNum ` +
        `JOIN patient pt ON pt.PatNum = h.PatNum ` +
        `LEFT JOIN operatory o ON o.OperatoryNum = h.Op ` +
        `LEFT JOIN provider pr ON pr.ProvNum = h.ProvHyg ` +
        `WHERE h.Op IN (${dayColList}) ` +
        `AND h.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
        `AND DATE(h.AptDateTime) = '${date}' ` +
        `AND h.HistApptNum = (SELECT MAX(h2.HistApptNum) FROM histappointment h2 ` +
        `                     WHERE h2.AptNum = h.AptNum ` +
        `                       AND h2.HistDateTStamp < '${date}') ` +
        `ORDER BY h.AptDateTime`,
    );

    if (held.failed) return fail("Could not read what that day was holding.", held.failed);

    type Visit = {
      apt_num: number;
      time: string;
      column: string;
      patient: string;
      hygienist: string;
      codes: string;
      state: "showed" | "booked" | "missed";
      // What was posted: hygiene, srp, other, nothing. Empty until the
      // appointment has happened.
      kind: string;
    };

    const visits: Visit[] = [];
    const seen = new Set<number>();

    for (const r of standing.rows) {
      const aptNum = num(r.AptNum);
      if (seen.has(aptNum)) continue;
      seen.add(aptNum);
      visits.push({
        apt_num: aptNum,
        time: String(r.T ?? ""),
        column: String(r.OpName ?? "").trim(),
        patient: String(r.Patient ?? "").trim(),
        hygienist: String(r.Hyg ?? "").trim(),
        codes: String(r.Codes ?? "").trim(),
        state: num(r.AptStatus) === APT_COMPLETE ? "showed" : "booked",
        kind: String(r.Kind ?? ""),
      });
    }

    // An appointment held at midnight that is now Complete happened,
    // wherever it ended up. On 1 August several were moved into a column
    // nobody was rostered in and completed there; judging by the column
    // rather than the appointment called every one of them a no-show.
    for (const r of held.rows) {
      const aptNum = num(r.AptNum);
      if (seen.has(aptNum)) continue;
      seen.add(aptNum);

      const done = num(r.LiveStatus) === APT_COMPLETE;

      visits.push({
        apt_num: aptNum,
        time: String(r.T ?? ""),
        column: String(r.OpName ?? "").trim(),
        patient: String(r.Patient ?? "").trim(),
        hygienist: String(r.Hyg ?? "").trim(),
        codes: done ? String(r.Codes ?? "").trim() : "",
        state: done ? "showed" : "missed",
        kind: done ? String(r.Kind ?? "") : "",
      });
    }

    visits.sort((a, b) => a.time.localeCompare(b.time));

    return json({
      ok: true,
      office: officeRow.slug,
      office_name: officeRow.name,
      date,
      hygienists: shift.rows.map((r) => ({
        name: String(r.Abbr ?? "").trim(),
        from: String(r.St ?? ""),
        to: String(r.Sp ?? ""),
        columns: String(r.Cols ?? "").trim(),
      })),
      appointments: visits,
      counts: {
        showed: visits.filter((v) => v.state === "showed").length,
        missed: visits.filter((v) => v.state === "missed").length,
        booked: visits.filter((v) => v.state === "booked").length,
      },
      read_at: new Date().toISOString(),
    });
  }

  // ---- 2. The roster: who works, how long, and in how many columns ----
  //
  // A day is normally 2 entries per hygienist, a morning and an
  // afternoon with the break between them, and each entry names the
  // columns she sits in.
  const roster = await shortQueryAll(
    auth,
    `SELECT s.SchedDate, s.ProvNum, p.Abbr, ` +
      `TIME_TO_SEC(TIMEDIFF(s.StopTime, s.StartTime)) AS Seconds, ` +
      `(SELECT COUNT(*) FROM scheduleop so WHERE so.ScheduleNum = s.ScheduleNum) AS Cols, ` +
      `(SELECT GROUP_CONCAT(so2.OperatoryNum) FROM scheduleop so2 ` +
      ` WHERE so2.ScheduleNum = s.ScheduleNum) AS Ops ` +
      `FROM schedule s JOIN provider p ON p.ProvNum = s.ProvNum ` +
      `WHERE s.SchedType = 1 AND p.Specialty = ${hygSpecialty} ` +
      `AND s.SchedDate >= '${first}' AND s.SchedDate < '${afterLast}' ` +
      `ORDER BY s.SchedDate`,
  );

  if (roster.failed) return fail("Could not read the hygiene roster.", roster.failed);

  type DayRow = {
    day: number;
    hygienists: number;
    columns: number;
    slots: number;
    booked: number;
    showed: number;
    missed: number;
    open: number;
    // Completed in a hygiene chair but not a hygiene visit. Kept apart
    // so a posting that never happened can be found rather than hidden.
    srp: number;
    // Came, and the visit was short of a cleaning, an exam, or both.
    nhne: number;
  };

  const byDay = new Map<number, DayRow>();
  const provsByDay = new Map<number, Set<number>>();
  const colsByDay = new Map<number, Set<number>>();
  const allCols = new Set<number>();
  let rosterRowsWithoutColumns = 0;

  for (const r of roster.rows) {
    const d = dayOf(r.SchedDate);
    if (d < 1) continue;

    const hours = num(r.Seconds) / 3600;
    const cols = num(r.Cols);
    if (cols === 0) rosterRowsWithoutColumns++;

    const row = byDay.get(d) ?? {
      day: d, hygienists: 0, columns: 0, slots: 0,
      booked: 0, showed: 0, missed: 0, open: 0,
      srp: 0, nhne: 0,
    };

    // An hour in a column is a slot. Two columns, two slots an hour.
    row.slots += hours * cols;
    byDay.set(d, row);

    if (!provsByDay.has(d)) provsByDay.set(d, new Set());
    provsByDay.get(d)!.add(num(r.ProvNum));

    if (!colsByDay.has(d)) colsByDay.set(d, new Set());
    for (const op of String(r.Ops ?? "").split(",")) {
      const n = Number(op.trim());
      if (Number.isFinite(n) && n > 0) {
        colsByDay.get(d)!.add(n);
        allCols.add(n);
      }
    }
  }

  for (const [d, row] of byDay) {
    row.slots = Math.round(row.slots);
    row.hygienists = provsByDay.get(d)?.size ?? 0;
    row.columns = colsByDay.get(d)?.size ?? 0;
  }

  // ---- 2b. The office's own hygiene columns ----
  //
  // Only used on a day with no hygienist rostered. The doctors still see
  // hygiene patients on those days, and that work counts - it simply has
  // no hygiene slots behind it, so the day reads 0 slots and whatever
  // was booked and seen.
  const ticked = await shortQueryAll(
    auth,
    `SELECT OperatoryNum FROM operatory WHERE IsHygiene = 1 AND IsHidden = 0`,
  );

  if (ticked.failed) return fail("Could not read this office's hygiene columns.", ticked.failed);

  const tickedCols = new Set<number>();
  for (const r of ticked.rows) {
    const n = num(r.OperatoryNum);
    if (n > 0) {
      tickedCols.add(n);
      allCols.add(n);
    }
  }

  // Nobody rostered all month and no hygiene column either.
  if (allCols.size === 0) {
    return json({
      ok: true,
      office: officeRow.slug,
      office_name: officeRow.name,
      year, month, days_in_month: days,
      days: [],
      totals: { slots: 0, booked: 0, showed: 0, missed: 0, open: 0, days_open: 0 },
      note: "No hygienist was rostered at this office in this month.",
    });
  }

  const colList = [...allCols].join(",");

  // Which columns count on a given day.
  //
  // With a hygienist rostered, hers and only hers - otherwise HG-PN's
  // two production columns would keep counting on the days she is not
  // in, and the ortho work sitting in them would read as hygiene.
  //
  // With nobody rostered, the office's own hygiene columns, because a
  // doctor still sees hygiene patients in them.
  const countsThatDay = (day: number, op: number): boolean => {
    const rostered = colsByDay.get(day);
    if (rostered && rostered.size > 0) return rostered.has(op);
    return tickedCols.has(op);
  };

  // ---- 3. Every appointment that belongs to a hygiene day ----
  //
  // One read, one set of appointments, and both the day rows and the
  // day panel are counted from it. Counting them two different ways is
  // what put 15 in the row and 16 in the list for 1 August.
  //
  // An appointment belongs to a day if it sat in one of that day's
  // hygiene columns on that date - whether it is still there now or was
  // moved somewhere else during the day. Its own status says what
  // happened; the column it finished in says nothing.
  const hygIn = HYGIENE_CODES.map((c) => `'${c}'`).join(",");
  const srpIn = SRP_CODES.map((c) => `'${c}'`).join(",");
  const cleanIn = CLEANING_CODES.map((c) => `'${c}'`).join(",");
  const examIn = EXAM_CODES.map((c) => `'${c}'`).join(",");

  const posted = (list: string) =>
    `EXISTS (SELECT 1 FROM procedurelog pl JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum ` +
    `WHERE pl.AptNum = a.AptNum AND pl.ProcStatus = ${APT_COMPLETE} AND pc.ProcCode IN (${list}))`;

  const postedAnything =
    `EXISTS (SELECT 1 FROM procedurelog pl WHERE pl.AptNum = a.AptNum ` +
    `AND pl.ProcStatus = ${APT_COMPLETE})`;

  // The hygiene column it occupied on its own date, from the history if
  // it has since been moved.
  const hygieneOp =
    `COALESCE((SELECT MIN(h.Op) FROM histappointment h ` +
    `          WHERE h.AptNum = a.AptNum AND h.Op IN (${colList}) ` +
    `            AND DATE(h.AptDateTime) = DATE(a.AptDateTime)), a.Op)`;

  const onTheDay = await shortQueryAll(
    auth,
    `SELECT DATE(a.AptDateTime) AS D, a.AptNum, a.PatNum, a.AptStatus, ` +
      `${hygieneOp} AS HygOp, ` +
      `${posted(cleanIn)} AS Clean, ${posted(examIn)} AS Exam, ` +
      `${posted(srpIn)} AS Srp, ${postedAnything} AS Posted ` +
      `FROM appointment a ` +
      `WHERE a.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
      `AND a.AptDateTime >= '${first}' AND a.AptDateTime < '${afterLast}' ` +
      `AND (a.Op IN (${colList}) OR EXISTS (SELECT 1 FROM histappointment h2 ` +
      `     WHERE h2.AptNum = a.AptNum AND h2.Op IN (${colList}) ` +
      `       AND DATE(h2.AptDateTime) = DATE(a.AptDateTime)))`,
  );

  if (onTheDay.failed) {
    return fail("Could not read this month's hygiene appointments.", onTheDay.failed);
  }

  // ---- 4. What each day was holding when it began ----
  //
  // Midnight, not the end of the day: the cancellations are moved out
  // as the day runs, so by closing time the columns look untouched.
  const snapshot = await shortQueryAll(
    auth,
    `SELECT DATE(h.AptDateTime) AS D, h.AptNum, h.PatNum, h.Op ` +
      `FROM histappointment h ` +
      `WHERE h.Op IN (${colList}) ` +
      `AND h.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
      `AND h.AptDateTime >= '${first}' AND h.AptDateTime < '${afterLast}' ` +
      `AND h.HistApptNum = (SELECT MAX(h2.HistApptNum) FROM histappointment h2 ` +
      `                     WHERE h2.AptNum = h.AptNum ` +
      `                       AND h2.HistDateTStamp < DATE(h.AptDateTime)) ` +
      `GROUP BY h.AptNum`,
  );

  if (snapshot.failed) {
    return fail("Could not read what each day was holding when it began.", snapshot.failed);
  }

  // ---- 5. Count the days, by patient ----
  //
  // A person is one patient however many appointments they have on the
  // day, which is why every bucket is a set of patient numbers rather
  // than a count of rows.
  type DayWork = {
    heldPatients: Set<number>;
    heldNotDone: Set<number>;
    showed: Set<number>;
    srp: Set<number>;
    nhne: Set<number>;
    scheduledAhead: Set<number>;
  };

  const work = new Map<number, DayWork>();

  // A day with no hygienist rostered still gets a row if hygiene work
  // happened on it. The doctors see those patients; the day simply had
  // no hygiene slots behind it.
  const rowFor = (d: number): DayRow => {
    let row = byDay.get(d);
    if (!row) {
      row = {
        day: d, hygienists: 0, columns: 0, slots: 0,
        booked: 0, showed: 0, missed: 0, open: 0,
        srp: 0, nhne: 0,
      };
      byDay.set(d, row);
    }
    return row;
  };

  const workFor = (d: number): DayWork => {
    let w = work.get(d);
    if (!w) {
      w = {
        heldPatients: new Set(), heldNotDone: new Set(), showed: new Set(),
        srp: new Set(), nhne: new Set(), scheduledAhead: new Set(),
      };
      work.set(d, w);
    }
    return w;
  };

  const completed = new Set<number>();

  for (const r of onTheDay.rows) {
    const d = dayOf(r.D);
    if (d < 1 || d > days || !countsThatDay(d, num(r.HygOp))) continue;

    const w = workFor(d);
    rowFor(d);
    const patient = num(r.PatNum);

    if (num(r.AptStatus) !== APT_COMPLETE) {
      w.scheduledAhead.add(patient);
      continue;
    }

    completed.add(num(r.AptNum));

    // A cleaning and an exam is the whole visit. Anything short of that
    // is a charge nobody billed: the cleaning that was never posted, or
    // the exam that was never done.
    if (isTrue(r.Clean) && isTrue(r.Exam)) {
      w.showed.add(patient);
    } else if (isTrue(r.Srp)) {
      w.srp.add(patient);
    } else {
      w.nhne.add(patient);
    }
  }

  for (const r of snapshot.rows) {
    const d = dayOf(r.D);
    if (d < 1 || d > days || !countsThatDay(d, num(r.Op))) continue;

    const w = workFor(d);
    rowFor(d);
    const patient = num(r.PatNum);
    w.heldPatients.add(patient);

    // Held at midnight and never completed: the patient did not come.
    if (!completed.has(num(r.AptNum))) w.heldNotDone.add(patient);
  }

  // A patient who was held and also seen did come, so they are not a
  // miss even if a second appointment of theirs was cancelled.
  for (const w of work.values()) {
    for (const p of w.showed) w.heldNotDone.delete(p);
    for (const p of w.srp) w.heldNotDone.delete(p);
    for (const p of w.nhne) w.heldNotDone.delete(p);
  }

  // ---- 6. Finish each day ----
  const todayKey = localDate();
  const monthKey = `${year}-${pad(month)}`;
  const todayIsThisMonth = todayKey.slice(0, 7) === monthKey;
  const todayDay = todayIsThisMonth ? Number(todayKey.slice(8, 10)) : 0;
  const monthIsPast = monthKey < todayKey.slice(0, 7);

  const out: DayRow[] = [];

  for (let d = 1; d <= days; d++) {
    const row = byDay.get(d);
    if (!row) continue;

    const w = work.get(d);
    const been = monthIsPast || (todayIsThisMonth && d <= todayDay);

    if (w) {
      row.showed = w.showed.size;
      row.srp = w.srp.size;
      row.nhne = w.nhne.size;
      row.missed = been ? w.heldNotDone.size : 0;

      // Everyone the day involved, each person once: held at midnight,
      // seen on the day, or still to come.
      const everyone = new Set<number>([
        ...w.heldPatients, ...w.showed, ...w.srp, ...w.nhne, ...w.scheduledAhead,
      ]);
      row.booked = everyone.size;
    }

    row.open = Math.max(0, row.slots - row.booked);
    out.push(row);
  }

  const totals = out.reduce(
    (t, r) => ({
      slots: t.slots + r.slots,
      booked: t.booked + r.booked,
      showed: t.showed + r.showed,
      missed: t.missed + r.missed,
      open: t.open + r.open,
      srp: t.srp + r.srp,
      nhne: t.nhne + r.nhne,
      days_open: t.days_open + 1,
    }),
    {
      slots: 0, booked: 0, showed: 0, missed: 0, open: 0,
      srp: 0, nhne: 0, days_open: 0,
    },
  );

  // How many different hygienists worked at all this month, which is not
  // the sum of the daily counts - the same person works many days.
  const hygienists = new Set<number>();
  for (const set of provsByDay.values()) {
    for (const p of set) hygienists.add(p);
  }

  // Hygienist-days: one hygienist working one day. This is the sum, so
  // 3 of them on a Saturday counts 3.
  const rdhDays = out.reduce((sum, r) => sum + r.hygienists, 0);

  // Days open counts a day the office worked hygiene at all, whether or
  // not a hygienist was rostered for it.

  return json({
    ok: true,
    office: officeRow.slug,
    office_name: officeRow.name,
    year,
    month,
    days_in_month: days,
    days: out,
    totals: { ...totals, hygienists: hygienists.size, rdh_days: rdhDays },
    // Worth surfacing rather than hiding: a roster entry with no
    // columns on it contributes no slots, so the day reads light.
    roster_rows_without_columns: rosterRowsWithoutColumns,
    read_at: new Date().toISOString(),
  });
});
