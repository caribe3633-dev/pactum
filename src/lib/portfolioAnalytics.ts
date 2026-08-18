/**
 * Enterprise Portfolio Analytics.
 * Destination: src/lib/portfolioAnalytics.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 7. ONE SOURCE.
 *
 *   Every figure produced here comes from an APPROVED TIMELINE SNAPSHOT.
 *   This file imports exactly one module — `./timeline` — and that is the
 *   whole of its access to data. It cannot read a live register, call an
 *   engine or look up a rate, because there is no import through which it
 *   could.
 *
 * WHAT "ANALYTICS" MEANS HERE, AND WHAT IT DOES NOT
 *
 *   It means aggregation across projects of figures each project already
 *   computed and froze: weighting, grouping, ranking, trending.
 *
 *   It does NOT mean recomputing anything. Portfolio CPI is not a fresh CPI
 *   calculation — it is Σ EV / Σ AC across archived EV and AC values, which
 *   is the only defensible way to combine indices and is arithmetic on
 *   already-final numbers. No module formula is touched, and no module
 *   knows this file exists.
 *
 * THE WEIGHTING DECISION
 *
 *   A naive portfolio SPI is the average of project SPIs. That is wrong in
 *   a way that flatters bad portfolios: a 4 billion project at SPI 0.7 and
 *   a 4 million project at SPI 1.3 average to 1.0, which describes no
 *   reality anyone is managing. So indices are computed from summed
 *   components (Σ EV / Σ PV, Σ EV / Σ AC), which weights each project by
 *   its own size automatically. The simple mean is also returned, labelled
 *   as such, because the gap between the two is itself a finding.
 *
 * THE CURRENCY REFUSAL
 *
 *   Money cannot be summed across reporting currencies. Where a selection
 *   spans more than one, monetary aggregates are returned as null and
 *   `mixedCurrency` is true. Returning a number would produce a figure with
 *   no unit that looks exactly like one that has. Ratios and day counts are
 *   still valid and are still returned.
 *
 * THE PERIOD ALIGNMENT DECISION
 *
 *   Two modes, and the caller must choose:
 *
 *     'latest'  — each project's most recent approved period. Maximum
 *                 coverage, mixed data dates. Right for "where are we now".
 *     'asOf'    — every project at one nominated period. Comparable dates,
 *                 fewer projects. Right for a board pack.
 *
 *   In 'asOf', a project that never approved that period is EXCLUDED and
 *   listed, never zero-filled. A portfolio total containing a silent zero
 *   for a live project understates exposure, which is the failure mode that
 *   matters.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  readTimeline, approvedSnapshots, latestSnapshot, snapshotFor,
  TimelineStore, TimelineSnapshot,
} from './timeline';

// ── Inputs ─────────────────────────────────────────────────────────────

/**
 * A project plus its dimensions.
 *
 * Company, sector and country are passed IN rather than looked up. This
 * file must not import the company or sector registries: doing so would
 * give it a second data source, and the single-source property is the point
 * of the phase. The caller already holds this metadata.
 */
export interface AnalyticsProject {
  id: string;
  code?: string;
  nameEn?: string;
  nameAr?: string;
  companyId?: string;
  companyName?: string;
  sectorId?: string;
  sectorName?: string;
  /** ISO 3166-1 alpha-2, or whatever the caller uses consistently. */
  country?: string;
}

export type AlignMode = 'latest' | 'asOf';

export interface AnalyticsOptions {
  align?: AlignMode;
  /** Required when align is 'asOf'. e.g. '2026-03'. */
  periodId?: string;
}

// ── One project's archived position ────────────────────────────────────

/**
 * Everything the portfolio layer needs from one project, read from one
 * snapshot. Every field is nullable: a section the period never recorded is
 * absent, and absent is not zero.
 */
export interface ProjectPosition {
  projectId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  companyId: string;
  companyName: string;
  sectorId: string;
  sectorName: string;
  country: string;

  periodId: string;
  period: string;
  dataDate: string;
  approvedBy: string;
  reportingCurrency: string;
  /** Approved periods this project has, for coverage reporting. */
  periodCount: number;

  // Earned value components — the inputs to weighted indices.
  bac: number | null;
  pv: number | null;
  ev: number | null;
  ac: number | null;
  spi: number | null;
  cpi: number | null;
  eac: number | null;
  vac: number | null;
  eacMethod: string;

  // Delay
  totalDelay: number | null;
  approvedEOT: number | null;
  unmitigated: number | null;
  culpable: number | null;
  ldExposure: number | null;
  ldCap: number | null;
  ldCapReached: boolean;

  // Commercial
  originalContract: number | null;
  approvedCOs: number | null;
  pendingCOs: number | null;
  approvedClaims: number | null;
  currentContract: number | null;

  // Claims
  claimCount: number | null;
  claimed: number | null;
  settled: number | null;
  claimTimeDays: number | null;

  // Cash & certificates
  cashIn: number | null;
  cashOut: number | null;
  cashNet: number | null;
  cashCumulative: number | null;
  certified: number | null;
  paid: number | null;
  outstanding: number | null;
  retention: number | null;

  // Budget
  budgetPlanned: number | null;
  budgetActual: number | null;
  budgetForecast: number | null;
  budgetVariance: number | null;

  // Forecast & status
  forecastEac: number | null;
  forecastVac: number | null;
  forecastFinish: string;
  slipDays: number | null;
  health: string;
  progressPct: number | null;

  // FX — frozen, from the archive
  appliedRates: { currency: string; rate: number; count: number;
                  originalTotal: number; convertedTotal: number }[];
  frozenRates: { currency: string; rate: number; effectiveDate: string }[];

  /** Sections this period did not record. */
  missing: string[];
}

