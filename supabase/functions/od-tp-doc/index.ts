// od-tp-doc — v1
//
// Files a signed treatment plan PDF into the patient's OpenDental chart.
//
// Actions:
//   upload  — POST a PDF into the Imaging module
//
// Changelog:
//   v1  First cut, drawn from what od-tp-probe established against the
//       live Downey server:
//         - /documents/Upload is the route. A plain POST to /documents
//           is refused: "documents POST  is not a valid method."
//         - The response carries the new DocNum and resolves the
//           category name, so a successful write can be reported
//           precisely rather than optimistically.
//         - FileName came back as "x" on the probe and OpenDental still
//           rendered the PDF, so the field is OpenDental's to manage.
//
// Design notes:
//   - The document category is resolved by name at run time, not
//     hardcoded. Both offices happen to use 132 today, but they are
//     separate databases with separate numbering and that agreement is
//     a coincidence, not a guarantee.
//   - No PHI is stored here. The PDF passes through and is not written
//     to Supabase, logged, or echoed back in the response.
//   - The patient is verified to exist before anything is filed.
//     OpenDental will happily accept a document for a PatNum that does
//     not exist, and it would then be invisible to everyone.

const OD_BASE = "https://api.opendental.com/api/v1";
const CATEGORY_NAME = "Treatment Plans";
const FALLBACK_CATEGORY = 132;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OfficeSlug = "downey" | "maywood";

function keysFor(office: OfficeSlug): string {
  const dev = Deno.env.get("OD_DEVELOPER_KEY");
  const cust = office === "downey"
    ? Deno.env.get("OD_CUSTOMER_KEY_DOWNEY")
    : Deno.env.get("OD_CUSTOMER_KEY_MAYWOOD");

  if (!dev || !cust) {
    throw new Error(`OpenDental keys are not configured for ${office}.`);
  }
  return `ODFHIR ${dev}/${cust}`;
}

async function odCall(
  office: OfficeSlug,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const res = await fetch(`${OD_BASE}${path}`, {
    method,
    headers: {
      Authorization: keysFor(office),
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

async function shortQuery(
  office: OfficeSlug,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const res = await odCall(office, "PUT", "/queries/ShortQuery", {
    SqlCommand: sql,
  });
  if (!res.ok || !Array.isArray(res.body)) return [];
  return res.body as Record<string, unknown>[];
}

function fail(message: string, detail?: unknown, status = 400): Response {
  return new Response(
    JSON.stringify({ ok: false, error: message, detail }),
    { status, headers: { ...CORS, "Content-Type": "application/json" } },
  );
}

function ok(payload: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ ok: true, ...payload }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const payload = await req.json().catch(() => ({}));

    const officeRaw = String(payload?.office ?? "").toLowerCase().trim();
    if (officeRaw !== "downey" && officeRaw !== "maywood") {
      return fail("Unknown office. Use downey or maywood.");
    }
    const office: OfficeSlug = officeRaw;

    const action = String(payload?.action ?? "upload").trim();
    if (action !== "upload") {
      return fail("Unknown action. Use upload.");
    }

    const patNum = Number(payload?.patNum);
    if (!Number.isInteger(patNum) || patNum <= 0) {
      return fail("patNum must be a positive whole number.");
    }

    const base64 = String(payload?.base64 ?? "");
    if (base64.length < 100) {
      return fail("base64 is missing or too small to be a document.");
    }
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) {
      return fail("base64 contains characters that are not base64.");
    }

    const description = String(payload?.description ?? "Treatment Plan").trim();

    // ---- The patient must exist. A document filed against a stray
    // ---- number would be invisible to the office and impossible to find.
    const patient = await shortQuery(
      office,
      `SELECT PatNum, LName, FName FROM patient WHERE PatNum = ${patNum}`,
    );
    if (patient.length === 0) {
      return fail(`No patient ${patNum} at ${office}.`, undefined, 404);
    }

    // ---- Resolve the category by name, per office.
    const cats = await shortQuery(
      office,
      `SELECT DefNum FROM definition WHERE Category = 18 ` +
        `AND ItemName = '${CATEGORY_NAME}' AND IsHidden = 0 LIMIT 1`,
    );
    const docCategory = cats.length > 0 && Number(cats[0].DefNum) > 0
      ? Number(cats[0].DefNum)
      : FALLBACK_CATEGORY;

    const upload = await odCall(office, "POST", "/documents/Upload", {
      PatNum: patNum,
      DocCategory: docCategory,
      extension: ".pdf",
      rawBase64: base64,
      Description: description,
    });

    if (!upload.ok) {
      return fail(
        "OpenDental refused the document.",
        upload.body,
        upload.status,
      );
    }

    const created = (upload.body ?? {}) as Record<string, unknown>;

    return ok({
      office,
      patNum,
      docNum: created.DocNum ?? null,
      docCategory,
      categoryName: created.docCategory ?? CATEGORY_NAME,
      description: created.Description ?? description,
      dateCreated: created.DateCreated ?? null,
      bytes: Math.floor((base64.length * 3) / 4),
    });
  } catch (err) {
    return fail(
      "The upload could not be completed.",
      String(err instanceof Error ? err.message : err),
      500,
    );
  }
});
