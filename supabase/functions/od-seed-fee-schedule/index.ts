// =====================================================================
// Dental OS — Edge Function: od-seed-fee-schedule
//
// Purpose: copy fees from an existing OpenDental fee schedule into
// another one. Built to populate a TEST schedule with realistic data so
// the review/push pipeline can be exercised without touching a live
// schedule.
//
// This WRITES to OpenDental. Owner/Admin only.
//
// Deploy path: supabase/functions/od-seed-fee-schedule/index.ts
//
// Safety rails:
//   - source and target must differ
//   - target must be empty unless allow_non_empty is explicitly true
//   - only practice-wide fees (ClinicNum 0 / ProvNum 0) are copied
//   - `limit` caps how many fees are written (default 25)
//   - dry_run reports exactly what would be written, writes nothing
//
// Call:
//   POST /functions/v1/od-seed-fee-schedule
//   Authorization: Bearer <user access token>
//   Body: {
//     "office": "downey",
//     "source_fee_sched_num": 53,
//     "target_fee_sched_num": 425,
//     "limit": 25,                  // optional, default 25, max 2000
//     "allow_non_empty": false,     // optional, default false
//     "dry_run": true               // optional, default false
//   }
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OD_BASE_URL = "https://api.opendental.com/api/v1";

const OFFICE_SECRETS: Record<string, string> = {
  downey: "OD_CUSTOMER_KEY_DOWNEY",
  maywood: "OD_CUSTOMER_KEY_MAYWOOD",
};

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 2000;

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

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
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
  // 2. Parse and validate input
  // -------------------------------------------------------------------
  let body: {
    office?: string;
    source_fee_sched_num?: number | string;
    target_fee_sched_num?: number | string;
    limit?: number | string;
    allow_non_empty?: boolean;
    dry_run?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const office = (body.office ?? "").toLowerCase().trim();
  const sourceNum = Number(body.source_fee_sched_num);
  const targetNum = Number(body.target_fee_sched_num);
  const allowNonEmpty = body.allow_non_empty === true;
  const dryRun = body.dry_run === true;

  let limit = body.limit === undefined ? DEFAULT_LIMIT : Number(body.limit);
  if (!Number.isInteger(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  if (!OFFICE_SECRETS[office]) {
    return json({
      ok: false,
      error: `Unknown office '${office}'.`,
      valid_offices: Object.keys(OFFICE_SECRETS),
    }, 400);
  }
  if (!Number.isInteger(sourceNum) || sourceNum <= 0) {
    return json({ ok: false, error: "source_fee_sched_num must be a positive integer." }, 400);
  }
  if (!Number.isInteger(targetNum) || targetNum <= 0) {
    return json({ ok: false, error: "target_fee_sched_num must be a positive integer." }, 400);
  }
  if (sourceNum === targetNum) {
    return json({
      ok: false,
      error: "source_fee_sched_num and target_fee_sched_num must be different.",
    }, 400);
  }

  // -------------------------------------------------------------------
  // 3. Require Owner/Admin
  // -------------------------------------------------------------------
  const { data: officeRow, error: officeError } = await supabase
    .from("offices")
    .select("id, slug")
    .eq("slug", office)
    .maybeSingle();

  if (officeError) {
    return json({ ok: false, error: `Office lookup failed: ${officeError.message}` }, 500);
  }
  if (!officeRow) {
    return json({ ok: false, error: `Office '${office}' is not visible to you, or does not exist.` }, 403);
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) {
    return json({ ok: false, error: `Permission check failed: ${adminError.message}` }, 500);
  }
  if (isAdmin !== true) {
    return json({ ok: false, error: "Owner/Admin role required to seed a fee schedule." }, 403);
  }

  // -------------------------------------------------------------------
  // 4. Credentials
  // -------------------------------------------------------------------
  const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
  const customerKey = Deno.env.get(OFFICE_SECRETS[office]);

  const missing: string[] = [];
  if (!developerKey) missing.push("OD_DEVELOPER_KEY");
  if (!customerKey) missing.push(OFFICE_SECRETS[office]);
  if (missing.length > 0) {
    return json({ ok: false, error: "Missing Edge Function secrets.", missing }, 500);
  }

  const odAuth = `ODFHIR ${developerKey}/${customerKey}`;
  const startedAt = Date.now();

  // -------------------------------------------------------------------
  // 5. Verify both schedules exist
  // -------------------------------------------------------------------
  let feeScheds: Record<string, unknown>[];
  try {
    feeScheds = await fetchAllPages("/feescheds", odAuth);
  } catch (err) {
    return json({ ok: false, stage: "feescheds", error: String(err) }, 502);
  }

  const sourceSched = feeScheds.find((f) => Number(f.FeeSchedNum) === sourceNum);
  const targetSched = feeScheds.find((f) => Number(f.FeeSchedNum) === targetNum);

  if (!sourceSched) {
    return json({ ok: false, error: `Source fee schedule ${sourceNum} not found at ${office}.` }, 404);
  }
  if (!targetSched) {
    return json({ ok: false, error: `Target fee schedule ${targetNum} not found at ${office}.` }, 404);
  }

  // -------------------------------------------------------------------
  // 6. Pull fees for both schedules
  //    Re-filter client-side: OpenDental silently ignores a wrong filter
  //    param name and returns everything.
  // -------------------------------------------------------------------
  let sourceFeesRaw: Record<string, unknown>[];
  let targetFeesRaw: Record<string, unknown>[];
  try {
    sourceFeesRaw = await fetchAllPages(`/fees?FeeSched=${sourceNum}`, odAuth);
    targetFeesRaw = await fetchAllPages(`/fees?FeeSched=${targetNum}`, odAuth);
  } catch (err) {
    return json({ ok: false, stage: "fees", error: String(err) }, 502);
  }

  const sourceFees = sourceFeesRaw.filter((f) => Number(f.FeeSched) === sourceNum);
  const targetFees = targetFeesRaw.filter((f) => Number(f.FeeSched) === targetNum);

  if (sourceFeesRaw.length > 0 && sourceFees.length === 0) {
    return json({
      ok: false,
      error: "OpenDental returned no fees for the source schedule.",
      detail:
        `Received ${sourceFeesRaw.length} rows, none with FeeSched=${sourceNum}. ` +
        "The filter was likely ignored. Nothing was written.",
    }, 502);
  }

  // Guard: refuse to seed a target that already has fees.
  if (targetFees.length > 0 && !allowNonEmpty) {
    return json({
      ok: false,
      error: `Target fee schedule ${targetNum} already has ${targetFees.length} fees.`,
      hint: "Pass allow_non_empty: true to add to it anyway. Nothing was written.",
      target_existing_fee_count: targetFees.length,
    }, 409);
  }

  // Practice-wide fees only. Clinic/provider overrides are intentionally
  // skipped: a seeded test schedule should have one clean fee per code.
  const practiceWide = sourceFees.filter(
    (f) => Number(f.ClinicNum ?? 0) === 0 && Number(f.ProvNum ?? 0) === 0,
  );

  // Don't duplicate codes already present in the target.
  const targetCodeNums = new Set(targetFees.map((f) => Number(f.CodeNum)));

  const candidates = practiceWide
    .filter((f) => {
      const codeNum = Number(f.CodeNum);
      const amount = toNumberOrNull(f.Amount);
      return Number.isFinite(codeNum) && amount !== null && !targetCodeNums.has(codeNum);
    })
    .slice(0, limit);

  const summary = {
    office,
    source_fee_sched_num: sourceNum,
    source_description: sourceSched.Description ?? null,
    target_fee_sched_num: targetNum,
    target_description: targetSched.Description ?? null,
    source_fees_total: sourceFees.length,
    source_fees_practice_wide: practiceWide.length,
    target_existing_fees: targetFees.length,
    limit_applied: limit,
    fees_to_write: candidates.length,
  };

  // -------------------------------------------------------------------
  // 7. Dry run stops here
  // -------------------------------------------------------------------
  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      ...summary,
      sample: candidates.slice(0, 5).map((f) => ({
        CodeNum: Number(f.CodeNum),
        Amount: toNumberOrNull(f.Amount),
      })),
      requested_by: userData.user.email,
    });
  }

  // -------------------------------------------------------------------
  // 8. Write fees one at a time. OpenDental has no bulk fee insert.
  //    Stop on first failure and report exactly how far we got, so a
  //    partial seed is always knowable rather than silent.
  // -------------------------------------------------------------------
  let written = 0;
  const failures: { CodeNum: number; status: number; detail: string }[] = [];

  for (const f of candidates) {
    const codeNum = Number(f.CodeNum);
    const amount = toNumberOrNull(f.Amount);

    const res = await fetch(`${OD_BASE_URL}/fees`, {
      method: "POST",
      headers: {
        Authorization: odAuth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        Amount: String(amount),
        FeeSched: targetNum,
        CodeNum: codeNum,
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      failures.push({ CodeNum: codeNum, status: res.status, detail });
      // Bail out after a handful of failures rather than hammering the
      // practice's eConnector with requests that are clearly not working.
      if (failures.length >= 3) break;
      continue;
    }

    written++;
  }

  return json({
    ok: failures.length === 0,
    dry_run: false,
    ...summary,
    fees_written: written,
    failure_count: failures.length,
    failures: failures.slice(0, 5),
    elapsed_ms: Date.now() - startedAt,
    seeded_by: userData.user.email,
    seeded_at: new Date().toISOString(),
  });
});
