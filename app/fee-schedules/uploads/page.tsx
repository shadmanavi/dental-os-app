"use client";

// Uploads list — v4
// Every fee schedule that has been staged, newest first, with a link into
// its review screen. Before this page existed a staged upload was only
// reachable if its URL had been kept.
//
// Changelog:
//   v1  Session guard, office filter, status badges, per-row link to review.
//   v2  Row controls. Drafts can be deleted outright; pushed schedules are
//       archived instead, so fee_push_log keeps its link to them. A
//       "Show archived" toggle brings hidden rows back into view, where
//       they can be restored. Both destructive paths ask first.
//   v3  Table no longer clips its right-hand column. The action links sit in
//       a fixed, non-wrapping column, the table scrolls sideways if the
//       window is narrow, and the filename column is capped so it cannot
//       push the actions off the edge.
//   v4  Moved to /fee-schedules/uploads. Email and sign out moved into the
//       shared TopNav. Links now point at /fee-schedules and
//       /fee-schedules/review/<id>.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Office = {
  id: string;
  name: string;
};

type Upload = {
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
  archived_at: string | null;
};

type Pending = {
  upload: Upload;
  action: "delete" | "archive";
};

const ALL_OFFICES = "__all__";

function when(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: string): string {
  if (status === "pushed") return "Pushed";
  if (status === "draft") return "Awaiting review";
  if (status === "pushing") return "Pushing";
  if (status === "failed") return "Failed";
  return status;
}

function statusClasses(status: string): string {
  if (status === "pushed") return "border-[#C7DED4] bg-[#F3F9F6] text-[#0F6E56]";
  if (status === "failed") return "border-[#E8C4B8] bg-[#FDF6F3] text-[#A4361F]";
  if (status === "pushing") return "border-[#D8D6CF] bg-[#FBFAF8] text-[#5C5C57]";
  return "border-[#D8D6CF] bg-white text-[#5C5C57]";
}

