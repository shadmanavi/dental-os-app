// Consent form PDF — v1
//
// Renders a signed consent form as a PDF for filing into OpenDental's
// Imaging module, under the "Consent Forms" category.
//
// Changelog:
//   v1  First cut. Reuses the treatment plan PDF's letterhead block
//       (officeLines, formatPhone) and its signature-block layout, so
//       a document filed by this feature reads as the same family as
//       the treatment plan already in the chart, not a foreign shape.
//
// Design notes:
//   - The body text is whatever OpenDental's own sheetdef carries for
//     that form (pulled live by od-consent's get_form_text action) —
//     these are the insurance-approved forms, so the words are quoted,
//     never invented here.
//   - No SigBox, no OpenDental Sheet — this document has nothing to do
//     with OpenDental's own Sheets mechanism. It is a plain PDF with an
//     image of a signature on it, filed as a Document. See
//     SignaturePad.tsx and docs/status.md for why: the REST API cannot
//     write into a SigBox field on any OpenDental version these offices
//     run, and a local desktop agent was ruled out as too much ongoing
//     maintenance.
//   - The signature is drawn at its natural aspect ratio, same rule as
//     the treatment plan PDF — stretching it to fit a box makes it
//     look forged.

import { jsPDF } from "jspdf";
import { officeLines, type PlanOffice } from "@/lib/treatmentPlanPdf";

export type ConsentProcedureLine = {
  code: string;
  tooth: string;
  description: string;
};

export type ConsentPdfInput = {
  office: PlanOffice;
  heading: string; // the form's own Description, e.g. "Prosthodontic Treatment-Fixed Consent"
  patientName: string;
  patientDob: string;
  patientNumber: number;
  presenterName: string;
  signDate: string;
  procedures: ConsentProcedureLine[];
  bodyParagraphs: string[];
  // The form's own fillable field, already resolved to a label and a
  // value. Null when the form carries no such field at all — most of
  // them don't, and nothing prints in that case.
  field: { label: string; value: string } | null;
  signatureDataUrl: string | null;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const MARGIN_BOTTOM = 72;
const BODY_WIDTH = PAGE_W - MARGIN_X * 2;
const LINE = 13;

function ensureRoom(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE_H - MARGIN_BOTTOM) return y;
  doc.addPage();
  return 54;
}

export function buildConsentPdf(input: ConsentPdfInput): {
  base64: string;
  pageCount: number;
} {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  // ---- Header: same three-column shape as the treatment plan PDF ----
  const HEADER_TOP = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(input.office.name, MARGIN_X, HEADER_TOP);

  let leftY = HEADER_TOP;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const line of officeLines(input.office)) {
    leftY += 10;
    doc.text(line, MARGIN_X, leftY);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const headingLines = doc.splitTextToSize(input.heading, 220);
  doc.text(headingLines, PAGE_W / 2, HEADER_TOP, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`PT # ${input.patientNumber}`, PAGE_W - MARGIN_X, HEADER_TOP, { align: "right" });
  let rightY = HEADER_TOP;
  if (input.presenterName !== "") {
    rightY += 11;
    doc.text(`Presented by: ${input.presenterName}`, PAGE_W - MARGIN_X, rightY, {
      align: "right",
    });
  }
  rightY += 11;
  doc.text(input.signDate, PAGE_W - MARGIN_X, rightY, { align: "right" });

  const headingBlockHeight = headingLines.length * 14;
  let y = Math.max(leftY, rightY, HEADER_TOP + headingBlockHeight) + 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`${input.patientName}, DOB ${input.patientDob}`, PAGE_W / 2, y, {
    align: "center",
  });
  y += 22;

  // ---- Procedures this form covers ----
  if (input.procedures.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Procedure(s)", MARGIN_X, y);
    y += 12;

    doc.setFont("helvetica", "normal");
    for (const proc of input.procedures) {
      const label = proc.tooth === ""
        ? `${proc.code} — ${proc.description}`
        : `${proc.code} #${proc.tooth} — ${proc.description}`;
      const lines = doc.splitTextToSize(label, BODY_WIDTH - 10);
      y = ensureRoom(doc, y, lines.length * LINE);
      doc.text(lines, MARGIN_X + 10, y);
      y += lines.length * LINE;
    }
    y += 12;
  }

  // ---- The form's own body text, quoted from OpenDental ----
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  for (const paragraph of input.bodyParagraphs) {
    if (paragraph.trim() === "") {
      y += LINE * 0.6;
      continue;
    }
    const lines = doc.splitTextToSize(paragraph, BODY_WIDTH);
    y = ensureRoom(doc, y, lines.length * LINE);
    doc.text(lines, MARGIN_X, y);
    y += lines.length * LINE + 4;
  }

  // ---- The form's own field, e.g. "Tooth Number(s): 2, 3" ----
  if (input.field !== null && input.field.value.trim() !== "") {
    y += 10;
    y = ensureRoom(doc, y, LINE + 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(`${input.field.label}: ${input.field.value}`, MARGIN_X, y);
    doc.setFont("helvetica", "normal");
    y += LINE + 8;
  }

  // ---- Signature — same shape as the treatment plan PDF ----
  y = ensureRoom(doc, y, 90);
  y += 30;

  if (input.signatureDataUrl !== null) {
    const props = doc.getImageProperties(input.signatureDataUrl);
    const drawWidth = 200;
    const drawHeight = Math.min(60, (props.height / props.width) * drawWidth);
    doc.addImage(
      input.signatureDataUrl,
      "PNG",
      MARGIN_X + 16,
      y - drawHeight,
      drawWidth,
      drawHeight,
    );
  }

  doc.setFontSize(9);
  doc.text("X", MARGIN_X, y - 1);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_X + 12, y + 2, MARGIN_X + 300, y + 2);
  doc.setFontSize(8);
  doc.text("Patient Signature", MARGIN_X + 12, y + 14);
  doc.text(`Date: ${input.signDate}`, MARGIN_X + 12, y + 32);

  const uri = doc.output("datauristring");
  const comma = uri.indexOf(",");

  return {
    base64: comma === -1 ? uri : uri.slice(comma + 1),
    pageCount: doc.getNumberOfPages(),
  };
}
