"use client";

// Chairside charting — v3
// A tablet screen for recording existing conditions and diagnosed
// treatment straight into OpenDental from the operatory.
//
// Changelog:
//   v1  Patient search, tooth chart, twin drill-down panels, surface
//       picker, session ledger with undo. Every OpenDental call goes
//       through the od-chart Edge Function.
//   v2  v1 swallowed the reason a commit failed. The Edge Function
//       already returns OpenDental's own message in `detail`, along with
//       the code it resolved, and v1 showed neither — the user saw
//       "OpenDental rejected that procedure" and nothing else. The error
//       banner now carries the detail and the resolved code.
//   v3  Existing entries now commit at ProcStatus EO, because OpenDental's
//       API will not accept EC on either POST or PUT. It also refuses to
//       DELETE a row at EO, so those rows cannot be undone from here. The
//       undo button is hidden on them and the row says so, rather than
//       offering an action that always fails.
//
// Design notes:
//   - Dark, high-contrast, large targets. The user is standing, gloved,
//     and not going to type.
//   - Panels swap in place rather than cascading. Drill in, drill back.
//   - The fee shown on a committed row is whatever OpenDental returned.
//     This screen never calculates one.
//   - Undo removes the entry from OpenDental, not just from the list.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type Office = { id: string; name: string; slug: string };

type PatientHit = {
  PatNum: number;
  LName: string;
  FName: string;
  Preferred: string;
  Birthdate: string;
  ChartNumber: string;
};

type Patient = PatientHit & { PriProv: number | null; priProvAbbr: string };

type Provider = {
  ProvNum: number;
  Abbr: string;
  LName: string;
  FName: string;
  Suffix: string;
};

type Procedure = {
  ProcNum: number;
  ProcStatus: string;
  ProcDate: string;
  ToothNum: string;
  Surf: string;
  procCode: string;
  descript: string;
  ProcFee: string | null;
  provAbbr: string;
};

type Tile = {
  id: string;
  label: string;
  entry_kind: "procedure" | "tooth_initial";
  initial_type: string | null;
  needs_surfaces: boolean;
};

type Category = {
  id: string;
  bucket: "existing" | "diagnosed";
  label: string;
  tiles: Tile[];
};

type ResolvedProvider = {
  source: string;
  ProvNum: number | null;
  provAbbr: string;
};

type LedgerEntry = {
  key: string;
  bucket: "existing" | "diagnosed";
  entry_kind: "procedure" | "tooth_initial";
  od_id: number | null;
  label: string;
  code: string;
  descript: string;
  tooth: string;
  surf: string;
  fee: string | null;
  provAbbr: string;
  removing: boolean;
  // OpenDental refuses to delete a procedure at EO, so an existing entry
  // has to be removed in OpenDental itself.
  undoable: boolean;
};

type Bucket = "existing" | "diagnosed";

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
const UPPER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LOWER = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];
const SURFACES = ["M", "O", "D", "B", "L"];

const EXISTING_STATUSES = new Set(["C", "EC", "EO", "Cn"]);

// OpenDental's own rejection text arrives in `detail`. Without it the
// user is told only that something failed, which is what v1 did.
function describeFailure(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;

  const parts: string[] = [];
  const main = String(p.error ?? "").trim();
  if (main !== "") parts.push(main);

  const detail = p.detail;
  const detailText = typeof detail === "string"
    ? detail.trim()
    : detail !== undefined && detail !== null
      ? JSON.stringify(detail)
      : "";
  if (detailText !== "" && detailText !== main) parts.push(detailText);

  const code = String(p.resolved_code ?? "").trim();
  if (code !== "") parts.push(`(code ${code})`);

  return parts.length > 0 ? parts.join(" — ") : "That didn't work.";
}

