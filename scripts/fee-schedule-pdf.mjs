// =====================================================================
// Dental OS - Script: fee-schedule-pdf
//
// Purpose: turn a payer's PDF fee schedule into the CSV that
// fee-schedule-stage already accepts. Reads nothing but the file you
// point it at and writes nothing but the CSV you name.
//
// Path: scripts/fee-schedule-pdf.mjs
// Version: 4
// Changelog:
//   v1  Initial: coordinate-based reader, one engine for every layout seen
//       so far - Cigna, Delta Dental, MetLife and United Concordia.
//   v2  A row is a band between one code and the next, not a single line.
//       MetLife centres the code against a 2-line description and prints
//       the fee on the lower line, 5 points below the code, so reading a
//       line at a time lost 46 fees including scaling and root planing
//       and surgical extraction. Columns are now found from where the
//       codes sit, which keeps the 2-up United Concordia pages apart.
//   v3  A fee must sit in the fee column. v2 took the right-most amount
//       in the band, and Cigna prints an explanatory note among the
//       orthodontic rows - "records $121.00, placement of appliance and
//       activation $613.00" - which handed 7 codes that carry no fee at
//       all a fee of $87.00. Description now prefers the code's own
//       line and falls back to the band, so those notes stay out of it.
//   v4  A band now stops just above the next code's own line rather than
//       halfway to it, because MetLife prints the fee on the last line
//       of a wrapped description - D7252 runs to 4 lines. An amount on
//       the code's own line wins outright, which is what keeps Cigna's
//       D8210 from being called ambiguous by its ortho neighbours. The
//       last code on a page is given 3 rows and no more, so the page
//       footer stops landing in its description.
//
// Why coordinates rather than extracted text: the text layer of these
// PDFs is not in reading order. On the Cigna schedule the plain text
// extractors pair D0145 with $31.00 and with $21.00 depending on which
// one you ask, because the amount column is drawn as its own stream.
// The only thing that is reliably true is where each piece of text sits
// on the page, so every row here is assembled from x and y.
//
// Usage:
//   node scripts/fee-schedule-pdf.mjs <input.pdf> [output.csv]
//
// With no output path it writes next to the PDF with a .csv extension.
// Add --quiet to suppress the report, --json to print it as JSON.
//
// Output columns are code, description and fee, which is what
// fee-schedule-stage detects without a column_map.
//
// Read the report before uploading anything. It counts the rows it
// found and names every code it would not price: the ones with no
// amount at all, the ones priced as a breakdown of several amounts, and
// any code that appears twice with 2 different fees. None of those
// reach the CSV, so an unread row is a missing row, never a wrong one.
// =====================================================================

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

// A CDT code: D followed by 4 digits, sometimes with a trailing letter.
// Payer schedules carry no custom office codes, so this stays strict.
const CODE = /^D\d{4}[A-Za-z]?$/;

// Money as one piece: $1,234.56, $34, 1234.56
const MONEY = /^\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/;

// Codes belong to the same column when their left edges are this close.
// United Concordia prints its 2 code columns at x 37.5 and x 301, so
// anything short of that gap is the same column.
const COLUMN_TOLERANCE = 25;

// Used only for the first code on a page, which has no row above it to
// measure against.
const FALLBACK_ROW_HEIGHT = 12;

// Fees are right-aligned, so every one of them ends at the same x. How
// far off that edge an amount may sit and still count as the fee.
const FEE_EDGE_TOLERANCE = 3;

// A fee column has to be used by a real share of the rows. A stray
// amount in a footnote appears a handful of times at most.
const FEE_COLUMN_MIN_SHARE = 0.05;

// Text this close to the code counts as being on its line.
const SAME_LINE = 3;

function isCode(s) {
  return CODE.test(s.trim());
}

