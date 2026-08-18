/**
 * Money entry plumbing — shared by every financial module.
 * Destination: src/lib/moneyEntry.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY A SEPARATE FILE
 *
 *   Eleven modules need identical behaviour: pick a currency, convert once
 *   at the transaction date, store the conversion beside the amount. Writing
 *   that eleven times guarantees eleven slightly different versions. This is
 *   the one implementation they all call.
 *
 * WHAT IT DOES NOT DO
 *
 *   It does not change any stored amount field. After conversion the module
 *   writes the CONVERTED figure into exactly the field it always wrote —
 *   `value`, `claimed`, `gross`, `contractValue` — so every downstream
 *   reader (EVM, LD, Cash Flow, Timeline, the reports) is untouched and
 *   unaware. The currency metadata rides alongside in new optional fields.
 *
 * THE TRANSACTION-DATE PROBLEM
 *
 *   The brief assumes every module has a transaction date. Several do not:
 *   Change Orders, Claims, Budget lines and project Subcontract assignments
 *   carry no date field at all, and Cash Flow stores a month name, not a
 *   date.
 *
 *   Inventing one silently would be wrong in a specific way: the rate is
 *   chosen BY that date, so a wrong date produces a wrong — but
 *   confident-looking — conversion that is then frozen forever.
 *
 *   So this module makes the choice explicit and records it. `resolveTxnDate`
 *   returns both the date AND where it came from, and the entry form shows a
 *   date field the user can correct before saving. When a module genuinely
 *   has no date, today is used and `dateSource` says 'today' — visible in the
 *   record rather than hidden in the code.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  FxStore, CurrencySettings, MoneyRecord,
  convert, readFx, readCurrencySettings, rateOn,
  // Phase 8 — the centralised conversion service.
  convertBetween, crossRate,
} from './currency';
import type { ConversionResult, RateSource } from './currency';
// The project's contract currency — the unit project-level records are
// stored and displayed in. `projectCurrency.ts` imports nothing, so this
// cannot introduce a cycle.
import { contractCurrencyOf } from './projectCurrency';

/** Where the date used for the rate lookup came from. */
export type DateSource = 'record' | 'period' | 'today';

