"use client";

// Top navigation — v6
// The one navigation bar for Dental OS. Rendered once in the root layout, so
// every page gets it without owning a header of its own.
//
// Behaviour:
//   - Hidden on /login, where there is nothing to navigate to.
//   - Sections are top-level tools. A section is active when the path starts
//     with its href, so /fee-schedules/review/<id> still highlights
//     Fee Schedules.
//   - Sections marked ready: false render greyed and unclickable. Charting is
//     the next one to be built.
//   - A second row appears inside a section that has sub-pages.
//   - Email and sign out live here and nowhere else.
//   - A build badge sits at the far right, showing what is actually
//     running.
//
// Changelog:
//   v1  Sections, sub-nav, session email, sign out.
//   v2  Charting is built, so its section is live rather than greyed.
//   v3  Adds the build badge.
//   v6  Change password, and an Admin section.
//
//       Change password sits beside Sign out because that is where a
//       person looks for it, not because it belongs to navigation.
//       It exists now because staff signing in with an OpenDental-
//       username account (od-staff-login) start on a one-time
//       temporary password with no other way to replace it.
//       supabase.auth.updateUser() needs nothing but the current
//       session, so this asks for the new password twice and nothing
//       else — no Edge Function, no re-entering the old one.
//
//       Admin links to /admin/users, gated inside the page itself
//       (is_office_admin) rather than here, the way every other
//       permission check in this app lives beside the data it
//       protects rather than in the nav that happens to link to it.
//
//   v5  The KPI section — the office KPI workbook, read live.
//   v4  The Production section.
//
//       A failed Vercel build is silent. Vercel builds the new version
//       alongside the old one and only swaps traffic when the build
//       succeeds, so a failure is never an outage — it just means the
//       swap never happened. Nothing errors and nothing looks wrong,
//       which is the problem: a push that never shipped is
//       indistinguishable from one that did.
//
//       The badge shows the commit rather than a version number for
//       two reasons. A version number describes one file and the app
//       is dozens, so there is no single honest number to show. And a
//       version number is typed by a person, so it is only ever as
//       accurate as their memory. Vercel supplies the commit it built
//       from, so this one cannot be wrong.
//
//       Scope, stated plainly: this covers the frontend only. Edge
//       Functions do not deploy through Git and are not represented
//       here at all — _session-sync.bat is what proves those.
//
//       Both values come through empty when a build was not triggered
//       by a Git commit, which is the normal case for local
//       development, so the badge reads "dev" instead of rendering
//       blank.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Injected at build time. The commit comes from Vercel's own system
// variables; the timestamp is stamped in next.config.ts, because Vercel
// does not supply one. Both are inlined by Next at build, so reading
// them in a client component is safe.
const COMMIT = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
const BUILT_AT = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";

function buildLabel(): string {
  if (COMMIT === "") return "dev";
  return COMMIT;
}

function buildTitle(): string {
  if (COMMIT === "") {
    return "Running locally. No Vercel build is involved.";
  }

  if (BUILT_AT === "") {
    return `Frontend built from commit ${COMMIT}.`;
  }

  const when = new Date(BUILT_AT);
  if (Number.isNaN(when.getTime())) {
    return `Frontend built from commit ${COMMIT}.`;
  }

  return (
    `Frontend built from commit ${COMMIT} on ` +
    `${when.toLocaleString()}. Edge Functions are not covered by this.`
  );
}

type Section = {
  href: string;
  label: string;
  ready: boolean;
  note?: string;
  subnav?: { href: string; label: string; exact: boolean }[];
};

