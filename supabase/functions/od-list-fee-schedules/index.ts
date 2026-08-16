// =====================================================================
// Dental OS - Edge Function: od-list-fee-schedules
//
// Purpose: return the fee schedules that exist in OpenDental for one
// office, so the app can offer them in a dropdown. Read-only. Writes
// nothing to OpenDental and nothing to our database.
//
// Deploy path: supabase/functions/od-list-fee-schedules/index.ts
// Version: 3
// Changelog:
//   v1  Initial: list fee schedules for an office, excluding hidden ones.
//   v2  Reports how many rows OpenDental flagged hidden and which fields it
//       returned, to diagnose hidden schedules still appearing.
//   v3  Fixed the hidden filter. OpenDental returns IsHidden as the string
//       "true"/"false", not a boolean, so a strict boolean check never matched
//       and hidden schedules were being listed.
//
// Required secrets (Project Settings -> Edge Functions -> Secrets):
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
// (SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically.)
//
// Call:
//   POST /functions/v1/od-list-fee-schedules
//   Authorization: Bearer <user access token>
//   Body: { "office_id": "<offices.id uuid>" }
//     or: { "office": "downey" }
//   Optional: { "include_hidden": true }   // defaults to false
//
// Any signed-in user with a role at that office may run this. Reading
// the list of schedules is needed to stage an upload, which Billers do.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OD_BASE_URL = "https://api.opendental.com/api/v1";

// Only these secret names may be read, whatever the offices row says.
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

type OdFeeSched = {
  FeeSchedNum?: number;
  Description?: string;
  FeeSchedType?: string;
  IsHidden?: boolean | string;
  IsGlobal?: boolean | string;
};

// OpenDental sends booleans as the strings "true"/"false" on this endpoint.
function isTrue(value: boolean | string | undefined): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
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
  // 2. Parse input
  // -------------------------------------------------------------------
  let body: { office_id?: string; office?: string; include_hidden?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const includeHidden = body.include_hidden === true;

  if (officeId === "" && officeSlug === "") {
    return json({
      ok: false,
      error: "Provide office_id (uuid) or office (slug).",
    }, 400);
  }

  // -------------------------------------------------------------------
  // 3. Resolve the office through RLS
  //
  // The select runs as the caller, so a user with no role at this office
  // gets no row back and the request stops here.
  // -------------------------------------------------------------------
  const officeQuery = supabase
    .from("offices")
    .select("id, slug, name, opendental_customer_key_name, is_active");

  const { data: officeRow, error: officeError } = officeId !== ""
    ? await officeQuery.eq("id", officeId).maybeSingle()
    : await officeQuery.eq("slug", officeSlug).maybeSingle();

  if (officeError) {
    return json({
      ok: false,
      error: `Office lookup failed: ${officeError.message}`,
    }, 500);
  }

  if (!officeRow) {
    return json({
      ok: false,
      error: "That office was not found, or you do not have a role there.",
    }, 403);
  }

  if (officeRow.is_active !== true) {
    return json({
      ok: false,
      office: officeRow.name,
      error: "That office is marked inactive.",
    }, 400);
  }

  const secretName = officeRow.opendental_customer_key_name ?? "";
  if (!ALLOWED_SECRET_NAMES.has(secretName)) {
    return json({
      ok: false,
      office: officeRow.name,
      error: "This office has no recognized OpenDental key configured.",
      hint: "Set offices.opendental_customer_key_name to a known secret name.",
    }, 500);
  }

  // -------------------------------------------------------------------
  // 4. Load credentials
  // -------------------------------------------------------------------
  const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
  const customerKey = Deno.env.get(secretName);

  const missing: string[] = [];
  if (!developerKey) missing.push("OD_DEVELOPER_KEY");
  if (!customerKey) missing.push(secretName);
  if (missing.length > 0) {
    return json({
      ok: false,
      error: "Missing Edge Function secrets.",
      missing,
      hint: "Project Settings -> Edge Functions -> Secrets. Redeploy after adding.",
    }, 500);
  }

  // -------------------------------------------------------------------
  // 5. Call OpenDental (read-only)
  // -------------------------------------------------------------------
  const url = `${OD_BASE_URL}/feescheds`;
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
      office: officeRow.name,
      error: "Network call to OpenDental failed.",
      detail: String(err),
    }, 502);
  }

  const elapsedMs = Date.now() - startedAt;
  const rawText = await odResponse.text();

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return json({
      ok: false,
      office: officeRow.name,
      http_status: odResponse.status,
      error: "OpenDental returned something that was not JSON.",
      response_preview: rawText.slice(0, 300),
    }, 502);
  }

  if (!odResponse.ok) {
    return json({
      ok: false,
      office: officeRow.name,
      http_status: odResponse.status,
      elapsed_ms: elapsedMs,
      error: "OpenDental rejected the request.",
      response_preview: parsed,
    }, 502);
  }

  if (!Array.isArray(parsed)) {
    return json({
      ok: false,
      office: officeRow.name,
      error: "Expected a list of fee schedules.",
      response_preview: parsed,
    }, 502);
  }

  // -------------------------------------------------------------------
  // 6. Shape the result
  // -------------------------------------------------------------------
  const all = parsed as OdFeeSched[];

  const schedules = all
    .filter((s) => includeHidden || !isTrue(s.IsHidden))
    .map((s) => ({
      fee_sched_num: s.FeeSchedNum ?? null,
      description: s.Description ?? "",
      fee_sched_type: s.FeeSchedType ?? null,
      is_hidden: isTrue(s.IsHidden),
      is_global: isTrue(s.IsGlobal),
    }))
    .filter((s) => s.fee_sched_num !== null && s.description !== "")
    .sort((a, b) => a.description.localeCompare(b.description));

  // Diagnostic: how many rows OpenDental actually flagged hidden, and what
  // keys came back on the first row. If a schedule you hid still appears,
  // the flag is arriving under a different name than IsHidden.
  const hiddenInResponse = all.filter((s) => isTrue(s.IsHidden)).length;
  const sampleKeys = all.length > 0 ? Object.keys(all[0]) : [];

  return json({
    ok: true,
    office: officeRow.name,
    office_slug: officeRow.slug,
    elapsed_ms: elapsedMs,
    total_in_opendental: all.length,
    hidden_flagged_by_opendental: hiddenInResponse,
    hidden_excluded: includeHidden ? 0 : all.length - schedules.length,
    fields_returned: sampleKeys,
    count: schedules.length,
    schedules,
    listed_by: userData.user.email,
    listed_at: new Date().toISOString(),
  });
});
