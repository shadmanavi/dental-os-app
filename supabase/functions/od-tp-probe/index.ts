// =====================================================================
// Dental OS - Edge Function: od-tp-probe
//
// Purpose: answer five questions about OpenDental's treatment plan
// tables before Dental OS commits to writing them. Nothing in this app
// has ever read or written treatplan, treatplanattach or TPStatus — the
// four mentions of them in the codebase are all comments explaining why
// not. So this is new ground, and one documented failure is already on
// record against it.
//
// This is a probe, not a product feature. Delete it once the answers
// are in the handoff.
//
// Deploy path: supabase/functions/od-tp-probe/index.ts
// Version: 2
//
// The questions:
//
//   H1  Does PUT /procedurelogs/{n} accept ProcStatus TPi?
//
//       POST refused EC outright — "ProcStatus may only be set to
//       Treatment Planned (TP), Complete (C), or Existing Other
//       Provider (EO)" — and EO was the compromise. TPi was not on
//       that list either, and the list was for POST. Whether PUT is
//       more permissive is untested.
//
//   H5  When a procedure moves to TPi, does OpenDental write the
//       treatplanattach row itself?
//
//       This is the cheapest question and the most valuable answer.
//       All 20,073 TPi procedures at Downey are attached to a plan and
//       none of them were put there by us, so OpenDental is doing it
//       somewhere. If it does it on an API status change too, then
//       parking a procedure is one call rather than two and H2 stops
//       blocking anything.
//
//   H2  Does /treatplanattaches accept POST and DELETE?
//
//       GET works and returns TreatPlanAttachNum, ProcNum and
//       TreatPlanNum. Only tested if H5 comes back no.
//
//   H3  Can an Active plan be created, or promoted, through the API?
//
//       On record: POST /treatplans accepted TPStatus "Saved" with 201
//       and filed the plan as Inactive anyway, and PUT would not move
//       it afterwards. Old enough to re-test rather than trust.
//
//   H4  If H3 is no — does OpenDental keep an Active plan of its own
//       for every patient, so the app only ever attaches to one that
//       already exists?
//
//       14,581 of 14,585 patients have exactly one. If it is created
//       automatically then C2 never needs to create a plan at all.
//
// Changelog
//
//   v2  The throwaway procedure is a mouth-level code, and a tooth is
//       supplied if one is demanded anyway.
//
//       v1 used D0230, a periapical radiograph. OpenDental refused the
//       POST with "A ToothNum is required for the procedure code's
//       treatment area." and the probe stopped before it had created
//       anything — correct behaviour, wrong code.
//
//       procedurecode.TreatArea decides this, and it was read rather
//       than guessed a second time: 0 is Mouth, 2 is Tooth, 3 is Quad.
//       D0230 is 2. D9999, unspecified adjunctive procedure by report,
//       is 0 — mouth level, no fee attached, and unmistakably not real
//       treatment if a human ever sees it.
//
//       A retry with a ToothNum was added as well. A refusal on
//       treatment area is a setup failure, not an answer to any of the
//       five questions, and it should never be what stops the probe.
//
//   v1  First build. H1-H5.
//
// What this writes, and how it cleans up:
//
//   One throwaway procedure on the sandbox patient, and possibly one
//   treatment plan. Both are removed in a finally block that runs
//   whatever happened, including on an exception. Every id it created
//   is reported back so anything the cleanup could not reach can be
//   found by hand.
//
//   The one thing it may not be able to reverse is the treatment plan:
//   whether /treatplans accepts DELETE is itself unknown, and is
//   reported as its own finding rather than assumed. If it does not,
//   the plan is named so it is obvious in OpenDental's own list.
//
// Every step reads its result back from the database rather than
// trusting the HTTP code. This API has accepted a value with 200 and
// kept its own on at least four separate fields, so a 2xx is not an
// answer to anything.
//
// PHI note: reads one patient's procedures. Nothing patient-identifying
// is written to Supabase.
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

// Confirmed by census: 1 treatment planned, 2 complete, 6 deleted,
// 8 treatment planned inactive (20,073 rows at Downey).
const PROC_STATUS_TP = 1;
const PROC_STATUS_DELETED = 6;
const PROC_STATUS_TPI = 8;

