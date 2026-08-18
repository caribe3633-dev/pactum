/**
 * Unified reporting engine.
 * Destination: src/lib/reporting/reportEngine.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 2 · ONE ENGINE, NO DUPLICATED REPORT LOGIC
 *
 *   Eleven report types, one pipeline:
 *
 *     request  →  resolve snapshot  →  build context  →  attach presentation
 *              →  hand to the definition  →  render
 *
 *   Every stage is shared. A report definition receives a context that has
 *   already been sourced from the archive and already carries a currency
 *   presenter; it never fetches, never converts and never decides where its
 *   figures come from. That is what stops eleven reports from drifting into
 *   eleven slightly different interpretations of the same number.
 *
 * WHAT THIS ADDS OVER PHASE 6
 *
 *   Phase 6 built the eleven bodies and the Timeline source. It left one
 *   thing unfinished: `presentation()` existed and no report used it. So a
 *   report could be produced but not re-expressed in another currency.
 *
 *   This file closes that. Every report now goes through `runReport()`,
 *   which attaches a presenter built from THAT PERIOD'S FROZEN RATES and
 *   passes it down. Selecting USD on a March report converts March's
 *   archived figures at March's archived rate — not at today's.
 *
 * READ-ONLY, ENFORCED BY CONSTRUCTION
 *
 *   This file imports the Timeline source layer, the FX analytics layer and
 *   the renderer. It imports no module, no engine and no live store, and it
 *   calls `setItem` nowhere. A report cannot mutate anything because there
 *   is no path through which it could.
 * ══════════════════════════════════════════════════════════════════════
 */

import { ReportDocument, OutputFormat } from './types';
import { getReport } from './registry';
import { buildDocument, openReport, toHtml, GenerateOptions } from './engine';
import {
  reportablePeriods, buildContext, presentation, presentableCurrencies,
  TIMELINE_REPORTS, TIMELINE_REPORT_IDS,
  PeriodOption, CurrencyPresentation, TimelineReportId,
} from './timelineSource';
import { fxAnalytics, FxProject, FxAnalyticsBundle } from './fxAnalytics';
import { readTimeline, approvedSnapshots, latestSnapshot, snapshotFor } from '../timeline';
// Phase 3 — financial intelligence, Timeline-sourced.
import { financialIntelligence } from '../financialIntelligence';

// ── Report catalogue ───────────────────────────────────────────────────

export type ReportScope = 'project' | 'portfolio';

export interface ReportSpec {
  id: string;
  en: string;
  ar: string;
  scope: ReportScope;
  /** Group shown in the picker. */
  group: 'executive' | 'commercial' | 'delivery' | 'fx';
  /** The Timeline builder that feeds it, when project-scoped. */
  builder?: TimelineReportId;
}

/**
 * The eleven, declared once.
 *
 * A UI drives the whole engine from this list without knowing what any
 * report contains, and a report absent from here has no Timeline source and
 * cannot claim to be historical.
 */
