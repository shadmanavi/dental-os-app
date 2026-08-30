// =====================================================================
// Dental OS - Edge Function: od-production
//
// One month of production, a day to a row: what the book promised in
// dollars, how many patients it named, how many came, what was actually
// produced - and who left no note behind.
//
// Reads only. Nothing is written to OpenDental or to Supabase.
//
// Deploy path: supabase/functions/od-production/index.ts
// Version: 4
//
// Actions:
//   { "office":"downey", "action":"month", "year":2026, "month":8 }
//   { "office":"downey", "action":"day", "year":2026, "month":8, "day":12 }
//   { "office":"downey", "action":"providers", "year":2026, "month":8 }
//
// ---------------------------------------------------------------------
// Changelog
//
//   v4  providers carries each provider's specialty, read from
//       definition category 35 the way the hygiene dashboard does,
//       so the summary can seat doctors and hygienists at separate
//       tables. A provider with no specialty on file is treated as
//       general practice rather than invented into a specialty.
//
//   v3  New action providers, for the Provider Summary page: each
//       provider by full name, the days OpenDental's roster scheduled
//       them against the days they actually produced, patients,
//       production, and the undocumented count. Cheaper than month -
//       it skips the book and the midnight snapshot, which are the
//       heavy reads, and adds one small roster query instead.
//
//   v2  Each month day row carries its own per-provider breakdown, so
//       the screen can open a day in place without another read. It
//       folds out of the same (day, provider, patient) groups the day
//       rows were already counted from - no extra OpenDental call.
//
//   v1  First build. Month rows, day panel, per-provider month totals,
//       and the no-note check.
//
// ---------------------------------------------------------------------
// How each number is worked out, and why
//
//   Production is the completed procedure, on the day it was completed.
//
//     SUM of ProcFee times its units for every procedurelog row with
//     ProcStatus 2 and that ProcDate. Units are UnitQty plus BaseUnits,
//     floored at 1 because a row with neither still charged its fee.
//     This is gross production - no write-offs, no adjustments - the
//     same figure OpenDental's own production report leads with.
//
//     It follows the procedure's provider (procedurelog.ProvNum), not
//     the appointment's, so an exam the dentist did inside a hygiene
//     visit lands on the dentist.
//
//   Scheduled production is what the book promised.
//
//     Every procedure attached to an appointment, summed by fee,
//     whatever its status - treatment planned before the visit,
//     complete after - because attachment is the promise. For a day
//     gone, the appointments are the ones held at midnight, read from
//     the history the same way the hygiene dashboard does: the misses
//     are re-dated on their way into the Cancelled column, so the live
//     row no longer says which day it was ever for. For a day ahead,
//     simply what stands in the book now.
//
//   Showed is a patient, not an appointment.
//
//     A patient with a completed appointment that day, or with
//     completed work posted that day - a delivery or an adjustment is
//     sometimes posted with no appointment behind it, and that patient
//     was seen. One person with two appointments is one show.
//
//   Missed is held at midnight and completed nothing. Never counted on
//   its own, for the same re-dating reason as above.
//
//   No note is the error column: a patient seen that day - work
//   completed, fees posted - with not one word of clinical note on any
//   of it. The check reads each procedure's latest procnote version
//   (procnote is versioned; the old text stays), and a group note on
//   the visit counts, because that is where many offices write the
//   day's story. A patient is undocumented only when every completed
//   procedure of theirs that day comes back blank.
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

// appointment.AptStatus / procedurelog.ProcStatus, confirmed live.
const APT_SCHEDULED = 1;
const APT_COMPLETE = 2;
const PROC_COMPLETE = 2;

// ProcFee times its units, floored at 1: a row with no units still
// charged its fee. The alias is the procedurelog table in the query.
const fee = (pl: string) =>
  `(${pl}.ProcFee * GREATEST(${pl}.UnitQty + ${pl}.BaseUnits, 1))`;

// Everything attached to an appointment, whatever its status. The
// attachment is the promise; before the visit the rows are treatment
// planned, after it they are complete, and the promise reads the same.
const attachedFee = (aptCol: string) =>
  `(SELECT COALESCE(SUM(${fee("pl")}), 0) FROM procedurelog pl ` +
  `WHERE pl.AptNum = ${aptCol})`;