// ---------------------------------------------------------------------
export default function ChartPage() {
  const router = useRouter();

  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSlug, setOfficeSlug] = useState("");
  const [booting, setBooting] = useState(true);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [patient, setPatient] = useState<Patient | null>(null);
  const [loadingPatient, setLoadingPatient] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [missingTeeth, setMissingTeeth] = useState<string[]>([]);
  const [menu, setMenu] = useState<Category[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [resolvedProv, setResolvedProv] = useState<ResolvedProvider | null>(null);
  const [provOverride, setProvOverride] = useState<number | null>(null);

  const [tooth, setTooth] = useState<string>("");
  const [nav, setNav] = useState<
    Record<Bucket, { category: Category | null; pending: Tile | null; surfaces: string[] }>
  >({
    existing: { category: null, pending: null, surfaces: [] },
    diagnosed: { category: null, pending: null, surfaces: [] },
  });

  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");

  // -------------------------------------------------------------------
  // Session and offices
  // -------------------------------------------------------------------
  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const supabase = createClient();
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) {
          router.replace("/login");
          return;
        }

        const { data, error } = await supabase
          .from("offices")
          .select("id, name, slug")
          .eq("is_active", true)
          .order("name");

        if (!active) return;

        if (error) {
          setLoadError(error.message);
        } else {
          const rows = data ?? [];
          setOffices(rows);
          if (rows.length > 0) setOfficeSlug(rows[0].slug);
        }
      } catch (caught) {
        if (active) {
          setLoadError(
            caught instanceof Error ? caught.message : "Couldn't start up.",
          );
        }
      } finally {
        if (active) setBooting(false);
      }
    }

    boot();
    return () => {
      active = false;
    };
  }, [router]);

  // -------------------------------------------------------------------
  // One place for every call into the Edge Function
  // -------------------------------------------------------------------
  const callChart = useCallback(
    async (payload: Record<string, unknown>) => {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("od-chart", {
        body: { office: officeSlug, ...payload },
      });

      if (error) {
        // A non-2xx from the function arrives here with the body attached.
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            throw new Error(describeFailure(parsed));
          } catch (inner) {
            if (inner instanceof Error && inner.message !== "") throw inner;
          }
        }
        throw new Error("The server didn't respond as expected.");
      }

      if (!data?.ok) throw new Error(describeFailure(data));
      return data;
    },
    [officeSlug],
  );

  // -------------------------------------------------------------------
  // Patient search
  // -------------------------------------------------------------------
  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) {
      setSearchError("Type at least two letters of the last name.");
      return;
    }

    setSearching(true);
    setSearchError("");
    setHits([]);

    try {
      const data = await callChart({ action: "patients", query: q });
      setHits(data.patients ?? []);
      if ((data.patients ?? []).length === 0) {
        setSearchError("No patients matched that name.");
      }
    } catch (caught) {
      setSearchError(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function openPatient(patNum: number) {
    setLoadingPatient(true);
    setLoadError("");
    setCommitError("");

    try {
      const data = await callChart({ action: "open", pat_num: patNum });

      setPatient(data.patient);
      setProcedures(data.procedures ?? []);
      setMissingTeeth(data.missing_teeth ?? []);
      setMenu(data.menu ?? []);
      setProviders(data.providers ?? []);
      setResolvedProv(data.resolved_provider ?? null);
      setProvOverride(null);
      setLedger([]);
      setTooth("");
      resetNav();
      setHits([]);
      setQuery("");
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Couldn't open that patient.");
    } finally {
      setLoadingPatient(false);
    }
  }

  function closePatient() {
    setPatient(null);
    setProcedures([]);
    setMissingTeeth([]);
    setMenu([]);
    setLedger([]);
    setTooth("");
    resetNav();
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function resetNav() {
    setNav({
      existing: { category: null, pending: null, surfaces: [] },
      diagnosed: { category: null, pending: null, surfaces: [] },
    });
  }

  // -------------------------------------------------------------------
  // Tooth chart marks
  // -------------------------------------------------------------------
  const marks = useMemo(() => {
    const map: Record<string, { existing: boolean; diagnosed: boolean }> = {};

    for (const p of procedures) {
      if (p.ToothNum === "") continue;
      if (!map[p.ToothNum]) map[p.ToothNum] = { existing: false, diagnosed: false };
      if (p.ProcStatus === "TP") map[p.ToothNum].diagnosed = true;
      else if (EXISTING_STATUSES.has(p.ProcStatus)) map[p.ToothNum].existing = true;
    }

    for (const e of ledger) {
      if (e.tooth === "") continue;
      if (!map[e.tooth]) map[e.tooth] = { existing: false, diagnosed: false };
      if (e.bucket === "diagnosed") map[e.tooth].diagnosed = true;
      else map[e.tooth].existing = true;
    }

    return map;
  }, [procedures, ledger]);

  const missingSet = useMemo(() => new Set(missingTeeth), [missingTeeth]);

  const toothProcedures = useMemo(
    () => (tooth === "" ? [] : procedures.filter((p) => p.ToothNum === tooth)),
    [procedures, tooth],
  );

  // -------------------------------------------------------------------
  // Panel navigation
  // -------------------------------------------------------------------
  function setBucketNav(
    bucket: Bucket,
    patch: Partial<{ category: Category | null; pending: Tile | null; surfaces: string[] }>,
  ) {
    setNav((prev) => ({ ...prev, [bucket]: { ...prev[bucket], ...patch } }));
  }

  function goBack(bucket: Bucket) {
    const state = nav[bucket];
    if (state.pending !== null) {
      setBucketNav(bucket, { pending: null, surfaces: [] });
    } else {
      setBucketNav(bucket, { category: null });
    }
  }

  function toggleSurface(bucket: Bucket, surface: string) {
    const current = nav[bucket].surfaces;
    setBucketNav(bucket, {
      surfaces: current.includes(surface)
        ? current.filter((s) => s !== surface)
        : [...current, surface],
    });
  }

  function chooseTile(bucket: Bucket, tile: Tile) {
    setCommitError("");

    if (tile.needs_surfaces) {
      setBucketNav(bucket, { pending: tile, surfaces: [] });
      return;
    }

    commit(bucket, tile, []);
  }

  // -------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------
  async function commit(bucket: Bucket, tile: Tile, surfaces: string[]) {
    if (tooth === "") {
      setCommitError("Pick a tooth first.");
      return;
    }

    setCommitting(true);
    setCommitError("");

    try {
      const data = await callChart({
        action: "commit",
        pat_num: patient?.PatNum,
        tile_id: tile.id,
        tooth_num: tooth,
        surfaces,
        ...(provOverride !== null ? { prov_num: provOverride } : {}),
      });

      const entry: LedgerEntry = {
        key: `${data.entry_kind}-${data.od_id}-${Date.now()}`,
        bucket,
        entry_kind: data.entry_kind,
        od_id: data.od_id ?? null,
        label: tile.label,
        code: data.proc_code ?? "",
        descript: data.descript ?? "",
        tooth: data.tooth_num ?? tooth,
        surf: data.surf ?? "",
        fee: data.fee ?? null,
        provAbbr: data.prov_abbr ?? "",
        removing: false,
        undoable: data.undoable !== false,
      };

      setLedger((prev) => [entry, ...prev]);

      if (data.entry_kind === "tooth_initial") {
        setMissingTeeth((prev) =>
          prev.includes(entry.tooth) ? prev : [...prev, entry.tooth]
        );
      }

      setBucketNav(bucket, { pending: null, surfaces: [] });
    } catch (caught) {
      setCommitError(caught instanceof Error ? caught.message : "Couldn't save that.");
    } finally {
      setCommitting(false);
    }
  }

  // -------------------------------------------------------------------
  // Undo — removes it from OpenDental, not just from this list
  // -------------------------------------------------------------------
  async function undo(entry: LedgerEntry) {
    if (entry.od_id === null) return;

    setLedger((prev) =>
      prev.map((e) => (e.key === entry.key ? { ...e, removing: true } : e))
    );
    setCommitError("");

    try {
      await callChart({
        action: "undo",
        entry_kind: entry.entry_kind,
        od_id: entry.od_id,
      });

      setLedger((prev) => prev.filter((e) => e.key !== entry.key));

      if (entry.entry_kind === "tooth_initial") {
        setMissingTeeth((prev) => prev.filter((t) => t !== entry.tooth));
      }
    } catch (caught) {
      setCommitError(caught instanceof Error ? caught.message : "Couldn't undo that.");
      setLedger((prev) =>
        prev.map((e) => (e.key === entry.key ? { ...e, removing: false } : e))
      );
    }
  }

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  if (booting) {
    return (
      <main className="min-h-screen bg-[#0B1719] px-6 py-10 text-[#EDF3F1]">
        <p className="text-[15px] text-[#8AA6AB]">Starting up…</p>
      </main>
    );
  }

  // ---------- patient search ----------
  if (patient === null) {
    return (
      <main className="min-h-screen bg-[#0B1719] px-6 py-10 text-[#EDF3F1]">
        <div className="mx-auto w-full max-w-2xl">
          <p className="font-mono text-xs tracking-[0.18em] text-[#F0A93B] uppercase">
            Chairside · Charting
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Find a patient</h1>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <label htmlFor="office" className="text-sm text-[#8AA6AB]">
              Office
            </label>
            <select
              id="office"
              value={officeSlug}
              onChange={(e) => setOfficeSlug(e.target.value)}
              className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
            >
              {offices.map((o) => (
                <option key={o.id} value={o.slug}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 flex gap-3">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="Last name"
              autoComplete="off"
              className="flex-1 rounded-xl border border-[#2C4E54] bg-[#122326] px-4 py-4 text-lg text-[#EDF3F1] placeholder:text-[#5E7B80] focus:border-[#F0A93B] focus:outline-none"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={searching}
              className="rounded-xl bg-[#EDF3F1] px-7 py-4 text-lg font-semibold text-[#0B1719] disabled:opacity-40"
            >
              {searching ? "…" : "Search"}
            </button>
          </div>

          {searchError !== "" && (
            <p className="mt-4 text-sm text-[#E4674F]">{searchError}</p>
          )}
          {loadError !== "" && (
            <p className="mt-4 text-sm text-[#E4674F]">{loadError}</p>
          )}

          <div className="mt-6 space-y-2">
            {hits.map((h) => (
              <button
                key={h.PatNum}
                type="button"
                onClick={() => openPatient(h.PatNum)}
                disabled={loadingPatient}
                className="flex w-full items-center gap-4 rounded-xl border border-[#2C4E54] bg-[#122326] px-5 py-4 text-left hover:bg-[#193034] disabled:opacity-50"
              >
                <span className="text-[17px] font-semibold">
                  {h.LName}, {h.Preferred || h.FName}
                </span>
                <span className="ml-auto font-mono text-sm text-[#8AA6AB]">
                  {h.Birthdate || "—"}
                </span>
                <span className="font-mono text-xs text-[#5E7B80]">#{h.ChartNumber}</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  // ---------- charting ----------
  const buckets: Bucket[] = ["existing", "diagnosed"];

  return (
    <main className="min-h-screen bg-[#0B1719] px-4 py-5 text-[#EDF3F1]">
      <div className="mx-auto w-full max-w-[1400px]">
        {/* Patient bar */}
        <div className="flex flex-wrap items-center gap-4 border-b border-[#2C4E54] pb-3">
          <div>
            <h1 className="text-xl font-semibold">
              {patient.LName}, {patient.Preferred || patient.FName}
            </h1>
            <p className="font-mono text-xs text-[#8AA6AB]">
              #{patient.ChartNumber} · {patient.Birthdate}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <label htmlFor="prov" className="text-xs text-[#8AA6AB]">
              Provider
            </label>
            <select
              id="prov"
              value={provOverride ?? ""}
              onChange={(e) =>
                setProvOverride(e.target.value === "" ? null : Number(e.target.value))
              }
              className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
            >
              <option value="">
                {resolvedProv?.provAbbr ?? "Default"} (from {resolvedProv?.source ?? "patient"})
              </option>
              {providers.map((p) => (
                <option key={p.ProvNum} value={p.ProvNum}>
                  {p.Abbr} — {p.LName}
                  {p.FName ? `, ${p.FName}` : ""}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={closePatient}
              className="rounded-lg border border-[#2C4E54] px-4 py-2 text-sm hover:bg-[#193034]"
            >
              Close
            </button>
          </div>
        </div>

        {/* Tooth chart */}
        <section className="mt-4 rounded-2xl border border-[#2C4E54] bg-[#122326] p-3">
          {[UPPER, LOWER].map((arch, archIndex) => (
            <div
              key={archIndex}
              className={`grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5 ${archIndex === 1 ? "mt-2" : ""}`}
            >
              {arch.map((n) => {
                const key = String(n);
                const mark = marks[key];
                const isMissing = missingSet.has(key);
                const selected = tooth === key;

                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setTooth(selected ? "" : key);
                      resetNav();
                      setCommitError("");
                    }}
                    className={`flex h-16 flex-col items-center justify-center gap-1 rounded-lg border font-mono text-[13px] font-semibold transition-transform active:scale-95 ${
                      selected
                        ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                        : isMissing
                          ? "border-[#2C4E54] bg-[#0F1D20] text-[#4A6165] line-through"
                          : "border-[#2C4E54] bg-[#193034] text-[#8AA6AB]"
                    }`}
                  >
                    <span>{n}</span>
                    <span className="flex h-1.5 gap-1">
                      {mark?.existing && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#79B4C4]" />
                      )}
                      {mark?.diagnosed && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#F0A93B]" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-[#8AA6AB]">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full bg-[#79B4C4]" /> Existing
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2 w-2 rounded-full bg-[#F0A93B]" /> Diagnosed
            </span>
            <span className="ml-auto">
              {tooth === ""
                ? "No tooth selected"
                : `Tooth ${tooth}${missingSet.has(tooth) ? " · missing" : ""} · ${toothProcedures.length} on record`}
            </span>
          </div>
        </section>

        {commitError !== "" && (
          <div className="mt-3 rounded-lg border border-[#E4674F]/50 bg-[#E4674F]/10 px-4 py-3">
            <p className="text-sm text-[#E4674F]">{commitError}</p>
          </div>
        )}

        {/* Panels */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {buckets.map((bucket) => {
            const state = nav[bucket];
            const cats = menu.filter((m) => m.bucket === bucket);
            const accent = bucket === "existing" ? "#79B4C4" : "#F0A93B";
            const deep = state.category !== null;

            return (
              <section
                key={bucket}
                className="flex min-h-[430px] flex-col overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]"
              >
                <div className="flex items-center gap-2.5 border-b border-[#2C4E54] px-4 py-3">
                  <i
                    className="h-5 w-[3px] rounded-sm"
                    style={{ background: accent }}
                  />
                  <h2
                    className="text-sm font-bold tracking-[0.06em] uppercase"
                    style={{ color: accent }}
                  >
                    {bucket === "existing" ? "Existing" : "Diagnosed"}
                  </h2>
                  <span className="ml-auto truncate text-xs text-[#8AA6AB]">
                    {state.pending
                      ? `${state.category?.label} › ${state.pending.label}`
                      : state.category?.label ?? ""}
                  </span>
                </div>

                {deep && (
                  <button
                    type="button"
                    onClick={() => goBack(bucket)}
                    className="border-b border-[#2C4E54] px-4 py-3 text-left text-[13px] text-[#8AA6AB] hover:text-[#EDF3F1]"
                  >
                    ‹ Back
                  </button>
                )}

                {tooth === "" ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                    <strong className="text-[15px] font-medium">Pick a tooth</strong>
                    <span className="max-w-[26ch] text-[13px] text-[#8AA6AB]">
                      Tap a tooth above to start charting.
                    </span>
                  </div>
                ) : state.pending !== null ? (
                  // ---------- surface picker ----------
                  <>
                    <div className="grid grid-cols-5 gap-2 p-3 pb-0">
                      {SURFACES.map((s) => {
                        const on = state.surfaces.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleSurface(bucket, s)}
                            className={`h-[74px] rounded-xl border text-[22px] font-bold transition-transform active:scale-95 ${
                              on
                                ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                                : "border-[#2C4E54] bg-[#193034] text-[#EDF3F1]"
                            }`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => commit(bucket, state.pending!, state.surfaces)}
                      disabled={state.surfaces.length === 0 || committing}
                      className="m-3 rounded-xl bg-[#EDF3F1] p-4 text-[15px] font-semibold text-[#0B1719] disabled:opacity-35"
                    >
                      {committing
                        ? "Saving…"
                        : `${state.pending.label} · tooth ${tooth}${
                            state.surfaces.length > 0 ? ` · ${state.surfaces.join("")}` : ""
                          }`}
                    </button>
                  </>
                ) : (
                  // ---------- categories or tiles ----------
                  <div className="grid flex-1 grid-cols-2 content-start gap-2.5 p-3">
                    {(state.category ? state.category.tiles : cats).map((item) => {
                      const isCategory = state.category === null;
                      const label = item.label;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={committing}
                          onClick={() => {
                            if (isCategory) {
                              setBucketNav(bucket, {
                                category: item as Category,
                                pending: null,
                                surfaces: [],
                              });
                            } else {
                              chooseTile(bucket, item as Tile);
                            }
                          }}
                          className="flex min-h-[104px] flex-col justify-between rounded-xl border border-[#2C4E54] bg-[#193034] p-3 text-left transition-transform hover:bg-[#204045] active:scale-[0.97] disabled:opacity-50"
                        >
                          <span className="text-[15px] leading-tight font-semibold">
                            {label}
                          </span>
                          {isCategory ? (
                            <span className="font-mono text-xs text-[#8AA6AB]">
                              {(item as Category).tiles.length} options ›
                            </span>
                          ) : (
                            <span className="font-mono text-xs text-[#8AA6AB]">
                              {(item as Tile).entry_kind === "tooth_initial"
                                ? "mark tooth"
                                : (item as Tile).needs_surfaces
                                  ? "pick surfaces"
                                  : "one tap"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Ledger */}
        <section className="mt-4 overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
          <div className="flex items-center gap-3 border-b border-[#2C4E54] px-4 py-3">
            <h2 className="text-[13px] font-bold tracking-[0.06em] uppercase">
              This visit
            </h2>
            <span className="font-mono text-xs text-[#8AA6AB]">
              {ledger.length} {ledger.length === 1 ? "entry" : "entries"}
            </span>
            <span className="ml-auto font-mono text-xs text-[#5E7B80]">
              written to OpenDental
            </span>
          </div>

          {ledger.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-9 text-center">
              <strong className="text-[15px] font-medium">Nothing charted yet</strong>
              <span className="max-w-[30ch] text-[13px] text-[#8AA6AB]">
                Entries appear here the moment they reach OpenDental.
              </span>
            </div>
          ) : (
            <div>
              {ledger.map((e) => (
                <div
                  key={e.key}
                  className={`flex items-center gap-3 border-b border-[#2C4E54] px-4 py-3 last:border-b-0 ${
                    e.removing ? "opacity-40" : ""
                  }`}
                >
                  <i
                    className="h-[26px] w-[3px] flex-none rounded-sm"
                    style={{
                      background: e.bucket === "existing" ? "#79B4C4" : "#F0A93B",
                    }}
                  />
                  <span className="w-10 flex-none font-mono text-sm font-semibold">
                    {e.tooth}
                  </span>
                  <span className="w-[66px] flex-none font-mono text-[13px] text-[#8AA6AB]">
                    {e.code || "—"}
                  </span>
                  <span className="flex-1 text-sm">{e.descript || e.label}</span>
                  {e.surf !== "" && (
                    <span className="flex-none rounded bg-[#8AA6AB] px-1.5 py-0.5 font-mono text-xs text-[#0B1719]">
                      {e.surf}
                    </span>
                  )}
                  <span className="w-16 flex-none text-right font-mono text-[13px] text-[#8AA6AB]">
                    {e.fee !== null ? `$${e.fee}` : "—"}
                  </span>
                  <span className="w-16 flex-none text-right font-mono text-xs text-[#5E7B80]">
                    {e.provAbbr}
                  </span>
                  {e.undoable ? (
                    <button
                      type="button"
                      onClick={() => undo(e)}
                      disabled={e.removing}
                      className="flex-none px-2 py-1 text-xl leading-none text-[#8AA6AB] hover:text-[#E4674F] disabled:opacity-40"
                      aria-label="Undo this entry"
                    >
                      ×
                    </button>
                  ) : (
                    <span
                      className="flex-none px-2 py-1 text-[11px] text-[#5E7B80]"
                      title="OpenDental will not delete an existing-status procedure. Remove it in OpenDental."
                    >
                      in OD
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