// treatplan.TPStatus. Verified against the Heading column on a live
// patient, because the value most people expect is wrong: Saved is 0,
// not 2.
const TP_STATUS_SAVED = 0;
const TP_STATUS_ACTIVE = 1;
const TP_STATUS_INACTIVE = 2;

// A mouth-level code, so OpenDental does not demand a tooth, and a
// by-report one, so nothing this creates ever looks like money owed.
//
// procedurecode.TreatArea is what decides the first of those: 0 Mouth,
// 2 Tooth, 3 Quad. Read from Downey rather than assumed, because
// assuming it is what made v1 fail.
const PROBE_PROC_CODE = "D9999";

// Used only if OpenDental demands a tooth anyway — a code whose
// treatment area differs between offices would otherwise stop the
// probe before it asked a single question. Tooth 8 is a permanent
// upper central incisor, present on any adult chart.
const PROBE_FALLBACK_TOOTH = "8";

// Named so a human scanning OpenDental's plan list knows immediately
// what it is and that it can go.
const PROBE_PLAN_HEADING = "DOS PROBE - SAFE TO DELETE";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type OdCall = {
  method: string;
  url: string;
  http_status: number;
  body: unknown;
};

async function odFetch(
  auth: string,
  method: string,
  path: string,
  payload?: unknown,
): Promise<OdCall> {
  const url = `${OD_BASE_URL}${path}`;

  const init: RequestInit = {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };

  if (payload !== undefined) init.body = JSON.stringify(payload);

  const response = await fetch(url, init);
  const text = await response.text();

  let parsed: unknown = text;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = text.slice(0, 500);
  }

  return { method, url, http_status: response.status, body: parsed };
}

const ok2xx = (call: OdCall): boolean =>
  call.http_status >= 200 && call.http_status < 300;

function rowsOf(call: OdCall): Record<string, unknown>[] {
  return Array.isArray(call.body)
    ? (call.body as Record<string, unknown>[])
    : [];
}

// The database's own answer, which is the only one that counts here.
async function query(
  auth: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const call = await odFetch(auth, "PUT", "/queries/ShortQuery", {
    SqlCommand: sql,
  });
  return ok2xx(call) ? rowsOf(call) : [];
}

