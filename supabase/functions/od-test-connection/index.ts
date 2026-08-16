// =====================================================================
// Dental OS — Edge Function: od-test-connection
//
// Purpose: verify OpenDental API connectivity and credentials for one
// office, read-only. Makes a small GET request and reports what came
// back. Writes nothing to OpenDental and nothing to our database.
//
// Deploy path: supabase/functions/od-test-connection/index.ts
//
// Required secrets (Project Settings -> Edge Functions -> Secrets):
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
// (SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically.)
//
// Call:
//   POST /functions/v1/od-test-connection
//   Authorization: Bearer <user access token>
//   Body: { "office": "downey", "resource": "feescheds" }
//
// Only Owner/Admin users may run this.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OD_BASE_URL = "https://api.opendental.com/api/v1";

// Whitelisted read-only probes. Nothing here returns patient data.
const ALLOWED_RESOURCES: Record<string, string> = {
  feescheds: "/feescheds",
  procedurecodes: "/procedurecodes?Limit=1",
  clinics: "/clinics",
  providers: "/providers?Limit=1",
};

// office slug -> secret name holding that office's Customer API key
const OFFICE_SECRETS: Record<string, string> = {
  downey: "OD_CUSTOMER_KEY_DOWNEY",
  maywood: "OD_CUSTOMER_KEY_MAYWOOD",
};

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

// Never echo a key. This confirms a secret is present and looks sane
// without revealing it.
function fingerprint(secret: string): string {
  return `len=${secret.length}, ends=…${secret.slice(-4)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }

  // -------------------------------------------------------------------
  // 1. Authenticate the caller and require Owner/Admin
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
  if (!isAdmin) {
    return json({ ok: false, error: "Owner/Admin role required." }, 403);
  }

  // -------------------------------------------------------------------
  // 2. Parse and validate input
  // -------------------------------------------------------------------
  let body: { office?: string; resource?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const office = (body.office ?? "").toLowerCase().trim();
  const resource = (body.resource ?? "feescheds").toLowerCase().trim();

  if (!OFFICE_SECRETS[office]) {
    return json({
      ok: false,
      error: `Unknown office '${office}'.`,
      valid_offices: Object.keys(OFFICE_SECRETS),
    }, 400);
  }

  if (!ALLOWED_RESOURCES[resource]) {
    return json({
      ok: false,
      error: `Resource '${resource}' is not on the read-only allowlist.`,
      valid_resources: Object.keys(ALLOWED_RESOURCES),
    }, 400);
  }

  // -------------------------------------------------------------------
  // 3. Load credentials from secrets
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

  // -------------------------------------------------------------------
  // 4. Call OpenDental (read-only)
  // -------------------------------------------------------------------
  const url = `${OD_BASE_URL}${ALLOWED_RESOURCES[resource]}`;
  const startedAt = Date.now();

  let odResponse: Response;
  try {
    odResponse = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `ODFHIR ${developerKey}/${customerKey}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    return json({
      ok: false,
      office,
      endpoint: ALLOWED_RESOURCES[resource],
      error: "Network call to OpenDental failed.",
      detail: String(err),
    }, 502);
  }

  const elapsedMs = Date.now() - startedAt;
  const rawText = await odResponse.text();

  let parsed: unknown = null;
  let parseNote: string | null = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parseNote = "Response was not valid JSON.";
  }

  const recordCount = Array.isArray(parsed) ? parsed.length : null;

  // Small, non-sensitive preview so you can eyeball that real data came back.
  let preview: unknown = null;
  if (Array.isArray(parsed)) {
    preview = parsed.slice(0, 3);
  } else if (parsed && typeof parsed === "object") {
    preview = parsed;
  } else if (rawText) {
    preview = rawText.slice(0, 300);
  }

  if (!odResponse.ok) {
    return json({
      ok: false,
      office,
      endpoint: ALLOWED_RESOURCES[resource],
      http_status: odResponse.status,
      elapsed_ms: elapsedMs,
      error: "OpenDental rejected the request.",
      response_preview: preview,
      credentials_present: {
        developer_key: fingerprint(developerKey!),
        customer_key: fingerprint(customerKey!),
      },
      common_causes: [
        "401/403 — key mismatch, wrong office key, or tier not active",
        "404 — endpoint path not available on this OpenDental version",
        "eConnector not running or not reachable",
      ],
    }, 200);
  }

  return json({
    ok: true,
    office,
    endpoint: ALLOWED_RESOURCES[resource],
    http_status: odResponse.status,
    elapsed_ms: elapsedMs,
    record_count: recordCount,
    parse_note: parseNote,
    response_preview: preview,
    tested_by: userData.user.email,
    tested_at: new Date().toISOString(),
  });
});