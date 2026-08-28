"use client";

// Hygiene Dashboard — v2
// A month of hygiene, a day to a row: slots offered, booked, still open,
// and once the day has been, who showed and who did not.
//
// Changelog:
//   v2  Month totals moved into the table header so each sits above the
//       column it totals. Hygienist-days under the Day column. A month
//       still ahead no longer strikes its capacity through.
//
//   v1  First build. Office switch, month paging, and the day table.
//       Reads od-hygiene; writes nothing anywhere.
//
// Why the numbers are what they are, in short — the long version is in
// the Edge Function:
//
//   Slots come from the roster, because it names the columns each
//   hygienist sits in. Going by the hygiene tick on the operatory would
//   have missed HG-PN, who works out of two production columns.
//
//   Showed is Complete. Missed is booked less showed, never counted on
//   its own, because a missed appointment is re-dated on its way into
//   the Cancelled column. Booked for a day gone is what stood in those
//   columns at midnight; for a day ahead, what stands there now.
//
//   A past day's open slots are struck through. That hour is gone; it
//   cannot be sold twice.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Office = { id: string; slug: string; name: string };

type DayRow = {
  day: number;
  hygienists: number;
  columns: number;
  slots: number;
  booked: number;
  showed: number;
  missed: number;
  open: number;
};

type MonthTotals = {
  hygienists?: number;
  rdh_days?: number;
  slots: number;
  booked: number;
  showed: number;
  missed: number;
  open: number;
  days_open: number;
};

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

function fillClass(pct: number): string {
  if (pct >= 85) return "bg-[#79B4C4]";
  if (pct >= 60) return "bg-[#F0A93B]";
  return "bg-[#E4674F]";
}

