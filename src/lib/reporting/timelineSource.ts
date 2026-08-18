/**
 * Report data source — Timeline, and nothing else.
 * Destination: src/lib/reporting/timelineSource.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 6. THE INVERSION.
 *
 *   Before this file, a report was built from whatever a module happened to
 *   be holding in state. That made every report a live view wearing a
 *   historical date: reprint March in June and March came out different,
 *   because the modules had moved on. The number on the page was honest
 *   about the moment it was printed and silent about the moment it claimed
 *   to describe.
 *
 *   From here, reports read APPROVED TIMELINE SNAPSHOTS. Modules calculate.
 *   Timeline records. Reports read the record. A module cannot supply a
 *   figure to a report even if it wants to, because no report builder in
 *   this phase takes module state as an argument.
 *
 * WHAT THIS FILE IS ALLOWED TO DO
 *
 *   Read `pactum-timeline-{p}` through the timeline query layer. Reshape.
 *   Label. Nothing else. There is no arithmetic here that produces a
 *   reportable figure — the sums that exist are counts of periods and
 *   roll-ups of already-archived project totals, both of which are
 *   aggregation, not calculation.
 *
 * WHAT IT MUST NEVER DO
 *
 *   Open a module store. Call an engine. Reach for a live rate. If a
 *   snapshot lacks a section, the report says "not recorded" — it does not
 *   go and find the number somewhere else. That refusal is the feature.
 *
 * HISTORICAL RECREATION
 *
 *   Every builder takes a `periodId`. Pass `2026-03` and you get March as
 *   March was signed off, no matter what has happened since — including
 *   re-baselining, an EAC method change, an FX correction, or a total wipe
 *   of the live registers.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  readTimeline, approvedSnapshots, latestSnapshot, snapshotFor, coverageOf,
  trendRows, forecastComparison, executiveSummary, fxTrend, archivedCurrencies,
  appliedRateRows, reportingCurrencyTrail, hasMixedReportingCurrency, fxMovement,
  baselineTrail, portfolioRow, frozenRatesFor,
  TimelineStore, TimelineSnapshot,
} from '../timeline';

// ── Period selection ───────────────────────────────────────────────────

export interface PeriodOption {
  periodId: string;
  label: string;
  dataDate: string;
  approvedBy: string;
  approvedAt: string;
  /** Sections the period carries. A gap here is a gap in the report. */
  coverage: { present: string[]; missing: string[]; complete: boolean };
}

/** Every period that can be reported on, newest first. */
export function reportablePeriods(projectId: string): PeriodOption[] {
  const store = readTimeline(projectId);
  return approvedSnapshots(store)
    .slice()
    .reverse()
    .map(s => ({
      periodId: s.periodId,
      label: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      approvedBy: s.approvedBy,
      approvedAt: s.approvedAt,
      coverage: coverageOf(s),
    }));
}

/**
 * Resolves the snapshot a report will read.
 *
 * An unknown period returns null rather than falling back to the latest.
 * Silently substituting a different month would produce a document headed
 * "March" containing August, which is the exact failure this phase exists
 * to make impossible.
 */
export function resolveSnapshot(
  store: TimelineStore, periodId?: string,
): TimelineSnapshot | null {
  if (!periodId) return latestSnapshot(store);
  return snapshotFor(store, periodId);
}

// ── Shared context ─────────────────────────────────────────────────────

interface ProjectIdentity {
  id: string;
  code?: string;
  nameEn?: string;
  nameAr?: string;
}

/**
 * The block every Timeline-sourced report carries.
 *
 * `sourced` states in the document itself where the figures came from. A
 * report that cannot say whether it is live or archived is a report nobody
 * should sign.
 */
export interface SourceBlock {
  periodId: string;
  periodLabel: string;
  dataDate: string;
  approvedBy: string;
  approvedAt: string;
  note: string;
  reportingCurrency: string;
  ratesKnownAsOf: string;
  sourced: 'timeline-snapshot';
  /** True when this is not the most recent approved period. */
  historical: boolean;
  /** Sections the period does not carry, so the report can say so. */
  missingSections: string[];
}

