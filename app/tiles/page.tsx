"use client";

// Tile management — v1
// The admin screen behind the chairside charting tiles. Everything the
// clinician taps at the chair is defined here.
//
// Why this screen exists
//   A tile decides which procedure code lands in OpenDental. That
//   decision used to live in a migration, which meant every change to
//   what Greenwood offers needed a developer. It belongs to whoever
//   knows the dentistry.
//
// What a tile can be
//   Direct   one fixed code.
//   Rule     a code chosen at the chair from what the clinician picked.
//            Composite splits by tooth position and surface count; a
//            root canal splits by where the tooth sits in the arch. The
//            admin never writes logic — they pick a rule shape and fill
//            in the codes for each branch.
//   Paired   two visits, two codes. A crown prep is billed at the first
//            visit and the seat at the second, so the tile carries a
//            delivery code and writes both lines at diagnosis.
//   Add-ons  extras that ride on the tile and arrive already checked.
//            The clinician removes rather than adds, which is how the
//            conversation with the patient actually goes.
//
// Design notes
//   - Reads and writes go straight to Supabase. Row level security
//     already restricts writing to an organization admin, so there is
//     no Edge Function in the middle repeating that check.
//   - The tree belongs to the organization. Which offices offer a tile
//     is a property of the tile, not a reason to keep two trees.
//   - Codes are picked from the synced OpenDental list rather than
//     typed. A typo here would be discovered at the chair.
//   - Ordering is up and down buttons, not dragging. This screen is
//     used occasionally and correctness matters more than flourish.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type Office = { id: string; name: string; slug: string; organization_id: string };

type ProcCode = {
  proc_code: string;
  description: string;
  abbr_desc: string;
  treat_area: string;
};

type Addon = {
  id: string;
  tile_id: string;
  label: string;
  proc_code: string;
  is_default_on: boolean;
  sort_order: number;
  is_active: boolean;
};

type Tile = {
  id: string;
  category_id: string;
  label: string;
  entry_kind: "procedure" | "tooth_initial";
  initial_type: string | null;
  needs_surfaces: boolean;
  treat_area: number | null;
  delivery_code: string | null;
  delivery_posts_at_zero: boolean;
  code_rule: CodeRule | null;
  notes: string | null;
  sort_order: number;
  is_active: boolean;
  office_ids: string[];
  addons: Addon[];
};

type Category = {
  id: string;
  bucket: "existing" | "diagnosed";
  label: string;
  sort_order: number;
  is_active: boolean;
  tiles: Tile[];
};

type CodeRule =
  | { type: "fixed"; code: string }
  | { type: "surface_count"; all?: string[]; anterior?: string[]; posterior?: string[] }
  | { type: "tooth_class"; anterior?: string; bicuspid?: string; molar?: string };

type RuleType = "fixed" | "surface_count" | "tooth_class";

type Bucket = "existing" | "diagnosed";

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

// OpenDental's own classification, carried through rather than
// reinvented. It decides what the chairside screen asks for before it
// will let a tile commit.
const TREAT_AREAS: { value: number; label: string; hint: string }[] = [
  { value: 0, label: "Whole mouth", hint: "No tooth needed" },
  { value: 1, label: "Surface", hint: "Tooth and surfaces" },
  { value: 2, label: "Tooth", hint: "Tooth only" },
  { value: 3, label: "Mouth", hint: "No tooth needed" },
  { value: 4, label: "Quadrant", hint: "Quadrant only" },
  { value: 5, label: "Sextant", hint: "Sextant only" },
  { value: 6, label: "Arch", hint: "Arch only" },
  { value: 7, label: "Tooth range", hint: "A span of teeth" },
];

const RULE_TYPES: { value: RuleType; label: string; blurb: string }[] = [
  {
    value: "fixed",
    label: "One code",
    blurb: "Always writes the same code.",
  },
  {
    value: "surface_count",
    label: "By surface count",
    blurb: "The code depends on how many surfaces are picked, and on whether the tooth is anterior or posterior.",
  },
  {
    value: "tooth_class",
    label: "By tooth position",
    blurb: "The code depends on whether the tooth is anterior, a bicuspid, or a molar.",
  },
];

const SURFACE_LABELS = ["1 surface", "2 surfaces", "3 surfaces", "4 or more"];

function ruleTypeOf(rule: CodeRule | null): RuleType {
  if (rule === null) return "fixed";
  if (rule.type === "surface_count") return "surface_count";
  if (rule.type === "tooth_class") return "tooth_class";
  return "fixed";
}

function blankRule(type: RuleType): CodeRule {
  if (type === "surface_count") {
    return { type: "surface_count", anterior: ["", "", "", ""], posterior: ["", "", "", ""] };
  }
  if (type === "tooth_class") {
    return { type: "tooth_class", anterior: "", bicuspid: "", molar: "" };
  }
  return { type: "fixed", code: "" };
}

// A rule with blanks in it would resolve to nothing at the chair, so
// the screen says which branch is empty rather than saving it quietly.
function describeRuleGap(rule: CodeRule | null): string {
  if (rule === null) return "No code set.";

  if (rule.type === "fixed") {
    return rule.code.trim() === "" ? "No code set." : "";
  }

  if (rule.type === "tooth_class") {
    const missing: string[] = [];
    if (!rule.anterior?.trim()) missing.push("anterior");
    if (!rule.bicuspid?.trim()) missing.push("bicuspid");
    if (!rule.molar?.trim()) missing.push("molar");
    return missing.length > 0 ? `Missing: ${missing.join(", ")}.` : "";
  }

  const series = rule.all ?? null;
  if (series !== null) {
    const gaps = series.filter((c) => !c?.trim()).length;
    return gaps > 0 ? `${gaps} surface count${gaps === 1 ? "" : "s"} unset.` : "";
  }

  const ant = (rule.anterior ?? []).filter((c) => !c?.trim()).length;
  const post = (rule.posterior ?? []).filter((c) => !c?.trim()).length;
  const parts: string[] = [];
  if (ant > 0) parts.push(`${ant} anterior`);
  if (post > 0) parts.push(`${post} posterior`);
  return parts.length > 0 ? `Unset: ${parts.join(", ")}.` : "";
}

