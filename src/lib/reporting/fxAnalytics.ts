/**
 * FX Analytics.
 * Destination: src/lib/reporting/fxAnalytics.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 2 · READ-ONLY, TIMELINE-ONLY
 *
 *   Eight FX analyses, every one built from approved Timeline snapshots.
 *   This file imports the timeline query layer and the currency module's
 *   pure rate maths. It opens no live register, calls no engine, and calls
 *   `setItem` nowhere.
 *
 * THE ONE THING WORTH BEING CAREFUL ABOUT: FX GAIN / LOSS
 *
 *   The phrase means two different things and confusing them produces a
 *   number that looks authoritative and is meaningless.
 *
 *     REALISED     A payment settled at a rate different from the rate the
 *                  obligation was booked at. Real money moved. PACTUM does
 *                  not archive settlement rates per payment, so this cannot
 *                  be computed and is NOT reported here.
 *
 *     TRANSLATION  The same foreign balance restated at a later period's
 *                  rate. No money moved; the reported figure moved because
 *                  the rate did.
 *
 *   What this file computes is TRANSLATION movement, labelled as such,
 *   between two archived periods. Calling it "FX gain" without that
 *   qualifier would invite a reader to book it, which would be wrong.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  readTimeline, approvedSnapshots, latestSnapshot, snapshotFor,
  TimelineStore, TimelineSnapshot,
} from '../timeline';
import { crossRate, FxStore, FxRate, RateSource } from '../currency';

// ── Shared shapes ──────────────────────────────────────────────────────

export interface FxProject {
  id: string;
  code?: string;
  nameEn?: string;
  nameAr?: string;
  companyId?: string;
  companyName?: string;
}

/** One period's frozen FX position for one project. */
interface PeriodFx {
  projectId: string;
  code: string;
  periodId: string;
  period: string;
  dataDate: string;
  reportingCurrency: string;
  contractCurrency: string;
  rates: { currency: string; rate: number; effectiveDate: string }[];
  applied: {
    currency: string; rate: number; count: number;
    originalTotal: number; convertedTotal: number;
    firstTxn: string; lastTxn: string;
  }[];
  conversions: {
    originalCurrency: string; originalAmount: number;
    exchangeRateSnapshot: number; exchangeRateEffectiveDate: string;
    reportingCurrencyValue: number; displayedReportingCurrency: string;
    rateSource?: string; ratePivot?: string; recordCount?: number;
  }[];
  /** Archived money positions, for exposure-against-portfolio ratios. */
  currentContract: number | null;
  certified: number | null;
  subcontractValue: number | null;
}

