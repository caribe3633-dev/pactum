import { TxnDate, TransactionContext, prepareTransactionGroup } from './moneyEntry';
import { CashFlowCurrency } from './cashFlowDates';

/**
 * Cash-flow currency conversion — one shape, two writers.
 * Destination: src/lib/cashFlowMoney.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 1 · TASK 2
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 *   `pactum-cashflow-{projectId}` has TWO writers:
 *
 *     CashFlowModule  — the ledger the user edits directly
 *     CertsModule:136 — pushes a certified IPC across as Cash In
 *
 *   Adding currency fields in one and not the other would mean a row's
 *   metadata depended on which screen created it. Both now call the same
 *   two functions here, so a row is the same shape whoever wrote it.
 *
 * ONE RATE PER ROW, NOT PER FIELD
 *
 *   `in` and `out` are converted through prepareTransactionGroup, which
 *   resolves the rate ONCE and applies it to both. Converting each
 *   separately would let a rounding difference break `net = in - out`
 *   after conversion — the same reasoning that already governs a
 *   certificate's gross / retention / net.
 *
 * THE RATE IS FROZEN, NEVER RECOMPUTED
 *
 *   Conversion happens at SAVE time against the row's own FX snapshot
 *   date. Nothing here reads today's rate, so reopening a project years
 *   later reproduces the same figures. That is the whole point of
 *   `rateLegIds`: the exact FX register rows used are named on the row.
 * ══════════════════════════════════════════════════════════════════════
 */

/** The converted amounts plus the metadata to store beside them. */
export interface CashFlowConversion {
  /** Present only when the caller supplied a plan. */
  plannedIn?: number;
  plannedOut?: number;
  /** Converted, in the reporting currency. Goes in the existing fields. */
  in: number;
  out: number;
  net: number;
  /** Spread onto the row. `{}` when no conversion was needed. */
  fields: CashFlowCurrency;
  /** False when no rate route existed — the caller must refuse to save. */
  resolved: boolean;
  /** The currency that was converted FROM. */
  from: string;
  /** The currency converted INTO. */
  to: string;
}

/**
 * Converts one cash-flow row and freezes its provenance.
 *
 * A row already in the reporting currency returns `fields: {}` — byte
 * identical to a pre-Sprint-1 row. Metadata is only written when there is
 * something to record, which keeps single-currency projects untouched.
 */
export function convertCashRow(
  ctx: TransactionContext,
  amounts: { in: number | string; out: number | string;
             plannedIn?: number | string; plannedOut?: number | string },
  currency: string,
  txn: TxnDate,
): CashFlowConversion {
  const from = (currency || ctx.contractCurrency).toUpperCase();
  const to = ctx.reportingCurrency.toUpperCase();

  const rawIn = Number(amounts.in) || 0;
  const rawOut = Number(amounts.out) || 0;
  /**
   * The plan converts on the SAME rate as the actuals.
   *
   * A variance is a subtraction between the two, so if they were
   * converted at different rates the difference would carry an FX
   * movement the user never made — a project could show an overrun
   * purely because the rate moved between two entries.
   */
  const hasPlan = amounts.plannedIn !== undefined || amounts.plannedOut !== undefined;
  const rawPIn = Number(amounts.plannedIn) || 0;
  const rawPOut = Number(amounts.plannedOut) || 0;

  // Same currency: nothing to convert, nothing to record.
  if (from === to) {
    return {
      in: rawIn, out: rawOut, net: rawIn - rawOut,
      ...(hasPlan ? { plannedIn: rawPIn, plannedOut: rawPOut } : {}),
      fields: {}, resolved: true, from, to,
    };
  }

  // One rate, every amount — so `net` and the variances survive intact.
  const g = prepareTransactionGroup(
    ctx, { in: rawIn, out: rawOut, plannedIn: rawPIn, plannedOut: rawPOut },
    from, txn);
  const m = g.money;

  const convIn = g.values.in;
  const convOut = g.values.out;

  return {
    in: convIn,
    out: convOut,
    ...(hasPlan
      ? { plannedIn: g.values.plannedIn, plannedOut: g.values.plannedOut }
      : {}),
    // Derived from the CONVERTED figures, not converted separately, so
    // in - out = net holds exactly.
    net: convIn - convOut,
    fields: {
      currency: from,
      reportingCurrency: to,
      originalIn: rawIn,
      originalOut: rawOut,
      exchangeRate: m.exchangeRateSnapshot,
      rateEffectiveDate: m.exchangeRateEffectiveDate,
      rateLegIds: m.rateLegIds,
      rateSource: m.rateSource,
      convertedAt: m.convertedAt,
    },
    resolved: m.resolved,
    from,
    to,
  };
}

/**
 * Human-readable reason a row could not be saved.
 *
 * Matching CertsModule's existing wording exactly: a user who meets this
 * message in two modules should not have to work out that it is the same
 * problem.
 */
