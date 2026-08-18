import { readFx, convertBetween, readCurrencySettings } from './currency';
import { companyPortfolioValue, PortfolioValue } from './companyPortfolio';

/**
 * Cross-company portfolio aggregation — converts BEFORE summing.
 * Destination: src/lib/portfolioAggregate.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 3 · PORTFOLIO
 *
 * THE DEFECT, MEASURED
 *
 *   EnterprisePortfolioPage:134
 *
 *     aggregate: filtered.reduce((a, c) => a + (Number(c.portfolioValue) || 0), 0)
 *
 *   Two faults in one line:
 *
 *     1. `c.portfolioValue` is a STORED field that nothing updates.
 *        Sprint 2B proved it stays 0 for the life of a company, which is
 *        why every card read "0 SAR" until that sprint derived it.
 *
 *     2. Even once derived, the figures cannot simply be added. Company A
 *        reports in SAR, B in USD, C in EUR. Adding 480,000,000 (SAR) to
 *        145,000,000 (USD) to 540,000,000 (AED) produces a number that is
 *        not a quantity of anything — the same class of error Sprint 1
 *        closed inside a single project, now at portfolio level.
 *
 * WHAT THIS MODULE DOES
 *
 *   Each company's value is derived in ITS OWN reporting currency by
 *   `companyPortfolioValue` (Sprint 2B), then converted into one chosen
 *   presentation currency through the FX engine before being summed.
 *
 * WHICH RATE, AND WHY IT IS SAID OUT LOUD
 *
 *   A portfolio roll-up is a STATEMENT ABOUT NOW: "what is the group
 *   carrying today". There is no single transaction date to freeze
 *   against, because the figure spans hundreds of transactions across
 *   many companies. So the conversion uses the rate in force on the
 *   AS-AT DATE the caller supplies, defaulting to today.
 *
 *   That is a different rule from Sprint 1, where each transaction froze
 *   its own rate — and the difference is deliberate. A transaction is a
 *   historical fact and must never move. A portfolio total is a current
 *   position and SHOULD move when rates move. Both are returned with
 *   their provenance so a reader can tell which they are looking at.
 *
 * WHAT IT REFUSES TO DO
 *
 *   It never invents a rate. A company whose currency has no published
 *   route to the presentation currency is EXCLUDED from the total and
 *   reported in `unconvertible`. Silently treating it as 1:1, or
 *   dropping it without saying so, would understate the portfolio while
 *   looking complete.
 * ══════════════════════════════════════════════════════════════════════
 */

/** One company's contribution to the group total. */
export interface CompanyContribution {
  companyId: string;
  name: string;
  /** Derived value in the COMPANY's own reporting currency. */
  nativeValue: number;
  nativeCurrency: string;
  /** The same value converted into the presentation currency. */
  convertedValue: number;
  /** Rate applied. 1 when no conversion was needed. */
  rate: number;
  /** How the rate was found: identity, direct, inverse or cross. */
  rateSource: string;
  /** False when no route existed — the company is then excluded. */
  resolved: boolean;
  /** Projects counted, and those skipped, from companyPortfolioValue. */
  counted: number;
  unconverted: number;
  archived: number;
}

export interface PortfolioAggregate {
  /** Sum of every RESOLVED contribution, in `currency`. */
  total: number;
  /** The presentation currency the total is expressed in. */
  currency: string;
  /** The date the rates were read against. */
  asAt: string;
  /** Per-company breakdown, resolved and not. */
  contributions: CompanyContribution[];
  /** Companies excluded because no rate route existed. */
  unconvertible: CompanyContribution[];
  /** Companies whose value contributed to `total`. */
  companiesCounted: number;
  /** Projects that contributed across all companies. */
  projectsCounted: number;
  /**
   * False when at least one company was excluded, or one contributing
   * company had an unresolved internal conversion. The total is still
   * returned — a caller reporting money must say it is partial.
   */
  complete: boolean;
}

interface MinimalCompany {
  id: string;
  name: string;
  reportingCurrency?: string;
}

