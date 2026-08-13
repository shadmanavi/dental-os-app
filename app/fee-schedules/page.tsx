"use client";

// Fee schedule upload — v8
// Changelog:
//   v1  Office + target schedule dropdowns, CSV drop zone, row count, gated Continue.
//   v2  Added "Create a new schedule" option with a free-text name field.
//   v3  Offices load live from Supabase; session guard; sign-out control.
//   v4  Target fee schedules load live from OpenDental.
//   v5  "Continue to review" now calls fee-schedule-stage (dry_run: false),
//       which matches on CDT code and writes fee_schedules + fee_schedule_items,
//       then navigates to /review/<id>.
//   v6  Sends the target schedule's name alongside its number, so the review
//       screen can identify it by name rather than by internal ID.
//   v7  Header link through to /uploads, so past staged files are reachable
//       without keeping their URL.
//   v8  Moved to /fee-schedules. The page-level header controls (staged
//       uploads link, email, sign out) moved into the shared TopNav, so
//       this file no longer tracks the session email or owns a sign-out.
//       Review navigation now targets /fee-schedules/review/<id>.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Office = {
  id: string;
  name: string;
};

type Schedule = {
  fee_sched_num: number;
  description: string;
  fee_sched_type: string | null;
  is_hidden: boolean;
  is_global: boolean;
};

const CREATE_NEW = "__create_new__";

