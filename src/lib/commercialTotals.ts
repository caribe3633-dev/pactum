import { readTransactionMoney } from './moneyEntry';
import { readCurrencySettings, readFx, convertBetween } from './currency';
import { contractCurrencyOf } from './projectCurrency';

/**
 * Commercial aggregation — currency-safe.
 * Destination: src/lib/commercialTotals.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 1 · TASK 1 — COMMERCIAL CURRENCY MIXING
 *
 * THE DEFECT, MEASURED
 *
 *   OverviewModule summed the raw `value` off every approved row:
 *
 *     approvedCOs.reduce((s, c) => s + (Number(c.value) || 0), 0)
 *
 *   and then added that to `project.contractValue`:
 *
 *     revised = contractValue + approvedCOs + approvedClaims
 *
 *   On a project whose contract is in AED under a company reporting in
 *   EUR, that produced:
 *
 *     600,000,000  (AED — stored raw, never converted)
 *     + 10,516,800 (EUR — already converted at save time)
 *     +  1,652,640 (EUR — already converted at save time)
 *     = 612,169,440
 *
 *   A number that is not a quantity of any currency. It then propagated
 *   into BAC -> EAC -> VAC -> TCPI, and into filed Timeline snapshots,
 *   where it became part of a permanent record.
 *
 * WHY THE ROWS THEMSELVES WERE ALREADY CORRECT
 *
 *   ChangesModule / ClaimsModule / CertsModule save through
 *   prepareTransaction(Group) + transactionFields(). Each row therefore
 *   already holds its amount CONVERTED into the reporting currency, plus
 *   the frozen provenance (currency, originalAmount, exchangeRate,
 *   rateEffectiveDate, rateLegIds).
 *
 *   The rows were never the problem. The BASE was: project.contractValue
 *   is entered in the project's CONTRACT currency and stored raw, with no
 *   metadata at all. Adding converted rows to an unconverted base is what
 *   mixed the units.
 *
 * THE DECISION — WHICH CURRENCY DOES THE TOTAL LIVE IN
 *
 *   Reporting currency. Not the contract currency.
 *
 *   Chosen because it is what the codebase ALREADY does everywhere else:
 *   every module stores converted amounts in its amount field and
 *   displays them with `{ currency: money.base }`. Making the total obey
 *   the opposite rule would mean converting fifty correct rows backwards
 *   to match one incorrect base.
 *
 *   The trade-off is stated plainly: a company that changes its reporting
 *   currency changes the unit these totals are expressed in. That is
 *   already true of every stored transaction amount in the platform, so
 *   this introduces no new behaviour — and `reportingCurrency` is
 *   returned alongside every total so a caller can never mislabel it.
 *
 * HISTORY IS NOT TOUCHED
 *
 *   Nothing is rewritten. `readTransactionMoney` reads each row exactly
 *   as it was filed and uses the rate frozen on it. A row with no
 *   currency metadata is treated as having been captured in the contract
 *   currency at rate 1 — the platform's existing documented assumption,
 *   not a new one invented here.
 * ══════════════════════════════════════════════════════════════════════
 */