export default function HygienePage() {
  const router = useRouter();

  const now = todayParts();
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);

  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSlug, setOfficeSlug] = useState("");

  const [days, setDays] = useState<DayRow[]>([]);
  const [totals, setTotals] = useState<MonthTotals | null>(null);
  const [daysInMonth, setDaysInMonth] = useState(31);
  const [note, setNote] = useState("");

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

  // ---- The month ----
  const load = useCallback(async () => {
    if (officeSlug === "") return;

    setLoading(true);
    setError("");
    setNote("");

    try {
      const supabase = createClient();
      const { data, error: fnError } = await supabase.functions.invoke("od-hygiene", {
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
        return;
      }

      if (!data?.ok) {
        setError(String(data?.error ?? "That month could not be read."));
        setDays([]);
        setTotals(null);
        return;
      }

      setDays((data.days ?? []) as DayRow[]);
      setTotals((data.totals ?? null) as MonthTotals | null);
      setDaysInMonth(Number(data.days_in_month ?? 31));
      setNote(String(data.note ?? ""));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That month could not be read.");
      setDays([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [officeSlug, year, month]);

  useEffect(() => {
    load();
  }, [load]);

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

  const fillRate = totals && totals.slots > 0
    ? Math.round((totals.booked / totals.slots) * 100)
    : 0;
  const seen = totals ? totals.showed + totals.missed : 0;
  const missRate = seen > 0 ? Math.round(((totals?.missed ?? 0) / seen) * 100) : 0;

  // Slots on a day already gone that nobody ever booked.
  //
  // Which days count depends on where the month sits. A month behind us
  // is all spent; a month ahead of us has spent nothing yet, and showing
  // its whole capacity struck through read as though September had
  // already been lost.
  const monthPosition: "past" | "current" | "future" =
    year < now.year || (year === now.year && month < now.month)
      ? "past"
      : isThisMonth
        ? "current"
        : "future";

  const unsold = useMemo(() => {
    if (monthPosition === "future") return 0;
    return days
      .filter((d) => monthPosition === "past" || d.day <= today)
      .reduce((sum, d) => sum + d.open, 0);
  }, [days, monthPosition, today]);

  const stillOpen = Math.max(0, (totals?.open ?? 0) - unsold);

  return (
    <main className="min-h-screen bg-[#0B1719] px-4 py-4 text-[#EDF3F1] sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        {/* One bar: name, office, month. */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[17px] font-bold tracking-[-0.01em]">Hygiene</h1>
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

        {note !== "" && (
          <p className="rounded-xl border border-[#2C4E54] bg-[#122326] px-4 py-3 text-sm text-[#8AA6AB]">
            {note}
          </p>
        )}

        <div className="overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                  <th className="px-3.5 pt-2.5 text-left">Day</th>
                  <th className="px-3.5 pt-2.5 text-right">Slots</th>
                  <th className="px-3.5 pt-2.5 text-right">Booked</th>
                  <th className="px-3.5 pt-2.5 text-right">Open</th>
                  <th className="w-32 px-3.5 pt-2.5 text-left">Filled</th>
                  <th className="px-3.5 pt-2.5 text-right">Showed</th>
                  <th className="px-3.5 pt-2.5 text-right">Missed</th>
                </tr>

                {/* The month's figures, each under the column it totals. */}
                {totals !== null && !loading && (
                  <tr className="border-b border-[#2C4E54] font-mono text-[17px] tabular-nums">
                    {/* Under the Day column, where every row says how
                        many hygienists worked: the month's total. */}
                    <th className="whitespace-nowrap px-3.5 pb-2 pt-0.5 text-left align-top">
                      <span className="block font-sans text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                        {MONTHS[month - 1]} {year}
                      </span>
                      <span className="block font-sans text-[11px] font-normal text-[#4A6165]">
                        <span className="font-mono text-[#8AA6AB]">
                          {totals.rdh_days ?? 0}
                        </span>{" "}
                        RDH days over{" "}
                        <span className="font-mono text-[#8AA6AB]">
                          {totals.days_open}
                        </span>{" "}
                        open
                      </span>
                    </th>
                    <Total value={totals.slots} note="slot hours" />
                    <Total value={totals.booked} note={`${fillRate}% filled`} />
                    <Total value={unsold} note="gone for good" struck={unsold > 0} />
                    <th className="px-3.5 pb-2 pt-0.5 text-left align-top font-sans text-[11px] font-normal text-[#4A6165]">
                      {stillOpen > 0 ? `${stillOpen} still bookable` : "nothing left open"}
                    </th>
                    <Total value={totals.showed} note={`of ${seen} seen`} tone="good" />
                    <Total value={totals.missed} note={`${missRate}% of them`} tone="warn" />
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
                  const past = today > 0 && d < today;
                  const weekday = weekdayOf(year, month, d);

                  // No hygienist rostered means shut for hygiene.
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

                  const pct = row.slots > 0 ? Math.round((row.booked / row.slots) * 100) : 0;
                  const ahead = !past && !isToday;

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
                        <span className="text-xs text-[#8AA6AB]">
                          {row.hygienists} RDH
                        </span>
                      </td>

                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {row.slots}
                      </td>
                      <td className={`border-b border-[#2C4E54]/45 px-3.5 py-2 text-right ${
                        ahead ? "text-[#EDF3F1]" : ""
                      }`}>
                        {row.booked}
                      </td>
                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {row.open === 0 ? (
                          <span className="text-[#4A6165]">—</span>
                        ) : past ? (
                          <s className="text-[#4A6165] decoration-[#E4674F] decoration-[1.5px]">
                            {row.open}
                          </s>
                        ) : (
                          row.open
                        )}
                      </td>

                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#2C4E54]/55">
                          <div
                            className={`h-full rounded-full ${fillClass(pct)}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="mt-0.5 block text-[10px] text-[#4A6165]">{pct}%</span>
                      </td>

                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {past || isToday ? (
                          <span className="text-[#79B4C4]">{row.showed}</span>
                        ) : (
                          <span className="text-[#4A6165]">—</span>
                        )}
                      </td>
                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {!past && !isToday ? (
                          <span className="text-[#4A6165]">—</span>
                        ) : row.missed === 0 ? (
                          <span className="text-[#4A6165]">0</span>
                        ) : (
                          <b className="font-bold text-[#F3B0A2]">{row.missed}</b>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {totals !== null && !loading && (
                <tfoot>
                  <tr className="bg-[#16292D] font-mono text-sm font-bold tabular-nums">
                    <td className="border-t border-[#2C4E54] px-3.5 py-2.5 text-left font-sans text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                      {MONTHS[month - 1]} total
                    </td>
                    <td className="border-t border-[#2C4E54] px-3.5 py-2.5 text-right">{totals.slots}</td>
                    <td className="border-t border-[#2C4E54] px-3.5 py-2.5 text-right">{totals.booked}</td>
                    <td className="border-t border-[#2C4E54] px-3.5 py-2.5 text-right">
                      <s className="text-[#4A6165] decoration-[#E4674F] decoration-[1.5px]">{unsold}</s>
                      {stillOpen > 0 ? ` + ${stillOpen}` : ""}
                    </td>
                    <td className="border-t border-[#2C4E54] px-3.5 py-2.5 text-left font-normal text-[#8AA6AB]">
                      {fillRate}% filled
                    </td>
                    <td className="border-t border-[#2C4E54] px-3.5 py-2.5 text-right">{totals.showed}</td>
                    <td className="border-t border-[#2C4E54] px-3.5 py-2.5 text-right">{totals.missed}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <p className="px-1 text-[11px] text-[#4A6165]">
          Slots come from the hygienists rostered that day and the columns they
          sit in. For a day that has been, booked is what stood in those columns
          at midnight; for a day ahead it is what stands there now. Missed is
          booked less showed, never counted on its own.
        </p>
      </div>
    </main>
  );
}

// One month figure, sitting in the header above the column it totals.
function Total({
  value,
  note,
  tone,
  struck,
}: {
  value: number;
  note: string;
  tone?: "good" | "warn";
  struck?: boolean;
}) {
  const colour =
    tone === "good" ? "text-[#79B4C4]" : tone === "warn" ? "text-[#E4674F]" : "text-[#EDF3F1]";

  return (
    <th className="whitespace-nowrap px-3.5 pb-2 pt-0.5 text-right align-top">
      <span className={`block font-mono text-[17px] font-bold tabular-nums ${colour}`}>
        {struck ? (
          <s className="text-[#4A6165] decoration-[#E4674F] decoration-[1.5px]">{value}</s>
        ) : (
          value
        )}
      </span>
      <span className="block font-sans text-[11px] font-normal text-[#4A6165]">{note}</span>
    </th>
  );
}
