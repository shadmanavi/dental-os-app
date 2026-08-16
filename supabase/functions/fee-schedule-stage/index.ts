// =====================================================================
// Dental OS - Edge Function: fee-schedule-stage
//
// Purpose: take a payer CSV, match every row to a procedure code by CDT
// code, compare against the fees currently in OpenDental, and stage the
// result in fee_schedules + fee_schedule_items for review.
//
// Writes nothing to OpenDental. The only writes are to our own staging
// tables, and only when dry_run is false.
//
// Deploy path: supabase/functions/fee-schedule-stage/index.ts
// Version: 3
// Changelog:
//   v1  Initial: parse, match on CDT, diff against OpenDental, stage rows.
//   v2  Stopped writing fee_delta (it is a generated column in Postgres).
//   v3  Records the target schedule's name, not just its number, so the review
//       screen can show a human-readable identity. Rows now default to
//       include_in_push = false; the reviewer opts in.
//
// Required secrets (Project Settings -> Edge Functions -> Secrets):
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
//
// Call:
//   POST /functions/v1/fee-schedule-stage
//   Authorization: Bearer <user access token>
//   Body:
//   {
//     "office_id": "<offices.id uuid>",
//     "csv": "<raw CSV text>",
//     "source_filename": "Delta_Dental_Fee_Schedule_Downey.csv",
//     "target": { "mode": "existing", "od_fee_sched_num": 123,
//                  "name": "Dental OS TEST 001" }
//        or:    { "mode": "new", "name": "Delta Dental PPO 2026" },
//     "column_map": { "code": "Procedure", "description": "Nomenclature",
//                     "fee": "PPO Contracted Fee" },   // optional
//     "dry_run": true                                   // defaults to true
//   }
//
// Matching key is the CDT code, normalized to uppercase with surrounding
// whitespace removed. Rows whose code is not in this office's
// procedure_codes_cache are staged as 'unmatched' and excluded from the
// push; they are informational, not errors.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OD_BASE_URL = "https://api.opendental.com/api/v1";

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const MAX_ROWS = 10000;

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

// ---------------------------------------------------------------------
// CSV parsing - handles quoted fields, embedded commas, and CRLF.
// ---------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM if the export carries one.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // Swallow; the following \n closes the row.
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Find a column index by trying each candidate against the headers.
function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);

  for (const candidate of candidates) {
    const target = normalizeHeader(candidate);
    const exact = normalized.indexOf(target);
    if (exact !== -1) return exact;
  }

  for (const candidate of candidates) {
    const target = normalizeHeader(candidate);
    const partial = normalized.findIndex(
      (h) => h.includes(target) || target.includes(h),
    );
    if (partial !== -1) return partial;
  }

  return -1;
}

const CODE_CANDIDATES = ["procedure", "proccode", "code", "cdt", "cdtcode", "procedurecode"];
const DESC_CANDIDATES = ["nomenclature", "description", "desc", "proceduredescription"];
const FEE_CANDIDATES = [
  "ppocontractedfee",
  "contractedfee",
  "fee",
  "amount",
  "allowedamount",
  "negotiatedfee",
];

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

// "$1,240.00" -> 1240, "" -> null
function parseFee(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

async function fetchAllPages(
  path: string,
  authHeader: string,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${OD_BASE_URL}${path}${sep}Limit=${PAGE_SIZE}&Offset=${page * PAGE_SIZE}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "application/json" },
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`OpenDental ${res.status} on ${path} (page ${page}): ${detail}`);
    }

    const body = await res.json();
    if (!Array.isArray(body)) {
      throw new Error(`Expected an array from ${path}, got ${typeof body}.`);
    }

    all.push(...body);
    if (body.length < PAGE_SIZE) break;
  }

  return all;
}