export default function UploadPage() {
  const router = useRouter();

  const [offices, setOffices] = useState<Office[]>([]);
  const [loadingOffices, setLoadingOffices] = useState(true);
  const [officeError, setOfficeError] = useState("");

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

  const [officeId, setOfficeId] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [newScheduleName, setNewScheduleName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [staging, setStaging] = useState(false);
  const [stageError, setStageError] = useState("");

  // -----------------------------------------------------------------
  // Session + offices
  // -----------------------------------------------------------------
  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const supabase = createClient();

        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          router.replace("/login");
          return;
        }
        const { data, error } = await supabase
          .from("offices")
          .select("id, name")
          .eq("is_active", true)
          .order("name");

        if (!active) return;

        if (error) {
          setOfficeError(error.message);
        } else {
          setOffices(data ?? []);
        }
      } catch (caught) {
        if (active) {
          setOfficeError(
            caught instanceof Error ? caught.message : "Couldn't load offices."
          );
        }
      } finally {
        if (active) setLoadingOffices(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [router]);

  // -----------------------------------------------------------------
  // Fee schedules for the selected office, live from OpenDental
  // -----------------------------------------------------------------
  const loadSchedules = useCallback(async (targetOfficeId: string) => {
    if (targetOfficeId === "") {
      setSchedules([]);
      setScheduleError("");
      return;
    }

    setLoadingSchedules(true);
    setScheduleError("");
    setSchedules([]);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke(
        "od-list-fee-schedules",
        { body: { office_id: targetOfficeId } }
      );

      if (error) {
        setScheduleError("Couldn't reach OpenDental to load fee schedules.");
        return;
      }

      if (!data?.ok) {
        setScheduleError(data?.error ?? "OpenDental didn't return a schedule list.");
        return;
      }

      setSchedules(data.schedules ?? []);
    } catch (caught) {
      setScheduleError(
        caught instanceof Error ? caught.message : "Couldn't load fee schedules."
      );
    } finally {
      setLoadingSchedules(false);
    }
  }, []);

  useEffect(() => {
    loadSchedules(officeId);
  }, [officeId, loadSchedules]);

  const creatingNew = scheduleId === CREATE_NEW;

  const scheduleChosen = creatingNew
    ? newScheduleName.trim() !== ""
    : scheduleId !== "";
  const ready =
    officeId !== "" && scheduleChosen && file !== null && csvText !== "" && !staging;

  function handleOffice(value: string) {
    setOfficeId(value);
    setScheduleId("");
    setNewScheduleName("");
    setStageError("");
  }

  function backToList() {
    setScheduleId("");
    setNewScheduleName("");
    setStageError("");
  }

  function readFile(next: File) {
    setFileError("");
    setStageError("");

    if (!next.name.toLowerCase().endsWith(".csv")) {
      setFile(null);
      setCsvText("");
      setRowCount(null);
      setFileError("That file isn't a CSV. Export the fee schedule as CSV and try again.");
      return;
    }

    setFile(next);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
      setRowCount(Math.max(lines.length - 1, 0));
    };
    reader.onerror = () => {
      setCsvText("");
      setRowCount(null);
      setFileError("Couldn't read that file. Try selecting it again.");
    };
    reader.readAsText(next);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) readFile(dropped);
  }

  function clearFile() {
    setFile(null);
    setCsvText("");
    setRowCount(null);
    setFileError("");
    setStageError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  // -----------------------------------------------------------------
  // Stage the file for review
  // -----------------------------------------------------------------
  async function stageForReview() {
    if (!ready) return;

    setStaging(true);
    setStageError("");

    try {
      const supabase = createClient();

      const chosen = schedules.find(
        (s) => String(s.fee_sched_num) === scheduleId
      );

      const target = creatingNew
        ? { mode: "new", name: newScheduleName.trim() }
        : {
            mode: "existing",
            od_fee_sched_num: Number(scheduleId),
            name: chosen?.description ?? "",
          };

      const { data, error } = await supabase.functions.invoke(
        "fee-schedule-stage",
        {
          body: {
            office_id: officeId,
            csv: csvText,
            source_filename: file?.name ?? "",
            target,
            dry_run: false,
          },
        }
      );

      if (error) {
        setStageError("Couldn't stage the file. The server didn't respond as expected.");
        setStaging(false);
        return;
      }

      if (!data?.ok || !data?.fee_schedule_id) {
        setStageError(data?.error ?? "Staging didn't complete.");
        setStaging(false);
        return;
      }

      router.push(`/fee-schedules/review/${data.fee_schedule_id}`);
    } catch (caught) {
      setStageError(
        caught instanceof Error ? caught.message : "Couldn't stage the file."
      );
      setStaging(false);
    }
  }

  function schedulePlaceholder(): string {
    if (officeId === "") return "Pick an office first";
    if (loadingSchedules) return "Loading from OpenDental…";
    if (scheduleError !== "") return "Couldn't load schedules";
    if (schedules.length === 0) return "No schedules found";
    return "Select a schedule";
  }

  return (
    <main className="min-h-screen bg-[#F7F6F3] px-6 py-10 text-[#1C1C1A]">
      <div className="mx-auto w-full max-w-3xl">
        <p className="font-mono text-xs tracking-[0.18em] text-[#0F6E56] uppercase">
          Fee schedule · Upload
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Upload a payer fee schedule
        </h1>

        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#5C5C57]">
          Pick the office and the schedule you&apos;re updating, then drop in the payer&apos;s CSV.
          Nothing is written to OpenDental until you review and approve the changes.
        </p>

        <div className="mt-10 rounded-xl border border-[#E3E1DB] bg-white p-6 sm:p-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="office"
                className="block text-sm font-medium text-[#1C1C1A]"
              >
                Office
              </label>
              <select
                id="office"
                value={officeId}
                onChange={(e) => handleOffice(e.target.value)}
                disabled={loadingOffices || offices.length === 0 || staging}
                className="mt-2 w-full rounded-lg border border-[#D8D6CF] bg-white px-3 py-2.5 text-[15px] text-[#1C1C1A] focus:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#F2F1ED] disabled:text-[#9B9A93]"
              >
                <option value="">
                  {loadingOffices
                    ? "Loading offices…"
                    : offices.length === 0
                      ? "No offices available"
                      : "Select an office"}
                </option>
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
              {officeError !== "" && (
                <p className="mt-2 text-sm text-[#A4361F]">{officeError}</p>
              )}
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label
                  htmlFor={creatingNew ? "new-schedule" : "schedule"}
                  className="block text-sm font-medium text-[#1C1C1A]"
                >
                  {creatingNew ? "New schedule name" : "Target fee schedule"}
                </label>
                {creatingNew && (
                  <button
                    type="button"
                    onClick={backToList}
                    className="rounded text-sm font-medium text-[#0F6E56] underline-offset-2 hover:underline focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
                  >
                    Use an existing one
                  </button>
                )}
              </div>

              {creatingNew ? (
                <>
                  <input
                    id="new-schedule"
                    type="text"
                    value={newScheduleName}
                    onChange={(e) => setNewScheduleName(e.target.value)}
                    placeholder="e.g. Delta Dental PPO — 2026"
                    autoComplete="off"
                    disabled={staging}
                    className="mt-2 w-full rounded-lg border border-[#D8D6CF] bg-white px-3 py-2.5 text-[15px] text-[#1C1C1A] placeholder:text-[#A5A49D] focus:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:bg-[#F2F1ED]"
                  />
                  <p className="mt-2 text-sm text-[#7A7973]">
                    Created in OpenDental when you approve the push.
                  </p>
                </>
              ) : (
                <>
                  <select
                    id="schedule"
                    value={scheduleId}
                    onChange={(e) => setScheduleId(e.target.value)}
                    disabled={officeId === "" || loadingSchedules || staging}
                    className="mt-2 w-full rounded-lg border border-[#D8D6CF] bg-white px-3 py-2.5 text-[15px] text-[#1C1C1A] focus:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#F2F1ED] disabled:text-[#9B9A93]"
                  >
                    <option value="">{schedulePlaceholder()}</option>
                    {schedules.map((schedule) => (
                      <option
                        key={schedule.fee_sched_num}
                        value={String(schedule.fee_sched_num)}
                      >
                        {schedule.description}
                      </option>
                    ))}
                    {officeId !== "" && !loadingSchedules && (
                      <option value={CREATE_NEW}>+ Create a new schedule</option>
                    )}
                  </select>

                  {scheduleError !== "" && (
                    <p className="mt-2 text-sm text-[#A4361F]">
                      {scheduleError}{" "}
                      <button
                        type="button"
                        onClick={() => loadSchedules(officeId)}
                        className="rounded font-medium underline underline-offset-2 focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
                      >
                        Try again
                      </button>
                    </p>
                  )}

                  {scheduleError === "" &&
                    !loadingSchedules &&
                    schedules.length > 0 && (
                      <p className="mt-2 text-sm text-[#7A7973]">
                        {schedules.length} schedules in OpenDental
                      </p>
                    )}
                </>
              )}
            </div>
          </div>

          <div className="mt-8">
            <span className="block text-sm font-medium text-[#1C1C1A]">
              Payer CSV
            </span>

            {file === null ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`mt-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
                  dragging
                    ? "border-[#0F6E56] bg-[#0F6E56]/5"
                    : "border-[#D8D6CF] bg-[#FBFAF8]"
                }`}
              >
                <p className="text-[15px] text-[#1C1C1A]">Drop the CSV here</p>
                <p className="mt-1 text-sm text-[#7A7973]">or</p>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="mt-3 rounded-lg border border-[#D8D6CF] bg-white px-4 py-2 text-sm font-medium text-[#1C1C1A] hover:border-[#0F6E56] hover:text-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
                >
                  Choose a file
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) readFile(picked);
                  }}
                  className="hidden"
                />
              </div>
            ) : (
              <div className="mt-2 flex items-start justify-between gap-4 rounded-lg border border-[#D8D6CF] bg-[#FBFAF8] px-5 py-4">
                <div>
                  <p className="font-mono text-sm text-[#1C1C1A]">{file.name}</p>
                  <p className="mt-1 text-sm text-[#5C5C57]">
                    {rowCount === null
                      ? "Reading rows…"
                      : `${rowCount.toLocaleString()} rows`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearFile}
                  disabled={staging}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-[#5C5C57] hover:bg-[#EDEBE5] hover:text-[#1C1C1A] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:text-[#A5A49D]"
                >
                  Remove
                </button>
              </div>
            )}

            {fileError !== "" && (
              <p className="mt-3 text-sm text-[#A4361F]">{fileError}</p>
            )}
          </div>

          {stageError !== "" && (
            <div className="mt-6 rounded-lg border border-[#E8C4B8] bg-[#FDF6F3] px-4 py-3">
              <p className="text-sm text-[#A4361F]">{stageError}</p>
            </div>
          )}

          <div className="mt-8 flex flex-col-reverse items-start gap-4 border-t border-[#EDEBE5] pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#7A7973]">
              You&apos;ll review every change before anything is pushed.
            </p>
            <button
              type="button"
              onClick={stageForReview}
              disabled={!ready}
              className="w-full rounded-lg bg-[#0F6E56] px-6 py-2.5 text-[15px] font-medium text-white hover:bg-[#0C5A46] focus:ring-2 focus:ring-[#0F6E56]/30 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#D8D6CF] disabled:text-[#8F8E87] sm:w-auto"
            >
              {staging ? "Matching against OpenDental…" : "Continue to review"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
