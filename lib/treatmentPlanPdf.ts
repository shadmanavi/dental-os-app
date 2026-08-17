// Treatment plan PDF — v7
//
// Renders the plan the patient just agreed to, with their signature on
// it, and hands back base64 for filing into OpenDental's Imaging module.
//
// Changelog:
//   v7  One field per line, and no fax.
//
//       The block reads name, street, city/state/zip, phone, email —
//       five lines, one thing on each. Phone and email shared a line
//       with the fax in v6, separated by dots, which is how a website
//       footer reads rather than how letterhead reads.
//
//       The fax is gone from the document entirely. Both practices
//       share one fax number, patients do not fax treatment plans back,
//       and a line nobody uses is a line that costs table height. The
//       column stays in public.offices and od_sync_offices still fills
//       it — dropping it from the page is not the same as throwing the
//       data away, and putting it back is a one-line change.
//
//   v6  The letterhead moves to the top left.
//
//       It was centred under the title, stacked above the patient's
//       name. Left is where letterhead belongs on a printed document
//       and where an eye looks for it, and it also uses space that was
//       already empty: the top right corner has carried the patient
//       number, provider and presenter since v3, and the top left
//       carried nothing at all.
//
//       The title stays centred and the patient's name now sits below
//       both corner blocks rather than below a centred stack, so the
//       header is three columns wide instead of one tall one. That
//       bought back roughly a quarter inch of table height, which on a
//       plan with many lines is a row.
//
//       Nothing about the content changed — same fields, same order,
//       same rule that an empty field prints nothing.
//
//   v5  The letterhead is a full office block rather than a name and an
//       empty phone string.
//
//       The two fields it replaces are gone entirely: a single office
//       object now carries name, street, city/state/zip, phone, fax and
//       email. The caller passes the office row, and every value in it
//       originates in OpenDental's own preference table, so an office
//       that moves or changes its number updates OpenDental and this
//       document follows. Nothing on this letterhead is typed by a
//       person.
//
//       The phone was being passed as an empty string at the only call
//       site, which printed a blank line where the number belonged.
//       That is the bug this closes.
//
//       Empty fields consume no vertical space. An office with no fax
//       gets a shorter header, not a header with a gap in it.
//
//       The phone is formatted here rather than in the database.
//       What OpenDental stores is ten digits; what a patient reads is
//       (562) 803-1600. Storing the pretty version would mean the
//       database no longer matched its source.
//
//   v4  The practice's acceptance wording sits above the signature, and
//       the date line is ruled when nobody has signed.
//
//       The paragraph is the office's own, the same one OpenDental
//       prints at the foot of its treatment plan. It goes directly
//       above the line rather than into the estimate disclaimer box:
//       what a person signs is whatever is immediately above their pen,
//       and this is the paragraph the office wants acknowledged.
//
//       The line is now marked with an X at its start, matching the
//       printed form the office already uses.
//
//       The date is printed only on a copy that carries a signature. An
//       unsigned plan goes home to be signed by hand, and a date
//       already on it would be the day the plan was discussed rather
//       than the day it was agreed to.
//
//   v3  One signature line, not two, and the presentation date moves
//       into the header — from two places to one.
//
//       The second line said "Presented by" with the presenter's name
//       typed above it. Nobody ever signed it. A ruled line with a name
//       printed over it reads as a signature at a glance, which makes
//       the document claim something that did not happen — worse than
//       having no line at all. Who presented the plan is a fact, and
//       facts belong in the header.
//
//       The date now sits under the presenter's name, top right. A plan
//       is a conversation held on a day, and a patient returning months
//       later needs to see which day without reading the fee table.
//
//       Whether a doctor should sign a treatment plan is a question for
//       the office and is deliberately left unanswered here. Nothing is
//       drawn for a signature nobody has decided to ask for.
//
//   v2  The header says "Presenter:" rather than "Presented by:",
//       matching what the office calls the person who sat with the
//       patient. Nothing else changed.
//   v1  First cut. Mirrors the column set OpenDental prints.
//
// Design notes:
//   - The layout deliberately follows OpenDental's own printed plan:
//     the same columns (Priority, Tooth, Surf, Code, Description, Fee,
//     Allowed, Pri Ins, Sec Ins, Pat), a total row, the practice's
//     disclaimer, then signature lines. The office already reads that
//     shape, and a document filed in the chart should not look foreign
//     beside the ones already there.
//   - No money is calculated here. Every figure is passed in, having
//     come from OpenDental. This file formats and nothing more.
//   - Rows are measured before they are drawn, because a long
//     description wraps to two lines and a row that would cross the
//     bottom margin has to start a new page instead of running off it.
//   - The signature is drawn as an image at its natural aspect ratio.
//     Stretching a signature to fit a box makes it look forged.