function sourceBlock(store: TimelineStore, s: TimelineSnapshot): SourceBlock {
  const latest = latestSnapshot(store);
  const cov = coverageOf(s);
  return {
    periodId: s.periodId,
    periodLabel: s.periodLabel || s.periodId,
    dataDate: s.dataDate,
    approvedBy: s.approvedBy,
    approvedAt: s.approvedAt,
    note: s.note,
    reportingCurrency: s.exchange?.reportingCurrency ?? '',
    ratesKnownAsOf: s.exchange?.ratesKnownAsOf ?? '',
    sourced: 'timeline-snapshot',
    historical: Boolean(latest && latest.id !== s.id),
    missingSections: cov.missing,
  };
}

/** Returned when a project has no approved history, or an unknown period. */
export interface EmptyContext {
  ok: false;
  reason: 'no-history' | 'unknown-period';
  project?: ProjectIdentity;
  periodId?: string;
  /** Periods that DO exist, so the UI can offer them. */
  available: PeriodOption[];
}

export type SourceResult<T> = (T & { ok: true }) | EmptyContext;

function empty(
  reason: EmptyContext['reason'], project: ProjectIdentity, periodId?: string,
): EmptyContext {
  return { ok: false, reason, project, periodId, available: reportablePeriods(project.id) };
}

/**
 * Opens the archive for one project and one period.
 *
 * Every builder below starts here, which is what guarantees they all read
 * the same thing. There is no second door into the data.
 */
function open(project: ProjectIdentity, periodId?: string):
  { store: TimelineStore; snap: TimelineSnapshot; src: SourceBlock } | EmptyContext {
  const store = readTimeline(project.id);
  if (approvedSnapshots(store).length === 0) return empty('no-history', project);
  const snap = resolveSnapshot(store, periodId);
  if (!snap) return empty('unknown-period', project, periodId);
  return { store, snap, src: sourceBlock(store, snap) };
}

const isEmpty = (v: any): v is EmptyContext => v && v.ok === false;

// ── 1 · MONTHLY REPORT ─────────────────────────────────────────────────

/**
 * The full month-end pack: everything the period recorded, in one document.
 * The widest of the eleven — a monthly report that omits a section is a
 * status report with a misleading title.
 */
export function monthlyContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;
  const list = approvedSnapshots(store);
  const idx = list.findIndex(s => s.id === snap.id);
  const prior = idx > 0 ? list[idx - 1] : null;

  return {
    ok: true as const,
    project, source: src,
    priorPeriod: prior ? (prior.periodLabel || prior.periodId) : '',
    delay: snap.delay ?? null,
    ld: snap.ld ?? null,
    commercial: snap.commercial ?? null,
    cash: snap.cash ?? null,
    evm: snap.evm ?? null,
    claims: snap.claims ?? null,
    subcontracts: snap.subcontracts ?? null,
    budget: snap.budget ?? null,
    certificates: snap.certificates ?? null,
    forecast: snap.forecast ?? null,
    projectStatus: snap.projectStatus ?? null,
    contract: snap.contract ?? null,
    kpi: snap.kpi ?? null,
    baselines: snap.baselines ?? null,
    frozenRates: snap.exchange?.rates ?? [],
    appliedRates: snap.exchange?.appliedRates ?? [],
    // Movement against the period before, both read from the archive.
    movement: prior ? {
      totalDelay: delta(prior.delay?.totalDelay, snap.delay?.totalDelay),
      ldExposure: delta(prior.ld?.exposure, snap.ld?.exposure),
      eac: delta(prior.evm?.eac, snap.evm?.eac),
      spi: delta(prior.evm?.spi, snap.evm?.spi),
      cpi: delta(prior.evm?.cpi, snap.evm?.cpi),
      certified: delta(prior.certificates?.certified, snap.certificates?.certified),
      cashNet: delta(prior.cash?.netFlow, snap.cash?.netFlow),
      budgetActual: delta(prior.budget?.totalActual, snap.budget?.totalActual),
    } : null,
  };
}