export const REPORT_CATALOGUE: ReportSpec[] = [
  { id: 'tl-executive',   en: 'Executive Report',        ar: 'التقرير التنفيذي',     scope: 'project',   group: 'executive', builder: 'tl-executive' },
  { id: 'tl-monthly',     en: 'Monthly Progress Report', ar: 'تقرير التقدم الشهري',  scope: 'project',   group: 'executive', builder: 'tl-monthly' },
  { id: 'tl-status',      en: 'Project Status Report',   ar: 'تقرير حالة المشروع',   scope: 'project',   group: 'executive', builder: 'tl-status' },
  { id: 'tl-commercial',  en: 'Commercial Report',       ar: 'التقرير التجاري',      scope: 'project',   group: 'commercial', builder: 'tl-commercial' },
  { id: 'tl-financial',   en: 'Financial Report',        ar: 'التقرير المالي',       scope: 'project',   group: 'commercial', builder: 'tl-monthly' },
  { id: 'tl-cashflow',    en: 'Cash Flow Report',        ar: 'تقرير التدفق النقدي',  scope: 'project',   group: 'commercial', builder: 'tl-cashflow' },
  { id: 'tl-variations',  en: 'Variation Orders Report', ar: 'تقرير أوامر التغيير',  scope: 'project',   group: 'commercial', builder: 'tl-commercial' },
  { id: 'tl-claims',      en: 'Claims Report',           ar: 'تقرير المطالبات',      scope: 'project',   group: 'commercial', builder: 'tl-claims' },
  { id: 'tl-delay',       en: 'Delay Report',            ar: 'تقرير التأخير',        scope: 'project',   group: 'delivery',  builder: 'tl-delay' },
  { id: 'tl-subcontract', en: 'Subcontract Report',      ar: 'تقرير مقاولي الباطن',  scope: 'project',   group: 'delivery',  builder: 'tl-subcontract' },
  { id: 'tl-evm',         en: 'EVM Report',              ar: 'تقرير القيمة المكتسبة', scope: 'project',  group: 'delivery',  builder: 'tl-evm' },
  { id: 'tl-portfolio',   en: 'Portfolio Report',        ar: 'تقرير المحفظة',        scope: 'portfolio', group: 'executive' },
  { id: 'tl-fx-exposure', en: 'FX Exposure Report',      ar: 'تقرير التعرض للعملات', scope: 'portfolio', group: 'fx' },
  { id: 'tl-financial-intelligence', en: 'Financial Intelligence', ar: 'الذكاء المالي', scope: 'project', group: 'executive' },
];

export function reportSpec(id: string): ReportSpec | undefined {
  return REPORT_CATALOGUE.find(r => r.id === id);
}

export function reportsForScope(scope: ReportScope): ReportSpec[] {
  return REPORT_CATALOGUE.filter(r => r.scope === scope);
}

// ── The request ────────────────────────────────────────────────────────

export interface ProjectRef {
  id: string;
  code?: string;
  nameEn?: string;
  nameAr?: string;
  companyId?: string;
  companyName?: string;
}

export interface ReportRequest {
  reportId: string;
  /** Project-scoped reports need one; portfolio reports need the list. */
  project?: ProjectRef;
  projects?: ProjectRef[];
  /** Omitted means the latest approved period. */
  periodId?: string;
  /** Omitted means the currency the period was archived in. */
  currency?: string;
  lang?: 'en' | 'ar';
  generatedBy: string;
  company?: string;
  sector?: string;
}

export interface ReportResult {
  ok: boolean;
  reason?: 'unknown-report' | 'no-project' | 'no-history' | 'unknown-period';
  document?: ReportDocument;
  /** The context handed to the definition, exposed for inspection. */
  context?: any;
  presentation?: CurrencyPresentation;
  periods?: PeriodOption[];
  currencies?: string[];
}

// ── Currency options ───────────────────────────────────────────────────

/**
 * Currencies a given report can be presented in.
 *
 * Derived from the FROZEN rate table of the period being reported, plus the
 * archived reporting currency itself. A currency the period holds no rate
 * for is not offered, because offering it would invite a selection the
 * engine would then have to refuse — better to not offer than to offer and
 * decline.
 */
export function currencyOptions(req: ReportRequest): string[] {
  const spec = reportSpec(req.reportId);
  if (!spec) return [];

  if (spec.scope === 'portfolio') {
    // Union across the portfolio: a currency any project froze a rate for.
    const s = new Set<string>();
    (req.projects ?? []).forEach(p => {
      const store = readTimeline(p.id);
      const snap = req.periodId ? snapshotFor(store, req.periodId) : latestSnapshot(store);
      if (!snap) return;
      const rc = snap.exchange?.reportingCurrency;
      if (rc) s.add(rc);
      (snap.exchange?.rates ?? []).forEach(r => { if (r.rate > 0) s.add(r.currency); });
    });
    return Array.from(s).sort();
  }

  if (!req.project) return [];
  const store = readTimeline(req.project.id);
  const snap = req.periodId ? snapshotFor(store, req.periodId) : latestSnapshot(store);
  if (!snap) return [];
  return presentableCurrencies(
    snap.exchange?.rates ?? [], snap.exchange?.reportingCurrency ?? '');
}

