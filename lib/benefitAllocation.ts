// Benefit allocation — v2
//
// Changelog:
//   v2  The deductible respects category waivers. v1 took it from the
//       first covered row, which matched OpenDental's total but not its
//       rows: four x-rays came out at $0 and $2 instead of $13 each,
//       while the crown that should have absorbed the $50 kept its full
//       $174.50. The totals agreed only because the errors cancelled.
//       A plan states its waivers as one benefit row per category, and
//       those are now read and honoured.
//   v1  First cut. Applies the remaining annual maximum in plan order.
//
// Applies a plan's remaining annual maximum across planned procedures,
// in the order OpenDental would consume it.
//
// ---------------------------------------------------------------------
// Why this exists
//
// OpenDental prices each procedure against the patient's plan and then
// caps the total at the annual maximum. Both steps happen inside the
// Windows client, and the result is written to the claimproc rows. The
// API has no way to make that recalculation happen: the published
// resource list has no recalculate method, and ChartModules offers only
// ProgNotes, PatientInfo and PlannedAppts.
//
// So the moment a coordinator changes what is accepted, the stored
// figures describe an ordering that no longer exists. On a plan that
// runs past the maximum this is not a rounding difference. Measured on
// a live record: uncapped estimates summed to $2,078.20 against a
// $1,500 maximum, a $578.20 gap that lands entirely on the patient.
//
// ---------------------------------------------------------------------
// What this does and does not decide
//
// It does not decide what a carrier covers. Every per-procedure figure
// comes from OpenDental's BaseEst — its category percentages, its
// allowed fees, its exclusions, its frequency and waiting-period logic,
// all already applied. OpenDental's own source states that BaseEst is
// final before limitations are applied and that only InsEstTotal
// changes afterwards, which is exactly why BaseEst survives on rows the
// maximum reduced to nothing.
//
// This only subtracts. It walks the rows in order, hands each one what
// is left of the maximum, and stops when there is none. That is
// arithmetic over OpenDental's adjudication, not a second opinion about
// it.
//
// ---------------------------------------------------------------------
// What it deliberately does not handle
//
//   - Category-specific maximums and deductibles. Reproducing those
//     means reproducing OpenDental's limitation engine, which reads
//     each patient's full claim history and family accumulators.
//   - Coordination of benefits. A secondary plan's estimate is passed
//     through as OpenDental left it, and the result is flagged so the
//     screen can say the ceiling was applied to the primary only.
//   - Service-year plans. The benefit year is taken as the calendar
//     year, which is what both offices use.
//
// Every one of those makes the answer an estimate rather than a
// promise, which is what a treatment plan is. The caller is expected to
// label it as such.

// A row as the plan screen holds it. Only the fields allocation needs.
export type AllocatableRow = {
  od_id: number;
  // OpenDental's estimate before any limitation — the uncapped figure.
  pri_base: number;
  sec_base: number;
  // What OpenDental currently has stored, capped for whatever ordering
  // was in force when it last recalculated.
  pri_ins: number;
  sec_ins: number;
  write_off: number;
  fee: number;
  // True when somebody typed a figure over the estimate by hand.
  has_override: boolean;
  // Whether insurance applies to this procedure at all.
  covered: boolean;
  // The coverage category OpenDental puts this procedure in. Decides
  // whether the plan's deductible applies to it — a plan charging $50
  // will usually waive it for Diagnostic and Preventive, and says so
  // with a benefit row per category.
  cov_cat_num: number;
};

export type CategoryDeductible = {
  cov_cat_num: number;
  category_name: string;
  amount: number;
};

export type PlanBenefit = {
  plan_num: number;
  ordinal: number;
  annual_max: number | null;
  deductible: number | null;
  // Categories the plan states a different deductible for. Usually the
  // waivers: Diagnostic and Preventive at zero.
  category_deductibles: CategoryDeductible[];
  paid_this_year: number;
  deductible_used: number;
  remaining_max: number | null;
};

export type AllocatedRow = {
  od_id: number;
  // What this row is estimated to receive once the ceiling is applied.
  pri_ins: number;
  sec_ins: number;
  pat: number;
  // The deductible taken from this row, if it was the one to take it.
  deductible: number;
  // Set when the maximum ran out at or before this row. The screen
  // shows a reason rather than an unexplained zero.
  limited: boolean;
  // True when this row was left exactly as OpenDental had it, because
  // a human had overridden something on it.
  untouched: boolean;
};

