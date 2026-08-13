"use client";

// Top navigation — v2
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
//
// Changelog:
//   v1  Sections, sub-nav, session email, sign out.
//   v2  Charting is built, so its section is live rather than greyed.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

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
            onClick={signOut}
            disabled={signingOut}
            className="rounded text-sm font-medium whitespace-nowrap text-[#0F6E56] underline-offset-2 hover:underline focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:text-[#A5A49D]"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
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
    </header>
  );
}
