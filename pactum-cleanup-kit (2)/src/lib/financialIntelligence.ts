/**
 * Enterprise Financial Intelligence.
 * Destination: src/lib/financialIntelligence.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3 · READ-ONLY, TIMELINE-ONLY, NO DUPLICATED CALCULATION
 *
 *   This layer performs no business calculation of its own. Everything it
 *   reports is either (a) a figure a project already computed and froze, or
 *   (b) a movement between two such figures. It imports the timeline query
 *   layer, the FX analytics of Phase 2 and the portfolio analytics of Phase
 *   7 — and reuses them rather than reimplementing them.
 *
 *   Specifically NOT reimplemented here:
 *     FX gain/loss        → `fxAnalytics.fxTranslation`
 *     Portfolio SPI/CPI   → `portfolioAnalytics.portfolioSpi / portfolioCpi`
 *     Portfolio risk      → `portfolioAnalytics.portfolioRisk`
 *     EAC                 → the EVM engine's, read from the archive
 *
 * THE HONESTY PROBLEM THIS PHASE CREATES
 *
 *   A brief that asks for "predictive analytics" and "forecast accuracy" is
 *   asking for two things that sound similar and are not:
 *
 *     DRIFT     How much has our forecast MOVED? Computable today, from two
 *               archived periods. Says nothing about whether it is right.
 *
 *     ACCURACY  Was the forecast RIGHT? Requires an outturn to compare
 *               against. On a live project there is none, so accuracy
 *               against final cost CANNOT be computed and is not reported.
 *
 *   What is reported is drift, stability and — where an early period's
 *   forecast can be checked against a later period's actual — a bounded
 *   accuracy measure that says exactly what it measured.
 *
 *   Every predictive output carries `basis` and `confidence`. A projection
 *   from two data points is arithmetic, not a forecast, and it says so.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  readTimeline, approvedSnapshots, latestSnapshot, snapshotFor,
  TimelineStore, TimelineSnapshot,
} from './timeline';
import { fxTranslation, FxTranslation, fxExposure, FxProject } from './reporting/fxAnalytics';
import {
  buildPopulation, portfolioSpi, portfolioCpi, portfolioRisk,
  AnalyticsProject, Population,
} from './portfolioAnalytics';

// ── Shared ─────────────────────────────────────────────────────────────

export interface FiProject {
  id: string;
  code?: string;
  nameEn?: string;
  nameAr?: string;
  companyId?: string;
  companyName?: string;
}

const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const delta = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : b - a;

const pct = (a: number | null, b: number | null): number | null =>
  a === null || b === null || a === 0 ? null : (b - a) / Math.abs(a);

const ratio = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

/** Clamps a value onto 0–100 against a stated ceiling. */
const scale = (v: number, ceiling: number): number =>
  Math.max(0, Math.min(100, (v / ceiling) * 100));

/** Ordered approved history for one project. */
function history(projectId: string): TimelineSnapshot[] {
  return approvedSnapshots(readTimeline(projectId));
}

/** Index of a period in the history, or -1. */
function indexOf(list: TimelineSnapshot[], periodId?: string): number {
  if (!periodId) return list.length - 1;
  return list.findIndex(s => s.periodId === periodId);
}

// ── 1 · CONTRACT VALUE EVOLUTION ───────────────────────────────────────

export interface ContractEvolutionPoint {
  periodId: string;
  period: string;
  dataDate: string;
  originalContract: number | null;
  approvedCOs: number | null;
  pendingCOs: number | null;
  approvedClaims: number | null;
  currentContract: number | null;
  /** Movement in current contract against the previous period. */
  movement: number | null;
  /** Growth against the ORIGINAL contract, cumulative. */
  growthFromOriginal: number | null;
  /** Baseline version in force, so a re-baseline is visible in the series. */
  baselineVersion: number | null;
  rebaselined: boolean;
  reportingCurrency: string;
}

export interface ContractEvolution {
  points: ContractEvolutionPoint[];
  originalContract: number | null;
  currentContract: number | null;
  totalGrowth: number | null;
  totalGrowthPct: number | null;
  /** Periods in which the contract value moved. */
  movementCount: number;
  /** Largest single-period movement. */
  largestMovement: ContractEvolutionPoint | null;
  /** True when the reporting currency is not constant across the series. */
  currencyChanged: boolean;
  /** True when a baseline version changed mid-series. */
  rebaselinedDuring: boolean;
  basis: string;
}

/**
 * How the contract value moved, period by period.
 *
 * Every figure is read from the archive. The baseline version is carried
 * alongside because a jump in contract value means one thing when both
 * periods sat on Contract Baseline V2 and something else entirely when the
 * second sat on V3 — and a reader with only the numbers cannot tell.
 */
export function contractEvolution(projectId: string): ContractEvolution {
  const list = history(projectId);
  const currencies = new Set<string>();
  let prevCurrent: number | null = null;
  let prevBaseline = '';
  let original: number | null = null;

  const points: ContractEvolutionPoint[] = list.map(s => {
    const cur = n(s.commercial?.currentContract);
    const orig = n(s.commercial?.originalContract);
    if (original === null && orig !== null) original = orig;
    const ccy = s.exchange?.reportingCurrency ?? '';
    if (ccy) currencies.add(ccy);

    const blId = s.baselines?.contract?.id ?? '';
    const moved = prevBaseline !== '' && blId !== '' && blId !== prevBaseline;

    const pt: ContractEvolutionPoint = {
      periodId: s.periodId,
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      originalContract: orig,
      approvedCOs: n(s.commercial?.approvedChangeOrders),
      pendingCOs: n(s.commercial?.pendingChangeOrders),
      approvedClaims: n(s.commercial?.approvedClaims),
      currentContract: cur,
      movement: delta(prevCurrent, cur),
      growthFromOriginal: pct(orig, cur),
      baselineVersion: s.baselines?.contract?.version ?? null,
      rebaselined: moved,
      reportingCurrency: ccy,
    };
    prevCurrent = cur;
    if (blId) prevBaseline = blId;
    return pt;
  });

  const last = points[points.length - 1] ?? null;
  const withMovement = points.filter(p => p.movement !== null && p.movement !== 0);
  const largest = withMovement.length
    ? withMovement.reduce((a, b) =>
        Math.abs(b.movement!) > Math.abs(a.movement!) ? b : a)
    : null;

  return {
    points,
    originalContract: original,
    currentContract: last?.currentContract ?? null,
    totalGrowth: delta(original, last?.currentContract ?? null),
    totalGrowthPct: pct(original, last?.currentContract ?? null),
    movementCount: withMovement.length,
    largestMovement: largest,
    currencyChanged: currencies.size > 1,
    rebaselinedDuring: points.some(p => p.rebaselined),
    basis:
      'Each point is the contract position that period reported. Approved change orders move '
      + 'the current contract; pending ones and approved claims do not, and are shown '
      + 'separately as exposure. The baseline version in force is carried alongside so a '
      + 'movement caused by a re-baseline is distinguishable from one caused by a variation.',
  };
}

// ── 2 · BUDGET EVOLUTION ───────────────────────────────────────────────

export interface BudgetEvolutionPoint {
  periodId: string;
  period: string;
  dataDate: string;
  planned: number | null;
  actual: number | null;
  forecast: number | null;
  variance: number | null;
  /** Actual spend in this period alone — the difference from the previous. */
  periodSpend: number | null;
  /** Movement in the forecast against the previous period. */
  forecastMovement: number | null;
  /** actual / planned. */
  burnRate: number | null;
  baselineVersion: number | null;
  rebaselined: boolean;
}

export interface BudgetEvolution {
  points: BudgetEvolutionPoint[];
  plannedNow: number | null;
  actualNow: number | null;
  forecastNow: number | null;
  /** Movement in the forecast across the whole archived window. */
  forecastDrift: number | null;
  forecastDriftPct: number | null;
  /** Mean spend per period. Drives the projection below. */
  meanPeriodSpend: number | null;
  rebaselinedDuring: boolean;
  basis: string;
}