// Greenwood has two locations today, but a tenant can have many, so the
// summary has to survive more than two. Names up to three, because a
// name is what someone recognises; a count past that, because a row of
// eight names is unreadable.
function summariseLocations(officeIds: string[], offices: Office[]): string {
  if (offices.length === 0) return "";
  if (officeIds.length === 0) return "no location";
  if (officeIds.length === offices.length) {
    return offices.length === 1 ? offices[0].name : "all locations";
  }

  const names = offices
    .filter((o) => officeIds.includes(o.id))
    .map((o) => o.name);

  if (names.length <= 3) return names.join(", ");
  return `${names.length} of ${offices.length} locations`;
}

function summariseRule(tile: Tile): string {
  if (tile.entry_kind === "tooth_initial") {
    return `marks tooth ${tile.initial_type ?? ""}`.trim();
  }

  const rule = tile.code_rule;
  if (rule === null) return "no code";

  if (rule.type === "fixed") return rule.code || "no code";
  if (rule.type === "tooth_class") return "by tooth position";
  return "by surface count";
}

// ---------------------------------------------------------------------
export default function TilesPage() {
  const router = useRouter();

  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const [offices, setOffices] = useState<Office[]>([]);
  const [orgId, setOrgId] = useState("");
  const [codes, setCodes] = useState<ProcCode[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [bucket, setBucket] = useState<Bucket>("diagnosed");
  const [categoryId, setCategoryId] = useState("");
  const [tileId, setTileId] = useState("");

  // The tile being edited, held apart from the loaded list so an
  // abandoned edit changes nothing.
  const [draft, setDraft] = useState<Tile | null>(null);
  const [dirty, setDirty] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  // -------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------
  const loadTree = useCallback(
    async (organizationId: string) => {
      const { data, error: treeError } = await supabase
        .from("chart_categories")
        .select(
          "id, bucket, label, sort_order, is_active, " +
            "chart_tiles (id, category_id, label, entry_kind, initial_type, " +
            "needs_surfaces, treat_area, delivery_code, delivery_posts_at_zero, " +
            "code_rule, notes, sort_order, is_active, " +
            "chart_tile_offices (office_id), " +
            "chart_tile_addons (id, tile_id, label, proc_code, is_default_on, sort_order, is_active))",
        )
        .eq("organization_id", organizationId)
        .order("sort_order");

      if (treeError) throw new Error(treeError.message);

      const rows = (data ?? []) as unknown as Record<string, unknown>[];

      const shaped: Category[] = rows.map((c) => ({
        id: String(c.id),
        bucket: String(c.bucket) as Bucket,
        label: String(c.label),
        sort_order: Number(c.sort_order ?? 0),
        is_active: c.is_active !== false,
        tiles: ((c.chart_tiles ?? []) as Record<string, unknown>[])
          .map((t) => ({
            id: String(t.id),
            category_id: String(t.category_id),
            label: String(t.label),
            entry_kind: (String(t.entry_kind) === "tooth_initial"
              ? "tooth_initial"
              : "procedure") as "procedure" | "tooth_initial",
            initial_type: t.initial_type === null || t.initial_type === undefined
              ? null
              : String(t.initial_type),
            needs_surfaces: t.needs_surfaces === true,
            treat_area: t.treat_area === null || t.treat_area === undefined
              ? null
              : Number(t.treat_area),
            delivery_code: t.delivery_code === null || t.delivery_code === undefined
              ? null
              : String(t.delivery_code),
            delivery_posts_at_zero: t.delivery_posts_at_zero !== false,
            code_rule: (t.code_rule ?? null) as CodeRule | null,
            notes: t.notes === null || t.notes === undefined ? null : String(t.notes),
            sort_order: Number(t.sort_order ?? 0),
            is_active: t.is_active !== false,
            office_ids: ((t.chart_tile_offices ?? []) as Record<string, unknown>[])
              .map((r) => String(r.office_id)),
            addons: ((t.chart_tile_addons ?? []) as Record<string, unknown>[])
              .map((a) => ({
                id: String(a.id),
                tile_id: String(a.tile_id),
                label: String(a.label),
                proc_code: String(a.proc_code),
                is_default_on: a.is_default_on === true,
                sort_order: Number(a.sort_order ?? 0),
                is_active: a.is_active !== false,
              }))
              .sort((a, b) => a.sort_order - b.sort_order),
          }))
          .sort((a, b) => a.sort_order - b.sort_order),
      }));

      setCategories(shaped);
      return shaped;
    },
    [supabase],
  );

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) {
          router.replace("/login");
          return;
        }

        const { data: officeRows, error: officeError } = await supabase
          .from("offices")
          .select("id, name, slug, organization_id")
          .eq("is_active", true)
          .order("name");

        if (officeError) throw new Error(officeError.message);
        if (!active) return;

        const offs = (officeRows ?? []) as Office[];
        setOffices(offs);

        if (offs.length === 0) {
          setError("No offices are visible to this account.");
          return;
        }

        const organizationId = offs[0].organization_id;
        setOrgId(organizationId);

        // The picker list. Codes are synced per office and only Downey
        // has been synced so far, so this is deduplicated by code rather
        // than assuming one office's list is the whole story.
        const { data: codeRows, error: codeError } = await supabase
          .from("procedure_codes_cache")
          .select("proc_code, description, abbr_desc, treat_area")
          .order("proc_code");

        if (codeError) throw new Error(codeError.message);

        const seen = new Set<string>();
        const uniqueCodes: ProcCode[] = [];
        for (const row of (codeRows ?? []) as ProcCode[]) {
          if (seen.has(row.proc_code)) continue;
          seen.add(row.proc_code);
          uniqueCodes.push(row);
        }
        if (active) setCodes(uniqueCodes);

        await loadTree(organizationId);
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Couldn't load the tiles.");
        }
      } finally {
        if (active) setBooting(false);
      }
    }

    boot();
    return () => {
      active = false;
    };
  }, [router, supabase, loadTree]);

  // -------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------
  const visibleCategories = useMemo(
    () => categories.filter((c) => c.bucket === bucket),
    [categories, bucket],
  );

  const category = useMemo(
    () => visibleCategories.find((c) => c.id === categoryId) ?? visibleCategories[0] ?? null,
    [visibleCategories, categoryId],
  );

  const tiles = category?.tiles ?? [];

  useEffect(() => {
    // Keep the selection pointing at something that still exists.
    if (category !== null && category.id !== categoryId) setCategoryId(category.id);
  }, [category, categoryId]);

  function openTile(tile: Tile) {
    setTileId(tile.id);
    setDraft(JSON.parse(JSON.stringify(tile)) as Tile);
    setDirty(false);
    setNotice("");
    setError("");
  }

  function closeEditor() {
    setTileId("");
    setDraft(null);
    setDirty(false);
  }

  function patchDraft(patch: Partial<Tile>) {
    setDraft((prev) => (prev === null ? prev : { ...prev, ...patch }));
    setDirty(true);
  }

  // -------------------------------------------------------------------
  // Writes
  //
  // Every one of these reloads the tree afterwards rather than patching
  // local state. A management screen is used rarely; being certain the
  // screen shows what the database holds is worth the extra read.
  // -------------------------------------------------------------------
  async function run(what: string, work: () => Promise<void>) {
    setSaving(true);
    setError("");
    setNotice("");

    try {
      await work();
      if (orgId !== "") await loadTree(orgId);
      setNotice(what);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function addCategory() {
    const label = window.prompt("New category name")?.trim() ?? "";
    if (label === "") return;

    const nextSort = visibleCategories.length === 0
      ? 10
      : Math.max(...visibleCategories.map((c) => c.sort_order)) + 10;

    await run(`Added ${label}.`, async () => {
      const { error: insertError } = await supabase.from("chart_categories").insert({
        organization_id: orgId,
        bucket,
        label,
        sort_order: nextSort,
      });
      if (insertError) throw new Error(insertError.message);
    });
  }

  async function renameCategory(target: Category) {
    const label = window.prompt("Category name", target.label)?.trim() ?? "";
    if (label === "" || label === target.label) return;

    await run(`Renamed to ${label}.`, async () => {
      const { error: updateError } = await supabase
        .from("chart_categories")
        .update({ label })
        .eq("id", target.id);
      if (updateError) throw new Error(updateError.message);
    });
  }

  async function deleteCategory(target: Category) {
    const count = target.tiles.length;
    const warning = count === 0
      ? `Delete ${target.label}?`
      : `Delete ${target.label} and its ${count} tile${count === 1 ? "" : "s"}? This cannot be undone.`;

    if (!window.confirm(warning)) return;

    await run(`Deleted ${target.label}.`, async () => {
      const { error: deleteError } = await supabase
        .from("chart_categories")
        .delete()
        .eq("id", target.id);
      if (deleteError) throw new Error(deleteError.message);
      closeEditor();
    });
  }

  // Ordering swaps two sort values rather than renumbering everything,
  // so two people reordering at once cannot silently reshuffle the list.
  async function moveCategory(target: Category, direction: -1 | 1) {
    const ordered = [...visibleCategories].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((c) => c.id === target.id);
    const swapWith = ordered[index + direction];
    if (!swapWith) return;

    await run("Reordered.", async () => {
      const a = await supabase
        .from("chart_categories")
        .update({ sort_order: swapWith.sort_order })
        .eq("id", target.id);
      if (a.error) throw new Error(a.error.message);

      const b = await supabase
        .from("chart_categories")
        .update({ sort_order: target.sort_order })
        .eq("id", swapWith.id);
      if (b.error) throw new Error(b.error.message);
    });
  }

  async function addTile() {
    if (category === null) return;

    const label = window.prompt("New tile name")?.trim() ?? "";
    if (label === "") return;

    const nextSort = tiles.length === 0
      ? 10
      : Math.max(...tiles.map((t) => t.sort_order)) + 10;

    await run(`Added ${label}.`, async () => {
      const { data, error: insertError } = await supabase
        .from("chart_tiles")
        .insert({
          category_id: category.id,
          label,
          entry_kind: "procedure",
          needs_surfaces: false,
          code_rule: { type: "fixed", code: "" },
          sort_order: nextSort,
        })
        .select("id")
        .single();

      if (insertError) throw new Error(insertError.message);

      // A new tile is available nowhere until someone says so. Starting
      // it switched off everywhere would mean it silently never appears;
      // starting it on at every office would put an unfinished tile in
      // front of a clinician. Every office, but inactive, is the honest
      // middle: visible in this screen, not yet at the chair.
      const tileRow = data as { id: string };

      const { error: availError } = await supabase
        .from("chart_tile_offices")
        .insert(offices.map((o) => ({ tile_id: tileRow.id, office_id: o.id })));
      if (availError) throw new Error(availError.message);

      const { error: offError } = await supabase
        .from("chart_tiles")
        .update({ is_active: false })
        .eq("id", tileRow.id);
      if (offError) throw new Error(offError.message);
    });
  }

  async function moveTile(target: Tile, direction: -1 | 1) {
    const ordered = [...tiles].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((t) => t.id === target.id);
    const swapWith = ordered[index + direction];
    if (!swapWith) return;

    await run("Reordered.", async () => {
      const a = await supabase
        .from("chart_tiles")
        .update({ sort_order: swapWith.sort_order })
        .eq("id", target.id);
      if (a.error) throw new Error(a.error.message);

      const b = await supabase
        .from("chart_tiles")
        .update({ sort_order: target.sort_order })
        .eq("id", swapWith.id);
      if (b.error) throw new Error(b.error.message);
    });
  }

  async function deleteTile(target: Tile) {
    if (!window.confirm(`Delete ${target.label}? This cannot be undone.`)) return;

    await run(`Deleted ${target.label}.`, async () => {
      const { error: deleteError } = await supabase
        .from("chart_tiles")
        .delete()
        .eq("id", target.id);
      if (deleteError) throw new Error(deleteError.message);
      closeEditor();
    });
  }

  async function saveDraft() {
    if (draft === null) return;

    if (draft.label.trim() === "") {
      setError("A tile needs a name.");
      return;
    }

    if (draft.entry_kind === "tooth_initial" && (draft.initial_type ?? "").trim() === "") {
      setError("A tooth mark needs an initial type, such as Missing.");
      return;
    }

    if (draft.is_active && draft.office_ids.length === 0) {
      setError("An active tile has to be offered at at least one location.");
      return;
    }

    // A rule with an empty branch resolves to nothing at the chair. It
    // can be saved while it is being worked on, but not switched on.
    const gap = draft.entry_kind === "procedure"
      ? describeRuleGap(draft.code_rule)
      : "";

    if (draft.is_active && gap !== "") {
      setError(`${gap} Fill it in, or leave the tile inactive for now.`);
      return;
    }

    const before = tiles.find((t) => t.id === draft.id) ?? null;

    await run(`Saved ${draft.label}.`, async () => {
      const { error: updateError } = await supabase
        .from("chart_tiles")
        .update({
          label: draft.label.trim(),
          entry_kind: draft.entry_kind,
          initial_type: draft.entry_kind === "tooth_initial"
            ? (draft.initial_type ?? "").trim()
            : null,
          needs_surfaces: draft.needs_surfaces,
          treat_area: draft.treat_area,
          delivery_code: draft.entry_kind === "procedure" &&
              (draft.delivery_code ?? "").trim() !== ""
            ? (draft.delivery_code ?? "").trim()
            : null,
          delivery_posts_at_zero: draft.delivery_posts_at_zero,
          code_rule: draft.entry_kind === "procedure" ? draft.code_rule : null,
          notes: (draft.notes ?? "").trim() === "" ? null : (draft.notes ?? "").trim(),
          is_active: draft.is_active,
        })
        .eq("id", draft.id);

      if (updateError) throw new Error(updateError.message);

      // Availability is a set, so only the difference is written.
      const had = new Set(before?.office_ids ?? []);
      const wants = new Set(draft.office_ids);

      const toAdd = [...wants].filter((id) => !had.has(id));
      const toRemove = [...had].filter((id) => !wants.has(id));

      if (toAdd.length > 0) {
        const { error: addError } = await supabase
          .from("chart_tile_offices")
          .insert(toAdd.map((officeIdValue) => ({
            tile_id: draft.id,
            office_id: officeIdValue,
          })));
        if (addError) throw new Error(addError.message);
      }

      for (const officeIdValue of toRemove) {
        const { error: removeError } = await supabase
          .from("chart_tile_offices")
          .delete()
          .eq("tile_id", draft.id)
          .eq("office_id", officeIdValue);
        if (removeError) throw new Error(removeError.message);
      }

      setDirty(false);
    });
  }

  async function addAddon() {
    if (draft === null) return;

    const label = window.prompt("Add-on name, for example Porcelain margins")?.trim() ?? "";
    if (label === "") return;

    const nextSort = draft.addons.length === 0
      ? 10
      : Math.max(...draft.addons.map((a) => a.sort_order)) + 10;

    await run(`Added ${label}.`, async () => {
      const { error: insertError } = await supabase.from("chart_tile_addons").insert({
        tile_id: draft.id,
        label,
        proc_code: "",
        is_default_on: true,
        sort_order: nextSort,
      });
      if (insertError) throw new Error(insertError.message);
    });

    // The reload replaced the tile, so reopen it to pick the add-on up.
    const refreshed = categories
      .flatMap((c) => c.tiles)
      .find((t) => t.id === draft.id);
    if (refreshed) openTile(refreshed);
  }

  async function saveAddon(addon: Addon, patch: Partial<Addon>) {
    await run("Saved.", async () => {
      const { error: updateError } = await supabase
        .from("chart_tile_addons")
        .update(patch)
        .eq("id", addon.id);
      if (updateError) throw new Error(updateError.message);
    });
  }

  async function deleteAddon(addon: Addon) {
    if (!window.confirm(`Remove ${addon.label}?`)) return;

    await run(`Removed ${addon.label}.`, async () => {
      const { error: deleteError } = await supabase
        .from("chart_tile_addons")
        .delete()
        .eq("id", addon.id);
      if (deleteError) throw new Error(deleteError.message);
    });
  }

  // Keep the open editor pointed at the reloaded row after any write.
  useEffect(() => {
    if (tileId === "") return;
    if (dirty) return;

    const fresh = categories.flatMap((c) => c.tiles).find((t) => t.id === tileId);
    if (fresh) setDraft(JSON.parse(JSON.stringify(fresh)) as Tile);
  }, [categories, tileId, dirty]);

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  if (booting) {
    return (
      <main className="min-h-screen bg-[#0B1719] px-6 py-10 text-[#EDF3F1]">
        <p className="text-[15px] text-[#8AA6AB]">Loading the tiles…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B1719] px-6 py-8 text-[#EDF3F1]">
      <div className="mx-auto w-full max-w-[1500px]">
        {/* Header */}
        <div className="flex flex-wrap items-end gap-4 border-b border-[#2C4E54] pb-4">
          <div>
            <p className="font-mono text-xs tracking-[0.18em] text-[#F0A93B] uppercase">
              Admin · Chairside tiles
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Tile management
            </h1>
          </div>

          <div className="ml-auto flex overflow-hidden rounded-xl border border-[#2C4E54]">
            {(["existing", "diagnosed"] as Bucket[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => {
                  setBucket(b);
                  setCategoryId("");
                  closeEditor();
                }}
                className={`px-5 py-2.5 text-sm font-semibold transition-colors ${
                  bucket === b
                    ? "bg-[#EDF3F1] text-[#0B1719]"
                    : "bg-[#122326] text-[#8AA6AB] hover:text-[#EDF3F1]"
                }`}
              >
                {b === "existing" ? "Existing" : "Diagnosed"}
              </button>
            ))}
          </div>
        </div>

        {error !== "" && (
          <div className="mt-4 rounded-lg border border-[#E4674F]/50 bg-[#E4674F]/10 px-4 py-3">
            <p className="text-sm text-[#E4674F]">{error}</p>
          </div>
        )}

        {notice !== "" && error === "" && (
          <div className="mt-4 rounded-lg border border-[#79B4C4]/40 bg-[#79B4C4]/10 px-4 py-2.5">
            <p className="text-sm text-[#79B4C4]">{notice}</p>
          </div>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_340px_minmax(0,1fr)]">
          {/* ---------------- Categories ---------------- */}
          <section className="rounded-2xl border border-[#2C4E54] bg-[#122326]">
            <div className="flex items-center gap-2 border-b border-[#2C4E54] px-4 py-3">
              <h2 className="text-[13px] font-bold tracking-[0.06em] uppercase">
                Categories
              </h2>
              <button
                type="button"
                onClick={addCategory}
                disabled={saving}
                className="ml-auto rounded-lg border border-[#2C4E54] px-2.5 py-1 text-xs text-[#8AA6AB] hover:text-[#EDF3F1] disabled:opacity-40"
              >
                + New
              </button>
            </div>

            <div className="p-2">
              {visibleCategories.length === 0 && (
                <p className="p-4 text-[13px] text-[#8AA6AB]">
                  No categories in this bucket yet.
                </p>
              )}

              {visibleCategories.map((c, index) => {
                const selected = category?.id === c.id;
                return (
                  <div
                    key={c.id}
                    className={`mb-1 rounded-xl border px-3 py-2.5 ${
                      selected
                        ? "border-[#F0A93B]/60 bg-[#193034]"
                        : "border-transparent hover:bg-[#193034]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryId(c.id);
                        closeEditor();
                      }}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <span className="flex-1 truncate text-[14px] font-semibold">
                        {c.label}
                      </span>
                      <span className="font-mono text-[11px] text-[#8AA6AB]">
                        {c.tiles.length}
                      </span>
                    </button>

                    {selected && (
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveCategory(c, -1)}
                          disabled={saving || index === 0}
                          className="rounded border border-[#2C4E54] px-2 py-0.5 text-xs text-[#8AA6AB] hover:text-[#EDF3F1] disabled:opacity-30"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCategory(c, 1)}
                          disabled={saving || index === visibleCategories.length - 1}
                          className="rounded border border-[#2C4E54] px-2 py-0.5 text-xs text-[#8AA6AB] hover:text-[#EDF3F1] disabled:opacity-30"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => renameCategory(c)}
                          disabled={saving}
                          className="rounded border border-[#2C4E54] px-2 py-0.5 text-xs text-[#8AA6AB] hover:text-[#EDF3F1] disabled:opacity-40"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCategory(c)}
                          disabled={saving}
                          className="ml-auto rounded border border-[#2C4E54] px-2 py-0.5 text-xs text-[#8AA6AB] hover:border-[#E4674F]/50 hover:text-[#E4674F] disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------------- Tiles ---------------- */}
          <section className="rounded-2xl border border-[#2C4E54] bg-[#122326]">
            <div className="flex items-center gap-2 border-b border-[#2C4E54] px-4 py-3">
              <h2 className="truncate text-[13px] font-bold tracking-[0.06em] uppercase">
                {category?.label ?? "Tiles"}
              </h2>
              <button
                type="button"
                onClick={addTile}
                disabled={saving || category === null}
                className="ml-auto rounded-lg border border-[#2C4E54] px-2.5 py-1 text-xs text-[#8AA6AB] hover:text-[#EDF3F1] disabled:opacity-40"
              >
                + New
              </button>
            </div>

            <div className="p-2">
              {tiles.length === 0 && (
                <p className="p-4 text-[13px] text-[#8AA6AB]">
                  No tiles here yet.
                </p>
              )}

              {tiles.map((t, index) => {
                const selected = t.id === tileId;

                return (
                  <div
                    key={t.id}
                    className={`mb-1 rounded-xl border px-3 py-2.5 ${
                      selected
                        ? "border-[#F0A93B]/60 bg-[#193034]"
                        : "border-transparent hover:bg-[#193034]"
                    } ${t.is_active ? "" : "opacity-55"}`}
                  >
                    <button
                      type="button"
                      onClick={() => openTile(t)}
                      className="w-full text-left"
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex-1 truncate text-[14px] font-semibold">
                          {t.label}
                        </span>
                        {!t.is_active && (
                          <span className="flex-none rounded border border-[#2C4E54] px-1.5 py-0.5 font-mono text-[10px] text-[#8AA6AB]">
                            off
                          </span>
                        )}
                        {t.delivery_code !== null && (
                          <span className="flex-none rounded border border-[#79B4C4]/50 px-1.5 py-0.5 font-mono text-[10px] text-[#79B4C4]">
                            paired
                          </span>
                        )}
                        {t.addons.length > 0 && (
                          <span className="flex-none rounded border border-[#F0A93B]/50 px-1.5 py-0.5 font-mono text-[10px] text-[#F0A93B]">
                            +{t.addons.length}
                          </span>
                        )}
                      </span>

                      <span className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-[#8AA6AB]">
                        <span className="truncate">{summariseRule(t)}</span>
                        <span className="ml-auto flex-none text-[#5E7B80]">
                          {summariseLocations(t.office_ids, offices)}
                        </span>
                      </span>
                    </button>

                    {selected && (
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveTile(t, -1)}
                          disabled={saving || index === 0}
                          className="rounded border border-[#2C4E54] px-2 py-0.5 text-xs text-[#8AA6AB] hover:text-[#EDF3F1] disabled:opacity-30"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTile(t, 1)}
                          disabled={saving || index === tiles.length - 1}
                          className="rounded border border-[#2C4E54] px-2 py-0.5 text-xs text-[#8AA6AB] hover:text-[#EDF3F1] disabled:opacity-30"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTile(t)}
                          disabled={saving}
                          className="ml-auto rounded border border-[#2C4E54] px-2 py-0.5 text-xs text-[#8AA6AB] hover:border-[#E4674F]/50 hover:text-[#E4674F] disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------------- Editor ---------------- */}
          <section className="rounded-2xl border border-[#2C4E54] bg-[#122326] xl:col-span-1 lg:col-span-2 xl:col-auto">
            {draft === null ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 p-10 text-center">
                <strong className="text-[15px] font-medium">Pick a tile</strong>
                <span className="max-w-[34ch] text-[13px] text-[#8AA6AB]">
                  Select a tile to change what it writes into OpenDental,
                  where it appears, and what rides along with it.
                </span>
              </div>
            ) : (
              <TileEditor
                draft={draft}
                offices={offices}
                codes={codes}
                saving={saving}
                dirty={dirty}
                onPatch={patchDraft}
                onSave={saveDraft}
                onClose={closeEditor}
                onAddAddon={addAddon}
                onSaveAddon={saveAddon}
                onDeleteAddon={deleteAddon}
              />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

// =====================================================================
// Editor
// =====================================================================
function TileEditor(props: {
  draft: Tile;
  offices: Office[];
  codes: ProcCode[];
  saving: boolean;
  dirty: boolean;
  onPatch: (patch: Partial<Tile>) => void;
  onSave: () => void;
  onClose: () => void;
  onAddAddon: () => void;
  onSaveAddon: (addon: Addon, patch: Partial<Addon>) => void;
  onDeleteAddon: (addon: Addon) => void;
}) {
  const {
    draft,
    offices,
    codes,
    saving,
    dirty,
    onPatch,
    onSave,
    onClose,
    onAddAddon,
    onSaveAddon,
    onDeleteAddon,
  } = props;

  const ruleType = ruleTypeOf(draft.code_rule);
  const gap = draft.entry_kind === "procedure" ? describeRuleGap(draft.code_rule) : "";

  function setRule(next: CodeRule) {
    onPatch({ code_rule: next });
  }

  function setRuleType(next: RuleType) {
    setRule(blankRule(next));
    // Surface count is the only rule that needs surfaces picked at the
    // chair, so the flag follows the rule rather than being set twice.
    onPatch({ needs_surfaces: next === "surface_count" });
  }

  const usingSplit = draft.code_rule?.type === "surface_count" &&
    (draft.code_rule.all === undefined || draft.code_rule.all === null);

  function toggleOffice(officeId: string) {
    const has = draft.office_ids.includes(officeId);
    onPatch({
      office_ids: has
        ? draft.office_ids.filter((id) => id !== officeId)
        : [...draft.office_ids, officeId],
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[#2C4E54] px-4 py-3">
        <h2 className="truncate text-[13px] font-bold tracking-[0.06em] uppercase">
          {draft.label || "Untitled tile"}
        </h2>
        {dirty && (
          <span className="flex-none rounded border border-[#F0A93B]/50 px-1.5 py-0.5 font-mono text-[10px] text-[#F0A93B]">
            unsaved
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg border border-[#2C4E54] px-2.5 py-1 text-xs text-[#8AA6AB] hover:text-[#EDF3F1]"
        >
          Close
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {/* Name */}
        <Field label="Name" hint="What the clinician sees on the button.">
          <input
            type="text"
            value={draft.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            className="w-full rounded-lg border border-[#2C4E54] bg-[#0F1D20] px-3 py-2.5 text-[15px] text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
          />
        </Field>

        {/* Kind */}
        <Field
          label="What it records"
          hint="A missing tooth is not a procedure in OpenDental — it is a mark on the tooth."
        >
          <div className="flex overflow-hidden rounded-lg border border-[#2C4E54]">
            {(["procedure", "tooth_initial"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => onPatch({ entry_kind: kind })}
                className={`flex-1 px-3 py-2 text-[13px] font-semibold ${
                  draft.entry_kind === kind
                    ? "bg-[#EDF3F1] text-[#0B1719]"
                    : "bg-[#0F1D20] text-[#8AA6AB] hover:text-[#EDF3F1]"
                }`}
              >
                {kind === "procedure" ? "A procedure" : "A tooth mark"}
              </button>
            ))}
          </div>
        </Field>

        {draft.entry_kind === "tooth_initial" ? (
          <Field label="Mark type" hint="OpenDental's own wording, such as Missing or Hidden.">
            <input
              type="text"
              value={draft.initial_type ?? ""}
              onChange={(e) => onPatch({ initial_type: e.target.value })}
              className="w-full rounded-lg border border-[#2C4E54] bg-[#0F1D20] px-3 py-2.5 text-[15px] text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
            />
          </Field>
        ) : (
          <>
            {/* Rule type */}
            <Field label="How the code is chosen" hint="">
              <div className="space-y-2">
                {RULE_TYPES.map((rt) => (
                  <button
                    key={rt.value}
                    type="button"
                    onClick={() => setRuleType(rt.value)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left ${
                      ruleType === rt.value
                        ? "border-[#F0A93B]/60 bg-[#193034]"
                        : "border-[#2C4E54] bg-[#0F1D20] hover:bg-[#193034]"
                    }`}
                  >
                    <span className="block text-[13.5px] font-semibold">{rt.label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-[#8AA6AB]">
                      {rt.blurb}
                    </span>
                  </button>
                ))}
              </div>
            </Field>

            {/* Codes for the rule */}
            {ruleType === "fixed" && (
              <Field label="Code" hint="">
                <CodePicker
                  codes={codes}
                  value={draft.code_rule?.type === "fixed" ? draft.code_rule.code : ""}
                  onChange={(code) => setRule({ type: "fixed", code })}
                />
              </Field>
            )}

            {ruleType === "tooth_class" && draft.code_rule?.type === "tooth_class" && (
              <Field
                label="Codes by tooth position"
                hint="Front teeth, bicuspids and molars each get their own code."
              >
                <div className="space-y-2">
                  {(["anterior", "bicuspid", "molar"] as const).map((slot) => (
                    <div key={slot}>
                      <span className="mb-1 block text-[11.5px] text-[#8AA6AB] capitalize">
                        {slot}
                      </span>
                      <CodePicker
                        codes={codes}
                        value={draft.code_rule?.type === "tooth_class"
                          ? (draft.code_rule[slot] ?? "")
                          : ""}
                        onChange={(code) => {
                          if (draft.code_rule?.type !== "tooth_class") return;
                          setRule({ ...draft.code_rule, [slot]: code });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </Field>
            )}

            {ruleType === "surface_count" && draft.code_rule?.type === "surface_count" && (
              <Field
                label="Codes by surface count"
                hint="Most composites also split by where the tooth is. Switch that off if one set of codes covers the whole mouth."
              >
                <label className="mb-3 flex items-center gap-2 text-[12.5px] text-[#8AA6AB]">
                  <input
                    type="checkbox"
                    checked={usingSplit}
                    onChange={() => {
                      if (draft.code_rule?.type !== "surface_count") return;
                      setRule(
                        usingSplit
                          ? { type: "surface_count", all: ["", "", "", ""] }
                          : {
                            type: "surface_count",
                            anterior: ["", "", "", ""],
                            posterior: ["", "", "", ""],
                          },
                      );
                    }}
                    className="h-4 w-4 accent-[#F0A93B]"
                  />
                  Different codes for front and back teeth
                </label>

                {usingSplit ? (
                  <div className="space-y-4">
                    {(["anterior", "posterior"] as const).map((where) => (
                      <div key={where}>
                        <span className="mb-1.5 block text-[11.5px] text-[#8AA6AB] capitalize">
                          {where}
                        </span>
                        <div className="space-y-2">
                          {SURFACE_LABELS.map((surfaceLabel, i) => (
                            <div key={surfaceLabel} className="flex items-center gap-2">
                              <span className="w-[74px] flex-none font-mono text-[11px] text-[#5E7B80]">
                                {surfaceLabel}
                              </span>
                              <div className="flex-1">
                                <CodePicker
                                  codes={codes}
                                  value={draft.code_rule?.type === "surface_count"
                                    ? ((draft.code_rule[where] ?? [])[i] ?? "")
                                    : ""}
                                  onChange={(code) => {
                                    if (draft.code_rule?.type !== "surface_count") return;
                                    const series = [...(draft.code_rule[where] ?? ["", "", "", ""])];
                                    series[i] = code;
                                    setRule({ ...draft.code_rule, [where]: series });
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {SURFACE_LABELS.map((surfaceLabel, i) => (
                      <div key={surfaceLabel} className="flex items-center gap-2">
                        <span className="w-[74px] flex-none font-mono text-[11px] text-[#5E7B80]">
                          {surfaceLabel}
                        </span>
                        <div className="flex-1">
                          <CodePicker
                            codes={codes}
                            value={draft.code_rule?.type === "surface_count"
                              ? ((draft.code_rule.all ?? [])[i] ?? "")
                              : ""}
                            onChange={(code) => {
                              if (draft.code_rule?.type !== "surface_count") return;
                              const series = [...(draft.code_rule.all ?? ["", "", "", ""])];
                              series[i] = code;
                              setRule({ ...draft.code_rule, all: series });
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Field>
            )}

            {gap !== "" && (
              <p className="rounded-lg border border-[#F0A93B]/40 bg-[#F0A93B]/10 px-3 py-2 text-[12.5px] text-[#F0A93B]">
                {gap} The tile can be saved, but not switched on until it is complete.
              </p>
            )}

            {/* Delivery */}
            <Field
              label="Delivery code"
              hint="For two-visit work. A crown prep is billed at the first visit and the seat at the second; both lines are created when it is diagnosed."
            >
              <CodePicker
                codes={codes}
                value={draft.delivery_code ?? ""}
                onChange={(code) => onPatch({ delivery_code: code === "" ? null : code })}
                allowEmpty
              />
              {(draft.delivery_code ?? "") !== "" && (
                <p className="mt-2 text-[11.5px] leading-snug text-[#5E7B80]">
                  The delivery line posts at zero. Splitting the fee between the
                  two visits is not settled yet, so nothing is divided.
                </p>
              )}
            </Field>
          </>
        )}

        {/* Treatment area */}
        <Field
          label="What it applies to"
          hint="OpenDental's own classification of the code. It decides what the chairside screen asks for."
        >
          <select
            value={draft.treat_area === null ? "" : String(draft.treat_area)}
            onChange={(e) =>
              onPatch({
                treat_area: e.target.value === "" ? null : Number(e.target.value),
              })}
            className="w-full rounded-lg border border-[#2C4E54] bg-[#0F1D20] px-3 py-2.5 text-[14px] text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
          >
            <option value="">Not set</option>
            {TREAT_AREAS.map((ta) => (
              <option key={ta.value} value={String(ta.value)}>
                {ta.label} — {ta.hint}
              </option>
            ))}
          </select>
        </Field>

        {/* Availability */}
        <Field
          label="Locations"
          hint="One tile, shown only where the procedure is actually done."
        >
          <div className="space-y-1.5">
            {offices.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2.5 rounded-lg border border-[#2C4E54] bg-[#0F1D20] px-3 py-2.5 text-[13.5px]"
              >
                <input
                  type="checkbox"
                  checked={draft.office_ids.includes(o.id)}
                  onChange={() => toggleOffice(o.id)}
                  className="h-4 w-4 accent-[#F0A93B]"
                />
                {o.name}
              </label>
            ))}
          </div>
        </Field>

        {/* Add-ons */}
        <Field
          label="Add-ons"
          hint="Extras that arrive with the tile. Defaulted on means the clinician removes it if the patient declines."
        >
          <div className="space-y-2">
            {draft.addons.length === 0 && (
              <p className="text-[12.5px] text-[#5E7B80]">
                Nothing rides on this tile.
              </p>
            )}

            {draft.addons.map((addon) => (
              <div
                key={addon.id}
                className="rounded-lg border border-[#2C4E54] bg-[#0F1D20] p-3"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    defaultValue={addon.label}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value !== "" && value !== addon.label) {
                        onSaveAddon(addon, { label: value });
                      }
                    }}
                    className="flex-1 rounded border border-[#2C4E54] bg-[#122326] px-2.5 py-1.5 text-[13.5px] text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onDeleteAddon(addon)}
                    disabled={saving}
                    className="flex-none rounded border border-[#2C4E54] px-2 py-1 text-xs text-[#8AA6AB] hover:border-[#E4674F]/50 hover:text-[#E4674F] disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-2">
                  <CodePicker
                    codes={codes}
                    value={addon.proc_code}
                    onChange={(code) => onSaveAddon(addon, { proc_code: code })}
                  />
                </div>

                <label className="mt-2 flex items-center gap-2 text-[12.5px] text-[#8AA6AB]">
                  <input
                    type="checkbox"
                    checked={addon.is_default_on}
                    onChange={() =>
                      onSaveAddon(addon, { is_default_on: !addon.is_default_on })}
                    className="h-4 w-4 accent-[#F0A93B]"
                  />
                  Arrives already checked
                </label>
              </div>
            ))}

            <button
              type="button"
              onClick={onAddAddon}
              disabled={saving}
              className="w-full rounded-lg border border-dashed border-[#2C4E54] px-3 py-2.5 text-[13px] text-[#8AA6AB] hover:border-[#F0A93B]/50 hover:text-[#EDF3F1] disabled:opacity-40"
            >
              + Add an add-on
            </button>
          </div>
        </Field>

        {/* Notes */}
        <Field label="Notes" hint="For whoever edits this next. Never shown at the chair.">
          <textarea
            value={draft.notes ?? ""}
            onChange={(e) => onPatch({ notes: e.target.value })}
            rows={2}
            className="w-full rounded-lg border border-[#2C4E54] bg-[#0F1D20] px-3 py-2.5 text-[13.5px] text-[#EDF3F1] focus:border-[#F0A93B] focus:outline-none"
          />
        </Field>

        {/* Active */}
        <label className="flex items-center gap-2.5 rounded-lg border border-[#2C4E54] bg-[#0F1D20] px-3 py-3 text-[13.5px]">
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={() => onPatch({ is_active: !draft.is_active })}
            className="h-4 w-4 accent-[#F0A93B]"
          />
          Active
        </label>
      </div>

      <div className="flex items-center gap-3 border-t border-[#2C4E54] px-4 py-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className="rounded-xl bg-[#EDF3F1] px-6 py-2.5 text-[14px] font-semibold text-[#0B1719] disabled:opacity-35"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <span className="text-[11.5px] text-[#5E7B80]">
          {dirty ? "Unsaved changes" : "Up to date"}
        </span>
      </div>
    </div>
  );
}

// =====================================================================
// Small pieces
// =====================================================================
function Field(props: { label: string; hint: string; children: unknown }) {
  return (
    <div>
      <span className="block text-[12px] font-semibold tracking-[0.04em] text-[#EDF3F1] uppercase">
        {props.label}
      </span>
      {props.hint !== "" && (
        <span className="mt-1 mb-2 block text-[11.5px] leading-snug text-[#8AA6AB]">
          {props.hint}
        </span>
      )}
      <div className={props.hint === "" ? "mt-2" : ""}>{props.children}</div>
    </div>
  );
}

// A typed code would be discovered at the chair, so codes are chosen
// from what OpenDental actually holds. The list is long, so it filters
// as you type and shows the description alongside.
function CodePicker(props: {
  codes: ProcCode[];
  value: string;
  onChange: (code: string) => void;
  allowEmpty?: boolean;
}) {
  const { codes, value, onChange, allowEmpty } = props;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const chosen = useMemo(
    () => codes.find((c) => c.proc_code === value) ?? null,
    [codes, value],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return codes.slice(0, 40);

    return codes
      .filter((c) =>
        c.proc_code.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.abbr_desc.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [codes, query]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery("");
        }}
        className="flex w-full items-center gap-2 rounded-lg border border-[#2C4E54] bg-[#0F1D20] px-3 py-2.5 text-left hover:border-[#F0A93B]/50"
      >
        <span className="w-[70px] flex-none font-mono text-[13px] font-semibold">
          {value || "—"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#8AA6AB]">
          {chosen?.description ?? (value === "" ? "Pick a code" : "Not in the synced list")}
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-[#F0A93B]/50 bg-[#0F1D20] p-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Code or description"
        autoComplete="off"
        className="w-full rounded border border-[#2C4E54] bg-[#122326] px-2.5 py-2 text-[13.5px] text-[#EDF3F1] placeholder:text-[#5E7B80] focus:border-[#F0A93B] focus:outline-none"
      />

      <div className="mt-2 max-h-[230px] overflow-y-auto">
        {allowEmpty === true && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="w-full rounded px-2 py-2 text-left text-[12.5px] text-[#8AA6AB] hover:bg-[#193034]"
          >
            None
          </button>
        )}

        {matches.length === 0 && (
          <p className="px-2 py-3 text-[12.5px] text-[#5E7B80]">
            Nothing matches. The code may not be synced yet.
          </p>
        )}

        {matches.map((c) => (
          <button
            key={c.proc_code}
            type="button"
            onClick={() => {
              onChange(c.proc_code);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#193034] ${
              c.proc_code === value ? "bg-[#193034]" : ""
            }`}
          >
            <span className="w-[70px] flex-none font-mono text-[12.5px] font-semibold">
              {c.proc_code}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-[#8AA6AB]">
              {c.description}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-2 w-full rounded border border-[#2C4E54] px-2 py-1.5 text-[12px] text-[#8AA6AB] hover:text-[#EDF3F1]"
      >
        Cancel
      </button>
    </div>
  );
}
