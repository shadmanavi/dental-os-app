"use client";

// Home — v3
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
//   v3  Charting is built; its tile is live rather than 'coming soon'.
//   v4  The Production Dashboard tile.
//   v5  The Provider Summary tile.
//   v6  KPI and Admin tiles; every tile shrinks. TopNav now shows only
//       Home, so this grid is the one way in to everything else until
//       a menu grouping is settled — smaller tiles fit more of them
//       above the fold, and a shorter blurb replaces the "Open" line
//       the extra tiles didn't leave room for.

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
      "Tap through categories to record existing conditions and diagnosed treatment from the operatory. Writes straight to OpenDental.",
    ready: true,
  },
  {
    href: "/hygiene",
    eyebrow: "Front desk",
    title: "Hygiene Dashboard",
    blurb:
      "A month of hygiene, a day to a row. Slots the roster put on offer, what got booked, what is still open, and once the day has been, who showed and who did not.",
    ready: true,
  },
  {
    href: "/production",
    eyebrow: "Front desk",
    title: "Production Dashboard",
    blurb:
      "A month of production, a day to a row. What the book promised in dollars, who came, what was actually produced by each provider — and who left no note behind.",
    ready: true,
  },
  {
    href: "/provider-summary",
    eyebrow: "Providers",
    title: "Provider Summary",
    blurb:
      "A month by provider. Days scheduled against days actually worked, patients seen, production and production per day — and whose charts are missing notes.",
    ready: true,
  },
  {
    href: "/kpi",
    eyebrow: "Owner",
    title: "Office KPIs",
    blurb:
      "The KPI workbook, read live: net production and Adj by department, collection, exams, hygiene ratios, and today's aging.",
    ready: true,
  },
  {
    href: "/admin/users",
    eyebrow: "Owner",
    title: "Admin",
    blurb:
      "Bring OpenDental's users into Dental OS, reset a password, or change someone's role. Visible to everyone; only an Owner/Admin can act.",
    ready: true,
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

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => {
            if (!tool.ready) {
              return (
                <div
                  key={tool.href}
                  aria-disabled="true"
                  className="rounded-lg border border-dashed border-[#E3E1DB] bg-white/50 p-3.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-mono text-[11px] tracking-[0.12em] text-[#A5A49D] uppercase">
                      {tool.eyebrow}
                    </p>
                    <span className="rounded-full border border-[#E3E1DB] bg-[#FBFAF8] px-2 py-0.5 text-[11px] font-medium text-[#A5A49D]">
                      Coming soon
                    </span>
                  </div>
                  <h2 className="mt-1.5 text-[15px] font-semibold text-[#A5A49D]">
                    {tool.title}
                  </h2>
                  <p className="mt-1 text-xs leading-snug text-[#A5A49D]">
                    {tool.blurb}
                  </p>
                </div>
              );
            }

            return (
              <Link
                key={tool.href}
                href={tool.href}
                className="group rounded-lg border border-[#E3E1DB] bg-white p-3.5 transition-colors hover:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
              >
                <p className="font-mono text-[11px] tracking-[0.12em] text-[#0F6E56] uppercase">
                  {tool.eyebrow}
                </p>
                <h2 className="mt-1.5 text-[15px] font-semibold text-[#1C1C1A]">
                  {tool.title}
                </h2>
                <p className="mt-1 text-xs leading-snug text-[#5C5C57]">
                  {tool.blurb}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