export function budgetEvolution(projectId: string): BudgetEvolution {
  const list = history(projectId);
  let prevActual: number | null = null;
  let prevForecast: number | null = null;
  let prevBaseline = '';
  let firstForecast: number | null = null;

  const points: BudgetEvolutionPoint[] = list.map(s => {
    const actual = n(s.budget?.totalActual);
    const forecast = n(s.budget?.totalForecast);
    const planned = n(s.budget?.totalPlanned);
    if (firstForecast === null && forecast !== null) firstForecast = forecast;

    const blId = s.baselines?.budget?.id ?? '';
    const moved = prevBaseline !== '' && blId !== '' && blId !== prevBaseline;

    const pt: BudgetEvolutionPoint = {
      periodId: s.periodId,
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      planned, actual, forecast,
      variance: n(s.budget?.variance),
      periodSpend: delta(prevActual, actual),
      forecastMovement: delta(prevForecast, forecast),
      burnRate: ratio(actual, planned),
      baselineVersion: s.baselines?.budget?.version ?? null,
      rebaselined: moved,
    };
    prevActual = actual;
    prevForecast = forecast;
    if (blId) prevBaseline = blId;
    return pt;
  });

  const spends = points
    .map(p => p.periodSpend)
    .filter((v): v is number => v !== null && v > 0);
  const last = points[points.length - 1] ?? null;

  return {
    points,
    plannedNow: last?.planned ?? null,
    actualNow: last?.actual ?? null,
    forecastNow: last?.forecast ?? null,
    forecastDrift: delta(firstForecast, last?.forecast ?? null),
    forecastDriftPct: pct(firstForecast, last?.forecast ?? null),
    meanPeriodSpend: spends.length
      ? spends.reduce((a, b) => a + b, 0) / spends.length : null,
    rebaselinedDuring: points.some(p => p.rebaselined),
    basis:
      'Period spend is the increase in cumulative actual cost between two approved periods. '
      + 'It is a difference of two archived figures, not a separately recorded number, so a '
      + 'period in which the archive was not updated shows as zero spend rather than as '
      + 'missing.',
  };
}

// ── 3 · FORECAST ACCURACY ──────────────────────────────────────────────

export interface AccuracyRow {
  /** The period that made the forecast. */
  forecastPeriod: string;
  forecastPeriodId: string;
  forecastEac: number | null;
  forecastMethod: string;
  /** The later period the forecast is checked against. */
  checkPeriod: string;
  checkPeriodId: string;
  /** Periods elapsed between the two. */
  horizon: number;
  /** That later period's own EAC — what we then believed. */
  laterEac: number | null;
  /** How far the forecast moved. Positive = the outturn view worsened. */
  drift: number | null;
  driftPct: number | null;
  /** Actual cost recorded by the check period. */
  actualAtCheck: number | null;
  /** True when the forecast was already exceeded by actual cost. */
  breached: boolean;
}

export interface ForecastAccuracy {
  rows: AccuracyRow[];
  /** Mean absolute drift as a share of the forecast. Lower is steadier. */
  meanAbsDriftPct: number | null;
  /** Signed mean: positive = a persistent tendency to under-forecast. */
  meanSignedDriftPct: number | null;
  /** Forecasts that moved by more than 10%. */
  volatileCount: number;
  /** Forecasts already exceeded by recorded actual cost. */
  breachedCount: number;
  /** Direction of the bias, in words. */
  bias: 'under-forecasting' | 'over-forecasting' | 'balanced' | 'unknown';
  /** What this measured, and what it did NOT. */
  basis: string;
  /** Stated limit: accuracy against final outturn is not computable. */
  limitation: string;
}

const ACCURACY_LIMIT =
  'This measures forecast DRIFT, not accuracy against outturn. Accuracy in the strict sense '
  + 'requires a final cost to compare against, and a live project has none — so it is not '
  + 'reported here rather than approximated by a figure that would look like it. What each row '
  + 'shows is how far the view of the outturn moved between two approved periods, which is a '
  + 'real and checkable fact about the archive.';

/**
 * How stable the outturn forecast has been.
 *
 * Every row compares one period's EAC against a later period's EAC, both
 * read from the archive. A steady project produces small drifts; a project
 * whose forecast walks upward every month is telling you something before
 * the variance does.
 */
export function forecastAccuracy(projectId: string): ForecastAccuracy {
  const list = history(projectId);
  const rows: AccuracyRow[] = [];

  // Compare each period against the LATEST, which is the strongest check
  // available: the longest horizon and the most information.
  const latest = list[list.length - 1];
  if (latest) {
    list.slice(0, -1).forEach((s, i) => {
      const fEac = n(s.forecast?.eac ?? s.evm?.eac);
      const lEac = n(latest.forecast?.eac ?? latest.evm?.eac);
      const actual = n(latest.evm?.ac ?? latest.budget?.totalActual);
      rows.push({
        forecastPeriod: s.periodLabel || s.periodId,
        forecastPeriodId: s.periodId,
        forecastEac: fEac,
        forecastMethod: s.forecast?.method ?? s.evm?.eacMethod ?? '',
        checkPeriod: latest.periodLabel || latest.periodId,
        checkPeriodId: latest.periodId,
        horizon: list.length - 1 - i,
        laterEac: lEac,
        drift: delta(fEac, lEac),
        driftPct: pct(fEac, lEac),
        actualAtCheck: actual,
        breached: fEac !== null && actual !== null && actual > fEac,
      });
    });
  }

  const pcts = rows.map(r => r.driftPct).filter((v): v is number => v !== null);
  const meanAbs = pcts.length
    ? pcts.reduce((a, b) => a + Math.abs(b), 0) / pcts.length : null;
  const meanSigned = pcts.length
    ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;

  return {
    rows,
    meanAbsDriftPct: meanAbs,
    meanSignedDriftPct: meanSigned,
    volatileCount: pcts.filter(v => Math.abs(v) > 0.10).length,
    breachedCount: rows.filter(r => r.breached).length,
    bias: meanSigned === null ? 'unknown'
      : meanSigned > 0.02 ? 'under-forecasting'
      : meanSigned < -0.02 ? 'over-forecasting' : 'balanced',
    basis:
      'Each row compares the EAC one period reported against the EAC the latest approved '
      + 'period reports. Both are archived figures produced by the EVM engine; neither is '
      + 'recomputed here.',
    limitation: ACCURACY_LIMIT,
  };
}

// ── 4 · COST VARIANCE TREND ────────────────────────────────────────────

export interface VarianceTrendPoint {
  periodId: string;
  period: string;
  dataDate: string;
  /** EVM cost variance: EV − AC, as archived. */
  cv: number | null;
  /** EVM schedule variance: EV − PV, as archived. */
  sv: number | null;
  cpi: number | null;
  spi: number | null;
  /** Budget variance as the Budget module reported it. */
  budgetVariance: number | null;
  /** Movement in CV against the previous period. */
  cvMovement: number | null;
  /** True when CV worsened this period. */
  deteriorating: boolean;
  eacMethod: string;
}

export interface CostVarianceTrend {
  points: VarianceTrendPoint[];
  currentCv: number | null;
  currentCpi: number | null;
  /** Consecutive periods of worsening CV, counting back from the latest. */
  consecutiveDeterioration: number;
  /** Total CV movement across the window. */
  totalMovement: number | null;
  /** True when the EAC method changed mid-series — EACs then differ in kind. */
  methodChanged: boolean;
  methods: string[];
  basis: string;
}

export function costVarianceTrend(projectId: string): CostVarianceTrend {
  const list = history(projectId);
  let prevCv: number | null = null;
  const methods = new Set<string>();

  const points: VarianceTrendPoint[] = list.map(s => {
    const cv = n(s.evm?.cv);
    const method = s.evm?.eacMethod ?? '';
    if (method) methods.add(method);
    const mv = delta(prevCv, cv);
    const pt: VarianceTrendPoint = {
      periodId: s.periodId,
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      cv,
      sv: n(s.evm?.sv),
      cpi: s.evm?.cpi ?? null,
      spi: s.evm?.spi ?? null,
      budgetVariance: n(s.budget?.variance),
      cvMovement: mv,
      deteriorating: mv !== null && mv < 0,
      eacMethod: method,
    };
    prevCv = cv;
    return pt;
  });

  // Count back from the latest while CV keeps worsening.
  let streak = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].deteriorating) streak++; else break;
  }

  const first = points.find(p => p.cv !== null)?.cv ?? null;
  const last = [...points].reverse().find(p => p.cv !== null)?.cv ?? null;

  return {
    points,
    currentCv: last,
    currentCpi: points[points.length - 1]?.cpi ?? null,
    consecutiveDeterioration: streak,
    totalMovement: delta(first, last),
    methodChanged: methods.size > 1,
    methods: Array.from(methods).sort(),
    basis:
      'Cost and schedule variance are the EVM engine\u2019s own outputs, read from each approved '
      + 'period. Nothing is recomputed. Where the EAC method changed mid-series the resulting '
      + 'forecasts differ in kind and are not strictly comparable, which is flagged rather '
      + 'than smoothed over.',
  };
}

// ── 5 · CASH FLOW VARIANCE TREND ───────────────────────────────────────

export interface CashTrendPoint {
  periodId: string;
  period: string;
  dataDate: string;
  totalIn: number | null;
  totalOut: number | null;
  netFlow: number | null;
  cumulativeNet: number | null;
  certified: number | null;
  paid: number | null;
  outstanding: number | null;
  /** Certified but unpaid, as a share of certified. */
  collectionGap: number | null;
  /** Movement in cumulative net against the previous period. */
  cumulativeMovement: number | null;
  /** Cash conversion: paid ÷ certified. */
  conversion: number | null;
}

