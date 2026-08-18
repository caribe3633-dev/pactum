import { readCompanies, readSectors, findSectorById, findCompanyById } from './masterData';
import { readCurrencySettings } from './currency';

/**
 * The three-tier currency architecture.
 * Destination: src/lib/currencyArchitecture.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 2 — CURRENCY ARCHITECTURE
 *
 *   Company   Default Reporting Currency
 *      |
 *      v  inherits
 *   Sector    (no currency of its own — a DEFAULT only)
 *      |
 *      v
 *   Project   Base Contract Currency
 *             Reporting Currency
 *             Working Currency
 *
 * WHAT EXISTED, AND WHAT DID NOT
 *
 *   Company.reportingCurrency        existed
 *   Sector.defaultContractCurrency   existed (a default, correctly)
 *   Project contract currency        existed, in `pactum-project-currency`
 *   Project REPORTING currency       DID NOT EXIST — always re-derived
 *                                    from the company, so a project could
 *                                    not state the currency it actually
 *                                    reports in
 *   Project WORKING currency         DID NOT EXIST AT ALL
 *
 * WHY A PROJECT NEEDS ITS OWN REPORTING CURRENCY
 *
 *   Deriving it live from the company means changing the company silently
 *   restates every project beneath it. Sprint 1's report named that
 *   trade-off explicitly. Storing the project's reporting currency at
 *   creation makes the inheritance a DEFAULT rather than a permanent
 *   link — the chain still flows downward, but a stored value can no
 *   longer be rewritten from above.
 *
 * WHAT EACH OF THE THREE MEANS
 *
 *   base / contract   the currency of the SIGNED CONTRACT. Fixed for the
 *                     life of the project. Every commercial record is
 *                     entered in it by default.
 *   reporting         the currency this project's own totals are
 *                     expressed in. Defaults to the company's, and Sprint
 *                     1's conversions land here.
 *   working           the currency of DAY-TO-DAY site spend — wages,
 *                     local suppliers. Frequently the host country's
 *                     currency while the contract is in USD or EUR.
 *                     Recorded for context and for defaulting cost entry;
 *                     it is NOT a conversion target for reporting.
 *
 * NOTHING IS RE-DERIVED AT READ TIME
 *
 *   `resolveProjectCurrencies` reads what was stored. Inheritance is
 *   applied only when a value is ABSENT, which is the legacy case, and
 *   the result says which tier answered so a caller can tell a stored
 *   decision from an inherited fallback.
 * ══════════════════════════════════════════════════════════════════════
 */

const KEY = 'pactum-project-currency-config';

/** Where a resolved currency actually came from. */
export type CurrencyOrigin = 'project' | 'sector' | 'company' | 'fallback';

/** The three currencies of one project, plus their provenance. */
export interface ProjectCurrencyConfig {
  projectId: string;
  /** Currency of the signed contract. Fixed for the project's life. */
  baseCurrency: string;
  /** Currency this project's totals are expressed in. */
  reportingCurrency: string;
  /** Currency of day-to-day site spend. Defaults to base. */
  workingCurrency: string;
  setBy: string;
  setAt: string;
  reason: string;
}

export interface ResolvedCurrencies {
  baseCurrency: string;
  reportingCurrency: string;
  workingCurrency: string;
  /** Which tier supplied each value. */
  origin: {
    base: CurrencyOrigin;
    reporting: CurrencyOrigin;
    working: CurrencyOrigin;
  };
  /** True when all three were read from a stored project config. */
  explicit: boolean;
}

export type CurrencyConfigStore = Record<string, ProjectCurrencyConfig>;

const CODE = /^[A-Za-z]{3}$/;

/** Last-resort currency when nothing anywhere states one. */
export const FALLBACK_CURRENCY = 'SAR';

function norm(v: unknown): string {
  return String(v ?? '').trim().toUpperCase().slice(0, 3);
}

export function isValidCurrency(v: unknown): boolean {
  return CODE.test(String(v ?? '').trim());
}

