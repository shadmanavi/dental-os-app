// =====================================================================
// Dental OS - Edge Function: fee-schedule-push
//
// Purpose: write the approved rows of a staged fee schedule into
// OpenDental. Rows that already have a fee record are updated; rows
// that do not are created. Every attempt is written to fee_push_log.
//
// Deploy path: supabase/functions/fee-schedule-push/index.ts
// Version: 3
// Changelog:
//   v1  Initial: batched push, add vs update, audit logging.
//   v2  Verifies the audit log write. If a log row cannot be saved the push
//       stops rather than writing fees with no trail.
//   v3  A create refused as already existing becomes an update.
//
//       A schedule created fresh is staged as empty, because at staging
//       time it does not exist and there is nothing to read. OpenDental
//       can still hold a fee row against that schedule number, and the
//       create then comes back "A fee with that information already
//       exists in the database." The row was marked failed and the fee
//       never changed, so the schedule quietly kept an old amount —
//       D1556 at Maywood, and re-running could not clear it because the
//       second run made the same create.
//
//       The push now looks the fee up on that schedule for that code
//       and updates it. Both attempts are written to fee_push_log. If
//       the fee cannot be found after all, the row still fails, but it
//       says the fee was not there to find rather than repeating
//       OpenDental's message.
//
// Runs in batches. OpenDental has no bulk fee endpoint, so each fee is
// one HTTP call and a large schedule cannot finish inside a single
// function invocation. Each call processes up to `batch_size` pending
// rows and reports how many remain; the caller repeats until
// remaining is 0. Safe to re-run: rows already marked pushed are
// skipped, so a dropped connection costs at most one batch.
//
// Required secrets (Project Settings -> Edge Functions -> Secrets):
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
//
// Call:
//   POST /functions/v1/fee-schedule-push
//   Authorization: Bearer <user access token>
//   Body: { "fee_schedule_id": "<uuid>", "batch_size": 100 }
//
// Owner/Admin only. This is the one function that writes to OpenDental.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OD_BASE_URL = "https://api.opendental.com/api/v1";

const DEFAULT_BATCH = 100;
const MAX_BATCH = 250;

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

// OpenDental returns booleans as the strings "true"/"false".
function isTrue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

// How many fee rows to ask for at a time when hunting for one that
// OpenDental says already exists.
const FEE_PAGE_SIZE = 1000;
const FEE_MAX_PAGES = 20;

// OpenDental's refusal when a fee for this schedule and code is already
// in the table. Matched on the wording because the API returns 400 with
// a bare string and no code to test.
function saysAlreadyExists(responseText: string): boolean {
  return responseText.toLowerCase().includes("already exists");
}

// The FeeNum of the fee already sitting on this schedule for this code.
//
// Only called when a create was refused as a duplicate. A new schedule
// is staged as empty, because at staging time it does not exist yet and
// has nothing to read — but OpenDental can still hold a fee row against
// that schedule number, and then the create is refused and the fee is
// never written. This finds the row so it can be updated instead.
async function findExistingFeeNum(
  headers: Record<string, string>,
  feeSchedNum: number,
  codeNum: number,
): Promise<number | null> {
  for (let page = 0; page < FEE_MAX_PAGES; page++) {
    const url =
      `${OD_BASE_URL}/fees?FeeSched=${feeSchedNum}` +
      `&Limit=${FEE_PAGE_SIZE}&Offset=${page * FEE_PAGE_SIZE}`;

    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) return null;

    let rows: unknown;
    try {
      rows = JSON.parse(await res.text());
    } catch {
      return null;
    }
    if (!Array.isArray(rows)) return null;

    for (const row of rows as Record<string, unknown>[]) {
      // FeeSched is checked as well as filtered on: passing the filter
      // under the wrong name returns every fee in the database, and
      // that has happened here before.
      if (Number(row.FeeSched) !== feeSchedNum) continue;
      if (Number(row.CodeNum) !== codeNum) continue;
      const feeNum = Number(row.FeeNum);
      if (Number.isFinite(feeNum) && feeNum > 0) return feeNum;
    }

    if ((rows as unknown[]).length < FEE_PAGE_SIZE) break;
  }

  return null;
}