// =====================================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }

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

  let body: {
    office?: string;
    office_id?: string;
    pat_num?: number;
    dry_run?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }

  const officeId = (body.office_id ?? "").trim();
  const officeSlug = (body.office ?? "").toLowerCase().trim();
  const patNum = body.pat_num;

  if (officeId === "" && officeSlug === "") {
    return json({ ok: false, error: "Provide office_id or office." }, 400);
  }

  if (typeof patNum !== "number" || patNum <= 0) {
    return json({ ok: false, error: "pat_num is required." }, 400);
  }

  // ---- Office, through RLS. No role here means no row. ----
  const officeQuery = supabase
    .from("offices")
    .select("id, slug, name, opendental_customer_key_name, is_active");

  const { data: officeRow, error: officeError } = officeId !== ""
    ? await officeQuery.eq("id", officeId).maybeSingle()
    : await officeQuery.eq("slug", officeSlug).maybeSingle();

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
    return json({ ok: false, error: "Missing Edge Function secrets." }, 500);
  }

  const auth = `ODFHIR ${developerKey}/${customerKey}`;

  // What was created, so cleanup can reach it and so anything cleanup
  // fails to remove can be found by hand.
  let probeProcNum = 0;
  let probePlanNum = 0;
  let probeAttachNum = 0;

  const findings: Record<string, unknown> = {};
  const calls: OdCall[] = [];
  const cleanup: Record<string, unknown> = {};

  const record = (call: OdCall): OdCall => {
    calls.push(call);
    return call;
  };

  try {
    // =================================================================
    // Step 1 — baseline. What the patient already has.
    // =================================================================
    const plansBefore = await query(
      auth,
      `SELECT TreatPlanNum, Heading, TPStatus FROM treatplan ` +
        `WHERE PatNum = ${patNum} ORDER BY TreatPlanNum`,
    );

    const activePlan = plansBefore.find(
      (p) => Number(p.TPStatus ?? -1) === TP_STATUS_ACTIVE,
    );

    const inactivePlan = plansBefore.find(
      (p) => Number(p.TPStatus ?? -1) === TP_STATUS_INACTIVE,
    );

    findings.baseline = {
      plans: plansBefore.map((p) => ({
        treat_plan_num: Number(p.TreatPlanNum ?? 0),
        heading: String(p.Heading ?? ""),
        tp_status: Number(p.TPStatus ?? -1),
      })),
      active_plan_num: Number(activePlan?.TreatPlanNum ?? 0),
      inactive_plan_num: Number(inactivePlan?.TreatPlanNum ?? 0),
    };

    // H4, first half. If the patient has no Active plan the auto-create
    // question can be answered by watching whether one appears after a
    // procedure is added.
    const hadActivePlan = activePlan !== undefined;

    if (body.dry_run === true) {
      return json({
        ok: true,
        dry_run: true,
        office: officeRow.name,
        pat_num: patNum,
        note: "Nothing was written. Baseline only.",
        findings,
      });
    }

    // =================================================================
    // Step 2 — create the throwaway procedure.
    //
    // procCode, not CodeNum: POST rejects CodeNum with "procCode is
    // required." ProvNum is omitted so OpenDental falls back to the
    // patient's primary provider, which is what it did last time and
    // is one less thing to be wrong about.
    // =================================================================
    const createPayload: Record<string, unknown> = {
      PatNum: patNum,
      procCode: PROBE_PROC_CODE,
      ProcStatus: "TP",
      ProcDate: new Date().toISOString().slice(0, 10),
    };

    let created = record(
      await odFetch(auth, "POST", "/procedurelogs", createPayload),
    );

    // A treatment-area refusal is a setup problem, not an answer to
    // anything. If OpenDental wants a tooth it gets one, and the probe
    // carries on to the questions it exists to ask.
    if (
      !ok2xx(created) &&
      String(created.body ?? "").includes("ToothNum")
    ) {
      created = record(
        await odFetch(auth, "POST", "/procedurelogs", {
          ...createPayload,
          ToothNum: PROBE_FALLBACK_TOOTH,
        }),
      );

      findings.create_needed_tooth = {
        note:
          `${PROBE_PROC_CODE} was refused without a tooth. Retried with ` +
          `ToothNum ${PROBE_FALLBACK_TOOTH}.`,
      };
    }

    if (!ok2xx(created)) {
      return json({
        ok: false,
        error: "Could not create the throwaway procedure, so nothing else ran.",
        detail: created.body,
        findings,
        calls,
      }, 502);
    }

    probeProcNum = Number(
      (created.body as Record<string, unknown>)?.ProcNum ?? 0,
    );

    if (probeProcNum <= 0) {
      return json({
        ok: false,
        error: "OpenDental returned no ProcNum for the created procedure.",
        detail: created.body,
        findings,
        calls,
      }, 502);
    }

    // =================================================================
    // Step 3 — is a brand new TP procedure attached to anything?
    //
    // Not one of the five questions, but it costs one read and it
    // decides whether an attach row is something OpenDental maintains
    // continuously or only writes when a procedure moves.
    // =================================================================
    const attachOnCreate = await query(
      auth,
      `SELECT a.TreatPlanAttachNum, a.TreatPlanNum, t.TPStatus, t.Heading ` +
        `FROM treatplanattach a ` +
        `INNER JOIN treatplan t ON t.TreatPlanNum = a.TreatPlanNum ` +
        `WHERE a.ProcNum = ${probeProcNum}`,
    );

    findings.attach_on_create = {
      question: "Does a newly created TP procedure get an attach row?",
      rows: attachOnCreate.length,
      detail: attachOnCreate,
    };

    // H4, second half — did an Active plan appear because of the
    // procedure, on a patient that had none?
    if (!hadActivePlan) {
      const plansAfterCreate = await query(
        auth,
        `SELECT TreatPlanNum, Heading, TPStatus FROM treatplan ` +
          `WHERE PatNum = ${patNum} AND TPStatus = ${TP_STATUS_ACTIVE}`,
      );

      findings.h4_auto_active_plan = {
        question:
          "Patient had no Active plan. Did OpenDental create one when a " +
          "procedure was added?",
        answer: plansAfterCreate.length > 0,
        detail: plansAfterCreate,
      };
    } else {
      findings.h4_auto_active_plan = {
        question: "Does OpenDental auto-create the Active plan?",
        answer: "untested — this patient already had one",
        note:
          "Re-run against a patient with no Active plan to settle it, or " +
          "accept the census: 14,581 of 14,585 patients have exactly one.",
      };
    }

    // =================================================================
    // H1 — PUT the procedure to TPi.
    //
    // The string form is tried first because that is what POST wanted
    // for TP and C. If OpenDental refuses it, the numeric form is tried
    // second: the API has taken numbers where the docs said strings
    // before, and a refusal on both is a much stronger answer than a
    // refusal on one.
    // =================================================================
    const putString = record(
      await odFetch(auth, "PUT", `/procedurelogs/${probeProcNum}`, {
        ProcStatus: "TPi",
      }),
    );

    let statusAfter = Number(
      (await query(
        auth,
        `SELECT ProcStatus FROM procedurelog WHERE ProcNum = ${probeProcNum}`,
      ))[0]?.ProcStatus ?? -1,
    );

    let acceptedForm: string | null =
      statusAfter === PROC_STATUS_TPI ? "string \"TPi\"" : null;

    if (statusAfter !== PROC_STATUS_TPI) {
      const putNumeric = record(
        await odFetch(auth, "PUT", `/procedurelogs/${probeProcNum}`, {
          ProcStatus: PROC_STATUS_TPI,
        }),
      );

      statusAfter = Number(
        (await query(
          auth,
          `SELECT ProcStatus FROM procedurelog WHERE ProcNum = ${probeProcNum}`,
        ))[0]?.ProcStatus ?? -1,
      );

      if (statusAfter === PROC_STATUS_TPI) acceptedForm = "numeric 8";

      findings.h1_numeric_attempt = {
        http_status: putNumeric.http_status,
        detail: putNumeric.body,
      };
    }

    const h1 = statusAfter === PROC_STATUS_TPI;

    findings.h1_tpi_via_put = {
      question: "Does PUT /procedurelogs accept ProcStatus TPi?",
      answer: h1,
      accepted_form: acceptedForm,
      string_attempt_http: putString.http_status,
      string_attempt_detail: putString.body,
      // The status the database actually holds, which is the answer.
      // A 2xx here has meant nothing before.
      status_now: statusAfter,
    };

    // =================================================================
    // H5 — did OpenDental write the attach row itself?
    //
    // The cheapest question on the list and the one that decides
    // whether C1 is one call or two.
    // =================================================================
    const attachAfterStatus = await query(
      auth,
      `SELECT a.TreatPlanAttachNum, a.TreatPlanNum, t.TPStatus, t.Heading ` +
        `FROM treatplanattach a ` +
        `INNER JOIN treatplan t ON t.TreatPlanNum = a.TreatPlanNum ` +
        `WHERE a.ProcNum = ${probeProcNum}`,
    );

    const autoAttached =
      h1 && attachAfterStatus.length > attachOnCreate.length;

    findings.h5_auto_attach = {
      question:
        "When a procedure moves to TPi, does OpenDental write the " +
        "treatplanattach row itself?",
      answer: autoAttached,
      rows_before: attachOnCreate.length,
      rows_after: attachAfterStatus.length,
      detail: attachAfterStatus,
      consequence: autoAttached
        ? "Parking a procedure is one API call. H2 stops blocking C1."
        : "Parking needs an explicit attach write — H2 has to pass.",
    };

    // =================================================================
    // H2 — POST and DELETE on /treatplanattaches.
    //
    // Only if H5 came back no. If OpenDental is already doing the work
    // there is nothing here worth writing, and a probe that writes what
    // it does not need to is a probe that leaves mess behind.
    // =================================================================
    if (autoAttached) {
      findings.h2_attach_write = {
        question: "Does /treatplanattaches accept POST and DELETE?",
        answer: "not tested — H5 made it unnecessary",
      };
    } else {
      const targetPlan = Number(inactivePlan?.TreatPlanNum ?? 0);

      if (targetPlan === 0) {
        findings.h2_attach_write = {
          question: "Does /treatplanattaches accept POST and DELETE?",
          answer: "not tested — this patient has no Inactive plan to attach to",
        };
      } else {
        const posted = record(
          await odFetch(auth, "POST", "/treatplanattaches", {
            TreatPlanNum: targetPlan,
            ProcNum: probeProcNum,
          }),
        );

        const attachCheck = await query(
          auth,
          `SELECT TreatPlanAttachNum FROM treatplanattach ` +
            `WHERE ProcNum = ${probeProcNum} AND TreatPlanNum = ${targetPlan}`,
        );

        const postWorked = attachCheck.length > 0;
        probeAttachNum = Number(attachCheck[0]?.TreatPlanAttachNum ?? 0);

        let deleteWorked: boolean | null = null;
        let deleteDetail: unknown = null;
        let deleteHttp: number | null = null;

        if (postWorked && probeAttachNum > 0) {
          const removed = record(
            await odFetch(
              auth,
              "DELETE",
              `/treatplanattaches/${probeAttachNum}`,
            ),
          );

          deleteHttp = removed.http_status;
          deleteDetail = removed.body;

          const stillThere = await query(
            auth,
            `SELECT TreatPlanAttachNum FROM treatplanattach ` +
              `WHERE TreatPlanAttachNum = ${probeAttachNum}`,
          );

          deleteWorked = stillThere.length === 0;
          if (deleteWorked) probeAttachNum = 0;
        }

        findings.h2_attach_write = {
          question: "Does /treatplanattaches accept POST and DELETE?",
          post_answer: postWorked,
          post_http: posted.http_status,
          post_detail: posted.body,
          delete_answer: deleteWorked,
          delete_http: deleteHttp,
          delete_detail: deleteDetail,
        };
      }
    }

    // =================================================================
    // H3 — can an Active plan be created, or promoted?
    //
    // The finding on record is that POST files everything as Inactive
    // and PUT will not move it. Both halves are re-tested, because that
    // was written a long time ago and a lot has been rebuilt since.
    // =================================================================
    const planPost = record(
      await odFetch(auth, "POST", "/treatplans", {
        PatNum: patNum,
        Heading: PROBE_PLAN_HEADING,
        TPStatus: "Active",
      }),
    );

    if (ok2xx(planPost)) {
      probePlanNum = Number(
        (planPost.body as Record<string, unknown>)?.TreatPlanNum ?? 0,
      );
    }

    let filedAs = -1;
    let promotedTo = -1;
    let promoteHttp: number | null = null;
    let promoteDetail: unknown = null;

    if (probePlanNum > 0) {
      filedAs = Number(
        (await query(
          auth,
          `SELECT TPStatus FROM treatplan WHERE TreatPlanNum = ${probePlanNum}`,
        ))[0]?.TPStatus ?? -1,
      );

      // Only worth attempting if it did not land Active on its own.
      if (filedAs !== TP_STATUS_ACTIVE) {
        const promote = record(
          await odFetch(auth, "PUT", `/treatplans/${probePlanNum}`, {
            TPStatus: "Active",
          }),
        );

        promoteHttp = promote.http_status;
        promoteDetail = promote.body;

        promotedTo = Number(
          (await query(
            auth,
            `SELECT TPStatus FROM treatplan WHERE TreatPlanNum = ${probePlanNum}`,
          ))[0]?.TPStatus ?? -1,
        );
      }
    }

    findings.h3_active_plan = {
      question: "Can an Active plan be created, or promoted, via the API?",
      post_http: planPost.http_status,
      post_detail: probePlanNum > 0 ? "created" : planPost.body,
      created_plan_num: probePlanNum,
      // 0 Saved, 1 Active, 2 Inactive. Verified against Heading on a
      // live patient — this is not the order most people assume.
      filed_as: filedAs,
      filed_as_active: filedAs === TP_STATUS_ACTIVE,
      promote_attempted: filedAs !== TP_STATUS_ACTIVE && probePlanNum > 0,
      promote_http: promoteHttp,
      promote_detail: promoteDetail,
      promoted_to: promotedTo,
      promote_worked: promotedTo === TP_STATUS_ACTIVE,
      answer:
        filedAs === TP_STATUS_ACTIVE || promotedTo === TP_STATUS_ACTIVE,
    };

    return json({
      ok: true,
      office: officeRow.name,
      office_slug: officeRow.slug,
      pat_num: patNum,
      probed_by: userData.user.email,
      probed_at: new Date().toISOString(),
      findings,
      calls,
      cleanup,
    });
  } catch (caught) {
    return json({
      ok: false,
      error: caught instanceof Error ? caught.message : "Probe threw.",
      findings,
      calls,
      cleanup,
      // Stated even on the failure path so nothing created is lost.
      left_behind: {
        proc_num: probeProcNum,
        treat_plan_num: probePlanNum,
        treat_plan_attach_num: probeAttachNum,
      },
    }, 500);
  } finally {
    // =================================================================
    // Cleanup. Runs whatever happened, including on an exception.
    //
    // Order matters: the attach row goes before the procedure, and the
    // procedure before the plan, so nothing is orphaned by a failure
    // partway through.
    // =================================================================

    if (probeAttachNum > 0) {
      const removed = await odFetch(
        auth,
        "DELETE",
        `/treatplanattaches/${probeAttachNum}`,
      );
      cleanup.attach_removed = ok2xx(removed);
      cleanup.attach_num = probeAttachNum;
    }

    if (probeProcNum > 0) {
      // A procedure at TPi may refuse deletion the way EO already has.
      // If it does, it is put back to TP first and deleted from there —
      // and either way the row is read back rather than assumed gone.
      let removed = await odFetch(
        auth,
        "DELETE",
        `/procedurelogs/${probeProcNum}`,
      );

      let after = Number(
        (await query(
          auth,
          `SELECT ProcStatus FROM procedurelog WHERE ProcNum = ${probeProcNum}`,
        ))[0]?.ProcStatus ?? -1,
      );

      if (after !== PROC_STATUS_DELETED && after !== -1) {
        await odFetch(auth, "PUT", `/procedurelogs/${probeProcNum}`, {
          ProcStatus: "TP",
        });

        removed = await odFetch(
          auth,
          "DELETE",
          `/procedurelogs/${probeProcNum}`,
        );

        after = Number(
          (await query(
            auth,
            `SELECT ProcStatus FROM procedurelog WHERE ProcNum = ${probeProcNum}`,
          ))[0]?.ProcStatus ?? -1,
        );

        cleanup.procedure_needed_status_reset = true;
      }

      cleanup.procedure_removed =
        after === PROC_STATUS_DELETED || after === -1;
      cleanup.procedure_status_now = after;
      cleanup.proc_num = probeProcNum;
      cleanup.procedure_delete_http = removed.http_status;
    }

    if (probePlanNum > 0) {
      const removed = await odFetch(
        auth,
        "DELETE",
        `/treatplans/${probePlanNum}`,
      );

      const stillThere = await query(
        auth,
        `SELECT TreatPlanNum FROM treatplan WHERE TreatPlanNum = ${probePlanNum}`,
      );

      cleanup.plan_removed = stillThere.length === 0;
      cleanup.plan_num = probePlanNum;
      cleanup.plan_delete_http = removed.http_status;

      // Whether /treatplans accepts DELETE was itself unknown going in,
      // so it is reported as a finding rather than buried in cleanup.
      cleanup.plan_delete_supported = stillThere.length === 0;

      if (stillThere.length > 0) {
        cleanup.manual_step_required =
          `Treatment plan ${probePlanNum} could not be removed through the ` +
          `API. Delete "${PROBE_PLAN_HEADING}" in OpenDental by hand.`;
      }
    }
  }
});