function delta(a: unknown, b: unknown): number | null {
  const x = typeof a === 'number' && Number.isFinite(a) ? a : null;
  const y = typeof b === 'number' && Number.isFinite(b) ? b : null;
  return x === null || y === null ? null : y - x;
}

// ── 2 · EXECUTIVE DASHBOARD ────────────────────────────────────────────

/**
 * The half-page a director reads. Latest approved position plus trend.
 * Deliberately narrow: an executive report that reprints everything is a
 * monthly report with a different cover.
 */
export function executiveContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;

  /**
   * The summary is built for the SELECTED period, not the latest.
   *
   * `executiveSummary()` in the timeline layer always answers for the most
   * recent approval, which is right for a dashboard and wrong for a
   * reissue: asking for March and receiving August's headline under a March
   * cover is precisely the failure this phase exists to prevent. So the
   * block is assembled here from the chosen snapshot and the one before it,
   * both read from the archive.
   */
  const list = approvedSnapshots(store);
  const i = list.findIndex(x => x.id === snap.id);
  const prev = i > 0 ? list[i - 1] : null;
  const pick = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const d = (a: unknown, b: unknown) => delta(a, b);

  const summary = {
    period: snap.periodLabel || snap.periodId,
    dataDate: snap.dataDate,
    approvedBy: snap.approvedBy,
    health: snap.projectStatus?.health ?? snap.kpi?.health ?? '',
    reasons: snap.projectStatus?.reasons ?? [],
    contractValue: pick(snap.projectStatus?.contractValue ?? snap.commercial?.originalContract),
    eac: pick(snap.forecast?.eac ?? snap.evm?.eac),
    vac: pick(snap.forecast?.vac ?? snap.evm?.vac),
    spi: snap.evm?.spi ?? null,
    cpi: snap.evm?.cpi ?? null,
    totalDelay: pick(snap.delay?.totalDelay),
    unmitigated: pick(snap.delay?.unmitigated),
    ldExposure: pick(snap.ld?.exposure),
    forecastFinish: snap.forecast?.forecastFinish ?? snap.contract?.forecastFinish ?? '',
    deltas: {
      spi: d(prev?.evm?.spi, snap.evm?.spi),
      cpi: d(prev?.evm?.cpi, snap.evm?.cpi),
      eac: d(prev?.evm?.eac, snap.evm?.eac),
      totalDelay: d(prev?.delay?.totalDelay, snap.delay?.totalDelay),
      ldExposure: d(prev?.ld?.exposure, snap.ld?.exposure),
    },
  };

  return {
    ok: true as const,
    project, source: src,
    summary,
    /** The latest-period summary, for comparison against the selection. */
    latestSummary: executiveSummary(store),
    trend: trendRows(store),
    forecastSeries: forecastComparison(store),
    baselineTrail: baselineTrail(store),
    reportingTrail: reportingCurrencyTrail(store),
    mixedReporting: hasMixedReportingCurrency(store),
    periodCount: approvedSnapshots(store).length,
    health: snap.projectStatus?.health ?? snap.kpi?.health ?? '',
    reasons: snap.projectStatus?.reasons ?? [],
    quadrant: snap.projectStatus?.quadrant ?? '',
  };
}

// ── 3 · PROJECT STATUS REPORT ──────────────────────────────────────────

export function statusContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;

  return {
    ok: true as const,
    project, source: src,
    status: snap.projectStatus ?? null,
    kpi: snap.kpi ?? null,
    contract: snap.contract ?? null,
    evm: snap.evm ?? null,
    delay: snap.delay ?? null,
    forecast: snap.forecast ?? null,
    baselines: snap.baselines ?? null,
    trend: trendRows(store),
  };
}

// ── 4 · PORTFOLIO REPORT ───────────────────────────────────────────────

export interface PortfolioProject {
  id: string;
  code?: string;
  nameEn?: string;
  nameAr?: string;
}

