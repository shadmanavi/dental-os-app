"use client";

// Chairside charting — v8
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
//   v4  Adds a Today tab to the patient picker. Typing a surname was the
//       only way in, which is the wrong gesture for someone already
//       standing at the chair with the patient in front of them. Today
//       lists the day's appointments and one tap opens the chart.
//
//       Nothing downstream changed. A row calls the same openPatient()
//       the search results already called.
//
//       Four things about the data shaped this screen, all settled by
//       probing the live Downey database rather than assumed:
//
//       - The day arrives in one call. od-chart's schedule action reads
//         appointment joined to patient and operatory in a single
//         statement. The obvious alternative, one patient lookup per
//         row, took 6.7 seconds for 31 rows because OpenDental serves
//         those sequentially however they are fired.
//       - Broken appointments are greyed and unopenable. That status is
//         confirmed; the rest of OpenDental's status list is not, so
//         everything else stays tappable rather than being disabled on a
//         guess.
//       - Checked in, in the chair, and dismissed are derived from the
//         arrival, seating and dismissal timestamps rather than from the
//         status, which does not carry them.
//       - The date is computed in local time. The rest of this file used
//         toISOString(), which is UTC, and would have rolled the schedule
//         over to tomorrow every afternoon in California.
//
//   v5  Two things the office asked for after using v4.
//
//       - Search takes a date of birth or a patient number, not just a
//         surname. Today's schedule alone held two Mendozas and two
//         Chavezes, so a surname is often not enough to be sure. One
//         box still: digits are read as a patient number, a date as a
//         birthdate, anything else as a surname. The server decides,
//         so the rule lives in one place rather than two.
//
//       - Providers appear by name. The schedule carried only ProvNum,
//         so a row could say no more than "GP - YK". od-chart v5 joins
//         the provider table, and each row now names the dentist, or
//         the hygienist on a hygiene appointment.
//
//   v6  Shows what things cost, and lets a fee be changed for one
//       procedure on one visit.
//
//       od-chart v6 resolves the patient's fee schedule — insurance
//       first, then the patient record, which is where a membership
//       lands — so the screen can name which schedule is pricing this
//       visit rather than leaving it a mystery.
//
//       A crown is billed across two visits, and od-chart halves the
//       fee between them. The ledger therefore shows both lines, and a
//       committed crown reads as two rows rather than one.
//
//       The override sets the fee for this procedure, this patient,
//       this visit. It does not touch a fee schedule; changing what a
//       code costs for everyone stays in OpenDental. It is offered on
//       paired tiles, where the app is already stating a fee, and left
//       off everything else, where OpenDental prices the line and this
//       screen has no business interfering.
//
//       Not done here: a price on each tile before it is tapped. The
//       menu deliberately does not carry the code rule — resolving a
//       code is the server's job — so the browser cannot look a price
//       up. Showing one needs od-chart to send it per tile.
//   v7  Sized for the tablet it actually runs on, and the fee moved to
//       where it is read.
//
//       On a nine-inch tablet the two panels were stacking instead of
//       sitting side by side, so Existing filled the screen and
//       Diagnosed and the ledger were below the fold. The cause was the
//       breakpoint: the panels split at lg, which is 1024px, and the
//       tablet reports about 960. Everything now splits at md, and the
//       whole screen is denser — shorter teeth, smaller tiles, tighter
//       padding — with the roomier sizes kept for a desktop.
//
//       The fee is now edited by tapping it in the ledger. Asking for
//       it before committing was the wrong moment: the number that
//       needs changing is the one already on screen, and by then it
//       belongs to a procedure rather than to a tile. Editing it there
//       also drops the rule that a crown's two halves stay equal —
//       once both lines exist they are two ordinary procedures.
//   v8  The search box takes a first name. Two words are read as last
//       name then first, which matters because surnames repeat: one
//       day's schedule held two Mendozas and two Chavezes. The server
//       does the interpreting, so the rule lives in one place.
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
  treat_area: number | null;
  delivery_code: string | null;
  is_paired: boolean;
  addons: TileAddon[];
};

type TileAddon = {
  id: string;
  label: string;
  proc_code: string;
  default_on: boolean;
};

