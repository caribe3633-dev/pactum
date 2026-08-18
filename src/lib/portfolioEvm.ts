/**
 * ══════════════════════════════════════════════════════════════════════
 * PACTUM · PHASE 4 · STEP 13 — PORTFOLIO EVM CONSOLIDATION
 * ══════════════════════════════════════════════════════════════════════
 *
 * ONE EVM ENGINE — MANY PROJECTS — ONE CONSISTENT PORTFOLIO RESULT.
 *
 * This module does exactly two things:
 *
 *   1. asks the AUTHORITATIVE project engine for each project's EVM
 *   2. adds the results up
 *
 * It contains NO EVM formula. Not one. Every metric it reports comes
 * back from `metricsFor` in evm.ts, which is the same function the EVM
 * screen calls. If a formula ever changes there, it changes here at the
 * same instant, because there is nothing here to fall out of step.
 *
 * WHAT THIS REPLACES
 * ------------------
 * `portfolio.ts` carried a second, divergent EVM:
 *
 *     const bac  = rcv;                                   // contract value
 *     const ev   = bac * (pct / 100);                     // progress-derived
 *     const pvPct = min(pct/100 + min(dd * 0.005, 0.15), 1);
 *     totalPV   += bac * pvPct;                           // delay-derived PV
 *     totalAC   += projActual > 0 ? projActual
 *                                 : k(proj.totalCashDisbursed || 0);
 *
 * Every line of that contradicts a rule approved in Steps 1-12:
 *   BAC from contract value  — Step 12 Q3=B made BAC the approved budget
 *   EV from progress percent — Step 12 rule 4 made Direct EV manual
 *   PV from a delay formula  — PV is manually time-phased, never derived
 *   AC from budget.actual or cash disbursed — Step 11 deleted BOTH
 *
 * The AC line is the sharpest: `budget.actual || totalCashDisbursed` is
 * character-for-character the derivation Step 11 removed from the
 * project engine. It survived in the portfolio, so the same project
 * could honestly report "Actual Cost Not Entered" on its own screen
 * while the portfolio quietly asserted a number for it.
 *
 * AGGREGATION IS ADDITION, THEN METRICS (never averaged)
 * ------------------------------------------------------
 * Portfolio CPI is Σ EV / Σ AC — computed by handing the summed
 * aggregates back to the same `metricsFor`. It is NOT the mean of the
 * project CPIs, which would let a 2M project outvote a 900M one.
 *
 * EXCLUSION IS EXPLICIT (Q2=A)
 * ----------------------------
 * A project whose engine cannot produce an honest EVM — no approved
 * baseline package, no reporting period — is EXCLUDED and NAMED. It is
 * never added as zero. A zero is a financial claim ("this project has
 * spent nothing, earned nothing"); absence is the lack of one. The
 * caller receives `excluded[]` and `complete` so the screen can say
 * "9 of 12 projects" instead of implying it summed them all.
 *
 * This mirrors the precedent already set in `portfolio.ts` for
 * unconvertible currencies, which excludes and names rather than
 * guessing a rate.
 */

import {
  projectEvmResult, metricsFor,
  type ProjectEvmResult, type EvmMetrics, type EacMethod, type ProjectLike,
} from './evm';

/** One project that could not contribute, with the reason stated. */
export interface ExcludedProject {
  id: string;
  name: string;
  /** 'no-approved-baseline' | 'no-reporting-period' | 'unconvertible' */
  reason: string;
}

export interface PortfolioEvm {
  /** Direct / Indirect / Total, each summed then measured. */
  direct: EvmMetrics;
  indirect: EvmMetrics;
  total: EvmMetrics;

  /** Projects whose EVM was summed. */
  includedCount: number;
  /** Projects in scope that were asked. */
  consideredCount: number;
  /** Named, never silently dropped. */
  excluded: ExcludedProject[];
  /** True when every project in scope contributed. */
  complete: boolean;

  /** Projects whose Indirect EV is blocked by Step 12 Q2=C. */
  indirectBlocked: ExcludedProject[];
  /**
   * TRUE when at least one contributing project has a blocked Indirect
   * EV. The Indirect and Total columns are then INCOMPLETE and the UI
   * must say so rather than presenting them as whole.
   */
  indirectIncomplete: boolean;

