// =====================================================================
// Dental OS - Edge Function: od-consent
//
// Consent-form selection: given the diagnosed procedures a user has
// ticked, list the office's live consent sheetdefs (read from
// OpenDental) and compute which one to pre-select, using Dental OS's
// own chart_tiles/chart_categories naming - the same category labels
// (Fillings, Crown & Bridge, Endo, ...) the charting tile picker
// already groups procedures under.
//
// The match is by name only: once a consent form's OpenDental
// Description is renamed to read the same as a chart_categories.label,
// it becomes the default automatically. No code change is needed to
// add or change a match, only the rename in OpenDental - that rename
// is deliberately not done by this function.
//
// Nothing is written here. list_forms only reads, from both OpenDental
// and Dental OS's own tables.
//
// Deploy path: supabase/functions/od-consent/index.ts
// Version: 1
//
// Actions:
//   list_forms — { office, language?, proc_codes? } -> the office's
//                 consent forms for that language, each form's fillable
//                 field (toothNum, misc, or none), and which one (if
//                 any) matches the ticked procedures' single shared
//                 category.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OD_BASE_URL = "https://api.opendental.com/api/v1";

const ALLOWED_SECRET_NAMES = new Set([
  "OD_CUSTOMER_KEY_DOWNEY",
  "OD_CUSTOMER_KEY_MAYWOOD",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function odFetch(
  auth: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const res = await fetch(`${OD_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, body: parsed };
}

// ShortQuery hands back the first 100 rows at offset 0, and then
// everything from the offset onward. Same pagination od-staff-login
// already uses - the consent list is well under 100 rows either way,
// but a form added later should not silently go missing.
async function shortQueryAll(auth: string, sql: string): Promise<Record<string, unknown>[]> {
  const first = await odFetch(auth, "PUT", "/queries/ShortQuery", { SqlCommand: sql });
  if (!first.ok || !Array.isArray(first.body)) return [];

  const rows = first.body as Record<string, unknown>[];
  if (rows.length < 100) return rows;

  const rest = await odFetch(auth, "PUT", `/queries/ShortQuery?Offset=${rows.length}`, {
    SqlCommand: sql,
  });
  if (!rest.ok || !Array.isArray(rest.body)) return rows;
  return [...rows, ...(rest.body as Record<string, unknown>[])];
}

// ---------------------------------------------------------------------
// Every procedure code a chart_tiles.code_rule mentions, regardless of
// its shape. Mirrors od-chart's own codesInRule: a code_rule is a
// small, evolving JSON shape ({code}, {all:[]}, {anterior, posterior},
// {molar, anterior, bicuspid}, ...), so this walks every string value
// it holds rather than hardcoding each shape - a shape od-chart adds
// later still works here with no matching change.
// ---------------------------------------------------------------------
function codesInRule(rule: unknown): string[] {
  if (rule === null || typeof rule !== "object") return [];
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      if (value.trim() !== "") out.push(value.trim());
    } else if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
    } else if (value !== null && typeof value === "object") {
      for (const entry of Object.values(value as Record<string, unknown>)) walk(entry);
    }
  };
  walk(rule);
  return out;
}

// The office's own convention, confirmed on the live consent sheetdefs:
// a Spanish form's Description ends in "- SP" (spacing varies). Nothing
// else in the 12-13 form names collides with that suffix.
function isSpanish(description: string): boolean {
  return description.trim().toUpperCase().replace(/\s+/g, "").endsWith("-SP");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }

  // -------------------------------------------------------------------
  // Authenticate
  // -------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "Missing Authorization bearer token." }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return json({ ok: false, error: "Invalid or expired session." }, 401);
  }

  // -------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------
  let body: {
    office?: string;
    action?: string;
    proc_codes?: unknown;
    language?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const action = (body.action ?? "").toLowerCase().trim();

  const ACTIONS = ["list_forms"];
  if (!ACTIONS.includes(action)) {
    return json({ ok: false, error: `action must be one of: ${ACTIONS.join(", ")}.` }, 400);
  }
  if (officeSlug === "") {
    return json({ ok: false, error: "Provide office." }, 400);
  }

  // -------------------------------------------------------------------
  // Office, through RLS. A user with no role here gets no row.
  // -------------------------------------------------------------------
  const { data: officeRow, error: officeError } = await supabase
    .from("offices")
    .select("id, slug, name, organization_id, opendental_customer_key_name, is_active")
    .eq("slug", officeSlug)
    .maybeSingle();

  if (officeError) {
    return json({ ok: false, error: `Office lookup failed: ${officeError.message}` }, 500);
  }
  if (!officeRow) {
    return json({
      ok: false,
      error: "That office was not found, or you do not have a role there.",
    }, 403);
  }
  if (officeRow.is_active !== true) {
    return json({ ok: false, error: "That office is marked inactive." }, 400);
  }

  const secretName = officeRow.opendental_customer_key_name ?? "";
  if (!ALLOWED_SECRET_NAMES.has(secretName)) {
    return json({
      ok: false,
      error: "This office has no recognized OpenDental key configured.",
    }, 500);
  }

  const developerKey = Deno.env.get("OD_DEVELOPER_KEY");
  const customerKey = Deno.env.get(secretName);
  if (!developerKey || !customerKey) {
    return json({
      ok: false,
      error: "Missing Edge Function secrets.",
      missing: [
        ...(developerKey ? [] : ["OD_DEVELOPER_KEY"]),
        ...(customerKey ? [] : [secretName]),
      ],
    }, 500);
  }

  const auth = `ODFHIR ${developerKey}/${customerKey}`;

  // ===================================================================
  // list_forms
  // ===================================================================
  if (action === "list_forms") {
    const language = (body.language ?? "en").toLowerCase().trim() === "es" ? "es" : "en";
    const procCodes = Array.isArray(body.proc_codes)
      ? body.proc_codes.filter((c): c is string => typeof c === "string" && c.trim() !== "")
      : [];

    // ---- The live consent form list. SheetDefNums differ per office,
    // ---- so everything downstream matches by Description, not number.
    const sql =
      "SELECT sd.SheetDefNum, sd.Description, " +
      "GROUP_CONCAT(DISTINCT sfd.FieldName SEPARATOR ',') AS input_field_names " +
      "FROM sheetdef sd " +
      "LEFT JOIN sheetfielddef sfd ON sfd.SheetDefNum=sd.SheetDefNum AND sfd.FieldType=1 " +
      "WHERE sd.SheetType=6 " +
      "GROUP BY sd.SheetDefNum, sd.Description " +
      "ORDER BY sd.Description";
    const rows = await shortQueryAll(auth, sql);

    const allForms = rows.map((r) => {
      const description = String(r.Description ?? "").trim();
      const names = String(r.input_field_names ?? "");
      const field: "toothNum" | "misc" | null = names.includes("toothNum")
        ? "toothNum"
        : names.includes("misc")
          ? "misc"
          : null;
      return {
        sheet_def_num: Number(r.SheetDefNum),
        description,
        field,
      };
    });

    const forms = allForms.filter((f) => isSpanish(f.description) === (language === "es"));

    // ---- Which chart_tiles category the ticked procedures fall
    // ---- under. A form gets pre-selected only when every ticked
    // ---- procedure resolves to the same single category - a mixed
    // ---- batch, or a code with no tile at all, leaves the choice to
    // ---- the user rather than guessing.
    let targetCategory: string | null = null;

    if (procCodes.length > 0) {
      const { data: categories, error: categoriesError } = await supabase
        .from("chart_categories")
        .select("id, label")
        .eq("organization_id", officeRow.organization_id)
        .eq("bucket", "diagnosed")
        .eq("is_active", true);

      if (categoriesError) {
        return json({ ok: false, error: `Category lookup failed: ${categoriesError.message}` }, 500);
      }

      const categoryIds = (categories ?? []).map((c) => c.id);
      const labelById = new Map((categories ?? []).map((c) => [c.id, c.label as string]));

      const { data: tiles, error: tilesError } = categoryIds.length === 0
        ? { data: [], error: null }
        : await supabase
          .from("chart_tiles")
          .select("code_rule, category_id")
          .eq("is_active", true)
          .in("category_id", categoryIds);

      if (tilesError) {
        return json({ ok: false, error: `Tile lookup failed: ${tilesError.message}` }, 500);
      }

      const labelsFound = new Set<string>();
      for (const code of procCodes) {
        const hit = (tiles ?? []).find((t) => codesInRule(t.code_rule).includes(code));
        const label = hit ? labelById.get(hit.category_id) : undefined;
        if (label) labelsFound.add(label);
      }
      if (labelsFound.size === 1) {
        targetCategory = [...labelsFound][0];
      }
    }

    let defaultSheetDefNum: number | null = null;
    if (targetCategory !== null) {
      const needle = targetCategory.toLowerCase();
      const match = forms.find((f) => {
        const hay = f.description.toLowerCase();
        return hay.includes(needle) || needle.includes(hay);
      });
      defaultSheetDefNum = match?.sheet_def_num ?? null;
    }

    return json({
      ok: true,
      office: officeRow.slug,
      language,
      target_category: targetCategory,
      default_sheet_def_num: defaultSheetDefNum,
      forms,
    });
  }

  return json({ ok: false, error: "Unreachable." }, 500);
});
