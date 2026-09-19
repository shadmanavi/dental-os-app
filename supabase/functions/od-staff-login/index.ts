// =====================================================================
// Dental OS - Edge Function: od-staff-login
//
// Lets staff sign in with the same username OpenDental already knows
// them by, instead of an email address Dental OS invented. Read-only
// against OpenDental; writes only to this app's own Supabase project
// (an Auth account per staff member, plus the roster that ties it
// back to the OpenDental user it came from).
//
// Deploy path: supabase/functions/od-staff-login/index.ts
// Version: 3
//
// Actions:
//   { "action":"list_offices" }
//   { "office":"downey", "action":"list_usernames" }
//   { "office":"downey", "action":"sync" }
//   { "office":"downey", "action":"cleanup_orphans" }
//   { "office":"downey", "action":"reset_password", "od_username":"cduong" }
//
// ---------------------------------------------------------------------
// Changelog
//
//   v3  Fixed a real bug in sync, and added cleanup_orphans for the
//       accounts it already broke.
//
//       public.users has a trigger, trg_on_auth_user_created, that
//       inserts a row for every new Auth account automatically. sync
//       did not know that and tried to INSERT its own row on top —
//       colliding on the primary key every single time. createUser
//       had already succeeded by then, so the result was a real Auth
//       account with a real (now-lost) temporary password, no role,
//       and no od_staff_logins entry: unreachable, and with nothing
//       recording it existed. The fix is upsert instead of insert,
//       which fills in full_name and is_active on the row the trigger
//       already made instead of fighting it.
//
//       cleanup_orphans finds every Auth account under an office's
//       synthetic email domain with no matching ledger row — exactly
//       the accounts the bug above left behind — and deletes them
//       (auth.users cascades to users). Run it before re-running
//       sync whenever sync has reported "users row failed" skips.
//
//   v2  list_usernames — a dropdown of names, the way OpenDental's own
//       login screen shows one, instead of a free-text field asking
//       staff to remember exact spelling and case. Reads the live
//       OpenDental roster directly (visible IsHidden=0 rows), not
//       this app's own provisioning ledger, so it always matches what
//       OpenDental itself would show today — including someone hired
//       since the last sync, whose name appears here but whose sign-in
//       will fail with the ordinary "doesn't match" message until an
//       admin runs sync for them.
//
//       No sign-in exists yet when this is called, same as
//       list_offices, and for the same reason it asks nothing of the
//       caller: mirroring OpenDental's own login screen means the
//       roster is visible before anyone signs in, exactly as it would
//       be standing at an office PC's own OpenDental prompt. That is
//       a deliberate trade against the free-text alternative, not an
//       oversight.
//
// ---------------------------------------------------------------------
// Why a synthetic email, and why the password can't come from OpenDental
//
// OpenDental's API has no login-validation endpoint and never returns
// a password hash — /userods is list/create/update only. So "the same
// password" is not achievable through the API; the password has to be
// Supabase's own. What CAN be reused is the username, which is public
// within the office anyway.
//
// The login page computes the email itself, with no lookup and no
// round trip: "<office_slug>.<od_username lowercased>@dental-os.internal".
// It is never sent anywhere and never delivered - it exists only so
// Supabase Auth, which speaks email, has something stable to key on.
// sync's job is to make sure that computed address actually has an
// account behind it, with the office's current OpenDental username
// list.
//
// ---------------------------------------------------------------------
// What sync does, each time it is run for an office
//
//   1. Reads every userod row for the office (ShortQuery, the same
//      table od-plan's `presenters` action already reads), joined to
//      employee for a display name.
//   2. A visible (not hidden) user not yet in `od_staff_logins` gets a
//      new Supabase Auth account - the synthetic email, a random
//      16-character temporary password, email pre-confirmed since the
//      address is not real - plus rows in `users`, `user_office_roles`
//      (role fixed at the lowest privilege, front_desk; an admin
//      promotes from there) and `od_staff_logins` itself. The temp
//      password is returned once, in the response, and never stored.
//   3. A user already in `od_staff_logins` is left untouched and
//      reported as already provisioned - re-running sync is safe.
//   4. A user `od_staff_logins` has active who is now hidden in
//      OpenDental is deprovisioned: the Supabase Auth account is
//      banned (not deleted - the audit trail stays) and the ledger
//      row is marked inactive.
//
// Nothing here forces a password change on first sign-in, and nothing
// here emails the temp password to anyone - both are next steps, not
// done yet.
//
// Required secrets:
//   OD_DEVELOPER_KEY
//   OD_CUSTOMER_KEY_DOWNEY
//   OD_CUSTOMER_KEY_MAYWOOD
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// injected automatically; the service role key is what lets sync and
// reset_password create and update Auth accounts.)
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