export type Allocation = {
  rows: AllocatedRow[];
  totals: {
    fee: number;
    pri_ins: number;
    sec_ins: number;
    write_off: number;
    pat: number;
    deductible: number;
  };
  // Whether the ceiling actually changed anything. When false, the
  // screen should present OpenDental's figures unqualified.
  applied: boolean;
  // The maximum used, and what was left before this plan was priced.
  annual_max: number | null;
  remaining_max: number | null;
  // How much estimated benefit exceeded what remains. Zero when the
  // plan fits.
  over_by: number;
  // Set when a secondary plan exists, because the ceiling was applied
  // to the primary alone.
  secondary_present: boolean;
};

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Allocate the remaining annual maximum across rows, in the order given.
 *
 * The caller supplies rows already sorted the way OpenDental orders a
 * treatment plan — unprioritised last, then the priority definition's
 * ItemOrder — because that is the order OpenDental consumes benefit in,
 * and the whole point is to match it.
 */
export function allocateBenefit(
  rows: AllocatableRow[],
  benefits: PlanBenefit[],
): Allocation {
  const primary = benefits.find((b) => b.ordinal <= 1) ?? null;
  const secondaryPresent = benefits.some((b) => b.ordinal > 1);

  const totalFee = round(rows.reduce((sum, r) => sum + r.fee, 0));
  const totalWriteOff = round(rows.reduce((sum, r) => sum + r.write_off, 0));

  // No plan, or a plan with no stated maximum. There is no ceiling to
  // apply, so OpenDental's figures stand exactly as they are.
  if (primary === null || primary.remaining_max === null) {
    return passThrough(rows, totalFee, totalWriteOff, {
      annual_max: primary?.annual_max ?? null,
      remaining_max: primary?.remaining_max ?? null,
      secondary_present: secondaryPresent,
    });
  }

  // The deductible is not inside BaseEst, and it does not come off the
  // estimate either. OpenDental subtracts it from the fee and then
  // applies the percentage — its own source says the deductible is
  // always subtracted before the percentage is calculated.
  //
  // The difference is not academic. On a $349 crown at 50% with a $50
  // deductible, taking it off the estimate gives $124.50; taking it off
  // the fee first gives $149.50, which is what OpenDental stores. The
  // patient is $25 out either way, and in their favour is no better
  // than against.
  //
  // So the percentage has to be recovered from BaseEst and the fee
  // rather than assumed, because the fee OpenDental used may be an
  // allowed amount rather than the office's own.
  const deductibleOwing = primary.deductible === null
    ? 0
    : Math.max(0, round(primary.deductible - primary.deductible_used));

  // Categories the plan waives the deductible for, or charges a
  // different one for. Read from the plan, never assumed: nothing here
  // decides that x-rays are exempt, the plan does.
  const categoryDeductible = new Map<number, number>();
  for (const c of primary.category_deductibles) {
    categoryDeductible.set(c.cov_cat_num, c.amount);
  }

  // Whether the deductible applies to a procedure in this category.
  // A category with a stated deductible of zero is a waiver — the
  // common case, and the reason a $13 x-ray keeps its full estimate
  // while the crown behind it absorbs the $50.
  const deductibleApplies = (covCatNum: number): boolean => {
    const stated = categoryDeductible.get(covCatNum);
    return stated === undefined || stated > 0;
  };

  let remaining = Math.max(0, primary.remaining_max);
  let deductibleLeft = deductibleOwing;

  // What the uncapped estimates come to, for reporting how far over the
  // plan runs. Rows a human has overridden are counted at their stored
  // value, since that is what they will actually be.
  const wanted = round(
    rows.reduce(
      (sum, r) => sum + (r.has_override ? r.pri_ins : r.pri_base),
      0,
    ),
  );

  let limitHit = false;

  const allocated: AllocatedRow[] = rows.map((row) => {
    // Not billed to insurance. Nothing to allocate, and it does not
    // consume the maximum.
    if (!row.covered) {
      return {
        od_id: row.od_id,
        pri_ins: 0,
        sec_ins: 0,
        pat: round(row.fee - row.write_off),
        deductible: 0,
        limited: false,
        untouched: false,
      };
    }

    // A human decided this row. It is passed through untouched, and it
    // still consumes benefit, because the carrier's maximum does not
    // care who typed the number.
    if (row.has_override) {
      remaining = Math.max(0, round(remaining - row.pri_ins));

      return {
        od_id: row.od_id,
        pri_ins: row.pri_ins,
        sec_ins: row.sec_ins,
        pat: round(row.fee - row.pri_ins - row.sec_ins - row.write_off),
        deductible: 0,
        limited: false,
        untouched: true,
      };
    }

    // The deductible comes off this procedure's covered amount before
    // the percentage has any more to give. BaseEst already has the
    // percentage in it, so the deductible is taken from the estimate
    // directly — which is what OpenDental's own figures show.
    // The share of the fee this plan pays, recovered from figures
    // OpenDental produced rather than from the plan's stated
    // percentage. BaseEst divided by fee gives the effective rate with
    // any allowed-amount reduction already inside it.
    const rate = row.fee > 0 ? row.pri_base / row.fee : 0;

    const takeDeductible = deductibleApplies(row.cov_cat_num)
      ? Math.min(deductibleLeft, row.fee)
      : 0;
    deductibleLeft = round(deductibleLeft - takeDeductible);

    // Deductible off the fee, then the rate — OpenDental's order.
    const afterDeductible = round((row.fee - takeDeductible) * rate);

    // The ceiling. A row gets what it is owed or what is left, and the
    // rows after it get nothing.
    const granted = Math.min(afterDeductible, remaining);
    remaining = round(remaining - granted);

    if (granted < afterDeductible) limitHit = true;

    return {
      od_id: row.od_id,
      pri_ins: round(granted),
      // Secondary is passed through. Applying a second plan's maximum
      // means coordinating two carriers, which is a different problem
      // and not one to guess at.
      sec_ins: row.sec_ins,
      pat: round(row.fee - granted - row.sec_ins - row.write_off),
      deductible: round(takeDeductible),
      limited: granted < afterDeductible,
      untouched: false,
    };
  });

  const totals = allocated.reduce(
    (acc, r) => ({
      fee: totalFee,
      pri_ins: acc.pri_ins + r.pri_ins,
      sec_ins: acc.sec_ins + r.sec_ins,
      write_off: totalWriteOff,
      pat: acc.pat + r.pat,
      deductible: acc.deductible + r.deductible,
    }),
    {
      fee: totalFee,
      pri_ins: 0,
      sec_ins: 0,
      write_off: totalWriteOff,
      pat: 0,
      deductible: 0,
    },
  );

  return {
    rows: allocated,
    totals: {
      fee: round(totals.fee),
      pri_ins: round(totals.pri_ins),
      sec_ins: round(totals.sec_ins),
      write_off: round(totals.write_off),
      pat: round(totals.pat),
      deductible: round(totals.deductible),
    },
    applied: true,
    annual_max: primary.annual_max,
    remaining_max: primary.remaining_max,
    over_by: limitHit
      ? Math.max(0, round(wanted - primary.remaining_max))
      : 0,
    secondary_present: secondaryPresent,
  };
}

// OpenDental's figures, unchanged, in the shape the caller expects.
function passThrough(
  rows: AllocatableRow[],
  totalFee: number,
  totalWriteOff: number,
  meta: {
    annual_max: number | null;
    remaining_max: number | null;
    secondary_present: boolean;
  },
): Allocation {
  const allocated: AllocatedRow[] = rows.map((row) => ({
    od_id: row.od_id,
    pri_ins: row.pri_ins,
    sec_ins: row.sec_ins,
    pat: round(row.fee - row.pri_ins - row.sec_ins - row.write_off),
    deductible: 0,
    limited: false,
    untouched: true,
  }));

  return {
    rows: allocated,
    totals: {
      fee: totalFee,
      pri_ins: round(allocated.reduce((s, r) => s + r.pri_ins, 0)),
      sec_ins: round(allocated.reduce((s, r) => s + r.sec_ins, 0)),
      write_off: totalWriteOff,
      pat: round(allocated.reduce((s, r) => s + r.pat, 0)),
      deductible: 0,
    },
    applied: false,
    annual_max: meta.annual_max,
    remaining_max: meta.remaining_max,
    over_by: 0,
    secondary_present: meta.secondary_present,
  };
}
