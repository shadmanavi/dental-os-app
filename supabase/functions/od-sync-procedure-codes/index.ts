// =====================================================================
// Dental OS — Edge Function: od-sync-procedure-codes
//
// Purpose: pull procedure codes and the fees for ONE fee schedule from
// OpenDental into procedure_codes_cache, for ONE office.
//
// Read-only against OpenDental. Writes only to our own database.
// No PHI is touched: procedure codes and fees are reference data.
//
// Deploy path: supabase/functions/od-sync-procedure-codes/index.ts
//
// Required secrets (Project Settings -> Edge Functions -> Secrets):
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are
//  injected automatically by the platform.)
//
// Call:
//   POST /functions/v1/od-sync-procedure-codes
//   Authorization: Bearer <user access token>
//   Body: { "office": "downey", "fee_sched_num": 53, "dry_run": true }
//
// v2 fix: fees are filtered with ?FeeSched= (NOT FeeSchedNum), re-verified
// client-side, and clinic/provider overrides resolve to the practice-wide fee.
//
// Owner/Admin or Biller may run this.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OD_BASE_URL = "https://api.opendental.com/api/v1";

// office slug -> secret name holding that office's Customer API key
const OFFICE_SECRETS: Record<string, string> = {
  downey: "OD_CUSTOMER_KEY_DOWNEY",
  maywood: "OD_CUSTOMER_KEY_MAYWOOD",
};

// Paging guards. OpenDental caps Limit at 1000. MAX_PAGES stops a
// runaway loop from hammering the practice's eConnector.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50k records ceiling per resource

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
function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return false;
}

// Fees come back as numbers, but be defensive about strings and nulls.
function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type OdFetchResult = { rows: Record<string, unknown>[]; pages: number };

