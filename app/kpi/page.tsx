"use client";

// KPI Dashboard — v1
// Maria's "KPI Office Numbers" workbook, live. Months across, KPIs
// down, an office to a tab — the same shape as the sheet she keys in
// by hand, with the figures read from OpenDental instead.
//
// Changelog:
//   v1  First build, shaped on the production dashboard. One od-kpi
//       read per office and year. Sections: production by department
//       (net, with the sheet's Adj row), collection by department and
//       patient/insurance split, achieved (the sheet's average of net
//       production and collection), exams and hygiene, provider
//       blocks (days, exams, diagnosed, production, per-day and
//       per-exam), and today's aging snapshot.
//
//       Not here, deliberately: office goals, Itero scans, prime and
//       non-prime hygiene slots, ortho starts and consults,
//       membership, reviews. OpenDental does not hold them; they stay
//       manual until DOS grows a place to key them in.
//
// Why the numbers are what they are, in short — the long version is
// in the Edge Function:
//
//   Production and Adj are OpenDental's Production and Income
//   arithmetic split the way the sheet splits it: gross fees less
//   capitation write-offs on the procedure's date, and adjustments
//   less insurance write-offs on their own dates. Net is the two
//   rows added. A past month keeps moving as insurance pays; that
//   is OpenDental's own behaviour.
//
//   Collection is patient paysplits plus insurance payments, each
//   on the day the money landed, on the provider's department.
//
//   The next-hygiene ratio is read from the book as it stands
//   today, so a past month's ratio drifts as its appointments are
//   kept or broken.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Office = { id: string; slug: string; name: string };

const BUCKETS = ["GP", "Hyg", "Ortho", "OS", "Perio", "Endo", "Pedo", "Other"] as const;
type Bucket = (typeof BUCKETS)[number];

const BUCKET_LABEL: Record<Bucket, string> = {
  GP: "GP",
  Hyg: "Hygiene",
  Ortho: "Ortho",
  OS: "Oral Surgery",
  Perio: "Perio",
  Endo: "Endo",
  Pedo: "Pedo",
  Other: "Other",
};

type ProdCell = { production: number; adj: number; net: number };

type MonthKpi = {
  month: number;
  prod: Record<string, ProdCell>;
  net_total: number;
  coll: Record<string, number>;
  coll_total: number;
  patient_coll: number;
  ins_coll: number;
  exams: { new: number; recall: number; other: number; total: number };
  hyg_visits: number;
  patients_seen: number;
  with_next_hyg: number;
};

type ProvMonth = {
  days: number;
  patients: number;
  exams: number;
  dx_count: number;
  dx_fees: number;
  production: number;
};

type Provider = {
  prov_num: number;
  name: string;
  specialty: string;
  bucket: Bucket;
  total_production: number;
  months: ProvMonth[];
};

type AgingBuckets = { b0_30: number; b31_60: number; b61_90: number; over90: number };

