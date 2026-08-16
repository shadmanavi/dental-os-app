// =====================================================================
// Dental OS — Edge Function: od-create-fee-schedule
//
// Purpose: create a new, empty fee schedule in OpenDental. Used to spin
// up a dedicated test/sandbox schedule before ever touching a real one.
//
// This WRITES to OpenDental (unlike od-test-connection and
// od-sync-procedure-codes, which are read-only). Owner/Admin only.
//
// Deploy path: supabase/functions/od-create-fee-schedule/index.ts
//
// v2: only send IsHidden / IsGlobal when the caller explicitly sets them.
// Sending them unconditionally produced a generic OpenDental 400 on insert.
// The error response now echoes the exact payload sent, so a future 400 is
// diagnosable without guessing.
//
// Call:
//   POST /functions/v1/od-create-fee-schedule
//   Authorization: Bearer <user access token>
//   Body: {
//     "office": "downey",
//     "description": "Dental OS - TEST",
//     "fee_sched_type": "Normal",   // optional, default "Normal"
//     "is_hidden": false,           // optional, omitted unless provided
//     "is_global": true,            // optional, omitted unless provided
//     "dry_run": true               // optional, default false
//   }
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OD_BASE_URL = "https://api.opendental.com/api/v1";

const OFFICE_SECRETS: Record<string, string> = {
  downey: "OD_CUSTOMER_KEY_DOWNEY",
  maywood: "OD_CUSTOMER_KEY_MAYWOOD",
};

const VALID_TYPES = [
  "Normal",
  "CoPay",
  "OutNetwork",
  "FixedBenefit",
  "ManualBlueBook",
];

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
    description?: string;
    fee_sched_type?: string;
    is_hidden?: boolean;
    is_global?: boolean;
    dry_run?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const office = (body.office ?? "").toLowerCase().trim();
  const description = (body.description ?? "").trim();
  const feeSchedType = body.fee_sched_type ?? "Normal";
  const dryRun = body.dry_run === true;

  if (!OFFICE_SECRETS[office]) {
    return json({
      ok: false,
      error: `Unknown office '${office}'.`,
      valid_offices: Object.keys(OFFICE_SECRETS),
    }, 400);
  }
  if (description === "") {
    return json({ ok: false, error: "description is required." }, 400);
  }
  if (!VALID_TYPES.includes(feeSchedType)) {
    return json({
      ok: false,
      error: `fee_sched_type must be one of: ${VALID_TYPES.join(", ")}`,
    }, 400);
  }

  // Build the payload with only the required fields, plus whichever
  // optional flags the caller actually asked for. OpenDental defaults
  // IsHidden=false and IsGlobal=true when they are absent.
  const payload: Record<string, string> = {
    Description: description,
    FeeSchedType: feeSchedType,
  };
  if (typeof body.is_hidden === "boolean") {
    payload.IsHidden = body.is_hidden ? "true" : "false";
  }
  if (typeof body.is_global === "boolean") {
    payload.IsGlobal = body.is_global ? "true" : "false";
  }

  // -------------------------------------------------------------------
  // 3. Resolve office_id and require Owner/Admin
  //    Creating a schedule is a write to OpenDental — Owner/Admin only,
  //    same split used for pushing fee changes.
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
    return json({ ok: false, error: "Owner/Admin role required to create a fee schedule." }, 403);
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
    }, 500);
  }

  const odAuth = `ODFHIR ${developerKey}/${customerKey}`;

  // -------------------------------------------------------------------
  // 5. Dry run stops here — nothing sent to OpenDental
  // -------------------------------------------------------------------
  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      office,
      would_send: payload,
      requested_by: userData.user.email,
    });
  }

  // -------------------------------------------------------------------
  // 6. Create the fee schedule in OpenDental
  // -------------------------------------------------------------------
  let odResponse: Response;
  try {
    odResponse = await fetch(`${OD_BASE_URL}/feescheds`, {
      method: "POST",
      headers: {
        Authorization: odAuth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json({
      ok: false,
      office,
      error: "Network error calling OpenDental.",
      detail: String(err),
      payload_sent: payload,
    }, 502);
  }

  if (!odResponse.ok) {
    const detail = (await odResponse.text()).slice(0, 500);
    return json({
      ok: false,
      office,
      error: `OpenDental ${odResponse.status} creating fee schedule.`,
      detail,
      payload_sent: payload,
      hint:
        "A generic 400 here usually means a duplicate Description, a field " +
        "this OpenDental version rejects on insert, or a write-tier/permission " +
        "issue on the API key. Try a unique Description first.",
    }, 502);
  }

  const created = await odResponse.json();

  return json({
    ok: true,
    dry_run: false,
    office,
    fee_sched_num: created.FeeSchedNum ?? null,
    description: created.Description ?? description,
    fee_sched_type: created.FeeSchedType ?? feeSchedType,
    payload_sent: payload,
    created_by: userData.user.email,
    created_at: new Date().toISOString(),
    raw: created,
  });
});