function periodFx(p: FxProject, s: TimelineSnapshot): PeriodFx {
  return {
    projectId: p.id,
    code: p.code ?? p.id,
    periodId: s.periodId,
    period: s.periodLabel || s.periodId,
    dataDate: s.dataDate,
    reportingCurrency: s.exchange?.reportingCurrency ?? '',
    contractCurrency: s.exchange?.contractCurrency ?? '',
    rates: (s.exchange?.rates ?? []).map(r => ({
      currency: r.currency, rate: r.rate, effectiveDate: r.effectiveDate,
    })),
    applied: (s.exchange?.appliedRates ?? []).map(a => ({ ...a })),
    conversions: (s.exchange?.conversions ?? []).map(c => ({ ...c })),
    currentContract: num(s.commercial?.currentContract),
    certified: num(s.certificates?.certified),
    subcontractValue: num(s.subcontracts?.totalContractValue),
  };
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Collects one snapshot per project.
 *
 * `periodId` omitted means each project's latest approved period. Supplied,
 * a project that never approved that period is EXCLUDED, never zero-filled:
 * an FX exposure table containing a silent zero for a live project
 * understates exposure, which is the failure that matters here.
 */
function collect(projects: FxProject[], periodId?: string): {
  rows: PeriodFx[]; excluded: FxProject[];
} {
  const rows: PeriodFx[] = [];
  const excluded: FxProject[] = [];
  projects.forEach(p => {
    const store = readTimeline(p.id);
    if (approvedSnapshots(store).length === 0) { excluded.push(p); return; }
    const s = periodId ? snapshotFor(store, periodId) : latestSnapshot(store);
    if (!s) { excluded.push(p); return; }
    rows.push(periodFx(p, s));
  });
  return { rows, excluded };
}

// ── 1 · FX EXPOSURE ────────────────────────────────────────────────────

export interface ExposureRow {
  currency: string;
  /** Σ original (foreign) amounts actually converted. */
  originalTotal: number;
  /** Σ converted amounts, in the archived reporting currency. */
  convertedTotal: number;
  recordCount: number;
  projectCount: number;
  projects: string[];
  minRate: number;
  maxRate: number;
  /** convertedTotal / originalTotal — the effective rate actually achieved. */
  blendedRate: number | null;
  /** Rate spread as a share of the mean. A wide spread is volatility. */
  rateSpread: number | null;
  /** Share of total converted foreign value. Null when currencies mix. */
  share: number | null;
}

export interface FxExposure {
  rows: ExposureRow[];
  totalConverted: number | null;
  currencyCount: number;
  exposedProjects: number;
  totalProjects: number;
  reportingCurrencies: string[];
  mixedReporting: boolean;
  largest: ExposureRow | null;
  /** Largest currency's share — concentration risk in one number. */
  concentration: number | null;
  /** Converted foreign value against archived contract value. */
  exposureRatio: number | null;
  excluded: FxProject[];
  periodId: string;
}

export function fxExposure(projects: FxProject[], periodId?: string): FxExposure {
  const { rows, excluded } = collect(projects, periodId);
  const acc = new Map<string, ExposureRow & { _p: Set<string>; _rates: number[] }>();

  rows.forEach(r => {
    r.applied.forEach(a => {
      const e = acc.get(a.currency);
      if (!e) {
        acc.set(a.currency, {
          currency: a.currency,
          originalTotal: a.originalTotal,
          convertedTotal: a.convertedTotal,
          recordCount: a.count,
          projectCount: 0, projects: [],
          minRate: a.rate, maxRate: a.rate,
          blendedRate: null, rateSpread: null, share: null,
          _p: new Set([r.code]), _rates: [a.rate],
        });
      } else {
        e.originalTotal += a.originalTotal;
        e.convertedTotal += a.convertedTotal;
        e.recordCount += a.count;
        e.minRate = Math.min(e.minRate, a.rate);
        e.maxRate = Math.max(e.maxRate, a.rate);
        e._p.add(r.code);
        e._rates.push(a.rate);
      }
    });
  });

  const currencies = Array.from(
    new Set(rows.map(r => r.reportingCurrency).filter(Boolean))).sort();
  const mixed = currencies.length > 1;

  const out: ExposureRow[] = Array.from(acc.values()).map(e => {
    const mean = e._rates.reduce((a, b) => a + b, 0) / e._rates.length;
    return {
      currency: e.currency,
      originalTotal: e.originalTotal,
      convertedTotal: e.convertedTotal,
      recordCount: e.recordCount,
      projectCount: e._p.size,
      projects: Array.from(e._p).sort(),
      minRate: e.minRate,
      maxRate: e.maxRate,
      blendedRate: e.originalTotal !== 0 ? e.convertedTotal / e.originalTotal : null,
      rateSpread: mean !== 0 ? (e.maxRate - e.minRate) / mean : null,
      share: null,
    };
  });

  // Converted totals only add up inside one reporting currency.
  const totalConverted = mixed ? null : out.reduce((a, r) => a + r.convertedTotal, 0);
  if (totalConverted !== null && totalConverted !== 0) {
    out.forEach(r => { r.share = r.convertedTotal / totalConverted; });
  }
  out.sort((a, b) => b.convertedTotal - a.convertedTotal);

  const contractTotal = mixed
    ? null
    : rows.reduce((a, r) => a + (r.currentContract ?? 0), 0);

  return {
    rows: out,
    totalConverted,
    currencyCount: out.length,
    exposedProjects: rows.filter(r => r.applied.length > 0).length,
    totalProjects: rows.length,
    reportingCurrencies: currencies,
    mixedReporting: mixed,
    largest: out.length ? out[0] : null,
    concentration: out.length && out[0].share !== null ? out[0].share : null,
    exposureRatio: totalConverted !== null && contractTotal !== null && contractTotal !== 0
      ? totalConverted / contractTotal : null,
    excluded,
    periodId: periodId ?? '',
  };
}

// ── 2 · FX GAIN / LOSS (translation) ───────────────────────────────────

export interface TranslationRow {
  currency: string;
  /** Foreign amount held, from the earlier period. */
  originalAmount: number;
  fromPeriod: string;
  fromRate: number;
  fromValue: number;
  toPeriod: string;
  toRate: number;
  /** originalAmount × toRate — the same holding at the later rate. */
  toValue: number;
  /** toValue − fromValue. Positive = the reporting currency weakened. */
  translationDelta: number;
  pctDelta: number | null;
}

export interface FxTranslation {
  rows: TranslationRow[];
  fromPeriod: string;
  toPeriod: string;
  /** Σ of the deltas. Null when the two periods report in different currencies. */
  netTranslation: number | null;
  reportingCurrency: string;
  comparable: boolean;
  /** Why the comparison could not be made, when it could not. */
  reason: string;
  /** Stated on every output so it cannot be mistaken for realised P&L. */
  basis: string;
}

const TRANSLATION_BASIS =
  'This is TRANSLATION movement, not realised gain or loss. It restates the same foreign '
  + 'holding at a later period\u2019s archived rate: no money moved, the reported figure moved '
  + 'because the rate did. Realised gain or loss requires the rate at which each payment '
  + 'actually settled, which PACTUM does not archive per payment, so it is deliberately not '
  + 'reported here rather than approximated.';

/**
 * Translation movement between two approved periods of one project.
 *
 * Both rates come from the archive. The live register is never opened, so
 * re-running this in six months reproduces the same figures.
 */
export function fxTranslation(
  projectId: string, fromPeriodId: string, toPeriodId: string,
): FxTranslation {
  const store = readTimeline(projectId);
  const a = snapshotFor(store, fromPeriodId);
  const b = snapshotFor(store, toPeriodId);

  const empty = (reason: string): FxTranslation => ({
    rows: [], fromPeriod: a?.periodLabel ?? fromPeriodId, toPeriod: b?.periodLabel ?? toPeriodId,
    netTranslation: null, reportingCurrency: '', comparable: false, reason,
    basis: TRANSLATION_BASIS,
  });

  if (!a || !b) return empty('One of the two periods has no approved snapshot.');

  const ccyA = a.exchange?.reportingCurrency ?? '';
  const ccyB = b.exchange?.reportingCurrency ?? '';
  if (ccyA && ccyB && ccyA !== ccyB) {
    return empty(
      `The two periods report in different currencies (${ccyA} and ${ccyB}). A translation `
      + 'movement between them would confuse a rate change with a change of reporting basis.');
  }

  const ratesB = new Map((b.exchange?.rates ?? []).map(r => [r.currency, r.rate]));
  const rows: TranslationRow[] = [];

  (a.exchange?.appliedRates ?? []).forEach(app => {
    const later = ratesB.get(app.currency);
    if (later === undefined || !(later > 0)) return;   // no later rate: no statement
    const fromValue = app.convertedTotal;
    const toValue = app.originalTotal * later;
    rows.push({
      currency: app.currency,
      originalAmount: app.originalTotal,
      fromPeriod: a.periodLabel || a.periodId,
      fromRate: app.rate,
      fromValue,
      toPeriod: b.periodLabel || b.periodId,
      toRate: later,
      toValue,
      translationDelta: toValue - fromValue,
      pctDelta: fromValue !== 0 ? (toValue - fromValue) / Math.abs(fromValue) : null,
    });
  });

  rows.sort((x, y) => Math.abs(y.translationDelta) - Math.abs(x.translationDelta));

  return {
    rows,
    fromPeriod: a.periodLabel || a.periodId,
    toPeriod: b.periodLabel || b.periodId,
    netTranslation: rows.length ? rows.reduce((s, r) => s + r.translationDelta, 0) : null,
    reportingCurrency: ccyB || ccyA,
    comparable: true,
    reason: '',
    basis: TRANSLATION_BASIS,
  };
}

/** Translation across a whole portfolio, project by project. */
export interface PortfolioTranslation {
  projects: { code: string; projectId: string; net: number | null; rows: TranslationRow[] }[];
  net: number | null;
  reportingCurrency: string;
  mixedReporting: boolean;
  basis: string;
}

export function portfolioTranslation(
  projects: FxProject[], fromPeriodId: string, toPeriodId: string,
): PortfolioTranslation {
  const out: PortfolioTranslation['projects'] = [];
  const currencies = new Set<string>();

  projects.forEach(p => {
    const t = fxTranslation(p.id, fromPeriodId, toPeriodId);
    if (!t.comparable || t.rows.length === 0) return;
    if (t.reportingCurrency) currencies.add(t.reportingCurrency);
    out.push({ code: p.code ?? p.id, projectId: p.id, net: t.netTranslation, rows: t.rows });
  });

  const mixed = currencies.size > 1;
  return {
    projects: out,
    // Suppressed across currencies: adding a SAR movement to a USD one
    // produces a figure with no unit.
    net: mixed || out.length === 0
      ? null
      : out.reduce((s, p) => s + (p.net ?? 0), 0),
    reportingCurrency: Array.from(currencies)[0] ?? '',
    mixedReporting: mixed,
    basis: TRANSLATION_BASIS,
  };
}

// ── 3 · CURRENCY DISTRIBUTION ──────────────────────────────────────────

export interface DistributionSlice {
  currency: string;
  /** Converted value attributable to this currency. */
  value: number;
  share: number | null;
  projectCount: number;
  recordCount: number;
  /** True for the reporting currency itself — the domestic remainder. */
  domestic: boolean;
}

export interface CurrencyDistribution {
  slices: DistributionSlice[];
  total: number | null;
  reportingCurrency: string;
  mixedReporting: boolean;
  /** Foreign share of the whole. The headline exposure number. */
  foreignShare: number | null;
  /** Herfindahl index over slices: 1 = one currency, →0 = spread thin. */
  concentrationIndex: number | null;
}

/**
 * How the portfolio's value splits by currency of origin.
 *
 * The domestic slice is the remainder: archived contract value less the
 * converted foreign total. Stating it explicitly matters — a distribution
 * showing only foreign currencies implies the portfolio is entirely
 * foreign, which is the opposite of the truth for most projects here.
 */
export function currencyDistribution(
  projects: FxProject[], periodId?: string,
): CurrencyDistribution {
  const { rows } = collect(projects, periodId);
  const currencies = Array.from(
    new Set(rows.map(r => r.reportingCurrency).filter(Boolean))).sort();
  const mixed = currencies.length > 1;
  const reporting = currencies[0] ?? '';

  if (mixed) {
    return {
      slices: [], total: null, reportingCurrency: '', mixedReporting: true,
      foreignShare: null, concentrationIndex: null,
    };
  }

  const acc = new Map<string, DistributionSlice & { _p: Set<string> }>();
  rows.forEach(r => {
    r.applied.forEach(a => {
      const e = acc.get(a.currency);
      if (!e) {
        acc.set(a.currency, {
          currency: a.currency, value: a.convertedTotal, share: null,
          projectCount: 0, recordCount: a.count, domestic: false,
          _p: new Set([r.code]),
        });
      } else {
        e.value += a.convertedTotal;
        e.recordCount += a.count;
        e._p.add(r.code);
      }
    });
  });

  const contractTotal = rows.reduce((a, r) => a + (r.currentContract ?? 0), 0);
  const foreignTotal = Array.from(acc.values()).reduce((a, s) => a + s.value, 0);
  const domesticValue = Math.max(0, contractTotal - foreignTotal);

  const slices: DistributionSlice[] = Array.from(acc.values()).map(e => ({
    currency: e.currency, value: e.value, share: null,
    projectCount: e._p.size, recordCount: e.recordCount, domestic: false,
  }));

  if (reporting && domesticValue > 0) {
    slices.push({
      currency: reporting, value: domesticValue, share: null,
      projectCount: rows.length, recordCount: 0, domestic: true,
    });
  }

  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total > 0) slices.forEach(s => { s.share = s.value / total; });
  slices.sort((a, b) => b.value - a.value);

  const hhi = total > 0
    ? slices.reduce((a, s) => a + Math.pow(s.value / total, 2), 0)
    : null;

  return {
    slices,
    total: total || null,
    reportingCurrency: reporting,
    mixedReporting: false,
    foreignShare: total > 0 ? foreignTotal / total : null,
    concentrationIndex: hhi,
  };
}