  /** Per-project results, for drill-down and for proving the sum. */
  projects: { id: string; name: string; result: ProjectEvmResult }[];
}

/** The project surface this module needs. */
export interface PortfolioProjectLike extends ProjectLike {
  nameEn?: string;
  name?: string;
}

const ZERO: EvmMetrics = {
  pv: 0, ev: 0, ac: 0, bac: 0, sv: 0, cv: 0, spi: null, cpi: null,
  eac: 0, etc: 0, vac: 0, tcpi: null,
  percentComplete: 0, percentPlanned: 0, percentSpent: 0,
};

function nameOf(p: PortfolioProjectLike): string {
  return p.nameEn || p.name || p.id;
}

/**
 * Consolidates project EVM into one portfolio result.
 *
 * @param projects  the projects in scope
 * @param opts.eacMethod  forecasting method for the PORTFOLIO totals.
 *        Defaults to 'cpi'. Each project's own metrics keep the method
 *        stored in that project's settings — this only governs the
 *        forecast computed from the aggregate.
 * @param opts.rate  optional per-project currency factor. Returning
 *        `null` EXCLUDES the project and names it, exactly as
 *        `portfolio.ts` already does for an unresolvable rate. Omit it
 *        and every project is summed at face value.
 */
export function consolidatePortfolioEvm(
  projects: PortfolioProjectLike[],
  opts: {
    eacMethod?: EacMethod;
    rate?: (p: PortfolioProjectLike) => number | null;
    today?: Date;
  } = {},
): PortfolioEvm {
  const method: EacMethod = opts.eacMethod || 'cpi';
  const today = opts.today || new Date();
  const list = Array.isArray(projects) ? projects : [];

  const out: PortfolioEvm = {
    direct: { ...ZERO }, indirect: { ...ZERO }, total: { ...ZERO },
    includedCount: 0, consideredCount: list.length,
    excluded: [], complete: true,
    indirectBlocked: [], indirectIncomplete: false,
    projects: [],
  };

  // Running sums. Metrics are computed ONCE, at the end, from these.
  let dPv = 0, dEv = 0, dAc = 0, dBac = 0;
  let iPv = 0, iEv = 0, iAc = 0, iBac = 0;

  for (const p of list) {
    // Currency first: an unconvertible project contributes nothing and
    // is named, rather than being summed in the wrong unit.
    const factor = opts.rate ? opts.rate(p) : 1;
    if (factor === null) {
      out.excluded.push({ id: p.id, name: nameOf(p), reason: 'unconvertible' });
      continue;
    }

    const res = projectEvmResult(p, today);
    out.projects.push({ id: p.id, name: nameOf(p), result: res });

    if (!res.available || !res.metrics) {
      // Q2=A — excluded and named. NEVER added as zero.
      out.excluded.push({ id: p.id, name: nameOf(p), reason: res.reason });
      continue;
    }

    const m = res.metrics;
    out.includedCount++;

    dPv += m.direct.pv * factor;
    dEv += m.direct.ev * factor;
    dAc += m.direct.ac * factor;
    dBac += m.direct.bac * factor;

    iPv += m.indirect.pv * factor;
    iEv += m.indirect.ev * factor;
    iAc += m.indirect.ac * factor;
    iBac += m.indirect.bac * factor;

    if (res.indirectBlocked) {
      out.indirectBlocked.push({ id: p.id, name: nameOf(p), reason: 'indirect-ev-blocked' });
    }
  }

  out.complete = out.excluded.length === 0;
  out.indirectIncomplete = out.indirectBlocked.length > 0;

  /**
   * SUM FIRST, THEN MEASURE — and measure with the SAME function the
   * project screen uses. Total is computed from the total aggregates,
   * NOT by adding the Direct and Indirect metric objects together:
   *   Σ EV / Σ AC  is the portfolio CPI
   *   CPI_direct + CPI_indirect  is meaningless
   *
   * The Total inputs are the component sums, so no figure is counted
   * twice: a project's own `total` already equals its direct + indirect,
   * and adding that on top would double it.
   */
  out.direct = metricsFor(dPv, dEv, dAc, dBac, method);
  out.indirect = metricsFor(iPv, iEv, iAc, iBac, method);
  out.total = metricsFor(dPv + iPv, dEv + iEv, dAc + iAc, dBac + iBac, method);

  return out;
}