// The only place this shape is written or read. Kept ASCII-safe and
// lowercase because it is an email local-part, never shown to anyone.
const INTERNAL_EMAIL_DOMAIN = "dental-os.internal";

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function internalEmailFor(officeSlug: string, odUsername: string): string {
  return `${officeSlug}.${normalizeUsername(odUsername)}@${INTERNAL_EMAIL_DOMAIN}`;
}

function randomTempPassword(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

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
// everything from the offset onward.
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

// =====================================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }

  let body: {
    office?: string;
    action?: string;
    od_username?: string;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const action = (body.action ?? "").toLowerCase().trim();

  const serviceRole = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ===================================================================
  // list_offices — the login page's office picker. No sign-in exists
  // yet at this point, so this is the one action that asks nothing of
  // the caller beyond a valid Supabase project key (which the browser
  // sends automatically). Nothing it returns is sensitive.
  // ===================================================================
  if (action === "list_offices") {
    const { data, error } = await serviceRole
      .from("offices")
      .select("slug, name")
      .eq("is_active", true)
      .order("name");

    if (error) {
      return json({ ok: false, error: `Could not read offices: ${error.message}` }, 500);
    }

    return json({ ok: true, offices: data ?? [] });
  }

  // ===================================================================
  // list_usernames — the login page's own dropdown, live off
  // OpenDental. No sign-in exists yet here either; see the changelog
  // entry above for why that is a deliberate choice, not an oversight.
  // ===================================================================
  if (action === "list_usernames") {
    const officeSlug = (body.office ?? "").toLowerCase().trim();
    if (officeSlug === "") {
      return json({ ok: false, error: "Provide office." }, 400);
    }

    const { data: officeRow, error: officeError } = await serviceRole
      .from("offices")
      .select("id, slug, opendental_customer_key_name, is_active")
      .eq("slug", officeSlug)
      .maybeSingle();

    if (officeError) {
      return json({ ok: false, error: `Office lookup failed: ${officeError.message}` }, 500);
    }
    if (!officeRow || officeRow.is_active !== true) {
      return json({ ok: false, error: "That office was not found or is inactive." }, 404);
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

    const { rows, failed } = await shortQueryAll(
      `ODFHIR ${developerKey}/${customerKey}`,
      `SELECT u.UserName, ` +
        `TRIM(CONCAT(COALESCE(e.FName, ''), ' ', COALESCE(e.LName, ''))) AS FullName ` +
        `FROM userod u LEFT JOIN employee e ON e.EmployeeNum = u.EmployeeNum ` +
        `WHERE u.IsHidden = 0 ORDER BY u.UserName`,
    );

    if (failed !== null) {
      return json({
        ok: false,
        error: "OpenDental could not list its users.",
        detail: failed.body,
      }, 502);
    }

    return json({
      ok: true,
      users: rows
        .map((r) => ({
          od_username: String(r.UserName ?? "").trim(),
          full_name: String(r.FullName ?? "").trim(),
        }))
        .filter((u) => u.od_username !== ""),
    });
  }

  // ---- Every other action requires a signed-in office admin. ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "Missing Authorization bearer token." }, 401);
  }

  const asCaller = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return json({ ok: false, error: "Invalid or expired session." }, 401);
  }

  const officeSlug = (body.office ?? "").toLowerCase().trim();
  if (officeSlug === "") {
    return json({ ok: false, error: "Provide office." }, 400);
  }

  const { data: officeRow, error: officeError } = await serviceRole
    .from("offices")
    .select("id, slug, name, organization_id, opendental_customer_key_name, is_active")
    .eq("slug", officeSlug)
    .maybeSingle();

  if (officeError) {
    return json({ ok: false, error: `Office lookup failed: ${officeError.message}` }, 500);
  }
  if (!officeRow || officeRow.is_active !== true) {
    return json({ ok: false, error: "That office was not found or is inactive." }, 404);
  }

  const { data: isOfficeAdmin, error: adminError } = await asCaller.rpc(
    "is_office_admin",
    { target_office: officeRow.id },
  );
  if (adminError) {
    return json({ ok: false, error: `Permission check failed: ${adminError.message}` }, 500);
  }
  if (!isOfficeAdmin) {
    return json({ ok: false, error: "Owner/Admin at this office is required." }, 403);
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

  // ===================================================================
  // sync — provision new logins, leave existing ones alone, deprovision
  // ones OpenDental has since hidden.
  // ===================================================================
  if (action === "sync") {
    const { rows, failed } = await shortQueryAll(
      auth,
      `SELECT u.UserNum, u.UserName, u.IsHidden, ` +
        `COALESCE(e.FName, '') AS FName, COALESCE(e.LName, '') AS LName ` +
        `FROM userod u LEFT JOIN employee e ON e.EmployeeNum = u.EmployeeNum ` +
        `ORDER BY u.UserName`,
    );

    if (failed !== null) {
      return json({
        ok: false,
        error: "OpenDental could not list its users.",
        detail: failed.body,
      }, 502);
    }

    const { data: existingLogins, error: existingError } = await serviceRole
      .from("od_staff_logins")
      .select("id, od_user_num, od_username, full_name, is_active, user_id")
      .eq("office_id", officeRow.id);

    if (existingError) {
      return json({
        ok: false,
        error: `Could not read the existing login roster: ${existingError.message}`,
      }, 500);
    }

    const ledgerByUserNum = new Map(
      (existingLogins ?? []).map((r) => [num(r.od_user_num), r]),
    );

    const { data: frontDeskRole, error: roleError } = await serviceRole
      .from("roles")
      .select("id")
      .eq("key", "front_desk")
      .maybeSingle();

    if (roleError || !frontDeskRole) {
      return json({
        ok: false,
        error: "Could not find the front_desk role to assign new logins.",
        detail: roleError?.message,
      }, 500);
    }

    const provisioned: { od_username: string; full_name: string; temp_password: string }[] = [];
    const already: { od_username: string; full_name: string }[] = [];
    const skipped: { od_username: string; reason: string }[] = [];
    const seenUserNums = new Set<number>();

    for (const r of rows) {
      const userNum = num(r.UserNum);
      const odUsername = String(r.UserName ?? "").trim();
      const hidden = num(r.IsHidden) === 1;
      const fullName =
        `${String(r.FName ?? "").trim()} ${String(r.LName ?? "").trim()}`.trim() ||
        odUsername;

      if (userNum <= 0 || odUsername === "") continue;
      seenUserNums.add(userNum);

      if (hidden) continue; // handled in the deprovisioning pass below

      const ledgerRow = ledgerByUserNum.get(userNum);
      if (ledgerRow) {
        already.push({ od_username: odUsername, full_name: fullName });
        continue;
      }

      const normalized = normalizeUsername(odUsername);
      if (normalized === "") {
        skipped.push({ od_username: odUsername, reason: "no usable characters for a login" });
        continue;
      }

      const internalEmail = internalEmailFor(officeRow.slug, odUsername);
      const tempPassword = randomTempPassword();

      const { data: created, error: createError } = await serviceRole.auth.admin.createUser({
        email: internalEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { od_username: odUsername, office_slug: officeRow.slug, full_name: fullName },
      });

      if (createError || !created?.user) {
        skipped.push({
          od_username: odUsername,
          reason: createError?.message ?? "account creation failed",
        });
        continue;
      }

      const newUserId = created.user.id;

      // trg_on_auth_user_created already inserted this row the instant
      // createUser ran (handle_new_auth_user(), on conflict do nothing).
      // upsert rather than insert so this fills in full_name and
      // is_active on top of that row instead of colliding with it —
      // an earlier version used a plain insert here and every single
      // row failed on the primary key, leaving real Auth accounts
      // with no role and no ledger entry. Cleaned up via
      // cleanup_orphans below; this is the actual fix.
      const { error: usersError } = await serviceRole.from("users").upsert({
        id: newUserId,
        email: internalEmail,
        full_name: fullName,
        is_active: true,
      }, { onConflict: "id" });
      if (usersError) {
        skipped.push({ od_username: odUsername, reason: `users row failed: ${usersError.message}` });
        continue;
      }

      const { error: uorError } = await serviceRole.from("user_office_roles").insert({
        user_id: newUserId,
        office_id: officeRow.id,
        role_id: frontDeskRole.id,
      });
      if (uorError) {
        skipped.push({ od_username: odUsername, reason: `role assignment failed: ${uorError.message}` });
        continue;
      }

      const { error: ledgerError } = await serviceRole.from("od_staff_logins").insert({
        office_id: officeRow.id,
        od_user_num: userNum,
        od_username: odUsername,
        full_name: fullName,
        internal_email: internalEmail,
        user_id: newUserId,
        is_active: true,
      });
      if (ledgerError) {
        skipped.push({ od_username: odUsername, reason: `ledger row failed: ${ledgerError.message}` });
        continue;
      }

      provisioned.push({ od_username: odUsername, full_name: fullName, temp_password: tempPassword });
    }

    // ---- Deprovision: active in our ledger, hidden or gone in OD ----
    const deactivated: { od_username: string; full_name: string }[] = [];

    for (const login of existingLogins ?? []) {
      if (login.is_active !== true) continue;
      if (seenUserNums.has(num(login.od_user_num))) {
        // Seen and visible this run means still fine; seen and hidden
        // falls through to here too since the provisioning loop above
        // "continue"s past hidden rows without touching the ledger.
        const stillVisible = rows.some(
          (r) => num(r.UserNum) === num(login.od_user_num) && num(r.IsHidden) !== 1,
        );
        if (stillVisible) continue;
      }

      if (login.user_id) {
        await serviceRole.auth.admin.updateUserById(login.user_id, {
          ban_duration: "876000h", // ~100 years - OpenDental's own idea of "hidden, not deleted"
        });
      }

      await serviceRole
        .from("od_staff_logins")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", login.id);

      deactivated.push({
        od_username: String(login.od_username ?? ""),
        full_name: String(login.full_name ?? ""),
      });
    }

    return json({
      ok: true,
      office: officeRow.name,
      provisioned,
      already_provisioned: already,
      deactivated,
      skipped,
      read_at: new Date().toISOString(),
    });
  }

  // ===================================================================
  // cleanup_orphans — remove Auth accounts sync created but never
  // finished provisioning.
  //
  // Written for the v1 bug: sync's own users-table insert collided
  // with a trigger that had already created the row, so createUser
  // succeeded (a real Auth account, a real password) but every run
  // after it failed, and the account was left with no role and no
  // od_staff_logins entry — unreachable, since nothing recorded which
  // OpenDental user it was for or what its password had been. Finds
  // every Auth account under this office's synthetic email domain
  // with no matching ledger row, and deletes it (auth.users cascades
  // to the users row). Safe to run whenever `sync` reports skipped
  // rows whose reason mentions "users row failed" — run this, then
  // sync again.
  // ===================================================================
  if (action === "cleanup_orphans") {
    const domainSuffix = `@${INTERNAL_EMAIL_DOMAIN}`;
    const prefix = `${officeRow.slug}.`;

    const { data: ledgerRows, error: ledgerErr } = await serviceRole
      .from("od_staff_logins")
      .select("internal_email")
      .eq("office_id", officeRow.id);

    if (ledgerErr) {
      return json({ ok: false, error: `Could not read the ledger: ${ledgerErr.message}` }, 500);
    }

    const knownEmails = new Set((ledgerRows ?? []).map((r) => String(r.internal_email ?? "")));

    const removed: string[] = [];
    const failed: { email: string; reason: string }[] = [];

    for (let page = 1; page <= 20; page++) {
      const { data: pageData, error: listError } = await serviceRole.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listError) {
        return json({ ok: false, error: `Could not list accounts: ${listError.message}` }, 500);
      }

      const users = pageData?.users ?? [];
      if (users.length === 0) break;

      for (const u of users) {
        const userEmail = u.email ?? "";
        if (!userEmail.startsWith(prefix) || !userEmail.endsWith(domainSuffix)) continue;
        if (knownEmails.has(userEmail)) continue; // provisioned correctly, leave it alone

        const { error: deleteError } = await serviceRole.auth.admin.deleteUser(u.id);
        if (deleteError) {
          failed.push({ email: userEmail, reason: deleteError.message });
        } else {
          removed.push(userEmail);
        }
      }

      if (users.length < 200) break;
    }

    return json({ ok: true, office: officeRow.name, removed, failed });
  }

  // ===================================================================
  // reset_password — a new temporary password for one existing login.
  // ===================================================================
  if (action === "reset_password") {
    const odUsername = (body.od_username ?? "").trim();
    if (odUsername === "") {
      return json({ ok: false, error: "od_username is required." }, 400);
    }

    const { data: login, error: loginError } = await serviceRole
      .from("od_staff_logins")
      .select("id, user_id, od_username, is_active")
      .eq("office_id", officeRow.id)
      .ilike("od_username", odUsername)
      .maybeSingle();

    if (loginError) {
      return json({ ok: false, error: `Lookup failed: ${loginError.message}` }, 500);
    }
    if (!login || !login.user_id) {
      return json({ ok: false, error: "No provisioned login found for that username." }, 404);
    }
    if (login.is_active !== true) {
      return json({ ok: false, error: "That login has been deprovisioned." }, 400);
    }

    const tempPassword = randomTempPassword();
    const { error: updateError } = await serviceRole.auth.admin.updateUserById(login.user_id, {
      password: tempPassword,
    });

    if (updateError) {
      return json({ ok: false, error: `Could not reset the password: ${updateError.message}` }, 500);
    }

    return json({
      ok: true,
      od_username: login.od_username,
      temp_password: tempPassword,
      reset_at: new Date().toISOString(),
    });
  }

  return json({
    ok: false,
    error: "action must be list_offices, list_usernames, sync, cleanup_orphans, or reset_password.",
  }, 400);
});