type FeeSchedule = {
  source: "insurance plan" | "patient record" | "nothing set";
  fee_sched: number;
  fee_sched_name: string;
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

type NavState = {
  category: Category | null;
  pending: Tile | null;
  surfaces: string[];
};

// One row of the day. Shaped by the Edge Function so this file never
// has to know that AptStatus is an integer or that an unset timestamp
// arrives as midnight.
type Appointment = {
  apt_num: number;
  pat_num: number;
  time: string;
  apt_datetime: string;
  duration_minutes: number;
  status: string;
  status_num: number;
  status_verified: boolean;
  openable: boolean;
  presence: "not_arrived" | "checked_in" | "in_chair" | "dismissed";
  operatory_num: number;
  operatory_name: string;
  operatory_abbr: string;
  operatory_hidden: boolean;
  prov_num: number;
  prov_abbr: string;
  prov_name: string;
  prov_hyg: number;
  hyg_abbr: string;
  hyg_name: string;
  is_hygiene: boolean;
  procedures: string;
  last_name: string;
  first_name: string;
  preferred_name: string;
  display_name: string;
};

type OperatoryChip = {
  num: number;
  name: string;
  abbr: string;
  count: number;
};

type PickerTab = "today" | "search";

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
const UPPER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LOWER = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];
const SURFACES = ["M", "O", "D", "B", "L"];

const EXISTING_STATUSES = new Set(["C", "EC", "EO", "Cn"]);

// AptStatus 5. The one status confirmed against live data as a row that
// must not be opened.
const BROKEN = 5;

// Local time, not UTC. toISOString() would roll the schedule to tomorrow
// from mid-afternoon onwards in California.
function localISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftISODate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return localISODate(date);
}

// The office reads and writes MM/DD/YYYY, which is what OpenDental
// shows in its own Select Patient window, so that is what this screen
// shows too. Values arrive from OpenDental as ISO and sometimes carry a
// time; only the date part is wanted.
function usDate(value: string): string {
  const raw = String(value ?? "").trim();
  if (raw === "") return "";

  const datePart = raw.includes("T") ? raw.split("T")[0] : raw.split(" ")[0];
  const iso = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  // Anything that is not the ISO form is passed through untouched
  // rather than mangled — an unrecognised date is better shown as it
  // came than silently rewritten.
  if (!iso) return raw;

  const [, y, m, d] = iso;

  // OpenDental writes 0001-01-01 for "no date". Showing that as
  // 01/01/0001 would look like real data.
  if (y === "0001") return "";

  return `${m}/${d}/${y}`;
}

function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  return `${weekday} ${usDate(iso)}`;
}