// ── Storage ────────────────────────────────────────────────────────────

export function readCurrencyConfigs(): CurrencyConfigStore {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return {};
    const out: CurrencyConfigStore = {};
    Object.entries(raw).forEach(([id, v]: [string, any]) => {
      const base = norm(v?.baseCurrency);
      if (!base) return;
      out[id] = {
        projectId: String(v?.projectId ?? id),
        baseCurrency: base,
        // A legacy row may carry only a base; the others fall back to it
        // rather than to a guess about the company.
        reportingCurrency: norm(v?.reportingCurrency) || base,
        workingCurrency: norm(v?.workingCurrency) || base,
        setBy: String(v?.setBy ?? ''),
        setAt: String(v?.setAt ?? ''),
        reason: String(v?.reason ?? ''),
      };
    });
    return out;
  } catch {
    return {};
  }
}

function writeConfigs(store: CurrencyConfigStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch { /* quota — same policy as every other store */ }
}

// ── The inheritance chain ──────────────────────────────────────────────

/**
 * The company's reporting currency.
 *
 * Reads the registry FIRST and the FX settings second. That order is
 * deliberate: the create-company wizard writes `reportingCurrency` onto
 * the registry, while `pactum-currency-{id}` is only written when someone
 * opens Currency Management. Reading settings first is what made a
 * EUR company report as SAR.
 */
export function companyReportingCurrency(companyId: string): string {
  if (!companyId) return '';
  const c = findCompanyById(companyId);
  const fromRegistry = norm((c as any)?.reportingCurrency);
  if (fromRegistry) return fromRegistry;
  try {
    return norm(readCurrencySettings(companyId).baseCurrency);
  } catch {
    return '';
  }
}

/**
 * The default contract currency a NEW project in this sector should get.
 *
 * Sector -> Company -> fallback. The sector value is a default for the
 * form, never a conversion input: once a project exists its own base
 * currency governs, and editing the sector cannot restate it.
 */
export function inheritedContractCurrency(sectorId: string): {
  currency: string; origin: CurrencyOrigin;
} {
  const sector = findSectorById(sectorId);
  const own = norm(sector?.defaultContractCurrency);
  if (own) return { currency: own, origin: 'sector' };

  const fromCompany = sector ? companyReportingCurrency(sector.companyId) : '';
  if (fromCompany) return { currency: fromCompany, origin: 'company' };

  return { currency: FALLBACK_CURRENCY, origin: 'fallback' };
}

/**
 * Resolves all three currencies for one project.
 *
 * A stored config wins outright. Only when one is missing does the chain
 * run, and `origin` reports which tier answered — so a screen can show
 * "inherited from company" rather than implying the project chose it.
 */
export function resolveProjectCurrencies(
  projectId: string, sectorId?: string, companyId?: string,
): ResolvedCurrencies {
  const cfg = readCurrencyConfigs()[projectId];

  if (cfg) {
    return {
      baseCurrency: cfg.baseCurrency,
      reportingCurrency: cfg.reportingCurrency,
      workingCurrency: cfg.workingCurrency,
      origin: { base: 'project', reporting: 'project', working: 'project' },
      explicit: true,
    };
  }

  // ── Legacy path ──
  // No config. Fall back to the older single-currency store, then to the
  // inheritance chain. Nothing is written here: a read must never create
  // a record, or opening a screen would silently author master data.
  let base = '';
  let baseOrigin: CurrencyOrigin = 'fallback';
  try {
    const legacy = JSON.parse(localStorage.getItem('pactum-project-currency') || 'null');
    const c = norm(legacy?.[projectId]?.contractCurrency);
    if (c) { base = c; baseOrigin = 'project'; }
  } catch { /* ignore */ }

  if (!base && sectorId) {
    const inh = inheritedContractCurrency(sectorId);
    base = inh.currency;
    baseOrigin = inh.origin;
  }

  const companyCcy = companyId ? companyReportingCurrency(companyId) : '';
  const reporting = companyCcy || base || FALLBACK_CURRENCY;
  if (!base) base = reporting;

  return {
    baseCurrency: base,
    reportingCurrency: reporting,
    // Working defaults to the contract currency: absent any statement to
    // the contrary, a project spends in what it is paid in.
    workingCurrency: base,
    origin: {
      base: baseOrigin,
      reporting: companyCcy ? 'company' : 'fallback',
      working: baseOrigin,
    },
    explicit: false,
  };
}

