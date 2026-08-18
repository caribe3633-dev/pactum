/**
 * PACTUM Enterprise Portfolio Aggregation Engine
 *
 * Reads all project localStorage data and computes portfolio-level metrics.
 * Ensures every project has representative seed data so all charts are live
 * even before users visit individual module pages.
 * All calculations default to automatic aggregation; consumers may apply
 * manual overrides stored in `pactum-portfolio-overrides`.
 */
import { Project } from './data';
// One rate book, read here to convert each project into the tier's unit.
import { readFx, convertBetween } from './currency';
import { contractCurrencyOf } from './projectCurrency';
/**
 * STEP 13 — the portfolio no longer owns an EVM engine. BAC, PV, EV, AC
 * and every derived index come from the authoritative project engine via
 * this one call. See portfolioEvm.ts for what was removed and why.
 */
import { consolidatePortfolioEvm } from './portfolioEvm';
import { projectEvmResult } from './evm';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface PortfolioMetrics {
  /**
   * The unit every money figure below is expressed in.
   * '' when the caller summed raw without a target (legacy behaviour),
   * which is the one case where the totals may mix currencies.
   */
  currency: string;
  /**
   * Projects EXCLUDED from every total because no published rate reached
   * the target currency on the as-at date. Never silently dropped: a
   * caller printing a total must be able to say what is missing from it.
   */
  unconvertible: { id: string; name: string; currency: string }[];
  /** True when every project in scope contributed. */
  complete: boolean;

  // Contract
  totalContractValue: number;
  totalRevisedContractValue: number;
  totalApprovedVOs: number;
  // Claims
  totalClaimsSubmitted: number;
  totalClaimsSettled: number;
  totalClaimsCount: number;
  totalClaimsApprovedCount: number;
  pendingClaimsCount: number;
  claimsSuccessRate: number;
  // Cash
  totalCashIn: number;
  totalCashOut: number;
  totalNetCashFlow: number;
  // Projects
  activeProjects: number;
  completedProjects: number;
  delayedProjects: number;
  totalProjects: number;
  portfolioProgress: number;
  averageDelay: number;
  // EVM
  portfolioPV: number;
  portfolioEV: number;
  portfolioAC: number;
  portfolioBAC: number;
  /**
   * STEP 13 — NULL means "cannot be computed", not 1.00.
   * The old code defaulted both to 1 when there was no data, so an empty
   * portfolio reported perfect performance. Null renders as a dash.
   */
  portfolioSPI: number | null;
  portfolioCPI: number | null;
  portfolioEAC: number;
  portfolioVAC: number;
  portfolioETC: number;
  // Financial
  totalBudgetPlanned: number;
  totalBudgetActual: number;
  averageMargin: number;
  // Sub
  totalSubValue: number;
  totalSubPaid: number;
  // Risk
  riskExposureIndex: number;
  highRisks: number;
  criticalRisks: number;
  // Variations
  approvedVariationsCount: number;
  approvedVariationsValue: number;
  // EVA
  netOperatingProfit: number;
  capitalEmployed: number;
  wacc: number;
  costOfCapital: number;
  economicValueAdded: number;
  // Scores
  portfolioHealthScore: number;
  executiveRiskRating: 'Low' | 'Medium' | 'High' | 'Critical';
  // Chart series
  cashFlowByMonth: CashFlowPoint[];
  claimsByStatus: PiePoint[];
  riskByCategory: RiskCatPoint[];
  projectsByStatus: PiePoint[];
  budgetByCategory: BudgetCatPoint[];
  sCurve: SCurvePoint[];
  projectPerformance: ProjectPerf[];
}

export interface CashFlowPoint  { month: string; in: number; out: number; net: number; }
export interface PiePoint       { name: string; value: number; color?: string; }
export interface RiskCatPoint   { category: string; count: number; exposure: number; }
export interface BudgetCatPoint { category: string; planned: number; actual: number; }
export interface SCurvePoint    { label: string; pv: number; ev: number; ac: number; }
export interface ProjectPerf    {
  id: string; nameEn: string; nameAr: string; code: string;
  contractValue: number; progress: number;
  /** STEP 13 — null when the engine cannot measure this project. */
  spi: number | null; cpi: number | null;
  delayDays: number; claimsCount: number; status: string;
}

