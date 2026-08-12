"use client";

// Sign in — v1
// Email + password against Supabase Auth. On success, sends the user to the
// upload page. Session is stored by the Supabase client automatically.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    if (email.trim() === "" || password === "") return;

    setBusy(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "That email and password don't match an account."
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F6F3] px-6 py-14 text-[#1C1C1A]">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs tracking-[0.18em] text-[#0F6E56] uppercase">
          Dental OS
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in</h1>

        <div className="mt-8 rounded-xl border border-[#E3E1DB] bg-white p-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[#1C1C1A]">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") signIn();
              }}
              autoComplete="username"
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
            disabled={busy || email.trim() === "" || password === ""}
            className="mt-6 w-full rounded-lg bg-[#0F6E56] px-6 py-2.5 text-[15px] font-medium text-white hover:bg-[#0C5A46] focus:ring-2 focus:ring-[#0F6E56]/30 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#D8D6CF] disabled:text-[#8F8E87]"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}