/** Approved periods available for a report. Portfolio takes the union. */
export function availablePeriods(req: ReportRequest): PeriodOption[] {
  const spec = reportSpec(req.reportId);
  if (spec?.scope === 'portfolio') {
    const map = new Map<string, PeriodOption>();
    (req.projects ?? []).forEach(p =>
      reportablePeriods(p.id).forEach(o => { if (!map.has(o.periodId)) map.set(o.periodId, o); }));
    return Array.from(map.values()).sort((a, b) => (a.periodId < b.periodId ? 1 : -1));
  }
  return req.project ? reportablePeriods(req.project.id) : [];
}

// ── Portfolio context, currency-aware ──────────────────────────────────

export interface PortfolioRow {
  projectId: string;
  code: string;
  name: string;
  companyName: string;
  period: string;
  dataDate: string;
  archivedCurrency: string;
  contractCurrency: string;
  health: string;
  progressPct: number | null;
  /** Presented in the requested currency, or null when no route exists. */
  contractValue: number | null;
  eac: number | null;
  vac: number | null;
  certified: number | null;
  ldExposure: number | null;
  spi: number | null;
  cpi: number | null;
  totalDelay: number | null;
  unmitigated: number | null;
  /** How this row's money reached the presented currency. */
  rate: number;
  rateSource: string;
  converted: boolean;
  /** True when the row's money could not be expressed in the target. */
  unconvertible: boolean;
}

export interface PortfolioContext {
  ok: true;
  rows: PortfolioRow[];
  noHistory: ProjectRef[];
  notInPeriod: ProjectRef[];
  /** Rows whose money could not reach the target currency. */
  unconvertible: PortfolioRow[];
  targetCurrency: string;
  archivedCurrencies: string[];
  /** Totals in the target currency. Null when any row was unconvertible. */
  totals: {
    projects: number;
    contractValue: number | null;
    eac: number | null;
    vac: number | null;
    certified: number | null;
    ldExposure: number | null;
    totalDelay: number | null;
  };
  healthCounts: Record<string, number>;
  periodId: string;
  basis: string;
}

const PORTFOLIO_BASIS =
  'Each row was read from that project\u2019s approved Timeline snapshot and converted, where '
  + 'necessary, using the exchange rate FROZEN IN THAT PERIOD — never a current rate. A project '
  + 'whose period holds no rate to the selected currency is listed separately with its money '
  + 'suppressed rather than converted at a rate it never reported at. Totals exclude nothing '
  + 'silently: where a row could not be converted, the total is withheld and the reason stated.';

/**
 * Aggregates projects that contract in different currencies.
 *
 * THE HARD PART, and where a portfolio report usually goes wrong: each
 * project archived its figures in its own reporting currency, and the user
 * has asked for one. Every row is therefore converted individually, using
 * ITS OWN period's frozen rates, and a row that cannot make the journey is
 * moved to a separate list rather than dropped or zeroed.
 *
 * Totals are withheld entirely when any row is unconvertible. A total that
 * silently omits two of nine projects understates the portfolio, and a
 * reader has no way to tell from the number itself.
 */
