"use client";

// User management — v1
// Who has a login at this office, what role they hold, whether it
// came from OpenDental, and the two actions that matter: bring a new
// OpenDental login across (sync) and hand someone a fresh temporary
// password (reset). Built for an audience of one today — Shad — with
// the expectation he promotes a few more owner_admins from inside it.
//
// Nothing here is a general-purpose user editor. It does not create
// an account by hand, does not remove one, and does not touch
// anything for an office the signed-in admin does not hold owner_admin
// at — the office picker only ever lists offices that check is true
// for, so there is no office selector to misuse into someone else's
// roster.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Office = { id: string; slug: string; name: string };
type RoleOption = { id: string; key: string; name: string; rank: number };

type Roster = {
  uor_id: string;
  user_id: string;
  email: string;
  full_name: string;
  role_id: string;
  role_key: string;
  role_name: string;
  od_username: string | null;
  od_active: boolean | null;
};

type SyncResult = {
  provisioned: { od_username: string; full_name: string; temp_password: string }[];
  already_provisioned: { od_username: string; full_name: string }[];
  deactivated: { od_username: string; full_name: string }[];
  skipped: { od_username: string; reason: string }[];
};

export default function AdminUsersPage() {
  const router = useRouter();

  const [offices, setOffices] = useState<Office[]>([]);
  const [officeId, setOfficeId] = useState("");
  const [roles, setRoles] = useState<RoleOption[]>([]);

  const [roster, setRoster] = useState<Roster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState("");

  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ removed: string[]; failed: { email: string; reason: string }[] } | null>(null);
  const [cleanupError, setCleanupError] = useState("");

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ od_username: string; temp_password: string } | null>(null);
  const [resetError, setResetError] = useState("");

  const [savingRole, setSavingRole] = useState<string | null>(null);

  const officeSlug = useMemo(
    () => offices.find((o) => o.id === officeId)?.slug ?? "",
    [offices, officeId],
  );

  const callStaffLogin = useCallback(async (payload: Record<string, unknown>) => {
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("od-staff-login", {
      body: payload,
    });

    if (fnError) {
      const ctx = (fnError as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const parsed = await ctx.json();
          throw new Error(String(parsed?.error ?? "The server didn't respond as expected."));
        } catch (inner) {
          if (inner instanceof Error && inner.message !== "") throw inner;
        }
      }
      throw new Error("The server didn't respond as expected.");
    }

    if (!data?.ok) throw new Error(String(data?.error ?? "That request failed."));
    return data;
  }, []);

  // ---- Which offices this admin actually manages ----
  useEffect(() => {
    let active = true;

    (async () => {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();

      if (!sessionData.session) {
        router.replace("/login");
        return;
      }

      const uid = sessionData.session.user.id;

      const { data, error: rowError } = await supabase
        .from("user_office_roles")
        .select("office_id, offices(id, slug, name), roles(key)")
        .eq("user_id", uid);

      if (!active) return;

      if (rowError) {
        setError(rowError.message);
        setLoading(false);
        return;
      }

      type Row = { offices: Office | Office[] | null; roles: { key: string } | { key: string }[] | null };
      const adminOffices: Office[] = [];
      for (const row of (data ?? []) as unknown as Row[]) {
        const roleKey = Array.isArray(row.roles) ? row.roles[0]?.key : row.roles?.key;
        if (roleKey !== "owner_admin") continue;
        const office = Array.isArray(row.offices) ? row.offices[0] : row.offices;
        if (office) adminOffices.push(office);
      }

      setOffices(adminOffices);
      setOfficeId((previous) => previous || adminOffices[0]?.id || "");
      if (adminOffices.length === 0) setLoading(false);

      const { data: roleRows, error: roleErr } = await supabase
        .from("roles")
        .select("id, key, name, rank")
        .order("rank");
      if (!roleErr && active) setRoles((roleRows ?? []) as RoleOption[]);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  // ---- The roster for the selected office ----
  const loadRoster = useCallback(async () => {
    if (officeId === "") return;

    setLoading(true);
    setError("");

    try {
      const supabase = createClient();

      const { data: uorRows, error: uorError } = await supabase
        .from("user_office_roles")
        .select("id, user_id, role_id, users(email, full_name), roles(key, name)")
        .eq("office_id", officeId);

      if (uorError) throw new Error(uorError.message);

      const { data: loginRows, error: loginError } = await supabase
        .from("od_staff_logins")
        .select("user_id, od_username, is_active")
        .eq("office_id", officeId);

      if (loginError) throw new Error(loginError.message);

      const loginByUser = new Map(
        (loginRows ?? []).map((r) => [r.user_id as string, r]),
      );

      type UorRow = {
        id: string;
        user_id: string;
        role_id: string;
        users: { email: string; full_name: string | null } | { email: string; full_name: string | null }[] | null;
        roles: { key: string; name: string } | { key: string; name: string }[] | null;
      };

      const merged: Roster[] = ((uorRows ?? []) as unknown as UorRow[]).map((r) => {
        const user = Array.isArray(r.users) ? r.users[0] : r.users;
        const role = Array.isArray(r.roles) ? r.roles[0] : r.roles;
        const login = loginByUser.get(r.user_id);
        return {
          uor_id: r.id,
          user_id: r.user_id,
          email: user?.email ?? "",
          full_name: user?.full_name ?? "",
          role_id: r.role_id,
          role_key: role?.key ?? "",
          role_name: role?.name ?? "",
          od_username: login ? String(login.od_username ?? "") : null,
          od_active: login ? login.is_active === true : null,
        };
      });

      merged.sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
      setRoster(merged);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read this office's users.");
      setRoster([]);
    } finally {
      setLoading(false);
    }
  }, [officeId]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  // ---- Sync: bring OpenDental's current users across ----
  async function runSync() {
    if (officeSlug === "") return;

    setSyncing(true);
    setSyncError("");
    setSyncResult(null);

    try {
      const data = await callStaffLogin({ action: "sync", office: officeSlug });
      setSyncResult({
        provisioned: data.provisioned ?? [],
        already_provisioned: data.already_provisioned ?? [],
        deactivated: data.deactivated ?? [],
        skipped: data.skipped ?? [],
      });
      await loadRoster();
    } catch (caught) {
      setSyncError(caught instanceof Error ? caught.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  // ---- Clean up accounts a broken sync run left half-finished ----
  async function runCleanup() {
    if (officeSlug === "") return;

    setCleaning(true);
    setCleanupError("");
    setCleanupResult(null);

    try {
      const data = await callStaffLogin({ action: "cleanup_orphans", office: officeSlug });
      setCleanupResult({ removed: data.removed ?? [], failed: data.failed ?? [] });
      await loadRoster();
    } catch (caught) {
      setCleanupError(caught instanceof Error ? caught.message : "Cleanup failed.");
    } finally {
      setCleaning(false);
    }
  }

  // ---- Reset one person's password ----
  async function resetPassword(row: Roster) {
    if (row.od_username === null || officeSlug === "") return;

    setResettingId(row.uor_id);
    setResetError("");
    setResetResult(null);

    try {
      const data = await callStaffLogin({
        action: "reset_password",
        office: officeSlug,
        od_username: row.od_username,
      });
      setResetResult({ od_username: data.od_username, temp_password: data.temp_password });
    } catch (caught) {
      setResetError(caught instanceof Error ? caught.message : "Could not reset that password.");
    } finally {
      setResettingId(null);
    }
  }

  // ---- Change someone's role ----
  async function changeRole(row: Roster, roleId: string) {
    if (roleId === row.role_id) return;

    setSavingRole(row.uor_id);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("user_office_roles")
        .update({ role_id: roleId })
        .eq("id", row.uor_id);

      if (updateError) throw new Error(updateError.message);
      await loadRoster();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change that role.");
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F6F3] px-4 py-6 text-[#1C1C1A] sm:px-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">User management</h1>
          <div className="flex-1" />
          {offices.length > 1 && (
            <select
              value={officeId}
              onChange={(e) => {
                setOfficeId(e.target.value);
                setSyncResult(null);
                setResetResult(null);
              }}
              className="rounded-lg border border-[#D8D6CF] bg-white px-3 py-1.5 text-sm text-[#1C1C1A] focus:border-[#0F6E56] focus:outline-none"
            >
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {offices.length === 0 && !loading && (
          <p className="rounded-xl border border-[#E3E1DB] bg-white px-4 py-3 text-sm text-[#5C5C57]">
            You are not an Owner/Admin at any office, so there is nothing to manage here.
          </p>
        )}

        {offices.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E3E1DB] bg-white px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#1C1C1A]">
                  Bring OpenDental&apos;s current users into Dental OS
                </p>
                <p className="text-xs text-[#7A7973]">
                  Safe to run again — existing logins are left alone, and anyone
                  OpenDental has since hidden is turned off automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={runSync}
                disabled={syncing}
                className="ml-auto rounded-lg bg-[#0F6E56] px-4 py-2 text-sm font-medium whitespace-nowrap text-white hover:bg-[#0C5A46] disabled:cursor-not-allowed disabled:bg-[#D8D6CF]"
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>

            {syncError !== "" && (
              <p className="rounded-xl border border-[#E4674F]/40 bg-[#FBEAE7] px-4 py-3 text-sm text-[#A4361F]">
                {syncError}
              </p>
            )}

            {syncResult !== null && (
              <div className="rounded-xl border border-[#0F6E56]/30 bg-[#EFF7F4] px-4 py-3 text-sm">
                {syncResult.provisioned.length > 0 ? (
                  <>
                    <p className="font-medium text-[#1C1C1A]">
                      {syncResult.provisioned.length} new login
                      {syncResult.provisioned.length === 1 ? "" : "s"} created. Each
                      password is shown once, right here — write them down or hand
                      them out now.
                    </p>
                    <ul className="mt-2 space-y-1 font-mono text-xs">
                      {syncResult.provisioned.map((p) => (
                        <li key={p.od_username} className="rounded bg-white px-2 py-1">
                          <span className="text-[#5C5C57]">{p.full_name || p.od_username}</span>
                          {" — "}
                          <span className="text-[#1C1C1A]">{p.od_username}</span>
                          {" / "}
                          <span className="font-bold text-[#0F6E56]">{p.temp_password}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-[#1C1C1A]">No new logins to create — everyone visible in OpenDental already has one.</p>
                )}
                {syncResult.deactivated.length > 0 && (
                  <p className="mt-2 text-xs text-[#7A7973]">
                    Turned off (hidden in OpenDental now): {syncResult.deactivated.map((d) => d.od_username).join(", ")}
                  </p>
                )}
                {syncResult.skipped.length > 0 && (
                  <>
                    <p className="mt-2 text-xs text-[#A4361F]">
                      Skipped: {syncResult.skipped.map((s) => `${s.od_username} (${s.reason})`).join("; ")}
                    </p>
                    {syncResult.skipped.some((s) => s.reason.includes("users row failed")) && (
                      <div className="mt-3 flex items-center gap-3 rounded-lg border border-[#E4674F]/40 bg-[#FBEAE7] px-3 py-2">
                        <p className="text-xs text-[#A4361F]">
                          Those accounts were created but left broken — clean them
                          up, then Sync again to finish them properly.
                        </p>
                        <button
                          type="button"
                          onClick={runCleanup}
                          disabled={cleaning}
                          className="ml-auto rounded-lg border border-[#A4361F] px-3 py-1.5 text-xs font-medium whitespace-nowrap text-[#A4361F] hover:bg-white disabled:opacity-50"
                        >
                          {cleaning ? "Cleaning up…" : "Clean up broken accounts"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {cleanupError !== "" && (
              <p className="rounded-xl border border-[#E4674F]/40 bg-[#FBEAE7] px-4 py-3 text-sm text-[#A4361F]">
                {cleanupError}
              </p>
            )}
            {cleanupResult !== null && (
              <div className="rounded-xl border border-[#E3E1DB] bg-white px-4 py-3 text-sm">
                <p className="text-[#1C1C1A]">
                  Removed {cleanupResult.removed.length} broken account
                  {cleanupResult.removed.length === 1 ? "" : "s"}.
                  {cleanupResult.removed.length > 0 && " Sync now to create them properly."}
                </p>
                {cleanupResult.failed.length > 0 && (
                  <p className="mt-1 text-xs text-[#A4361F]">
                    Could not remove: {cleanupResult.failed.map((f) => `${f.email} (${f.reason})`).join("; ")}
                  </p>
                )}
              </div>
            )}

            {resetResult !== null && (
              <div className="flex items-center justify-between rounded-xl border border-[#0F6E56]/30 bg-[#EFF7F4] px-4 py-3 text-sm">
                <p>
                  New password for <span className="font-medium">{resetResult.od_username}</span>:{" "}
                  <span className="font-mono font-bold text-[#0F6E56]">{resetResult.temp_password}</span>
                  {" "}— shown once. Hand it to them now.
                </p>
                <button
                  type="button"
                  onClick={() => setResetResult(null)}
                  className="ml-3 text-xs text-[#5C5C57] hover:text-[#1C1C1A]"
                >
                  Dismiss
                </button>
              </div>
            )}
            {resetError !== "" && (
              <p className="rounded-xl border border-[#E4674F]/40 bg-[#FBEAE7] px-4 py-3 text-sm text-[#A4361F]">
                {resetError}
              </p>
            )}

            {error !== "" && (
              <p className="rounded-xl border border-[#E4674F]/40 bg-[#FBEAE7] px-4 py-3 text-sm text-[#A4361F]">
                {error}
              </p>
            )}

            <div className="overflow-hidden rounded-xl border border-[#E3E1DB] bg-white">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#E3E1DB] text-left text-xs font-semibold text-[#7A7973] uppercase">
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">OpenDental login</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDEBE5]">
                  {loading && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-[#7A7973]">
                        Reading…
                      </td>
                    </tr>
                  )}
                  {!loading && roster.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-[#7A7973]">
                        Nobody has a role at this office yet.
                      </td>
                    </tr>
                  )}
                  {roster.map((row) => (
                    <tr key={row.uor_id}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[#1C1C1A]">
                          {row.full_name || row.email}
                        </p>
                        <p className="text-xs text-[#7A7973]">{row.email}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={row.role_id}
                          onChange={(e) => changeRole(row, e.target.value)}
                          disabled={savingRole === row.uor_id}
                          className="rounded-lg border border-[#D8D6CF] bg-white px-2 py-1 text-sm text-[#1C1C1A] focus:border-[#0F6E56] focus:outline-none disabled:opacity-50"
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        {row.od_username === null ? (
                          <span className="text-xs text-[#A5A49D]">not from OpenDental</span>
                        ) : (
                          <span className="font-mono text-xs text-[#5C5C57]">
                            {row.od_username}
                            {row.od_active === false && (
                              <span className="ml-1.5 rounded bg-[#FBEAE7] px-1.5 py-0.5 text-[#A4361F]">
                                deactivated
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {row.od_username !== null && row.od_active !== false && (
                          <button
                            type="button"
                            onClick={() => resetPassword(row)}
                            disabled={resettingId === row.uor_id}
                            className="rounded-lg border border-[#D8D6CF] px-3 py-1 text-xs text-[#1C1C1A] hover:bg-[#F7F6F3] disabled:opacity-50"
                          >
                            {resettingId === row.uor_id ? "Resetting…" : "Reset password"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