export function noRateMessage(
  from: string, to: string, onDate: string, isRtl: boolean,
): string {
  return isRtl
    ? `لا يوجد سعر صرف من ${from} إلى ${to} بتاريخ ${onDate}. انشر السعر في إدارة العملات أولاً.`
    : `No rate from ${from} to ${to} on ${onDate}. Publish one in Currency Management first.`;
}

// ── Plan vs actual ─────────────────────────────────────────────────────

export interface CashVariance {
  /** True when the row carries a plan at all. */
  planned: boolean;
  plannedIn: number;
  plannedOut: number;
  plannedNet: number;
  /**
   * Actual − planned, SIGNED FOR LIQUIDITY.
   *
   * ══════════════════════════════════════════════════════════════════
   * POSITIVE ALWAYS MEANS "BETTER FOR CASH".
   *
   *   inVariance   = actualIn  − plannedIn    more money in  -> positive
   *   outVariance  = plannedOut − actualOut   less money out -> positive
   *
   * The second is deliberately inverted. A raw `actual − planned` on
   * spending makes an OVERRUN positive, so a row that has haemorrhaged
   * cash renders green next to one that collected early. Two columns
   * that look alike and mean opposite things is how a reader is misled
   * by a correct number.
   *
   * With this convention one rule covers the whole table: green is good,
   * red is not, in every column.
   * ══════════════════════════════════════════════════════════════════
   */
  inVariance: number;
  outVariance: number;
  /** plannedNet vs actual net, same convention: positive is better. */
  netVariance: number;
}

/**
 * Plan-versus-actual for ONE cash row.
 *
 * Pure arithmetic on figures already converted at save time — no rate is
 * looked up, so the answer does not drift.
 */
export function cashVariance(row: {
  in?: number; out?: number; plannedIn?: number; plannedOut?: number;
}): CashVariance {
  const has = row.plannedIn !== undefined || row.plannedOut !== undefined;
  const pIn = Number(row.plannedIn) || 0;
  const pOut = Number(row.plannedOut) || 0;
  const aIn = Number(row.in) || 0;
  const aOut = Number(row.out) || 0;
  return {
    planned: has,
    plannedIn: pIn,
    plannedOut: pOut,
    plannedNet: pIn - pOut,
    inVariance: has ? aIn - pIn : 0,
    outVariance: has ? pOut - aOut : 0,
    netVariance: has ? (aIn - aOut) - (pIn - pOut) : 0,
  };
}

/** Totals across a set of rows. Rows with no plan contribute no variance. */
export function cashVarianceTotals(rows: {
  in?: number; out?: number; plannedIn?: number; plannedOut?: number;
}[]): CashVariance & { rowsWithPlan: number; rowsWithoutPlan: number } {
  const list = Array.isArray(rows) ? rows : [];
  let pIn = 0, pOut = 0, aIn = 0, aOut = 0, withPlan = 0;
  list.forEach(r => {
    const v = cashVariance(r);
    if (v.planned) {
      withPlan++;
      pIn += v.plannedIn;
      pOut += v.plannedOut;
      // Only rows that HAVE a plan contribute their actuals to the
      // comparison, so the totals compare like with like.
      aIn += Number(r.in) || 0;
      aOut += Number(r.out) || 0;
    }
  });
  return {
    planned: withPlan > 0,
    plannedIn: pIn, plannedOut: pOut, plannedNet: pIn - pOut,
    inVariance: withPlan ? aIn - pIn : 0,
    outVariance: withPlan ? pOut - aOut : 0,
    netVariance: withPlan ? (aIn - aOut) - (pIn - pOut) : 0,
    rowsWithPlan: withPlan,
    rowsWithoutPlan: list.length - withPlan,
  };
}

// ── Chart series ───────────────────────────────────────────────────────

export interface CashSeriesPoint {
  month: string;
  /** null on a period that stated no plan — see `cashSeries`. */
  plannedIn: number | null;
  plannedOut: number | null;
  in: number;
  out: number;
  /** Running total of PLANNED net, period by period. */
  cumPlanned: number;
  /** Running total of ACTUAL net — the stored `cumNet`. */
  cumActual: number;
  /** Running total of PLANNED IN — holds flat across an unplanned period. */
  cumPlannedIn: number;
  /** Running total of PLANNED OUT — holds flat across an unplanned period. */
  cumPlannedOut: number;
  /** Running total of ACTUAL cash in. */
  cumIn: number;
  /** Running total of ACTUAL cash out. */
  cumOut: number;
  /** Running total of ACTUAL net, recomputed in date order — NOT the
   *  legacy stored `cumNet`, which was accumulated in entry order. */
  cumNet: number;
  /** True when this period stated a plan. */
  planned: boolean;
}

/**
 * The chart series, with BOTH cumulative curves.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THE PLANNED CURVE IS ACCUMULATED HERE AND NOT STORED
 *
 * `cumNet` is persisted because the actual running balance is a fact the
 * ledger owns. The planned curve is not stored: it is a pure function of
 * the planned figures, so deriving it means it can never fall out of step
 * with them after an edit.
 *
 * A period with NO plan contributes 0 to the planned curve rather than
 * breaking it — the line holds flat across that month instead of
 * collapsing to zero, which would read as "we planned to end the month
 * with nothing" rather than "we did not plan this month".
 * ══════════════════════════════════════════════════════════════════════
 */