/**
 * Cross-project roll-up, built from each project's LATEST APPROVED period.
 *
 * Projects with no approved history are listed separately rather than
 * omitted or zero-filled. A portfolio table that quietly drops a project is
 * a portfolio table that under-reports exposure, and one that shows it as
 * zero is worse.
 *
 * Periods are NOT aligned to a common month on purpose: each row states its
 * own data date. Forcing every project onto one month would require either
 * inventing figures for projects that had not closed it, or excluding them.
 */
export function portfolioContext(projects: PortfolioProject[]) {
  const rows: any[] = [];
  const noHistory: PortfolioProject[] = [];
  const currencies = new Set<string>();

  projects.forEach(p => {
    const r = portfolioRow(p.id);
    if (!r) { noHistory.push(p); return; }
    const store = readTimeline(p.id);
    const snap = latestSnapshot(store);
    const ccy = snap?.exchange?.reportingCurrency ?? '';
    if (ccy) currencies.add(ccy);
    rows.push({
      ...r,
      code: p.code ?? '',
      nameEn: p.nameEn ?? '',
      nameAr: p.nameAr ?? '',
      reportingCurrency: ccy,
      periodCount: approvedSnapshots(store).length,
      unmitigated: snap?.delay?.unmitigated ?? null,
      certified: snap?.certificates?.certified ?? null,
      budgetActual: snap?.budget?.totalActual ?? null,
    });
  });

  // Roll-up of already-archived totals. Aggregation, not calculation: every
  // input was computed and frozen by the project that owns it.
  const sum = (k: string) =>
    rows.reduce((a, r) => a + (typeof r[k] === 'number' ? r[k] : 0), 0);

  const mixed = currencies.size > 1;

  return {
    ok: true as const,
    rows,
    noHistory,
    reportingCurrencies: Array.from(currencies).sort(),
    /**
     * Suppressed when the portfolio spans more than one reporting currency.
     * Adding SAR to USD produces a number with no unit, and printing it
     * beside a currency symbol would make it look like one that has.
     */
    totals: mixed ? null : {
      projects: rows.length,
      contractValue: sum('contractValue'),
      eac: sum('eac'),
      vac: sum('vac'),
      ldExposure: sum('ldExposure'),
      certified: sum('certified'),
      totalDelay: sum('totalDelay'),
    },
    mixedReporting: mixed,
    healthCounts: rows.reduce<Record<string, number>>((acc, r) => {
      const h = r.health || 'unknown';
      acc[h] = (acc[h] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

// ── 5–11 · DOMAIN REPORTS ──────────────────────────────────────────────
//
// Each reads one section of the archive plus its own trend. All seven share
// the identical opening move, which is why none of them can drift from the
// others or from the monthly pack.

/** Series of one archived path across every approved period. */
function series(store: TimelineStore, path: string): { period: string; value: number | null }[] {
  return approvedSnapshots(store).map(s => {
    const v = path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), s);
    return {
      period: s.periodLabel || s.periodId,
      value: typeof v === 'number' && Number.isFinite(v) ? v : null,
    };
  });
}

export function claimsContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;
  return {
    ok: true as const,
    project, source: src,
    claims: snap.claims ?? null,
    delay: snap.delay ?? null,
    commercial: snap.commercial ?? null,
    history: approvedSnapshots(store).map(s => ({
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      count: s.claims?.count ?? null,
      totalClaimed: s.claims?.totalClaimed ?? null,
      totalSettled: s.claims?.totalSettled ?? null,
      timeClaimed: s.claims?.timeClaimed ?? null,
      approvedCount: s.claims?.approvedCount ?? null,
    })),
  };
}

export function delayContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;
  return {
    ok: true as const,
    project, source: src,
    delay: snap.delay ?? null,
    ld: snap.ld ?? null,
    contract: snap.contract ?? null,
    baselines: snap.baselines ?? null,
    history: approvedSnapshots(store).map(s => ({
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      totalDelay: s.delay?.totalDelay ?? null,
      approvedEOT: s.delay?.approvedEOT ?? null,
      unmitigated: s.delay?.unmitigated ?? null,
      culpable: s.delay?.culpableDelay ?? null,
      ldExposure: s.ld?.exposure ?? null,
      events: s.delay?.delayEventCount ?? null,
    })),
  };
}

export function evmContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;
  return {
    ok: true as const,
    project, source: src,
    evm: snap.evm ?? null,
    forecast: snap.forecast ?? null,
    contract: snap.contract ?? null,
    baselines: snap.baselines ?? null,
    forecastSeries: forecastComparison(store),
    history: approvedSnapshots(store).map(s => ({
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      pv: s.evm?.pv ?? null, ev: s.evm?.ev ?? null, ac: s.evm?.ac ?? null,
      spi: s.evm?.spi ?? null, cpi: s.evm?.cpi ?? null,
      eac: s.evm?.eac ?? null, vac: s.evm?.vac ?? null,
      eacMethod: s.evm?.eacMethod ?? '',
    })),
  };
}

