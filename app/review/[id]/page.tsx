"use client";

// Fee schedule review — v3
// Reads one staged fee_schedules record and its fee_schedule_items, and
// shows what would change. Row checkboxes toggle include_in_push.
// The push itself is not built yet, so the approve button is inert.
//
// Changelog:
//   v1  Summary counts, filter chips, per-row include toggle.
//   v2  Select-all control in the table header, covering every row in the
//       current filter. Rows arrive unselected; the reviewer opts in.
//   v3  Approve & push is live. Calls fee-schedule-push repeatedly, since
//       OpenDental takes one HTTP call per fee and a large schedule cannot
//       finish in a single invocation. Shows running progress, then a
//       summary of how many fees were added versus updated.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "../../../lib/supabase/client";

type ScheduleRow = {
  id: string;
  name: string;
  source_filename: string | null;
  od_fee_sched_num: number | null;
  status: string;
  row_count: number;
  matched_count: number;
  unmatched_count: number;
  changed_count: number;
  created_at: string;
  office_id: string;
};

type ItemRow = {
  id: string;
  source_row_number: number | null;
  raw_proc_code: string | null;
  raw_description: string | null;
  proc_code: string | null;
  new_fee: number | null;
  current_fee: number | null;
  fee_delta: number | null;
  match_status: string;
  include_in_push: boolean;
  error_message: string | null;
};

type Filter = "changes" | "no_change" | "not_in_opendental" | "all";