const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function positionFrom(p: AnalyticsProject, s: TimelineSnapshot, store: TimelineStore): ProjectPosition {
  const missing: string[] = [];
  const mark = (k: string, present: unknown) => { if (!present) missing.push(k); return present; };
  mark('evm', s.evm); mark('delay', s.delay); mark('commercial', s.commercial);
  mark('cash', s.cash); mark('claims', s.claims); mark('budget', s.budget);
  mark('certificates', s.certificates); mark('forecast', s.forecast);
  mark('exchange', s.exchange); mark('projectStatus', s.projectStatus);

  return {
    projectId: p.id,
    code: p.code ?? '',
    nameEn: p.nameEn ?? '',
    nameAr: p.nameAr ?? '',
    companyId: p.companyId ?? '',
    companyName: p.companyName ?? '',
    sectorId: p.sectorId ?? '',
    sectorName: p.sectorName ?? '',
    country: p.country ?? '',

    periodId: s.periodId,
    period: s.periodLabel || s.periodId,
    dataDate: s.dataDate,
    approvedBy: s.approvedBy,
    reportingCurrency: s.exchange?.reportingCurrency ?? '',
    periodCount: approvedSnapshots(store).length,

    bac: n(s.evm?.bac), pv: n(s.evm?.pv), ev: n(s.evm?.ev), ac: n(s.evm?.ac),
    spi: s.evm?.spi ?? null, cpi: s.evm?.cpi ?? null,
    eac: n(s.evm?.eac), vac: n(s.evm?.vac),
    eacMethod: s.evm?.eacMethod ?? '',

    totalDelay: n(s.delay?.totalDelay),
    approvedEOT: n(s.delay?.approvedEOT),
    unmitigated: n(s.delay?.unmitigated),
    culpable: n(s.delay?.culpableDelay),
    ldExposure: n(s.ld?.exposure),
    ldCap: n(s.ld?.capAmount),
    ldCapReached: Boolean(s.ld?.capReached),

    originalContract: n(s.commercial?.originalContract),
    approvedCOs: n(s.commercial?.approvedChangeOrders),
    pendingCOs: n(s.commercial?.pendingChangeOrders),
    approvedClaims: n(s.commercial?.approvedClaims),
    currentContract: n(s.commercial?.currentContract),

    claimCount: n(s.claims?.count),
    claimed: n(s.claims?.totalClaimed),
    settled: n(s.claims?.totalSettled),
    claimTimeDays: n(s.claims?.timeClaimed),

    cashIn: n(s.cash?.totalIn),
    cashOut: n(s.cash?.totalOut),
    cashNet: n(s.cash?.netFlow),
    cashCumulative: n(s.cash?.cumulativeNet),
    certified: n(s.certificates?.certified),
    paid: n(s.certificates?.paid),
    outstanding: n(s.certificates?.outstanding),
    retention: n(s.certificates?.totalRetention),

    budgetPlanned: n(s.budget?.totalPlanned),
    budgetActual: n(s.budget?.totalActual),
    budgetForecast: n(s.budget?.totalForecast),
    budgetVariance: n(s.budget?.variance),

    forecastEac: n(s.forecast?.eac ?? s.evm?.eac),
    forecastVac: n(s.forecast?.vac ?? s.evm?.vac),
    forecastFinish: s.forecast?.forecastFinish ?? s.contract?.forecastFinish ?? '',
    slipDays: n(s.forecast?.slipDays),
    health: s.projectStatus?.health ?? s.kpi?.health ?? '',
    progressPct: n(s.projectStatus?.progressPct ?? s.kpi?.progressPct),

    appliedRates: (s.exchange?.appliedRates ?? []).map(a => ({
      currency: a.currency, rate: a.rate, count: a.count,
      originalTotal: a.originalTotal, convertedTotal: a.convertedTotal,
    })),
    frozenRates: (s.exchange?.rates ?? []).map(r => ({
      currency: r.currency, rate: r.rate, effectiveDate: r.effectiveDate,
    })),

    missing,
  };
}

// ── Population ─────────────────────────────────────────────────────────

export interface Population {
  positions: ProjectPosition[];
  /** Projects with no approved period at all. */
  noHistory: AnalyticsProject[];
  /** In 'asOf' mode: projects that exist but never approved that period. */
  notInPeriod: AnalyticsProject[];
  align: AlignMode;
  periodId: string;
  /** Distinct reporting currencies across the population. */
  currencies: string[];
  mixedCurrency: boolean;
  /** Distinct data dates. More than one means the rows are not aligned. */
  dataDates: string[];
}

/**
 * Assembles the analysable population.
 *
 * The three exclusion buckets are kept separate and reported, because
 * "we have no history", "we have history but not for March" and "we are in
 * the numbers" are three different facts and collapsing them hides coverage
 * problems behind a confident-looking total.
 */
export function buildPopulation(
  projects: AnalyticsProject[], opts: AnalyticsOptions = {},
): Population {
  const align: AlignMode = opts.align ?? 'latest';
  const positions: ProjectPosition[] = [];
  const noHistory: AnalyticsProject[] = [];
  const notInPeriod: AnalyticsProject[] = [];

  projects.forEach(p => {
    const store = readTimeline(p.id);
    if (approvedSnapshots(store).length === 0) { noHistory.push(p); return; }
    const snap = align === 'asOf'
      ? (opts.periodId ? snapshotFor(store, opts.periodId) : null)
      : latestSnapshot(store);
    if (!snap) { notInPeriod.push(p); return; }
    positions.push(positionFrom(p, snap, store));
  });

  const currencies = Array.from(
    new Set(positions.map(x => x.reportingCurrency).filter(Boolean))).sort();
  const dataDates = Array.from(
    new Set(positions.map(x => x.dataDate).filter(Boolean))).sort();

  return {
    positions, noHistory, notInPeriod,
    align, periodId: opts.periodId ?? '',
    currencies, mixedCurrency: currencies.length > 1,
    dataDates,
  };
}

/** Every period id that at least one project in the list has approved. */
export function commonPeriods(projects: AnalyticsProject[]): {
  periodId: string; label: string; projectCount: number; complete: boolean;
}[] {
  const map = new Map<string, { label: string; count: number }>();
  projects.forEach(p => {
    approvedSnapshots(readTimeline(p.id)).forEach(s => {
      const e = map.get(s.periodId);
      if (e) e.count += 1;
      else map.set(s.periodId, { label: s.periodLabel || s.periodId, count: 1 });
    });
  });
  return Array.from(map.entries())
    .map(([periodId, v]) => ({
      periodId, label: v.label, projectCount: v.count,
      complete: v.count === projects.length,
    }))
    .sort((a, b) => (a.periodId < b.periodId ? 1 : -1));
}

// ── Aggregation primitives ─────────────────────────────────────────────

/** Σ of a field, ignoring nulls. Returns null when NOTHING was present. */
function sum(rows: ProjectPosition[], k: keyof ProjectPosition): number | null {
  let total = 0, seen = 0;
  rows.forEach(r => {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) { total += v; seen += 1; }
  });
  return seen === 0 ? null : total;
}

