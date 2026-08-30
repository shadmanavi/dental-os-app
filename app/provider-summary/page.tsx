"use client";

// Provider Summary — v4
// A month by provider, one row each: the days OpenDental scheduled
// them against the days they actually produced, patients seen, what it
// added to, what a working day averaged, and how many of their
// patients have no note.
//
// Grew out of the Production Dashboard, where this table sat under the
// day rows; it earned its own page when it earned its own questions.
//
// Changelog:
//   v4  The General rows carry exams and diagnosis per exam. Exams is
//       completed exam procedures on the doctor's number; Dx/exam is
//       the dollars they treatment-planned this month over those
//       exams — what an exam turns into, on average. The other groups
//       show a dash; hygienists and specialists are not examiners.
//
//   v3  Three groups instead of two — General, Specialists, Hygienists
//       — each with its own subtotal line, and the foot row named for
//       what it is: the office total.
//
//   v2  Two tables in one: Doctors — general practice first, then the
//       specialists — and Hygienists, each group under its own header
//       row carrying the group's patients, production and undocumented
//       subtotals. Specialty reads beside each doctor's name.
//
//   v1  First build. Office switch, month paging, the provider table.
//       Reads od-production (action providers); writes nothing.
//
// Why the numbers are what they are, in short:
//
//   Days scheduled is the OpenDental roster — days this month the
//   schedule has the provider down to work, past and still to come.
//
//   Days worked is a day with completed work on their number. The two
//   drift apart for good reasons (the month is not over yet) and bad
//   ones (scheduled and produced nothing), and the gap is the point of
//   showing both.
//
//   Per day is production over days worked — what a day in the chair
//   actually averaged, not what the roster hoped.

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Office = { id: string; slug: string; name: string };