import { jsPDF } from "jspdf";

// The practice's acceptance wording. Exported so the screen that
// captures the signature can show the same words the document carries —
// a patient signing on a tablet should be able to read what they are
// agreeing to without asking for the printout.
export const CONSENT_TEXT =
  "Coverage may be different if your deductible has not been met, " +
  "annual maximum has been met, your plan has changed, or if your " +
  "coverage table is lower than average. There is a cancellation fee " +
  "of $250 or whatever the 3rd party financing charge is (whichever " +
  "is greater) to cancel this contract. I acknowledge the additional " +
  "charges noted above are for co-payments, optional, or upgraded " +
  "treatment not covered by my insurance company.";

export type PlanRow = {
  priority: string;
  tooth: string;
  surf: string;
  code: string;
  description: string;
  fee: number;
  allowed: number | null; // null prints as "X" — not a covered benefit
  priIns: number;
  secIns: number;
  pat: number;
};

export type PlanTotals = {
  fee: number;
  allowed: number;
  priIns: number;
  secIns: number;
  pat: number;
};

// The letterhead block. Every field comes from OpenDental's preference
// table by way of public.offices, and every one of them is allowed to be
// empty — an office that has not filled in its fax simply has no fax
// line on the document.
export type PlanOffice = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  email: string;
};

export type PlanInput = {
  office: PlanOffice;
  heading: string;
  patientName: string;
  patientDob: string;
  patientNumber: number;
  providerName: string;
  presenterName: string;
  planDate: string;
  rows: PlanRow[];
  totals: PlanTotals;
  disclaimer: string;
  // The acceptance wording printed above the signature line. Defaults
  // to the practice's own; passed in only if an office ever needs
  // different words.
  consent?: string;
  signatureDataUrl: string | null;
  financingNote?: string;
};

type Column = {
  key: keyof PlanRow | "spacer";
  label: string;
  x: number;
  width: number;
  align: "left" | "right";
};

// Letter portrait, in points.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 36;
const MARGIN_BOTTOM = 72;
const LINE = 11;

const COLUMNS: Column[] = [
  { key: "priority", label: "Priority", x: 36, width: 54, align: "left" },
  { key: "tooth", label: "Tth", x: 90, width: 26, align: "left" },
  { key: "surf", label: "Surf", x: 116, width: 30, align: "left" },
  { key: "code", label: "Code", x: 146, width: 42, align: "left" },
  { key: "description", label: "Description", x: 188, width: 168, align: "left" },
  { key: "fee", label: "Fee", x: 356, width: 46, align: "right" },
  { key: "allowed", label: "Allowed", x: 402, width: 48, align: "right" },
  { key: "priIns", label: "Pri Ins", x: 450, width: 44, align: "right" },
  { key: "secIns", label: "Sec Ins", x: 494, width: 42, align: "right" },
  { key: "pat", label: "Pat", x: 536, width: 40, align: "right" },
];

// Ten digits become (562) 803-1600. Anything that is not ten digits is
// printed exactly as it was stored — an extension, an international
// number or a typo is the office's to fix in OpenDental, and quietly
// reformatting it here would hide it.
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return raw.trim();
}

// The address as printed, under the office name: street, then
// city/state/zip, then phone, then email — one field per line. Blank
// fields are dropped rather than printed, so the block tightens up
// instead of leaving holes in it.
function officeLines(office: PlanOffice): string[] {
  const lines: string[] = [];

  const street = [office.addressLine1, office.addressLine2]
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .join(", ");
  if (street !== "") lines.push(street);

  const region = [office.state.trim(), office.postalCode.trim()]
    .filter((s) => s !== "")
    .join(" ");
  const cityLine = [office.city.trim(), region]
    .filter((s) => s !== "")
    .join(", ");
  if (cityLine !== "") lines.push(cityLine);

  if (office.phone.trim() !== "") lines.push(formatPhone(office.phone));
  if (office.email.trim() !== "") lines.push(office.email.trim());

  return lines;
}

