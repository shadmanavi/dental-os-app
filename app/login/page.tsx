"use client";

// Sign in — v2
// Office + OpenDental username + password, against Supabase Auth. On
// success, sends the user to the home page.
//
// Changelog:
//   v2  Username, not email.
//
//       Staff already have a username in OpenDental; this app used to
//       ask for a separate email nobody had memorized. The email
//       Supabase Auth actually checks against is now computed here,
//       the same way od-staff-login's `sync` action creates it:
//       "<office slug>.<username lowercased>@dental-os.internal" — a
//       synthetic address nobody is ever sent mail at, not a real
//       email a person needs to remember. Two files compute this one
//       string identically on purpose; changing the shape in one
//       without the other locks every provisioned account out.
//
//       The office list comes from od-staff-login's `list_offices`
//       action, read before anyone is signed in — the same office
//       names shown everywhere else in the app, not typed here twice.
//
//   v1  Email + password against Supabase Auth.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

type Office = { slug: string; name: string };

// Mirrors od-staff-login's normalizeUsername() / internalEmailFor()
// exactly. If this drifts from that function, every provisioned
// account stops resolving to the email Supabase Auth actually holds.
function internalEmailFor(officeSlug: string, username: string): string {
  const normalized = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `${officeSlug}.${normalized}@dental-os.internal`;
}

export default function LoginPage() {
  const router = useRouter();

  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSlug, setOfficeSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [officesError, setOfficesError] = useState("");

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const supabase = createClient();
        const { data, error: fnError } = await supabase.functions.invoke(
          "od-staff-login",
          { body: { action: "list_offices" } },
        );

        if (!active) return;

        if (fnError || !data?.ok) {
          setOfficesError("Couldn't load the office list.");
          return;
        }

        const list = (data.offices ?? []) as Office[];
        setOffices(list);
        setOfficeSlug((previous) => previous || list[0]?.slug || "");
      } catch {
        if (active) setOfficesError("Couldn't load the office list.");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function signIn() {
    if (officeSlug === "" || username.trim() === "" || password === "") return;

    setBusy(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: internalEmailFor(officeSlug, username),
        password,
      });

      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "That username and password don't match an account at this office."
            : signInError.message
        );
        setBusy(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Something went wrong signing in."
      );
      setBusy(false);
    }
  }

  const canSubmit = officeSlug !== "" && username.trim() !== "" && password !== "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F6F3] px-6 py-14 text-[#1C1C1A]">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs tracking-[0.18em] text-[#0F6E56] uppercase">
          Dental OS
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in</h1>

        <div className="mt-8 rounded-xl border border-[#E3E1DB] bg-white p-6">
          <div>
            <label htmlFor="office" className="block text-sm font-medium text-[#1C1C1A]">
              Office
            </label>
            <select
              id="office"
              value={officeSlug}
              onChange={(e) => setOfficeSlug(e.target.value)}
              disabled={offices.length === 0}
              className="mt-2 w-full rounded-lg border border-[#D8D6CF] bg-white px-3 py-2.5 text-[15px] text-[#1C1C1A] focus:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:bg-[#F7F6F3]"
            >
              {offices.length === 0 && <option value="">Loading…</option>}
              {offices.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.name}
                </option>
              ))}
            </select>
            {officesError !== "" && (
              <p className="mt-1.5 text-xs text-[#A4361F]">{officesError}</p>
            )}
          </div>

          <div className="mt-5">
            <label htmlFor="username" className="block text-sm font-medium text-[#1C1C1A]">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") signIn();
              }}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Your OpenDental username"
              className="mt-2 w-full rounded-lg border border-[#D8D6CF] bg-white px-3 py-2.5 text-[15px] text-[#1C1C1A] focus:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
            />
          </div>

          <div className="mt-5">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[#1C1C1A]"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") signIn();
              }}
              autoComplete="current-password"
              className="mt-2 w-full rounded-lg border border-[#D8D6CF] bg-white px-3 py-2.5 text-[15px] text-[#1C1C1A] focus:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
            />
          </div>

          {error !== "" && (
            <p className="mt-4 text-sm text-[#A4361F]">{error}</p>
          )}

          <button
            type="button"
            onClick={signIn}
            disabled={busy || !canSubmit}
            className="mt-6 w-full rounded-lg bg-[#0F6E56] px-6 py-2.5 text-[15px] font-medium text-white hover:bg-[#0C5A46] focus:ring-2 focus:ring-[#0F6E56]/30 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#D8D6CF] disabled:text-[#8F8E87]"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}