export interface CashFlowVarianceTrend {
  points: CashTrendPoint[];
  currentNet: number | null;
  currentCumulative: number | null;
  /** Periods in which net flow was negative. */
  negativePeriods: number;
  /** Consecutive negative periods, counting back. */
  consecutiveNegative: number;
  /** Mean net flow per period — the run rate. */
  meanNetFlow: number | null;
  /** Trend in the collection gap: widening is a receivables problem. */
  collectionGapTrend: number | null;
  basis: string;
}

export function cashFlowVarianceTrend(projectId: string): CashFlowVarianceTrend {
  const list = history(projectId);
  let prevCum: number | null = null;
  let firstGap: number | null = null;

  const points: CashTrendPoint[] = list.map(s => {
    const cum = n(s.cash?.cumulativeNet);
    const certified = n(s.certificates?.certified);
    const outstanding = n(s.certificates?.outstanding);
    const paid = n(s.certificates?.paid);
    const gap = ratio(outstanding, certified);
    if (firstGap === null && gap !== null) firstGap = gap;

    const pt: CashTrendPoint = {
      periodId: s.periodId,
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      totalIn: n(s.cash?.totalIn),
      totalOut: n(s.cash?.totalOut),
      netFlow: n(s.cash?.netFlow),
      cumulativeNet: cum,
      certified, paid, outstanding,
      collectionGap: gap,
      cumulativeMovement: delta(prevCum, cum),
      conversion: ratio(paid, certified),
    };
    prevCum = cum;
    return pt;
  });

  const nets = points.map(p => p.netFlow).filter((v): v is number => v !== null);
  let streak = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if ((points[i].netFlow ?? 0) < 0) streak++; else break;
  }
  const lastGap = [...points].reverse().find(p => p.collectionGap !== null)?.collectionGap ?? null;

  return {
    points,
    currentNet: points[points.length - 1]?.netFlow ?? null,
    currentCumulative: points[points.length - 1]?.cumulativeNet ?? null,
    negativePeriods: nets.filter(v => v < 0).length,
    consecutiveNegative: streak,
    meanNetFlow: nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : null,
    collectionGapTrend: delta(firstGap, lastGap),
    basis:
      'Cash figures are the Cash Flow module\u2019s own outputs and the collection gap is derived '
      + 'from archived certificate positions. Owner certificates are revenue and are never '
      + 'treated as actual cost.',
  };
}

// ── 6 · MARGIN TREND ───────────────────────────────────────────────────

export interface MarginPoint {
  periodId: string;
  period: string;
  dataDate: string;
  certified: number | null;
  costIncurred: number | null;
  /** certified − cost. Indicative, derived. */
  earnedMargin: number | null;
  earnedMarginPct: number | null;
  currentContract: number | null;
  eac: number | null;
  /** contract − EAC. Indicative, derived. */
  forecastMargin: number | null;
  forecastMarginPct: number | null;
  /** Movement in forecast margin against the previous period. */
  movement: number | null;
  /** True when the forecast margin fell this period. */
  eroding: boolean;
}

export interface MarginTrend {
  points: MarginPoint[];
  currentEarnedPct: number | null;
  currentForecastPct: number | null;
  /** Movement in forecast margin across the whole window. */
  totalErosion: number | null;
  totalErosionPct: number | null;
  consecutiveErosion: number;
  /** True when the forecast margin has gone negative at any point. */
  everNegative: boolean;
  derived: true;
  basis: string;
}

const MARGIN_BASIS =
  'Margin is DERIVED, not archived: no module computes one and Timeline stores none. Earned '
  + 'margin is certified revenue less actual cost; forecast margin is current contract less '
  + 'EAC. Both are constructed here from archived figures and must be read as indicative '
  + 'rather than as an audited profit position.';

export function marginTrend(projectId: string): MarginTrend {
  const list = history(projectId);
  let prevForecast: number | null = null;
  let firstForecast: number | null = null;

  const points: MarginPoint[] = list.map(s => {
    const certified = n(s.certificates?.certified);
    const cost = n(s.budget?.totalActual ?? s.evm?.ac);
    const contract = n(s.commercial?.currentContract);
    const eac = n(s.forecast?.eac ?? s.evm?.eac);

    const earned = certified !== null && cost !== null ? certified - cost : null;
    const fMargin = contract !== null && eac !== null ? contract - eac : null;
    if (firstForecast === null && fMargin !== null) firstForecast = fMargin;
    const mv = delta(prevForecast, fMargin);

    const pt: MarginPoint = {
      periodId: s.periodId,
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      certified, costIncurred: cost,
      earnedMargin: earned,
      earnedMarginPct: certified !== null && certified !== 0 && earned !== null
        ? earned / certified : null,
      currentContract: contract, eac,
      forecastMargin: fMargin,
      forecastMarginPct: contract !== null && contract !== 0 && fMargin !== null
        ? fMargin / contract : null,
      movement: mv,
      eroding: mv !== null && mv < 0,
    };
    prevForecast = fMargin;
    return pt;
  });

  let streak = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].eroding) streak++; else break;
  }
  const last = points[points.length - 1] ?? null;

  return {
    points,
    currentEarnedPct: last?.earnedMarginPct ?? null,
    currentForecastPct: last?.forecastMarginPct ?? null,
    totalErosion: delta(firstForecast, last?.forecastMargin ?? null),
    totalErosionPct: pct(firstForecast, last?.forecastMargin ?? null),
    consecutiveErosion: streak,
    everNegative: points.some(p => (p.forecastMargin ?? 0) < 0),
    derived: true,
    basis: MARGIN_BASIS,
  };
}

// ── 7 · FORECAST CURRENCY IMPACT ───────────────────────────────────────

export interface CurrencyImpact {
  currency: string;
  /** Foreign amount the latest period reported transacting. */
  exposure: number;
  /** Rate that period applied. */
  currentRate: number;
  /** Value at that rate. */
  currentValue: number;
  /** Value if the rate moved by the scenario amount. */
  scenarioRate: number;
  scenarioValue: number;
  impact: number;
  impactPct: number | null;
}

export interface ForecastCurrencyImpact {
  scenarios: { label: string; movePct: number; rows: CurrencyImpact[];
               totalImpact: number; impactOnEac: number | null }[];
  baseEac: number | null;
  reportingCurrency: string;
  totalExposure: number;
  /** Exposure as a share of EAC — how much of the outturn is rate-dependent. */
  exposureShareOfEac: number | null;
  period: string;
  /** Sensitivity, not prediction. Stated so nobody books it. */
  basis: string;
}

/**
 * What a rate movement would do to the forecast.
 *
 * A SENSITIVITY ANALYSIS, not a prediction. It takes the exposure a period
 * actually reported and asks what a ±5% and ±10% move would mean. It does
 * not forecast rates, because nothing in this platform can and pretending
 * otherwise would put a fabricated number beside real ones.
 */
export function forecastCurrencyImpact(
  projectId: string, periodId?: string,
): ForecastCurrencyImpact {
  const list = history(projectId);
  const i = indexOf(list, periodId);
  const s = i >= 0 ? list[i] : null;

  const applied = s?.exchange?.appliedRates ?? [];
  const eac = n(s?.forecast?.eac ?? s?.evm?.eac);
  const totalExposure = applied.reduce((a, x) => a + x.convertedTotal, 0);

  const build = (label: string, movePct: number) => {
    const rows: CurrencyImpact[] = applied.map(a => {
      const scenarioRate = a.rate * (1 + movePct);
      const scenarioValue = a.originalTotal * scenarioRate;
      return {
        currency: a.currency,
        exposure: a.originalTotal,
        currentRate: a.rate,
        currentValue: a.convertedTotal,
        scenarioRate,
        scenarioValue,
        impact: scenarioValue - a.convertedTotal,
        impactPct: a.convertedTotal !== 0
          ? (scenarioValue - a.convertedTotal) / a.convertedTotal : null,
      };
    });
    const totalImpact = rows.reduce((a, r) => a + r.impact, 0);
    return {
      label, movePct, rows, totalImpact,
      impactOnEac: eac !== null && eac !== 0 ? totalImpact / eac : null,
    };
  };

  return {
    scenarios: [
      build('Reporting currency weakens 10%', 0.10),
      build('Reporting currency weakens 5%', 0.05),
      build('Reporting currency strengthens 5%', -0.05),
      build('Reporting currency strengthens 10%', -0.10),
    ],
    baseEac: eac,
    reportingCurrency: s?.exchange?.reportingCurrency ?? '',
    totalExposure,
    exposureShareOfEac: eac !== null && eac !== 0 ? totalExposure / eac : null,
    period: s ? (s.periodLabel || s.periodId) : '',
    basis:
      'A SENSITIVITY analysis, not a prediction. It applies hypothetical rate movements to the '
      + 'exposure this period actually reported. No rate is forecast: nothing in this platform '
      + 'predicts exchange rates, and presenting a projected rate beside archived figures would '
      + 'give a guess the same standing as a fact.',
}; }