export function commercialContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;
  return {
    ok: true as const,
    project, source: src,
    commercial: snap.commercial ?? null,
    certificates: snap.certificates ?? null,
    budget: snap.budget ?? null,
    contract: snap.contract ?? null,
    baselines: snap.baselines ?? null,
    history: approvedSnapshots(store).map(s => ({
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      originalContract: s.commercial?.originalContract ?? null,
      approvedCOs: s.commercial?.approvedChangeOrders ?? null,
      currentContract: s.commercial?.currentContract ?? null,
      certified: s.certificates?.certified ?? null,
      paid: s.certificates?.paid ?? null,
      outstanding: s.certificates?.outstanding ?? null,
    })),
  };
}

export function subcontractContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;
  return {
    ok: true as const,
    project, source: src,
    subcontracts: snap.subcontracts ?? null,
    history: approvedSnapshots(store).map(s => ({
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      count: s.subcontracts?.count ?? null,
      contractValue: s.subcontracts?.totalContractValue ?? null,
      currentContract: s.subcontracts?.totalCurrentContract ?? null,
      certified: s.subcontracts?.totalCertified ?? null,
      paid: s.subcontracts?.totalPaid ?? null,
      outstanding: s.subcontracts?.totalOutstanding ?? null,
      score: s.subcontracts?.performanceScore ?? null,
    })),
  };
}

export function cashflowContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;
  return {
    ok: true as const,
    project, source: src,
    cash: snap.cash ?? null,
    certificates: snap.certificates ?? null,
    commercial: snap.commercial ?? null,
    baselines: snap.baselines ?? null,
    history: approvedSnapshots(store).map(s => ({
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      totalIn: s.cash?.totalIn ?? null,
      totalOut: s.cash?.totalOut ?? null,
      netFlow: s.cash?.netFlow ?? null,
      cumulativeNet: s.cash?.cumulativeNet ?? null,
      certified: s.certificates?.certified ?? null,
      paid: s.certificates?.paid ?? null,
    })),
    cumulativeSeries: series(store, 'cash.cumulativeNet'),
  };
}

/**
 * FX report, sourced entirely from frozen tables.
 *
 * The live register is not opened. Phase 5 proved the archive carries both
 * the rate book and the rates actually applied; this reads those and nothing
 * else, which is what makes a reissued FX report reproduce the original.
 */
export function fxContext(project: ProjectIdentity, periodId?: string) {
  const o = open(project, periodId);
  if (isEmpty(o)) return o;
  const { store, snap, src } = o;
  const currencies = archivedCurrencies(store);

  return {
    ok: true as const,
    project, source: src,
    frozen: frozenRatesFor(store, snap.periodId),
    frozenRates: snap.exchange?.rates ?? [],
    appliedRatesFrozen: snap.exchange?.appliedRates ?? [],
    ratesKnownAsOf: snap.exchange?.ratesKnownAsOf ?? '',
    reportingCurrency: snap.exchange?.reportingCurrency ?? '',
    currencies,
    fxHistory: fxTrend(store),
    appliedHistory: appliedRateRows(store),
    reportingTrail: reportingCurrencyTrail(store),
    mixedReporting: hasMixedReportingCurrency(store),
    movements: currencies.map(c => ({ currency: c, rows: fxMovement(store, c) })),
  };
}

// ── Registry of Timeline-sourced builders ──────────────────────────────