// ── 4 · PROJECTS BY CURRENCY ───────────────────────────────────────────

export interface ProjectCurrencyRow {
  projectId: string;
  code: string;
  name: string;
  companyName: string;
  contractCurrency: string;
  reportingCurrency: string;
  period: string;
  dataDate: string;
  currentContract: number | null;
  /** Currencies this project actually transacted in. */
  transactedIn: string[];
  foreignValue: number;
  /** foreignValue / currentContract. */
  foreignShare: number | null;
  /** True when contract currency differs from reporting currency. */
  crossCurrencyContract: boolean;
}

export interface ProjectsByCurrency {
  groups: {
    currency: string;
    projects: ProjectCurrencyRow[];
    totalContract: number | null;
    mixedReporting: boolean;
  }[];
  rows: ProjectCurrencyRow[];
  excluded: FxProject[];
  /** Projects contracted in a currency other than their reporting currency. */
  crossCurrencyCount: number;
}

export function projectsByCurrency(
  projects: FxProject[], periodId?: string,
): ProjectsByCurrency {
  const { rows, excluded } = collect(projects, periodId);

  const out: ProjectCurrencyRow[] = rows.map(r => {
    const foreign = r.applied.reduce((a, x) => a + x.convertedTotal, 0);
    const contractCcy = r.contractCurrency || r.reportingCurrency;
    return {
      projectId: r.projectId,
      code: r.code,
      name: r.code,
      companyName: '',
      contractCurrency: contractCcy,
      reportingCurrency: r.reportingCurrency,
      period: r.period,
      dataDate: r.dataDate,
      currentContract: r.currentContract,
      transactedIn: Array.from(new Set(r.applied.map(a => a.currency))).sort(),
      foreignValue: foreign,
      foreignShare: r.currentContract && r.currentContract !== 0
        ? foreign / r.currentContract : null,
      crossCurrencyContract: Boolean(contractCcy && r.reportingCurrency
        && contractCcy !== r.reportingCurrency),
    };
  });

  // Attach identity the caller supplied.
  const byId = new Map(projects.map(p => [p.id, p]));
  out.forEach(r => {
    const p = byId.get(r.projectId);
    if (p) { r.name = p.nameEn ?? r.code; r.companyName = p.companyName ?? ''; }
  });

  const map = new Map<string, ProjectCurrencyRow[]>();
  out.forEach(r => {
    const k = r.contractCurrency || '—';
    map.set(k, [...(map.get(k) ?? []), r]);
  });

  const groups = Array.from(map.entries()).map(([currency, list]) => {
    const reps = new Set(list.map(x => x.reportingCurrency).filter(Boolean));
    return {
      currency,
      projects: list.sort((a, b) => (b.currentContract ?? 0) - (a.currentContract ?? 0)),
      totalContract: reps.size > 1
        ? null
        : list.reduce((a, x) => a + (x.currentContract ?? 0), 0),
      mixedReporting: reps.size > 1,
    };
  }).sort((a, b) => (b.totalContract ?? 0) - (a.totalContract ?? 0));

  return {
    groups, rows: out, excluded,
    crossCurrencyCount: out.filter(r => r.crossCurrencyContract).length,
  };
}