const money = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function drawCell(
  doc: jsPDF,
  text: string,
  col: Column,
  y: number,
) {
  if (col.align === "right") {
    doc.text(text, col.x + col.width - 2, y, { align: "right" });
  } else {
    doc.text(text, col.x + 1, y);
  }
}

// The header is three columns: the office at the left, the title
// centred, and the patient's number, provider and presenter at the
// right. The patient's name goes underneath all three, on whichever
// column ran longest.
const HEADER_TOP = 48;

function header(doc: jsPDF, input: PlanInput): number {
  // ---- Left: the letterhead ----
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

  // ---- Centre: the title ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(input.heading, PAGE_W / 2, HEADER_TOP, { align: "center" });

  // ---- Right: who and when ----
  // Patient number and provider sit to the right, as OpenDental prints them.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`PT # ${input.patientNumber}`, PAGE_W - MARGIN_X, 48, {
    align: "right",
  });
  doc.text(`Provider: ${input.providerName}`, PAGE_W - MARGIN_X, 59, {
    align: "right",
  });
  if (input.presenterName !== "") {
    doc.text(`Presenter: ${input.presenterName}`, PAGE_W - MARGIN_X, 70, {
      align: "right",
    });
    // The date the plan was presented, under the name of whoever
    // presented it. The two belong together: a plan is a conversation
    // on a day, and a patient coming back six months later needs to
    // know which day it was.
    doc.text(input.planDate, PAGE_W - MARGIN_X, 81, { align: "right" });
  }

  // ---- Under all three: the patient ----
  // Whichever column ran longest decides where this sits, so a long
  // letterhead pushes the name down rather than printing over it. The
  // right column ends at 81 when a presenter is named and at 70 when
  // one is not.
  const rightY = input.presenterName === "" ? 70 : 81;
  const y = Math.max(leftY, rightY, HEADER_TOP) + 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(
    `${input.patientName}, DOB ${input.patientDob}`,
    PAGE_W / 2,
    y,
    { align: "center" },
  );

  // The date used to print here too, under the patient's name. It is
  // in the right-hand block now, under the presenter, and one date on a
  // one-page document is enough.
  doc.setFont("helvetica", "normal");

  return y + 18;
}

function columnHeadings(doc: jsPDF, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);

  for (const col of COLUMNS) {
    drawCell(doc, col.label, col, y);
  }

  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, y + 3, PAGE_W - MARGIN_X, y + 3);

  doc.setFont("helvetica", "normal");
  return y + 13;
}