export function portfolioContext(
  projects: ProjectRef[], targetCurrency: string, periodId?: string,
): PortfolioContext {
  const rows: PortfolioRow[] = [];
  const noHistory: ProjectRef[] = [];
  const notInPeriod: ProjectRef[] = [];
  const archived = new Set<string>();
  const target = (targetCurrency || '').toUpperCase();

  projects.forEach(p => {
    const store = readTimeline(p.id);
    if (approvedSnapshots(store).length === 0) { noHistory.push(p); return; }
    const s = periodId ? snapshotFor(store, periodId) : latestSnapshot(store);
    if (!s) { notInPeriod.push(p); return; }

    const archivedCcy = s.exchange?.reportingCurrency ?? '';
    if (archivedCcy) archived.add(archivedCcy);

    // The presenter is built from THIS period's frozen table.
    const pres = presentation(
      s.exchange?.rates ?? [], archivedCcy, target || archivedCcy, s.dataDate);

    const m = (v: unknown): number | null => {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
      if (n === null) return null;
      return pres.convert(n);
    };

    const row: PortfolioRow = {
      projectId: p.id,
      code: p.code ?? p.id,
      name: p.nameEn ?? p.code ?? p.id,
      companyName: p.companyName ?? '',
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      archivedCurrency: archivedCcy,
      contractCurrency: s.exchange?.contractCurrency ?? archivedCcy,
      health: s.projectStatus?.health ?? s.kpi?.health ?? '',
      progressPct: s.projectStatus?.progressPct ?? s.kpi?.progressPct ?? null,
      contractValue: m(s.commercial?.currentContract ?? s.projectStatus?.contractValue),
      eac: m(s.forecast?.eac ?? s.evm?.eac),
      vac: m(s.forecast?.vac ?? s.evm?.vac),
      certified: m(s.certificates?.certified),
      ldExposure: m(s.ld?.exposure),
      // Indices and day counts are currency-agnostic — never converted.
      spi: s.evm?.spi ?? null,
      cpi: s.evm?.cpi ?? null,
      totalDelay: s.delay?.totalDelay ?? null,
      unmitigated: s.delay?.unmitigated ?? null,
      rate: pres.rate,
      rateSource: pres.source,
      converted: pres.converting,
      unconvertible: !pres.resolved,
    };
    rows.push(row);
  });

  const unconvertible = rows.filter(r => r.unconvertible);
  const clean = rows.filter(r => !r.unconvertible);
  const canTotal = unconvertible.length === 0 && rows.length > 0;

  const sum = (k: keyof PortfolioRow): number | null => {
    if (!canTotal) return null;
    return clean.reduce((a, r) => a + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);
  };

  const healthCounts: Record<string, number> = {};
  rows.forEach(r => {
    const h = r.health || 'unknown';
    healthCounts[h] = (healthCounts[h] ?? 0) + 1;
  });

  rows.sort((a, b) => (b.contractValue ?? 0) - (a.contractValue ?? 0));

  return {
    ok: true,
    rows,
    noHistory,
    notInPeriod,
    unconvertible,
    targetCurrency: target || Array.from(archived)[0] || '',
    archivedCurrencies: Array.from(archived).sort(),
    totals: {
      projects: rows.length,
      contractValue: sum('contractValue'),
      eac: sum('eac'),
      vac: sum('vac'),
      certified: sum('certified'),
      ldExposure: sum('ldExposure'),
      // Days always sum, regardless of currency.
      totalDelay: rows.reduce((a, r) => a + (r.totalDelay ?? 0), 0),
    },
    healthCounts,
    periodId: periodId ?? '',
    basis: PORTFOLIO_BASIS,
  };
}

// ── The one pipeline ───────────────────────────────────────────────────

/**
 * Builds any report in the catalogue.
 *
 * Every report — project or portfolio, executive or FX — goes through this
 * function. There is no second path, which is the structural reason no two
 * reports can disagree about where a figure came from.
 */