// ── 8 · HISTORICAL COMPARISON ──────────────────────────────────────────

export type ComparisonBasis =
  | 'current' | 'last-month' | 'last-quarter' | 'baseline'
  | 'original-contract' | 'current-forecast';

export interface ComparisonMetric {
  key: string;
  label: string;
  labelAr: string;
  kind: 'money' | 'days' | 'index' | 'pct';
  from: number | null;
  to: number | null;
  delta: number | null;
  pctDelta: number | null;
  /** True when the movement is unfavourable. */
  adverse: boolean;
}

export interface HistoricalComparison {
  ok: boolean;
  reason?: string;
  basis: ComparisonBasis;
  fromLabel: string;
  toLabel: string;
  fromPeriodId: string;
  toPeriodId: string;
  metrics: ComparisonMetric[];
  adverseCount: number;
  /** True when the two sides sat on different baseline versions. */
  baselineChanged: boolean;
  /** True when the two sides used different reporting currencies. */
  currencyChanged: boolean;
  note: string;
}

/** Metric definitions, shared by every comparison basis. */
const METRICS: {
  key: string; label: string; labelAr: string; kind: ComparisonMetric['kind'];
  read: (s: TimelineSnapshot) => number | null;
  /** Which direction is bad. */
  adverseWhen: 'up' | 'down';
}[] = [
  { key: 'currentContract', label: 'Contract Amount', labelAr: 'إجمالي قيمة العقد', kind: 'money',
    read: s => n(s.commercial?.currentContract), adverseWhen: 'down' },
  { key: 'eac', label: 'EAC', labelAr: 'التكلفة عند الإنجاز', kind: 'money',
    read: s => n(s.forecast?.eac ?? s.evm?.eac), adverseWhen: 'up' },
  { key: 'vac', label: 'VAC', labelAr: 'الانحراف عند الإنجاز', kind: 'money',
    read: s => n(s.forecast?.vac ?? s.evm?.vac), adverseWhen: 'down' },
  { key: 'ac', label: 'Actual Cost', labelAr: 'التكلفة الفعلية', kind: 'money',
    read: s => n(s.evm?.ac ?? s.budget?.totalActual), adverseWhen: 'up' },
  { key: 'certified', label: 'Certified', labelAr: 'المعتمد', kind: 'money',
    read: s => n(s.certificates?.certified), adverseWhen: 'down' },
  { key: 'outstanding', label: 'Uncollected', labelAr: 'غير المحصَّل', kind: 'money',
    read: s => n(s.certificates?.outstanding), adverseWhen: 'up' },
  { key: 'cashNet', label: 'Net Cash Flow', labelAr: 'صافي التدفق', kind: 'money',
    read: s => n(s.cash?.netFlow), adverseWhen: 'down' },
  { key: 'spi', label: 'SPI', labelAr: 'مؤشر الجدول', kind: 'index',
    read: s => s.evm?.spi ?? null, adverseWhen: 'down' },
  { key: 'cpi', label: 'CPI', labelAr: 'مؤشر التكلفة', kind: 'index',
    read: s => s.evm?.cpi ?? null, adverseWhen: 'down' },
  { key: 'totalDelay', label: 'Total Delay', labelAr: 'إجمالي التأخير', kind: 'days',
    read: s => n(s.delay?.totalDelay), adverseWhen: 'up' },
  { key: 'unmitigated', label: 'Unmitigated Delay', labelAr: 'التأخير غير المعوَّض', kind: 'days',
    read: s => n(s.delay?.unmitigated), adverseWhen: 'up' },
  { key: 'ldExposure', label: 'LD Exposure', labelAr: 'الغرامات', kind: 'money',
    read: s => n(s.ld?.exposure), adverseWhen: 'up' },
  { key: 'claimed', label: 'Claims Value', labelAr: 'قيمة المطالبات', kind: 'money',
    read: s => n(s.claims?.totalClaimed), adverseWhen: 'up' },
];

/**
 * Compares the current position against one of six reference points.
 *
 * Every basis resolves to two ARCHIVED snapshots, except `original-contract`
 * which reads the original contract value the first archived period
 * recorded. There is no path here that reads a live module.
 */
export function historicalComparison(
  projectId: string, basis: ComparisonBasis, currentPeriodId?: string,
): HistoricalComparison {
  const list = history(projectId);
  const ci = indexOf(list, currentPeriodId);
  const current = ci >= 0 ? list[ci] : null;

  const fail = (reason: string): HistoricalComparison => ({
    ok: false, reason, basis,
    fromLabel: '', toLabel: '', fromPeriodId: '', toPeriodId: '',
    metrics: [], adverseCount: 0,
    baselineChanged: false, currencyChanged: false, note: '',
  });

  if (!current) return fail('No approved period to compare from.');

  let from: TimelineSnapshot | null = null;
  let fromLabel = '';

  switch (basis) {
    case 'current':
      from = current; fromLabel = current.periodLabel || current.periodId; break;

    case 'last-month':
      from = ci > 0 ? list[ci - 1] : null;
      fromLabel = from ? (from.periodLabel || from.periodId) : '';
      if (!from) return fail('This is the first approved period — there is no previous month.');
      break;

    case 'last-quarter':
      // Three approved periods back. Not three calendar months: the archive
      // is the unit of account here, and a project that skipped a month
      // would otherwise silently compare against the wrong period.
      from = ci >= 3 ? list[ci - 3] : null;
      fromLabel = from ? (from.periodLabel || from.periodId) : '';
      if (!from) return fail('Fewer than four approved periods — no quarter-ago position.');
      break;

    case 'baseline': {
      // The earliest period that sat on the CURRENT baseline. That is the
      // point from which today's plan has been in force; comparing against
      // an older baseline would mix a plan change with performance.
      const blId = current.baselines?.contract?.id ?? '';
      if (!blId) {
        from = list[0];
        fromLabel = `${from.periodLabel || from.periodId} (first approved — no baseline recorded)`;
      } else {
        const onSame = list.filter(s => (s.baselines?.contract?.id ?? '') === blId);
        from = onSame[0] ?? list[0];
        fromLabel = `${from.periodLabel || from.periodId} (baseline V${current.baselines?.contract?.version ?? '?'})`;
      }
      break;
    }

    case 'original-contract': {
      // A synthetic reference: the original contract as first archived, with
      // every other metric absent. Comparing EAC against an original
      // contract that never had one would invent a movement.
      const first = list[0];
      const orig = n(first?.commercial?.originalContract);
      const metrics: ComparisonMetric[] = [{
        key: 'currentContract', label: 'Contract Value', labelAr: 'قيمة العقد', kind: 'money',
        from: orig, to: n(current.commercial?.currentContract),
        delta: delta(orig, n(current.commercial?.currentContract)),
        pctDelta: pct(orig, n(current.commercial?.currentContract)),
        adverse: false,
      }, {
        key: 'eac', label: 'EAC vs Original Contract', labelAr: 'التكلفة مقابل العقد الأصلي', kind: 'money',
        from: orig, to: n(current.forecast?.eac ?? current.evm?.eac),
        delta: delta(orig, n(current.forecast?.eac ?? current.evm?.eac)),
        pctDelta: pct(orig, n(current.forecast?.eac ?? current.evm?.eac)),
        adverse: (n(current.forecast?.eac ?? current.evm?.eac) ?? 0) > (orig ?? 0),
      }];
      return {
        ok: true, basis,
        fromLabel: 'Original contract',
        toLabel: current.periodLabel || current.periodId,
        fromPeriodId: first?.periodId ?? '',
        toPeriodId: current.periodId,
        metrics,
        adverseCount: metrics.filter(m => m.adverse).length,
        baselineChanged: false,
        currencyChanged: false,
        note:
          'Only contract-value metrics are compared. An original contract has no SPI, no cash '
          + 'position and no delay record, so comparing those against it would invent a '
          + 'movement from a figure that never existed.',
      };
    }

    case 'current-forecast': {
      // Forecast against baseline plan, within the current period.
      const bac = n(current.evm?.bac);
      const eac = n(current.forecast?.eac ?? current.evm?.eac);
      const metrics: ComparisonMetric[] = [{
        key: 'eac', label: 'EAC vs BAC', labelAr: 'التكلفة المتوقعة مقابل الموازنة', kind: 'money',
        from: bac, to: eac, delta: delta(bac, eac), pctDelta: pct(bac, eac),
        adverse: (eac ?? 0) > (bac ?? 0),
      }, {
        key: 'contract', label: 'EAC vs Current Contract', labelAr: 'التكلفة المتوقعة مقابل العقد', kind: 'money',
        from: n(current.commercial?.currentContract), to: eac,
        delta: delta(n(current.commercial?.currentContract), eac),
        pctDelta: pct(n(current.commercial?.currentContract), eac),
        adverse: (eac ?? 0) > (n(current.commercial?.currentContract) ?? 0),
      }, {
        key: 'planned', label: 'Forecast vs Planned Budget', labelAr: 'المتوقع مقابل المخطط', kind: 'money',
        from: n(current.budget?.totalPlanned), to: n(current.budget?.totalForecast),
        delta: delta(n(current.budget?.totalPlanned), n(current.budget?.totalForecast)),
        pctDelta: pct(n(current.budget?.totalPlanned), n(current.budget?.totalForecast)),
        adverse: (n(current.budget?.totalForecast) ?? 0) > (n(current.budget?.totalPlanned) ?? 0),
      }];
      return {
        ok: true, basis,
        fromLabel: 'Plan',
        toLabel: `Forecast — ${current.periodLabel || current.periodId}`,
        fromPeriodId: current.periodId,
        toPeriodId: current.periodId,
        metrics,
        adverseCount: metrics.filter(m => m.adverse).length,
        baselineChanged: false, currencyChanged: false,
        note: 'Both sides come from the same approved period: this compares what was planned '
            + 'against what is now expected, not two points in time.',
      };
    }
  }

  if (!from) return fail('No comparable period found.');

  const metrics: ComparisonMetric[] = METRICS.map(def => {
    const a = def.read(from!);
    const b = def.read(current);
    const d = delta(a, b);
    const adverse = d !== null && d !== 0
      && ((def.adverseWhen === 'up' && d > 0) || (def.adverseWhen === 'down' && d < 0));
    return {
      key: def.key, label: def.label, labelAr: def.labelAr, kind: def.kind,
      from: a, to: b, delta: d, pctDelta: pct(a, b), adverse,
    };
  }).filter(m => m.from !== null || m.to !== null);

  const blA = from.baselines?.contract?.id ?? '';
  const blB = current.baselines?.contract?.id ?? '';
  const ccyA = from.exchange?.reportingCurrency ?? '';
  const ccyB = current.exchange?.reportingCurrency ?? '';

  const baselineChanged = Boolean(blA && blB && blA !== blB);
  const currencyChanged = Boolean(ccyA && ccyB && ccyA !== ccyB);

  return {
    ok: true, basis,
    fromLabel, toLabel: current.periodLabel || current.periodId,
    fromPeriodId: from.periodId, toPeriodId: current.periodId,
    metrics,
    adverseCount: metrics.filter(m => m.adverse).length,
    baselineChanged, currencyChanged,
    note: currencyChanged
      ? `The two periods report in different currencies (${ccyA} and ${ccyB}). Monetary `
        + 'movements below mix a rate change with a real change and should not be read as '
        + 'performance.'
      : baselineChanged
      ? 'The baseline changed between these two periods. A movement here may be a re-baseline '
        + 'rather than performance, and the two are not distinguishable from the figures alone.'
      : '',
  };
}