/** How many rows carried a value for this field. Drives coverage notes. */
function count(rows: ProjectPosition[], k: keyof ProjectPosition): number {
  return rows.filter(r => typeof r[k] === 'number' && Number.isFinite(r[k] as number)).length;
}

/** Unweighted mean, for contrast against the weighted figure. */
function mean(rows: ProjectPosition[], k: keyof ProjectPosition): number | null {
  const vals = rows
    .map(r => r[k])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** a / b, or null when the denominator is zero or either side is absent. */
function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

/** Money aggregate, suppressed when the population spans currencies. */
function moneySum(pop: Population, rows: ProjectPosition[], k: keyof ProjectPosition): number | null {
  return pop.mixedCurrency ? null : sum(rows, k);
}

// ── The ten portfolio metrics ──────────────────────────────────────────

export interface CoverageNote {
  /** Projects in the population. */
  total: number;
  /** Projects that carried the figures this metric needs. */
  contributing: number;
  complete: boolean;
}

const cov = (rows: ProjectPosition[], k: keyof ProjectPosition): CoverageNote => {
  const c = count(rows, k);
  return { total: rows.length, contributing: c, complete: c === rows.length };
};

/** 1 · Portfolio SPI — Σ EV / Σ PV, size-weighted by construction. */
export interface PortfolioSpi {
  weighted: number | null;
  simpleMean: number | null;
  ev: number | null;
  pv: number | null;
  sv: number | null;
  /** Projects behind schedule (SPI < 1). */
  behind: number;
  ahead: number;
  worst: { projectId: string; code: string; spi: number } | null;
  best: { projectId: string; code: string; spi: number } | null;
  coverage: CoverageNote;
  /** True when weighted and mean disagree by more than 5 points. */
  divergent: boolean;
}

export function portfolioSpi(pop: Population): PortfolioSpi {
  const r = pop.positions;
  const ev = sum(r, 'ev'), pv = sum(r, 'pv');
  const weighted = ratio(ev, pv);
  const simpleMean = mean(r, 'spi');
  const withSpi = r.filter(x => x.spi !== null) as (ProjectPosition & { spi: number })[];
  const sorted = withSpi.slice().sort((a, b) => a.spi - b.spi);
  return {
    weighted, simpleMean,
    ev, pv,
    sv: ev !== null && pv !== null ? ev - pv : null,
    behind: withSpi.filter(x => x.spi < 1).length,
    ahead: withSpi.filter(x => x.spi >= 1).length,
    worst: sorted.length ? { projectId: sorted[0].projectId, code: sorted[0].code, spi: sorted[0].spi } : null,
    best: sorted.length ? { projectId: sorted[sorted.length - 1].projectId, code: sorted[sorted.length - 1].code, spi: sorted[sorted.length - 1].spi } : null,
    coverage: cov(r, 'ev'),
    divergent: weighted !== null && simpleMean !== null && Math.abs(weighted - simpleMean) > 0.05,
  };
}

/** 2 · Portfolio CPI — Σ EV / Σ AC. */
export interface PortfolioCpi {
  weighted: number | null;
  simpleMean: number | null;
  ev: number | null;
  ac: number | null;
  cv: number | null;
  overBudget: number;
  underBudget: number;
  worst: { projectId: string; code: string; cpi: number } | null;
  best: { projectId: string; code: string; cpi: number } | null;
  coverage: CoverageNote;
  divergent: boolean;
}

export function portfolioCpi(pop: Population): PortfolioCpi {
  const r = pop.positions;
  const ev = sum(r, 'ev'), ac = sum(r, 'ac');
  const weighted = ratio(ev, ac);
  const simpleMean = mean(r, 'cpi');
  const withCpi = r.filter(x => x.cpi !== null) as (ProjectPosition & { cpi: number })[];
  const sorted = withCpi.slice().sort((a, b) => a.cpi - b.cpi);
  return {
    weighted, simpleMean, ev, ac,
    cv: ev !== null && ac !== null ? ev - ac : null,
    overBudget: withCpi.filter(x => x.cpi < 1).length,
    underBudget: withCpi.filter(x => x.cpi >= 1).length,
    worst: sorted.length ? { projectId: sorted[0].projectId, code: sorted[0].code, cpi: sorted[0].cpi } : null,
    best: sorted.length ? { projectId: sorted[sorted.length - 1].projectId, code: sorted[sorted.length - 1].code, cpi: sorted[sorted.length - 1].cpi } : null,
    coverage: cov(r, 'ev'),
    divergent: weighted !== null && simpleMean !== null && Math.abs(weighted - simpleMean) > 0.05,
  };
}

/** 3 · Portfolio Delay. */
export interface PortfolioDelay {
  totalDelay: number | null;
  approvedEOT: number | null;
  unmitigated: number | null;
  culpable: number | null;
  ldExposure: number | null;
  /** Projects carrying unmitigated delay. */
  exposed: number;
  atCap: number;
  meanDelay: number | null;
  worst: { projectId: string; code: string; unmitigated: number } | null;
  coverage: CoverageNote;
  currencySuppressed: boolean;
}

export function portfolioDelay(pop: Population): PortfolioDelay {
  const r = pop.positions;
  const withU = r.filter(x => x.unmitigated !== null) as (ProjectPosition & { unmitigated: number })[];
  const sorted = withU.slice().sort((a, b) => b.unmitigated - a.unmitigated);
  return {
    // Day counts sum across currencies without difficulty — a day is a day.
    totalDelay: sum(r, 'totalDelay'),
    approvedEOT: sum(r, 'approvedEOT'),
    unmitigated: sum(r, 'unmitigated'),
    culpable: sum(r, 'culpable'),
    // Money does not, so this one is suppressed on a mixed population.
    ldExposure: moneySum(pop, r, 'ldExposure'),
    exposed: withU.filter(x => x.unmitigated > 0).length,
    atCap: r.filter(x => x.ldCapReached).length,
    meanDelay: mean(r, 'totalDelay'),
    worst: sorted.length && sorted[0].unmitigated > 0
      ? { projectId: sorted[0].projectId, code: sorted[0].code, unmitigated: sorted[0].unmitigated }
      : null,
    coverage: cov(r, 'totalDelay'),
    currencySuppressed: pop.mixedCurrency,
  };
}

/** 4 · Portfolio Forecast. */
export interface PortfolioForecast {
  bac: number | null;
  eac: number | null;
  vac: number | null;
  /** eac − bac, the movement the portfolio is forecasting. */
  overrun: number | null;
  overrunPct: number | null;
  projectsOverrunning: number;
  totalSlipDays: number | null;
  maxSlip: { projectId: string; code: string; slipDays: number } | null;
  /** Distinct EAC methods in the population — mixed methods are a caveat. */
  methods: string[];
  mixedMethods: boolean;
  coverage: CoverageNote;
  currencySuppressed: boolean;
}

export function portfolioForecast(pop: Population): PortfolioForecast {
  const r = pop.positions;
  const bac = moneySum(pop, r, 'bac');
  const eac = moneySum(pop, r, 'forecastEac');
  const vac = moneySum(pop, r, 'forecastVac');
  const withSlip = r.filter(x => x.slipDays !== null) as (ProjectPosition & { slipDays: number })[];
  const worstSlip = withSlip.slice().sort((a, b) => b.slipDays - a.slipDays)[0];
  const methods = Array.from(new Set(r.map(x => x.eacMethod).filter(Boolean))).sort();
  return {
    bac, eac, vac,
    overrun: bac !== null && eac !== null ? eac - bac : null,
    overrunPct: bac !== null && eac !== null && bac !== 0 ? (eac - bac) / bac : null,
    projectsOverrunning: r.filter(x => x.forecastVac !== null && x.forecastVac < 0).length,
    totalSlipDays: sum(r, 'slipDays'),
    maxSlip: worstSlip
      ? { projectId: worstSlip.projectId, code: worstSlip.code, slipDays: worstSlip.slipDays }
      : null,
    methods,
    // EACs produced by different methods are not strictly additive. Stating
    // it beats printing a total that quietly mixes CPI-based and composite
    // forecasts as though they were the same kind of number.
    mixedMethods: methods.length > 1,
    coverage: cov(r, 'forecastEac'),
    currencySuppressed: pop.mixedCurrency,
  };
}

/** 5 · Portfolio Cash Flow. */
export interface PortfolioCash {
  totalIn: number | null;
  totalOut: number | null;
  netFlow: number | null;
  cumulativeNet: number | null;
  certified: number | null;
  paid: number | null;
  outstanding: number | null;
  retention: number | null;
  /** Certified but unpaid, as a share of certified. */
  collectionGap: number | null;
  negativeCashProjects: number;
  coverage: CoverageNote;
  currencySuppressed: boolean;
}

export function portfolioCash(pop: Population): PortfolioCash {
  const r = pop.positions;
  const certified = moneySum(pop, r, 'certified');
  const outstanding = moneySum(pop, r, 'outstanding');
  return {
    totalIn: moneySum(pop, r, 'cashIn'),
    totalOut: moneySum(pop, r, 'cashOut'),
    netFlow: moneySum(pop, r, 'cashNet'),
    cumulativeNet: moneySum(pop, r, 'cashCumulative'),
    certified,
    paid: moneySum(pop, r, 'paid'),
    outstanding,
    retention: moneySum(pop, r, 'retention'),
    collectionGap: ratio(outstanding, certified),
    negativeCashProjects: r.filter(x => x.cashNet !== null && x.cashNet < 0).length,
    coverage: cov(r, 'cashNet'),
    currencySuppressed: pop.mixedCurrency,
  };
}

/**
 * 6 · Portfolio FX Exposure.
 *
 * Built ONLY from `appliedRates` frozen in each snapshot — the rates that
 * actually touched a transaction. The live register is never opened, so this
 * reproduces the exposure as each period reported it rather than as it would
 * look at today's rates.
 */
export interface FxExposureRow {
  currency: string;
  /** Σ original (foreign) amounts converted at any rate. */
  originalTotal: number;
  /** Σ converted amounts, in each project's reporting currency. */
  convertedTotal: number;
  recordCount: number;
  projectCount: number;
  /** Distinct rates applied. More than one is normal across dates. */
  rates: number[];
  minRate: number;
  maxRate: number;
  /** Effective blended rate: converted / original. */
  blendedRate: number | null;
  /** Share of the portfolio's total converted foreign value. */
  share: number | null;
}

export interface PortfolioFx {
  rows: FxExposureRow[];
  totalConverted: number | null;
  currencyCount: number;
  /** Projects that applied at least one foreign rate. */
  exposedProjects: number;
  reportingCurrencies: string[];
  mixedReporting: boolean;
  /** Largest single-currency exposure by converted value. */
  largest: FxExposureRow | null;
  /** Share held by the largest currency — a concentration signal. */
  concentration: number | null;
}

export function portfolioFx(pop: Population): PortfolioFx {
  const acc = new Map<string, FxExposureRow & { _projects: Set<string>; _rates: Set<number> }>();

  pop.positions.forEach(p => {
    p.appliedRates.forEach(a => {
      const e = acc.get(a.currency);
      if (!e) {
        acc.set(a.currency, {
          currency: a.currency,
          originalTotal: a.originalTotal,
          convertedTotal: a.convertedTotal,
          recordCount: a.count,
          projectCount: 0,
          rates: [], minRate: a.rate, maxRate: a.rate,
          blendedRate: null, share: null,
          _projects: new Set([p.projectId]),
          _rates: new Set([a.rate]),
        });
      } else {
        e.originalTotal += a.originalTotal;
        e.convertedTotal += a.convertedTotal;
        e.recordCount += a.count;
        e.minRate = Math.min(e.minRate, a.rate);
        e.maxRate = Math.max(e.maxRate, a.rate);
        e._projects.add(p.projectId);
        e._rates.add(a.rate);
      }
    });
  });

  const rows = Array.from(acc.values()).map(e => ({
    currency: e.currency,
    originalTotal: e.originalTotal,
    convertedTotal: e.convertedTotal,
    recordCount: e.recordCount,
    projectCount: e._projects.size,
    rates: Array.from(e._rates).sort((a, b) => a - b),
    minRate: e.minRate,
    maxRate: e.maxRate,
    blendedRate: e.originalTotal !== 0 ? e.convertedTotal / e.originalTotal : null,
    share: null as number | null,
  }));

  // Converted totals are only comparable within one reporting currency.
  const totalConverted = pop.mixedCurrency
    ? null
    : rows.reduce((a, r) => a + r.convertedTotal, 0);

  if (totalConverted !== null && totalConverted !== 0) {
    rows.forEach(r => { r.share = r.convertedTotal / totalConverted; });
  }

  rows.sort((a, b) => b.convertedTotal - a.convertedTotal);

  return {
    rows,
    totalConverted,
    currencyCount: rows.length,
    exposedProjects: pop.positions.filter(p => p.appliedRates.length > 0).length,
    reportingCurrencies: pop.currencies,
    mixedReporting: pop.mixedCurrency,
    largest: rows.length ? rows[0] : null,
    concentration: rows.length && rows[0].share !== null ? rows[0].share : null,
  };
}

/** 7 · Portfolio Claims. */
export interface PortfolioClaims {
  count: number | null;
  claimed: number | null;
  settled: number | null;
  unsettled: number | null;
  /** settled / claimed — the portfolio's historical settlement rate. */
  settlementRate: number | null;
  timeClaimed: number | null;
  approvedEOT: number | null;
  /** Claimed value as a share of current contract. */
  claimIntensity: number | null;
  projectsWithClaims: number;
  largest: { projectId: string; code: string; claimed: number } | null;
  coverage: CoverageNote;
  currencySuppressed: boolean;
}

export function portfolioClaims(pop: Population): PortfolioClaims {
  const r = pop.positions;
  const claimed = moneySum(pop, r, 'claimed');
  const settled = moneySum(pop, r, 'settled');
  const contract = moneySum(pop, r, 'currentContract');
  const withClaims = r.filter(x => x.claimed !== null && x.claimed > 0) as (ProjectPosition & { claimed: number })[];
  const top = withClaims.slice().sort((a, b) => b.claimed - a.claimed)[0];
  return {
    count: sum(r, 'claimCount'),
    claimed, settled,
    unsettled: claimed !== null && settled !== null ? claimed - settled : null,
    settlementRate: ratio(settled, claimed),
    timeClaimed: sum(r, 'claimTimeDays'),
    approvedEOT: sum(r, 'approvedEOT'),
    claimIntensity: ratio(claimed, contract),
    projectsWithClaims: withClaims.length,
    largest: top ? { projectId: top.projectId, code: top.code, claimed: top.claimed } : null,
    coverage: cov(r, 'claimed'),
    currencySuppressed: pop.mixedCurrency,
  };
}

/** 8 · Portfolio Change Orders. */
export interface PortfolioChangeOrders {
  approved: number | null;
  pending: number | null;
  originalContract: number | null;
  currentContract: number | null;
  /** approved / original — how far the portfolio has moved from signing. */
  growthRate: number | null;
  /** pending / original — the movement not yet committed. */
  pendingRate: number | null;
  projectsWithCOs: number;
  largest: { projectId: string; code: string; approved: number } | null;
  coverage: CoverageNote;
  currencySuppressed: boolean;
}

export function portfolioChangeOrders(pop: Population): PortfolioChangeOrders {
  const r = pop.positions;
  const approved = moneySum(pop, r, 'approvedCOs');
  const pending = moneySum(pop, r, 'pendingCOs');
  const original = moneySum(pop, r, 'originalContract');
  const withCo = r.filter(x => x.approvedCOs !== null && x.approvedCOs > 0) as (ProjectPosition & { approvedCOs: number })[];
  const top = withCo.slice().sort((a, b) => b.approvedCOs - a.approvedCOs)[0];
  return {
    approved, pending,
    originalContract: original,
    currentContract: moneySum(pop, r, 'currentContract'),
    growthRate: ratio(approved, original),
    pendingRate: ratio(pending, original),
    projectsWithCOs: withCo.length,
    largest: top ? { projectId: top.projectId, code: top.code, approved: top.approvedCOs } : null,
    coverage: cov(r, 'approvedCOs'),
    currencySuppressed: pop.mixedCurrency,
  };
}

/**
 * 9 · Portfolio Profitability.
 *
 * A DERIVED VIEW, and labelled as one. Timeline archives no margin field,
 * because no module computes one. What it does archive is revenue certified
 * and cost incurred, and the difference between them is a defensible
 * indicative margin — provided nobody mistakes it for an audited one.
 *
 *   Earned margin   = certified − budget actual        (to date)
 *   Forecast margin = current contract − EAC           (at completion)
 *
 * Both are stated with their inputs so a reader can see the construction.
 * Where either input is absent the result is null, never an optimistic
 * partial.
 */
export interface PortfolioProfitability {
  certified: number | null;
  costIncurred: number | null;
  earnedMargin: number | null;
  earnedMarginPct: number | null;

  currentContract: number | null;
  eac: number | null;
  forecastMargin: number | null;
  forecastMarginPct: number | null;

  /** Projects whose forecast margin is negative. */
  lossMaking: number;
  /** Projects whose forecast margin fell below the earned margin. */
  eroding: number;
  best: { projectId: string; code: string; marginPct: number } | null;
  worst: { projectId: string; code: string; marginPct: number } | null;

  /** States plainly that this is derived, not archived. */
  derived: true;
  basis: string;
  coverage: CoverageNote;
  currencySuppressed: boolean;
}

export function portfolioProfitability(pop: Population): PortfolioProfitability {
  const r = pop.positions;
  const certified = moneySum(pop, r, 'certified');
  const cost = moneySum(pop, r, 'budgetActual');
  const contract = moneySum(pop, r, 'currentContract');
  const eac = moneySum(pop, r, 'forecastEac');

  const perProject = r
    .map(x => {
      const c = x.currentContract, e = x.forecastEac;
      if (c === null || e === null || c === 0) return null;
      return { projectId: x.projectId, code: x.code, marginPct: (c - e) / c,
               margin: c - e,
               earned: x.certified !== null && x.budgetActual !== null ? x.certified - x.budgetActual : null };
    })
    .filter(Boolean) as { projectId: string; code: string; marginPct: number; margin: number; earned: number | null }[];

  const sorted = perProject.slice().sort((a, b) => a.marginPct - b.marginPct);

  return {
    certified, costIncurred: cost,
    earnedMargin: certified !== null && cost !== null ? certified - cost : null,
    earnedMarginPct: certified !== null && cost !== null && certified !== 0
      ? (certified - cost) / certified : null,

    currentContract: contract, eac,
    forecastMargin: contract !== null && eac !== null ? contract - eac : null,
    forecastMarginPct: contract !== null && eac !== null && contract !== 0
      ? (contract - eac) / contract : null,

    lossMaking: perProject.filter(x => x.margin < 0).length,
    eroding: perProject.filter(x => x.earned !== null && x.margin < x.earned).length,
    best: sorted.length ? { projectId: sorted[sorted.length - 1].projectId, code: sorted[sorted.length - 1].code, marginPct: sorted[sorted.length - 1].marginPct } : null,
    worst: sorted.length ? { projectId: sorted[0].projectId, code: sorted[0].code, marginPct: sorted[0].marginPct } : null,

    derived: true,
    basis: 'Earned margin = certified revenue less budget actual cost. Forecast margin = '
         + 'current contract less EAC. Both are indicative: no module computes a margin and '
         + 'Timeline archives none, so these are constructed from archived revenue and cost '
         + 'and must not be read as an audited profit figure.',
    coverage: cov(r, 'currentContract'),
    currencySuppressed: pop.mixedCurrency,
  };
}

/**
 * 10 · Portfolio Risk.
 *
 * A COMPOSITE INDEX over archived signals, not a risk register roll-up.
 * Timeline carries no risk section — the Risk module's register is live and
 * unarchived — so inventing a portfolio "risk score" from it would mean
 * reading a live store, which this file will not do.
 *
 * Instead each project is scored 0–100 on five archived signals, each of
 * which is a fact the project already reported:
 *
 *   schedule   SPI below 1
 *   cost       CPI below 1
 *   delay      unmitigated days outstanding
 *   liquidity  certified but unpaid
 *   forecast   EAC above BAC
 *
 * A signal with no data scores nothing and is excluded from that project's
 * denominator, so a sparse project is not flattered by its own gaps.
 */
export interface RiskSignal {
  key: 'schedule' | 'cost' | 'delay' | 'liquidity' | 'forecast';
  score: number | null;
  detail: string;
}

export interface ProjectRisk {
  projectId: string;
  code: string;
  /** 0–100. Higher is worse. Null when no signal had data. */
  score: number | null;
  band: 'low' | 'moderate' | 'high' | 'severe' | 'unknown';
  signals: RiskSignal[];
  /** Signals that had no data. */
  blind: number;
}

export interface PortfolioRisk {
  projects: ProjectRisk[];
  /** Mean of the project scores that could be computed. */
  portfolioScore: number | null;
  bands: Record<string, number>;
  /** Projects where more than two signals had no data. */
  poorlyCovered: number;
  highest: ProjectRisk | null;
  signalAverages: Record<string, number | null>;
  derived: true;
  basis: string;
}

/** Maps a value onto 0–100 with a stated ceiling, clamped. */
const scale = (v: number, ceiling: number): number =>
  Math.max(0, Math.min(100, (v / ceiling) * 100));

function riskOf(p: ProjectPosition): ProjectRisk {
  const signals: RiskSignal[] = [];

  // Schedule: SPI 1.00 -> 0, SPI 0.70 or worse -> 100.
  signals.push(p.spi === null
    ? { key: 'schedule', score: null, detail: 'No SPI recorded' }
    : { key: 'schedule', score: scale(Math.max(0, 1 - p.spi), 0.30),
        detail: `SPI ${p.spi.toFixed(3)}` });

  // Cost: same shape on CPI.
  signals.push(p.cpi === null
    ? { key: 'cost', score: null, detail: 'No CPI recorded' }
    : { key: 'cost', score: scale(Math.max(0, 1 - p.cpi), 0.30),
        detail: `CPI ${p.cpi.toFixed(3)}` });

  // Delay: 0 days -> 0, 90 unmitigated days -> 100.
  signals.push(p.unmitigated === null
    ? { key: 'delay', score: null, detail: 'No delay recorded' }
    : { key: 'delay', score: scale(Math.max(0, p.unmitigated), 90),
        detail: `${p.unmitigated}d unmitigated` });

  // Liquidity: share of certified revenue still unpaid.
  if (p.certified === null || p.outstanding === null || p.certified === 0) {
    signals.push({ key: 'liquidity', score: null, detail: 'No certificate position' });
  } else {
    const gap = Math.max(0, p.outstanding / p.certified);
    signals.push({ key: 'liquidity', score: scale(gap, 0.40),
      detail: `${(gap * 100).toFixed(0)}% of certified unpaid` });
  }

  // Forecast: overrun against BAC, 20% overrun -> 100.
  if (p.bac === null || p.forecastEac === null || p.bac === 0) {
    signals.push({ key: 'forecast', score: null, detail: 'No forecast recorded' });
  } else {
    const over = Math.max(0, (p.forecastEac - p.bac) / p.bac);
    signals.push({ key: 'forecast', score: scale(over, 0.20),
      detail: `${(over * 100).toFixed(1)}% above BAC` });
  }

  const scored = signals.filter(s => s.score !== null) as (RiskSignal & { score: number })[];
  const score = scored.length === 0
    ? null
    : scored.reduce((a, s) => a + s.score, 0) / scored.length;

  const band: ProjectRisk['band'] =
    score === null ? 'unknown'
    : score >= 70 ? 'severe'
    : score >= 45 ? 'high'
    : score >= 20 ? 'moderate' : 'low';

  return {
    projectId: p.projectId, code: p.code, score, band, signals,
    blind: signals.length - scored.length,
  };
}

export function portfolioRisk(pop: Population): PortfolioRisk {
  const projects = pop.positions.map(riskOf);
  const scored = projects.filter(p => p.score !== null) as (ProjectRisk & { score: number })[];

  const bands: Record<string, number> = {};
  projects.forEach(p => { bands[p.band] = (bands[p.band] ?? 0) + 1; });

  const keys: RiskSignal['key'][] = ['schedule', 'cost', 'delay', 'liquidity', 'forecast'];
  const signalAverages: Record<string, number | null> = {};
  keys.forEach(k => {
    const vals = projects
      .map(p => p.signals.find(s => s.key === k)?.score)
      .filter((v): v is number => typeof v === 'number');
    signalAverages[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });

  return {
    projects,
    portfolioScore: scored.length
      ? scored.reduce((a, p) => a + p.score, 0) / scored.length : null,
    bands,
    poorlyCovered: projects.filter(p => p.blind > 2).length,
    highest: scored.slice().sort((a, b) => b.score - a.score)[0] ?? null,
    signalAverages,
    derived: true,
    basis: 'A composite index over five archived signals — SPI, CPI, unmitigated delay, '
         + 'uncollected certified revenue and forecast overrun. It is not a roll-up of the '
         + 'risk register: the register is a live store and this layer reads only Timeline. '
         + 'A signal with no archived data is excluded from that project\u2019s average rather '
         + 'than scored as zero, so a sparse project is not flattered by its own gaps.',
  };
}

// ── The full dashboard ─────────────────────────────────────────────────

export interface PortfolioAnalytics {
  population: Population;
  spi: PortfolioSpi;
  cpi: PortfolioCpi;
  delay: PortfolioDelay;
  forecast: PortfolioForecast;
  cash: PortfolioCash;
  fx: PortfolioFx;
  claims: PortfolioClaims;
  changeOrders: PortfolioChangeOrders;
  profitability: PortfolioProfitability;
  risk: PortfolioRisk;
}

export function analyse(
  projects: AnalyticsProject[], opts: AnalyticsOptions = {},
): PortfolioAnalytics {
  const population = buildPopulation(projects, opts);
  return {
    population,
    spi: portfolioSpi(population),
    cpi: portfolioCpi(population),
    delay: portfolioDelay(population),
    forecast: portfolioForecast(population),
    cash: portfolioCash(population),
    fx: portfolioFx(population),
    claims: portfolioClaims(population),
    changeOrders: portfolioChangeOrders(population),
    profitability: portfolioProfitability(population),
    risk: portfolioRisk(population),
  };
}

// ── Comparison ─────────────────────────────────────────────────────────

export type Dimension = 'project' | 'company' | 'sector' | 'country' | 'currency';

export interface ComparisonGroup {
  key: string;
  label: string;
  projectCount: number;
  /** Distinct reporting currencies inside this group. */
  currencies: string[];
  mixedCurrency: boolean;

  spi: number | null;
  cpi: number | null;
  bac: number | null;
  eac: number | null;
  vac: number | null;
  contractValue: number | null;
  certified: number | null;
  outstanding: number | null;
  totalDelay: number | null;
  unmitigated: number | null;
  ldExposure: number | null;
  claimed: number | null;
  approvedCOs: number | null;
  coGrowth: number | null;
  forecastMargin: number | null;
  forecastMarginPct: number | null;
  riskScore: number | null;
  /** Share of the whole selection's contract value. Null when mixed. */
  weight: number | null;
  health: Record<string, number>;
}

export interface Comparison {
  dimension: Dimension;
  groups: ComparisonGroup[];
  /** Groups whose internals span currencies — their money is suppressed. */
  suppressedGroups: string[];
  /** True when the whole selection spans currencies. */
  mixedCurrency: boolean;
  totalProjects: number;
}

function groupKey(p: ProjectPosition, d: Dimension): { key: string; label: string } {
  switch (d) {
    case 'company':  return { key: p.companyId || '—', label: p.companyName || p.companyId || 'Unassigned' };
    case 'sector':   return { key: p.sectorId || '—',  label: p.sectorName || p.sectorId || 'Unassigned' };
    case 'country':  return { key: p.country || '—',   label: p.country || 'Unassigned' };
    case 'currency': return { key: p.reportingCurrency || '—', label: p.reportingCurrency || 'Not recorded' };
    case 'project':
    default:         return { key: p.projectId, label: p.code || p.nameEn || p.projectId };
  }
}

/**
 * Compares along one dimension.
 *
 * Money is suppressed PER GROUP as well as globally: a company reporting in
 * two currencies gets nulls for its own monetary columns even when other
 * companies are single-currency and keep theirs. Suppressing the whole table
 * because one group is mixed would throw away good information; suppressing
 * nothing would print a meaningless sum.
 */
export function compare(
  projects: AnalyticsProject[], dimension: Dimension, opts: AnalyticsOptions = {},
): Comparison {
  const pop = buildPopulation(projects, opts);
  const buckets = new Map<string, { label: string; rows: ProjectPosition[] }>();

  pop.positions.forEach(p => {
    const { key, label } = groupKey(p, dimension);
    const b = buckets.get(key);
    if (b) b.rows.push(p);
    else buckets.set(key, { label, rows: [p] });
  });

  // Denominator for weight: only meaningful on a single-currency selection.
  const grandContract = pop.mixedCurrency
    ? null
    : sum(pop.positions, 'currentContract');

  const suppressed: string[] = [];

  const groups: ComparisonGroup[] = Array.from(buckets.entries()).map(([key, b]) => {
    const rows = b.rows;
    const currencies = Array.from(
      new Set(rows.map(r => r.reportingCurrency).filter(Boolean))).sort();
    const mixed = currencies.length > 1;
    if (mixed) suppressed.push(key);

    const m = (k: keyof ProjectPosition) => (mixed ? null : sum(rows, k));
    const contract = m('currentContract');
    const eac = m('forecastEac');
    const approvedCOs = m('approvedCOs');
    const original = m('originalContract');

    const health: Record<string, number> = {};
    rows.forEach(r => { const h = r.health || 'unknown'; health[h] = (health[h] ?? 0) + 1; });

    const riskScores = rows
      .map(r => riskOf(r).score)
      .filter((v): v is number => v !== null);

    return {
      key, label: b.label,
      projectCount: rows.length,
      currencies, mixedCurrency: mixed,

      // Indices are ratios of summed components — valid regardless of
      // currency mixing ONLY when the components share one. Guarded.
      spi: mixed ? null : ratio(sum(rows, 'ev'), sum(rows, 'pv')),
      cpi: mixed ? null : ratio(sum(rows, 'ev'), sum(rows, 'ac')),
      bac: m('bac'),
      eac,
      vac: m('forecastVac'),
      contractValue: contract,
      certified: m('certified'),
      outstanding: m('outstanding'),
      // Day counts are currency-agnostic and survive mixing.
      totalDelay: sum(rows, 'totalDelay'),
      unmitigated: sum(rows, 'unmitigated'),
      ldExposure: m('ldExposure'),
      claimed: m('claimed'),
      approvedCOs,
      coGrowth: ratio(approvedCOs, original),
      forecastMargin: contract !== null && eac !== null ? contract - eac : null,
      forecastMarginPct: contract !== null && eac !== null && contract !== 0
        ? (contract - eac) / contract : null,
      riskScore: riskScores.length
        ? riskScores.reduce((a, x) => a + x, 0) / riskScores.length : null,
      weight: grandContract !== null && grandContract !== 0 && contract !== null
        ? contract / grandContract : null,
      health,
    };
  });

  groups.sort((a, b) => (b.contractValue ?? 0) - (a.contractValue ?? 0) || a.label.localeCompare(b.label));

  return {
    dimension, groups,
    suppressedGroups: suppressed,
    mixedCurrency: pop.mixedCurrency,
    totalProjects: pop.positions.length,
  };
}

// ── Trend analysis ─────────────────────────────────────────────────────

export interface TrendPoint {
  periodId: string;
  label: string;
  /** Projects that had approved THIS period. Coverage varies by period. */
  projectCount: number;
  spi: number | null;
  cpi: number | null;
  ev: number | null;
  pv: number | null;
  ac: number | null;
  bac: number | null;
  eac: number | null;
  vac: number | null;
  totalDelay: number | null;
  unmitigated: number | null;
  ldExposure: number | null;
  certified: number | null;
  outstanding: number | null;
  cashNet: number | null;
  claimed: number | null;
  approvedCOs: number | null;
  forecastMargin: number | null;
  riskScore: number | null;
  currencies: string[];
  mixedCurrency: boolean;
  /** Movement in the weighted CPI against the previous point. */
  cpiDelta: number | null;
  spiDelta: number | null;
  eacDelta: number | null;
}

export interface PortfolioTrend {
  points: TrendPoint[];
  /**
   * True when project coverage changes between points. A rise in portfolio
   * EAC means one thing when the same eight projects reported both months
   * and something else when a ninth joined — this flag is what stops the
   * second being read as the first.
   */
  coverageVaries: boolean;
  minProjects: number;
  maxProjects: number;
}

/**
 * Portfolio metrics period by period, built entirely from the archive.
 *
 * Each point aggregates only the projects that actually approved that
 * period. That is the honest construction, and it is why `coverageVaries`
 * exists: without it, a coverage change reads as a performance change.
 */
export function portfolioTrend(projects: AnalyticsProject[]): PortfolioTrend {
  const periodIds = Array.from(new Set(
    projects.flatMap(p => approvedSnapshots(readTimeline(p.id)).map(s => s.periodId))
  )).sort();

  let prev: TrendPoint | null = null;
  const points: TrendPoint[] = periodIds.map(pid => {
    const pop = buildPopulation(projects, { align: 'asOf', periodId: pid });
    const rows = pop.positions;
    const m = (k: keyof ProjectPosition) => (pop.mixedCurrency ? null : sum(rows, k));

    const contract = m('currentContract');
    const eac = m('forecastEac');
    const spi = pop.mixedCurrency ? null : ratio(sum(rows, 'ev'), sum(rows, 'pv'));
    const cpi = pop.mixedCurrency ? null : ratio(sum(rows, 'ev'), sum(rows, 'ac'));
    const riskScores = rows.map(r => riskOf(r).score).filter((v): v is number => v !== null);

    const pt: TrendPoint = {
      periodId: pid,
      label: rows[0]?.period || pid,
      projectCount: rows.length,
      spi, cpi,
      ev: m('ev'), pv: m('pv'), ac: m('ac'), bac: m('bac'),
      eac, vac: m('forecastVac'),
      totalDelay: sum(rows, 'totalDelay'),
      unmitigated: sum(rows, 'unmitigated'),
      ldExposure: m('ldExposure'),
      certified: m('certified'),
      outstanding: m('outstanding'),
      cashNet: m('cashNet'),
      claimed: m('claimed'),
      approvedCOs: m('approvedCOs'),
      forecastMargin: contract !== null && eac !== null ? contract - eac : null,
      riskScore: riskScores.length
        ? riskScores.reduce((a, x) => a + x, 0) / riskScores.length : null,
      currencies: pop.currencies,
      mixedCurrency: pop.mixedCurrency,
      cpiDelta: prev && prev.cpi !== null && cpi !== null ? cpi - prev.cpi : null,
      spiDelta: prev && prev.spi !== null && spi !== null ? spi - prev.spi : null,
      eacDelta: prev && prev.eac !== null && eac !== null ? eac - prev.eac : null,
    };
    prev = pt;
    return pt;
  });

  const counts = points.map(p => p.projectCount);
  return {
    points,
    coverageVaries: counts.length > 1 && new Set(counts).size > 1,
    minProjects: counts.length ? Math.min(...counts) : 0,
    maxProjects: counts.length ? Math.max(...counts) : 0,
  };
}

/** One project's own trend, for the comparison drill-down. */
export function projectTrend(projectId: string): {
  periodId: string; label: string; dataDate: string;
  spi: number | null; cpi: number | null; eac: number | null; vac: number | null;
  unmitigated: number | null; ldExposure: number | null; certified: number | null;
  health: string;
}[] {
  return approvedSnapshots(readTimeline(projectId)).map(s => ({
    periodId: s.periodId,
    label: s.periodLabel || s.periodId,
    dataDate: s.dataDate,
    spi: s.evm?.spi ?? null,
    cpi: s.evm?.cpi ?? null,
    eac: n(s.forecast?.eac ?? s.evm?.eac),
    vac: n(s.forecast?.vac ?? s.evm?.vac),
    unmitigated: n(s.delay?.unmitigated),
    ldExposure: n(s.ld?.exposure),
    certified: n(s.certificates?.certified),
    health: s.projectStatus?.health ?? s.kpi?.health ?? '',
  }));
}

/** Ranks projects on one archived metric. Nulls are excluded, not last. */
export function rank(
  pop: Population, field: keyof ProjectPosition, direction: 'asc' | 'desc' = 'desc',
): { projectId: string; code: string; label: string; value: number }[] {
  return pop.positions
    .map(p => ({
      projectId: p.projectId, code: p.code,
      label: p.code || p.nameEn || p.projectId,
      value: p[field],
    }))
    .filter((x): x is { projectId: string; code: string; label: string; value: number } =>
      typeof x.value === 'number' && Number.isFinite(x.value))
    .sort((a, b) => (direction === 'asc' ? a.value - b.value : b.value - a.value));
}