type PendingItem = {
  id: string;
  proc_code: string | null;
  od_codenum: number | null;
  od_fee_num: number | null;
  new_fee: number | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }

  // -------------------------------------------------------------------
  // 1. Authenticate and require Owner/Admin
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

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) {
    return json({ ok: false, error: `Permission check failed: ${adminError.message}` }, 500);
  }
  if (isAdmin !== true) {
    return json({
      ok: false,
      error: "Owner/Admin role required to write fees to OpenDental.",
    }, 403);
  }

  // -------------------------------------------------------------------
  // 2. Parse input
  // -------------------------------------------------------------------
  let body: { fee_schedule_id?: string; batch_size?: number };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const scheduleId = (body.fee_schedule_id ?? "").trim();
  if (scheduleId === "") {
    return json({ ok: false, error: "fee_schedule_id is required." }, 400);
  }

  let batchSize = body.batch_size === undefined ? DEFAULT_BATCH : Number(body.batch_size);
  if (!Number.isInteger(batchSize) || batchSize <= 0) batchSize = DEFAULT_BATCH;
  if (batchSize > MAX_BATCH) batchSize = MAX_BATCH;

  // -------------------------------------------------------------------
  // 3. Load the staged schedule (through RLS)
  // -------------------------------------------------------------------
  const { data: schedule, error: scheduleError } = await supabase
    .from("fee_schedules")
    .select("id, office_id, name, od_fee_sched_num, status, pushed_count, failed_count")
    .eq("id", scheduleId)
    .maybeSingle();

  if (scheduleError) {
    return json({ ok: false, error: `Lookup failed: ${scheduleError.message}` }, 500);
  }
  if (!schedule) {
    return json({
      ok: false,
      error: "That staged schedule wasn't found, or you don't have access to it.",
    }, 403);
  }
  if (schedule.status === "pushed") {
    return json({
      ok: false,
      schedule: schedule.name,
      error: "This schedule has already been pushed.",
    }, 400);
  }
  if (schedule.status === "cancelled") {
    return json({
      ok: false,
      schedule: schedule.name,
      error: "This schedule was cancelled.",
    }, 400);
  }

  // -------------------------------------------------------------------
  // 4. Credentials for this office
  // -------------------------------------------------------------------
  const { data: officeRow, error: officeError } = await supabase
    .from("offices")
    .select("id, name, opendental_customer_key_name, is_active")
    .eq("id", schedule.office_id)
    .maybeSingle();

  if (officeError || !officeRow) {
    return json({ ok: false, error: "Couldn't resolve the office for this schedule." }, 403);
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

  const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
  const customerKey = Deno.env.get(secretName);
  if (!developerKey || !customerKey) {
    return json({ ok: false, error: "Missing Edge Function secrets." }, 500);
  }

  const odAuth = `ODFHIR ${developerKey}/${customerKey}`;
  const odHeaders = {
    Authorization: odAuth,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // -------------------------------------------------------------------
  // 5. Make sure the target schedule exists in OpenDental
  //
  // A staged record with no od_fee_sched_num is a new schedule that has
  // not been created yet. Create it on the first batch and record the
  // number so later batches reuse it.
  // -------------------------------------------------------------------
  let feeSchedNum = schedule.od_fee_sched_num;

  if (feeSchedNum === null) {
    // Guard against creating a second copy if an earlier batch already
    // made it but failed before saving the number.
    let existingNum: number | null = null;
    try {
      const listRes = await fetch(`${OD_BASE_URL}/feescheds`, {
        method: "GET",
        headers: odHeaders,
      });
      if (listRes.ok) {
        const listed = await listRes.json();
        if (Array.isArray(listed)) {
          const match = listed.find(
            (s: Record<string, unknown>) =>
              String(s.Description ?? "").trim() === schedule.name.trim() &&
              !isTrue(s.IsHidden),
          );
          if (match) existingNum = Number(match.FeeSchedNum);
        }
      }
    } catch {
      // Non-fatal; fall through to creating it.
    }

    if (existingNum !== null && Number.isFinite(existingNum)) {
      feeSchedNum = existingNum;
    } else {
      // Send only the required fields. Optional fields cause a bare 400.
      const createBody = {
        Description: schedule.name,
        FeeSchedType: "Normal",
      };

      const createRes = await fetch(`${OD_BASE_URL}/feescheds`, {
        method: "POST",
        headers: odHeaders,
        body: JSON.stringify(createBody),
      });

      const createText = await createRes.text();

      const { error: createLogError } = await supabase.from("fee_push_log").insert({
        fee_schedule_id: schedule.id,
        office_id: officeRow.id,
        attempted_by: userData.user.id,
        http_method: "POST",
        endpoint: "/feescheds",
        request_body: createBody,
        response_status: createRes.status,
        response_body: { raw: createText.slice(0, 1000) },
        succeeded: createRes.ok,
        error_message: createRes.ok ? null : "Fee schedule creation failed.",
      });

      if (createLogError) {
        return json({
          ok: false,
          schedule: schedule.name,
          error: "Stopped: the audit log could not be written.",
          detail: createLogError.message,
        }, 500);
      }

      if (!createRes.ok) {
        await supabase
          .from("fee_schedules")
          .update({
            status: "failed",
            error_message: `Couldn't create the schedule in OpenDental: ${createText.slice(0, 300)}`,
          })
          .eq("id", schedule.id);

        return json({
          ok: false,
          schedule: schedule.name,
          error: "OpenDental rejected the new fee schedule.",
          detail: createText.slice(0, 300),
        }, 502);
      }

      try {
        const created = JSON.parse(createText);
        feeSchedNum = Number(created.FeeSchedNum);
      } catch {
        feeSchedNum = NaN;
      }

      if (!Number.isFinite(feeSchedNum as number) || (feeSchedNum as number) <= 0) {
        return json({
          ok: false,
          schedule: schedule.name,
          error: "OpenDental created the schedule but didn't return its number.",
          detail: createText.slice(0, 300),
        }, 502);
      }
    }

    await supabase
      .from("fee_schedules")
      .update({ od_fee_sched_num: feeSchedNum, od_fee_sched_desc: schedule.name })
      .eq("id", schedule.id);
  }

  // -------------------------------------------------------------------
  // 6. Mark the schedule as in progress
  // -------------------------------------------------------------------
  if (schedule.status !== "pushing") {
    await supabase
      .from("fee_schedules")
      .update({ status: "pushing" })
      .eq("id", schedule.id);
  }

  // -------------------------------------------------------------------
  // 7. Claim a batch of pending rows
  // -------------------------------------------------------------------
  const { data: pending, error: pendingError } = await supabase
    .from("fee_schedule_items")
    .select("id, proc_code, od_codenum, od_fee_num, new_fee")
    .eq("fee_schedule_id", schedule.id)
    .eq("include_in_push", true)
    .eq("match_status", "matched")
    .eq("push_status", "pending")
    .order("source_row_number")
    .limit(batchSize);

  if (pendingError) {
    return json({ ok: false, error: `Couldn't read pending rows: ${pendingError.message}` }, 500);
  }

  const batch = (pending ?? []) as PendingItem[];

  // -------------------------------------------------------------------
  // 8. Push this batch, one fee at a time
  // -------------------------------------------------------------------
  let added = 0;
  let updated = 0;
  let failed = 0;
  const failures: { proc_code: string | null; status: number; detail: string }[] = [];

  for (const item of batch) {
    const amount = item.new_fee;
    const codeNum = item.od_codenum;

    if (amount === null || codeNum === null) {
      await supabase
        .from("fee_schedule_items")
        .update({
          push_status: "failed",
          error_message: "Missing fee amount or procedure code number.",
        })
        .eq("id", item.id);
      failed++;
      continue;
    }

    let isUpdate = item.od_fee_num !== null;
    let endpoint = isUpdate ? `/fees/${item.od_fee_num}` : "/fees";
    let method = isUpdate ? "PUT" : "POST";
    let requestBody: Record<string, unknown> = isUpdate
      ? { Amount: String(amount) }
      : { Amount: String(amount), FeeSched: feeSchedNum, CodeNum: codeNum };

    let status = 0;
    let responseText = "";
    let networkError: string | null = null;

    // Set only when a refused create turned into an update of a fee
    // that was already there, so the row remembers which one it is.
    let recoveredFeeNum: number | null = null;

    const send = async () => {
      status = 0;
      responseText = "";
      networkError = null;
      try {
        const res = await fetch(`${OD_BASE_URL}${endpoint}`, {
          method,
          headers: odHeaders,
          body: JSON.stringify(requestBody),
        });
        status = res.status;
        responseText = await res.text();
      } catch (err) {
        networkError = String(err);
      }
    };

    await send();

    let succeeded = networkError === null && status >= 200 && status < 300;

    // ---- The fee is already there. Update it rather than give up ----
    //
    // A schedule created fresh is staged as empty, because at staging
    // time it does not exist and has nothing to read. OpenDental can
    // still be holding a fee row against that schedule number, and then
    // the create comes back refused and the fee never lands — which is
    // how D1556 at Maywood ended up with the old amount and a failure
    // on the screen.
    //
    // Both attempts are logged. The first one happened and the audit
    // trail does not get to skip it.
    if (!succeeded && !isUpdate && saysAlreadyExists(responseText)) {
      const { error: firstLogError } = await supabase.from("fee_push_log").insert({
        fee_schedule_id: schedule.id,
        fee_schedule_item_id: item.id,
        office_id: officeRow.id,
        attempted_by: userData.user.id,
        http_method: method,
        endpoint,
        request_body: requestBody,
        response_status: status,
        response_body: { raw: responseText.slice(0, 1000) },
        succeeded: false,
        error_message: responseText.slice(0, 300),
      });

      if (firstLogError) {
        await supabase
          .from("fee_schedules")
          .update({
            status: "failed",
            error_message: `Audit log write failed: ${firstLogError.message}`,
          })
          .eq("id", schedule.id);

        return json({
          ok: false,
          schedule: schedule.name,
          error: "Stopped: the audit log could not be written.",
          detail: firstLogError.message,
        }, 500);
      }

      const existingFeeNum = await findExistingFeeNum(
        odHeaders,
        feeSchedNum,
        codeNum,
      );

      if (existingFeeNum !== null) {
        isUpdate = true;
        recoveredFeeNum = existingFeeNum;
        endpoint = `/fees/${existingFeeNum}`;
        method = "PUT";
        requestBody = { Amount: String(amount) };

        await send();
        succeeded = networkError === null && status >= 200 && status < 300;
      } else {
        // Refused as a duplicate and yet not findable. Saying so beats
        // repeating OpenDental's message, which sends whoever reads it
        // looking for a fee that the schedule does not appear to hold.
        responseText =
          `OpenDental refused this as already existing, but no fee for ` +
          `code ${item.proc_code ?? codeNum} was found on schedule ` +
          `${feeSchedNum}. Set it by hand in OpenDental.`;
      }
    }

    // Capture the new FeeNum so a re-run updates instead of duplicating.
    let newFeeNum: number | null = recoveredFeeNum;
    if (succeeded && !isUpdate) {
      try {
        const created = JSON.parse(responseText);
        const n = Number(created.FeeNum);
        if (Number.isFinite(n)) newFeeNum = n;
      } catch {
        // Leave null; the row still counts as pushed.
      }
    }

    const { error: logError } = await supabase.from("fee_push_log").insert({
      fee_schedule_id: schedule.id,
      fee_schedule_item_id: item.id,
      office_id: officeRow.id,
      attempted_by: userData.user.id,
      http_method: method,
      endpoint,
      request_body: requestBody,
      response_status: networkError === null ? status : null,
      response_body: { raw: responseText.slice(0, 1000) },
      succeeded,
      error_message: succeeded ? null : (networkError ?? responseText.slice(0, 300)),
    });

    // The audit trail is not optional. If the log cannot be written, stop
    // here rather than continue changing fees with no record of it.
    if (logError) {
      await supabase
        .from("fee_schedules")
        .update({
          status: "failed",
          error_message: `Audit log write failed: ${logError.message}`,
        })
        .eq("id", schedule.id);

      return json({
        ok: false,
        schedule: schedule.name,
        error: "Stopped: the audit log could not be written.",
        detail: logError.message,
        note:
          `The fee for ${item.proc_code ?? "this row"} was already sent to ` +
          "OpenDental before the log failed.",
      }, 500);
    }

    if (succeeded) {
      await supabase
        .from("fee_schedule_items")
        .update({
          push_status: "pushed",
          pushed_at: new Date().toISOString(),
          error_message: null,
          ...(newFeeNum !== null ? { od_fee_num: newFeeNum } : {}),
        })
        .eq("id", item.id);

      if (isUpdate) updated++;
      else added++;
    } else {
      await supabase
        .from("fee_schedule_items")
        .update({
          push_status: "failed",
          error_message: (networkError ?? responseText.slice(0, 300)) || "Unknown error.",
        })
        .eq("id", item.id);

      failed++;
      if (failures.length < 10) {
        failures.push({
          proc_code: item.proc_code,
          status,
          detail: (networkError ?? responseText.slice(0, 200)) || "Unknown error.",
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // 9. Recount and finalize
  // -------------------------------------------------------------------
  const countFor = async (pushStatus: string): Promise<number> => {
    const { count } = await supabase
      .from("fee_schedule_items")
      .select("id", { count: "exact", head: true })
      .eq("fee_schedule_id", schedule.id)
      .eq("include_in_push", true)
      .eq("match_status", "matched")
      .eq("push_status", pushStatus);
    return count ?? 0;
  };

  const remaining = await countFor("pending");
  const totalPushed = await countFor("pushed");
  const totalFailed = await countFor("failed");

  const finished = remaining === 0;

  await supabase
    .from("fee_schedules")
    .update({
      status: finished ? (totalFailed > 0 ? "failed" : "pushed") : "pushing",
      pushed_count: totalPushed,
      failed_count: totalFailed,
      ...(finished ? { pushed_at: new Date().toISOString() } : {}),
      ...(finished && totalFailed > 0
        ? { error_message: `${totalFailed} rows failed to write to OpenDental.` }
        : {}),
    })
    .eq("id", schedule.id);

  return json({
    ok: true,
    schedule: schedule.name,
    office: officeRow.name,
    od_fee_sched_num: feeSchedNum,
    batch_processed: batch.length,
    added_this_batch: added,
    updated_this_batch: updated,
    failed_this_batch: failed,
    remaining,
    finished,
    total_pushed: totalPushed,
    total_failed: totalFailed,
    failures,
    pushed_by: userData.user.email,
  });
});