// ── 5 · SUBCONTRACTS BY CURRENCY ───────────────────────────────────────
// ── 6 · CERTIFICATES BY CURRENCY ───────────────────────────────────────
//
// Timeline archives subcontract and certificate positions as TOTALS, not as
// per-record rows with their own currencies. So neither can be split by
// currency from the archive alone.
//
// The honest response is to report what IS archived — the position, the
// project's contract currency, and the currencies that project transacted
// in — and to state plainly that a per-record split is not available.
// Reaching into the live subcontract or certificate registers to produce a
// finer breakdown would violate the read-only, Timeline-only rule and would
// mix live data into a historical report.

export interface CategoryCurrencyRow {
  projectId: string;
  code: string;
  contractCurrency: string;
  reportingCurrency: string;
  period: string;
  /** The archived total for this category. */
  value: number | null;
  secondary: number | null;
  /** Currencies the project transacted in during the period. */
  transactedIn: string[];
}

export interface CategoryByCurrency {
  rows: CategoryCurrencyRow[];
  groups: { currency: string; value: number | null; projectCount: number;
            mixedReporting: boolean }[];
  total: number | null;
  mixedReporting: boolean;
  /** States the granularity limit in the report itself. */
  granularity: string;
}

function categoryByCurrency(
  projects: FxProject[], periodId: string | undefined,
  pick: (r: PeriodFx) => { value: number | null; secondary: number | null },
  label: string,
): CategoryByCurrency {
  const { rows } = collect(projects, periodId);
  const reps = new Set(rows.map(r => r.reportingCurrency).filter(Boolean));
  const mixed = reps.size > 1;

  const out: CategoryCurrencyRow[] = rows.map(r => {
    const v = pick(r);
    return {
      projectId: r.projectId, code: r.code,
      contractCurrency: r.contractCurrency || r.reportingCurrency,
      reportingCurrency: r.reportingCurrency,
      period: r.period,
      value: v.value, secondary: v.secondary,
      transactedIn: Array.from(new Set(r.applied.map(a => a.currency))).sort(),
    };
  });

  const map = new Map<string, CategoryCurrencyRow[]>();
  out.forEach(r => {
    const k = r.contractCurrency || '—';
    map.set(k, [...(map.get(k) ?? []), r]);
  });

  const groups = Array.from(map.entries()).map(([currency, list]) => {
    const lr = new Set(list.map(x => x.reportingCurrency).filter(Boolean));
    return {
      currency,
      value: lr.size > 1 ? null : list.reduce((a, x) => a + (x.value ?? 0), 0),
      projectCount: list.length,
      mixedReporting: lr.size > 1,
    };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return {
    rows: out, groups,
    total: mixed ? null : out.reduce((a, r) => a + (r.value ?? 0), 0),
    mixedReporting: mixed,
    granularity:
      `${label} are archived as period totals in the reporting currency, not as individual `
      + 'records carrying their own currency. The breakdown below is therefore by the '
      + 'project\u2019s contract currency, not by the currency of each individual record. A '
      + 'per-record split would require reading the live register, which a historical report '
      + 'must not do.',
  };
}

export function subcontractsByCurrency(
  projects: FxProject[], periodId?: string,
): CategoryByCurrency {
  return categoryByCurrency(projects, periodId,
    r => ({ value: r.subcontractValue, secondary: null }), 'Subcontracts');
}

export function certificatesByCurrency(
  projects: FxProject[], periodId?: string,
): CategoryByCurrency {
  return categoryByCurrency(projects, periodId,
    r => ({ value: r.certified, secondary: null }), 'Owner certificates');
}

// ── 7 · MONTHLY FX TREND ───────────────────────────────────────────────

export interface FxTrendPoint {
  periodId: string;
  period: string;
  dataDate: string;
  /** Projects that approved this period. Coverage varies. */
  projectCount: number;
  reportingCurrencies: string[];
  mixedReporting: boolean;
  /** Converted foreign value in this period. */
  foreignValue: number | null;
  foreignShare: number | null;
  currencyCount: number;
  /** Per-currency converted value for this period. */
  byCurrency: { currency: string; converted: number; rate: number | null }[];
  /** Movement in foreign value against the previous point. */
  delta: number | null;
}

export interface MonthlyFxTrend {
  points: FxTrendPoint[];
  coverageVaries: boolean;
  minProjects: number;
  maxProjects: number;
  currencies: string[];
}

/**
 * Foreign-currency activity period by period, across the portfolio.
 *
 * Each point aggregates only the projects that approved that period, and
 * `coverageVaries` flags when that count moves — otherwise a project joining
 * reads as a rise in exposure.
 */
export function monthlyFxTrend(projects: FxProject[]): MonthlyFxTrend {
  const periodIds = Array.from(new Set(
    projects.flatMap(p => approvedSnapshots(readTimeline(p.id)).map(s => s.periodId))
  )).sort();

  const allCurrencies = new Set<string>();
  let prev: number | null = null;

  const points: FxTrendPoint[] = periodIds.map(pid => {
    const { rows } = collect(projects, pid);
    const reps = Array.from(new Set(rows.map(r => r.reportingCurrency).filter(Boolean))).sort();
    const mixed = reps.length > 1;

    const acc = new Map<string, { converted: number; rates: number[] }>();
    rows.forEach(r => r.applied.forEach(a => {
      allCurrencies.add(a.currency);
      const e = acc.get(a.currency);
      if (e) { e.converted += a.convertedTotal; e.rates.push(a.rate); }
      else acc.set(a.currency, { converted: a.convertedTotal, rates: [a.rate] });
    }));

    const byCurrency = Array.from(acc.entries()).map(([currency, v]) => ({
      currency,
      converted: v.converted,
      rate: v.rates.length ? v.rates.reduce((a, b) => a + b, 0) / v.rates.length : null,
    })).sort((a, b) => b.converted - a.converted);

    const foreignValue = mixed ? null : byCurrency.reduce((a, c) => a + c.converted, 0);
    const contractTotal = mixed ? null : rows.reduce((a, r) => a + (r.currentContract ?? 0), 0);

    const pt: FxTrendPoint = {
      periodId: pid,
      period: rows[0]?.period || pid,
      dataDate: rows[0]?.dataDate || '',
      projectCount: rows.length,
      reportingCurrencies: reps,
      mixedReporting: mixed,
      foreignValue,
      foreignShare: foreignValue !== null && contractTotal !== null && contractTotal !== 0
        ? foreignValue / contractTotal : null,
      currencyCount: byCurrency.length,
      byCurrency,
      delta: prev !== null && foreignValue !== null ? foreignValue - prev : null,
    };
    if (foreignValue !== null) prev = foreignValue;
    return pt;
  });

  const counts = points.map(p => p.projectCount);
  return {
    points,
    coverageVaries: counts.length > 1 && new Set(counts).size > 1,
    minProjects: counts.length ? Math.min(...counts) : 0,
    maxProjects: counts.length ? Math.max(...counts) : 0,
    currencies: Array.from(allCurrencies).sort(),
  };
}

// ── 8 · HISTORICAL EXCHANGE RATE TREND ─────────────────────────────────

export interface RateTrendPoint {
  periodId: string;
  period: string;
  dataDate: string;
  rate: number;
  effectiveDate: string;
  /** Correction version frozen with the period, when recorded. */
  version: number | null;
  delta: number | null;
  pctDelta: number | null;
  /** Cumulative movement from the first archived point. */
  cumulativePct: number | null;
}

export interface RateTrend {
  currency: string;
  reportingCurrency: string;
  points: RateTrendPoint[];
  first: number | null;
  last: number | null;
  min: number | null;
  max: number | null;
  /** Total movement across the archived window. */
  totalPct: number | null;
  /** Standard deviation as a share of the mean — archived volatility. */
  volatility: number | null;
}

/**
 * One currency's rate as each period FROZE it.
 *
 * Not the live rate history — the rate each period actually reported at.
 * Those differ whenever a rate was corrected after a period closed, and the
 * archived series is the one that explains the reported numbers.
 */
export function historicalRateTrend(projectId: string, currency: string): RateTrend {
  const store = readTimeline(projectId);
  const cur = (currency || '').toUpperCase();
  const list = approvedSnapshots(store);

  let prev: number | null = null;
  let first: number | null = null;
  const points: RateTrendPoint[] = [];

  list.forEach(s => {
    const hit = (s.exchange?.rates ?? []).find(r => r.currency === cur);
    if (!hit || !(hit.rate > 0)) return;
    if (first === null) first = hit.rate;
    points.push({
      periodId: s.periodId,
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      rate: hit.rate,
      effectiveDate: hit.effectiveDate,
      version: hit.version ?? null,
      delta: prev !== null ? hit.rate - prev : null,
      pctDelta: prev !== null && prev !== 0 ? (hit.rate - prev) / prev : null,
      cumulativePct: first !== null && first !== 0 ? (hit.rate - first) / first : null,
    });
    prev = hit.rate;
  });

  const rates = points.map(p => p.rate);
  const mean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const variance = rates.length
    ? rates.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / rates.length : 0;

  return {
    currency: cur,
    reportingCurrency: list[list.length - 1]?.exchange?.reportingCurrency ?? '',
    points,
    first,
    last: rates.length ? rates[rates.length - 1] : null,
    min: rates.length ? Math.min(...rates) : null,
    max: rates.length ? Math.max(...rates) : null,
    totalPct: first !== null && first !== 0 && rates.length
      ? (rates[rates.length - 1] - first) / first : null,
    volatility: mean !== 0 && rates.length > 1 ? Math.sqrt(variance) / mean : null,
  };
}

/** Every archived currency's trend, for one project. */
export function allRateTrends(projectId: string): RateTrend[] {
  const store = readTimeline(projectId);
  const set = new Set<string>();
  approvedSnapshots(store).forEach(s =>
    (s.exchange?.rates ?? []).forEach(r => set.add(r.currency)));
  return Array.from(set).sort().map(c => historicalRateTrend(projectId, c));
}

// ── Full analytics bundle ──────────────────────────────────────────────

export interface FxAnalyticsBundle {
  exposure: FxExposure;
  distribution: CurrencyDistribution;
  byProject: ProjectsByCurrency;
  bySubcontract: CategoryByCurrency;
  byCertificate: CategoryByCurrency;
  trend: MonthlyFxTrend;
  rateTrends: RateTrend[];
  translation: PortfolioTranslation | null;
  periodId: string;
  basis: string;
}

const FX_BASIS =
  'Every rate and every converted figure in this analysis was read from an approved Timeline '
  + 'snapshot and was frozen when that period was signed off. The live exchange rate register '
  + 'was not opened. A rate corrected after a period closed does not alter what that period '
  + 'reported, which is why re-running this analysis reproduces the same figures.';

export function fxAnalytics(
  projects: FxProject[], periodId?: string,
  compare?: { fromPeriodId: string; toPeriodId: string },
): FxAnalyticsBundle {
  // Rate trends need one project's full history; use the first that has one.
  const withHistory = projects.find(p => approvedSnapshots(readTimeline(p.id)).length > 0);

  return {
    exposure: fxExposure(projects, periodId),
    distribution: currencyDistribution(projects, periodId),
    byProject: projectsByCurrency(projects, periodId),
    bySubcontract: subcontractsByCurrency(projects, periodId),
    byCertificate: certificatesByCurrency(projects, periodId),
    trend: monthlyFxTrend(projects),
    rateTrends: withHistory ? allRateTrends(withHistory.id) : [],
    translation: compare
      ? portfolioTranslation(projects, compare.fromPeriodId, compare.toPeriodId)
      : null,
    periodId: periodId ?? '',
    basis: FX_BASIS,
  };
}