/** One aggregated commercial figure, with the unit it is expressed in. */
export interface CommercialTotals {
  /** Original contract, converted into the reporting currency. */
  originalContract: number;
  /** Sum of APPROVED change-order values. */
  approvedChangeOrders: number;
  /** Sum of APPROVED claim settlements. */
  approvedClaims: number;
  /** originalContract + approvedChangeOrders + approvedClaims. */
  revisedContract: number;
  /** The currency every figure above is expressed in. */
  reportingCurrency: string;
  /** The project's contract currency, for display of the original. */
  contractCurrency: string;
  /**
   * Rate used to bring `project.contractValue` into the reporting
   * currency. 1 when the two currencies match.
   */
  contractRate: number;
  /**
   * False when the contract currency could not be converted on the
   * commencement date. Totals still return, but a caller that reports
   * money should say so rather than print a confident wrong number.
   */
  resolved: boolean;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Sums one set of rows in the reporting currency.
 *
 * Each row is read through `readTransactionMoney`, which returns the
 * converted value together with the rate frozen at save time. No rate is
 * looked up here, so calling this a year later returns the same answer.
 */
export function sumInReporting(
  rows: any[], amountField: string,
  contractCurrency: string, reportingCurrency: string,
): number {
  return rows.reduce((sum, row) => {
    const m = readTransactionMoney(row, amountField, contractCurrency, reportingCurrency);
    return sum + num(m.reportingCurrencyValue);
  }, 0);
}

/**
 * Every commercial total for one project, in one currency.
 *
 * `project` is passed in rather than re-read so the caller's in-memory
 * edits (an un-saved contract value, say) are respected.
 */
export function commercialTotals(
  project: { id: string; contractValue?: number; commencementDate?: string },
  companyId: string,
): CommercialTotals {
  const id = project.id;
  /**
   * PROJECT TOTALS ARE EXPRESSED IN THE CONTRACT CURRENCY.
   *
   * This read used to be `readCurrencySettings(companyId).baseCurrency`
   * — the COMPANY reporting currency — which meant a SAR project under
   * an AED company reported its Contract Amount, approved COs and
   * approved claims in AED on every screen that consumes this function
   * (Overview, Baselines, the certification seed).
   *
   * A project's commercial position is a fact about the CONTRACT, so it
   * is stated in the contract's own unit. Rolling several projects into
   * one company or portfolio figure is a separate operation, and it is
   * that operation's job to convert — see `companyPortfolio.ts`.
   *
   * `reportingCurrency` keeps its name: it is the unit the returned
   * totals are reported in, and every caller already reads it to label
   * the figures. Its VALUE is now the contract currency.
   */
  const companyReportingCurrency = readCurrencySettings(companyId).baseCurrency;
  const contractCurrency = contractCurrencyOf(id, companyReportingCurrency);
  const reportingCurrency = contractCurrency;

  // ── The base, converted ──
  // project.contractValue is entered in the CONTRACT currency and stored
  // raw. It is the only figure in this calculation that has no frozen
  // rate of its own, so it is converted here — at the commencement date,
  // which is when the contract was struck.
  const rawContract = num(project.contractValue);
  let contractRate = 1;
  let resolved = true;

  if (contractCurrency.toUpperCase() !== reportingCurrency.toUpperCase()) {
    // Reuse the row reader rather than a second conversion path, so the
    // base and the rows can never disagree about what a rate means.
    const probe = readTransactionMoney(
      {
        [`__amt`]: rawContract,
        currency: contractCurrency,
        reportingCurrency,
        transactionDate: project.commencementDate ?? '',
      },
      '__amt', contractCurrency, reportingCurrency,
    );
    // A row carrying `currency` but no stored `exchangeRate` cannot be
    // resolved from itself; fall back to a live lookup on the
    // commencement date.
    if (probe.exchangeRateSnapshot > 0 && probe.rateSource !== 'identity') {
      contractRate = probe.exchangeRateSnapshot;
    } else {
      const live = convertContract(
        companyId, id, rawContract, contractCurrency,
        reportingCurrency, project.commencementDate ?? '',
      );
      contractRate = live.rate;
      resolved = live.resolved;
    }
  }

  const originalContract = rawContract * contractRate;

  // ── The rows, already converted at save time ──
  const cos: any[] = readJson(`pactum-co-${id}`, []);
  const claims: any[] = readJson(`pactum-claims-${id}`, []);

  const approvedChangeOrders = sumInReporting(
    cos.filter(c => (c.status || '') === 'approved'),
    'value', contractCurrency, reportingCurrency,
  );
  const approvedClaims = sumInReporting(
    claims.filter(c => (c.status || '') === 'approved'),
    'settled', contractCurrency, reportingCurrency,
  );

  return {
    originalContract,
    approvedChangeOrders,
    approvedClaims,
    revisedContract: originalContract + approvedChangeOrders + approvedClaims,
    reportingCurrency,
    contractCurrency,
    contractRate,
    resolved,
  };
}

/**
 * Live rate lookup for the contract base only.
 *
 * Isolated in its own function because it is the ONE conversion in this
 * file that is not read off a frozen row. It runs against the
 * commencement date, never today, so the answer does not drift.
 */
function convertContract(
  companyId: string, projectId: string, amount: number,
  from: string, to: string, onDate: string,
): { rate: number; resolved: boolean } {
  if (!amount || from.toUpperCase() === to.toUpperCase()) {
    return { rate: 1, resolved: true };
  }
  try {
    const store = readFx(companyId);
    const r = convertBetween(store, amount, from, to, onDate, projectId);
    if (r && r.resolved && r.appliedRate > 0) {
      return { rate: r.appliedRate, resolved: true };
    }
  } catch {
    /* fall through to unresolved */
  }
  // No route on that date. Returning rate 1 would silently understate the
  // contract; the caller is told instead.
  return { rate: 1, resolved: false };
}