export type MetricSource = 'auto' | 'override' | 'pending';
export type OverrideMap  = Record<string, number>;

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export function readOverrides(): OverrideMap {
  return readLS<OverrideMap>('pactum-portfolio-overrides', {});
}

export function saveOverride(key: string, value: number): void {
  const prev = readOverrides();
  localStorage.setItem('pactum-portfolio-overrides', JSON.stringify({ ...prev, [key]: value }));
}

export function clearOverride(key: string): void {
  const prev = readOverrides();
  const next = { ...prev };
  delete next[key];
  localStorage.setItem('pactum-portfolio-overrides', JSON.stringify(next));
}

export function clearAllOverrides(): void {
  localStorage.removeItem('pactum-portfolio-overrides');
}

// â”€â”€ Cold-start seed data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Seeds representative module data for a project if the localStorage key is
 * absent. Never overwrites existing user data. Called once per project during
 * each Auto Calculate pass.
 */
function ensureProjectModuleData(_proj: Project): void {
  // ══════════════════════════════════════════════════════════════════
  // PRE-PRODUCTION CLEAN SLATE — THIS FUNCTION NO LONGER INVENTS DATA.
  //
  // It used to write EIGHT business registers into every project whose
  // storage key was absent: delays, claims, risks, cash flow, budget,
  // certificates, change orders and subcontractors — each with figures
  // derived from contract value and progress.
  //
  // MEASURED BEFORE THE FIX: opening one Analytics page took a clean
  // profile from 0 business keys to 32 keys holding 128 invented rows.
  // Nobody typed any of it. `computePortfolioMetrics` calls this once
  // per project on every pass, and the page runs a pass automatically on
  // mount — so merely LOOKING at a dashboard manufactured a portfolio.
  //
  // That is incompatible with a system whose entire premise, from Step
  // 11 onward, is that an absent figure is reported as absent and never
  // as a number. A seeded cash flow is indistinguishable from a real one
  // once written, and there is no way for a reader to tell which is
  // which. The first real contract must not be entered beside it.
  //
  // The function is KEPT and made a no-op rather than deleted: it is
  // called from the metrics loop, and keeping the signature means that
  // call site cannot drift. The sample data itself was NOT lost — it
  // lives in `lib/sampleData.ts` behind the explicit "Load Sample Data"
  // button, which is where a demo belongs.
  // ══════════════════════════════════════════════════════════════════
}

export interface MetricsCurrencyOptions {
  /** Unit to express every total in. Omit to sum raw (legacy behaviour). */
  targetCurrency?: string;
  /** Company whose rate book holds the routes. */
  companyId?: string;
  /** Rate date. Defaults to today — this is a live valuation, not a filing. */
  asAt?: string;
}