// Whether the procedure's latest note version has anything in it.
// procnote files a new row per edit and keeps the old text, so only
// the newest row says what the note reads today.
const NOTED =
  `EXISTS (SELECT 1 FROM procnote pn WHERE pn.ProcNum = pl.ProcNum ` +
  `AND TRIM(pn.Note) <> '' ` +
  `AND pn.ProcNoteNum = (SELECT MAX(pn2.ProcNoteNum) FROM procnote pn2 ` +
  `WHERE pn2.ProcNum = pl.ProcNum))`;

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

const pad = (n: number) => String(n).padStart(2, "0");

// MySQL hands a boolean back as 1 or 0, sometimes as a string.
const isTrue = (v: unknown): boolean =>
  v === true || v === 1 || v === "1" || String(v ?? "").toLowerCase() === "true";

// Today in California, not UTC. toISOString() rolls the date over from
// mid-afternoon onwards and would call today a day gone.
function localDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
    month?: number;
    day?: number;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const action = (body.action ?? "").toLowerCase().trim();
  if (action !== "month" && action !== "day" && action !== "providers") {
    return json({ ok: false, error: "action must be month, day, or providers." }, 400);
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

  const patientName = `TRIM(CONCAT(pt.LName, ', ', pt.FName))`;

  // The latest history row written before the day began: what the day
  // was holding at midnight. The alias is the histappointment table.
  const heldAtMidnight = (h: string, dayExpr: string) =>
    `${h}.HistApptNum = (SELECT MAX(h2.HistApptNum) FROM histappointment h2 ` +
    `WHERE h2.AptNum = ${h}.AptNum AND h2.HistDateTStamp < ${dayExpr})`;

  // ===================================================================
  // providers — the month, a provider to a row
  //
  // For the Provider Summary page: who was scheduled to work how many
  // days, how many days they actually produced on, how many patients
  // they saw, what it added to, and how many of their patients have
  // no note. Full names, because a summary read by the owner should
  // not need the abbreviation key in their head.
  // ===================================================================
  if (action === "providers") {
    // Completed work, one group per (day, provider, patient) - the
    // same read the month rows are counted from.
    const prod = await shortQueryAll(
      auth,
      `SELECT DAYOFMONTH(pl.ProcDate) AS D, pl.ProvNum, pl.PatNum, ` +
        `SUM(${fee("pl")}) AS Prod, ` +
        `MAX(${NOTED}) AS Noted ` +
        `FROM procedurelog pl ` +
        `WHERE pl.ProcStatus = ${PROC_COMPLETE} ` +
        `AND pl.ProcDate >= '${first}' AND pl.ProcDate < '${afterLast}' ` +
        `GROUP BY DAYOFMONTH(pl.ProcDate), pl.ProvNum, pl.PatNum`,
    );

    if (prod.failed) return fail("Could not read this month's completed work.", prod.failed);

    // Names, whole, and the specialty each provider is filed under.
    const names = await shortQueryAll(
      auth,
      `SELECT ProvNum, Abbr, FName, LName, Specialty FROM provider`,
    );

    if (names.failed) return fail("Could not read this office's providers.", names.failed);

    // What the specialty numbers mean at this office. Category 35 is
    // the provider specialty list; the DefNums differ per office, so
    // they are read by name every time, as the hygiene dashboard does.
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

    // The roster: how many days OpenDental has each provider scheduled
    // to work this month. SchedType 1 is a provider's own schedule.
    const roster = await shortQueryAll(
      auth,
      `SELECT s.ProvNum, COUNT(DISTINCT s.SchedDate) AS SDays ` +
        `FROM schedule s ` +
        `WHERE s.SchedType = 1 AND s.ProvNum > 0 ` +
        `AND s.SchedDate >= '${first}' AND s.SchedDate < '${afterLast}' ` +
        `GROUP BY s.ProvNum`,
    );

    if (roster.failed) return fail("Could not read this month's roster.", roster.failed);

    const nameOf = new Map<number, { abbr: string; full: string; specialty: string }>();
    for (const r of names.rows) {
      const abbr = String(r.Abbr ?? "").trim();
      const full = `${String(r.FName ?? "").trim()} ${String(r.LName ?? "").trim()}`.trim();
      nameOf.set(num(r.ProvNum), {
        abbr,
        full: full !== "" ? full : abbr,
        specialty: specNameOf.get(num(r.Specialty)) ?? "",
      });
    }

    const schedDays = new Map<number, number>();
    for (const r of roster.rows) {
      schedDays.set(num(r.ProvNum), num(r.SDays));
    }

    // Whether anyone noted the patient's day, so one provider's group
    // note redeems the other provider's chart, as everywhere else.
    const notedByDayPatient = new Map<string, boolean>();
    for (const r of prod.rows) {
      const key = `${num(r.D)}:${num(r.PatNum)}`;
      notedByDayPatient.set(
        key,
        (notedByDayPatient.get(key) ?? false) || isTrue(r.Noted),
      );
    }

    type ProvFold = {
      days: Set<number>;
      patients: Set<number>;
      production: number;
      unnoted: Set<string>;
    };

    const byProv = new Map<number, ProvFold>();

    for (const r of prod.rows) {
      const d = num(r.D);
      if (d < 1 || d > days) continue;
      const provNum = num(r.ProvNum);
      let m = byProv.get(provNum);
      if (!m) {
        m = { days: new Set(), patients: new Set(), production: 0, unnoted: new Set() };
        byProv.set(provNum, m);
      }
      m.days.add(d);
      m.patients.add(num(r.PatNum));
      m.production += num(r.Prod);
      const key = `${d}:${num(r.PatNum)}`;
      if (!notedByDayPatient.get(key)) m.unnoted.add(key);
    }

    const providers = [...byProv.entries()]
      .map(([provNum, m]) => {
        const who = nameOf.get(provNum);
        const specialty = who?.specialty ?? "";
        const lower = specialty.toLowerCase();
        return {
          prov_num: provNum,
          abbr: who?.abbr || "—",
          name: who?.full || "—",
          specialty,
          is_hygienist: lower === "hygienist",
          // No specialty on file reads as general practice rather
          // than being invented into a specialty.
          is_gp: lower.startsWith("general") || specialty === "",
          days_scheduled: schedDays.get(provNum) ?? 0,
          days_worked: m.days.size,
          patients: m.patients.size,
          production: Math.round(m.production * 100) / 100,
          nonote: m.unnoted.size,
        };
      })
      .sort((a, b) => b.production - a.production);

    return json({
      ok: true,
      office: officeRow.slug,
      office_name: officeRow.name,
      year,
      month,
      providers,
      read_at: new Date().toISOString(),
    });
  }

  // ===================================================================
  // day — one day, named
  //
  // The month screen shows figures. This turns a figure back into
  // people: which providers produced what, who was booked, who came,
  // what each visit was worth, and whose chart has no note.
  //
  // Nothing is stored. Patient names are read from OpenDental and sent
  // to the screen, the same as the chart does, and go no further.
  // ===================================================================
  if (action === "day") {
    const date = `${year}-${pad(month)}-${pad(dayAsked)}`;

    // Every procedure completed that day, with its fee, its provider,
    // and whether its latest note version says anything.
    const procs = await shortQueryAll(
      auth,
      `SELECT pl.ProcNum, pl.PatNum, ${patientName} AS Patient, ` +
        `pl.ProvNum, COALESCE(pr.Abbr, '') AS Prov, pc.ProcCode, ` +
        `${fee("pl")} AS Fee, ${NOTED} AS Noted ` +
        `FROM procedurelog pl ` +
        `JOIN patient pt ON pt.PatNum = pl.PatNum ` +
        `JOIN procedurecode pc ON pc.CodeNum = pl.CodeNum ` +
        `LEFT JOIN provider pr ON pr.ProvNum = pl.ProvNum ` +
        `WHERE pl.ProcStatus = ${PROC_COMPLETE} AND pl.ProcDate = '${date}' ` +
        `ORDER BY pl.PatNum, pc.ProcCode`,
    );

    if (procs.failed) return fail("Could not read that day's completed work.", procs.failed);

    // The book as it stands now: completed visits, and on a day ahead
    // the appointments still to come.
    const appts = await shortQueryAll(
      auth,
      `SELECT a.AptNum, a.PatNum, ${patientName} AS Patient, ` +
        `TIME(a.AptDateTime) AS T, a.AptStatus, ` +
        `COALESCE(pr.Abbr, '') AS Prov, COALESCE(o.OpName, '') AS OpName, ` +
        `${attachedFee("a.AptNum")} AS Fee ` +
        `FROM appointment a ` +
        `JOIN patient pt ON pt.PatNum = a.PatNum ` +
        `LEFT JOIN provider pr ON pr.ProvNum = a.ProvNum ` +
        `LEFT JOIN operatory o ON o.OperatoryNum = a.Op ` +
        `WHERE a.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
        `AND DATE(a.AptDateTime) = '${date}' ` +
        `ORDER BY a.AptDateTime`,
    );

    if (appts.failed) return fail("Could not read that day's appointments.", appts.failed);

    // What the day was holding at midnight - where the misses' real
    // time and provider live, because the live row has been re-dated.
    const held = await shortQueryAll(
      auth,
      `SELECT h.AptNum, MAX(h.PatNum) AS PatNum, MAX(${patientName}) AS Patient, ` +
        `MAX(TIME(h.AptDateTime)) AS T, MAX(COALESCE(pr.Abbr, '')) AS Prov, ` +
        `MAX(COALESCE(o.OpName, '')) AS OpName, ` +
        `MAX(${attachedFee("h.AptNum")}) AS Fee ` +
        `FROM histappointment h ` +
        `JOIN patient pt ON pt.PatNum = h.PatNum ` +
        `LEFT JOIN provider pr ON pr.ProvNum = h.ProvNum ` +
        `LEFT JOIN operatory o ON o.OperatoryNum = h.Op ` +
        `WHERE h.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
        `AND DATE(h.AptDateTime) = '${date}' ` +
        `AND ${heldAtMidnight("h", `'${date}'`)} ` +
        `GROUP BY h.AptNum ORDER BY MAX(h.AptDateTime)`,
    );

    if (held.failed) return fail("Could not read what that day was holding.", held.failed);

    const been = date <= localDate();

    // ---- Fold the completed work by patient, and by provider ----
    type PatWork = {
      name: string;
      actual: number;
      noted: boolean;
      provs: Set<string>;
      codes: Map<string, number>;
    };

    type ProvWork = {
      name: string;
      production: number;
      procs: number;
      patients: Set<number>;
      unnoted: Set<number>;
    };

    const workByPatient = new Map<number, PatWork>();
    const workByProv = new Map<number, ProvWork>();

    for (const r of procs.rows) {
      const patient = num(r.PatNum);
      let p = workByPatient.get(patient);
      if (!p) {
        p = {
          name: String(r.Patient ?? "").trim(),
          actual: 0,
          noted: false,
          provs: new Set(),
          codes: new Map(),
        };
        workByPatient.set(patient, p);
      }
      p.actual += num(r.Fee);
      p.noted = p.noted || isTrue(r.Noted);
      const prov = String(r.Prov ?? "").trim();
      if (prov !== "") p.provs.add(prov);
      const code = String(r.ProcCode ?? "").trim();
      if (code !== "") p.codes.set(code, (p.codes.get(code) ?? 0) + 1);

      const provNum = num(r.ProvNum);
      let w = workByProv.get(provNum);
      if (!w) {
        w = {
          name: prov !== "" ? prov : "—",
          production: 0,
          procs: 0,
          patients: new Set(),
          unnoted: new Set(),
        };
        workByProv.set(provNum, w);
      }
      w.production += num(r.Fee);
      w.procs += 1;
      w.patients.add(patient);
    }

    // A patient is undocumented when every completed procedure of
    // theirs that day is blank - and they land on every provider who
    // worked on them, because each of those charts is short a note.
    for (const [patient, p] of workByPatient) {
      if (p.noted) continue;
      for (const w of workByProv.values()) {
        if (w.patients.has(patient)) w.unnoted.add(patient);
      }
    }

    // ---- The visits list: one line per patient ----
    type Visit = {
      pat_num: number;
      time: string;
      patient: string;
      providers: string;
      sched: number;
      actual: number;
      noted: boolean;
      codes: string;
      state: "showed" | "booked" | "missed";
    };

    // Scheduled dollars per patient: from the midnight book on a day
    // that has been, from the live book on a day ahead. A patient with
    // 2 appointments carries the sum of both.
    const schedByPatient = new Map<number, number>();
    const schedRows = been
      ? held.rows
      : appts.rows;
    for (const r of schedRows) {
      const patient = num(r.PatNum);
      schedByPatient.set(patient, (schedByPatient.get(patient) ?? 0) + num(r.Fee));
    }

    // The earliest time and named provider each patient has anywhere.
    const meta = new Map<number, { time: string; prov: string; name: string }>();
    for (const rows of [appts.rows, held.rows]) {
      for (const r of rows) {
        const patient = num(r.PatNum);
        const t = String(r.T ?? "");
        const existing = meta.get(patient);
        if (!existing || (t !== "" && t < existing.time)) {
          meta.set(patient, {
            time: t,
            prov: String(r.Prov ?? "").trim(),
            name: String(r.Patient ?? "").trim(),
          });
        }
      }
    }

    const doneAppt = new Set<number>();
    for (const r of appts.rows) {
      if (num(r.AptStatus) === APT_COMPLETE) doneAppt.add(num(r.PatNum));
    }

    const visits: Visit[] = [];
    const placed = new Set<number>();

    // Seen: a completed appointment, or completed work posted. Both
    // count, because a delivery is sometimes posted with no
    // appointment behind it, and that patient was in the chair.
    const seen = new Set<number>([...doneAppt, ...workByPatient.keys()]);
    for (const patient of seen) {
      placed.add(patient);
      const p = workByPatient.get(patient);
      const m = meta.get(patient);
      visits.push({
        pat_num: patient,
        time: m?.time ?? "",
        patient: p?.name ?? m?.name ?? "",
        providers: p ? [...p.provs].sort().join(" + ") : (m?.prov ?? ""),
        sched: schedByPatient.get(patient) ?? 0,
        actual: p?.actual ?? 0,
        noted: p?.noted ?? true,
        codes: p
          ? [...p.codes.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([c, n]) => (n > 1 ? `${c}×${n}` : c))
              .join(" ")
          : "",
        state: "showed",
      });
    }

    // Held at midnight and completed nothing: on a day that has been,
    // that patient is a miss. On a day ahead, still just booked.
    for (const r of held.rows) {
      const patient = num(r.PatNum);
      if (placed.has(patient)) continue;
      placed.add(patient);
      visits.push({
        pat_num: patient,
        time: String(r.T ?? ""),
        patient: String(r.Patient ?? "").trim(),
        providers: String(r.Prov ?? "").trim(),
        sched: schedByPatient.get(patient) ?? 0,
        actual: 0,
        noted: true,
        codes: "",
        state: been ? "missed" : "booked",
      });
    }

    // On the live book and not placed yet: still to come.
    for (const r of appts.rows) {
      const patient = num(r.PatNum);
      if (placed.has(patient)) continue;
      placed.add(patient);
      visits.push({
        pat_num: patient,
        time: String(r.T ?? ""),
        patient: String(r.Patient ?? "").trim(),
        providers: String(r.Prov ?? "").trim(),
        sched: been ? 0 : (schedByPatient.get(patient) ?? 0) || num(r.Fee),
        actual: 0,
        noted: true,
        codes: "",
        state: "booked",
      });
    }

    visits.sort((a, b) => a.time.localeCompare(b.time) || a.patient.localeCompare(b.patient));

    const providers = [...workByProv.entries()]
      .map(([provNum, w]) => ({
        prov_num: provNum,
        name: w.name,
        patients: w.patients.size,
        procs: w.procs,
        production: Math.round(w.production * 100) / 100,
        nonote: w.unnoted.size,
      }))
      .sort((a, b) => b.production - a.production);

    const sched = [...schedByPatient.values()].reduce((s, v) => s + v, 0);
    const actual = [...workByPatient.values()].reduce((s, p) => s + p.actual, 0);

    return json({
      ok: true,
      office: officeRow.slug,
      office_name: officeRow.name,
      date,
      providers,
      visits,
      counts: {
        sched: Math.round(sched * 100) / 100,
        actual: Math.round(actual * 100) / 100,
        patients: visits.length,
        showed: visits.filter((v) => v.state === "showed").length,
        missed: visits.filter((v) => v.state === "missed").length,
        nonote: visits.filter((v) => v.state === "showed" && !v.noted).length,
      },
      read_at: new Date().toISOString(),
    });
  }

  // ===================================================================
  // month — a day to a row
  // ===================================================================

  // ---- 1. Completed work, by day, provider and patient ----
  //
  // One group per (day, provider, patient): the fees summed, and
  // whether any of that patient's procedures under that provider
  // carries a note. The day rows, the per-provider month totals and
  // the no-note count all fold out of this one read.
  const prod = await shortQueryAll(
    auth,
    `SELECT DAYOFMONTH(pl.ProcDate) AS D, pl.ProvNum, pl.PatNum, ` +
      `SUM(${fee("pl")}) AS Prod, COUNT(*) AS Procs, ` +
      `MAX(${NOTED}) AS Noted ` +
      `FROM procedurelog pl ` +
      `WHERE pl.ProcStatus = ${PROC_COMPLETE} ` +
      `AND pl.ProcDate >= '${first}' AND pl.ProcDate < '${afterLast}' ` +
      `GROUP BY DAYOFMONTH(pl.ProcDate), pl.ProvNum, pl.PatNum`,
  );

  if (prod.failed) return fail("Could not read this month's completed work.", prod.failed);

  // ---- 2. The live book ----
  const liveBook = await shortQueryAll(
    auth,
    `SELECT DAYOFMONTH(a.AptDateTime) AS D, a.AptNum, a.PatNum, ` +
      `a.ProvNum, a.AptStatus, ${attachedFee("a.AptNum")} AS Fee ` +
      `FROM appointment a ` +
      `WHERE a.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
      `AND a.AptDateTime >= '${first}' AND a.AptDateTime < '${afterLast}'`,
  );

  if (liveBook.failed) return fail("Could not read this month's appointments.", liveBook.failed);

  // ---- 3. What each day was holding when it began ----
  //
  // Midnight, not the end of the day: the cancellations are moved out
  // as the day runs. Grouped per day and appointment, because one
  // appointment can sit on 2 days' books - missed on the 1st, rebooked
  // to the 3rd, missed again.
  const snapshot = await shortQueryAll(
    auth,
    `SELECT DAYOFMONTH(h.AptDateTime) AS D, h.AptNum, ` +
      `MAX(h.PatNum) AS PatNum, MAX(${attachedFee("h.AptNum")}) AS Fee ` +
      `FROM histappointment h ` +
      `WHERE h.AptStatus IN (${APT_SCHEDULED}, ${APT_COMPLETE}) ` +
      `AND h.AptDateTime >= '${first}' AND h.AptDateTime < '${afterLast}' ` +
      `AND ${heldAtMidnight("h", "DATE(h.AptDateTime)")} ` +
      `GROUP BY DAYOFMONTH(h.AptDateTime), h.AptNum`,
  );

  if (snapshot.failed) {
    return fail("Could not read what each day was holding when it began.", snapshot.failed);
  }

  // ---- 4. Provider names, for the month strip ----
  const provNames = await shortQueryAll(
    auth,
    `SELECT ProvNum, Abbr FROM provider`,
  );

  if (provNames.failed) return fail("Could not read this office's providers.", provNames.failed);

  const abbrOf = new Map<number, string>();
  for (const r of provNames.rows) {
    abbrOf.set(num(r.ProvNum), String(r.Abbr ?? "").trim());
  }

  // ---- 5. Fold it all by day ----
  const todayKey = localDate();
  const monthKey = `${year}-${pad(month)}`;
  const todayIsThisMonth = todayKey.slice(0, 7) === monthKey;
  const todayDay = todayIsThisMonth ? Number(todayKey.slice(8, 10)) : 0;
  const monthIsPast = monthKey < todayKey.slice(0, 7);
  const wasOrIsToday = (d: number) => monthIsPast || (todayIsThisMonth && d <= todayDay);

  type DayFold = {
    actual: number;
    prodProvs: Set<number>;
    prodPatients: Set<number>;
    notedByPatient: Map<number, boolean>;
    liveSched: number;
    livePatients: Set<number>;
    liveProvs: Set<number>;
    doneAppt: Set<number>;
    heldSched: number;
    heldPatients: Set<number>;
  };

  const fold = new Map<number, DayFold>();
  const foldFor = (d: number): DayFold => {
    let f = fold.get(d);
    if (!f) {
      f = {
        actual: 0,
        prodProvs: new Set(),
        prodPatients: new Set(),
        notedByPatient: new Map(),
        liveSched: 0,
        livePatients: new Set(),
        liveProvs: new Set(),
        doneAppt: new Set(),
        heldSched: 0,
        heldPatients: new Set(),
      };
      fold.set(d, f);
    }
    return f;
  };

  // Per-provider month totals: days worked, patients, production.
  type ProvMonth = {
    days: Set<number>;
    patients: Set<number>;
    production: number;
    unnoted: Set<string>;
  };
  const provMonth = new Map<number, ProvMonth>();
  const provMonthFor = (p: number): ProvMonth => {
    let m = provMonth.get(p);
    if (!m) {
      m = { days: new Set(), patients: new Set(), production: 0, unnoted: new Set() };
      provMonth.set(p, m);
    }
    return m;
  };

  // The same fold again, kept per day this time, so each day row can
  // carry its own provider breakdown and the screen can open a day in
  // place without another read.
  type DayProv = {
    patients: Set<number>;
    production: number;
    unnoted: Set<number>;
  };
  const provByDay = new Map<number, Map<number, DayProv>>();
  const dayProvFor = (d: number, p: number): DayProv => {
    let dayMap = provByDay.get(d);
    if (!dayMap) {
      dayMap = new Map();
      provByDay.set(d, dayMap);
    }
    let w = dayMap.get(p);
    if (!w) {
      w = { patients: new Set(), production: 0, unnoted: new Set() };
      dayMap.set(p, w);
    }
    return w;
  };

  for (const r of prod.rows) {
    const d = num(r.D);
    if (d < 1 || d > days) continue;
    const f = foldFor(d);
    const patient = num(r.PatNum);
    const provNum = num(r.ProvNum);

    f.actual += num(r.Prod);
    f.prodProvs.add(provNum);
    f.prodPatients.add(patient);
    f.notedByPatient.set(
      patient,
      (f.notedByPatient.get(patient) ?? false) || isTrue(r.Noted),
    );

    const m = provMonthFor(provNum);
    m.days.add(d);
    m.patients.add(patient);
    m.production += num(r.Prod);
    if (!isTrue(r.Noted)) m.unnoted.add(`${d}:${patient}`);

    const dp = dayProvFor(d, provNum);
    dp.patients.add(patient);
    dp.production += num(r.Prod);
    if (!isTrue(r.Noted)) dp.unnoted.add(patient);
  }

  // A provider's unnoted set was gathered per group; drop the pairs
  // another provider's note redeems. A visit is documented when anyone
  // wrote its note - one story per visit is how group notes work.
  for (const m of provMonth.values()) {
    for (const key of [...m.unnoted]) {
      const [dStr, patStr] = key.split(":");
      if (fold.get(Number(dStr))?.notedByPatient.get(Number(patStr))) {
        m.unnoted.delete(key);
      }
    }
  }

  for (const [d, dayMap] of provByDay) {
    for (const w of dayMap.values()) {
      for (const patient of [...w.unnoted]) {
        if (fold.get(d)?.notedByPatient.get(patient)) w.unnoted.delete(patient);
      }
    }
  }

  for (const r of liveBook.rows) {
    const d = num(r.D);
    if (d < 1 || d > days) continue;
    const f = foldFor(d);
    f.liveSched += num(r.Fee);
    f.livePatients.add(num(r.PatNum));
    f.liveProvs.add(num(r.ProvNum));
    if (num(r.AptStatus) === APT_COMPLETE) f.doneAppt.add(num(r.PatNum));
  }

  for (const r of snapshot.rows) {
    const d = num(r.D);
    if (d < 1 || d > days) continue;
    const f = foldFor(d);
    f.heldSched += num(r.Fee);
    f.heldPatients.add(num(r.PatNum));
  }

  // ---- 6. Finish each day ----
  type DayRow = {
    day: number;
    providers: number;
    sched: number;
    patients: number;
    showed: number;
    missed: number;
    actual: number;
    nonote: number;
    // Who produced what that day, so the screen can open the row in
    // place. Empty on a day still ahead - nothing is produced yet.
    provs: {
      prov_num: number;
      name: string;
      patients: number;
      production: number;
      nonote: number;
    }[];
  };

  const out: DayRow[] = [];
  const monthProvs = new Set<number>();

  for (let d = 1; d <= days; d++) {
    const f = fold.get(d);
    if (!f) continue;

    const been = wasOrIsToday(d);

    // Seen: a completed appointment or completed work posted.
    const seen = new Set<number>([...f.doneAppt, ...f.prodPatients]);

    // Everyone the day involved, each person once.
    const everyone = new Set<number>([
      ...f.heldPatients, ...f.livePatients, ...seen,
    ]);

    let missed = 0;
    for (const p of f.heldPatients) {
      if (!seen.has(p)) missed++;
    }

    let nonote = 0;
    for (const noted of f.notedByPatient.values()) {
      if (!noted) nonote++;
    }

    const provs = been ? f.prodProvs : f.liveProvs;
    for (const p of provs) monthProvs.add(p);

    out.push({
      day: d,
      providers: provs.size,
      // The promise: the midnight book for a day that has been, the
      // live book for a day ahead.
      sched: Math.round((been ? f.heldSched : f.liveSched) * 100) / 100,
      patients: been ? everyone.size : f.livePatients.size,
      showed: been ? seen.size : 0,
      missed: been ? missed : 0,
      actual: been ? Math.round(f.actual * 100) / 100 : 0,
      nonote: been ? nonote : 0,
      provs: [...(provByDay.get(d) ?? new Map<number, DayProv>()).entries()]
        .map(([provNum, w]) => ({
          prov_num: provNum,
          name: abbrOf.get(provNum) || "—",
          patients: w.patients.size,
          production: Math.round(w.production * 100) / 100,
          nonote: w.unnoted.size,
        }))
        .sort((a, b) => b.production - a.production),
    });
  }

  const totals = out.reduce(
    (t, r) => ({
      sched: t.sched + r.sched,
      patients: t.patients + r.patients,
      showed: t.showed + r.showed,
      missed: t.missed + r.missed,
      actual: t.actual + r.actual,
      nonote: t.nonote + r.nonote,
      provider_days: t.provider_days + r.providers,
      days_open: t.days_open + 1,
    }),
    {
      sched: 0, patients: 0, showed: 0, missed: 0,
      actual: 0, nonote: 0, provider_days: 0, days_open: 0,
    },
  );

  const providers = [...provMonth.entries()]
    .map(([provNum, m]) => ({
      prov_num: provNum,
      name: abbrOf.get(provNum) || "—",
      days: m.days.size,
      patients: m.patients.size,
      production: Math.round(m.production * 100) / 100,
      nonote: m.unnoted.size,
    }))
    .sort((a, b) => b.production - a.production);

  return json({
    ok: true,
    office: officeRow.slug,
    office_name: officeRow.name,
    year,
    month,
    days_in_month: days,
    days: out,
    totals: {
      ...totals,
      sched: Math.round(totals.sched * 100) / 100,
      actual: Math.round(totals.actual * 100) / 100,
      providers: monthProvs.size,
    },
    providers,
    read_at: new Date().toISOString(),
  });
});
