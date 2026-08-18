/**
 * Reporting Engine — public surface.
 * Destination: src/lib/reporting/index.ts
 *
 * A module imports from here and nowhere else inside the engine.
 */

export * from './types';
export { registerReport, getReport, listReports, listScopes } from './registry';
export { generateReport, buildDocument, openReport, toHtml, exportAs, exportReport, SYSTEM_VERSION } from './engine';

/**
 * SPRINT 4 — Office writers. Exposed for tests and for any caller that
 * already holds a built document; the normal path is `exportAs`.
 */
export { buildXlsx, exportExcel } from './exportExcel';
export { buildDocx, exportWord } from './exportWord';
export { buildPptx, exportPptx } from './exportPptx';
export { safeFileName } from './ooxml';
export { money, moneySar, moneyWithCurrency, percent, days, reportDate, reportDateTime, cell } from './format';

/**
 * Phase 6 — the Timeline source layer.
 *
 * These are the ONLY sanctioned inputs for a historical report. A caller
 * that wants a report reaches for one of these builders, which reads an
 * approved snapshot; there is no path here through which a live module
 * value could be supplied.
 */
export {
  reportablePeriods, resolveSnapshot, buildContext,
  monthlyContext, executiveContext, statusContext, portfolioContext,
  claimsContext, delayContext, evmContext, commercialContext,
  subcontractContext, cashflowContext, fxContext,
  TIMELINE_REPORTS, TIMELINE_REPORT_IDS,
} from './timelineSource';
export type { PeriodOption, SourceBlock, TimelineReportId } from './timelineSource';

/**
 * Phase 2 — the unified engine.
 *
 * Every report in the platform is produced by `buildReport()` / `runReport()`.
 * There is no second path, which is the structural reason no two reports can
 * disagree about where a figure came from or what currency it is in.
 */
export {
  buildReport, runReport, reportHtml,
  REPORT_CATALOGUE, reportSpec, reportsForScope,
  availablePeriods, currencyOptions, portfolioContext as portfolioCurrencyContext,
} from './reportEngine';
export type {
  ReportRequest, ReportResult, ReportSpec, ReportScope,
  ProjectRef, PortfolioRow, PortfolioContext,
} from './reportEngine';

/** Phase 2 — FX analytics, Timeline-sourced. */
export {
  fxAnalytics, fxExposure, fxTranslation, portfolioTranslation,
  currencyDistribution, projectsByCurrency, subcontractsByCurrency,
  certificatesByCurrency, monthlyFxTrend, historicalRateTrend, allRateTrends,
} from './fxAnalytics';
export type {
  FxProject, FxAnalyticsBundle, FxExposure, ExposureRow,
  FxTranslation, TranslationRow, CurrencyDistribution,
  ProjectsByCurrency, CategoryByCurrency, MonthlyFxTrend, RateTrend,
} from './fxAnalytics';

// Importing the definitions registers them. Adding a report means adding a
// line here — the engine itself never changes.
import './definitions';