interface MinimalProject {
  id: string;
  companyId?: string;
  sectorId?: string;
  status?: string;
  contractValue?: number;
  commencementDate?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Aggregates several companies into one presentation currency.
 *
 * `presentIn` defaults to the FIRST company's reporting currency rather
 * than to a hardcoded 'SAR': on a single-company portfolio that makes the
 * total exact with no conversion at all, and on a mixed one it picks a
 * currency actually in use instead of inventing a third.
 */
export function aggregatePortfolio(
  companies: MinimalCompany[],
  projects: MinimalProject[],
  presentIn?: string,
  asAt: string = today(),
  presenterId?: string,
): PortfolioAggregate {
  const currency = (presentIn
    || (companies[0] ? readCurrencySettings(companies[0].id).baseCurrency : '')
    || 'SAR').toUpperCase();

  /**
   * WHICH FX STORE HOLDS THE ROUTE — corrected after certification.
   *
   * The first version asked `readFx(sourceCompany)`. That is the one
   * store guaranteed NOT to have the rate: FX rates are published per
   * company, and a company only publishes what IT needs to report in
   * ITS OWN currency. A SAR company has no reason to hold SAR -> EUR.
   *
   * Certification measured the consequence: a two-company portfolio
   * reported `counted: 1`. The SAR company was refused for want of a
   * route and dropped out of the total — correctly refusing to invent a
   * rate, but looking in the wrong place to begin with.
   *
   * The presentation currency belongs to the PRESENTING company, so its
   * store is where the route lives. That store is tried first; the
   * source company's is still tried as a fallback, because a company may
   * legitimately publish the outbound leg itself.
   */
  const presenter = presenterId
    || companies.find(c => readCurrencySettings(c.id).baseCurrency.toUpperCase() === currency)?.id
    || (companies[0] ? companies[0].id : '');

  const contributions: CompanyContribution[] = [];
  const unconvertible: CompanyContribution[] = [];

  let total = 0;
  let companiesCounted = 0;
  let projectsCounted = 0;
  let complete = true;

  companies.forEach(c => {
    const native: PortfolioValue = companyPortfolioValue(c.id, projects);

    const base: Omit<CompanyContribution, 'convertedValue' | 'rate' | 'rateSource' | 'resolved'> = {
      companyId: c.id,
      name: c.name,
      nativeValue: native.value,
      nativeCurrency: native.currency,
      counted: native.counted,
      unconverted: native.unconverted,
      archived: native.archived,
    };

    // Same currency: no conversion, no rate lookup, no chance of error.
    if (native.currency.toUpperCase() === currency) {
      const row: CompanyContribution = {
        ...base, convertedValue: native.value, rate: 1,
        rateSource: 'identity', resolved: true,
      };
      contributions.push(row);
      total += native.value;
      companiesCounted++;
      projectsCounted += native.counted;
      if (!native.resolved) complete = false;
      return;
    }

    // Cross-currency: ask the FX engine for a route on the as-at date.
    // The presenting company's store first — see the note above.
    let conv = presenter
      ? convertBetween(readFx(presenter), native.value, native.currency, currency, asAt, '')
      : { resolved: false, appliedRate: 0, converted: 0, source: 'unresolved' } as any;

    if (!conv.resolved || !(conv.appliedRate > 0)) {
      // Fallback: the source company may publish the outbound leg itself.
      conv = convertBetween(readFx(c.id), native.value, native.currency, currency, asAt, '');
    }

    if (!conv.resolved || !(conv.appliedRate > 0)) {
      // No route. Excluded and named, never silently folded in at 1:1.
      const row: CompanyContribution = {
        ...base, convertedValue: 0, rate: 0,
        rateSource: 'unresolved', resolved: false,
      };
      unconvertible.push(row);
      contributions.push(row);
      complete = false;
      return;
    }

    const row: CompanyContribution = {
      ...base,
      convertedValue: conv.converted,
      rate: conv.appliedRate,
      rateSource: conv.source,
      resolved: true,
    };
    contributions.push(row);
    total += conv.converted;
    companiesCounted++;
    projectsCounted += native.counted;
    if (!native.resolved) complete = false;
  });

  return {
    total, currency, asAt, contributions, unconvertible,
    companiesCounted, projectsCounted, complete,
  };
}

/**
 * One-line summary of what the total does and does not include.
 *
 * Returned as text because every caller that prints the number should be
 * able to print the caveat beside it without re-deriving the wording.
 */
export function aggregateCaveat(
  agg: PortfolioAggregate, isRtl = false,
): string {
  if (agg.complete) return '';
  const parts: string[] = [];
  if (agg.unconvertible.length) {
    parts.push(isRtl
      ? `${agg.unconvertible.length} شركة بلا سعر صرف منشور إلى ${agg.currency}`
      : `${agg.unconvertible.length} company(ies) have no published rate to ${agg.currency}`);
  }
  const partial = agg.contributions.filter(c => c.resolved && c.unconverted > 0);
  if (partial.length) {
    const n = partial.reduce((a, c) => a + c.unconverted, 0);
    parts.push(isRtl
      ? `${n} مشروع بعملة تقرير مختلفة`
      : `${n} project(s) report in another currency`);
  }
  return parts.join(isRtl ? ' · ' : ' · ');
}
