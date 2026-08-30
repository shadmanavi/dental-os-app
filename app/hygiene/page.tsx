"use client";

// Hygiene Dashboard — v15
// A month of hygiene, a day to a row: slots offered, booked, still open,
// and once the day has been, who showed and who did not.
//
// Changelog:
//   v15 The totals row loses its notes line, gains the month fill bar
//       in the Filled column, and Missed carries its rate inline -
//       (61%) beside 240 - with the day rows matching. Column titles
//       end exactly above their digits.
//
//   v14 One totals row, at the top, in line with its columns. The
//       bottom duplicate is gone, and the top row carries the same
//       fixed-width percentage slots as the day rows so the digits
//       stack in a straight column.
//
//   v13 The month totals are clicks. Each opens the whole month listed
//       by patient - one line each, times counted and on which days -
//       so a person who missed 3 times reads once as x3, the times add
//       to the column total, and the repeats sort to the top.
//
//   v12 The slot count is a click. It opens the roster with the
//       arithmetic spelled out per shift - hours times columns - and
//       the total they add to, and the percentages sit in a fixed-width
//       slot so the digits stay in a straight column on 0-slot days.
//
//   v11 Booked carries its fill of the slots in parentheses, and Showed
//       its share of booked, on every day and on the month total.
//
//   v10 The panel title bar names the list it is showing - Showed,
//       Missed, Booked, NH/NE, SRP - beside the day and its figures.
//
//   v9  The NH/NE panel lists its 2 groups one under the other: no
//       exam - cleaning done, exam unbilled - then no cleaning. Counts
//       come from the same verdict the month row uses.
//
//   v8  Showed is a patient who had a cleaning and an exam. NH/NE is
//       one who came and got one without the other, or neither - a
//       charge nobody billed - and SRP has its own column. Everything
//       counts people, so a patient with 2 appointments in a day is one
//       patient.
//
//   v7  The day panel's title bar carries that day's figures - slots,
//       booked, showed, missed, no hyg - so it is plain what the list
//       below was counted against.
//
//   v6  The error-checking figures moved into their own column, "No
//       hyg". They were sitting inside the Showed cell, which crowded
//       it and pushed the digits out of line. One number a day, one
//       click, and the panel says which kind each one was.
//
//   v5  Showed counts a hygiene visit. Each day row also carries the
//       completed appointments that were not one - SRP, exams and
//       x-rays only, and nothing posted at all - each a link to the
//       patients behind it, so a missing posting can be found.
//
//   v4  Booked lists the whole day - what happened, what did not, and
//       what is still to come - each tagged. It was filtered to the
//       appointments still marked scheduled, which is nothing at all on
//       a day gone, so Monday the 3rd read "nothing to show" under 8.
//
//   v3  The numbers open the day behind them. Booked, showed, missed
//       and the RDH count are links; the panel lists the patients, the
//       column and what was done, read from OpenDental when opened and
//       stored nowhere. Missed names the patients who did not come.
//
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
  srp: number;
  nhne: number;
};

type MonthTotals = {
  hygienists?: number;
  rdh_days?: number;
  slots: number;
  booked: number;
  showed: number;
  missed: number;
  open: number;
  srp?: number;
  nhne?: number;
  days_open: number;
};

type Visit = {
  apt_num: number;
  time: string;
  column: string;
  patient: string;
  hygienist: string;
  codes: string;
  state: "showed" | "booked" | "missed";
  kind: string;
};

type DayDetail = {
  date: string;
  hygienists: { name: string; from: string; to: string; columns: string }[];
  appointments: Visit[];
};

// A clicked month total, and one patient's line in it.
type MonthFocus = "showed" | "srp" | "nhne" | "missed" | "booked";

const MONTH_FOCUS_LABEL: Record<MonthFocus, string> = {
  showed: "Showed — cleaning and exam done",
  srp: "SRP — scaling and root planing",
  nhne: "NH/NE — short a cleaning or an exam",
  missed: "Missed — held at midnight, never seen",
  booked: "Booked — everyone the month involved",
};

type MonthListEntry = {
  pat_num: number;
  name: string;
  times: number;
  days: string;
};