export default function UploadsPage() {
  const router = useRouter();

  const [uploads, setUploads] = useState<Upload[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeFilter, setOfficeFilter] = useState(ALL_OFFICES);
  const [showArchived, setShowArchived] = useState(false);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const supabase = createClient();

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        router.replace("/login");
        return;
      }
      setUserId(sessionData.session.user.id);

      const { data: officeData, error: officeErr } = await supabase
        .from("offices")
        .select("id, name")
        .order("name");

      if (officeErr) {
        setLoadError(officeErr.message);
        return;
      }
      setOffices(officeData ?? []);

      const { data: uploadData, error: uploadErr } = await supabase
        .from("fee_schedules")
        .select(
          "id, name, source_filename, od_fee_sched_num, status, row_count, matched_count, unmatched_count, changed_count, created_at, office_id, archived_at"
        )
        .order("created_at", { ascending: false });

      if (uploadErr) {
        setLoadError(uploadErr.message);
        return;
      }
      setUploads(uploadData ?? []);
    } catch (caught) {
      setLoadError(
        caught instanceof Error ? caught.message : "Couldn't load the uploads."
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const officeName = useCallback(
    (id: string) => offices.find((o) => o.id === id)?.name ?? "—",
    [offices]
  );

  const archivedCount = useMemo(
    () => uploads.filter((u) => u.archived_at !== null).length,
    [uploads]
  );

  const visible = useMemo(() => {
    return uploads.filter((u) => {
      if (!showArchived && u.archived_at !== null) return false;
      if (officeFilter !== ALL_OFFICES && u.office_id !== officeFilter) {
        return false;
      }
      return true;
    });
  }, [uploads, officeFilter, showArchived]);

  // Drafts are removed outright. fee_schedule_items cascades on delete, so a
  // single call clears the rows too.
  async function deleteDraft(upload: Upload) {
    setBusyId(upload.id);
    setLoadError("");

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("fee_schedules")
        .delete()
        .eq("id", upload.id);

      if (error) {
        setLoadError(`Couldn't delete that upload: ${error.message}`);
        return;
      }

      setUploads((prev) => prev.filter((u) => u.id !== upload.id));
    } catch (caught) {
      setLoadError(
        caught instanceof Error ? caught.message : "Couldn't delete that upload."
      );
    } finally {
      setBusyId("");
      setPending(null);
    }
  }

  // Pushed schedules are hidden rather than deleted, so fee_push_log keeps a
  // live link back to what was written.
  async function archive(upload: Upload) {
    setBusyId(upload.id);
    setLoadError("");

    const stamp = new Date().toISOString();

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("fee_schedules")
        .update({ archived_at: stamp, archived_by: userId || null })
        .eq("id", upload.id);

      if (error) {
        setLoadError(`Couldn't archive that upload: ${error.message}`);
        return;
      }

      setUploads((prev) =>
        prev.map((u) => (u.id === upload.id ? { ...u, archived_at: stamp } : u))
      );
    } catch (caught) {
      setLoadError(
        caught instanceof Error ? caught.message : "Couldn't archive that upload."
      );
    } finally {
      setBusyId("");
      setPending(null);
    }
  }

  async function restore(upload: Upload) {
    setBusyId(upload.id);
    setLoadError("");

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("fee_schedules")
        .update({ archived_at: null, archived_by: null })
        .eq("id", upload.id);

      if (error) {
        setLoadError(`Couldn't restore that upload: ${error.message}`);
        return;
      }

      setUploads((prev) =>
        prev.map((u) => (u.id === upload.id ? { ...u, archived_at: null } : u))
      );
    } catch (caught) {
      setLoadError(
        caught instanceof Error ? caught.message : "Couldn't restore that upload."
      );
    } finally {
      setBusyId("");
    }
  }

  function confirmPending() {
    if (pending === null) return;
    if (pending.action === "delete") {
      deleteDraft(pending.upload);
    } else {
      archive(pending.upload);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F6F3] px-6 py-10 text-[#1C1C1A]">
      <div className="mx-auto w-full max-w-5xl">
        <p className="font-mono text-xs tracking-[0.18em] text-[#0F6E56] uppercase">
          Fee schedule · Uploads
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Staged uploads
        </h1>

        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#5C5C57]">
          Every payer file that has been matched against OpenDental. Open one to
          review its rows or to finish a push that hasn&apos;t run yet.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <label htmlFor="office-filter" className="text-sm text-[#5C5C57]">
            Office
          </label>
          <select
            id="office-filter"
            value={officeFilter}
            onChange={(e) => setOfficeFilter(e.target.value)}
            disabled={loading || offices.length === 0}
            className="rounded-lg border border-[#D8D6CF] bg-white px-3 py-2 text-sm text-[#1C1C1A] focus:border-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#F2F1ED] disabled:text-[#9B9A93]"
          >
            <option value={ALL_OFFICES}>All offices</option>
            {offices.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </select>

          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#5C5C57]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={() => setShowArchived((prev) => !prev)}
              className="h-4 w-4 accent-[#0F6E56]"
            />
            Show archived
            {archivedCount > 0 && (
              <span className="font-mono text-xs text-[#A5A49D]">
                ({archivedCount})
              </span>
            )}
          </label>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[#D8D6CF] bg-white px-4 py-2 text-sm font-medium text-[#1C1C1A] hover:border-[#0F6E56] hover:text-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:text-[#A5A49D]"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>

          <Link
            href="/fee-schedules"
            className="ml-auto rounded-lg bg-[#0F6E56] px-5 py-2 text-sm font-medium text-white hover:bg-[#0C5A46] focus:ring-2 focus:ring-[#0F6E56]/30 focus:outline-none"
          >
            Upload a file
          </Link>
        </div>

        {loadError !== "" && (
          <div className="mt-6 rounded-lg border border-[#E8C4B8] bg-[#FDF6F3] px-4 py-3">
            <p className="text-sm text-[#A4361F]">{loadError}</p>
          </div>
        )}

        {pending !== null && (
          <div className="mt-6 rounded-xl border border-[#E8C4B8] bg-[#FDF6F3] px-5 py-4">
            <p className="text-[15px] font-medium text-[#1C1C1A]">
              {pending.action === "delete"
                ? `Delete “${pending.upload.name}” permanently?`
                : `Hide “${pending.upload.name}” from this list?`}
            </p>
            <p className="mt-1 text-sm text-[#5C5C57]">
              {pending.action === "delete"
                ? `All ${pending.upload.row_count.toLocaleString()} staged rows are removed. Nothing in OpenDental changes.`
                : "The audit trail of what was written is kept. You can restore it from “Show archived”."}
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={confirmPending}
                disabled={busyId !== ""}
                className="rounded-lg bg-[#A4361F] px-5 py-2 text-sm font-medium text-white hover:bg-[#8C2D19] focus:ring-2 focus:ring-[#A4361F]/30 focus:outline-none disabled:cursor-not-allowed disabled:bg-[#D8D6CF] disabled:text-[#8F8E87]"
              >
                {busyId !== ""
                  ? "Working…"
                  : pending.action === "delete"
                    ? "Delete"
                    : "Archive"}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={busyId !== ""}
                className="rounded-lg border border-[#D8D6CF] bg-white px-5 py-2 text-sm font-medium text-[#1C1C1A] hover:border-[#0F6E56] hover:text-[#0F6E56] focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:text-[#A5A49D]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 overflow-x-auto rounded-xl border border-[#E3E1DB] bg-white">
          {loading ? (
            <p className="px-6 py-12 text-center text-[15px] text-[#7A7973]">
              Loading staged uploads…
            </p>
          ) : visible.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-[15px] text-[#1C1C1A]">Nothing staged yet.</p>
              <Link
                href="/fee-schedules"
                className="mt-3 inline-block rounded text-sm font-medium text-[#0F6E56] underline underline-offset-2 focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
              >
                Upload a payer CSV
              </Link>
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#EDEBE5] bg-[#FBFAF8]">
                  <th className="px-5 py-3 font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
                    Schedule
                  </th>
                  <th className="hidden px-5 py-3 font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase sm:table-cell">
                    Office
                  </th>
                  <th className="px-5 py-3 text-right font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
                    Rows
                  </th>
                  <th className="px-5 py-3 text-right font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
                    Changes
                  </th>
                  <th className="hidden px-5 py-3 text-right font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase sm:table-cell">
                    Unmatched
                  </th>
                  <th className="px-5 py-3 text-right font-mono text-xs tracking-[0.12em] text-[#7A7973] uppercase">
                    Status
                  </th>
                  <th className="w-px px-4 py-3 text-right font-mono text-xs tracking-[0.12em] whitespace-nowrap text-[#7A7973] uppercase">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((upload) => {
                  const isArchived = upload.archived_at !== null;
                  const isDraft = upload.status !== "pushed";
                  const busy = busyId === upload.id;

                  return (
                    <tr
                      key={upload.id}
                      className={`border-b border-[#F2F1ED] last:border-b-0 hover:bg-[#FBFAF8] ${
                        isArchived ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-5 py-4">
                        <p className="text-[15px] font-medium text-[#1C1C1A]">
                          {upload.name}
                        </p>
                        <p className="mt-0.5 max-w-[220px] truncate font-mono text-xs text-[#7A7973]">
                          {upload.source_filename || "—"}
                        </p>
                        <p className="mt-0.5 text-xs text-[#A5A49D]">
                          {when(upload.created_at)}
                          {isArchived ? " · archived" : ""}
                        </p>
                      </td>
                      <td className="hidden px-5 py-4 text-sm text-[#5C5C57] sm:table-cell">
                        {officeName(upload.office_id)}
                      </td>
                      <td className="px-5 py-4 text-right text-sm text-[#5C5C57]">
                        {upload.row_count.toLocaleString()}
                      </td>
                      <td className="px-5 py-4 text-right text-sm font-medium text-[#1C1C1A]">
                        {upload.changed_count.toLocaleString()}
                      </td>
                      <td className="hidden px-5 py-4 text-right text-sm text-[#5C5C57] sm:table-cell">
                        {upload.unmatched_count.toLocaleString()}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span
                          className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${statusClasses(
                            upload.status
                          )}`}
                        >
                          {statusLabel(upload.status)}
                        </span>
                      </td>
                      <td className="w-px px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-4">
                          <Link
                            href={`/fee-schedules/review/${upload.id}`}
                            className="rounded text-sm font-medium text-[#0F6E56] underline-offset-2 hover:underline focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none"
                          >
                            Open
                          </Link>

                          {isArchived ? (
                            <button
                              type="button"
                              onClick={() => restore(upload)}
                              disabled={busy}
                              className="rounded text-sm font-medium text-[#5C5C57] underline-offset-2 hover:text-[#0F6E56] hover:underline focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:text-[#A5A49D]"
                            >
                              {busy ? "Working…" : "Restore"}
                            </button>
                          ) : isDraft ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPending({ upload, action: "delete" })
                              }
                              disabled={busy}
                              className="rounded text-sm font-medium text-[#A4361F] underline-offset-2 hover:underline focus:ring-2 focus:ring-[#A4361F]/20 focus:outline-none disabled:cursor-not-allowed disabled:text-[#A5A49D]"
                            >
                              Delete
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setPending({ upload, action: "archive" })
                              }
                              disabled={busy}
                              className="rounded text-sm font-medium text-[#5C5C57] underline-offset-2 hover:text-[#1C1C1A] hover:underline focus:ring-2 focus:ring-[#0F6E56]/20 focus:outline-none disabled:cursor-not-allowed disabled:text-[#A5A49D]"
                            >
                              Archive
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!loading && visible.length > 0 && (
          <p className="mt-4 text-sm text-[#7A7973]">
            {visible.length.toLocaleString()}{" "}
            {visible.length === 1 ? "upload" : "uploads"}
            {officeFilter === ALL_OFFICES ? "" : " in this office"}
            {showArchived ? " · including archived" : ""}
          </p>
        )}
      </div>
    </main>
  );
}