const SECTIONS: Section[] = [
  {
    href: "/",
    label: "Home",
    ready: true,
  },
  {
    href: "/fee-schedules",
    label: "Fee schedules",
    ready: true,
    subnav: [
      { href: "/fee-schedules", label: "Upload", exact: true },
      { href: "/fee-schedules/uploads", label: "Staged uploads", exact: false },
    ],
  },
  {
    href: "/chart",
    label: "Charting",
    ready: true,
  },
  {
    href: "/hygiene",
    label: "Hygiene",
    ready: true,
  },
  {
    href: "/production",
    label: "Production",
    ready: true,
  },
  {
    href: "/kpi",
    label: "KPI",
    ready: true,
  },
  {
    href: "/admin/users",
    label: "Admin",
    ready: true,
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordDone, setPasswordDone] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (active) setEmail(data.session?.user.email ?? "");
      } catch {
        if (active) setEmail("");
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [pathname]);

  async function signOut() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/login");
    } catch {
      setSigningOut(false);
    }
  }

  function openChangePassword() {
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setPasswordDone(false);
    setChangingPassword(true);
  }

  async function savePassword() {
    if (newPassword.length < 8) {
      setPasswordError("Use at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Those two don't match.");
      return;
    }

    setPasswordSaving(true);
    setPasswordError("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });

      if (error) {
        setPasswordError(error.message);
        setPasswordSaving(false);
        return;
      }

      setPasswordDone(true);
      setPasswordSaving(false);
    } catch (caught) {
      setPasswordError(
        caught instanceof Error ? caught.message : "Something went wrong."
      );
      setPasswordSaving(false);
    }
  }

  if (pathname === "/login") return null;

  const current = SECTIONS.find(
    (section) => section.href !== "/" && isActive(pathname, section.href)
  );

  return (
    <header className="sticky top-0 z-40 border-b border-[#E3E1DB] bg-[#FBFAF8]/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
        <Link
          href="/"
          className="rounded font-mono text-xs tracking-[0.18em] text-[#0F6E56] uppercase focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
        >
          Dental OS
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {SECTIONS.map((section) => {
            const active = isActive(pathname, section.href);

            if (!section.ready) {
              return (
                <span
                  key={section.href}
                  title={section.note ?? ""}
                  aria-disabled="true"
                  className="cursor-not-allowed rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-[#A5A49D]"
                >
                  {section.label}
                </span>
              );
            }

            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none ${
                  active
                    ? "bg-[#0F6E56]/10 text-[#0F6E56]"
                    : "text-[#5C5C57] hover:bg-[#EDEBE5] hover:text-[#1C1C1A]"
                }`}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {email !== "" && (
            <p className="hidden text-sm text-[#7A7973] sm:block">{email}</p>
          )}
          <button
            type="button"
            onClick={openChangePassword}
            className="rounded text-sm font-medium whitespace-nowrap text-[#5C5C57] underline-offset-2 hover:text-[#1C1C1A] hover:underline focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
          >
            Change password
          </button>

          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="rounded text-sm font-medium whitespace-nowrap text-[#0F6E56] underline-offset-2 hover:underline focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:text-[#A5A49D]"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>

          <span
            title={buildTitle()}
            className="hidden rounded border border-[#E3E1DB] bg-white px-2 py-0.5 font-mono text-[11px] whitespace-nowrap text-[#A5A49D] md:inline"
          >
            {buildLabel()}
          </span>
        </div>
      </div>

      {current?.subnav && (
        <div className="border-t border-[#EDEBE5] bg-white">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-4 overflow-x-auto px-6 py-2">
            {current.subnav.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : isActive(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded border-b-2 px-1 py-1 text-sm whitespace-nowrap focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none ${
                    active
                      ? "border-[#0F6E56] font-medium text-[#0F6E56]"
                      : "border-transparent text-[#5C5C57] hover:text-[#1C1C1A]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {changingPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-[#E3E1DB] bg-white">
            <div className="border-b border-[#E3E1DB] px-5 py-3">
              <h2 className="text-[13px] font-bold tracking-[0.06em] text-[#1C1C1A] uppercase">
                Change password
              </h2>
            </div>

            <div className="p-5">
              {passwordDone ? (
                <>
                  <p className="text-sm text-[#1C1C1A]">
                    Password changed. Use it the next time you sign in.
                  </p>
                  <button
                    type="button"
                    onClick={() => setChangingPassword(false)}
                    className="mt-4 w-full rounded-lg bg-[#0F6E56] px-4 py-2 text-sm font-medium text-white hover:bg-[#0C5A46]"
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-[#1C1C1A]">
                    New password
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      autoFocus
                      className="mt-2 w-full rounded-lg border border-[#D8D6CF] bg-white px-3 py-2 text-[15px] text-[#1C1C1A] focus:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
                    />
                  </label>

                  <label className="mt-4 block text-sm font-medium text-[#1C1C1A]">
                    Confirm new password
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") savePassword();
                      }}
                      autoComplete="new-password"
                      className="mt-2 w-full rounded-lg border border-[#D8D6CF] bg-white px-3 py-2 text-[15px] text-[#1C1C1A] focus:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
                    />
                  </label>

                  {passwordError !== "" && (
                    <p className="mt-3 text-sm text-[#A4361F]">{passwordError}</p>
                  )}

                  <div className="mt-5 flex gap-2">
                    <button
                      type="button"
                      onClick={savePassword}
                      disabled={passwordSaving}
                      className="flex-1 rounded-lg bg-[#0F6E56] px-4 py-2 text-sm font-medium text-white hover:bg-[#0C5A46] disabled:cursor-not-allowed disabled:bg-[#D8D6CF]"
                    >
                      {passwordSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setChangingPassword(false)}
                      disabled={passwordSaving}
                      className="rounded-lg border border-[#D8D6CF] px-4 py-2 text-sm text-[#1C1C1A] hover:bg-[#F7F6F3]"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