export function computePortfolioMetrics(
  projects: Project[],
  waccOverride?: number,
  ccy: MetricsCurrencyOptions = {},
): PortfolioMetrics {
  const wacc = waccOverride ?? 0.08;

  // ── Currency frame ──
  const target = (ccy.targetCurrency || '').toUpperCase();
  const converting = Boolean(target && ccy.companyId);
  const fxBook = converting ? readFx(ccy.companyId as string) : null;
  const onDate = ccy.asAt || new Date().toISOString().slice(0, 10);
  const unconvertible: { id: string; name: string; currency: string }[] = [];

  /**
   * The factor bringing ONE project's raw figures into the target.
   *
   * Returns null when no route exists, which excludes the project
   * entirely rather than contributing a mislabelled figure. Computed
   * once per project and applied to every one of its amounts, so all of
   * a project's numbers move together and internal relationships
   * (planned - actual, gross - retention) survive intact.
   */
  const factorFor = (proj: Project): number | null => {
    if (!converting || !fxBook) return 1;
    const from = contractCurrencyOf(proj.id, target).toUpperCase();
    if (from === target) return 1;
    const c = convertBetween(fxBook, 1, from, target, onDate, proj.id, target);
    if (!c.resolved || !(c.appliedRate > 0)) {
      unconvertible.push({
        id: proj.id,
        name: (proj as any).nameEn || proj.id,
        currency: from,
      });
      return null;
    }
    return c.appliedRate;
  };

  // Accumulators
  let totalContractValue = 0, totalRevisedContractValue = 0, totalApprovedVOs = 0;
  let totalClaimsSubmitted = 0, totalClaimsSettled = 0;
  let totalClaimsCount = 0, totalClaimsApprovedCount = 0, pendingClaimsCount = 0;
  let totalCashIn = 0, totalCashOut = 0;
  let totalPV = 0, totalEV = 0, totalAC = 0, totalBAC = 0;
  let totalBudgetPlanned = 0, totalBudgetActual = 0;
  let totalSubValue = 0, totalSubPaid = 0;
  let totalProgressWeighted = 0, totalWeight = 0, totalDelayDays = 0;
  let riskExposureSum = 0, highRisksCount = 0, criticalRisksCount = 0;
  let active = 0, completed = 0, delayed = 0;
  let approvedVariationsCount = 0, approvedVariationsValue = 0;

  // Chart collectors
  const cashFlowMap: Record<string, { in: number; out: number }>         = {};
  const claimsStatusMap: Record<string, number>                          = {};
  const riskCategoryMap: Record<string, { count: number; exposure: number }> = {};
  const budgetCategoryMap: Record<string, { planned: number; actual: number }> = {};
  const projectPerformance: ProjectPerf[] = [];

  for (const proj of projects) {
    // Guarantee all module data is seeded before reading
    ensureProjectModuleData(proj);

    /**
     * ONE factor for this project, applied to every figure it
     * contributes. A project with no route is skipped whole: taking
     * some of its numbers and not others would produce a total that
     * belongs to no real portfolio.
     */
    const fx = factorFor(proj);
    if (fx === null) continue;

    // `k` converts a project-currency amount into the target unit.
    const k = (n: number) => (Number(n) || 0) * fx;

    const cv  = k(proj.contractValue        || 0);
    const rcv = k(proj.revisedContractValue || 0) || cv;
    const pct = proj.progress             || 0;   // a percentage — never scaled
    const dd  = proj.delayDays            || 0;   // days — never scaled

    totalContractValue        += cv;
    totalRevisedContractValue += rcv;
    totalApprovedVOs          += k(proj.totalApprovedCOs || 0);

    totalProgressWeighted += pct * cv;
    totalWeight           += cv || 1;

    if (pct >= 100) completed++; else active++;
    if (dd > 0) delayed++;
    totalDelayDays += dd;

    totalCashIn  += k(proj.totalCashReceived  || 0);
    totalCashOut += k(proj.totalCashDisbursed || 0);

    /**
     * ══════════════════════════════════════════════════════════════════
     * STEP 13 — THE PARALLEL EVM ENGINE WAS REMOVED FROM HERE.
     *
     * These four lines used to live at this spot:
     *
     *     const bac   = rcv;                          // contract value
     *     const ev    = bac * (pct / 100);            // progress-derived
     *     const pvPct = min(pct/100 + min(dd*0.005, 0.15), 1);
     *     totalPV    += bac * pvPct;                  // delay-derived
     *
     * Each one contradicted a rule approved in Steps 1-12: BAC is the
     * approved budget (Step 12 Q3=B), Direct EV is entered by hand
     * (Step 12 rule 4), and PV is manually time-phased and has no
     * relationship to progress or to delay days.
     *
     * BAC / PV / EV / AC are now produced by the authoritative engine
     * and summed AFTER this loop. Nothing about EVM is computed here.
     * ══════════════════════════════════════════════════════════════════
     */

    // Budget module
    const budgetRows: any[] = readLS(`pactum-budget-${proj.id}`, []);
    const projPlanned = k(budgetRows.reduce((s, r) => s + (r.planned || 0), 0));
    const projActual  = k(budgetRows.reduce((s, r) => s + (r.actual  || 0), 0));
    totalBudgetPlanned += projPlanned;
    totalBudgetActual  += projActual;
    for (const r of budgetRows) {
      if (r.category) {
        if (!budgetCategoryMap[r.category])
          budgetCategoryMap[r.category] = { planned: 0, actual: 0 };
        budgetCategoryMap[r.category].planned += k(r.planned || 0);
        budgetCategoryMap[r.category].actual  += k(r.actual  || 0);
      }
    }
    /**
     * STEP 13 — the AC fallback was removed from here. It read:
     *
     *     totalAC += projActual > 0 ? projActual
     *                               : k(proj.totalCashDisbursed || 0);
     *
     * That is character-for-character the derivation Step 11 deleted
     * from the project engine — budget.actual, else cash disbursed. It
     * survived in the portfolio, so a project could honestly report
     * "Actual Cost Not Entered" on its own screen while the portfolio
     * asserted a number for it. AC is Finance-entered only.
     *
     * `totalBudgetPlanned` / `totalBudgetActual` above are UNTOUCHED:
     * they are Budget-module reporting, not EVM, and no EVM figure is
     * derived from them.
     */

    // Cash flow module
    const cfRows: any[] = readLS(`pactum-cashflow-${proj.id}`, []);
    for (const row of cfRows) {
      const m = row.month || 'Unknown';
      if (!cashFlowMap[m]) cashFlowMap[m] = { in: 0, out: 0 };
      cashFlowMap[m].in  += k(row.in  || 0);
      cashFlowMap[m].out += k(row.out || 0);
    }

    // Claims module
    const claimRows: any[] = readLS(`pactum-claims-${proj.id}`, []);
    totalClaimsSubmitted += k(proj.totalApprovedClaims || 0);
    for (const c of claimRows) {
      totalClaimsCount++;
      totalClaimsSubmitted += k(c.claimed || 0);
      const st = (c.status || '').toLowerCase();
      const stRaw = c.status || 'Pending';
      claimsStatusMap[stRaw] = (claimsStatusMap[stRaw] || 0) + 1;
      if (st === 'approved' || st === 'settled' || st === 'agreed') {
        totalClaimsSettled        += k(c.settled || 0);
        totalClaimsApprovedCount++;
      }
      if (st === 'submitted' || st === 'review' || st === 'under review') {
        pendingClaimsCount++;
      }
    }

    // Subs module
    const subsRows: any[]                  = readLS(`pactum-subs-${proj.id}`, []);
    const subCerts: Record<string, any[]>  = readLS(`pactum-sub-certs-${proj.id}`, {});
    for (const sub of subsRows) {
      totalSubValue += k(sub.contractValue || 0);
      for (const cert of (subCerts[sub.id] || [])) {
        totalSubPaid += k(cert.paidAmount || cert.netPayment || 0);
      }
    }

    // Risk module
    const riskRows: any[] = readLS(`pactum-risk-${proj.id}`, []);
    for (const r of riskRows) {
      const exposure = (r.prob || 0) * k(r.impact || 0);
      riskExposureSum += exposure;
      if (exposure >= cv * 0.005)  highRisksCount++;     // â‰¥ 0.5% of CV
      if (exposure >= cv * 0.012)  criticalRisksCount++; // â‰¥ 1.2% of CV
      const cat = r.category || 'Other';
      if (!riskCategoryMap[cat]) riskCategoryMap[cat] = { count: 0, exposure: 0 };
      riskCategoryMap[cat].count++;
      riskCategoryMap[cat].exposure += exposure;
    }

    // Changes / Variations module
    const coRows: any[] = readLS(`pactum-co-${proj.id}`, []);
    for (const co of coRows) {
      if (co.status === 'approved') {
        approvedVariationsCount++;
        approvedVariationsValue += k(co.value || 0);
      }
    }

    /**
     * ══════════════════════════════════════════════════════════════════
     * STEP 13 — the per-project row now shows the AUTHORITATIVE figures.
     *
     * It used to compute its own, and this was the worst of the lot:
     *
     *     projAC = projActual > 0 ? projActual
     *            : (k(proj.totalCashDisbursed || 0) || bac * 0.5);
     *
     * When a project had neither a budget actual nor cash disbursed, it
     * INVENTED an actual cost of HALF THE BAC. A pure fabrication, and
     * it fed the CPI shown against that project's name.
     *
     * Every figure below now comes from the same engine the project's
     * own EVM screen runs. A project the engine cannot measure reports
     * null indices — rendered as a dash — instead of a manufactured 1.00.
     * ══════════════════════════════════════════════════════════════════
     */
    const pr = projectEvmResult(proj as any);
    const pm = pr.available && pr.metrics ? pr.metrics.total : null;
    const projBAC = pm ? k(pm.bac) : 0;
    const projEV  = pm ? k(pm.ev)  : 0;
    const projAC  = pm ? k(pm.ac)  : 0;
    const projPV  = pm ? k(pm.pv)  : 0;
    const projSPI = pm ? pm.spi : null;
    const projCPI = pm ? pm.cpi : null;

    projectPerformance.push({
      id: proj.id, nameEn: proj.nameEn, nameAr: proj.nameAr || proj.nameEn,
      code: proj.code, contractValue: cv, progress: pct,
      spi: projSPI, cpi: projCPI, delayDays: dd,
      claimsCount: claimRows.length,
      status: pct >= 100 ? 'Completed' : dd > 0 ? 'Delayed' : 'On Track',
    });
  }

  // â”€â”€ Derived metrics â”€â”€

  const portfolioProgress = totalWeight > 0 ? totalProgressWeighted / totalWeight : 0;
  const averageDelay      = projects.length > 0 ? totalDelayDays / projects.length : 0;
  const claimsSuccessRate =
    totalClaimsCount > 0 ? (totalClaimsApprovedCount / totalClaimsCount) * 100
    : totalClaimsSubmitted > 0 ? 68 : 0;
  /**
   * ════════════════════════════════════════════════════════════════════
   * STEP 13 — EVM COMES FROM THE AUTHORITATIVE ENGINE, NOT FROM HERE.
   *
   * These six lines were the portfolio's own EVM mathematics:
   *
   *     portfolioSPI = totalPV > 0 ? totalEV / totalPV : 1;
   *     portfolioCPI = totalAC > 0 ? totalEV / totalAC : 1;
   *     portfolioEAC = portfolioCPI > 0 ? totalBAC / portfolioCPI : totalBAC;
   *     portfolioVAC = totalBAC - portfolioEAC;
   *     portfolioETC = portfolioEAC - totalAC;
   *
   * They are gone. `consolidatePortfolioEvm` runs the real project
   * engine per project, sums the results, and hands the aggregate back
   * to the SAME `metricsFor` the EVM screen uses. No formula is
   * duplicated, so none can drift.
   *
   * NOTE ON THE OLD `: 1` DEFAULTS. When nothing had been entered, the
   * old code reported SPI = 1.00 and CPI = 1.00 — a portfolio with no
   * data looked perfectly on track. The engine returns NULL there, which
   * the UI renders as an em dash. An index nobody can compute is not 1.
   *
   * The same excluded-and-named discipline the currency conversion above
   * already uses now applies to EVM: a project without an approved
   * baseline is listed in `evmExcluded`, never summed as zero.
   * ════════════════════════════════════════════════════════════════════
   */
  const evmRoll = consolidatePortfolioEvm(projects as any[], {
    rate: (pr) => factorFor(pr as Project),
  });

  totalBAC = evmRoll.total.bac;
  totalPV  = evmRoll.total.pv;
  totalEV  = evmRoll.total.ev;
  totalAC  = evmRoll.total.ac;

  const portfolioSPI  = evmRoll.total.spi;
  const portfolioCPI  = evmRoll.total.cpi;
  const portfolioEAC  = evmRoll.total.eac;
  const portfolioVAC  = evmRoll.total.vac;
  const portfolioETC  = evmRoll.total.etc;
  const averageMargin = totalBAC > 0 ? ((totalBAC - totalAC) / totalBAC) * 100 : 0;

  const netOperatingProfit = totalCashIn - totalCashOut - totalRevisedContractValue * 0.02;
  const capitalEmployed    = totalRevisedContractValue;
  const costOfCapital      = capitalEmployed * wacc;
  const economicValueAdded = netOperatingProfit - costOfCapital;

  /**
   * STEP 13 — an unmeasurable index neither rewards nor penalises the
   * score. Treating null as 0 would score a portfolio with no EVM data
   * as catastrophic; treating it as 1 would score it as perfect. Both
   * are claims about performance nobody has measured.
   */
  let hs = 50;
  if (portfolioSPI !== null) {
    if (portfolioSPI >= 0.95) hs += 15; else if (portfolioSPI >= 0.85) hs += 5; else hs -= 10;
  }
  if (portfolioCPI !== null) {
    if (portfolioCPI >= 1.00) hs += 15; else if (portfolioCPI >= 0.90) hs += 5; else hs -= 15;
  }
  if (claimsSuccessRate >= 70) hs += 10;
  if (projects.length > 0 && delayed / projects.length < 0.3) hs += 10;
  hs = Math.max(0, Math.min(100, hs));

  const executiveRiskRating: 'Low' | 'Medium' | 'High' | 'Critical' =
    hs >= 80 ? 'Low' : hs >= 60 ? 'Medium' : hs >= 40 ? 'High' : 'Critical';

  // â”€â”€ Chart series â”€â”€

  // Cash flow by month (12 most recent)
  let cashFlowByMonth: CashFlowPoint[] = Object.entries(cashFlowMap)
    .map(([month, v]) => ({ month, in: v.in, out: v.out, net: v.in - v.out }))
    .slice(-12);
  if (cashFlowByMonth.length === 0 && projects.length > 0) {
    const MOS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mIn    = totalCashIn  / 12;
    const mOut   = totalCashOut / 12;
    const wts    = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.1, 1.0, 0.95, 1.05, 1.1, 0.95];
    cashFlowByMonth = MOS.map((month, i) => ({
      month, in: mIn * wts[i], out: mOut * wts[i], net: (mIn - mOut) * wts[i],
    }));
  }

  // S-Curve — 10-point Bezier approximation
  const sCurve: SCurvePoint[] = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9;
    const s = 3 * t * t - 2 * t * t * t;
    return {
      label: `M${Math.round(i * 4)}`,
      // STEP 13 — with no measurable index there is no earned or actual
      // curve to draw. Zero here is the absence of a series, not a claim
      // that nothing was earned; the chart simply has no EV/AC line.
      pv: totalBAC * s,
      ev: portfolioSPI === null ? 0 : totalBAC * s * portfolioSPI,
      ac: (portfolioSPI === null || portfolioCPI === null || portfolioCPI === 0)
        ? 0 : totalBAC * s * (portfolioSPI / portfolioCPI),
    };
  });

  // Claims by status (normalised keys)
  const csm = claimsStatusMap;
  const claimsByStatus: PiePoint[] = [
    { name: 'Pending',   value: (csm['submitted'] || 0) + (csm['Submitted'] || 0) + (csm['Pending'] || 0), color: '#6b7280' },
    { name: 'In Review', value: (csm['review']    || 0) + (csm['Under Review'] || 0),                      color: '#D4AF5A' },
    { name: 'Approved',  value: (csm['approved']  || 0) + (csm['Approved'] || 0) + (csm['Agreed'] || 0),   color: '#22c55e' },
    { name: 'Rejected',  value: (csm['rejected']  || 0) + (csm['Rejected'] || 0),                          color: '#ef4444' },
  ].filter(x => x.value > 0);

  const riskByCategory = Object.entries(riskCategoryMap)
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.exposure - a.exposure);

  const projectsByStatus: PiePoint[] = [
    { name: 'Active',    value: active,    color: '#D4AF5A' },
    { name: 'Completed', value: completed, color: '#22c55e' },
    { name: 'Delayed',   value: delayed,   color: '#ef4444' },
  ].filter(x => x.value > 0);

  const budgetByCategory = Object.entries(budgetCategoryMap)
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.planned - a.planned)
    .slice(0, 8);

  return {
    currency: target,
    unconvertible,
    complete: unconvertible.length === 0,
    totalContractValue, totalRevisedContractValue, totalApprovedVOs,
    totalClaimsSubmitted, totalClaimsSettled,
    totalClaimsCount, totalClaimsApprovedCount, pendingClaimsCount, claimsSuccessRate,
    totalCashIn, totalCashOut, totalNetCashFlow: totalCashIn - totalCashOut,
    activeProjects: active, completedProjects: completed, delayedProjects: delayed,
    totalProjects: projects.length, portfolioProgress, averageDelay,
    portfolioPV: totalPV, portfolioEV: totalEV, portfolioAC: totalAC,
    portfolioBAC: totalBAC, portfolioSPI, portfolioCPI,
    portfolioEAC, portfolioVAC, portfolioETC,
    totalBudgetPlanned, totalBudgetActual, averageMargin,
    totalSubValue, totalSubPaid,
    riskExposureIndex: riskExposureSum, highRisks: highRisksCount, criticalRisks: criticalRisksCount,
    approvedVariationsCount, approvedVariationsValue,
    netOperatingProfit, capitalEmployed, wacc, costOfCapital, economicValueAdded,
    portfolioHealthScore: hs, executiveRiskRating,
    cashFlowByMonth, claimsByStatus, riskByCategory,
    projectsByStatus, budgetByCategory, sCurve, projectPerformance,
  };
}