/**
 * Report id -> the builder that feeds it.
 *
 * A UI can drive every report through this map without knowing what any of
 * them contain. It is also the enforcement point: a report id absent from
 * here has no Timeline source and must not claim to be historical.
 */
export const TIMELINE_REPORTS = {
  'tl-monthly':     { builder: monthlyContext,      en: 'Monthly Report',        ar: 'التقرير الشهري' },
  'tl-executive':   { builder: executiveContext,    en: 'Executive Dashboard',   ar: 'لوحة الإدارة التنفيذية' },
  'tl-status':      { builder: statusContext,       en: 'Project Status Report', ar: 'تقرير حالة المشروع' },
  'tl-claims':      { builder: claimsContext,       en: 'Claims Report',         ar: 'تقرير المطالبات' },
  'tl-delay':       { builder: delayContext,        en: 'Delay Report',          ar: 'تقرير التأخير' },
  'tl-evm':         { builder: evmContext,          en: 'EVM Report',            ar: 'تقرير القيمة المكتسبة' },
  'tl-commercial':  { builder: commercialContext,   en: 'Commercial Report',     ar: 'التقرير التجاري' },
  'tl-subcontract': { builder: subcontractContext,  en: 'Subcontract Report',    ar: 'تقرير مقاولي الباطن' },
  'tl-cashflow':    { builder: cashflowContext,     en: 'Cash Flow Report',      ar: 'تقرير التدفق النقدي' },
  'tl-fx':          { builder: fxContext,           en: 'FX Report',             ar: 'تقرير العملات' },
} as const;

export type TimelineReportId = keyof typeof TIMELINE_REPORTS;

export const TIMELINE_REPORT_IDS = Object.keys(TIMELINE_REPORTS) as TimelineReportId[];

/** Builds the context for any Timeline-sourced report by id. */
export function buildContext(
  reportId: TimelineReportId, project: ProjectIdentity, periodId?: string,
) {
  const def = TIMELINE_REPORTS[reportId];
  if (!def) return { ok: false as const, reason: 'unknown-period' as const, project, available: [] };
  return def.builder(project, periodId);
}

// ── Report-time currency presentation (Phase 8) ────────────────────────
//
// THE RULE THIS ENFORCES
//
//   Conversion happens ONLY during report generation. No stored record
//   changes, no snapshot is rewritten, and the archived
//   `reportingCurrencyValue` remains the contractual figure forever.
//
//   Selecting EUR on a portfolio report does not restate history — it asks
//   "what would these archived figures be in EUR", and the answer is
//   computed fresh each time it is asked, labelled as a presentation, and
//   never written back.
//
// WHICH RATE IT USES
//
//   The rate FROZEN IN THE PERIOD, not today's. That is the whole point: a
//   March report presented in EUR must use the EUR rate March had on
//   record, or reissuing it in June produces different numbers under the
//   same cover. Where a period's frozen table has no route to the target,
//   the figure is returned unresolved rather than converted at a live rate.

import { crossRate, FxStore, FxRate, RateSource } from '../currency';

export interface PresentationRate {
  currency: string;
  rate: number;
  source: RateSource;
  pivot: string;
  effectiveDate: string;
  resolved: boolean;
}

/**
 * Builds a one-off rate book from a period's FROZEN table, so the frozen
 * rates can be crossed exactly as live ones would be.
 *
 * The synthetic rows carry `status:'approved'` and the period's own
 * effective dates. They are never written anywhere — this object exists for
 * the duration of one report build.
 */
function frozenBook(
  frozen: { currency: string; rate: number; effectiveDate?: string;
            reportingCurrency?: string }[],
  reportingCurrency: string,
): FxStore {
  const rates: FxRate[] = (frozen ?? []).map((r, i) => ({
    id: `frozen-${i}-${r.currency}`,
    currency: r.currency,
    baseCurrency: (r.reportingCurrency || reportingCurrency || '').toUpperCase(),
    reportingCurrency: (r.reportingCurrency || reportingCurrency || '').toUpperCase(),
    rate: r.rate,
    effectiveDate: r.effectiveDate || '1900-01-01',
    approvalDate: r.effectiveDate || '1900-01-01',
    projectId: '',
    approvedBy: 'frozen',
    createdAt: '1900-01-01T00:00:00.000Z',
    reason: 'Frozen with the reporting period',
    status: 'approved',
    version: 1,
    correctsId: '',
    correctedById: '',
    correctionReason: '',
  }));
  return { rates };
}