type KpiYear = {
  office_name: string;
  year: number;
  months: MonthKpi[];
  providers: Provider[];
  aging: {
    as_of: string;
    patient: AgingBuckets & { ins_est: number };
    insurance: AgingBuckets;
  };
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Whole dollars. The cents never change a decision this screen serves.
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export default function KpiPage() {
  const router = useRouter();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());

  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSlug, setOfficeSlug] = useState("");

  const [data, setData] = useState<KpiYear | null>(null);
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

      const { data: rows, error: officeErr } = await supabase
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

      const list = (rows ?? []) as Office[];
      setOffices(list);
      setOfficeSlug((previous) => previous || list[0]?.slug || "");
      if (list.length === 0) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  // ---- The year ----
  const load = useCallback(async () => {
    if (officeSlug === "") return;

    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { data: result, error: fnError } = await supabase.functions.invoke("od-kpi", {
        body: { office: officeSlug, action: "year", year },
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
        setData(null);
        return;
      }

      if (!result?.ok) {
        setError(String(result?.error ?? "That year could not be read."));
        setData(null);
        return;
      }

      setData(result as KpiYear);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That year could not be read.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [officeSlug, year]);

  useEffect(() => {
    load();
  }, [load]);

  // Months past the current one, this year, have nothing to say yet.
  const lastLiveMonth =
    year < now.getFullYear() ? 12
    : year > now.getFullYear() ? 0
    : now.getMonth() + 1;

  // Departments that moved any money this year, in the sheet's order,
  // so an office with no perio this year does not carry an empty row.
  const activeBuckets = useMemo(() => {
    if (!data) return [] as Bucket[];
    return BUCKETS.filter((b) =>
      data.months.some(
        (m) =>
          Math.abs(m.prod[b]?.net ?? 0) > 0.5 || Math.abs(m.coll[b] ?? 0) > 0.5,
      ),
    );
  }, [data]);

  const doctors = useMemo(
    () =>
      (data?.providers ?? []).filter(
        (p) => p.bucket !== "Hyg" && Math.abs(p.total_production) > 0.5,
      ),
    [data],
  );

  const hygienists = useMemo(
    () =>
      (data?.providers ?? []).filter(
        (p) => p.bucket === "Hyg" && Math.abs(p.total_production) > 0.5,
      ),
    [data],
  );

  return (
    <main className="min-h-screen bg-[#0B1719] px-4 py-4 text-[#EDF3F1] sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3">
        {/* One bar: name, office, year. */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[17px] font-bold tracking-[-0.01em]">Office KPIs</h1>
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
              onClick={() => setYear(year - 1)}
              aria-label="Previous year"
              className="h-6 w-6 rounded-md border border-[#2C4E54] leading-none hover:bg-[#16292D]"
            >
              ←
            </button>
            <span className="min-w-[48px] text-center">{year}</span>
            <button
              type="button"
              onClick={() => setYear(year + 1)}
              aria-label="Next year"
              className="h-6 w-6 rounded-md border border-[#2C4E54] leading-none hover:bg-[#16292D]"
            >
              →
            </button>
          </div>
        </div>

        <p className="px-1 text-[11px] text-[#4A6165]">
          The KPI workbook, read live. Production and Adj follow OpenDental&apos;s
          Production and Income arithmetic, so a past month keeps moving as
          insurance pays. Goals, Itero scans, prime slots, ortho starts,
          membership and reviews are not in OpenDental and stay in the workbook
          for now.
        </p>

        {error !== "" && (
          <p className="rounded-xl border border-[#E4674F] bg-[#2A1714] px-4 py-3 text-sm text-[#F3B0A2]">
            {error}
          </p>
        )}

        {loading && (
          <p className="px-1 py-8 text-center text-sm text-[#8AA6AB]">
            Reading the year from OpenDental…
          </p>
        )}

        {!loading && data !== null && (
          <>
            {/* ============ Production ============ */}
            <Section title="Production" note="Net, by department — the sheet's top block.">
              <MonthTable lastLive={lastLiveMonth}>
                {activeBuckets.map((b) => (
                  <ProdRows key={b} bucket={b} months={data.months} lastLive={lastLiveMonth} />
                ))}
                <Row
                  label="Net production"
                  values={data.months.map((m) => m.net_total)}
                  fmt={usd}
                  lastLive={lastLiveMonth}
                  strong
                  tone="good"
                />
              </MonthTable>
            </Section>

            {/* ============ Collection ============ */}
            <Section
              title="Collection"
              note="Money in on the day it landed — by the provider's department, and split patient / insurance."
            >
              <MonthTable lastLive={lastLiveMonth}>
                {activeBuckets.map((b) => (
                  <Row
                    key={b}
                    label={BUCKET_LABEL[b]}
                    values={data.months.map((m) => m.coll[b] ?? 0)}
                    fmt={usd}
                    lastLive={lastLiveMonth}
                  />
                ))}
                <Row
                  label="Total collection"
                  values={data.months.map((m) => m.coll_total)}
                  fmt={usd}
                  lastLive={lastLiveMonth}
                  strong
                  tone="good"
                />
                <Row
                  label="Patient"
                  values={data.months.map((m) => m.patient_coll)}
                  fmt={usd}
                  lastLive={lastLiveMonth}
                  dim
                />
                <Row
                  label="Insurance"
                  values={data.months.map((m) => m.ins_coll)}
                  fmt={usd}
                  lastLive={lastLiveMonth}
                  dim
                />
                <Row
                  label="Achieved (prod + coll) / 2"
                  values={data.months.map((m) => (m.net_total + m.coll_total) / 2)}
                  fmt={usd}
                  lastLive={lastLiveMonth}
                  strong
                />
              </MonthTable>
            </Section>

            {/* ============ Exams & hygiene ============ */}
            <Section
              title="Exams & hygiene"
              note="New is the comprehensives (D0150, D0180); Recall the periodics (D0120, C0130). The next-hygiene ratio reads the book as it stands today."
            >
              <MonthTable lastLive={lastLiveMonth}>
                <Row
                  label="New exams"
                  values={data.months.map((m) => m.exams.new)}
                  lastLive={lastLiveMonth}
                />
                <Row
                  label="Recall exams"
                  values={data.months.map((m) => m.exams.recall)}
                  lastLive={lastLiveMonth}
                />
                <Row
                  label="Other exams"
                  values={data.months.map((m) => m.exams.other)}
                  lastLive={lastLiveMonth}
                  dim
                />
                <Row
                  label="Total exams"
                  values={data.months.map((m) => m.exams.total)}
                  lastLive={lastLiveMonth}
                  strong
                />
                <Row
                  label="Hygiene visits"
                  values={data.months.map((m) => m.hyg_visits)}
                  lastLive={lastLiveMonth}
                />
                <Row
                  label="Exam ratio (exams / hyg)"
                  values={data.months.map((m) =>
                    m.hyg_visits > 0 ? m.exams.total / m.hyg_visits : 0,
                  )}
                  fmt={(n) => (n > 0 ? n.toFixed(2) : "—")}
                  lastLive={lastLiveMonth}
                  dim
                />
                <Row
                  label="Patients seen"
                  values={data.months.map((m) => m.patients_seen)}
                  lastLive={lastLiveMonth}
                />
                <Row
                  label="With next hyg appt"
                  values={data.months.map((m) => m.with_next_hyg)}
                  lastLive={lastLiveMonth}
                  dim
                />
                <Row
                  label="Next hyg ratio"
                  values={data.months.map((m) =>
                    m.patients_seen > 0 ? (m.with_next_hyg / m.patients_seen) * 100 : 0,
                  )}
                  fmt={(n) => (n > 0 ? `${Math.round(n)}%` : "—")}
                  lastLive={lastLiveMonth}
                  strong
                />
              </MonthTable>
            </Section>

            {/* ============ Doctors ============ */}
            <Section
              title="Doctors"
              note="Days worked is days with completed work. Diagnosed is treatment planned that month, planned still or completed since."
            >
              {doctors.map((p) => (
                <ProviderBlock key={p.prov_num} p={p} lastLive={lastLiveMonth} />
              ))}
              {doctors.length === 0 && <Empty />}
            </Section>

            {/* ============ Hygienists ============ */}
            <Section title="Hygienists" note="Prime and non-prime slots stay in the workbook — the book does not name them.">
              {hygienists.map((p) => (
                <ProviderBlock key={p.prov_num} p={p} lastLive={lastLiveMonth} hygienist />
              ))}
              {hygienists.length === 0 && <Empty />}
            </Section>

            {/* ============ Aging ============ */}
            <Section
              title={`Aging — as of ${data.aging.as_of}`}
              note="OpenDental keeps balances only as they stand now, so this is today's snapshot, not the sheet's month-by-month history. Insurance is outstanding sent claims aged by the day they were sent."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <AgingCard title="Insurance aging" buckets={data.aging.insurance} />
                <AgingCard
                  title="Patient aging (family balances)"
                  buckets={data.aging.patient}
                  insEst={data.aging.patient.ins_est}
                />
              </div>
            </Section>
          </>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------

function Section({ title, note, children }: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="mt-2 px-1">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
          {title}
        </h2>
        {note && <p className="text-[11px] text-[#4A6165]">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty() {
  return (
    <p className="rounded-2xl border border-[#2C4E54] bg-[#122326] px-4 py-3 text-sm text-[#8AA6AB]">
      Nothing this year.
    </p>
  );
}

// The one table shape every section uses: a label column that stays
// put, twelve months, and a year total.
function MonthTable({ lastLive, children }: { lastLive: number; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
              <th className="sticky left-0 bg-[#122326] px-3.5 py-2 text-left">&nbsp;</th>
              {MONTHS.map((m, i) => (
                <th
                  key={m}
                  className={`px-2.5 py-2 text-right ${i + 1 > lastLive ? "text-[#3A5156]" : ""}`}
                >
                  {m}
                </th>
              ))}
              <th className="border-l border-[#2C4E54] px-3 py-2 text-right">Year</th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, values, fmt, lastLive, strong, dim, tone, indent }: {
  label: string;
  values: number[];
  fmt?: (n: number) => string;
  lastLive: number;
  strong?: boolean;
  dim?: boolean;
  tone?: "good" | "warn";
  indent?: boolean;
}) {
  const format = fmt ?? ((n: number) => String(Math.round(n)));
  const total = values.slice(0, Math.max(lastLive, 0)).reduce((s, v) => s + v, 0);
  const toneClass =
    tone === "good" ? "text-[#79B4C4]" : tone === "warn" ? "text-[#F0A93B]" : "";

  return (
    <tr
      className={`border-t border-[#1B3439] font-mono text-[13px] tabular-nums ${
        strong ? "bg-[#16292D] font-bold" : ""
      } ${dim ? "text-[#8AA6AB]" : ""} ${toneClass}`}
    >
      <td
        className={`sticky left-0 whitespace-nowrap px-3.5 py-1.5 text-left font-sans text-xs ${
          strong ? "bg-[#16292D] font-bold" : "bg-[#122326]"
        } ${indent ? "pl-7" : ""}`}
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td key={i} className="px-2.5 py-1.5 text-right">
          {i + 1 > lastLive || (v === 0 && !strong) ? (
            <span className="text-[#3A5156]">—</span>
          ) : (
            format(v)
          )}
        </td>
      ))}
      <td className="border-l border-[#2C4E54] px-3 py-1.5 text-right font-bold">
        {/* Ratios do not sum across a year; their total cell stays quiet. */}
        {fmt && total === 0 ? <span className="text-[#3A5156]">—</span> : format(total)}
      </td>
    </tr>
  );
}

// A department's pair of rows, the way the sheet writes them:
// Production, then its Adj underneath, signed.
function ProdRows({ bucket, months, lastLive }: {
  bucket: Bucket;
  months: MonthKpi[];
  lastLive: number;
}) {
  return (
    <>
      <Row
        label={BUCKET_LABEL[bucket]}
        values={months.map((m) => m.prod[bucket]?.production ?? 0)}
        fmt={usd}
        lastLive={lastLive}
      />
      <Row
        label="Adj"
        values={months.map((m) => m.prod[bucket]?.adj ?? 0)}
        fmt={usd}
        lastLive={lastLive}
        dim
        indent
      />
    </>
  );
}

function ProviderBlock({ p, lastLive, hygienist }: {
  p: Provider;
  lastLive: number;
  hygienist?: boolean;
}) {
  const m = p.months;
  const per = (top: number[], bottom: number[]) =>
    top.map((t, i) => (bottom[i] > 0 ? t / bottom[i] : 0));

  const production = m.map((x) => x.production);
  const days = m.map((x) => x.days);

  return (
    <div className="flex flex-col gap-1">
      <p className="px-1 text-xs font-bold text-[#EDF3F1]">
        {p.name}
        <span className="ml-2 font-normal text-[#8AA6AB]">
          {p.specialty || "General Practice"}
        </span>
      </p>
      <MonthTable lastLive={lastLive}>
        <Row label="Days worked" values={days} lastLive={lastLive} />
        {!hygienist && (
          <>
            <Row label="Exams" values={m.map((x) => x.exams)} lastLive={lastLive} />
            <Row
              label="Diagnosed (TP)"
              values={m.map((x) => x.dx_fees)}
              fmt={usd}
              lastLive={lastLive}
            />
            <Row
              label="Diag per exam"
              values={per(m.map((x) => x.dx_fees), m.map((x) => x.exams))}
              fmt={(n) => (n > 0 ? usd(n) : "—")}
              lastLive={lastLive}
              dim
            />
          </>
        )}
        <Row label="Production" values={production} fmt={usd} lastLive={lastLive} strong />
        <Row
          label="Prod per day"
          values={per(production, days)}
          fmt={(n) => (n > 0 ? usd(n) : "—")}
          lastLive={lastLive}
          dim
        />
        {!hygienist && (
          <Row
            label="Prod per exam"
            values={per(production, m.map((x) => x.exams))}
            fmt={(n) => (n > 0 ? usd(n) : "—")}
            lastLive={lastLive}
            dim
          />
        )}
        {hygienist && (
          <>
            <Row label="Patients" values={m.map((x) => x.patients)} lastLive={lastLive} />
            <Row
              label="Patients per day"
              values={per(m.map((x) => x.patients), days)}
              fmt={(n) => (n > 0 ? n.toFixed(1) : "—")}
              lastLive={lastLive}
              dim
            />
          </>
        )}
      </MonthTable>
    </div>
  );
}

function AgingCard({ title, buckets, insEst }: {
  title: string;
  buckets: AgingBuckets;
  insEst?: number;
}) {
  const total = buckets.b0_30 + buckets.b31_60 + buckets.b61_90 + buckets.over90;
  const rows: [string, number, boolean][] = [
    ["0–30", buckets.b0_30, false],
    ["31–60", buckets.b31_60, false],
    ["61–90", buckets.b61_90, false],
    ["90+", buckets.over90, true],
  ];

  return (
    <div className="rounded-2xl border border-[#2C4E54] bg-[#122326] p-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[#8AA6AB]">
        {title}
      </p>
      <table className="w-full border-collapse font-mono text-[13px] tabular-nums">
        <tbody>
          {rows.map(([label, value, risk]) => (
            <tr key={label} className="border-t border-[#1B3439]">
              <td className="py-1.5 pr-3 font-sans text-xs text-[#8AA6AB]">{label}</td>
              <td className={`py-1.5 text-right ${risk && value > 0 ? "text-[#E4674F]" : ""}`}>
                {usd(value)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-[#2C4E54] font-bold">
            <td className="py-1.5 pr-3 font-sans text-xs text-[#8AA6AB]">Total</td>
            <td className="py-1.5 text-right">{usd(total)}</td>
          </tr>
          {insEst !== undefined && (
            <tr className="border-t border-[#1B3439] text-[#8AA6AB]">
              <td className="py-1.5 pr-3 font-sans text-xs">of which pending insurance</td>
              <td className="py-1.5 text-right">{usd(insEst)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