// ── 9 · PREDICTIVE ANALYTICS ───────────────────────────────────────────

export type Confidence = 'none' | 'low' | 'moderate' | 'reasonable';

export interface Projection {
  key: string;
  label: string;
  labelAr: string;
  /** The archived figure this starts from. */
  current: number | null;
  /** The projected figure. Null when it cannot be projected. */
  projected: number | null;
  delta: number | null;
  pctDelta: number | null;
  /** How it was arrived at, in one sentence. */
  method: string;
  /** How many archived periods informed it. */
  dataPoints: number;
  confidence: Confidence;
}

export interface PredictiveAnalytics {
  projections: Projection[];
  periodsAvailable: number;
  /** Overall confidence, driven by how much history exists. */
  confidence: Confidence;
  basis: string;
  caution: string;
}

const PREDICTIVE_CAUTION =
  'These are EXTRAPOLATIONS of archived trends, not forecasts in the engineering sense. Each '
  + 'projects a movement observed between approved periods forward at the same rate, which '
  + 'assumes conditions persist \u2014 an assumption no project satisfies for long. Where fewer '
  + 'than four periods exist the result is arithmetic on two points and is labelled low '
  + 'confidence. The EVM engine\u2019s own EAC remains the authoritative forecast; these sit '
  + 'beside it as a cross-check, not a replacement.';

function confidenceFor(points: number): Confidence {
  if (points < 2) return 'none';
  if (points < 4) return 'low';
  if (points < 7) return 'moderate';
  return 'reasonable';
}

/**
 * Trend-extrapolated projections.
 *
 * DELIBERATELY SEPARATE FROM THE EVM EAC. The EVM engine already produces
 * an authoritative EAC by a recognised method, and this file does not touch
 * it. What these add is a second opinion built purely from how the archive
 * has moved — useful precisely because it disagrees sometimes, and useless
 * if it were presented as the same kind of number.
 */
export function predictiveAnalytics(projectId: string): PredictiveAnalytics {
  const list = history(projectId);
  const pts = list.length;
  const conf = confidenceFor(pts);

  const projections: Projection[] = [];

  if (pts >= 2) {
    const first = list[0];
    const last = list[pts - 1];
    const steps = pts - 1;

    /** Linear extrapolation over the remaining share of the work. */
    const project = (
      key: string, label: string, labelAr: string,
      read: (s: TimelineSnapshot) => number | null,
      method: string,
      horizon = 1,
    ) => {
      const a = read(first), b = read(last);
      if (a === null || b === null || steps === 0) {
        projections.push({
          key, label, labelAr, current: b, projected: null, delta: null, pctDelta: null,
          method: 'Not projectable — the archive does not carry this figure in both periods.',
          dataPoints: pts, confidence: 'none',
        });
        return;
      }
      const perPeriod = (b - a) / steps;
      const projected = b + perPeriod * horizon;
      projections.push({
        key, label, labelAr, current: b, projected,
        delta: projected - b,
        pctDelta: b !== 0 ? (projected - b) / Math.abs(b) : null,
        method, dataPoints: pts, confidence: conf,
      });
    };

    // Forecast Final Cost — the trend view, beside the EVM EAC.
    const eacNow = n(last.forecast?.eac ?? last.evm?.eac);
    const acNow = n(last.evm?.ac ?? last.budget?.totalActual);
    const progress = n(last.projectStatus?.progressPct ?? last.kpi?.progressPct);

    if (acNow !== null && progress !== null && progress > 0.02) {
      // Cost-to-date scaled by progress. A blunt instrument, and stated as
      // one — but it is independent of CPI, so when it and the EVM EAC
      // diverge widely that divergence is itself informative.
      const scaled = acNow / progress;
      projections.push({
        key: 'finalCost', label: 'Forecast Final Cost (trend)', labelAr: 'التكلفة النهائية المتوقعة (اتجاه)',
        current: eacNow, projected: scaled,
        delta: eacNow !== null ? scaled - eacNow : null,
        pctDelta: eacNow !== null && eacNow !== 0 ? (scaled - eacNow) / eacNow : null,
        method: 'Actual cost to date divided by reported progress. Independent of CPI, so a '
              + 'wide divergence from the EVM EAC is itself a signal.',
        dataPoints: pts, confidence: conf,
      });
    }

    // Forecast Final Margin.
    const contractNow = n(last.commercial?.currentContract);
    if (contractNow !== null && eacNow !== null) {
      const marginNow = contractNow - eacNow;
      const mFirst = n(first.commercial?.currentContract);
      const eFirst = n(first.forecast?.eac ?? first.evm?.eac);
      if (mFirst !== null && eFirst !== null && steps > 0) {
        const marginFirst = mFirst - eFirst;
        const perPeriod = (marginNow - marginFirst) / steps;
        const projected = marginNow + perPeriod;
        projections.push({
          key: 'finalMargin', label: 'Forecast Final Margin', labelAr: 'الهامش النهائي المتوقع',
          current: marginNow, projected,
          delta: projected - marginNow,
          pctDelta: marginNow !== 0 ? (projected - marginNow) / Math.abs(marginNow) : null,
          method: 'Current contract less EAC, extrapolated one period at the rate the margin '
                + 'has moved across the archive. Derived, not archived.',
          dataPoints: pts, confidence: conf,
        });
      }
    }

    // Expected Cost Overrun.
    const bacNow = n(last.evm?.bac);
    if (bacNow !== null && eacNow !== null) {
      projections.push({
        key: 'overrun', label: 'Expected Cost Overrun', labelAr: 'التجاوز المتوقع للتكلفة',
        current: eacNow - bacNow, projected: eacNow - bacNow,
        delta: 0, pctDelta: bacNow !== 0 ? (eacNow - bacNow) / bacNow : null,
        method: 'EAC less BAC, both archived. Not extrapolated — this is the overrun the '
              + 'period itself reported.',
        dataPoints: pts, confidence: 'reasonable',
      });
    }

    // Expected Cash Flow Variance.
    project('cashVariance', 'Expected Cash Flow Variance', 'انحراف التدفق النقدي المتوقع',
      s => n(s.cash?.cumulativeNet),
      'Cumulative net cash extrapolated one period at the average rate of movement across '
      + 'the archive.');

    // Expected Commercial Exposure: pending variations + unsettled claims + LD.
    const exposureOf = (s: TimelineSnapshot): number | null => {
      const pend = n(s.commercial?.pendingChangeOrders);
      const claimed = n(s.claims?.totalClaimed);
      const settled = n(s.claims?.totalSettled);
      const ld = n(s.ld?.exposure);
      if (pend === null && claimed === null && ld === null) return null;
      const unsettled = claimed !== null && settled !== null ? claimed - settled : 0;
      return (pend ?? 0) + unsettled + (ld ?? 0);
    };
    project('commercialExposure', 'Expected Commercial Exposure', 'التعرض التجاري المتوقع',
      exposureOf,
      'Pending variations plus unsettled claims plus LD exposure, extrapolated one period. '
      + 'Each component is archived; the sum is constructed here.');
  }

  // Expected FX Exposure — from the archive, not a rate forecast.
  const last = list[pts - 1];
  if (last) {
    const applied = last.exchange?.appliedRates ?? [];
    const exposure = applied.reduce((a, x) => a + x.convertedTotal, 0);
    projections.push({
      key: 'fxExposure', label: 'Expected FX Exposure', labelAr: 'التعرض المتوقع للعملات',
      current: exposure, projected: exposure, delta: 0, pctDelta: null,
      method: 'The exposure the latest approved period reported. NOT rate-adjusted: nothing '
            + 'in this platform forecasts exchange rates, so a rate-adjusted figure would be '
            + 'a guess presented beside facts. See the sensitivity analysis for what a rate '
            + 'movement would do.',
      dataPoints: pts, confidence: applied.length ? 'reasonable' : 'none',
    });
  }

  return {
    projections,
    periodsAvailable: pts,
    confidence: conf,
    basis: 'Every input is an archived figure. Projections extrapolate movements between '
         + 'approved periods; none reads a live module and none recomputes a business formula.',
    caution: PREDICTIVE_CAUTION,
  };
}