export function buildReport(req: ReportRequest): ReportResult {
  const spec = reportSpec(req.reportId);
  if (!spec) return { ok: false, reason: 'unknown-report' };

  const periods = availablePeriods(req);
  const currencies = currencyOptions(req);
  const lang = req.lang ?? 'en';

  // ── Portfolio scope ──
  if (spec.scope === 'portfolio') {
    const list = req.projects ?? [];
    const target = (req.currency || currencies[0] || '').toUpperCase();

    let context: any;
    if (spec.id === 'tl-fx-exposure') {
      const fxProjects: FxProject[] = list.map(p => ({
        id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr,
        companyId: p.companyId, companyName: p.companyName,
      }));
      const bundle: FxAnalyticsBundle = fxAnalytics(fxProjects, req.periodId);
      context = {
        project: undefined, company: req.company, lang,
        fx: bundle,
        targetCurrency: target,
        periodId: req.periodId ?? '',
      };
    } else {
      context = {
        project: undefined, company: req.company, lang,
        portfolio: portfolioContext(list, target, req.periodId),
        targetCurrency: target,
        periodId: req.periodId ?? '',
      };
    }

    const def = getReport(spec.id);
    if (!def) return { ok: false, reason: 'unknown-report', periods, currencies };
    const document = buildDocument(def, context, {
      lang, generatedBy: req.generatedBy,
    } as GenerateOptions);
    return { ok: true, document, context, periods, currencies };
  }

  // ── Project scope ──
  if (!req.project) return { ok: false, reason: 'no-project', periods, currencies };

  const store = readTimeline(req.project.id);
  if (approvedSnapshots(store).length === 0) {
    return { ok: false, reason: 'no-history', periods, currencies };
  }
  const snap = req.periodId ? snapshotFor(store, req.periodId) : latestSnapshot(store);
  if (!snap) return { ok: false, reason: 'unknown-period', periods, currencies };

  const archivedCcy = snap.exchange?.reportingCurrency ?? '';
  const target = (req.currency || archivedCcy).toUpperCase();

  // The presenter, built from THIS period's frozen rates. Shared by every
  // report type — one construction, one behaviour.
  const pres = presentation(
    snap.exchange?.rates ?? [], archivedCcy, target, snap.dataDate);

  // Financial Intelligence assembles its own bundle: it spans the whole
  // archived series rather than one period's sections, so the per-period
  // Timeline builders cannot express it.
  if (spec.id === 'tl-financial-intelligence') {
    const fi = financialIntelligence(
      { id: req.project.id, code: req.project.code,
        nameEn: req.project.nameEn, nameAr: req.project.nameAr },
      (req.projects ?? []).map(p => ({
        id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr,
        companyId: p.companyId, companyName: p.companyName,
      })),
      req.periodId,
    );
    const def = getReport(spec.id);
    if (!def) return { ok: false, reason: 'unknown-report', periods, currencies };
    const document = buildDocument(def, {
      project: req.project, company: req.company, sector: req.sector, lang, fi,
      presentation: pres, displayCurrency: pres.target, archivedCurrency: pres.archived,
    }, { lang, generatedBy: req.generatedBy } as GenerateOptions);
    return { ok: true, document, context: { fi }, presentation: pres, periods, currencies };
  }

  const base = buildContext(spec.builder ?? (spec.id as TimelineReportId),
                            req.project, req.periodId);

  const context = {
    ...(base as any),
    project: req.project,
    company: req.company,
    sector: req.sector,
    lang,
    // ── Phase 2 additions, uniform across all eleven ──
    presentation: pres,
    /** Converts an archived figure into the presented currency. */
    present: (v: number | null | undefined) => pres.convert(v),
    displayCurrency: pres.target,
    archivedCurrency: pres.archived,
    /** Reports print this when they convert. */
    currencyNote: pres.note,
    /** Variation Orders and Financial reuse a builder; this disambiguates. */
    reportVariant: spec.id,
  };

  const def = getReport(spec.id) ?? getReport(spec.builder ?? '');
  if (!def) return { ok: false, reason: 'unknown-report', periods, currencies };

  const document = buildDocument(def, context, {
    lang, generatedBy: req.generatedBy,
  } as GenerateOptions);

  return { ok: true, document, context, presentation: pres, periods, currencies };
}

/** Builds and opens in one call — what a UI button invokes. */
export function runReport(req: ReportRequest, format: OutputFormat = 'preview'): {
  ok: boolean; reason?: string; window?: Window | null;
} {
  const r = buildReport(req);
  if (!r.ok || !r.document) return { ok: false, reason: r.reason };
  const w = openReport(r.document, format, req.lang ?? 'en');
  return { ok: true, window: w };
}

/** Renders to an HTML string. Used by tests and by any future exporter. */
export function reportHtml(req: ReportRequest): string {
  const r = buildReport(req);
  if (!r.ok || !r.document) return '';
  return toHtml(r.document, { lang: req.lang ?? 'en' });
}