type ProvRow = {
  prov_num: number;
  abbr: string;
  name: string;
  specialty: string;
  is_hygienist: boolean;
  is_gp: boolean;
  days_scheduled: number;
  days_worked: number;
  patients: number;
  exams: number;
  dx_count: number;
  dx_fees: number;
  production: number;
  nonote: number;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Local time, not UTC. toISOString() would roll the month over from
// mid-afternoon onwards in California.
function todayParts(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// Whole dollars. The cents never change a decision this screen serves.
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export default function ProviderSummaryPage() {
  const router = useRouter();

  const now = todayParts();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);

  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSlug, setOfficeSlug] = useState("");

  const [providers, setProviders] = useState<ProvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ---- Session and offices ----
  useEffect(() => {
    let active = true;

    (async () => {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();

      if (!sessionData.session) {
        router.replace("/login");
        return;
      }

      const { data, error: officeErr } = await supabase
        .from("offices")
        .select("id, slug, name")
        .eq("is_active", true)
        .order("name");

      if (!active) return;

      if (officeErr) {
        setError(officeErr.message);
        setLoading(false);
        return;
      }

      const list = (data ?? []) as Office[];
      setOffices(list);
      setOfficeSlug((previous) => previous || list[0]?.slug || "");
      if (list.length === 0) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  // ---- The month, by provider ----
  const load = useCallback(async () => {
    if (officeSlug === "") return;

    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { data, error: fnError } = await supabase.functions.invoke("od-production", {
        body: { office: officeSlug, action: "providers", year, month },
      });

      if (fnError) {
        const ctx = (fnError as { context?: Response }).context;
        let message = "The server didn't respond as expected.";
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            message = String(parsed?.error ?? message);
          } catch {
            // Keep the generic message.
          }
        }
        setError(message);
        setProviders([]);
        return;
      }

      if (!data?.ok) {
        setError(String(data?.error ?? "That month could not be read."));
        setProviders([]);
        return;
      }

      setProviders((data.providers ?? []) as ProvRow[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That month could not be read.");
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, [officeSlug, year, month]);

  useEffect(() => {
    load();
  }, [load]);

  const step = (by: number) => {
    const m = month + by;
    if (m < 1) {
      setYear(year - 1);
      setMonth(12);
    } else if (m > 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(m);
    }
  };

  const totals = providers.reduce(
    (t, p) => ({
      patients: t.patients + p.patients,
      production: t.production + p.production,
      nonote: t.nonote + p.nonote,
    }),
    { patients: 0, production: 0, nonote: 0 },
  );

  // Three tables in one — general practice, the specialists, and the
  // hygienists — each totalled on its own line. Production sorts
  // within each; the rows arrive from the server already sorted.
  const groups = [
    { title: "General", rows: providers.filter((p) => !p.is_hygienist && p.is_gp) },
    { title: "Specialists", rows: providers.filter((p) => !p.is_hygienist && !p.is_gp) },
    { title: "Hygienists", rows: providers.filter((p) => p.is_hygienist) },
  ].filter((g) => g.rows.length > 0);

  return (
    <main className="min-h-screen bg-[#0B1719] px-4 py-4 text-[#EDF3F1] sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        {/* One bar: name, office, month. */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[17px] font-bold tracking-[-0.01em]">Provider Summary</h1>
          <Link
            href="/production"
            className="text-xs text-[#79B4C4] underline decoration-dotted underline-offset-2 hover:text-[#EDF3F1]"
          >
            ← Production
          </Link>
          <div className="flex-1" />

          <div className="flex gap-1" role="group" aria-label="Office">
            {offices.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setOfficeSlug(o.slug)}
                aria-pressed={o.slug === officeSlug}
                className={`rounded-lg border px-3 py-1 text-xs ${
                  o.slug === officeSlug
                    ? "border-[#79B4C4] bg-[#16292D] text-[#EDF3F1]"
                    : "border-[#2C4E54] text-[#8AA6AB] hover:bg-[#16292D]"
                }`}
              >
                {o.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 font-mono text-xs text-[#8AA6AB]">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous month"
              className="h-6 w-6 rounded-md border border-[#2C4E54] leading-none hover:bg-[#16292D]"
            >
              ←
            </button>
            <span className="min-w-[104px] text-center">
              {MONTHS[month - 1]} {year}
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next month"
              className="h-6 w-6 rounded-md border border-[#2C4E54] leading-none hover:bg-[#16292D]"
            >
              →
            </button>
          </div>
        </div>

        {error !== "" && (
          <p className="rounded-xl border border-[#E4674F] bg-[#2A1714] px-4 py-3 text-sm text-[#F3B0A2]">
            {error}
          </p>
        )}

        <div className="overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="border-b border-[#2C4E54] text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                  <th className="px-3.5 py-2 text-left">Provider</th>
                  <th className="px-3.5 py-2 text-right">Days sched</th>
                  <th className="px-3.5 py-2 text-right">Days worked</th>
                  <th className="px-3.5 py-2 text-right">Patients</th>
                  <th className="px-3.5 py-2 text-right">Exams</th>
                  <th className="px-3.5 py-2 text-right">Dx/exam</th>
                  <th className="px-3.5 py-2 text-right">Production</th>
                  <th className="px-3.5 py-2 text-right">Per day</th>
                  <th className="px-3.5 py-2 text-right">Undocumented</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={9} className="px-3.5 py-8 text-center text-sm text-[#8AA6AB]">
                      Reading the month…
                    </td>
                  </tr>
                )}

                {!loading && providers.length === 0 && error === "" && (
                  <tr>
                    <td colSpan={9} className="px-3.5 py-8 text-center text-sm text-[#4A6165]">
                      Nothing produced this month.
                    </td>
                  </tr>
                )}

                {!loading && groups.map((g) => (
                  <Fragment key={g.title}>
                  {/* The group's own line: who it is, and what its
                      rows add to. */}
                  <tr className="bg-[#16292D] font-mono text-xs font-bold tabular-nums text-[#8AA6AB]">
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-1.5 font-sans text-[10px] uppercase tracking-[0.08em]">
                      {g.title} · {g.rows.length}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-1.5" />
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-1.5" />
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-1.5 text-right">
                      {g.rows.reduce((s, p) => s + p.patients, 0)}
                    </td>
                    {/* Exams and diagnosis are General's figures; the
                        other groups are not examiners. */}
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-1.5 text-right">
                      {g.title === "General"
                        ? g.rows.reduce((s, p) => s + p.exams, 0)
                        : ""}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-1.5 text-right">
                      {(() => {
                        if (g.title !== "General") return "";
                        const e = g.rows.reduce((s, p) => s + p.exams, 0);
                        const f = g.rows.reduce((s, p) => s + p.dx_fees, 0);
                        return e > 0 ? usd(f / e) : "";
                      })()}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-1.5 text-right text-[#79B4C4]">
                      {usd(g.rows.reduce((s, p) => s + p.production, 0))}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-1.5" />
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-1.5 text-right">
                      {(() => {
                        const n = g.rows.reduce((s, p) => s + p.nonote, 0);
                        return n === 0 ? (
                          <span className="font-normal text-[#4A6165]">0</span>
                        ) : (
                          <span className="text-[#E4674F]">{n}</span>
                        );
                      })()}
                    </td>
                  </tr>

                  {g.rows.map((p) => (
                  <tr key={p.prov_num} className="font-mono text-sm tabular-nums">
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 font-sans text-[#EDF3F1]">
                      {p.name}
                      <span className="ml-2 text-xs text-[#4A6165]">
                        {p.abbr !== "" && p.abbr !== p.name ? p.abbr : ""}
                        {!p.is_hygienist && p.specialty !== "" ? ` · ${p.specialty}` : ""}
                      </span>
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right text-[#8AA6AB]">
                      {p.days_scheduled === 0 ? (
                        <span className="text-[#4A6165]">—</span>
                      ) : (
                        p.days_scheduled
                      )}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                      {p.days_worked}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                      {p.patients}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                      {p.is_gp ? (
                        p.exams
                      ) : (
                        <span className="text-[#4A6165]">—</span>
                      )}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                      {p.is_gp && p.exams > 0 ? (
                        usd(p.dx_fees / p.exams)
                      ) : (
                        <span className="text-[#4A6165]">—</span>
                      )}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right text-[#79B4C4]">
                      {usd(p.production)}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                      {p.days_worked > 0 ? (
                        usd(p.production / p.days_worked)
                      ) : (
                        <span className="text-[#4A6165]">—</span>
                      )}
                    </td>
                    <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                      {p.nonote === 0 ? (
                        <span className="text-[#4A6165]">0</span>
                      ) : (
                        <span className="font-bold text-[#E4674F]">{p.nonote}</span>
                      )}
                    </td>
                  </tr>
                  ))}
                  </Fragment>
                ))}
              </tbody>

              {!loading && providers.length > 0 && (
                <tfoot>
                  <tr className="font-mono text-sm font-bold tabular-nums">
                    <td className="px-3.5 py-2 font-sans text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                      Office total · {MONTHS[month - 1]} {year}
                    </td>
                    <td className="px-3.5 py-2" />
                    <td className="px-3.5 py-2" />
                    <td className="px-3.5 py-2 text-right">{totals.patients}</td>
                    <td className="px-3.5 py-2" />
                    <td className="px-3.5 py-2" />
                    <td className="px-3.5 py-2 text-right text-[#79B4C4]">
                      {usd(totals.production)}
                    </td>
                    <td className="px-3.5 py-2" />
                    <td className="px-3.5 py-2 text-right">
                      {totals.nonote === 0 ? (
                        <span className="font-normal text-[#4A6165]">0</span>
                      ) : (
                        <span className="text-[#E4674F]">{totals.nonote}</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <p className="px-1 text-[11px] text-[#4A6165]">
          Days sched is the OpenDental roster — days this month the schedule has
          the provider down to work, past and still to come. Days worked is a
          day with completed work on their number, and Per day is production
          over days worked. Exams is completed exam procedures on the doctor&apos;s
          number, and Dx/exam is the dollars they treatment-planned this month
          over those exams — what an exam turns into, on average. Production
          follows the procedure&apos;s provider, so an exam a dentist did inside a
          hygiene visit lands on the dentist. The patients total counts each
          provider&apos;s patients once each — a patient two providers saw is in
          two rows.
        </p>
      </div>
    </main>
  );
}