// ── Mutation ───────────────────────────────────────────────────────────

export type CurrencyConfigReason =
  | 'missing-project'
  | 'missing-base'
  | 'missing-reporting'
  | 'invalid-currency'
  | 'not-found';

export interface CurrencyConfigResult {
  ok: boolean;
  reason?: CurrencyConfigReason;
  record?: ProjectCurrencyConfig;
  /** The field that failed, so a form can highlight it. */
  field?: 'baseCurrency' | 'reportingCurrency' | 'workingCurrency';
}

/**
 * Writes the three currencies for a project.
 *
 * Base and reporting are MANDATORY — the brief requires both at creation.
 * Working is optional and defaults to base.
 *
 * Called at creation and from the project's own currency screen. It
 * OVERWRITES rather than versioning: the historical record of what a past
 * transaction was converted at lives on the transaction row itself
 * (Sprint 1), not here, so changing this cannot restate anything already
 * filed.
 */
export function setProjectCurrencies(
  projectId: string,
  input: { baseCurrency: string; reportingCurrency: string; workingCurrency?: string },
  by = 'unknown',
  reason = '',
): CurrencyConfigResult {
  if (!projectId) return { ok: false, reason: 'missing-project' };

  const base = norm(input.baseCurrency);
  const reporting = norm(input.reportingCurrency);
  const working = norm(input.workingCurrency) || base;

  if (!base) return { ok: false, reason: 'missing-base', field: 'baseCurrency' };
  if (!isValidCurrency(base)) {
    return { ok: false, reason: 'invalid-currency', field: 'baseCurrency' };
  }
  if (!reporting) {
    return { ok: false, reason: 'missing-reporting', field: 'reportingCurrency' };
  }
  if (!isValidCurrency(reporting)) {
    return { ok: false, reason: 'invalid-currency', field: 'reportingCurrency' };
  }
  if (!isValidCurrency(working)) {
    return { ok: false, reason: 'invalid-currency', field: 'workingCurrency' };
  }

  const store = readCurrencyConfigs();
  const record: ProjectCurrencyConfig = {
    projectId,
    baseCurrency: base,
    reportingCurrency: reporting,
    workingCurrency: working,
    setBy: by || 'unknown',
    setAt: new Date().toISOString(),
    reason: reason.trim(),
  };
  store[projectId] = record;
  writeConfigs(store);

  // Keep the older single-currency store in step. Sprint 1's money layer
  // and several modules still read it, and leaving the two to disagree
  // would be worse than the duplication.
  try {
    const legacyKey = 'pactum-project-currency';
    const legacy = JSON.parse(localStorage.getItem(legacyKey) || '{}') || {};
    legacy[projectId] = {
      projectId,
      contractCurrency: base,
      reportingCurrencyAtSet: reporting,
      setBy: record.setBy,
      setAt: record.setAt,
      reason: record.reason || 'Set via currency architecture',
    };
    localStorage.setItem(legacyKey, JSON.stringify(legacy));
  } catch { /* quota */ }

  return { ok: true, record };
}

/** Removes a project's currency config. Used by project disposal. */
export function clearProjectCurrencies(projectId: string): void {
  const store = readCurrencyConfigs();
  if (!(projectId in store)) return;
  delete store[projectId];
  writeConfigs(store);
}

/**
 * Every distinct currency a project touches.
 *
 * The rate pairs a project needs are exactly the conversions between
 * these, so a currency screen can list what must be published.
 */
