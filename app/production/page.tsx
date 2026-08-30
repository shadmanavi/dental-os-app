"use client";

// Production Dashboard — v1
// A month of production, a day to a row: what the book promised in
// dollars, how many patients it named, how many came, what was actually
// produced — and who left no note behind.
//
// Changelog:
//   v1  First build, shaped on the hygiene dashboard. Office switch,
//       month paging, the day table with a totals row in the header,
//       a per-provider month strip, and the day panel with a provider
//       filter. Reads od-production; writes nothing anywhere.
//
// Why the numbers are what they are, in short — the long version is in
// the Edge Function:
//
//   Actual is gross production: every procedure completed that day,
//   fee times units, on the provider who did it. No write-offs, no
//   adjustments — the figure OpenDental's own report leads with.
//
//   Scheduled is what the book promised: every fee attached to the
//   day's appointments. For a day gone, the appointments held at
//   midnight — the misses are re-dated on their way into the Cancelled
//   column, so the live row no longer remembers the day. For a day
//   ahead, the book as it stands now.
//
//   No note is the error column: a patient seen that day whose
//   completed procedures carry not one word of clinical note between
//   them. A note by any provider on the visit clears the patient.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Office = { id: string; slug: string; name: string };

type DayRow = {
  day: number;
  providers: number;
  sched: number;
  patients: number;
  showed: number;
  missed: number;
  actual: number;
  nonote: number;
};

type MonthTotals = {
  sched: number;
  patients: number;
  showed: number;
  missed: number;
  actual: number;
  nonote: number;
  providers: number;
  provider_days: number;
  days_open: number;
};

type ProvMonth = {
  prov_num: number;
  name: string;
  days: number;
  patients: number;
  production: number;
  nonote: number;
};

type Visit = {
  pat_num: number;
  time: string;
  patient: string;
  providers: string;
  sched: number;
  actual: number;
  noted: boolean;
  codes: string;
  state: "showed" | "booked" | "missed";
};

type ProvDay = {
  prov_num: number;
  name: string;
  patients: number;
  procs: number;
  production: number;
  nonote: number;
};

type DayDetail = {
  date: string;
  providers: ProvDay[];
  visits: Visit[];
  counts: {
    sched: number;
    actual: number;
    patients: number;
    showed: number;
    missed: number;
    nonote: number;
  };
};

// Which figure was clicked, so the panel opens on the right list.
type Focus = "booked" | "showed" | "missed" | "production" | "nonote";

const FOCUS_LABEL: Record<Focus, string> = {
  booked: "Booked — everyone the day involved",
  showed: "Showed — seen in the chair",
  missed: "Missed — held at midnight, never seen",
  production: "Production — what each visit was worth",
  nonote: "No note — seen, and nothing written",
};

