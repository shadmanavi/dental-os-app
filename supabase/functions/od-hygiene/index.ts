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
// Version: 2
//
// Actions:
//   { "office":"downey", "action":"month", "year":2026, "month":8 }
//
// ---------------------------------------------------------------------
// Changelog
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
      offset === 0 ? "/queries/ShortQuery" : `/queries/ShortQuery?Offset=${offset}`,
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
    month?: number;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const action = (body.action ?? "").toLowerCase().trim();
  if (action !== "month") {
    return json({ ok: false, error: "action must be month." }, 400);
  }

  const year = num(body.year);
  const month = num(body.month);

  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return json({ ok: false, error: "Give a year and a month from 1 to 12." }, 400);
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

  // Nobody rostered all month is a real answer, not an error.
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

  // A column only counts on a day the roster put somebody in it.
  //
  // Without this, HG-PN's two production columns would keep counting
  // on the days she is not in, and the ortho work sitting in them
  // would be read as hygiene.
  const rosteredThatDay = (day: number, op: number): boolean =>
    colsByDay.get(day)?.has(op) === true;

  // ---- 3. What is on the books, day by day ----
  const kept = await shortQueryAll(
    auth,
    `SELECT DATE(a.AptDateTime) AS D, a.Op, a.AptStatus, COUNT(*) AS N ` +
      `FROM appointment a ` +
      `WHERE a.Op IN (${colList}) AND a.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
      `AND a.AptDateTime >= '${first}' AND a.AptDateTime < '${afterLast}' ` +
      `GROUP BY DATE(a.AptDateTime), a.Op, a.AptStatus`,
  );

  if (kept.failed) return fail("Could not read this month's hygiene appointments.", kept.failed);

  // Held now: what stands in those columns today. This is the right
  // answer for a day still ahead, and the wrong one for a day gone,
  // because the missed appointments have been moved out of it.
  const heldNow = new Map<number, number>();

  for (const r of kept.rows) {
    const d = dayOf(r.D);
    const row = byDay.get(d);
    if (!row || !rosteredThatDay(d, num(r.Op))) continue;
    const n = num(r.N);
    heldNow.set(d, (heldNow.get(d) ?? 0) + n);
    if (num(r.AptStatus) === APT_COMPLETE) row.showed += n;
  }

  // ---- 4. What the day was holding when it began ----
  //
  // Missed is never counted directly. It is what the day was holding at
  // midnight less what actually happened, and that avoids the trap the
  // direct count fell into: a missed appointment gets parked in the
  // Cancelled column and OpenDental rewrites its date and time on the
  // way, so its own row no longer says which day it was for.
  //
  // Midnight, not the end of the day, because the cancellations are
  // moved out as the day runs - Saturday 8 August's were logged at
  // 07:49, 09:11, 12:04 and 15:00. By closing time they have gone from
  // the hygiene columns, and an end-of-day snapshot would report almost
  // nothing missed.
  const snapshot = await shortQueryAll(
    auth,
    `SELECT DATE(h.AptDateTime) AS D, COUNT(DISTINCT h.AptNum) AS N ` +
      `FROM histappointment h ` +
      `WHERE h.Op IN (${colList}) ` +
      `AND h.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
      `AND h.AptDateTime >= '${first}' AND h.AptDateTime < '${afterLast}' ` +
      `AND h.HistApptNum = (SELECT MAX(h2.HistApptNum) FROM histappointment h2 ` +
      `                     WHERE h2.AptNum = h.AptNum ` +
      `                       AND h2.HistDateTStamp < DATE(h.AptDateTime)) ` +
      `GROUP BY DATE(h.AptDateTime)`,
  );

  if (snapshot.failed) {
    return fail("Could not read what each day was holding when it began.", snapshot.failed);
  }

  const heldAtMidnight = new Map<number, number>();
  for (const r of snapshot.rows) {
    heldAtMidnight.set(dayOf(r.D), num(r.N));
  }

  // ---- 5. Finish each day and total the month ----
  //
  // A day that has been, or is running, is judged on what it held at
  // midnight. A day still ahead is judged on what stands in it now.
  //
  // Booked never reads below showed. Somebody walked in and was seen on
  // a day the snapshot did not know about - 15 August had 26 booked at
  // midnight and 31 seen - and reporting 5 negative misses would be
  // nonsense.
  const todayKey = new Date().toISOString().slice(0, 10);
  const monthKey = `${year}-${pad(month)}`;
  const todayIsThisMonth = todayKey.slice(0, 7) === monthKey;
  const todayDay = todayIsThisMonth ? Number(todayKey.slice(8, 10)) : 0;
  const monthIsPast = monthKey < todayKey.slice(0, 7);

  const out: DayRow[] = [];
  for (let d = 1; d <= days; d++) {
    const row = byDay.get(d);
    if (!row) continue;

    const been = monthIsPast || (todayIsThisMonth && d <= todayDay);

    row.booked = been
      ? Math.max(heldAtMidnight.get(d) ?? 0, row.showed)
      : heldNow.get(d) ?? 0;

    row.missed = been ? Math.max(0, row.booked - row.showed) : 0;
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
      days_open: t.days_open + 1,
    }),
    { slots: 0, booked: 0, showed: 0, missed: 0, open: 0, days_open: 0 },
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