export function currenciesOfProject(r: ResolvedCurrencies): string[] {
  return Array.from(new Set(
    [r.baseCurrency, r.reportingCurrency, r.workingCurrency].filter(Boolean),
  ));
}

/**
 * Rate pairs a project cannot report without.
 *
 * Working -> reporting is included because site spend recorded in the
 * working currency has to reach the reporting currency to appear in a
 * total. Identity pairs are dropped.
 */
export function requiredPairsFor(r: ResolvedCurrencies): { from: string; to: string }[] {
  const pairs: { from: string; to: string }[] = [];
  if (r.baseCurrency !== r.reportingCurrency) {
    pairs.push({ from: r.baseCurrency, to: r.reportingCurrency });
  }
  if (r.workingCurrency !== r.reportingCurrency
      && r.workingCurrency !== r.baseCurrency) {
    pairs.push({ from: r.workingCurrency, to: r.reportingCurrency });
  }
  return pairs;
}

// ── Scope currency: the unit each TIER reports in ──────────────────────

/** The three levels at which the platform aggregates money. */
export type Scope = 'project' | 'sector' | 'company';

export interface ScopeCurrency {
  /** ISO 4217. '' when the tier has not stated one. */
  currency: string;
  /** Where the answer came from. */
  origin: CurrencyOrigin;
  /**
   * False when the tier has NO currency of its own on record.
   *
   * A sector created before `Sector.reportingCurrency` existed returns
   * `set: false` with the company's currency as a provisional value. The
   * caller decides what to do about it — the resolver never pretends a
   * decision was made.
   */
  set: boolean;
}

/**
 * The currency a given tier's own figures are reported in.
 * Destination: src/lib/currencyArchitecture.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE RATE BOOK, THREE DISPLAY TARGETS
 *
 *   Project operations  ->  project contract currency
 *   Sector analytics    ->  sector reporting currency
 *   Company reporting   ->  company reporting currency
 *
 * Exchange RATES are not tiered. They live in one company-scoped book
 * (`pactum-fx-{companyId}`), because the same currency pair on the same
 * date must have exactly one published answer — three books would let
 * one certificate produce three different figures depending on which
 * screen opened it.
 *
 * So the tiers differ in WHAT THEY CONVERT INTO, never in what the rate
 * is. That is the whole design.
 *
 * CONVERSION IS NEVER CHAINED
 *
 *   A USD project inside a EUR sector inside a SAR company converts
 *   USD -> EUR for the sector and USD -> SAR for the company. It does
 *   NOT go USD -> EUR -> SAR: two rates compound two roundings, and the
 *   answer stops matching a direct conversion. Every figure is converted
 *   ONCE from its own original currency to the target tier — the same
 *   rule `presentIn()` already applies to a single transaction.
 * ══════════════════════════════════════════════════════════════════════
 */
export function scopeCurrency(
  scope: Scope,
  id: string,
  ctx: { companyId?: string; sectorId?: string } = {},
): ScopeCurrency {
  if (scope === 'company') {
    const c = companyReportingCurrency(id);
    return c
      ? { currency: c, origin: 'company', set: true }
      : { currency: FALLBACK_CURRENCY, origin: 'fallback', set: false };
  }

  if (scope === 'sector') {
    const sector = findSectorById(id);
    const own = norm((sector as any)?.reportingCurrency);
    if (own) return { currency: own, origin: 'sector', set: true };

    // Created before the field existed. The company's currency is offered
    // as a provisional value, flagged as NOT a stated decision.
    const fromCompany = companyReportingCurrency(sector?.companyId || ctx.companyId || '');
    return fromCompany
      ? { currency: fromCompany, origin: 'company', set: false }
      : { currency: FALLBACK_CURRENCY, origin: 'fallback', set: false };
  }

  // Project: its contract currency is the unit its own screens use.
  const r = resolveProjectCurrencies(id, ctx.sectorId, ctx.companyId || '');
  return { currency: r.baseCurrency, origin: r.origin.base, set: r.explicit };
}