// ── 10 · EXECUTIVE KPI SCORES ──────────────────────────────────────────

export interface ScoreSignal {
  key: string;
  label: string;
  score: number | null;
  detail: string;
  weight: number;
}

export interface HealthScore {
  score: number | null;
  band: 'strong' | 'stable' | 'watch' | 'weak' | 'unknown';
  signals: ScoreSignal[];
  /** Signals with no archived data. */
  blind: number;
  basis: string;
}

const bandOf = (s: number | null): HealthScore['band'] =>
  s === null ? 'unknown'
  : s >= 75 ? 'strong'
  : s >= 55 ? 'stable'
  : s >= 35 ? 'watch' : 'weak';

/** Weighted mean over the signals that had data. */
function composite(signals: ScoreSignal[]): { score: number | null; blind: number } {
  const scored = signals.filter(s => s.score !== null) as (ScoreSignal & { score: number })[];
  if (!scored.length) return { score: null, blind: signals.length };
  const totalWeight = scored.reduce((a, s) => a + s.weight, 0);
  const score = scored.reduce((a, s) => a + s.score * s.weight, 0) / totalWeight;
  return { score, blind: signals.length - scored.length };
}

/**
 * Financial Health Score — 0 to 100, higher is better.
 *
 * Five weighted signals, all archived. A signal with no data is excluded
 * from the weighting rather than scored zero: a project that has not
 * recorded a cash position should not be marked down for it, it should be
 * scored on what it did record and the gap reported separately.
 */
export function financialHealthScore(projectId: string, periodId?: string): HealthScore {
  const list = history(projectId);
  const i = indexOf(list, periodId);
  const s = i >= 0 ? list[i] : null;

  if (!s) {
    return { score: null, band: 'unknown', signals: [], blind: 0,
             basis: 'No approved period.' };
  }

  const cpi = s.evm?.cpi ?? null;
  const contract = n(s.commercial?.currentContract);
  const eac = n(s.forecast?.eac ?? s.evm?.eac);
  const certified = n(s.certificates?.certified);
  const outstanding = n(s.certificates?.outstanding);
  const cash = n(s.cash?.cumulativeNet);
  const bac = n(s.evm?.bac);

  const signals: ScoreSignal[] = [
    {
      key: 'cost', label: 'Cost performance', weight: 3,
      score: cpi === null ? null : scale(Math.min(cpi, 1.2), 1.2),
      detail: cpi === null ? 'No CPI recorded' : `CPI ${cpi.toFixed(3)}`,
    },
    {
      key: 'margin', label: 'Forecast margin', weight: 3,
      score: contract === null || eac === null || contract === 0 ? null
        : scale(Math.max(0, (contract - eac) / contract + 0.10), 0.25),
      detail: contract === null || eac === null ? 'No margin position'
        : `${(((contract - eac) / contract) * 100).toFixed(1)}% forecast margin`,
    },
    {
      key: 'collection', label: 'Revenue collection', weight: 2,
      score: certified === null || outstanding === null || certified === 0 ? null
        : scale(Math.max(0, 1 - outstanding / certified), 1),
      detail: certified === null ? 'No certificate position'
        : `${((1 - (outstanding ?? 0) / certified) * 100).toFixed(0)}% collected`,
    },
    {
      key: 'liquidity', label: 'Cash position', weight: 2,
      // A negative cumulative position is scored against the project's own
      // size, so a 2M overdraft on a 4B job is not treated like one on a 4M job.
      score: cash === null ? null
        : cash >= 0 ? 100
        : scale(Math.max(0, 1 + cash / Math.abs((bac ?? cash) || 1)), 1),
      detail: cash === null ? 'No cash position'
        : cash >= 0 ? 'Cumulative net positive' : 'Cumulative net negative',
    },
    {
      key: 'budget', label: 'Budget containment', weight: 2,
      score: bac === null || eac === null || bac === 0 ? null
        : scale(Math.max(0, 1 - Math.max(0, (eac - bac) / bac) / 0.20), 1),
      detail: bac === null || eac === null ? 'No budget position'
        : `${(((eac - bac) / bac) * 100).toFixed(1)}% against BAC`,
    },
  ];

  const { score, blind } = composite(signals);
  return {
    score, band: bandOf(score), signals, blind,
    basis: 'A weighted composite over five archived signals. A signal with no archived data is '
         + 'excluded from the weighting rather than scored zero, so a sparse project is neither '
         + 'flattered nor penalised by its own gaps.',
  };
}

/** Commercial Health Score — contract stability and claim position. */
export function commercialHealthScore(projectId: string, periodId?: string): HealthScore {
  const list = history(projectId);
  const i = indexOf(list, periodId);
  const s = i >= 0 ? list[i] : null;
  if (!s) return { score: null, band: 'unknown', signals: [], blind: 0, basis: 'No approved period.' };

  const original = n(s.commercial?.originalContract);
  const approvedCOs = n(s.commercial?.approvedChangeOrders);
  const pending = n(s.commercial?.pendingChangeOrders);
  const claimed = n(s.claims?.totalClaimed);
  const settled = n(s.claims?.totalSettled);
  const contract = n(s.commercial?.currentContract);
  const unmit = n(s.delay?.unmitigated);
  const ld = n(s.ld?.exposure);

  const signals: ScoreSignal[] = [
    {
      key: 'growth', label: 'Contract stability', weight: 3,
      score: original === null || approvedCOs === null || original === 0 ? null
        : scale(Math.max(0, 1 - Math.abs(approvedCOs / original) / 0.20), 1),
      detail: original === null ? 'No contract position'
        : `${(((approvedCOs ?? 0) / original) * 100).toFixed(1)}% growth from original`,
    },
    {
      key: 'pending', label: 'Uncommitted exposure', weight: 2,
      score: pending === null || contract === null || contract === 0 ? null
        : scale(Math.max(0, 1 - (pending / contract) / 0.10), 1),
      detail: pending === null ? 'No pending position'
        : `${(((pending ?? 0) / (contract || 1)) * 100).toFixed(2)}% pending`,
    },
    {
      key: 'claims', label: 'Claim settlement', weight: 2,
      score: claimed === null || claimed === 0 ? (claimed === 0 ? 100 : null)
        : scale((settled ?? 0) / claimed, 1),
      detail: claimed === null ? 'No claims recorded'
        : claimed === 0 ? 'No claims'
        : `${(((settled ?? 0) / claimed) * 100).toFixed(0)}% settled`,
    },
    {
      key: 'delay', label: 'Delay entitlement', weight: 2,
      score: unmit === null ? null : scale(Math.max(0, 1 - Math.max(0, unmit) / 90), 1),
      detail: unmit === null ? 'No delay position' : `${unmit}d unmitigated`,
    },
    {
      key: 'ld', label: 'LD exposure', weight: 1,
      score: ld === null || contract === null || contract === 0 ? null
        : scale(Math.max(0, 1 - (ld / contract) / 0.05), 1),
      detail: ld === null ? 'No LD position'
        : `${((ld / (contract || 1)) * 100).toFixed(2)}% of contract`,
    },
  ];

  const { score, blind } = composite(signals);
  return {
    score, band: bandOf(score), signals, blind,
    basis: 'Weighted over five archived commercial signals. Contract growth is scored as '
         + 'instability in either direction: a contract that has moved a long way from what was '
         + 'signed is harder to manage regardless of which way it moved.',
  };
}