// Page through an OpenDental list endpoint until a short page comes back.
async function fetchAllPages(
  path: string,
  authHeader: string,
): Promise<OdFetchResult> {
  const all: Record<string, unknown>[] = [];
  let pages = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${OD_BASE_URL}${path}${sep}Limit=${PAGE_SIZE}&Offset=${
      page * PAGE_SIZE
    }`;

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "application/json" },
    });

    pages++;

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(
        `OpenDental ${res.status} on ${path} (page ${page}): ${detail}`,
      );
    }

    const body = await res.json();
    if (!Array.isArray(body)) {
      throw new Error(`Expected an array from ${path}, got ${typeof body}.`);
    }

    all.push(...body);

    // Short page means we've reached the end.
    if (body.length < PAGE_SIZE) break;
  }

  return { rows: all, pages };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }

  // -------------------------------------------------------------------
  // 1. Authenticate the caller
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
  // 2. Parse and validate input
  // -------------------------------------------------------------------
  let body: {
    office?: string;
    fee_sched_num?: number | string;
    dry_run?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const office = (body.office ?? "").toLowerCase().trim();
  const dryRun = body.dry_run === true;

  if (!OFFICE_SECRETS[office]) {
    return json({
      ok: false,
      error: `Unknown office '${office}'.`,
      valid_offices: Object.keys(OFFICE_SECRETS),
    }, 400);
  }

  const feeSchedNum = Number(body.fee_sched_num);
  if (!Number.isInteger(feeSchedNum) || feeSchedNum <= 0) {
    return json({
      ok: false,
      error: "fee_sched_num must be a positive integer.",
      hint: "Run od-test-connection with resource 'feescheds' to list them.",
    }, 400);
  }

  // -------------------------------------------------------------------
  // 3. Resolve office_id and check permission
  //    Staging is a Biller task; Owner/Admin may also run it.
  // -------------------------------------------------------------------
  const { data: officeRow, error: officeError } = await supabase
    .from("offices")
    .select("id, slug")
    .eq("slug", office)
    .maybeSingle();

  if (officeError) {
    return json({
      ok: false,
      error: `Office lookup failed: ${officeError.message}`,
    }, 500);
  }
  if (!officeRow) {
    return json({
      ok: false,
      error: `Office '${office}' is not visible to you, or does not exist.`,
    }, 403);
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) {
    return json({
      ok: false,
      error: `Permission check failed: ${adminError.message}`,
    }, 500);
  }

  let allowed = isAdmin === true;
  if (!allowed) {
    const { data: isBiller, error: billerError } = await supabase.rpc(
      "has_role_in_office",
      { target_office: officeRow.id, role_key: "biller" },
    );
    if (billerError) {
      return json({
        ok: false,
        error: `Role check failed: ${billerError.message}`,
      }, 500);
    }
    allowed = isBiller === true;
  }

  if (!allowed) {
    return json({
      ok: false,
      error: "Owner/Admin or Biller role required for this office.",
    }, 403);
  }

  // -------------------------------------------------------------------
  // 4. Load OpenDental credentials
  // -------------------------------------------------------------------
  const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
  const customerKey = Deno.env.get(OFFICE_SECRETS[office]);

  const missing: string[] = [];
  if (!developerKey) missing.push("OD_DEVELOPER_KEY");
  if (!customerKey) missing.push(OFFICE_SECRETS[office]);
  if (missing.length > 0) {
    return json({
      ok: false,
      error: "Missing Edge Function secrets.",
      missing,
      hint: "Project Settings -> Edge Functions -> Secrets. Redeploy after adding.",
    }, 500);
  }

  const odAuth = `ODFHIR ${developerKey}/${customerKey}`;
  const startedAt = Date.now();

  // -------------------------------------------------------------------
  // 5. Confirm the fee schedule exists at this office
  // -------------------------------------------------------------------
  let feeScheds: Record<string, unknown>[];
  try {
    const res = await fetchAllPages("/feescheds", odAuth);
    feeScheds = res.rows;
  } catch (err) {
    return json({
      ok: false,
      office,
      stage: "feescheds",
      error: "Could not list fee schedules from OpenDental.",
      detail: String(err),
    }, 502);
  }

  const targetSched = feeScheds.find(
    (f) => Number(f.FeeSchedNum) === feeSchedNum,
  );
  if (!targetSched) {
    return json({
      ok: false,
      office,
      error: `Fee schedule ${feeSchedNum} not found at ${office}.`,
      available: feeScheds
        .map((f) => ({
          FeeSchedNum: f.FeeSchedNum,
          Description: f.Description,
        }))
        .slice(0, 25),
    }, 404);
  }

  // -------------------------------------------------------------------
  // 6. Pull procedure codes and fees
  // -------------------------------------------------------------------
  let codes: Record<string, unknown>[];
  let codePages = 0;
  try {
    const res = await fetchAllPages("/procedurecodes", odAuth);
    codes = res.rows;
    codePages = res.pages;
  } catch (err) {
    return json({
      ok: false,
      office,
      stage: "procedurecodes",
      error: "Could not pull procedure codes from OpenDental.",
      detail: String(err),
    }, 502);
  }

  let fees: Record<string, unknown>[];
  let feePages = 0;
  try {
    // NOTE: the parameter is FeeSched, not FeeSchedNum. Sending the wrong
    // name is silently ignored by OpenDental and returns EVERY fee in the
    // database — which is exactly what happened on the first dry run.
    const res = await fetchAllPages(
      `/fees?FeeSched=${feeSchedNum}`,
      odAuth,
    );
    fees = res.rows;
    feePages = res.pages;
  } catch (err) {
    return json({
      ok: false,
      office,
      stage: "fees",
      error: "Could not pull fees from OpenDental.",
      detail: String(err),
    }, 502);
  }

  // -------------------------------------------------------------------
  // 7. Re-filter fees defensively, then join onto codes
  //
  //    Two lessons baked in here:
  //    (a) Never trust that the API honoured the filter. Re-check the
  //        FeeSched field on every row and refuse to proceed if the
  //        response looks unfiltered.
  //    (b) Non-global fee schedules allow clinic- and provider-level
  //        overrides, so one code can legitimately have several rows.
  //        Prefer the practice-wide fee (ClinicNum 0, ProvNum 0) and
  //        report overrides rather than grabbing whichever came first.
  // -------------------------------------------------------------------
  const feesForSched = fees.filter(
    (f) => Number(f.FeeSched) === feeSchedNum,
  );
  const foreignFeeRows = fees.length - feesForSched.length;

  // If most of what came back belongs to other schedules, the filter was
  // ignored. Stop rather than write fees from the wrong schedule.
  if (fees.length > 0 && feesForSched.length === 0) {
    return json({
      ok: false,
      office,
      fee_sched_num: feeSchedNum,
      error: "OpenDental returned no fees for this schedule.",
      detail:
        `Received ${fees.length} fee rows, none with FeeSched=${feeSchedNum}. ` +
        "The filter was likely ignored. Nothing was written.",
    }, 502);
  }

  type FeePick = {
    row: Record<string, unknown>;
    overrides: number;
  };

  const feeByCodeNum = new Map<number, FeePick>();
  let overrideRows = 0;
  let ambiguousCodes = 0;

  for (const f of feesForSched) {
    const codeNum = Number(f.CodeNum);
    if (!Number.isFinite(codeNum)) continue;

    const isPracticeWide =
      Number(f.ClinicNum ?? 0) === 0 && Number(f.ProvNum ?? 0) === 0;
    if (!isPracticeWide) overrideRows++;

    const existing = feeByCodeNum.get(codeNum);

    if (!existing) {
      feeByCodeNum.set(codeNum, { row: f, overrides: isPracticeWide ? 0 : 1 });
      continue;
    }

    existing.overrides++;

    const existingIsPracticeWide =
      Number(existing.row.ClinicNum ?? 0) === 0 &&
      Number(existing.row.ProvNum ?? 0) === 0;

    // Practice-wide always wins. If neither is practice-wide, we have no
    // basis to choose — keep the first and flag it for review.
    if (isPracticeWide && !existingIsPracticeWide) {
      existing.row = f;
    } else if (!isPracticeWide && !existingIsPracticeWide) {
      ambiguousCodes++;
    }
  }

  const rows: Record<string, unknown>[] = [];
  let skippedNoCodeNum = 0;
  let pricedCount = 0;

  for (const c of codes) {
    const codeNum = Number(c.CodeNum);
    const procCode = typeof c.ProcCode === "string" ? c.ProcCode.trim() : "";

    if (!Number.isFinite(codeNum) || procCode === "") {
      skippedNoCodeNum++;
      continue;
    }

    const pick = feeByCodeNum.get(codeNum);
    const feeRow = pick?.row;
    // Amount comes back quoted in the OpenDental docs ("99.99"), so parse
    // rather than assuming a number.
    const currentFee = feeRow ? toNumberOrNull(feeRow.Amount) : null;
    if (currentFee !== null) pricedCount++;

    rows.push({
      office_id: officeRow.id,
      od_codenum: codeNum,
      proc_code: procCode,
      description: typeof c.Descript === "string" ? c.Descript : null,
      abbr_desc: typeof c.AbbrDesc === "string" ? c.AbbrDesc : null,
      treat_area: typeof c.TreatArea === "string" ? c.TreatArea : null,
      is_hygiene: toBool(c.IsHygiene),
      od_fee_sched_num: feeSchedNum,
      od_fee_num: feeRow ? toNumberOrNull(feeRow.FeeNum) : null,
      current_fee: currentFee,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const summary = {
    office,
    fee_sched_num: feeSchedNum,
    fee_sched_description: targetSched.Description ?? null,
    fee_sched_is_global: targetSched.IsGlobal ?? null,
    codes_fetched: codes.length,
    fee_rows_returned: fees.length,
    fee_rows_for_this_schedule: feesForSched.length,
    fee_rows_discarded_wrong_schedule: foreignFeeRows,
    clinic_or_provider_override_rows: overrideRows,
    codes_with_ambiguous_override: ambiguousCodes,
    rows_prepared: rows.length,
    rows_with_a_fee: pricedCount,
    rows_without_a_fee: rows.length - pricedCount,
    skipped_malformed: skippedNoCodeNum,
    pages_requested: { procedurecodes: codePages, fees: feePages },
  };

  // -------------------------------------------------------------------
  // 8. Dry run stops here — nothing written
  // -------------------------------------------------------------------
  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      ...summary,
      elapsed_ms: Date.now() - startedAt,
      sample_rows: rows.slice(0, 5),
      synced_by: userData.user.email,
      synced_at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------
  // 9. Upsert into procedure_codes_cache
  //    Service role is needed: RLS blocks direct writes to the cache.
  //    Permission was already enforced above using the caller's token.
  // -------------------------------------------------------------------
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return json({
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY is not available to this function.",
    }, 500);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false },
  });

  const CHUNK = 500;
  let written = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error: upsertError } = await admin
      .from("procedure_codes_cache")
      .upsert(chunk, {
        onConflict: "office_id,od_codenum,od_fee_sched_num",
      });

    if (upsertError) {
      return json({
        ok: false,
        ...summary,
        error: "Upsert failed partway through.",
        detail: upsertError.message,
        rows_written_before_failure: written,
        failed_chunk_start_index: i,
      }, 500);
    }

    written += chunk.length;
  }

  // Report what the table actually holds for this office + schedule.
  const { count: cacheCount } = await admin
    .from("procedure_codes_cache")
    .select("*", { count: "exact", head: true })
    .eq("office_id", officeRow.id)
    .eq("od_fee_sched_num", feeSchedNum);

  return json({
    ok: true,
    dry_run: false,
    ...summary,
    rows_written: written,
    cache_rows_now: cacheCount ?? null,
    elapsed_ms: Date.now() - startedAt,
    sample_rows: rows.slice(0, 5),
    synced_by: userData.user.email,
    synced_at: new Date().toISOString(),
  });
});