export function cashSeries(rows: any[]): CashSeriesPoint[] {
  const list = Array.isArray(rows) ? rows : [];
  let cumP = 0;
  let cumPI = 0, cumPO = 0, cumI = 0, cumO = 0;
  return list.map(r => {
    const v = cashVariance(r);
    cumP += v.plannedNet;
    // An unplanned period contributes 0 to every planned curve — the
    // running totals HOLD FLAT, never fall, never break. Actual running
    // totals are computed here so the cumulative view never depends on
    // the legacy entry-order `cumNet` field.
    cumPI += v.planned ? v.plannedIn : 0;
    cumPO += v.planned ? v.plannedOut : 0;
    const aIn = Number(r?.in) || 0;
    const aOut = Number(r?.out) || 0;
    cumI += aIn;
    cumO += aOut;
    return {
      month: String(r?.month ?? ''),
      /**
       * NULL, not 0, on a period with no plan.
       *
       * Recharts draws 0 as a point on the axis, so an unplanned month
       * pulled both planned lines down to the floor — reading as "we
       * planned to collect nothing" when the truth is "we did not plan
       * this month". `null` makes the line simply stop, which is the
       * honest shape. Seen on screen at M3 before this was corrected.
       */
      plannedIn: v.planned ? v.plannedIn : null,
      plannedOut: v.planned ? v.plannedOut : null,
      in: aIn,
      out: aOut,
      cumPlanned: cumP,
      cumActual: Number(r?.cumNet) || 0,
      cumPlannedIn: cumPI,
      cumPlannedOut: cumPO,
      cumIn: cumI,
      cumOut: cumO,
      cumNet: cumI - cumO,
      planned: v.planned,
    };
  });
}

// ── Net view: the balance story ────────────────────────────────────────

export interface CashNetRow {
  month: string;
  /** True when this period stated a plan. */
  planned: boolean;
  /** Planned In − Planned Out. Null when the period stated no plan. */
  plannedNet: number | null;
  /** Actual Cash In − Cash Out. */
  net: number;
  /** Net − PlannedNet. Null when the period stated no plan. */
  variance: number | null;
}

/**
 * THE NET VIEW — one row per period, planned balance against actual
 * balance. Derived, read-only, same rules as every other cash view:
 * an unplanned period states no planned figure (null, never zero) and
 * its variance stays null rather than answering a question nobody asked.
 */
export function cashNetTable(rows: any[]): CashNetRow[] {
  const list = Array.isArray(rows) ? rows : [];
  return list.map(r => {
    const v = cashVariance(r);
    const net = (Number(r?.in) || 0) - (Number(r?.out) || 0);
    return {
      month: String(r?.month ?? ''),
      planned: v.planned,
      plannedNet: v.planned ? v.plannedNet : null,
      net,
      variance: v.planned ? net - v.plannedNet : null,
    };
  });
}

// ── Cumulative position table ─────────────────────────────────────────

export interface CashCumRow {
  month: string;
  /** True when THIS period stated a plan. False means the planned
   *  columns beside it are CARRIED, not newly stated — print them muted. */
  planned: boolean;
  cumPlannedIn: number;
  cumPlannedOut: number;
  cumPlannedNet: number;
  cumIn: number;
  cumOut: number;
  cumNet: number;
  /** Cumulative actual net − cumulative planned net: how far the running
   *  balance has drifted from the plan stated so far. The commercial
   *  headline of the cumulative view. */
  variance: number;
}

/**
 * The CUMULATIVE POSITION, one row per period, oldest → newest.
 *
 * DERIVED, NEVER STORED — the platform's standing rule: entry stays
 * period by period, and every cumulative figure is a pure function of
 * those rows, so the two can never disagree. The caller owns the ORDER:
 * pass rows chronologically (`chronoRows`), exactly as `cashSeries` is
 * fed — the module, not this function, decides what "in order" means.
 *
 * An unplanned period holds the planned columns flat (carries the last
 * stated cumulative) and flags `planned: false`; the variance column
 * keeps answering against the plan stated so far, exactly as the chart
 * curve does.
 */
export function cashCumulativeTable(rows: any[]): CashCumRow[] {
  const list = Array.isArray(rows) ? rows : [];
  let cPI = 0, cPO = 0, cI = 0, cO = 0;
  return list.map(r => {
    const v = cashVariance(r);
    cPI += v.planned ? v.plannedIn : 0;
    cPO += v.planned ? v.plannedOut : 0;
    const aIn = Number(r?.in) || 0;
    const aOut = Number(r?.out) || 0;
    cI += aIn;
    cO += aOut;
    return {
      month: String(r?.month ?? ''),
      planned: v.planned,
      cumPlannedIn: cPI,
      cumPlannedOut: cPO,
      cumPlannedNet: cPI - cPO,
      cumIn: cI,
      cumOut: cO,
      cumNet: cI - cO,
      variance: (cI - cO) - (cPI - cPO),
    };
  });
}