/** Currency Risk Score — 0 to 100, higher is SAFER. */
export function currencyRiskScore(projectId: string, periodId?: string): HealthScore {
  const list = history(projectId);
  const i = indexOf(list, periodId);
  const s = i >= 0 ? list[i] : null;
  if (!s) return { score: null, band: 'unknown', signals: [], blind: 0, basis: 'No approved period.' };

  const applied = s.exchange?.appliedRates ?? [];
  const contract = n(s.commercial?.currentContract);
  const exposure = applied.reduce((a, x) => a + x.convertedTotal, 0);
  const reporting = s.exchange?.reportingCurrency ?? '';
  const contractCcy = s.exchange?.contractCurrency ?? '';

  // Rate volatility across the archive for the exposed currencies.
  const volatilities: number[] = [];
  applied.forEach(a => {
    const series: number[] = [];
    list.forEach(x => {
      const hit = (x.exchange?.rates ?? []).find(r => r.currency === a.currency);
      if (hit && hit.rate > 0) series.push(hit.rate);
    });
    if (series.length > 1) {
      const mean = series.reduce((p, q) => p + q, 0) / series.length;
      const varr = series.reduce((p, q) => p + Math.pow(q - mean, 2), 0) / series.length;
      if (mean !== 0) volatilities.push(Math.sqrt(varr) / mean);
    }
  });
  const meanVol = volatilities.length
    ? volatilities.reduce((a, b) => a + b, 0) / volatilities.length : null;

  const signals: ScoreSignal[] = [
    {
      key: 'exposureSize', label: 'Exposure size', weight: 3,
      score: contract === null || contract === 0 ? (exposure === 0 ? 100 : null)
        : scale(Math.max(0, 1 - (exposure / contract) / 0.30), 1),
      detail: exposure === 0 ? 'No foreign exposure'
        : `${((exposure / (contract || 1)) * 100).toFixed(1)}% of contract`,
    },
    {
      key: 'concentration', label: 'Currency spread', weight: 1,
      score: applied.length === 0 ? 100 : scale(Math.max(0, 1 - (applied.length - 1) / 4), 1),
      detail: `${applied.length} currenc${applied.length === 1 ? 'y' : 'ies'} in use`,
    },
    {
      key: 'volatility', label: 'Archived rate volatility', weight: 3,
      score: meanVol === null ? (applied.length === 0 ? 100 : null)
        : scale(Math.max(0, 1 - meanVol / 0.10), 1),
      detail: meanVol === null
        ? (applied.length === 0 ? 'No exposure' : 'Insufficient rate history')
        : `${(meanVol * 100).toFixed(2)}% archived volatility`,
    },
    {
      key: 'contractMatch', label: 'Contract / reporting alignment', weight: 2,
      score: !contractCcy || !reporting ? null
        : contractCcy === reporting ? 100 : 40,
      detail: !contractCcy ? 'Contract currency not recorded'
        : contractCcy === reporting
          ? `Contract and reporting both ${reporting}`
          : `Contract ${contractCcy}, reporting ${reporting} — rate-dependent`,
    },
  ];

  const { score, blind } = composite(signals);
  return {
    score, band: bandOf(score), signals, blind,
    basis: 'Higher is safer. Volatility is measured across the rates the archive froze, not '
         + 'the live rate book, so it describes the environment the project actually reported '
         + 'in. A project contracted in a currency other than its reporting currency scores '
         + 'down because its reported figures move when the rate does, with nothing changing '
         + 'on site.',
  };
}

/** Project Stability Index — how much the numbers move, not how good they are. */
export function projectStabilityIndex(projectId: string): HealthScore {
  const list = history(projectId);
  if (list.length < 2) {
    return { score: null, band: 'unknown', signals: [], blind: 0,
             basis: 'Fewer than two approved periods — stability needs a series.' };
  }

  const acc = forecastAccuracy(projectId);
  const cv = costVarianceTrend(projectId);
  const mt = marginTrend(projectId);
  const ce = contractEvolution(projectId);

  const cpis = list.map(s => s.evm?.cpi).filter((v): v is number => typeof v === 'number');
  const cpiMean = cpis.length ? cpis.reduce((a, b) => a + b, 0) / cpis.length : null;
  const cpiVol = cpiMean !== null && cpis.length > 1 && cpiMean !== 0
    ? Math.sqrt(cpis.reduce((a, c) => a + Math.pow(c - cpiMean, 2), 0) / cpis.length) / cpiMean
    : null;

  const signals: ScoreSignal[] = [
    {
      key: 'forecastStability', label: 'Forecast stability', weight: 3,
      score: acc.meanAbsDriftPct === null ? null
        : scale(Math.max(0, 1 - acc.meanAbsDriftPct / 0.15), 1),
      detail: acc.meanAbsDriftPct === null ? 'No forecast history'
        : `${(acc.meanAbsDriftPct * 100).toFixed(1)}% mean forecast drift`,
    },
    {
      key: 'cpiStability', label: 'CPI stability', weight: 2,
      score: cpiVol === null ? null : scale(Math.max(0, 1 - cpiVol / 0.10), 1),
      detail: cpiVol === null ? 'Insufficient CPI history'
        : `${(cpiVol * 100).toFixed(2)}% CPI volatility`,
    },
    {
      key: 'marginStability', label: 'Margin stability', weight: 2,
      score: mt.consecutiveErosion === 0 ? 100
        : scale(Math.max(0, 1 - mt.consecutiveErosion / 4), 1),
      detail: mt.consecutiveErosion === 0 ? 'No consecutive erosion'
        : `${mt.consecutiveErosion} consecutive eroding periods`,
    },
    {
      key: 'contractStability', label: 'Contract stability', weight: 2,
      score: ce.points.length === 0 ? null
        : scale(Math.max(0, 1 - ce.movementCount / Math.max(1, ce.points.length)), 1),
      detail: `${ce.movementCount} of ${ce.points.length} periods moved the contract`,
    },
    {
      key: 'varianceStability', label: 'Cost variance stability', weight: 1,
      score: cv.consecutiveDeterioration === 0 ? 100
        : scale(Math.max(0, 1 - cv.consecutiveDeterioration / 4), 1),
      detail: cv.consecutiveDeterioration === 0 ? 'No consecutive deterioration'
        : `${cv.consecutiveDeterioration} consecutive deteriorating periods`,
    },
  ];

  const { score, blind } = composite(signals);
  return {
    score, band: bandOf(score), signals, blind,
    basis: 'Stability measures how much the reported position MOVES, not how good it is. A '
         + 'project can be consistently behind and perfectly stable; another can be on budget '
         + 'and lurching. The two questions are different and this index answers only the '
         + 'second — a low score means the numbers are not yet trustworthy as a basis for '
         + 'decisions, whatever they say.',
  };
}

// ── 11 · PROJECT FINANCIAL HEALTH (the bundle) ─────────────────────────

export interface ProjectFinancialHealth {
  ok: boolean;
  reason?: string;
  projectId: string;
  code: string;
  period: string;
  periodId: string;
  dataDate: string;
  reportingCurrency: string;
  contractCurrency: string;
  periodsAvailable: number;

  financial: HealthScore;
  commercial: HealthScore;
  currencyRisk: HealthScore;
  stability: HealthScore;
  /** Simple mean of the four, over those that scored. */
  overall: number | null;
  overallBand: HealthScore['band'];

  contractEvolution: ContractEvolution;
  budgetEvolution: BudgetEvolution;
  forecastAccuracy: ForecastAccuracy;
  costVariance: CostVarianceTrend;
  cashVariance: CashFlowVarianceTrend;
  margin: MarginTrend;
  currencyImpact: ForecastCurrencyImpact;
  predictive: PredictiveAnalytics;
  /** FX translation against the previous period, reused from Phase 2. */
  fxMovement: FxTranslation | null;
}