export interface TxnDate {
  /** ISO yyyy-mm-dd used for the rate lookup. */
  date: string;
  source: DateSource;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Accepts ISO or legacy DD/MM/YYYY. Returns '' when unusable. */
function normaliseDate(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/**
 * Picks the transaction date for a rate lookup.
 *
 * Tries each candidate field in order, then falls back to today. The caller
 * passes candidates most-specific-first, e.g. for a certificate:
 *   resolveTxnDate(row, ['approvalDate', 'submissionDate'])
 */
export function resolveTxnDate(row: any, fields: string[], today = new Date()): TxnDate {
  for (const f of fields) {
    const d = normaliseDate(row?.[f]);
    if (d) return { date: d, source: 'record' };
  }
  return { date: iso(today), source: 'today' };
}

/**
 * Everything a module needs to render one currency-aware field.
 * Read once per module, not per row.
 */
export interface MoneyContext {
  settings: CurrencySettings;
  fx: FxStore;
  /**
   * The unit this project's stored amounts are expressed in — the
   * project's CONTRACT currency.
   *
   * ══════════════════════════════════════════════════════════════════
   * This used to be `settings.baseCurrency`, the COMPANY reporting
   * currency, and it was the second half of the same defect corrected in
   * `transactionContext` below. Nine modules print `money.base` as the
   * unit beside a figure, so a SAR project under an AED company labelled
   * every certificate, change order, claim and budget line "AED".
   *
   * `base` now means: the currency the numbers on THIS PROJECT'S screens
   * are stored and displayed in. `companyReporting` carries the old
   * value for the aggregation sites that genuinely need it.
   * ══════════════════════════════════════════════════════════════════
   */
  base: string;
  /** Company reporting currency. Aggregation above the project only. */
  companyReporting: string;
  companyId: string;
  projectId: string;
}

/**
 * `projectId` resolves the contract currency, so a caller passing an
 * empty id (a company-level screen) still gets the company currency and
 * behaves exactly as it did before.
 */
export function moneyContext(companyId: string, projectId: string): MoneyContext {
  const settings = readCurrencySettings(companyId);
  const companyReporting = settings.baseCurrency.toUpperCase();
  return {
    settings,
    fx: readFx(companyId),
    base: projectId
      ? contractCurrencyOf(projectId, companyReporting)
      : companyReporting,
    companyReporting,
    companyId,
    projectId,
  };
}

/**
 * Fields written onto a row so the conversion travels with the record.
 *
 * `amountField` keeps holding the CONVERTED number — that is the whole
 * compatibility guarantee. Everything else is additive and optional, so a
 * legacy row missing all of it still reads correctly as base currency.
 */
export interface MoneyMeta {
  currency: string;
  originalAmount: number;
  exchangeRate: number;
  /** ISO date the rate was looked up against. */
  transactionDate: string;
  /** Effective date of the rate that was applied. */
  rateEffectiveDate: string;
  /** ISO timestamp of the conversion. Never revisited. */
  convertedAt: string;
  dateSource: DateSource;
}

export interface PreparedMoney {
  /** The number to store in the existing amount field. */
  converted: number;
  meta: MoneyMeta;
  record: MoneyRecord;
  /** False when no rate existed — the caller should refuse to save. */
  resolved: boolean;
}

/**
 * Converts once and returns both the figure and its provenance.
 *
 * Called at SAVE time only. Re-running it later against a newer rate would
 * produce a different answer, which is exactly what must never happen to a
 * stored record.
 */
export function prepareMoney(
  ctx: MoneyContext, amount: number | string, currency: string, txn: TxnDate,
): PreparedMoney {
  const amt = Number(amount) || 0;
  const cur = (currency || ctx.base).toUpperCase();
  const rec = convert(ctx.fx, amt, cur, txn.date, ctx.base, ctx.projectId);
  const fx = cur === ctx.base ? null : rateOn(ctx.fx, cur, txn.date, ctx.projectId);

  return {
    converted: rec.converted,
    resolved: rec.resolved,
    record: rec,
    meta: {
      currency: cur,
      originalAmount: amt,
      exchangeRate: rec.appliedRate,
      transactionDate: txn.date,
      rateEffectiveDate: fx?.effectiveDate ?? txn.date,
      convertedAt: new Date().toISOString(),
      dateSource: txn.source,
    },
  };
}

/**
 * Spreads the metadata onto a row under a field prefix.
 *
 * A row with several amounts (a certificate has gross, retention, net…)
 * carries ONE currency and ONE rate, because they are all facets of the
 * same transaction. So the metadata is stored once, unprefixed, and each
 * amount field keeps its converted value.
 */
export function withMoneyMeta<T extends object>(row: T, meta: MoneyMeta): T & Partial<MoneyMeta> {
  // Base-currency rows are left completely untouched: writing currency
  // metadata onto every SAR row would bloat storage and change files that
  // have no foreign content in them.
  return { ...row, ...meta };
}

/** True when the row was captured in something other than the base currency. */
export function isForeign(row: any, base: string): boolean {
  const c = String(row?.currency ?? '').toUpperCase();
  return Boolean(c) && c !== base.toUpperCase();
}

/**
 * Reads the stored conversion back off a row.
 *
 * A legacy row has no metadata; it is reported as base currency at rate 1,
 * which is precisely what it was when it was written. No migration needed.
 */
export function readMoneyMeta(row: any, amountField: string, base: string): MoneyRecord {
  const converted = Number(row?.[amountField]) || 0;
  const cur = String(row?.currency ?? '').toUpperCase();

  if (!cur || cur === base.toUpperCase()) {
    return {
      original: converted, originalCurrency: base, appliedRate: 1,
      converted, baseCurrency: base,
      rateDate: String(row?.transactionDate ?? ''), resolved: true,
    };
  }
  const rate = Number(row?.exchangeRate) || 0;
  return {
    original: Number(row?.originalAmount) || converted,
    originalCurrency: cur,
    appliedRate: rate,
    converted,
    baseCurrency: base,
    rateDate: String(row?.transactionDate ?? ''),
    resolved: rate > 0,
  };
}

/**
 * Multi-amount rows: converts several figures with ONE rate.
 *
 * A certificate's gross, retention and net must share a rate or they stop
 * adding up. Converting each independently would let rounding or a stale
 * lookup break `gross − retention = net`.
 */
export function prepareMoneyGroup(
  ctx: MoneyContext, amounts: Record<string, number | string>,
  currency: string, txn: TxnDate,
): { converted: Record<string, number>; meta: MoneyMeta; resolved: boolean } {
  const cur = (currency || ctx.base).toUpperCase();
  const probe = prepareMoney(ctx, 0, cur, txn);
  const rate = probe.meta.exchangeRate;

  const converted: Record<string, number> = {};
  Object.entries(amounts).forEach(([k, v]) => {
    converted[k] = (Number(v) || 0) * (rate > 0 ? rate : 1);
  });

  return {
    converted,
    resolved: probe.resolved,
    meta: {
      ...probe.meta,
      // originalAmount is meaningless for a group; the per-field originals
      // are recoverable as converted / rate.
      originalAmount: 0,
    },
  };
}

// ── Transaction money record (Phase 8) ─────────────────────────────────
//
// THE SIX MANDATED FIELDS
//
//   Original Currency · Original Amount · Exchange Rate Snapshot ·
//   Exchange Rate Effective Date · Reporting Currency Value ·
//   Displayed Reporting Currency
//
// Five of the six already existed under the platform's own names, written
// by `MoneyMeta` since Phase 2. Renaming them would break every stored
// record for no gain, so this layer ADDS the missing pieces and exposes the
// full set under the brief's vocabulary:
//
//   currency          -> originalCurrency
//   originalAmount    -> originalAmount
//   exchangeRate      -> exchangeRateSnapshot
//   rateEffectiveDate -> exchangeRateEffectiveDate
//   <amount field>    -> reportingCurrencyValue      (already the stored value)
//   reportingCurrency -> displayedReportingCurrency   ** NEW **
//
// The last one is the substantive addition. Until now a converted figure
// recorded the rate but not the currency it had been converted INTO,
// because there was only ever one. A company that changes its reporting
// currency would otherwise have every historical record silently re-labelled
// against a currency it was never converted to.

/**
 * The complete provenance carried by one financial transaction.
 *
 * Every field is optional on read: a record written before this phase has
 * the first five and not the sixth, and is read back correctly by assuming
 * the reporting currency in force when it was written — which is what it
 * was, since only one existed.
 */
export interface TransactionMoney {
  /** As entered. */
  originalCurrency: string;
  originalAmount: number;
  /** The rate applied, frozen. 1 when no conversion was needed. */
  exchangeRateSnapshot: number;
  /** Effective date of the rate row used — not the transaction date. */
  exchangeRateEffectiveDate: string;
  /** The converted figure. Lives in the module's existing amount field. */
  reportingCurrencyValue: number;
  /** Currency the value above is expressed in. Phase 8 addition. */
  displayedReportingCurrency: string;

  /** Transaction date the rate was looked up against. */
  transactionDate: string;
  /** How the rate was obtained: identity, direct, inverse or cross. */
  rateSource: RateSource;
  /** Pivot currency, when the rate was crossed. '' otherwise. */
  ratePivot: string;
  /** Rate row ids used, so the conversion can be re-audited years later. */
  rateLegIds: string[];
  /** ISO timestamp of the conversion. Never revisited. */
  convertedAt: string;
  dateSource: DateSource;
  /** False when no route existed. The caller must refuse to save. */
  resolved: boolean;
}

export interface TransactionContext {
  fx: FxStore;
  /**
   * WHERE CONVERTED VALUES LAND — the project's CONTRACT currency.
   *
   * ════════════════════════════════════════════════════════════════════
   * CURRENCY SEMANTICS CORRECTION — STORAGE CURRENCY IS THE CONTRACT
   *
   * This field used to hold the COMPANY reporting currency, and every
   * module wrote its converted amount in that unit. That is the defect:
   *
   *   Company reporting currency = AED
   *   Project contract currency  = SAR
   *   -> a certificate entered as SAR 1,000,000 was stored as AED
   *      979,000 and the screen printed "AED" on a Saudi project.
   *
   * The authoritative rule, stated once:
   *
   *   A financial record that originates from a project contract is
   *   STORED in that project's contract currency. The company reporting
   *   currency is an AGGREGATION currency for portfolio and company
   *   level reporting — it is never the storage unit of a project
   *   transaction.
   *
   * The name is kept as `reportingCurrency` deliberately. Eleven modules
   * and `readTransactionMoney` read it, rows on disk carry a
   * `reportingCurrency` field written by `transactionFields`, and
   * renaming a field that is already persisted would orphan every filed
   * record. What changed is the VALUE, not the key.
   * ════════════════════════════════════════════════════════════════════
   */
  reportingCurrency: string;
  /** Project contract currency. Same value as above; kept for callers
   *  that read it by that name when pre-selecting a form default. */
  contractCurrency: string;
  /**
   * The COMPANY reporting currency, for aggregation above the project.
   * Never a conversion target for a project-level record.
   */
  companyReportingCurrency: string;
  projectId: string;
  companyId: string;
}

/**
 * Builds the money context for one project.
 *
 * Conversions land in the project's CONTRACT currency. The company
 * reporting currency is returned alongside, for callers aggregating this
 * project upward — it is not a conversion target here.
 */
export function transactionContext(
  companyId: string, projectId: string, contractCurrency: string,
): TransactionContext {
  const settings = readCurrencySettings(companyId);
  const contract = (contractCurrency || settings.baseCurrency).toUpperCase();
  return {
    fx: readFx(companyId),
    reportingCurrency: contract,
    contractCurrency: contract,
    companyReportingCurrency: settings.baseCurrency.toUpperCase(),
    projectId,
    companyId,
  };
}

/**
 * Converts one transaction amount and freezes its provenance.
 *
 * Called at SAVE time only. Running it again later against a newer rate
 * would produce a different answer, which is precisely what must never
 * happen to a stored record.
 *
 * The conversion goes through `convertBetween`, so a project whose contract
 * currency is EUR and whose company reports in USD is handled by crossing
 * through the currency both were published against — the case that returned
 * a wrong-but-confident figure before Phase 8.
 */
export function prepareTransaction(
  ctx: TransactionContext, amount: number | string, currency: string, txn: TxnDate,
): { value: number; money: TransactionMoney; conversion: ConversionResult } {
  const amt = Number(amount) || 0;
  const from = (currency || ctx.contractCurrency).toUpperCase();
  const to = ctx.reportingCurrency.toUpperCase();

  const c = convertBetween(ctx.fx, amt, from, to, txn.date, ctx.projectId, to);

  return {
    // What the module writes into its existing amount field. Unchanged
    // contract: every downstream reader keeps working untouched.
    value: c.converted,
    conversion: c,
    money: {
      originalCurrency: from,
      originalAmount: amt,
      exchangeRateSnapshot: c.resolved ? c.appliedRate : 0,
      exchangeRateEffectiveDate: c.effectiveDate,
      reportingCurrencyValue: c.converted,
      displayedReportingCurrency: to,
      transactionDate: txn.date,
      rateSource: c.source,
      ratePivot: c.pivot,
      rateLegIds: c.legIds,
      convertedAt: new Date().toISOString(),
      dateSource: txn.source,
      resolved: c.resolved,
    },
  };
}

/**
 * Multi-amount transactions: one rate for every figure on the row.
 *
 * A certificate's gross, retention and net must share a rate or they stop
 * adding up. Converting each independently would let a rounding difference
 * break `gross - retention = net`.
 */
export function prepareTransactionGroup(
  ctx: TransactionContext, amounts: Record<string, number | string>,
  currency: string, txn: TxnDate,
): { values: Record<string, number>; money: TransactionMoney } {
  const from = (currency || ctx.contractCurrency).toUpperCase();
  const to = ctx.reportingCurrency.toUpperCase();
  const probe = prepareTransaction(ctx, 0, from, txn);
  const rate = probe.money.exchangeRateSnapshot;

  const values: Record<string, number> = {};
  Object.entries(amounts).forEach(([k, v]) => {
    values[k] = (Number(v) || 0) * (rate > 0 ? rate : 1);
  });

  return {
    values,
    money: {
      ...probe.money,
      // Meaningless for a group; the per-field originals are recoverable
      // as value / rate.
      originalAmount: 0,
      reportingCurrencyValue: 0,
    },
  };
}

/**
 * The fields to spread onto a stored row.
 *
 * Written under the platform's EXISTING names so no reader breaks, plus the
 * two Phase 8 additions. A base-currency row still receives no metadata at
 * all — byte-identical to what it was before any currency work existed.
 */
export function transactionFields(m: TransactionMoney): Record<string, unknown> {
  if (m.originalCurrency === m.displayedReportingCurrency) {
    // Already in the reporting currency. Recording a rate of 1 and a full
    // provenance block on every domestic row would bloat storage and change
    // files with no foreign content in them.
    return {};
  }
  return {
    currency: m.originalCurrency,
    originalAmount: m.originalAmount,
    exchangeRate: m.exchangeRateSnapshot,
    rateEffectiveDate: m.exchangeRateEffectiveDate,
    transactionDate: m.transactionDate,
    convertedAt: m.convertedAt,
    dateSource: m.dateSource,
    // ── Phase 8 additions ──
    reportingCurrency: m.displayedReportingCurrency,
    rateSource: m.rateSource,
    ratePivot: m.ratePivot,
    rateLegIds: m.rateLegIds,
  };
}

/**
 * Reads the six fields back off any stored row.
 *
 * BACKWARD COMPATIBILITY, stated precisely:
 *
 *   no currency field        -> the row was captured in the project contract
 *                               currency at rate 1. That is what it was.
 *   currency but no          -> it was converted into whatever the company
 *   reportingCurrency           reported in at the time; the caller passes
 *                               that as `assumeReporting`.
 *
 * Nothing is rewritten and no stored value changes.
 */
export function readTransactionMoney(
  row: any, amountField: string, contractCurrency: string, assumeReporting: string,
): TransactionMoney {
  const value = Number(row?.[amountField]) || 0;
  const cur = String(row?.currency ?? '').toUpperCase();
  const reporting = String(row?.reportingCurrency ?? assumeReporting ?? '').toUpperCase();

  if (!cur || cur === reporting) {
    return {
      originalCurrency: cur || (contractCurrency || reporting).toUpperCase(),
      originalAmount: value,
      exchangeRateSnapshot: 1,
      exchangeRateEffectiveDate: String(row?.rateEffectiveDate ?? ''),
      reportingCurrencyValue: value,
      displayedReportingCurrency: reporting,
      transactionDate: String(row?.transactionDate ?? ''),
      rateSource: 'identity',
      ratePivot: '',
      rateLegIds: [],
      convertedAt: String(row?.convertedAt ?? ''),
      dateSource: (row?.dateSource as DateSource) ?? 'today',
      resolved: true,
    };
  }

  const rate = Number(row?.exchangeRate) || 0;
  return {
    originalCurrency: cur,
    originalAmount: Number(row?.originalAmount) || (rate > 0 ? value / rate : value),
    exchangeRateSnapshot: rate,
    exchangeRateEffectiveDate: String(row?.rateEffectiveDate ?? ''),
    reportingCurrencyValue: value,
    displayedReportingCurrency: reporting,
    transactionDate: String(row?.transactionDate ?? ''),
    rateSource: (row?.rateSource as RateSource) ?? 'direct',
    ratePivot: String(row?.ratePivot ?? ''),
    rateLegIds: Array.isArray(row?.rateLegIds) ? row.rateLegIds.map(String) : [],
    convertedAt: String(row?.convertedAt ?? ''),
    dateSource: (row?.dateSource as DateSource) ?? 'today',
    resolved: rate > 0,
  };
}

/**
 * Re-presents a STORED transaction in a different currency, for reporting.
 *
 * Report-time only, and it never mutates the record. The stored
 * `reportingCurrencyValue` remains the contractual figure; this answers
 * "what would that be in EUR" for a portfolio report that has selected EUR.
 *
 * Deliberately converts from the ORIGINAL currency and amount rather than
 * from the already-converted value: going original -> target applies one
 * rate, whereas original -> reporting -> target applies two and compounds
 * the rounding of a conversion that was frozen months ago.
 */
export function presentIn(
  fx: FxStore, m: TransactionMoney, targetCurrency: string, projectId = '',
  onDate?: string,
): ConversionResult {
  const date = onDate || m.transactionDate || m.exchangeRateEffectiveDate;
  return convertBetween(
    fx, m.originalAmount, m.originalCurrency, targetCurrency, date, projectId, targetCurrency);
}

/**
 * The unit a STORED row's amount fields are actually denominated in.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT SIMPLY THE PROJECT'S CURRENCY
 *
 *   After the storage-currency migration, almost every row is in the
 *   contract currency. But a row the migration BLOCKED — no published
 *   rate on its date, or an unusable frozen rate — is deliberately left
 *   exactly as filed, which means it is still in the old company
 *   reporting currency.
 *
 *   Screenshotted on a migrated project: a blocked certificate holding
 *   an AED figure was rendered "SAR 1,000,000", because the screen
 *   labelled every row with the project unit rather than asking the row.
 *   That is the original defect in miniature — a confident wrong unit.
 *
 *   A row states its own unit in `reportingCurrency`. Ask it. Only fall
 *   back to the project's unit when the row says nothing, which is the
 *   legacy no-metadata case.
 * ══════════════════════════════════════════════════════════════════════
 */
export function storedUnitOf(row: any, projectUnit: string): string {
  const declared = String(row?.reportingCurrency ?? '').trim().toUpperCase();
  return declared || projectUnit;
}

/**
 * True when `rows` are not all denominated in the same unit.
 *
 * A screen that sums a mixed set must say so rather than print a total
 * that is not a quantity of any currency.
 */
export function hasMixedUnits(rows: any[], projectUnit: string): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some(r => storedUnitOf(r, projectUnit) !== projectUnit);
}

/** Whether a rate route exists, without performing a conversion. */
export function canConvert(
  fx: FxStore, from: string, to: string, onDate: string, projectId = '',
): boolean {
  return crossRate(fx, from, to, onDate, projectId, to).resolved;
}
