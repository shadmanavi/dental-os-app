"use client";

// Home — v2
// The landing page. One tile per tool. Tools that aren't built yet render
// greyed and unclickable rather than being hidden, so the shape of the
// product is visible from the front door.
//
// Session guard only — no data is read here.
//
// Changelog:
//   v1  Tile grid, session guard. Replaces the fee schedule upload screen,
//       which moved to /fee-schedules.
//   v2  Dropped the Staged uploads tile. Staged uploads is part of the fee
//       schedule upload tool, not a tool of its own, and it is already one
//       click away in the section sub-nav.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Tool = {
  href: string;
  eyebrow: string;
  title: string;
  blurb: string;
  ready: boolean;
};

const TOOLS: Tool[] = [
  {
    href: "/fee-schedules",
    eyebrow: "Fee schedules",
    title: "Fee schedule upload",
    blurb:
      "Match a payer's CSV against OpenDental on CDT code, review every change, then push. Staged files stay reachable from inside the tool.",
    ready: true,
  },
  {
    href: "/chart",
    eyebrow: "Chairside",
    title: "Charting",
    blurb:
      "Tap through categories to record existing conditions and diagnosed treatment from the operatory.",
    ready: false,
  },
];

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;

    async function guard() {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace("/login");
          return;
        }
        if (active) setChecking(false);
      } catch {
        router.replace("/login");
      }
    }

    guard();

    return () => {
      active = false;
    };
  }, [router]);

  if (checking) {
    return (
      <main className="min-h-screen bg-[#F7F6F3] px-6 py-10 text-[#1C1C1A]">
        <div className="mx-auto w-full max-w-4xl">
          <p className="text-[15px] text-[#5C5C57]">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F7F6F3] px-6 py-10 text-[#1C1C1A]">
      <div className="mx-auto w-full max-w-4xl">
        <p className="font-mono text-xs tracking-[0.18em] text-[#0F6E56] uppercase">
          Greenwood Dental Services
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Dental OS
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#5C5C57]">
          Pick a tool. OpenDental stays the source of truth — nothing here writes
          to it until you review and approve.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {TOOLS.map((tool) => {
            if (!tool.ready) {
              return (
                <div
                  key={tool.href}
                  aria-disabled="true"
                  className="rounded-xl border border-dashed border-[#E3E1DB] bg-white/50 p-6"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-mono text-xs tracking-[0.14em] text-[#A5A49D] uppercase">
                      {tool.eyebrow}
                    </p>
                    <span className="rounded-full border border-[#E3E1DB] bg-[#FBFAF8] px-3 py-1 text-xs font-medium text-[#A5A49D]">
                      Coming soon
                    </span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-[#A5A49D]">
                    {tool.title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-[#A5A49D]">
                    {tool.blurb}
                  </p>
                </div>
              );
            }

            return (
              <Link
                key={tool.href}
                href={tool.href}
                className="group rounded-xl border border-[#E3E1DB] bg-white p-6 transition-colors hover:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
              >
                <p className="font-mono text-xs tracking-[0.14em] text-[#0F6E56] uppercase">
                  {tool.eyebrow}
                </p>
                <h2 className="mt-3 text-lg font-semibold text-[#1C1C1A]">
                  {tool.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#5C5C57]">
                  {tool.blurb}
                </p>
                <p className="mt-4 text-sm font-medium text-[#0F6E56] underline-offset-2 group-hover:underline">
                  Open
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