type StagedItem = {
  source_row_number: number;
  raw_proc_code: string;
  raw_description: string;
  raw_fee: string;
  proc_code: string | null;
  new_fee: number | null;
  od_codenum: number | null;
  od_fee_num: number | null;
  current_fee: number | null;
  fee_delta: number | null;
  match_status: string;
  include_in_push: boolean;
  error_message: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }

  // -------------------------------------------------------------------
  // 1. Authenticate
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
  // 2. Parse input
  // -------------------------------------------------------------------
  let body: {
    office_id?: string;
    csv?: string;
    source_filename?: string;
    target?: { mode?: string; od_fee_sched_num?: number; name?: string };
    column_map?: { code?: string; description?: string; fee?: string };
    dry_run?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const csvText = body.csv ?? "";
  const sourceFilename = (body.source_filename ?? "").trim();
  const dryRun = body.dry_run !== false; // defaults to true

  if (officeId === "") {
    return json({ ok: false, error: "office_id is required." }, 400);
  }
  if (csvText.trim() === "") {
    return json({ ok: false, error: "csv is required and cannot be empty." }, 400);
  }

  const targetMode = (body.target?.mode ?? "").toLowerCase().trim();
  const targetSchedNum = Number(body.target?.od_fee_sched_num);
  const targetName = (body.target?.name ?? "").trim();

  if (targetMode !== "existing" && targetMode !== "new") {
    return json({
      ok: false,
      error: "target.mode must be 'existing' or 'new'.",
    }, 400);
  }
  if (targetMode === "existing" && (!Number.isInteger(targetSchedNum) || targetSchedNum <= 0)) {
    return json({
      ok: false,
      error: "target.od_fee_sched_num must be a positive integer when mode is 'existing'.",
    }, 400);
  }
  if (targetMode === "new" && targetName === "") {
    return json({
      ok: false,
      error: "target.name is required when mode is 'new'.",
    }, 400);
  }

  // -------------------------------------------------------------------
  // 3. Resolve the office through RLS
  // -------------------------------------------------------------------
  const { data: officeRow, error: officeError } = await supabase
    .from("offices")
    .select("id, slug, name, opendental_customer_key_name, is_active")
    .eq("id", officeId)
    .maybeSingle();

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
      office: officeRow.name,
      error: "This office has no recognized OpenDental key configured.",
    }, 500);
  }

  // -------------------------------------------------------------------
  // 4. Parse the CSV and locate its columns
  // -------------------------------------------------------------------
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return json({
      ok: false,
      error: "The CSV needs a header row and at least one data row.",
    }, 400);
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  if (dataRows.length > MAX_ROWS) {
    return json({
      ok: false,
      error: `That file has ${dataRows.length} rows, above the ${MAX_ROWS} row limit.`,
    }, 400);
  }

  const codeIdx = body.column_map?.code
    ? findColumn(headers, [body.column_map.code])
    : findColumn(headers, CODE_CANDIDATES);
  const descIdx = body.column_map?.description
    ? findColumn(headers, [body.column_map.description])
    : findColumn(headers, DESC_CANDIDATES);
  const feeIdx = body.column_map?.fee
    ? findColumn(headers, [body.column_map.fee])
    : findColumn(headers, FEE_CANDIDATES);

  if (codeIdx === -1 || feeIdx === -1) {
    return json({
      ok: false,
      error: "Couldn't find the procedure code and fee columns in that CSV.",
      headers_found: headers,
      hint: "Pass column_map with the exact header names to override detection.",
    }, 400);
  }

  // -------------------------------------------------------------------
  // 5. Load this office's procedure codes (the matching table)
  // -------------------------------------------------------------------
  const codeByProc = new Map<string, { od_codenum: number }>();
  const CACHE_PAGE = 1000;

  for (let from = 0; ; from += CACHE_PAGE) {
    const { data: cacheRows, error: cacheError } = await supabase
      .from("procedure_codes_cache")
      .select("proc_code, od_codenum")
      .eq("office_id", officeRow.id)
      .range(from, from + CACHE_PAGE - 1);

    if (cacheError) {
      return json({
        ok: false,
        error: `Couldn't read the procedure code cache: ${cacheError.message}`,
      }, 500);
    }

    for (const r of cacheRows ?? []) {
      const key = normalizeCode(String(r.proc_code ?? ""));
      if (key !== "" && !codeByProc.has(key)) {
        codeByProc.set(key, { od_codenum: Number(r.od_codenum) });
      }
    }

    if (!cacheRows || cacheRows.length < CACHE_PAGE) break;
  }

  if (codeByProc.size === 0) {
    return json({
      ok: false,
      office: officeRow.name,
      error: "No procedure codes are cached for this office.",
      hint: "Run od-sync-procedure-codes for this office first.",
    }, 400);
  }

  // -------------------------------------------------------------------
  // 6. For an existing schedule, read the fees currently in OpenDental
  //
  // The /fees filter parameter is FeeSched, not FeeSchedNum. The wrong
  // name is silently ignored and returns every fee in the database, so
  // the result is re-filtered client-side as a second guard.
  // -------------------------------------------------------------------
  const currentByCodeNum = new Map<number, { amount: number | null; fee_num: number | null }>();
  let currentFeeCount = 0;

  if (targetMode === "existing") {
    const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
    const customerKey = Deno.env.get(secretName);

    const missing: string[] = [];
    if (!developerKey) missing.push("OD_DEVELOPER_KEY");
    if (!customerKey) missing.push(secretName);
    if (missing.length > 0) {
      return json({ ok: false, error: "Missing Edge Function secrets.", missing }, 500);
    }

    const odAuth = `ODFHIR ${developerKey}/${customerKey}`;

    let feesRaw: Record<string, unknown>[];
    try {
      feesRaw = await fetchAllPages(`/fees?FeeSched=${targetSchedNum}`, odAuth);
    } catch (err) {
      return json({
        ok: false,
        office: officeRow.name,
        error: "Couldn't read current fees from OpenDental.",
        detail: String(err),
      }, 502);
    }

    const fees = feesRaw.filter((f) => Number(f.FeeSched) === targetSchedNum);

    if (feesRaw.length > 0 && fees.length === 0) {
      return json({
        ok: false,
        office: officeRow.name,
        error:
          `OpenDental returned ${feesRaw.length} fee rows, none belonging to schedule ` +
          `${targetSchedNum}. Refusing to stage against an unfiltered result.`,
      }, 502);
    }

    for (const f of fees) {
      const codeNum = Number(f.CodeNum);
      if (!Number.isFinite(codeNum)) continue;
      const amountRaw = f.Amount;
      const amount = amountRaw === null || amountRaw === undefined || amountRaw === ""
        ? null
        : Number(amountRaw);
      currentByCodeNum.set(codeNum, {
        amount: Number.isFinite(amount as number) ? (amount as number) : null,
        fee_num: Number.isFinite(Number(f.FeeNum)) ? Number(f.FeeNum) : null,
      });
    }

    currentFeeCount = fees.length;
  }

  // -------------------------------------------------------------------
  // 7. Build the staged rows
  // -------------------------------------------------------------------
  const items: StagedItem[] = [];
  const seenCodes = new Map<string, number>(); // normalized code -> first row number

  let matched = 0;
  let unmatched = 0;
  let noChange = 0;
  let ambiguous = 0;
  let changed = 0;
  let deltaTotal = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 2; // 1-based, and the header occupies row 1

    const rawCode = (row[codeIdx] ?? "").trim();
    const rawDesc = descIdx === -1 ? "" : (row[descIdx] ?? "").trim();
    const rawFee = (row[feeIdx] ?? "").trim();

    const code = normalizeCode(rawCode);
    const newFee = parseFee(rawFee);

    const item: StagedItem = {
      source_row_number: rowNumber,
      raw_proc_code: rawCode,
      raw_description: rawDesc,
      raw_fee: rawFee,
      proc_code: code === "" ? null : code,
      new_fee: newFee,
      od_codenum: null,
      od_fee_num: null,
      current_fee: null,
      fee_delta: null,
      match_status: "unmatched",
      include_in_push: false,
      error_message: null,
    };

    if (code === "") {
      item.error_message = "No procedure code in this row.";
      items.push(item);
      unmatched++;
      continue;
    }

    if (newFee === null) {
      item.error_message = "Fee is missing or not a number.";
      items.push(item);
      unmatched++;
      continue;
    }

    // A repeated code in one file is ambiguous - flag it rather than guess.
    const firstSeen = seenCodes.get(code);
    if (firstSeen !== undefined) {
      item.match_status = "ambiguous";
      item.error_message = `Duplicate of row ${firstSeen} in this file.`;
      items.push(item);
      ambiguous++;
      continue;
    }
    seenCodes.set(code, rowNumber);

    const cached = codeByProc.get(code);
    if (!cached) {
      item.error_message = "Not in this office's OpenDental procedure codes.";
      items.push(item);
      unmatched++;
      continue;
    }

    item.od_codenum = cached.od_codenum;

    const current = currentByCodeNum.get(cached.od_codenum);
    item.current_fee = current?.amount ?? null;
    item.od_fee_num = current?.fee_num ?? null;

    if (item.current_fee !== null) {
      item.fee_delta = Math.round((newFee - item.current_fee) * 100) / 100;
    }

    if (item.current_fee !== null && item.fee_delta === 0) {
      item.match_status = "no_change";
      item.include_in_push = false;
      noChange++;
    } else {
      item.match_status = "matched";
      // Reviewer opts in; nothing is selected for push by default.
      item.include_in_push = false;
      matched++;
      changed++;
      if (item.fee_delta !== null) deltaTotal += item.fee_delta;
    }

    items.push(item);
  }

  deltaTotal = Math.round(deltaTotal * 100) / 100;

  const summary = {
    office: officeRow.name,
    target_mode: targetMode,
    target_fee_sched_num: targetMode === "existing" ? targetSchedNum : null,
    target_name: targetName === "" ? null : targetName,
    source_filename: sourceFilename === "" ? null : sourceFilename,
    columns_used: {
      code: headers[codeIdx],
      description: descIdx === -1 ? null : headers[descIdx],
      fee: headers[feeIdx],
    },
    total_rows: dataRows.length,
    matched,
    no_change: noChange,
    unmatched,
    ambiguous,
    changed,
    fee_delta_total: deltaTotal,
    current_fees_in_schedule: currentFeeCount,
    procedure_codes_cached: codeByProc.size,
  };

  // -------------------------------------------------------------------
  // 8. Dry run stops here
  // -------------------------------------------------------------------
  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      ...summary,
      sample: items.slice(0, 10),
      note: "Nothing was written. Send dry_run: false to stage this for review.",
    });
  }

  // -------------------------------------------------------------------
  // 9. Write the staging rows
  // -------------------------------------------------------------------
  const { data: scheduleRow, error: insertError } = await supabase
    .from("fee_schedules")
    .insert({
      office_id: officeRow.id,
      name: targetName !== ""
        ? targetName
        : `Import into schedule ${targetSchedNum}`,
      source_filename: sourceFilename === "" ? null : sourceFilename,
      od_fee_sched_num: targetMode === "existing" ? targetSchedNum : null,
      od_fee_sched_desc: targetMode === "existing" && targetName !== "" ? targetName : null,
      status: "draft",
      row_count: dataRows.length,
      matched_count: matched,
      unmatched_count: unmatched + ambiguous,
      changed_count: changed,
      uploaded_by: userData.user.id,
    })
    .select("id")
    .single();

  if (insertError || !scheduleRow) {
    return json({
      ok: false,
      error: `Couldn't create the staging record: ${insertError?.message ?? "unknown error"}`,
    }, 500);
  }

  const scheduleId = scheduleRow.id;

  const payload = items.map((item) => ({
    fee_schedule_id: scheduleId,
    office_id: officeRow.id,
    source_row_number: item.source_row_number,
    raw_proc_code: item.raw_proc_code,
    raw_description: item.raw_description,
    raw_fee: item.raw_fee,
    proc_code: item.proc_code,
    new_fee: item.new_fee,
    od_codenum: item.od_codenum,
    od_fee_num: item.od_fee_num,
    current_fee: item.current_fee,
    // fee_delta is a generated column (new_fee - current_fee); the database
    // computes it and rejects any value sent for it.
    match_status: item.match_status,
    push_status: "pending",
    include_in_push: item.include_in_push,
    error_message: item.error_message,
  }));

  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error: itemsError } = await supabase
      .from("fee_schedule_items")
      .insert(payload.slice(i, i + CHUNK));

    if (itemsError) {
      await supabase
        .from("fee_schedules")
        .update({
          status: "failed",
          error_message: `Row insert failed at ${i}: ${itemsError.message}`,
        })
        .eq("id", scheduleId);

      return json({
        ok: false,
        fee_schedule_id: scheduleId,
        error: `Couldn't stage the rows: ${itemsError.message}`,
        rows_written: i,
      }, 500);
    }
  }

  return json({
    ok: true,
    dry_run: false,
    fee_schedule_id: scheduleId,
    ...summary,
    staged_by: userData.user.email,
    staged_at: new Date().toISOString(),
  });
});