function money(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function delta(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "$0";
  const sign = value > 0 ? "+" : "−";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export default function ReviewPage() {
  const router = useRouter();
  const params = useParams();
  const scheduleId = typeof params?.id === "string" ? params.id : "";

  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [officeName, setOfficeName] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>("changes");
  const [savingId, setSavingId] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState("");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    added: number;
    updated: number;
    failed: number;
  } | null>(null);
  const [pushResult, setPushResult] = useState<{
    added: number;
    updated: number;
    failed: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (scheduleId === "") {
      setLoadError("No fee schedule was specified.");
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        router.replace("/login");
        return;
      }

      const { data: scheduleData, error: scheduleErr } = await supabase
        .from("fee_schedules")
        .select(
          "id, name, source_filename, od_fee_sched_num, status, row_count, matched_count, unmatched_count, changed_count, created_at, office_id"
        )
        .eq("id", scheduleId)
        .maybeSingle();

      if (scheduleErr) {
        setLoadError(scheduleErr.message);
        return;
      }
      if (!scheduleData) {
        setLoadError("That staged schedule wasn't found.");
        return;
      }

      setSchedule(scheduleData);

      const { data: officeData } = await supabase
        .from("offices")
        .select("name")
        .eq("id", scheduleData.office_id)
        .maybeSingle();
      setOfficeName(officeData?.name ?? "");

      const all: ItemRow[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: pageData, error: itemsErr } = await supabase
          .from("fee_schedule_items")
          .select(
            "id, source_row_number, raw_proc_code, raw_description, proc_code, new_fee, current_fee, fee_delta, match_status, include_in_push, error_message"
          )
          .eq("fee_schedule_id", scheduleId)
          .order("source_row_number")
          .range(from, from + PAGE - 1);

        if (itemsErr) {
          setLoadError(itemsErr.message);
          return;
        }

        all.push(...(pageData ?? []));
        if (!pageData || pageData.length < PAGE) break;
      }

      setItems(all);
    } catch (caught) {
      setLoadError(
        caught instanceof Error ? caught.message : "Couldn't load this review."
      );
    } finally {
      setLoading(false);
    }
  }, [scheduleId, router]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    let changes = 0;
    let noChange = 0;
    let notInOd = 0;
    let selected = 0;
    let selectedDelta = 0;

    for (const item of items) {
      if (item.match_status === "matched") changes++;
      else if (item.match_status === "no_change") noChange++;
      else notInOd++;

      if (item.include_in_push) {
        selected++;
        if (item.fee_delta !== null) selectedDelta += item.fee_delta;
      }
    }

    return {
      changes,
      noChange,
      notInOd,
      selected,
      selectedDelta: Math.round(selectedDelta * 100) / 100,
    };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "changes") return items.filter((i) => i.match_status === "matched");
    if (filter === "no_change") return items.filter((i) => i.match_status === "no_change");
    return items.filter(
      (i) => i.match_status !== "matched" && i.match_status !== "no_change"
    );
  }, [items, filter]);

  const selectableVisible = useMemo(
    () => visible.filter((i) => i.match_status === "matched").length,
    [visible]
  );

  const allVisibleSelected = useMemo(
    () =>
      selectableVisible > 0 &&
      visible
        .filter((i) => i.match_status === "matched")
        .every((i) => i.include_in_push),
    [visible, selectableVisible]
  );

  async function toggleItem(item: ItemRow) {
    if (item.match_status !== "matched") return;

    const next = !item.include_in_push;
    setSavingId(item.id);
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, include_in_push: next } : i))
    );

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("fee_schedule_items")
        .update({ include_in_push: next })
        .eq("id", item.id);

      if (error) {
        // Put it back if the write failed.
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, include_in_push: !next } : i
          )
        );
        setLoadError(`Couldn't save that change: ${error.message}`);
      }
    } finally {
      setSavingId("");
    }
  }

  // Select or clear every changed row in the current filter, in one write.
  async function toggleAllVisible(next: boolean) {
    const targets = visible.filter((i) => i.match_status === "matched");
    if (targets.length === 0) return;

    const ids = targets.map((i) => i.id);
    const previous = items;

    setBulkSaving(true);
    setItems((prev) =>
      prev.map((i) =>
        ids.includes(i.id) ? { ...i, include_in_push: next } : i
      )
    );

    try {
      const supabase = createClient();
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { error } = await supabase
          .from("fee_schedule_items")
          .update({ include_in_push: next })
          .in("id", ids.slice(i, i + CHUNK));

        if (error) {
          setItems(previous);
          setLoadError(`Couldn't save that change: ${error.message}`);
          return;
        }
      }
    } finally {
      setBulkSaving(false);
    }
  }

  // Push every selected row. OpenDental needs one call per fee, so the
  // Edge Function works through a batch at a time and reports what is
  // left; this keeps calling until nothing remains.
  async function approveAndPush() {
    const total = counts.selected;
    if (total === 0 || pushing) return;

    setPushing(true);
    setPushError("");
    setPushResult(null);
    setProgress({ done: 0, total, added: 0, updated: 0, failed: 0 });

    let added = 0;
    let updated = 0;
    let failed = 0;

    try {
      const supabase = createClient();

      // Generous ceiling on rounds; the loop exits on `finished`.
      for (let round = 0; round < 200; round++) {
        const { data, error } = await supabase.functions.invoke(
          "fee-schedule-push",
          { body: { fee_schedule_id: scheduleId, batch_size: 100 } }
        );

        if (error) {
          setPushError("Lost contact with the server mid-push. Nothing further was sent.");
          break;
        }

        if (!data?.ok) {
          setPushError(data?.error ?? "The push didn't complete.");
          break;
        }

        added += data.added_this_batch ?? 0;
        updated += data.updated_this_batch ?? 0;
        failed = data.total_failed ?? failed;

        setProgress({
          done: (data.total_pushed ?? 0) + (data.total_failed ?? 0),
          total,
          added,
          updated,
          failed,
        });

        if (data.finished) {
          setPushResult({ added, updated, failed });
          break;
        }

        if ((data.batch_processed ?? 0) === 0) {
          // Nothing was claimed and it is not finished: stop rather than spin.
          setPushError("The push stalled with rows still pending.");
          break;
        }
      }
    } catch (caught) {
      setPushError(
        caught instanceof Error ? caught.message : "The push didn't complete."
      );
    } finally {
      setPushing(false);
      await load();
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F7F6F3] px-6 py-14 text-[#1C1C1A]">
        <div className="mx-auto w-full max-w-5xl">
          <p className="text-[15px] text-[#5C5C57]">Loading the staged rows…</p>
        </div>
      </main>
    );
  }

  if (loadError !== "" && schedule === null) {
    return (
      <main className="min-h-screen bg-[#F7F6F3] px-6 py-14 text-[#1C1C1A]">
        <div className="mx-auto w-full max-w-5xl">
          <p className="text-[15px] text-[#A4361F]">{loadError}</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded text-sm font-medium text-[#0F6E56] underline underline-offset-2"
          >
            Back to upload
          </Link>
        </div>
      </main>
    );
  }

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "changes", label: "Changes", count: counts.changes },
    { key: "no_change", label: "No change", count: counts.noChange },
    { key: "not_in_opendental", label: "Not in OpenDental", count: counts.notInOd },
    { key: "all", label: "All rows", count: items.length },
  ];

  return (
    <main className="min-h-screen bg-[#F7F6F3] px-6 py-14 text-[#1C1C1A]">
      <div className="mx-auto w-full max-w-5xl">
        <p className="font-mono text-xs tracking-[0.18em] text-[#0F6E56] uppercase">
          Fee schedule · Review
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {schedule?.name ?? "Staged fee schedule"}
        </h1>
        <p className="mt-2 text-[15px] text-[#5C5C57]">
          {officeName}
          {schedule?.source_filename ? ` · ${schedule.source_filename}` : ""}
          {schedule?.od_fee_sched_num
            ? ` · updating schedule ${schedule.od_fee_sched_num}`
            : " · new schedule"}
        </p>

        {/* Summary */}
        <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#E3E1DB] bg-[#E3E1DB] sm:grid-cols-4">
          <div className="bg-white px-5 py-4">
            <p className="text-2xl font-semibold">{items.length.toLocaleString()}</p>
            <p className="mt-1 font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
              Rows
            </p>
          </div>
          <div className="bg-white px-5 py-4">
            <p className="text-2xl font-semibold text-[#0F6E56]">
              {counts.changes.toLocaleString()}
            </p>
            <p className="mt-1 font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
              Changes
            </p>
          </div>
          <div className="bg-white px-5 py-4">
            <p className="text-2xl font-semibold">{counts.notInOd.toLocaleString()}</p>
            <p className="mt-1 font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
              Not in OpenDental
            </p>
          </div>
          <div className="bg-white px-5 py-4">
            <p className="text-2xl font-semibold">{delta(counts.selectedDelta)}</p>
            <p className="mt-1 font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
              Selected Δ
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-8 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none ${
                filter === tab.key
                  ? "bg-[#0F6E56] text-white"
                  : "border border-[#D8D6CF] bg-white text-[#5C5C57] hover:border-[#0F6E56] hover:text-[#0F6E56]"
              }`}
            >
              {tab.label} · {tab.count.toLocaleString()}
            </button>
          ))}
        </div>

        {loadError !== "" && (
          <p className="mt-4 text-sm text-[#A4361F]">{loadError}</p>
        )}

        {/* Rows */}
        <div className="mt-6 overflow-hidden rounded-xl border border-[#E3E1DB] bg-white">
          {visible.length === 0 ? (
            <p className="px-6 py-12 text-center text-[15px] text-[#7A7973]">
              Nothing in this group.
            </p>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#EDEBE5] bg-[#FBFAF8]">
                  <th className="px-5 py-3 font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
                    Procedure
                  </th>
                  <th className="px-5 py-3 text-right font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
                    Current
                  </th>
                  <th className="px-5 py-3 text-right font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
                    New
                  </th>
                  <th className="px-5 py-3 text-right font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
                    Change
                  </th>
                  <th className="px-5 py-3 text-right font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <span>Push</span>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={() => toggleAllVisible(!allVisibleSelected)}
                        disabled={bulkSaving || selectableVisible === 0}
                        aria-label="Select every row shown"
                        className="h-4 w-4 accent-[#0F6E56]"
                      />
                    </label>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 500).map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-[#F2F1ED] last:border-b-0"
                  >
                    <td className="px-5 py-3">
                      <p className="font-mono text-sm text-[#1C1C1A]">
                        {item.proc_code ?? item.raw_proc_code ?? "—"}
                      </p>
                      <p className="mt-0.5 max-w-md truncate text-sm text-[#5C5C57]">
                        {item.raw_description || "—"}
                      </p>
                      {item.error_message && (
                        <p className="mt-0.5 text-xs text-[#A4361F]">
                          {item.error_message}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-sm text-[#5C5C57]">
                      {money(item.current_fee)}
                    </td>
                    <td className="px-5 py-3 text-right text-sm text-[#1C1C1A]">
                      {money(item.new_fee)}
                    </td>
                    <td
                      className={`px-5 py-3 text-right text-sm ${
                        item.fee_delta && item.fee_delta > 0
                          ? "text-[#0F6E56]"
                          : item.fee_delta && item.fee_delta < 0
                            ? "text-[#A4361F]"
                            : "text-[#7A7973]"
                      }`}
                    >
                      {delta(item.fee_delta)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {item.match_status === "matched" ? (
                        <input
                          type="checkbox"
                          checked={item.include_in_push}
                          onChange={() => toggleItem(item)}
                          disabled={savingId === item.id}
                          aria-label={`Include ${item.proc_code ?? "row"} in the push`}
                          className="h-4 w-4 accent-[#0F6E56]"
                        />
                      ) : (
                        <span className="font-mono text-xs tracking-[0.08em] text-[#A5A49D] uppercase">
                          {item.match_status === "no_change" ? "same" : "skip"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {visible.length > 500 && (
            <p className="border-t border-[#EDEBE5] px-5 py-3 text-sm text-[#7A7973]">
              Showing the first 500 of {visible.length.toLocaleString()} rows.
            </p>
          )}
        </div>

        {/* Push progress and outcome */}
        {progress !== null && pushResult === null && (
          <div className="mt-6 rounded-xl border border-[#E3E1DB] bg-white px-5 py-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-[15px] text-[#1C1C1A]">
                Writing to OpenDental — {progress.done.toLocaleString()} of{" "}
                {progress.total.toLocaleString()}
              </p>
              <p className="font-mono text-xs tracking-[0.08em] text-[#7A7973] uppercase">
                {progress.added} added · {progress.updated} updated
              </p>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#EDEBE5]">
              <div
                className="h-full rounded-full bg-[#0F6E56] transition-all duration-300"
                style={{
                  width: `${
                    progress.total === 0
                      ? 0
                      : Math.min(100, Math.round((progress.done / progress.total) * 100))
                  }%`,
                }}
              />
            </div>
            <p className="mt-3 text-sm text-[#7A7973]">
              Keep this page open until it finishes.
            </p>
          </div>
        )}

        {pushResult !== null && (
          <div className="mt-6 rounded-xl border border-[#C7DED4] bg-[#F3F9F6] px-5 py-4">
            <p className="text-[15px] font-medium text-[#0F6E56]">
              Pushed to OpenDental
            </p>
            <p className="mt-1 text-sm text-[#3F5E53]">
              {pushResult.added.toLocaleString()} fees added ·{" "}
              {pushResult.updated.toLocaleString()} updated
              {pushResult.failed > 0
                ? ` · ${pushResult.failed.toLocaleString()} failed`
                : ""}
            </p>
          </div>
        )}

        {pushError !== "" && (
          <div className="mt-6 rounded-xl border border-[#E8C4B8] bg-[#FDF6F3] px-5 py-4">
            <p className="text-sm text-[#A4361F]">{pushError}</p>
            <p className="mt-1 text-sm text-[#7A7973]">
              Rows already written are marked pushed. Pressing the button again
              picks up where it stopped.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 flex flex-col-reverse items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="rounded text-sm font-medium text-[#0F6E56] underline underline-offset-2 focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
          >
            Upload a different file
          </Link>

          <div className="flex items-center gap-4">
            <p className="text-sm text-[#7A7973]">
              {counts.selected.toLocaleString()} of {counts.changes.toLocaleString()} selected
            </p>
            <button
              type="button"
              onClick={approveAndPush}
              disabled={pushing || counts.selected === 0 || schedule?.status === "pushed"}
              className="rounded-lg bg-[#0F6E56] px-6 py-2.5 text-[15px] font-medium text-white hover:bg-[#0C5A46] focus:ring-2 focus:ring-[#0F6E56]/30 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#D8D6CF] disabled:text-[#8F8E87]"
            >
              {pushing
                ? "Writing to OpenDental…"
                : schedule?.status === "pushed"
                  ? "Already pushed"
                  : "Approve & push"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