/**
 * The rate to present a period's figures in `target`, using only that
 * period's frozen table.
 *
 * Returns resolved:false when the archive has no route. The caller must then
 * print the original currency rather than reach for a live rate — a report
 * that silently substitutes today's rate for a missing historical one is
 * the exact failure this architecture exists to prevent.
 */
export function presentationRate(
  frozen: { currency: string; rate: number; effectiveDate?: string }[],
  reportingCurrency: string, target: string, onDate: string,
): PresentationRate {
  const from = (reportingCurrency || '').toUpperCase();
  const to = (target || '').toUpperCase();

  if (!to || from === to) {
    return { currency: to || from, rate: 1, source: 'identity', pivot: '',
             effectiveDate: onDate, resolved: true };
  }

  const book = frozenBook(frozen, from);
  const r = crossRate(book, from, to, onDate || '9999-12-31', '', from);
  return {
    currency: to,
    rate: r.resolved ? r.rate : 0,
    source: r.source,
    pivot: r.pivot,
    effectiveDate: r.effectiveDate,
    resolved: r.resolved,
  };
}

export interface CurrencyPresentation {
  /** Currency the report is being presented in. */
  target: string;
  /** Currency the archive holds. */
  archived: string;
  rate: number;
  source: RateSource;
  pivot: string;
  resolved: boolean;
  /** True when a conversion is actually being applied. */
  converting: boolean;
  /** Applies the presentation rate. Returns null when unresolved. */
  convert: (v: number | null | undefined) => number | null;
  /** The line a report prints to declare what it did. */
  note: string;
}

/**
 * The presentation layer handed to a report definition.
 *
 * Its `convert` is a pure function over already-archived numbers. It reads
 * nothing, writes nothing and holds no state beyond one rate.
 */
export function presentation(
  frozen: { currency: string; rate: number; effectiveDate?: string }[],
  reportingCurrency: string, target: string, onDate: string,
): CurrencyPresentation {
  const archived = (reportingCurrency || '').toUpperCase();
  const to = (target || archived).toUpperCase();
  const pr = presentationRate(frozen, archived, to, onDate);
  const converting = pr.resolved && to !== archived;

  return {
    target: to,
    archived,
    rate: pr.rate,
    source: pr.source,
    pivot: pr.pivot,
    resolved: pr.resolved,
    converting,
    convert: (v) => {
      if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
      if (!converting) return pr.resolved ? Number(v) : null;
      return Number(v) * pr.rate;
    },
    note: to === archived
      ? `Figures are presented in ${archived}, the currency they were archived in. No conversion applied.`
      : pr.resolved
        ? `Figures were archived in ${archived} and are presented in ${to} at ${pr.rate.toFixed(6)}`
          + `${pr.source === 'cross' ? ` (crossed via ${pr.pivot})` : ''}`
          + `, the rate frozen with this period. The archived records are unchanged; this is a `
          + `presentation, not a restatement.`
        : `Figures were archived in ${archived}. This period holds no rate to ${to}, so no `
          + `conversion has been applied and amounts are shown in ${archived}. Today\u2019s rate `
          + `was deliberately not substituted: a historical report priced at a current rate is `
          + `not a historical report.`,
  };
}

/** Currencies a period can be presented in, from its frozen table alone. */
export function presentableCurrencies(
  frozen: { currency: string; rate: number }[], reportingCurrency: string,
): string[] {
  const base = (reportingCurrency || '').toUpperCase();
  const s = new Set<string>([base]);
  (frozen ?? []).forEach(r => { if (r.rate > 0) s.add(r.currency.toUpperCase()); });
  return Array.from(s).filter(Boolean).sort();
}