function inFocus(focus: Focus): (v: Visit) => boolean {
  if (focus === "booked") return () => true;
  if (focus === "production") return (v) => v.state === "showed";
  if (focus === "nonote") return (v) => v.state === "showed" && !v.noted;
  return (v) => v.state === focus;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Local time, not UTC. toISOString() would roll the month over from
// mid-afternoon onwards in California.
function todayParts(): { year: number; month: number; day: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function weekdayOf(year: number, month: number, day: number): string {
  return WEEKDAYS[new Date(year, month - 1, day).getDay()];
}

// Whole dollars. The cents never change a decision this screen serves.
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fillClass(pct: number): string {
  if (pct >= 90) return "bg-[#79B4C4]";
  if (pct >= 60) return "bg-[#F0A93B]";
  return "bg-[#E4674F]";
}

export default function ProductionPage() {
  const router = useRouter();

  const now = todayParts();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);

  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSlug, setOfficeSlug] = useState("");

  const [days, setDays] = useState<DayRow[]>([]);
  const [totals, setTotals] = useState<MonthTotals | null>(null);
  const [providers, setProviders] = useState<ProvMonth[]>([]);
  const [daysInMonth, setDaysInMonth] = useState(31);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The day panel: which day and which figure was clicked, and what
  // came back. Read on demand, never with the month.
  const [panel, setPanel] = useState<{ day: number; focus: Focus } | null>(null);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");

  // A provider clicked in the panel narrows the list to their
  // patients. Clicked again, the narrowing comes off.
  const [provFilter, setProvFilter] = useState("");

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

  // ---- The month ----
  const load = useCallback(async () => {
    if (officeSlug === "") return;

    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { data, error: fnError } = await supabase.functions.invoke("od-production", {
        body: { office: officeSlug, action: "month", year, month },
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
        setDays([]);
        setTotals(null);
        setProviders([]);
        return;
      }

      if (!data?.ok) {
        setError(String(data?.error ?? "That month could not be read."));
        setDays([]);
        setTotals(null);
        setProviders([]);
        return;
      }

      setDays((data.days ?? []) as DayRow[]);
      setTotals((data.totals ?? null) as MonthTotals | null);
      setProviders((data.providers ?? []) as ProvMonth[]);
      setDaysInMonth(Number(data.days_in_month ?? 31));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That month could not be read.");
      setDays([]);
      setTotals(null);
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, [officeSlug, year, month]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- One day, named ----
  const openDay = useCallback(
    async (day: number, focus: Focus) => {
      setPanel({ day, focus });
      setDetail(null);
      setDetailError("");
      setProvFilter("");
      setDetailBusy(true);

      try {
        const supabase = createClient();
        const { data, error: fnError } = await supabase.functions.invoke("od-production", {
          body: { office: officeSlug, action: "day", year, month, day },
        });

        if (fnError || !data?.ok) {
          setDetailError(String(data?.error ?? "That day could not be read."));
          return;
        }

        setDetail(data as DayDetail);
      } catch (caught) {
        setDetailError(
          caught instanceof Error ? caught.message : "That day could not be read.",
        );
      } finally {
        setDetailBusy(false);
      }
    },
    [officeSlug, year, month],
  );

  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);

  const isThisMonth = year === now.year && month === now.month;
  const today = isThisMonth ? now.day : 0;

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

  const realized = totals && totals.sched > 0
    ? Math.round((totals.actual / totals.sched) * 100)
    : 0;
  const showRate = totals && totals.patients > 0
    ? Math.round((totals.showed / totals.patients) * 100)
    : 0;

  return (
    <main className="min-h-screen bg-[#0B1719] px-4 py-4 text-[#EDF3F1] sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        {/* One bar: name, office, month. */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[17px] font-bold tracking-[-0.01em]">Production</h1>
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

        {totals !== null && !loading && (
          <p className="px-1 text-[11px] text-[#4A6165]">
            Scheduled is what the book promised; Actual is gross production as
            completed. No note is a patient seen that day with no clinical note
            on any of it.
          </p>
        )}

        {error !== "" && (
          <p className="rounded-xl border border-[#E4674F] bg-[#2A1714] px-4 py-3 text-sm text-[#F3B0A2]">
            {error}
          </p>
        )}

        <div className="overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                  <th className="px-3.5 pt-2.5 text-left">Day</th>
                  <th className="px-3.5 pt-2.5 text-right">Scheduled</th>
                  <th className="px-3.5 pt-2.5 text-right">Patients</th>
                  <th className="px-3.5 pt-2.5 text-right">Showed</th>
                  <th className="px-3.5 pt-2.5 text-right">Actual</th>
                  <th className="w-32 px-3.5 pt-2.5 text-left">Realized</th>
                  <th className="px-3.5 pt-2.5 text-right">No note</th>
                </tr>

                {/* The month's figures, each under the column it totals. */}
                {totals !== null && !loading && (
                  <tr className="border-b border-[#2C4E54] font-mono text-[17px] tabular-nums">
                    <th className="whitespace-nowrap px-3.5 pb-2 pt-0.5 text-left align-top">
                      <span className="block font-sans text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                        {MONTHS[month - 1]} {year}
                      </span>
                      <span className="block font-sans text-[11px] font-normal text-[#4A6165]">
                        <span className="font-mono text-[#8AA6AB]">
                          {totals.providers}
                        </span>{" "}
                        providers over{" "}
                        <span className="font-mono text-[#8AA6AB]">
                          {totals.days_open}
                        </span>{" "}
                        open
                      </span>
                    </th>
                    <Total value={usd(totals.sched)} note="the promise" />
                    <Total value={String(totals.patients)} note="booked" />
                    <Total
                      value={String(totals.showed)}
                      pct={totals.patients > 0 ? `(${showRate}%)` : ""}
                      note={`${totals.missed} missed`}
                      tone="good"
                    />
                    <Total
                      value={usd(totals.actual)}
                      pct={totals.sched > 0 ? `(${realized}%)` : ""}
                      note="of the promise"
                      tone="good"
                    />
                    <th className="px-3.5 pb-2 pt-0.5 text-left align-top font-sans text-[11px] font-normal text-[#4A6165]">
                      {totals.sched > totals.actual
                        ? `${usd(totals.sched - totals.actual)} short of the book`
                        : "ahead of the book"}
                    </th>
                    <Total
                      value={String(totals.nonote)}
                      note="undocumented"
                      tone={totals.nonote > 0 ? "warn" : undefined}
                    />
                  </tr>
                )}
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-3.5 py-8 text-center text-sm text-[#8AA6AB]">
                      Reading the month…
                    </td>
                  </tr>
                )}

                {!loading && Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const row = byDay.get(d);
                  const isToday = d === today;
                  const past = today > 0 ? d < today : year < now.year || (year === now.year && month < now.month);
                  const weekday = weekdayOf(year, month, d);

                  // Nothing booked, nothing done: shut.
                  if (!row) {
                    return (
                      <tr key={d} className="text-[#4A6165]">
                        <td className="flex items-baseline gap-2 border-b border-[#2C4E54]/45 px-3.5 py-2">
                          <span className="inline-block min-w-[22px] font-mono text-[15px]">{d}</span>
                          <span className="text-xs">{weekday}</span>
                        </td>
                        <td colSpan={6} className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-left font-mono text-sm">
                          —
                        </td>
                      </tr>
                    );
                  }

                  const been = past || isToday;
                  const ahead = !been;
                  const pct = row.sched > 0 ? Math.round((row.actual / row.sched) * 100) : 0;

                  return (
                    <tr
                      key={d}
                      className={`font-mono text-sm tabular-nums ${
                        isToday ? "bg-[#F0A93B]/[0.07]" : ""
                      } ${ahead ? "text-[#8AA6AB]" : ""}`}
                    >
                      <td
                        className={`flex items-baseline gap-2 border-b border-[#2C4E54]/45 px-3.5 py-2 font-sans ${
                          isToday ? "shadow-[inset_3px_0_0_#F0A93B]" : ""
                        }`}
                      >
                        <span
                          className={`inline-block min-w-[22px] font-mono text-[15px] ${
                            isToday ? "font-bold text-[#F0A93B]" : ""
                          }`}
                        >
                          {d}
                        </span>
                        <span className="text-xs text-[#8AA6AB]">{weekday}</span>
                        {row.providers > 0 ? (
                          <button
                            type="button"
                            onClick={() => openDay(d, "production")}
                            className="text-xs text-[#79B4C4] underline decoration-dotted underline-offset-2 hover:text-[#EDF3F1]"
                          >
                            {row.providers} prov
                          </button>
                        ) : (
                          <span className="text-xs text-[#4A6165]">no prov</span>
                        )}
                      </td>

                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {row.sched > 0 ? (
                          <Figure value={usd(row.sched)} onClick={() => openDay(d, "booked")} />
                        ) : (
                          <span className="text-[#4A6165]">—</span>
                        )}
                      </td>

                      <td className={`border-b border-[#2C4E54]/45 px-3.5 py-2 text-right ${
                        ahead ? "text-[#EDF3F1]" : ""
                      }`}>
                        {row.patients > 0 ? (
                          <Figure value={String(row.patients)} onClick={() => openDay(d, "booked")} />
                        ) : (
                          <span className="text-[#4A6165]">0</span>
                        )}
                      </td>

                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {been ? (
                          <>
                            <Figure
                              value={String(row.showed)}
                              onClick={() => openDay(d, "showed")}
                              tone="text-[#79B4C4]"
                            />
                            {/* How many of the booked actually showed.
                                Fixed width so the digits line up. */}
                            <span className="ml-1 inline-block w-12 text-left text-[10px] text-[#4A6165]">
                              {row.patients > 0
                                ? `(${Math.round((row.showed / row.patients) * 100)}%)`
                                : ""}
                            </span>
                          </>
                        ) : (
                          <span className="text-[#4A6165]">—</span>
                        )}
                      </td>

                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {!been ? (
                          <span className="text-[#4A6165]">—</span>
                        ) : row.actual === 0 ? (
                          <span className="text-[#4A6165]">$0</span>
                        ) : (
                          <Figure
                            value={usd(row.actual)}
                            onClick={() => openDay(d, "production")}
                          />
                        )}
                      </td>

                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2">
                        {been && row.sched > 0 ? (
                          <>
                            <div className="h-1.5 overflow-hidden rounded-full bg-[#2C4E54]/55">
                              <div
                                className={`h-full rounded-full ${fillClass(pct)}`}
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="mt-0.5 block text-[10px] text-[#4A6165]">{pct}%</span>
                          </>
                        ) : (
                          <span className="text-[10px] text-[#4A6165]">—</span>
                        )}
                      </td>

                      {/* Seen, and nothing written. The error column. */}
                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {!been ? (
                          <span className="text-[#4A6165]">—</span>
                        ) : row.nonote === 0 ? (
                          <span className="text-[#4A6165]">0</span>
                        ) : (
                          <Figure
                            value={String(row.nonote)}
                            onClick={() => openDay(d, "nonote")}
                            tone="font-bold text-[#E4674F]"
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* The month by provider: who produced what, over how many
            days, and how many of their patients have no note. */}
        {!loading && providers.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse">
                <thead>
                  <tr className="border-b border-[#2C4E54] text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                    <th className="px-3.5 py-2 text-left">Provider</th>
                    <th className="px-3.5 py-2 text-right">Days</th>
                    <th className="px-3.5 py-2 text-right">Patients</th>
                    <th className="px-3.5 py-2 text-right">Production</th>
                    <th className="px-3.5 py-2 text-right">No note</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => (
                    <tr key={p.prov_num} className="font-mono text-sm tabular-nums">
                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 font-sans text-[#EDF3F1]">
                        {p.name}
                      </td>
                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right text-[#8AA6AB]">
                        {p.days}
                      </td>
                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {p.patients}
                      </td>
                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right text-[#79B4C4]">
                        {usd(p.production)}
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
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* The day behind a number: who produced what, who was booked,
            who came, and whose chart is blank. Read from OpenDental
            when opened; nothing is stored. */}
        {panel !== null && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8">
            <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
              <div className="flex flex-wrap items-baseline gap-3 border-b border-[#2C4E54] px-5 py-3">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.06em]">
                  {MONTHS[month - 1]} {panel.day}
                </h3>
                <span className="text-xs text-[#8AA6AB]">
                  {weekdayOf(year, month, panel.day)}
                </span>

                {/* What this list actually is, so the reader never has
                    to remember which figure they clicked. */}
                <span className="rounded bg-[#16292D] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#79B4C4]">
                  {FOCUS_LABEL[panel.focus]}
                </span>

                {/* The day's own figures, so it is plain what this list
                    was counted against. */}
                {detail !== null && (
                  <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11px] tabular-nums text-[#8AA6AB]">
                    <span>{usd(detail.counts.sched)} booked</span>
                    <span className="text-[#79B4C4]">{usd(detail.counts.actual)} done</span>
                    <span>{detail.counts.showed} showed</span>
                    <span className="text-[#F3B0A2]">{detail.counts.missed} missed</span>
                    <span className="text-[#E4674F]">{detail.counts.nonote} no note</span>
                  </span>
                )}

                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setPanel(null)}
                  className="rounded-lg border border-[#2C4E54] px-3 py-1 text-xs text-[#8AA6AB] hover:bg-[#193034]"
                >
                  Close
                </button>
              </div>

              {detailBusy && (
                <p className="px-5 py-8 text-center text-sm text-[#8AA6AB]">Reading the day…</p>
              )}

              {detailError !== "" && (
                <p className="m-5 rounded-lg border border-[#E4674F] bg-[#2A1714] px-3 py-2 text-sm text-[#F3B0A2]">
                  {detailError}
                </p>
              )}

              {detail !== null && !detailBusy && (
                <>
                  <div className="border-b border-[#2C4E54] px-5 py-3">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                      Providers — click one to narrow the list
                    </h4>
                    {detail.providers.length === 0 ? (
                      <p className="mt-1 text-sm text-[#4A6165]">
                        Nothing completed yet. The list below is the book.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {detail.providers.map((p) => (
                          <li key={p.prov_num}>
                            <button
                              type="button"
                              onClick={() =>
                                setProvFilter((f) => (f === p.name ? "" : p.name))
                              }
                              className={`w-full rounded px-1 text-left text-sm hover:bg-[#16292D] ${
                                provFilter === p.name ? "bg-[#16292D]" : ""
                              }`}
                            >
                              <span className={provFilter === p.name ? "text-[#79B4C4]" : "text-[#EDF3F1]"}>
                                {p.name}
                              </span>{" "}
                              <span className="font-mono text-xs text-[#8AA6AB]">
                                {p.patients} pts · {p.procs} procs
                              </span>{" "}
                              <span className="font-mono text-xs text-[#79B4C4]">
                                {usd(p.production)}
                              </span>
                              {p.nonote > 0 && (
                                <span className="ml-2 font-mono text-xs font-bold text-[#E4674F]">
                                  {p.nonote} no note
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <ul className="max-h-[26rem] divide-y divide-[#2C4E54]/50 overflow-y-auto">
                    {(() => {
                      let rows = detail.visits.filter(inFocus(panel.focus));
                      if (provFilter !== "") {
                        rows = rows.filter((v) => v.providers.split(" + ").includes(provFilter));
                      }
                      if (panel.focus === "production") {
                        rows = [...rows].sort((a, b) => b.actual - a.actual);
                      }

                      if (rows.length === 0) {
                        return (
                          <li className="px-5 py-4 text-center text-sm text-[#4A6165]">
                            Nobody in this group.
                          </li>
                        );
                      }

                      return rows.map((v) => (
                        <li key={v.pat_num} className="flex gap-3 px-5 py-2 text-sm">
                          <span className="w-12 shrink-0 font-mono text-xs text-[#8AA6AB]">
                            {v.time.slice(0, 5)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[#EDF3F1]">
                              {v.patient}
                              {v.state === "showed" && !v.noted && (
                                <span className="ml-2 rounded bg-[#2A1714] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#E4674F]">
                                  no note
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-[#8AA6AB]">
                              {v.providers !== "" ? v.providers : "—"}
                              {v.codes !== "" ? ` · ${v.codes}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 self-start text-right">
                            <span className="block font-mono text-sm tabular-nums text-[#79B4C4]">
                              {v.state === "showed" ? usd(v.actual) : usd(v.sched)}
                            </span>
                            <span className="block font-mono text-[10px] tabular-nums text-[#4A6165]">
                              {v.state === "showed"
                                ? v.sched > 0
                                  ? `of ${usd(v.sched)} booked`
                                  : "walk-in"
                                : v.state}
                            </span>
                          </span>
                        </li>
                      ));
                    })()}
                  </ul>

                  <p className="border-t border-[#2C4E54] px-5 py-2.5 text-[11px] text-[#4A6165]">
                    {panel.focus === "nonote"
                      ? "Seen that day, and no completed procedure of theirs carries a note. A note by any provider on the visit clears the patient. "
                      : panel.focus === "missed"
                        ? "Held at midnight and completed nothing. "
                        : panel.focus === "production"
                          ? "Gross production per patient — fee times units, no write-offs. "
                          : ""}
                    Read from OpenDental now; nothing is stored here.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        <p className="px-1 text-[11px] text-[#4A6165]">
          Scheduled sums every fee attached to the day&apos;s appointments — the
          midnight book for a day gone, the live book for a day ahead — because
          the misses are re-dated on their way into the Cancelled column. Actual
          is gross production on the day it was completed, on the provider who
          did it. Missed is booked less seen, never counted on its own.
        </p>
      </div>
    </main>
  );
}

// A number in the table that opens the day behind it.
function Figure({
  value,
  onClick,
  tone,
}: {
  value: string;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono tabular-nums underline decoration-dotted underline-offset-4 decoration-[#4A6165] hover:decoration-[#EDF3F1] ${tone ?? ""}`}
    >
      {value}
    </button>
  );
}

// One month figure, sitting in the header above the column it totals.
function Total({
  value,
  note,
  tone,
  pct,
}: {
  value: string;
  note: string;
  tone?: "good" | "warn";
  pct?: string;
}) {
  const colour =
    tone === "good" ? "text-[#79B4C4]" : tone === "warn" ? "text-[#E4674F]" : "text-[#EDF3F1]";

  return (
    <th className="whitespace-nowrap px-3.5 pb-2 pt-0.5 text-right align-top">
      <span className={`block font-mono text-[17px] font-bold tabular-nums ${colour}`}>
        {value}
        {/* The same fixed-width slot the day rows use for their
            percentage, so the total's digits land in the same column. */}
        {pct !== undefined && (
          <span className="ml-1 inline-block w-12 text-left text-[10px] font-normal text-[#4A6165]">
            {pct}
          </span>
        )}
      </span>
      <span className="block font-sans text-[11px] font-normal text-[#4A6165]">{note}</span>
    </th>
  );
}