function clockLabel(time: string): string {
  const [hRaw, minute] = time.split(":");
  const hour = Number(hRaw);
  if (!Number.isFinite(hour)) return time;
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${minute} ${suffix}`;
}

// Who the patient is actually seeing. On a hygiene appointment that is
// the hygienist, otherwise the dentist. Falls back to initials when a
// provider has no name recorded, and to nothing at all rather than
// printing an empty separator.
function whoIsSeeingThem(appt: Appointment): string {
  if (appt.is_hygiene) {
    const hygienist = appt.hyg_name || appt.hyg_abbr;
    if (hygienist !== "") return `${hygienist} · hygiene`;
    return "hygiene";
  }

  return appt.prov_name || appt.prov_abbr || "";
}

// Whole dollars where the cents are zero, because a fee schedule is
// mostly round numbers and "$1,366" reads faster than "$1,366.00".
function money(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return rounded % 1 === 0
    ? `$${rounded.toLocaleString()}`
    : `$${rounded.toFixed(2)}`;
}

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

// The pill on the right of a schedule row. Broken wins over presence,
// because a broken appointment nobody arrived for is still broken.
function statusPill(appt: Appointment): { label: string; className: string } {
  if (appt.status_num === BROKEN) {
    return {
      label: "Broken",
      className: "border-[#E4674F]/45 bg-[#E4674F]/12 text-[#E4674F]",
    };
  }

  if (appt.presence === "in_chair") {
    return {
      label: "In chair",
      className: "border-[#F0A93B] bg-[#F0A93B] text-[#0B1719]",
    };
  }

  if (appt.presence === "checked_in") {
    return {
      label: "Checked in",
      className: "border-[#79B4C4]/50 bg-[#79B4C4]/15 text-[#79B4C4]",
    };
  }

  if (appt.presence === "dismissed") {
    return {
      label: "Dismissed",
      className: "border-[#2C4E54] bg-transparent text-[#5E7B80]",
    };
  }

  return {
    label: appt.status,
    className: "border-[#2C4E54] bg-transparent text-[#8AA6AB]",
  };
}

// ---------------------------------------------------------------------
export default function ChartPage() {
  const router = useRouter();

  const [offices, setOffices] = useState<Office[]>([]);
  const [officeSlug, setOfficeSlug] = useState("");
  const [booting, setBooting] = useState(true);

  const [pickerTab, setPickerTab] = useState<PickerTab>("today");

  const [scheduleDate, setScheduleDate] = useState(() => localISODate(new Date()));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [operatories, setOperatories] = useState<OperatoryChip[]>([]);
  const [opFilter, setOpFilter] = useState<number | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

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
  const [feeSchedule, setFeeSchedule] = useState<FeeSchedule | null>(null);
  const [provOverride, setProvOverride] = useState<number | null>(null);

  const [tooth, setTooth] = useState<string>("");
  const [nav, setNav] = useState<
    Record<Bucket, NavState>
  >({
    existing: { category: null, pending: null, surfaces: [] },
    diagnosed: { category: null, pending: null, surfaces: [] },
  });

  const [ledger, setLedger] = useState<LedgerEntry[]>([]);

  // Which ledger row has its fee open for editing, and what has been
  // typed so far. Kept as text so a half-entered number does not keep
  // collapsing while the clinician is still typing.
  const [editingFee, setEditingFee] = useState("");
  const [feeDraft, setFeeDraft] = useState("");
  const [savingFee, setSavingFee] = useState(false);
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
  // Today's schedule
  //
  // One call returns the whole day already shaped. The date is always
  // sent explicitly so the server never has to guess the timezone.
  // -------------------------------------------------------------------
  const loadSchedule = useCallback(
    async (date: string) => {
      if (officeSlug === "") return;

      setScheduleLoading(true);
      setScheduleError("");

      try {
        const data = await callChart({ action: "schedule", date });
        setAppointments(data.appointments ?? []);
        setOperatories(data.operatories ?? []);
      } catch (caught) {
        setAppointments([]);
        setOperatories([]);
        setScheduleError(
          caught instanceof Error ? caught.message : "Couldn't load the schedule.",
        );
      } finally {
        setScheduleLoading(false);
      }
    },
    [callChart, officeSlug],
  );

  // Reload whenever the office or the day changes, but only while the
  // picker is actually on screen.
  useEffect(() => {
    if (patient !== null) return;
    if (pickerTab !== "today") return;
    if (officeSlug === "") return;

    setOpFilter(null);
    loadSchedule(scheduleDate);
  }, [officeSlug, scheduleDate, pickerTab, patient, loadSchedule]);

  const visibleAppointments = useMemo(
    () =>
      opFilter === null
        ? appointments
        : appointments.filter((a) => a.operatory_num === opFilter),
    [appointments, opFilter],
  );

  const brokenCount = useMemo(
    () => visibleAppointments.filter((a) => a.status_num === BROKEN).length,
    [visibleAppointments],
  );

  const isToday = scheduleDate === localISODate(new Date());

  // -------------------------------------------------------------------
  // Patient search
  // -------------------------------------------------------------------
  async function runSearch() {
    const q = query.trim();

    // Digits are a patient number and a single one is legitimate, so the
    // two-letter minimum only applies to names. The server does the real
    // interpreting; this is just to avoid a pointless round trip.
    const looksNumeric = /^\d+$/.test(q);

    if (q === "") {
      setSearchError("Type a surname, a date of birth, or a patient number.");
      return;
    }

    if (!looksNumeric && q.length < 2) {
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
        // Saying which reading was used makes a wrong guess obvious:
        // a mistyped date searched as a surname explains itself.
        const by = String(data.searched_by ?? "that");
        setSearchError(`No patients matched by ${by}.`);
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
      setFeeSchedule(data.fee_schedule ?? null);
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
    setFeeSchedule(null);
    setLedger([]);
    setTooth("");
    resetNav();
    if (pickerTab === "search") {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
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

  // What this visit has added up to so far. Only what OpenDental
  // actually returned, so it cannot drift from the account.
  const ledgerTotal = useMemo(
    () =>
      ledger.reduce((sum, e) => {
        const value = e.fee === null ? 0 : Number(e.fee);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0),
    [ledger],
  );

  const toothProcedures = useMemo(
    () => (tooth === "" ? [] : procedures.filter((p) => p.ToothNum === tooth)),
    [procedures, tooth],
  );

  // -------------------------------------------------------------------
  // Panel navigation
  // -------------------------------------------------------------------
  function setBucketNav(bucket: Bucket, patch: Partial<NavState>) {
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

    // Surfaces have to be picked, and a paired tile is worth pausing on
    // because it writes two lines and states a fee. Everything else
    // still commits on one tap.
    if (tile.needs_surfaces || tile.is_paired) {
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

      // A crown writes two lines and an add-on writes another, so one
      // tap can produce several ledger rows. The flat fields are still
      // there for the single-line case.
      const returned = Array.isArray(data.lines) && data.lines.length > 0
        ? (data.lines as Record<string, unknown>[])
        : [{
          role: "base",
          label: tile.label,
          proc_code: data.proc_code ?? "",
          od_id: data.od_id ?? null,
          descript: data.descript ?? "",
          tooth_num: data.tooth_num ?? tooth,
          surf: data.surf ?? "",
          fee: data.fee ?? null,
          prov_abbr: data.prov_abbr ?? "",
          undoable: data.undoable !== false,
        }];

      const stamp = Date.now();

      const entries: LedgerEntry[] = returned.map((line, index) => ({
        key: `${data.entry_kind}-${line.od_id ?? "none"}-${stamp}-${index}`,
        bucket,
        entry_kind: data.entry_kind,
        od_id: typeof line.od_id === "number" ? line.od_id : null,
        label: String(line.label ?? tile.label),
        code: String(line.proc_code ?? ""),
        descript: String(line.descript ?? ""),
        tooth: String(line.tooth_num ?? tooth),
        surf: String(line.surf ?? ""),
        fee: line.fee === null || line.fee === undefined
          ? null
          : String(line.fee),
        provAbbr: String(line.prov_abbr ?? ""),
        removing: false,
        undoable: line.undoable !== false,
      }));

      // Newest first, and the lines of one commit stay in the order
      // they were written so a crown reads prep then delivery.
      setLedger((prev) => [...entries, ...prev]);

      if (data.entry_kind === "tooth_initial") {
        const marked = entries[0]?.tooth ?? tooth;
        setMissingTeeth((prev) =>
          prev.includes(marked) ? prev : [...prev, marked]
        );
      }

      // A line landed and a later one was refused. Nothing is rolled
      // back, so say what is missing rather than looking successful.
      if (data.partial === true) {
        const failed = data.partial_failure as Record<string, unknown> | null;
        setCommitError(
          `${String(failed?.label ?? "A line")} was refused, so it is not in OpenDental. The rest went through.`,
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
  // Fee — changes what is already in OpenDental
  //
  // No halving. A crown's two lines start equal because that is a
  // sensible default, not a rule; once they exist each is an ordinary
  // procedure and can carry whatever the office decides.
  // -------------------------------------------------------------------
  function startEditingFee(entry: LedgerEntry) {
    if (entry.od_id === null) return;
    setEditingFee(entry.key);
    setFeeDraft(entry.fee === null ? "" : String(entry.fee));
    setCommitError("");
  }

  function cancelEditingFee() {
    setEditingFee("");
    setFeeDraft("");
  }

  async function saveFee(entry: LedgerEntry) {
    if (entry.od_id === null) return;

    const typed = feeDraft.trim().replace(/^\$/, "").replace(/,/g, "");

    // Closing the box without changing anything is not an edit.
    if (typed === "" || typed === String(entry.fee)) {
      cancelEditingFee();
      return;
    }

    const value = Number(typed);

    if (!Number.isFinite(value) || value < 0) {
      setCommitError("That fee is not a number.");
      return;
    }

    setSavingFee(true);
    setCommitError("");

    try {
      const data = await callChart({
        action: "set_fee",
        pat_num: patient?.PatNum,
        od_id: entry.od_id,
        fee: value,
      });

      // What OpenDental stored, not what was asked for. It has been
      // seen accepting a value and keeping its own.
      const stored = data.stored_fee ?? null;

      setLedger((prev) =>
        prev.map((e) =>
          e.key === entry.key
            ? { ...e, fee: stored === null ? null : String(stored) }
            : e
        )
      );

      if (data.fee_honoured === false) {
        setCommitError(
          "OpenDental accepted the change but kept its own fee. The number shown is what is stored.",
        );
      }

      cancelEditingFee();
    } catch (caught) {
      setCommitError(
        caught instanceof Error ? caught.message : "Couldn't change that fee.",
      );
    } finally {
      setSavingFee(false);
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

  // ---------- patient picker ----------
  if (patient === null) {
    return (
      <main className="min-h-screen bg-[#0B1719] px-6 py-10 text-[#EDF3F1]">
        <div className="mx-auto w-full max-w-3xl">
          <p className="font-mono text-xs tracking-[0.18em] text-[#F0A93B] uppercase">
            Chairside · Charting
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {pickerTab === "today" ? "Today's schedule" : "Find a patient"}
          </h1>

          {/* Tabs + office */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex overflow-hidden rounded-xl border border-[#2C4E54]">
              {(["today", "search"] as PickerTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setPickerTab(tab)}
                  className={`px-5 py-2.5 text-sm font-semibold transition-colors ${
                    pickerTab === tab
                      ? "bg-[#EDF3F1] text-[#0B1719]"
                      : "bg-[#122326] text-[#8AA6AB] hover:text-[#EDF3F1]"
                  }`}
                >
                  {tab === "today" ? "Today" : "Search"}
                </button>
              ))}
            </div>

            <label htmlFor="office" className="ml-auto text-sm text-[#8AA6AB]">
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

          {loadError !== "" && (
            <p className="mt-4 text-sm text-[#E4674F]">{loadError}</p>
          )}

          {/* ---------------- Today ---------------- */}
          {pickerTab === "today" ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleDate(shiftISODate(scheduleDate, -1))}
                  className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#8AA6AB] hover:text-[#EDF3F1]"
                  aria-label="Previous day"
                >
                  ‹
                </button>

                <span className="min-w-[9rem] text-center text-[15px] font-semibold">
                  {isToday ? "Today" : humanDate(scheduleDate)}
                </span>

                <button
                  type="button"
                  onClick={() => setScheduleDate(shiftISODate(scheduleDate, 1))}
                  className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#8AA6AB] hover:text-[#EDF3F1]"
                  aria-label="Next day"
                >
                  ›
                </button>

                {!isToday && (
                  <button
                    type="button"
                    onClick={() => setScheduleDate(localISODate(new Date()))}
                    className="rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-xs text-[#8AA6AB] hover:text-[#EDF3F1]"
                  >
                    Jump to today
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => loadSchedule(scheduleDate)}
                  disabled={scheduleLoading}
                  className="ml-auto rounded-lg border border-[#2C4E54] bg-[#122326] px-3 py-2 text-sm text-[#8AA6AB] hover:text-[#EDF3F1] disabled:opacity-40"
                  aria-label="Refresh"
                >
                  {scheduleLoading ? "…" : "⟳"}
                </button>
              </div>

              {/* Operatory chips — only the ones carrying appointments */}
              {operatories.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOpFilter(null)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
                      opFilter === null
                        ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                        : "border-[#2C4E54] bg-[#122326] text-[#8AA6AB] hover:text-[#EDF3F1]"
                    }`}
                  >
                    All · {appointments.length}
                  </button>

                  {operatories.map((op) => (
                    <button
                      key={op.num}
                      type="button"
                      onClick={() => setOpFilter(opFilter === op.num ? null : op.num)}
                      title={op.name}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
                        opFilter === op.num
                          ? "border-[#EDF3F1] bg-[#EDF3F1] text-[#0B1719]"
                          : "border-[#2C4E54] bg-[#122326] text-[#8AA6AB] hover:text-[#EDF3F1]"
                      }`}
                    >
                      {op.abbr || op.name || `Op ${op.num}`} · {op.count}
                    </button>
                  ))}
                </div>
              )}

              {scheduleError !== "" && (
                <p className="mt-4 text-sm text-[#E4674F]">{scheduleError}</p>
              )}

              <div className="mt-4 space-y-2">
                {scheduleLoading && appointments.length === 0 && (
                  <p className="py-8 text-center text-sm text-[#8AA6AB]">
                    Loading the day…
                  </p>
                )}

                {!scheduleLoading &&
                  scheduleError === "" &&
                  visibleAppointments.length === 0 && (
                    <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#2C4E54] bg-[#122326] p-10 text-center">
                      <strong className="text-[15px] font-medium">
                        Nothing on the schedule
                      </strong>
                      <span className="max-w-[32ch] text-[13px] text-[#8AA6AB]">
                        No appointments for this day. Try another date, or search
                        by name.
                      </span>
                    </div>
                  )}

                {visibleAppointments.map((appt) => {
                  const pill = statusPill(appt);
                  const name = appt.preferred_name !== ""
                    ? `${appt.last_name}, ${appt.preferred_name}`
                    : appt.display_name;

                  return (
                    <button
                      key={appt.apt_num}
                      type="button"
                      disabled={!appt.openable || loadingPatient}
                      onClick={() => openPatient(appt.pat_num)}
                      className={`flex w-full items-center gap-4 rounded-xl border px-5 py-3.5 text-left transition-colors ${
                        appt.openable
                          ? "border-[#2C4E54] bg-[#122326] hover:bg-[#193034]"
                          : "cursor-not-allowed border-[#2C4E54]/60 bg-[#0F1D20] opacity-55"
                      } ${
                        appt.presence === "in_chair" && appt.status_num !== BROKEN
                          ? "border-[#F0A93B]/60"
                          : ""
                      } disabled:opacity-55`}
                    >
                      <span className="w-[5.5rem] flex-none">
                        <span className="block font-mono text-[15px] font-semibold">
                          {clockLabel(appt.time)}
                        </span>
                        <span className="block font-mono text-[11px] text-[#5E7B80]">
                          {appt.duration_minutes} min
                        </span>
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[17px] font-semibold">
                          {name}
                        </span>
                        <span className="block truncate font-mono text-[11.5px] text-[#8AA6AB]">
                          {appt.operatory_abbr || appt.operatory_name || `Op ${appt.operatory_num}`}
                          {whoIsSeeingThem(appt) !== "" ? ` · ${whoIsSeeingThem(appt)}` : ""}
                          {appt.procedures !== "" ? ` · ${appt.procedures}` : ""}
                        </span>
                      </span>

                      <span
                        className={`flex-none rounded-full border px-3 py-1 text-[11px] font-semibold ${pill.className}`}
                      >
                        {pill.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {visibleAppointments.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#5E7B80]">
                  <span className="font-mono">
                    {visibleAppointments.length}{" "}
                    {visibleAppointments.length === 1 ? "appointment" : "appointments"}
                    {brokenCount > 0 ? ` · ${brokenCount} broken` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickerTab("search")}
                    className="ml-auto text-[#8AA6AB] underline underline-offset-4 hover:text-[#EDF3F1]"
                  >
                    Search by name instead
                  </button>
                </div>
              )}
            </>
          ) : (
            /* ---------------- Search ---------------- */
            <>
              <div className="mt-4 flex gap-3">
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch();
                  }}
                  placeholder="Last name, last and first, date of birth, or patient number"
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

              <p className="mt-2.5 text-[12.5px] text-[#5E7B80]">
                Two words are read as last name then first, so
                &ldquo;Mendoza Juanita&rdquo; narrows to one person. Digits are a
                patient number and 08/08/1982 a date of birth; dashes work too.
              </p>

              {searchError !== "" && (
                <p className="mt-4 text-sm text-[#E4674F]">{searchError}</p>
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
                      {usDate(h.Birthdate) || "—"}
                    </span>
                    <span className="font-mono text-xs text-[#5E7B80]">#{h.ChartNumber}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  // ---------- charting ----------
  const buckets: Bucket[] = ["existing", "diagnosed"];

  return (
    <main className="min-h-screen bg-[#0B1719] px-3 py-3 text-[#EDF3F1] md:px-4 md:py-5">
      <div className="mx-auto w-full max-w-[1400px]">
        {/* Patient bar */}
        <div className="flex flex-wrap items-center gap-4 border-b border-[#2C4E54] pb-3">
          <div>
            <h1 className="text-xl font-semibold">
              {patient.LName}, {patient.Preferred || patient.FName}
            </h1>
            <p className="font-mono text-xs text-[#8AA6AB]">
              #{patient.ChartNumber} · {usDate(patient.Birthdate)}
              {feeSchedule !== null && feeSchedule.fee_sched > 0 && (
                <>
                  {" · "}
                  <span
                    title={`Fees come from this schedule, via the ${feeSchedule.source}. Change it in OpenDental.`}
                  >
                    {feeSchedule.fee_sched_name}
                  </span>
                </>
              )}
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
        <section className="mt-3 rounded-2xl border border-[#2C4E54] bg-[#122326] p-2 md:p-3">
          {[UPPER, LOWER].map((arch, archIndex) => (
            <div
              key={archIndex}
              className={`grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1 md:gap-1.5 ${archIndex === 1 ? "mt-1.5 md:mt-2" : ""}`}
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
                    className={`flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border font-mono text-[11.5px] font-semibold transition-transform active:scale-95 md:h-14 md:gap-1 md:text-[13px] ${
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
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {buckets.map((bucket) => {
            const state = nav[bucket];
            const cats = menu.filter((m) => m.bucket === bucket);
            const accent = bucket === "existing" ? "#79B4C4" : "#F0A93B";
            const deep = state.category !== null;

            return (
              <section
                key={bucket}
                className="flex min-h-[260px] flex-col overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326] md:min-h-[380px]"
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
                  // ---------- confirm: surfaces, and the fee ----------
                  <>
                    {state.pending.needs_surfaces && (
                      <div className="grid grid-cols-5 gap-2 p-3 pb-0">
                        {SURFACES.map((s) => {
                          const on = state.surfaces.includes(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => toggleSurface(bucket, s)}
                              className={`h-[56px] rounded-xl border text-[19px] font-bold transition-transform active:scale-95 md:h-[74px] md:text-[22px] ${
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
                    )}

                    {state.pending.is_paired && (
                      <p className="m-3 mb-0 rounded-xl border border-[#2C4E54] bg-[#0F1D20] p-3 text-[12.5px] leading-snug text-[#8AA6AB]">
                        Two visits: the prep now and{" "}
                        <span className="font-mono text-[#EDF3F1]">
                          {state.pending.delivery_code}
                        </span>{" "}
                        at the seat. The fee is split evenly, and either
                        line can be changed below once it is written.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        commit(bucket, state.pending!, state.surfaces)}
                      disabled={(state.pending.needs_surfaces &&
                        state.surfaces.length === 0) || committing}
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
                  <div className="grid flex-1 grid-cols-2 content-start gap-2 p-2.5 md:gap-2.5 md:p-3">
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
                          className="flex min-h-[68px] flex-col justify-between gap-1 rounded-xl border border-[#2C4E54] bg-[#193034] p-2.5 text-left transition-transform hover:bg-[#204045] active:scale-[0.97] disabled:opacity-50 md:min-h-[92px] md:p-3"
                        >
                          <span className="text-[13px] leading-tight font-semibold md:text-[15px]">
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
                                  : (item as Tile).is_paired
                                    ? "two visits"
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
        <section className="mt-3 overflow-hidden rounded-2xl border border-[#2C4E54] bg-[#122326]">
          <div className="flex items-center gap-3 border-b border-[#2C4E54] px-4 py-3">
            <h2 className="text-[13px] font-bold tracking-[0.06em] uppercase">
              This visit
            </h2>
            <span className="font-mono text-xs text-[#8AA6AB]">
              {ledger.length} {ledger.length === 1 ? "entry" : "entries"}
            </span>
            {ledgerTotal > 0 && (
              <span className="font-mono text-xs text-[#8AA6AB]">
                {money(ledgerTotal)}
              </span>
            )}
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
                  {/* The fee is edited where it is read. A dash means
                      OpenDental has not priced it, which is not the
                      same as a fee of zero. */}
                  {editingFee === e.key ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      value={feeDraft}
                      onChange={(ev) => setFeeDraft(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") saveFee(e);
                        if (ev.key === "Escape") cancelEditingFee();
                      }}
                      onBlur={() => saveFee(e)}
                      disabled={savingFee}
                      className="w-20 flex-none rounded border border-[#F0A93B] bg-[#0F1D20] px-1.5 py-1 text-right font-mono text-[13px] text-[#EDF3F1] focus:outline-none disabled:opacity-50"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditingFee(e)}
                      disabled={e.od_id === null || savingFee}
                      title={e.od_id === null
                        ? "Nothing to change"
                        : "Tap to change this fee in OpenDental"}
                      className="w-16 flex-none rounded px-1 py-1 text-right font-mono text-[13px] text-[#8AA6AB] hover:bg-[#193034] hover:text-[#EDF3F1] disabled:hover:bg-transparent disabled:hover:text-[#8AA6AB]"
                    >
                      {e.fee !== null ? `$${e.fee}` : "—"}
                    </button>
                  )}
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