export function buildTreatmentPlanPdf(input: PlanInput): {
  base64: string;
  pageCount: number;
} {
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  let y = header(doc, input);
  y = columnHeadings(doc, y);

  doc.setFontSize(8);

  for (const row of input.rows) {
    const descCol = COLUMNS.find((c) => c.key === "description");
    const descWidth = descCol === undefined ? 168 : descCol.width - 2;
    const descLines = doc.splitTextToSize(row.description, descWidth);
    const rowHeight = Math.max(1, descLines.length) * LINE;

    if (y + rowHeight > PAGE_H - MARGIN_BOTTOM) {
      doc.addPage();
      y = 48;
      y = columnHeadings(doc, y);
    }

    for (const col of COLUMNS) {
      let text = "";

      switch (col.key) {
        case "description":
          // Wrapped separately, below.
          continue;
        case "fee":
          text = money(row.fee);
          break;
        case "allowed":
          text = row.allowed === null ? "X" : money(row.allowed);
          break;
        case "priIns":
          text = money(row.priIns);
          break;
        case "secIns":
          text = money(row.secIns);
          break;
        case "pat":
          text = money(row.pat);
          break;
        case "priority":
          text = row.priority;
          break;
        case "tooth":
          text = row.tooth;
          break;
        case "surf":
          text = row.surf;
          break;
        case "code":
          text = row.code;
          break;
        default:
          text = "";
      }

      drawCell(doc, text, col, y);
    }

    if (descCol !== undefined) {
      doc.text(descLines, descCol.x + 1, y);
    }

    y += rowHeight;
  }

  // ---- Total ----
  if (y + 24 > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
    y = 48;
  }

  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, y - 4, PAGE_W - MARGIN_X, y - 4);
  y += 8;

  doc.setFont("helvetica", "bold");
  for (const col of COLUMNS) {
    let text = "";
    switch (col.key) {
      case "priority":
        text = "Total";
        break;
      case "fee":
        text = money(input.totals.fee);
        break;
      case "allowed":
        text = money(input.totals.allowed);
        break;
      case "priIns":
        text = money(input.totals.priIns);
        break;
      case "secIns":
        text = money(input.totals.secIns);
        break;
      case "pat":
        text = money(input.totals.pat);
        break;
      default:
        text = "";
    }
    if (text !== "") drawCell(doc, text, col, y);
  }
  doc.setFont("helvetica", "normal");
  y += 24;

  // ---- Financing, when the coordinator arranged one ----
  if (input.financingNote !== undefined && input.financingNote !== "") {
    const noteLines = doc.splitTextToSize(
      input.financingNote,
      PAGE_W - MARGIN_X * 2 - 12,
    );
    const boxHeight = noteLines.length * LINE + 14;

    if (y + boxHeight > PAGE_H - MARGIN_BOTTOM) {
      doc.addPage();
      y = 48;
    }

    doc.setLineWidth(0.5);
    doc.rect(MARGIN_X, y - 10, PAGE_W - MARGIN_X * 2, boxHeight);
    doc.text(noteLines, MARGIN_X + 6, y + 2);
    y += boxHeight + 12;
  }

  // ---- Disclaimer ----
  const lines = doc.splitTextToSize(
    input.disclaimer,
    PAGE_W - MARGIN_X * 2 - 12,
  );
  const disclaimerHeight = lines.length * LINE + 14;

  if (y + disclaimerHeight > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
    y = 48;
  }

  doc.setFontSize(8);
  doc.setLineWidth(0.5);
  doc.rect(MARGIN_X, y - 10, PAGE_W - MARGIN_X * 2, disclaimerHeight);
  doc.text(lines, MARGIN_X + 6, y + 2);
  y += disclaimerHeight + 30;

  // ---- Acceptance ----
  // Kept out of the disclaimer box above and put here instead, because
  // this is the paragraph the signature is a signature to. The box
  // above explains why an estimate is an estimate; this is what the
  // patient is agreeing to.
  const consentText = input.consent ?? CONSENT_TEXT;
  const consentLines = doc.splitTextToSize(
    consentText,
    PAGE_W - MARGIN_X * 2,
  );
  const consentHeight = consentLines.length * LINE;

  // The acceptance and the line it belongs to are measured together and
  // move together. A paragraph at the foot of one page with the
  // signature at the head of the next is a document nobody read.
  if (y + consentHeight + 90 > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
    y = 72;
  }

  doc.setFontSize(8);
  doc.text(consentLines, MARGIN_X, y);
  y += consentHeight + 34;

  // ---- Signature ----
  if (input.signatureDataUrl !== null) {
    const props = doc.getImageProperties(input.signatureDataUrl);
    const drawWidth = 200;
    const drawHeight = Math.min(
      60,
      (props.height / props.width) * drawWidth,
    );
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

  // A date is printed only where a signature was actually captured. An
  // unsigned copy is going home to be signed by hand, and the day it
  // was discussed is not the day it was agreed to.
  if (input.signatureDataUrl !== null) {
    doc.text(`Date: ${input.planDate}`, MARGIN_X + 12, y + 32);
  } else {
    doc.text("Date:", MARGIN_X + 12, y + 32);
    doc.setLineWidth(0.6);
    doc.line(MARGIN_X + 42, y + 34, MARGIN_X + 200, y + 34);
  }

  // There was a second signature line here for the presenter. It has
  // gone: nobody was signing it, and a printed line with a name typed
  // above it is not a signature — it reads as one at a glance, which is
  // worse than not having it. Who presented the plan is stated in the
  // header, where it is a fact rather than an unmade mark.
  //
  // Whether a doctor should sign a treatment plan at all is an open
  // question for the office, not a layout decision. Nothing is drawn
  // for one until that is answered.

  // jsPDF hands back a data URI; OpenDental wants the payload alone.
  const uri = doc.output("datauristring");
  const comma = uri.indexOf(",");

  return {
    base64: comma === -1 ? uri : uri.slice(comma + 1),
    pageCount: doc.getNumberOfPages(),
  };
}