// Which figure was clicked, so the panel opens on the right list.
type Focus =
  | "showed"
  | "booked"
  | "missed"
  | "rdh"
  | "notHygiene"
  | "srp";

// Booked means everything the day held — the ones that happened, the
// ones that did not, and on a day still ahead the ones yet to come.
// Filtering it to appointments still marked scheduled showed an empty
// list on every past day.
function inFocus(focus: Focus): (v: Visit) => boolean {
  if (focus === "booked") return () => true;
  // Everything that completed without hygiene on it, in one list.
  // NH/NE: came, and the visit was short of a cleaning, an exam, or
  // both. SRP is its own column and is not in here.
  if (focus === "notHygiene") {
    return (v) =>
      v.kind === "no exam" || v.kind === "no cleaning" || v.kind === "nothing";
  }
  if (focus === "srp") return (v) => v.kind === "srp";
  // Showed means a hygiene visit, so the ones that completed with no
  // hygiene posted are not in it - they are in the 3 above.
  if (focus === "showed") return (v) => v.kind === "hygiene";
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

// "07:00:00" to "11:00:00" is 4 hours. Used only to show the reader
// how a day's slot count was built; the count itself comes from the
// server the same way.
function shiftHours(from: string, to: string): number {
  const minutes = (t: string) => {
    const m = t.match(/^(\d{2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  return Math.max(0, (minutes(to) - minutes(from)) / 60);
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

  // The day panel: which day and which figure was clicked, and what
  // came back. Read on demand, never with the month.
  const [panel, setPanel] = useState<{ day: number; focus: Focus } | null>(null);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");

  // The month panel: a clicked total, listed by patient with how many
  // times each is counted. The times add to the total; the same person
  // can miss twice, and the list says so rather than hiding it.
  const [monthPanel, setMonthPanel] = useState<MonthFocus | null>(null);
  const [monthList, setMonthList] = useState<MonthListEntry[] | null>(null);
  const [monthBusy, setMonthBusy] = useState(false);
  const [monthError, setMonthError] = useState("");

  const openMonth = useCallback(
    async (mf: MonthFocus) => {
      setMonthPanel(mf);
      setMonthList(null);
      setMonthError("");
      setMonthBusy(true);

      try {
        const supabase = createClient();
        const { data, error: fnError } = await supabase.functions.invoke("od-hygiene", {
          body: { office: officeSlug, action: "month_list", year, month, focus: mf },
        });

        if (fnError || !data?.ok) {
          setMonthError(String(data?.error ?? "That total could not be read."));
          return;
        }

        setMonthList((data.patients ?? []) as MonthListEntry[]);
      } catch (caught) {
        setMonthError(
          caught instanceof Error ? caught.message : "That total could not be read.",
        );
      } finally {
        setMonthBusy(false);
      }
    },
    [officeSlug, year, month],
  );

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

  // ---- One day, named ----
  const openDay = useCallback(
    async (day: number, focus: Focus) => {
      setPanel({ day, focus });
      setDetail(null);
      setDetailError("");
      setDetailBusy(true);

      try {
        const supabase = createClient();
        const { data, error: fnError } = await supabase.functions.invoke("od-hygiene", {
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

        {totals !== null && !loading && (
          <p className="px-1 text-[11px] text-[#4A6165]">
            Showed is a patient who had a cleaning and an exam. NH/NE is a
            patient who came and got one without the other, or neither — a
            charge nobody billed.
          </p>
        )}

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
                {/* The spacer after Booked, Showed and Missed matches
                    the fixed-width percentage slot in their cells, so
                    the title ends exactly above the digits. */}
                <tr className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
                  <th className="px-3.5 pt-2.5 text-left">Day</th>
                  <th className="px-3.5 pt-2.5 text-right">Slots</th>
                  <th className="px-3.5 pt-2.5 text-right">
                    Booked<span className="ml-1 inline-block w-12" />
                  </th>
                  <th className="px-3.5 pt-2.5 text-right">Open</th>
                  <th className="w-32 px-3.5 pt-2.5 text-left">Filled</th>
                  <th className="px-3.5 pt-2.5 text-right">
                    Showed<span className="ml-1 inline-block w-12" />
                  </th>
                  <th className="px-3.5 pt-2.5 text-right">
                    Missed<span className="ml-1 inline-block w-12" />
                  </th>
                  <th className="px-3.5 pt-2.5 text-right">NH/NE</th>
                  <th className="px-3.5 pt-2.5 text-right">SRP</th>
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
                        <span className="font-mono text-[#8AA6AB]">{totals.rdh_days ?? 0}</span>{" "}
                        RDH days ·{" "}
                        <span className="font-mono text-[#8AA6AB]">{totals.days_open}</span>{" "}
                        open
                      </span>
                    </th>
                    <Total value={totals.slots} />
                    <Total
                      value={totals.booked}
                      pct={totals.slots > 0 ? `(${fillRate}%)` : ""}
                      onClick={() => openMonth("booked")}
                    />
                    <Total value={unsold} struck={unsold > 0} />
                    {/* The month's own fill bar, same as the day rows. */}
                    <th className="px-3.5 pb-2 pt-1.5 text-left align-top font-normal">
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#2C4E54]/55">
                        <div
                          className={`h-full rounded-full ${fillClass(fillRate)}`}
                          style={{ width: `${Math.min(100, fillRate)}%` }}
                        />
                      </div>
                      <span className="mt-0.5 block font-sans text-[10px] text-[#4A6165]">
                        {fillRate}% filled
                      </span>
                    </th>
                    <Total
                      value={totals.showed}
                      pct={
                        totals.booked > 0
                          ? `(${Math.round((totals.showed / totals.booked) * 100)}%)`
                          : ""
                      }
                      tone="good"
                      onClick={() => openMonth("showed")}
                    />
                    <Total
                      value={totals.missed}
                      pct={`(${missRate}%)`}
                      tone="warn"
                      onClick={() => openMonth("missed")}
                    />
                    <Total value={totals.nhne ?? 0} tone="warn" onClick={() => openMonth("nhne")} />
                    <Total value={totals.srp ?? 0} onClick={() => openMonth("srp")} />
                  </tr>
                )}
              </thead>

              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={9} className="px-3.5 py-8 text-center text-sm text-[#8AA6AB]">
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
                        <td colSpan={8} className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-left font-mono text-sm">
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
                        {row.hygienists > 0 ? (
                          <button
                            type="button"
                            onClick={() => openDay(d, "rdh")}
                            className="text-xs text-[#79B4C4] underline decoration-dotted underline-offset-2 hover:text-[#EDF3F1]"
                          >
                            {row.hygienists} RDH
                          </button>
                        ) : (
                          <span className="text-xs text-[#4A6165]">no RDH</span>
                        )}
                      </td>

                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {row.slots > 0 ? (
                          <Figure value={row.slots} onClick={() => openDay(d, "rdh")} />
                        ) : (
                          <span className="text-[#4A6165]">0</span>
                        )}
                      </td>
                      <td className={`border-b border-[#2C4E54]/45 px-3.5 py-2 text-right ${
                        ahead ? "text-[#EDF3F1]" : ""
                      }`}>
                        <Figure value={row.booked} onClick={() => openDay(d, "booked")} />
                        {/* How full the day was booked against its
                            slots. The span keeps its width even when
                            empty, so the digits above and below stay
                            in a straight column on 0-slot days. */}
                        <span className="ml-1 inline-block w-12 text-left text-[10px] text-[#4A6165]">
                          {row.slots > 0
                            ? `(${Math.round((row.booked / row.slots) * 100)}%)`
                            : ""}
                        </span>
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
                          <>
                            <Figure
                              value={row.showed}
                              onClick={() => openDay(d, "showed")}
                              tone="text-[#79B4C4]"
                            />
                            {/* How many of the booked actually showed.
                                Fixed width for the same reason as the
                                Booked percentage: the digits line up. */}
                            <span className="ml-1 inline-block w-12 text-left text-[10px] text-[#4A6165]">
                              {row.booked > 0
                                ? `(${Math.round((row.showed / row.booked) * 100)}%)`
                                : ""}
                            </span>
                          </>
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
                          <>
                            <Figure
                              value={row.missed}
                              onClick={() => openDay(d, "missed")}
                              tone="font-bold text-[#F3B0A2]"
                            />
                            {/* The day's own miss rate, same formula as
                                the month total: missed of those seen. */}
                            <span className="ml-1 inline-block w-12 text-left text-[10px] font-normal text-[#4A6165]">
                              {row.showed + row.missed > 0
                                ? `(${Math.round((row.missed / (row.showed + row.missed)) * 100)}%)`
                                : ""}
                            </span>
                          </>
                        )}
                      </td>

                      {/* Came, and had no hygiene put on the account.
                          Its own column so the digits still line up. */}
                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {!past && !isToday ? (
                          <span className="text-[#4A6165]">—</span>
                        ) : row.nhne === 0 ? (
                          <span className="text-[#4A6165]">0</span>
                        ) : (
                          <Figure
                            value={row.nhne}
                            onClick={() => openDay(d, "notHygiene")}
                            tone="font-bold text-[#E4674F]"
                          />
                        )}
                      </td>

                      {/* Scaling and root planing, kept apart. */}
                      <td className="border-b border-[#2C4E54]/45 px-3.5 py-2 text-right">
                        {!past && !isToday ? (
                          <span className="text-[#4A6165]">—</span>
                        ) : row.srp === 0 ? (
                          <span className="text-[#4A6165]">0</span>
                        ) : (
                          <Figure value={row.srp} onClick={() => openDay(d, "srp")} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

            </table>
          </div>
        </div>

        {/* A month total behind a number: each patient once, with how
            many times they are counted. The times add to the total. */}
        {monthPanel !== null && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8">
            <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
              <div className="flex flex-wrap items-baseline gap-3 border-b border-[#2C4E54] px-5 py-3">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.06em]">
                  {MONTHS[month - 1]} {year} total
                </h3>
                <span className="rounded bg-[#16292D] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#79B4C4]">
                  {MONTH_FOCUS_LABEL[monthPanel]}
                </span>
                {monthList !== null && (
                  <span className="font-mono text-[11px] tabular-nums text-[#8AA6AB]">
                    {monthList.reduce((s, p) => s + p.times, 0)} counted ·{" "}
                    {monthList.length} patients
                  </span>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setMonthPanel(null)}
                  className="rounded-lg border border-[#2C4E54] px-3 py-1 text-xs text-[#8AA6AB] hover:bg-[#193034]"
                >
                  Close
                </button>
              </div>

              {monthBusy && (
                <p className="px-5 py-8 text-center text-sm text-[#8AA6AB]">Reading the month…</p>
              )}

              {monthError !== "" && (
                <p className="m-5 rounded-lg border border-[#E4674F] bg-[#2A1714] px-3 py-2 text-sm text-[#F3B0A2]">
                  {monthError}
                </p>
              )}

              {monthList !== null && !monthBusy && (
                <>
                  <ul className="max-h-[28rem] divide-y divide-[#2C4E54]/50 overflow-y-auto">
                    {monthList.map((p) => (
                      <li key={p.pat_num} className="flex items-baseline gap-3 px-5 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-[#EDF3F1]">{p.name}</span>
                        <span className="shrink-0 text-xs text-[#8AA6AB]">
                          {monthPanel === "missed" ? "missed on" : "on"}{" "}
                          <span className="font-mono">{p.days.split(",").join(", ")}</span>
                        </span>
                        <span
                          className={`w-10 shrink-0 text-right font-mono tabular-nums ${
                            p.times > 1 ? "font-bold text-[#F3B0A2]" : "text-[#8AA6AB]"
                          }`}
                        >
                          ×{p.times}
                        </span>
                      </li>
                    ))}
                    {monthList.length === 0 && (
                      <li className="px-5 py-6 text-center text-sm text-[#4A6165]">
                        Nobody this month.
                      </li>
                    )}
                  </ul>
                  <p className="border-t border-[#2C4E54] px-5 py-2.5 text-[11px] text-[#4A6165]">
                    Each patient is listed once. ×2 or more means they are counted
                    that many times in the total — the repeats sort to the top.
                    Read from OpenDental now; nothing is stored here.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* The day behind a number: who was on, who came, who did not.
            Read from OpenDental when opened; nothing is stored. */}
        {panel !== null && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8">
            <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
              <div className="flex items-baseline gap-3 border-b border-[#2C4E54] px-5 py-3">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.06em]">
                  {MONTHS[month - 1]} {panel.day}
                </h3>
                <span className="text-xs text-[#8AA6AB]">
                  {weekdayOf(year, month, panel.day)}
                </span>

                {/* What this list actually is, so the reader never has
                    to remember which figure they clicked. */}
                <span className="rounded bg-[#16292D] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#79B4C4]">
                  {panel.focus === "showed" && "Showed — cleaning and exam done"}
                  {panel.focus === "missed" && "Missed — held at midnight, never seen"}
                  {panel.focus === "booked" && "Booked — everyone the day involved"}
                  {panel.focus === "notHygiene" && "NH/NE — short a cleaning or an exam"}
                  {panel.focus === "srp" && "SRP — scaling and root planing"}
                  {panel.focus === "rdh" && "Rostered hygienists"}
                </span>

                {/* The day's own figures, so it is plain what this list
                    was counted against. */}
                {(() => {
                  const row = byDay.get(panel.day);
                  if (!row) return null;
                  return (
                    <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11px] tabular-nums text-[#8AA6AB]">
                      <span>{row.slots} slots</span>
                      <span>{row.booked} booked</span>
                      <span className="text-[#79B4C4]">{row.showed} showed</span>
                      <span className="text-[#F3B0A2]">{row.missed} missed</span>
                      <span>
                        {row.nhne} NH/NE, {row.srp} SRP
                      </span>
                    </span>
                  );
                })()}

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
                      Rostered
                    </h4>
                    {detail.hygienists.length === 0 ? (
                      <p className="mt-1 text-sm text-[#4A6165]">
                        Nobody rostered. Anything below was seen in the hygiene
                        columns by a doctor.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {detail.hygienists.map((h, i) => {
                          const hours = shiftHours(h.from, h.to);
                          const cols = h.columns === "" ? 0 : h.columns.split(" + ").length;
                          return (
                            <li key={`${h.name}-${i}`} className="text-sm text-[#EDF3F1]">
                              {h.name}{" "}
                              <span className="font-mono text-xs text-[#8AA6AB]">
                                {h.from.slice(0, 5)}–{h.to.slice(0, 5)}
                              </span>{" "}
                              <span className="text-xs text-[#8AA6AB]">{h.columns}</span>
                              {/* The arithmetic behind the slot count:
                                  an hour in a column is a slot. */}
                              <span className="ml-2 font-mono text-xs text-[#79B4C4]">
                                {hours}h × {cols} col = {Math.round(hours * cols * 10) / 10}
                              </span>
                            </li>
                          );
                        })}
                        <li className="pt-1 text-xs text-[#8AA6AB]">
                          Total{" "}
                          <span className="font-mono text-[#EDF3F1]">
                            {Math.round(
                              detail.hygienists.reduce(
                                (sum, h) =>
                                  sum +
                                  shiftHours(h.from, h.to) *
                                    (h.columns === "" ? 0 : h.columns.split(" + ").length),
                                0,
                              ),
                            )}
                          </span>{" "}
                          slots — hours are summed exactly, then rounded once.
                        </li>
                      </ul>
                    )}
                  </div>

                  {panel.focus !== "rdh" && (
                    <div className="max-h-[26rem] overflow-y-auto">
                      {/* NH/NE splits into its 2 groups, one under the
                          other; every other figure is a single list. */}
                      {(panel.focus === "notHygiene"
                        ? [
                            {
                              title: "No exam — cleaning done, no exam posted",
                              rows: detail.appointments.filter((v) => v.kind === "no exam"),
                            },
                            {
                              title: "No hyg — no cleaning posted",
                              rows: detail.appointments.filter(
                                (v) => v.kind === "no cleaning" || v.kind === "nothing",
                              ),
                            },
                          ]
                        : [
                            {
                              title: "",
                              rows: detail.appointments.filter(inFocus(panel.focus)),
                            },
                          ]
                      ).map((section) => (
                        <div key={section.title}>
                          {section.title !== "" && (
                            <h4 className="border-b border-[#2C4E54] bg-[#16292D] px-5 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#F3B0A2]">
                              {section.title} · {section.rows.length}
                            </h4>
                          )}
                          <ul className="divide-y divide-[#2C4E54]/50">
                            {section.rows.map((v) => (
                              <li key={v.apt_num} className="flex gap-3 px-5 py-2 text-sm">
                                <span className="w-12 shrink-0 font-mono text-xs text-[#8AA6AB]">
                                  {v.time.slice(0, 5)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[#EDF3F1]">{v.patient}</span>
                                  <span className="block truncate text-xs text-[#8AA6AB]">
                                    {v.column}
                                    {v.hygienist !== "" ? ` · ${v.hygienist}` : ""}
                                    {v.codes !== "" ? ` · ${v.codes}` : ""}
                                  </span>
                                </span>
                                {/* On the Booked list the states sit
                                    together, so each row says which it
                                    is. "Nothing" rows get named too. */}
                                {(panel.focus === "booked" || v.kind === "nothing") && (
                                  <span
                                    className={`shrink-0 self-start rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] ${
                                      v.state === "showed"
                                        ? "text-[#79B4C4]"
                                        : v.state === "missed"
                                          ? "text-[#F3B0A2]"
                                          : "text-[#8AA6AB]"
                                    }`}
                                  >
                                    {v.kind === "nothing" ? "nothing posted" : v.state}
                                  </span>
                                )}
                              </li>
                            ))}
                            {section.rows.length === 0 && (
                              <li className="px-5 py-4 text-center text-sm text-[#4A6165]">
                                Nobody in this group.
                              </li>
                            )}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="border-t border-[#2C4E54] px-5 py-2.5 text-[11px] text-[#4A6165]">
                    {panel.focus === "missed"
                      ? "Booked at midnight and not completed. "
                      : panel.focus === "showed"
                        ? "Completed with a cleaning, perio maintenance or other hygiene code. "
                        : panel.focus === "notHygiene"
                          ? "Completed in a hygiene chair with no hygiene posted. Each says what was found instead. "
                          : ""}
                    Read from OpenDental now; nothing is stored here.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        <p className="px-1 text-[11px] text-[#4A6165]">
          Slots come from the hygienists rostered that day and the columns they
          sit in. A day with nobody rostered shows 0 slots and still counts what
          was booked and seen — the doctors see hygiene patients on those days.
          For a day that has been, booked is what stood in those columns at
          midnight; for a day ahead it is what stands there now. Missed is
          booked less showed, never counted on its own.
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
  value: number;
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
// With onClick it opens the month's own list of patients.
function Total({
  value,
  tone,
  struck,
  onClick,
  pct,
}: {
  value: number;
  tone?: "good" | "warn";
  struck?: boolean;
  onClick?: () => void;
  pct?: string;
}) {
  const colour =
    tone === "good" ? "text-[#79B4C4]" : tone === "warn" ? "text-[#E4674F]" : "text-[#EDF3F1]";

  const figure = (
    <>
      {struck ? (
        <s className="text-[#4A6165] decoration-[#E4674F] decoration-[1.5px]">{value}</s>
      ) : (
        value
      )}
      {/* The same fixed-width slot the day rows use for their
          percentage, so the total's digits land in the same column. */}
      {pct !== undefined && (
        <span className="ml-1 inline-block w-12 text-left text-[10px] font-normal text-[#4A6165]">
          {pct}
        </span>
      )}
    </>
  );

  return (
    <th className="whitespace-nowrap px-3.5 pb-2 pt-0.5 text-right align-top">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={`block w-full text-right font-mono text-[17px] font-bold tabular-nums underline decoration-dotted underline-offset-4 decoration-[#4A6165] hover:decoration-[#EDF3F1] ${colour}`}
        >
          {figure}
        </button>
      ) : (
        <span className={`block font-mono text-[17px] font-bold tabular-nums ${colour}`}>
          {figure}
        </span>
      )}
    </th>
  );
}
