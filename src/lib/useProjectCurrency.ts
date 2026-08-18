import { useMemo } from 'react';
import { fetchSectors } from '../mock/sectors';
import { companyIdOfProject } from './projectMaster';
import { resolveProjectCurrencies } from './currencyArchitecture';

/**
 * The reporting currency of the project on screen.
 * Destination: src/lib/useProjectCurrency.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 3 · R5 — WHY A HOOK RATHER THAN A MANDATORY PARAMETER
 *
 * THE DEFECT
 *
 *   `formatMoney` defaults to `currency = 'SAR'`. 137 of 194 call sites
 *   pass no currency, so they print SAR silently. On a EUR company that
 *   is simply a wrong number with a confident label.
 *
 * WHY THE OBVIOUS FIX WAS THE WRONG ONE
 *
 *   The roadmap proposed deleting the default and letting the compiler
 *   find every site. Measured before attempting it: of the seven files
 *   holding 127 of those calls, NOT ONE has a currency in scope. Making
 *   the parameter mandatory would have produced 137 compile errors with
 *   no local value to satisfy them — and the fastest way to silence a
 *   compiler is to pass whatever is nearest, which is how a wrong
 *   currency becomes a hardcoded wrong currency.
 *
 *   So the plumbing comes first. Each module gets the currency in scope
 *   through this hook; only then is removing the default a one-line
 *   change that the compiler can meaningfully police.
 *
 * WHAT IT RETURNS
 *
 *   The project's own reporting currency, from the Sprint 2 architecture
 *   — a STORED decision, not a live derivation from the company. Falls
 *   back through sector and company only when the project has no config,
 *   which is the legacy case.
 * ══════════════════════════════════════════════════════════════════════
 */

interface ProjectLike {
  id: string;
  companyId?: string;
  sectorId?: string;
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE TWO CURRENCIES, AND WHICH ONE A SCREEN WANTS
 *
 *   base       THE PROJECT'S CONTRACT CURRENCY. The native, primary unit
 *              of the signed contract, and the unit every project-level
 *              financial record is STORED and DISPLAYED in — cash flow,
 *              EVM, budget, claims, change orders, owner certificates,
 *              commercial totals, delay, LD, risk exposure.
 *
 *              >>> Project screens want THIS one. <<<
 *
 *   reporting  THE AGGREGATION CURRENCY. Used only when this project is
 *              rolled UP into something larger: a company total, a
 *              portfolio total, a cross-project report. It is never the
 *              unit of a figure shown on the project's own screens.
 *
 * These were conflated, and the consequence was measured: a SAR project
 * under an AED company printed "AED" over every one of its own figures.
 * The distinction is now explicit in the field names above, in
 * `MoneyContext.base` vs `MoneyContext.companyReporting`, and in
 * `TransactionContext.reportingCurrency` vs `.companyReportingCurrency`.
 * ══════════════════════════════════════════════════════════════════════
 */
export interface ProjectCurrencyView {
  /**
   * AGGREGATION currency — for rolling this project up into a company or
   * portfolio figure. NOT the unit of the project's own screens.
   */
  reporting: string;
  /**
   * CONTRACT currency — the project's native financial unit and what
   * every project-level screen displays. This is the usual choice.
   */
  base: string;
  /** Day-to-day site spend. */
  working: string;
  /** True when the project states its currencies explicitly. */
  explicit: boolean;
}

/**
 * Resolves the three currencies for a project component.
 *
 * Safe to call with a partially-loaded project: an empty id yields the
 * fallback rather than throwing, because a module rendering before its
 * project arrives must not crash the tab.
 */
export function useProjectCurrency(project: ProjectLike | undefined): ProjectCurrencyView {
  return useMemo(() => {
    if (!project?.id) {
      return { reporting: 'SAR', base: 'SAR', working: 'SAR', explicit: false };
    }
    const companyId = project.companyId
      || companyIdOfProject(project as any, fetchSectors())
      || '';
    const r = resolveProjectCurrencies(project.id, project.sectorId, companyId);
    return {
      reporting: r.reportingCurrency,
      base: r.baseCurrency,
      working: r.workingCurrency,
      explicit: r.explicit,
    };
  }, [project?.id, project?.companyId, project?.sectorId]);
}