function moneyValue(s) {
  const t = s.trim();
  if (!MONEY.test(t)) return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function itemsByPage(file) {
  const data = new Uint8Array(readFileSync(file));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items
      .filter((i) => typeof i.str === "string" && i.str.trim())
      .map((i) => ({
        x: i.transform[4],
        y: i.transform[5],
        w: i.width ?? 0,
        s: i.str.trim(),
      }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    pages.push(items);
  }

  return pages;
}

// Group the codes on a page into columns by where their left edge sits.
// Returns each column's codes, sorted top to bottom, plus the x where
// the next column starts - the boundary a fee may not cross.
function columnsOf(codes) {
  const sorted = [...codes].sort((a, b) => a.x - b.x);
  const groups = [];

  for (const code of sorted) {
    const last = groups[groups.length - 1];
    if (last && code.x - last.x <= COLUMN_TOLERANCE) {
      last.codes.push(code);
    } else {
      groups.push({ x: code.x, codes: [code] });
    }
  }

  return groups.map((g, i) => ({
    codes: g.codes.sort((a, b) => b.y - a.y),
    endsAt: i + 1 < groups.length ? groups[i + 1].x : Infinity,
  }));
}

// Where the fee columns are, read off the whole document rather than
// guessed. Every amount ends at the right-hand edge of its column, so
// the edges that repeat across hundreds of rows are the fee columns and
// everything else is prose that happens to mention money.
function feeEdgesOf(pages) {
  const counts = new Map();

  for (const items of pages) {
    for (let i = 0; i < items.length; i++) {
      if (moneyValue(items[i].s) === null) continue;
      const edge = Math.round(items[i].x + items[i].w);
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }
  }

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const floor = Math.max(3, total * FEE_COLUMN_MIN_SHARE);

  // Neighbouring edges a point apart are the same column.
  const edges = [...counts.entries()]
    .filter(([, n]) => n >= floor)
    .map(([edge]) => edge)
    .sort((a, b) => a - b);

  return edges;
}

function onFeeEdge(item, edges) {
  const edge = item.x + item.w;
  return edges.some((e) => Math.abs(edge - e) <= FEE_EDGE_TOLERANCE);
}

// The vertical band one code owns. It runs down to just above the next
// code's own line, because a payer with a long description prints the
// fee on the last line of it - MetLife's D7252 has a 4-line description
// and its $241.00 sits well past halfway to the next code. It reaches
// only halfway up towards the code above, because that row's fee sits
// on its own first line and must not be counted twice.
// The last code on a page has no code below it to stop at, so it is
// given room for a few rows and no more. Without that its band runs to
// the foot of the page and swallows the page number and the copyright
// line into the description.
function bandOf(codes, index, rowHeight) {
  const code = codes[index];
  const above = codes[index - 1];
  const below = codes[index + 1];

  return {
    top: above ? (above.y + code.y) / 2 : code.y + rowHeight * 0.6,
    bottom: below ? below.y + SAME_LINE : code.y - rowHeight * 3,
  };
}

// The usual distance between one code and the next in a column.
function rowHeightOf(codes) {
  if (codes.length < 2) return FALLBACK_ROW_HEIGHT;

  const gaps = [];
  for (let i = 1; i < codes.length; i++) {
    gaps.push(codes[i - 1].y - codes[i].y);
  }
  gaps.sort((a, b) => a - b);

  const middle = gaps[Math.floor(gaps.length / 2)];
  return middle > 0 ? middle : FALLBACK_ROW_HEIGHT;
}

// The fee belonging to one code, plus the text between the two.
//
// `endsAt` is where this code's column stops. Without it a 2-up page
// pairs the left code with the right column's amount.
function readRow(items, code, band, endsAt, feeEdges) {
  const inBand = items
    .filter(
      (i) =>
        i !== code &&
        i.y <= band.top &&
        i.y > band.bottom &&
        i.x > code.x + code.w - 0.5 &&
        i.x < endsAt,
    )
    .sort((a, b) => a.x - b.x);

  if (!inBand.length) return null;

  // Walk in from the right-hand edge, because the fee is the last thing
  // on the row in every layout seen so far. MetLife draws the dollar
  // sign and the number as 2 separate pieces, so a bare number counts as
  // money when a lone $ sits to its left.
  const candidates = [];

  for (let i = 0; i < inBand.length; i++) {
    const value = moneyValue(inBand[i].s);
    if (value === null || !onFeeEdge(inBand[i], feeEdges)) continue;

    const parts = [inBand[i]];
    if (!inBand[i].s.includes("$") && i > 0 && inBand[i - 1].s === "$") {
      parts.push(inBand[i - 1]);
    }
    candidates.push({ value, parts });
  }

  if (!candidates.length) return null;

  // An amount on the code's own line is the fee, whatever else the band
  // caught from the rows around it. Only when the line itself is bare
  // does the rest of the band come into play, and then several amounts
  // means the code is priced as a breakdown - Cigna gives each
  // orthodontic code 4 lines, records, placement, monthly payment and
  // retention. Picking one of those would put a wrong fee into
  // OpenDental, so they are handed back for a person to decide.
  const onLineFees = candidates.filter(
    (c) => Math.abs(c.parts[0].y - code.y) <= SAME_LINE,
  );
  const chosen = onLineFees.length ? onLineFees : candidates;

  if (chosen.length > 1) {
    return { ambiguous: chosen.map((c) => c.value) };
  }

  const fee = chosen[0].value;
  const feeParts = chosen[0].parts;

  // The description is whatever sits on the code's own line. A payer
  // that centres the code against a wrapped description leaves that
  // line empty, so fall back to the whole band.
  const onLine = inBand.filter(
    (p) => !feeParts.includes(p) && Math.abs(p.y - code.y) <= SAME_LINE,
  );
  const source = onLine.length
    ? onLine
    : inBand.filter((p) => !feeParts.includes(p));

  const description = source
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((p) => p.s)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return { fee, description };
}

export async function readFeeSchedule(file) {
  const pages = await itemsByPage(file);

  const feeEdges = feeEdgesOf(pages);

  const rows = [];
  const seen = new Map();
  const duplicates = [];
  const unreadable = [];
  const ambiguous = [];

  pages.forEach((items, index) => {
    const pageNo = index + 1;

    const columns = columnsOf(items.filter((i) => isCode(i.s)));

    for (const column of columns) {
      const rowHeight = rowHeightOf(column.codes);

      for (let n = 0; n < column.codes.length; n++) {
        const item = column.codes[n];
        const band = bandOf(column.codes, n, rowHeight);
        const row = readRow(items, item, band, column.endsAt, feeEdges);
        const code = item.s.trim().toUpperCase();

        if (!row) {
          unreadable.push({ code, page: pageNo });
          continue;
        }

        if (row.ambiguous) {
          ambiguous.push({ code, page: pageNo, amounts: row.ambiguous });
          continue;
        }

        const previous = seen.get(code);
        if (previous) {
          if (previous.fee !== row.fee) {
            duplicates.push({
              code,
              page: pageNo,
              kept: previous.fee,
              ignored: row.fee,
              conflict: true,
            });
          } else {
            duplicates.push({ code, page: pageNo, kept: previous.fee, conflict: false });
          }
          continue;
        }

        const record = {
          code,
          description: row.description,
          fee: row.fee,
          page: pageNo,
        };
        seen.set(code, record);
        rows.push(record);
      }
    }
  });

  return {
    source: basename(file),
    pages: pages.length,
    feeEdges,
    rows,
    duplicates,
    unreadable,
    ambiguous,
    zeroFees: rows.filter((r) => r.fee === 0).map((r) => r.code),
  };
}

export function toCsv(rows) {
  const lines = ["code,description,fee"];
  for (const r of rows) {
    lines.push(
      [csvCell(r.code), csvCell(r.description), csvCell(r.fee.toFixed(2))].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

function report(result, outPath) {
  const conflicts = result.duplicates.filter((d) => d.conflict);

  console.log(`${result.source} - ${result.pages} pages`);
  console.log(`  ${result.rows.length} codes written to ${outPath}`);

  if (result.rows.length) {
    const fees = result.rows.map((r) => r.fee);
    const low = Math.min(...fees).toFixed(2);
    const high = Math.max(...fees).toFixed(2);
    console.log(`  fees run from $${low} to $${high}`);
    console.log(
      `  first ${result.rows[0].code} $${result.rows[0].fee.toFixed(2)}` +
        `, last ${result.rows[result.rows.length - 1].code}` +
        ` $${result.rows[result.rows.length - 1].fee.toFixed(2)}`,
    );
  }

  if (result.zeroFees.length) {
    console.log(`  ${result.zeroFees.length} codes priced at $0.00: ${result.zeroFees.join(", ")}`);
  }

  if (conflicts.length) {
    console.log(`  ${conflicts.length} codes appear twice with different fees - CHECK THESE:`);
    for (const d of conflicts) {
      console.log(`    ${d.code} page ${d.page}: kept $${d.kept.toFixed(2)}, ignored $${d.ignored.toFixed(2)}`);
    }
  }

  const repeats = result.duplicates.length - conflicts.length;
  if (repeats) {
    console.log(`  ${repeats} codes repeated with the same fee, kept once`);
  }

  if (result.unreadable.length) {
    console.log(`  ${result.unreadable.length} codes with no amount printed, left out:`);
    const list = result.unreadable.map((u) => `${u.code} (p${u.page})`).join(", ");
    console.log(`    ${list}`);
  }

  if (result.ambiguous.length) {
    console.log(
      `  ${result.ambiguous.length} codes priced as a breakdown rather than one fee,` +
        ` left out - DECIDE THESE BY HAND:`,
    );
    for (const a of result.ambiguous) {
      const amounts = a.amounts.map((v) => `$${v.toFixed(2)}`).join(", ");
      console.log(`    ${a.code} page ${a.page}: ${amounts}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const paths = args.filter((a) => !a.startsWith("--"));

  if (!paths.length) {
    console.error("Usage: node scripts/fee-schedule-pdf.mjs <input.pdf> [output.csv]");
    process.exit(1);
  }

  const input = paths[0];
  const output = paths[1] ?? input.replace(/\.pdf$/i, "") + ".csv";

  const result = await readFeeSchedule(input);
  writeFileSync(output, toCsv(result.rows), "utf8");

  if (flags.has("--json")) {
    console.log(JSON.stringify({ ...result, output }, null, 2));
  } else if (!flags.has("--quiet")) {
    report(result, output);
  }

  const conflicts = result.duplicates.filter((d) => d.conflict).length;
  if (!result.rows.length || conflicts) process.exit(2);
}

// Windows spells the entry path C:\... while import.meta.url spells it
// file:///C:/... - pathToFileURL is what makes the 2 comparable.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
