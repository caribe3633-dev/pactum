import { readSectors } from './masterData';
import { readCurrencySettings, readFx, convertBetween } from './currency';
import { commercialTotals } from './commercialTotals';

/**
 * Company portfolio value — DERIVED, never stored.
 * Destination: src/lib/companyPortfolio.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 3 · R9
 *
 * THE DEFECT, MEASURED
 *
 *   `Company.portfolioValue` is a stored number that nothing ever
 *   updates. `createCompany` writes 0 and no mutator touches it again.
 *   Phase 3J measured three companies holding SAR 480M, USD 145M + EGP
 *   3.8B and AED 540M of projects — all three cards read "0 SAR".
 *
 *   Two faults in one figure: the value was stale (always 0) and the
 *   unit was invented (always "SAR", hardcoded next to the number).
 *
 * WHY THIS COULD NOT BE FIXED BEFORE SPRINT 1
 *
 *   Summing project values across a company means adding figures that
 *   may be in different currencies. Until Sprint 1 closed the
 *   mixed-unit defect there was no safe way to add them — the total
 *   would have compounded the error rather than exposing it. That is
 *   why the roadmap put R9 after R2.
 *
 * HOW IT IS DERIVED
 *
 *   For each project in the company, `commercialTotals` returns the
 *   revised contract value ALREADY converted into that project's
 *   reporting currency, using the rate frozen on each transaction. Those
 *   are summed only when they share the company's reporting currency.
 *
 *   A project reporting in something else is NOT silently converted at
 *   today's rate — that would invent a number. It is counted separately
 *   and reported as `unconverted`, so a caller can say "plus 2 projects
 *   in other currencies" instead of quietly understating the portfolio.
 *
 * ARCHIVED PROJECTS ARE EXCLUDED
 *
 *   A portfolio figure states what a company is currently carrying.
 *   Archived work is history and is reported separately.
 * ══════════════════════════════════════════════════════════════════════
 */

export interface PortfolioValue {
  /** Sum of revised contract values, in `currency`. */
  value: number;
  /** The currency `value` is expressed in — the company's reporting currency. */
  currency: string;
  /** Projects that contributed to `value`. */
  counted: number;
  /**
   * Projects whose own reporting currency differs from the company's, so
   * they were NOT added. Converting them here would apply today's rate to
   * a historical figure.
   */
  unconverted: number;
  /** Archived projects, excluded by design. */
  archived: number;
  /**
   * False when at least one contributing project could not resolve its
   * own contract conversion. The total is still returned, but a screen
   * reporting money should say it is incomplete.
   */
  resolved: boolean;
}

interface MinimalProject {
  id: string;
  companyId?: string;
  sectorId?: string;
  status?: string;
  contractValue?: number;
  commencementDate?: string;
}

/**
 * Derives one company's portfolio value from its projects.
 *
 * `projects` is passed in rather than read here: the project store is
 * owned by the project layer, and reaching across would give this module
 * a second source of truth for the same fact.
 */
export function companyPortfolioValue(
  companyId: string, projects: MinimalProject[],
): PortfolioValue {
  const currency = readCurrencySettings(companyId).baseCurrency;

  const empty: PortfolioValue = {
    value: 0, currency, counted: 0, unconverted: 0, archived: 0, resolved: true,
  };
  if (!companyId) return empty;

  // A project belongs to the company either directly or through its
  // sector. Both are checked because `companyId` on the project record is
  // optional on legacy rows.
  const sectorIds = new Set(
    readSectors().filter(s => s.companyId === companyId).map(s => s.id),
  );
  const mine = projects.filter(p =>
    p.companyId === companyId || (p.sectorId && sectorIds.has(p.sectorId)));

  let value = 0;
  let counted = 0;
  let unconverted = 0;
  let archived = 0;
  let resolved = true;

  /**
   * THIS IS WHERE THE AGGREGATION CONVERSION BELONGS.
   *
   * ════════════════════════════════════════════════════════════════════
   * `commercialTotals` now returns each project in its OWN CONTRACT
   * currency, which is the correct unit for a project-level fact. That
   * makes converting the company's job, and this is the only place in
   * the project -> company path that does it.
   *
   * Before, this function relied on every project already happening to
   * be denominated in the company currency, and simply DROPPED any that
   * was not (`unconverted++`). With the contract currency now governing,
   * that test would have excluded nearly every project and quietly
   * understated the company total — the same class of defect the
   * portfolio aggregate was corrected for at certification.
   *
   * A project with no published rate is still refused, never folded in
   * at 1:1, and is counted in `unconverted` so the caller can say the
   * total is partial.
   * ════════════════════════════════════════════════════════════════════
   */
  const fx = readFx(companyId);
  const asAt = new Date().toISOString().slice(0, 10);

  mine.forEach(p => {
    if (p.status === 'Archived') { archived++; return; }

    const t = commercialTotals(p as any, companyId);

    // Already in the company's currency: no lookup, no rounding, no risk.
    if (t.reportingCurrency.toUpperCase() === currency.toUpperCase()) {
      value += t.revisedContract;
      counted++;
      if (!t.resolved) resolved = false;
      return;
    }

    // Cross-currency. The rate is read on TODAY rather than on the
    // commencement date: this is a live "what is the portfolio worth
    // now" figure, not a filed historical record.
    const c = convertBetween(
      fx, t.revisedContract, t.reportingCurrency, currency, asAt, p.id, currency);

    if (!c.resolved || !(c.appliedRate > 0)) {
      unconverted++;
      resolved = false;
      return;
    }

    value += c.converted;
    counted++;
    if (!t.resolved) resolved = false;
  });

  return { value, currency, counted, unconverted, archived, resolved };
}

/**
 * The same figure for every company in one pass.
 *
 * Keyed by company id, for a portfolio grid that would otherwise call the
 * function once per card and re-read the sector list every time.
 */
export function portfolioValues(
  companyIds: string[], projects: MinimalProject[],
): Record<string, PortfolioValue> {
  const out: Record<string, PortfolioValue> = {};
  companyIds.forEach(id => { out[id] = companyPortfolioValue(id, projects); });
  return out;
}