export function projectFinancialHealth(
  project: FiProject, periodId?: string,
): ProjectFinancialHealth {
  const list = history(project.id);
  const i = indexOf(list, periodId);
  const s = i >= 0 ? list[i] : null;

  const empty = (reason: string): ProjectFinancialHealth => ({
    ok: false, reason,
    projectId: project.id, code: project.code ?? project.id,
    period: '', periodId: '', dataDate: '',
    reportingCurrency: '', contractCurrency: '', periodsAvailable: list.length,
    financial: { score: null, band: 'unknown', signals: [], blind: 0, basis: '' },
    commercial: { score: null, band: 'unknown', signals: [], blind: 0, basis: '' },
    currencyRisk: { score: null, band: 'unknown', signals: [], blind: 0, basis: '' },
    stability: { score: null, band: 'unknown', signals: [], blind: 0, basis: '' },
    overall: null, overallBand: 'unknown',
    contractEvolution: contractEvolution(project.id),
    budgetEvolution: budgetEvolution(project.id),
    forecastAccuracy: forecastAccuracy(project.id),
    costVariance: costVarianceTrend(project.id),
    cashVariance: cashFlowVarianceTrend(project.id),
    margin: marginTrend(project.id),
    currencyImpact: forecastCurrencyImpact(project.id, periodId),
    predictive: predictiveAnalytics(project.id),
    fxMovement: null,
  });

  if (!s) return empty(list.length === 0
    ? 'This project has no approved reporting period.'
    : 'The requested period has no approved snapshot.');

  const financial = financialHealthScore(project.id, s.periodId);
  const commercial = commercialHealthScore(project.id, s.periodId);
  const currencyRisk = currencyRiskScore(project.id, s.periodId);
  const stability = projectStabilityIndex(project.id);

  const scored = [financial, commercial, currencyRisk, stability]
    .map(x => x.score).filter((v): v is number => v !== null);
  const overall = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;

  // Reuse Phase 2's translation rather than reimplementing FX movement.
  const prev = i > 0 ? list[i - 1] : null;
  const fxMovement = prev ? fxTranslation(project.id, prev.periodId, s.periodId) : null;

  return {
    ok: true,
    projectId: project.id,
    code: project.code ?? project.id,
    period: s.periodLabel || s.periodId,
    periodId: s.periodId,
    dataDate: s.dataDate,
    reportingCurrency: s.exchange?.reportingCurrency ?? '',
    contractCurrency: s.exchange?.contractCurrency ?? '',
    periodsAvailable: list.length,

    financial, commercial, currencyRisk, stability,
    overall, overallBand: bandOf(overall),

    contractEvolution: contractEvolution(project.id),
    budgetEvolution: budgetEvolution(project.id),
    forecastAccuracy: forecastAccuracy(project.id),
    costVariance: costVarianceTrend(project.id),
    cashVariance: cashFlowVarianceTrend(project.id),
    margin: marginTrend(project.id),
    currencyImpact: forecastCurrencyImpact(project.id, s.periodId),
    predictive: predictiveAnalytics(project.id),
    fxMovement,
  };
}

// ── 12 · PORTFOLIO HEALTH ──────────────────────────────────────────────

export interface PortfolioHealthRow {
  projectId: string;
  code: string;
  name: string;
  companyName: string;
  period: string;
  reportingCurrency: string;
  financial: number | null;
  commercial: number | null;
  currencyRisk: number | null;
  stability: number | null;
  overall: number | null;
  band: HealthScore['band'];
  /** The weakest of the four, so a reader knows where to look. */
  weakest: string;
}

export interface PortfolioHealth {
  rows: PortfolioHealthRow[];
  noHistory: FiProject[];
  /** Contract-weighted means, where currency allows. */
  meanFinancial: number | null;
  meanCommercial: number | null;
  meanCurrencyRisk: number | null;
  meanStability: number | null;
  meanOverall: number | null;
  bands: Record<string, number>;
  /** Reused from Phase 7 rather than recomputed. */
  spi: number | null;
  cpi: number | null;
  riskScore: number | null;
  weakest: PortfolioHealthRow | null;
  mixedCurrency: boolean;
  basis: string;
}

/**
 * Portfolio health across projects.
 *
 * Portfolio SPI, CPI and the risk index are taken from Phase 7's analytics
 * rather than recomputed — the brief's "no duplicated calculations" applies
 * inside this codebase too, and two implementations of a weighted CPI would
 * eventually disagree.
 */
export function portfolioHealth(projects: FiProject[], periodId?: string): PortfolioHealth {
  const rows: PortfolioHealthRow[] = [];
  const noHistory: FiProject[] = [];
  const currencies = new Set<string>();

  projects.forEach(p => {
    const h = projectFinancialHealth(p, periodId);
    if (!h.ok) { noHistory.push(p); return; }
    if (h.reportingCurrency) currencies.add(h.reportingCurrency);

    const parts: [string, number | null][] = [
      ['Financial', h.financial.score],
      ['Commercial', h.commercial.score],
      ['Currency', h.currencyRisk.score],
      ['Stability', h.stability.score],
    ];
    const present = parts.filter(([, v]) => v !== null) as [string, number][];
    const weakest = present.length
      ? present.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : '—';

    rows.push({
      projectId: p.id,
      code: p.code ?? p.id,
      name: p.nameEn ?? p.code ?? p.id,
      companyName: p.companyName ?? '',
      period: h.period,
      reportingCurrency: h.reportingCurrency,
      financial: h.financial.score,
      commercial: h.commercial.score,
      currencyRisk: h.currencyRisk.score,
      stability: h.stability.score,
      overall: h.overall,
      band: h.overallBand,
      weakest,
    });
  });

  const mean = (k: keyof PortfolioHealthRow): number | null => {
    const vals = rows.map(r => r[k]).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const bands: Record<string, number> = {};
  rows.forEach(r => { bands[r.band] = (bands[r.band] ?? 0) + 1; });

  // Phase 7's own analytics, reused.
  const ap: AnalyticsProject[] = projects.map(p => ({
    id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr,
    companyId: p.companyId, companyName: p.companyName,
  }));
  const pop: Population = buildPopulation(ap,
    periodId ? { align: 'asOf', periodId } : { align: 'latest' });

  const scored = rows.filter(r => r.overall !== null) as (PortfolioHealthRow & { overall: number })[];

  return {
    rows: rows.sort((a, b) => (a.overall ?? 101) - (b.overall ?? 101)),
    noHistory,
    meanFinancial: mean('financial'),
    meanCommercial: mean('commercial'),
    meanCurrencyRisk: mean('currencyRisk'),
    meanStability: mean('stability'),
    meanOverall: mean('overall'),
    bands,
    spi: portfolioSpi(pop).weighted,
    cpi: portfolioCpi(pop).weighted,
    riskScore: portfolioRisk(pop).portfolioScore,
    weakest: scored.length ? scored.reduce((a, b) => (b.overall < a.overall ? b : a)) : null,
    mixedCurrency: currencies.size > 1,
    basis:
      'Health scores are composites over archived signals. Portfolio SPI, CPI and the risk '
      + 'index are taken from the portfolio analytics layer rather than recomputed here: two '
      + 'implementations of a weighted index would eventually disagree, and then neither could '
      + 'be trusted.',
  };
}

// ── 13 · THE DASHBOARD BUNDLE ──────────────────────────────────────────

export interface FinancialIntelligence {
  project: ProjectFinancialHealth | null;
  portfolio: PortfolioHealth | null;
  comparisons: Record<string, HistoricalComparison>;
  periodId: string;
  basis: string;
}

const FI_BASIS =
  'Every figure in this analysis was read from an approved Timeline snapshot. No live module '
  + 'store was opened, no engine was invoked and no business formula was recomputed. Trends are '
  + 'movements between archived figures; scores are weighted composites over them; projections '
  + 'are extrapolations labelled with their confidence. Historical data is never altered by '
  + 'viewing it.';

export function financialIntelligence(
  project: FiProject | null, projects: FiProject[], periodId?: string,
): FinancialIntelligence {
  const bases: ComparisonBasis[] =
    ['last-month', 'last-quarter', 'baseline', 'original-contract', 'current-forecast'];
  const comparisons: Record<string, HistoricalComparison> = {};
  if (project) {
    bases.forEach(b => { comparisons[b] = historicalComparison(project.id, b, periodId); });
  }

  return {
    project: project ? projectFinancialHealth(project, periodId) : null,
    portfolio: projects.length ? portfolioHealth(projects, periodId) : null,
    comparisons,
    periodId: periodId ?? '',
    basis: FI_BASIS,
  };
}
