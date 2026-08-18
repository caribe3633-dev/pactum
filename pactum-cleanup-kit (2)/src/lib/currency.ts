/**
 * Currency Management Layer.
 * Destination: src/lib/currency.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT THIS CHANGES: nothing that already works.
 *
 *   Every existing formula keeps operating on ONE number in ONE currency.
 *   EVM still reads a converted amount. LD still computes in the project
 *   currency. Cash Flow still charts a single series. None of those files
 *   is touched by this module.
 *
 *   What this adds is the layer UNDERNEATH data entry: a record may now be
 *   captured as "10,000,000 USD", and the platform stores alongside it the
 *   rate that was in force and the converted figure. Downstream modules go
 *   on reading the converted figure exactly as they read the raw number
 *   before, because that is the same field.
 *
 * THE ONE RULE THAT MATTERS
 *
 *   A conversion is performed ONCE, at the transaction date, and the result
 *   is stored. It is never recomputed. A rate added next October cannot
 *   change what August's contract was worth when it was signed — and a
 *   system that silently re-converts history is a system whose reports
 *   change after they are issued.
 *
 * STORAGE — two new keys, both company-scoped
 *
 *   pactum-currency-${companyId}     settings: base + supported currencies
 *   pactum-fx-${companyId}           append-only rate history
 *
 *   No existing key is written by this module.
 * ══════════════════════════════════════════════════════════════════════
 */

// ── Currency definitions ───────────────────────────────────────────────

export interface CurrencyDef {
  /** ISO 4217, e.g. `SAR`. Uppercase, 3 letters. */
  code: string;
  name: string;
  symbol: string;
  /** Minor units. JPY has 0, KWD has 3, most have 2. */
  decimals: number;
  active: boolean;
}

/**
 * Seed list. Editable per company — this is a starting point, not a
 * closed set. Decimals follow ISO 4217, which is why KWD/BHD carry 3.
 */
export const CURRENCY_SEED: CurrencyDef[] = [
  { code: 'SAR', name: 'Saudi Riyal',        symbol: 'SAR', decimals: 2, active: true },
  { code: 'USD', name: 'US Dollar',          symbol: '$',   decimals: 2, active: true },
  { code: 'EUR', name: 'Euro',               symbol: '€',   decimals: 2, active: true },
  { code: 'GBP', name: 'Pound Sterling',     symbol: '£',   decimals: 2, active: true },
  { code: 'AED', name: 'UAE Dirham',         symbol: 'AED', decimals: 2, active: true },
  { code: 'EGP', name: 'Egyptian Pound',     symbol: 'E£',  decimals: 2, active: true },
  { code: 'KWD', name: 'Kuwaiti Dinar',      symbol: 'KWD', decimals: 3, active: false },
  { code: 'BHD', name: 'Bahraini Dinar',     symbol: 'BHD', decimals: 3, active: false },
  { code: 'QAR', name: 'Qatari Riyal',       symbol: 'QAR', decimals: 2, active: false },
  { code: 'OMR', name: 'Omani Rial',         symbol: 'OMR', decimals: 3, active: false },
  { code: 'JPY', name: 'Japanese Yen',       symbol: '¥',   decimals: 0, active: false },
  { code: 'CNY', name: 'Chinese Yuan',       symbol: '¥',   decimals: 2, active: false },
  { code: 'INR', name: 'Indian Rupee',       symbol: '₹',   decimals: 2, active: false },
  { code: 'TRY', name: 'Turkish Lira',       symbol: '₺',   decimals: 2, active: false },
];

export interface CurrencySettings {
  /** The single reporting currency. Every converted figure lands here. */
  baseCurrency: string;
  currencies: CurrencyDef[];
}

export const DEFAULT_CURRENCY_SETTINGS: CurrencySettings = {
  baseCurrency: 'SAR',
  currencies: CURRENCY_SEED,
};

// ── Exchange rate history ──────────────────────────────────────────────

export type FxStatus = 'draft' | 'approved' | 'superseded';

/**
 * One rate, effective from a date.
 *
 * APPEND ONLY. There is no update function in this file, by design: a rate
 * that was used to convert a signed contract is part of the audit trail.
 * A correction is a new row with a later effective date, or a supersede.
 */
export interface FxRate {
  id: string;
  /** Currency being priced. */
  currency: string;
  /**
   * Currency it is priced IN. Always the base at the time of entry.
   * Retained under its original name so every existing reader is unaffected;
   * `reportingCurrency` below is the same fact under the brief's name.
   */
  baseCurrency: string;
  /**
   * The reporting currency this rate prices into — Phase 5.
   *
   * Identical in value to `baseCurrency`, carried explicitly because the
   * reporting currency of a company can be changed. A rate published while
   * the group reported in SAR must keep saying SAR even after the group
   * moves to USD, otherwise every historical conversion silently re-labels
   * itself against a currency it was never computed in.
   */
  reportingCurrency: string;
  /**
   * How many units of base per 1 unit of `currency`.
   * USD -> SAR at 3.75 means 1 USD buys 3.75 SAR.
   */
  rate: number;
  /** ISO yyyy-mm-dd. The rate applies from this date forward. */
  effectiveDate: string;
  /**
   * ISO yyyy-mm-dd the rate was APPROVED — Phase 5.
   *
   * Distinct from `effectiveDate` and from `createdAt`. A rate effective
   * 1 August may be approved on 4 September, and conflating the two makes
   * it impossible to answer "what rate did we actually have available when
   * we issued the August report?". Defaults to the creation date when the
   * approver does not state one.
   */
  approvalDate: string;
  /** Optional: a rate entered for one project only. '' = company-wide. */
  projectId: string;
  approvedBy: string;
  /** ISO timestamp. */
  createdAt: string;
  reason: string;
  status: FxStatus;

  /**
   * Version within (currency, effectiveDate, scope) — Phase 5.
   *
   * A correction never overwrites. It appends the next version for the same
   * currency and effective date, and retires the previous one. V1 is the
   * original statement; V2 says "we were wrong, and here is what we now
   * believe was true on that date". Both stay on record forever.
   */
  version: number;
  /** Id of the rate this one corrects. '' when it is an original. */
  correctsId: string;
  /** Id of the rate that corrected this one. '' when still standing. */
  correctedById: string;
  /** Why the correction was raised. '' on an original. */
  correctionReason: string;

  /**
   * WHO WITHDREW THIS RATE, AND WHO PUT IT BACK.
   *
   * ══════════════════════════════════════════════════════════════════
   * `supersedeRate()` flipped `status` and recorded nothing — no actor,
   * no date, and no way back. A mis-click permanently withdrew a rate,
   * and because `crossRate()` only considers approved rows, that could
   * silently break conversion on screens far away from this one.
   *
   * Withdrawal is an OPERATIONAL decision, not a restatement of fact —
   * unlike a correction, which must stay immutable. So it is reversible,
   * and both directions are recorded. Nothing is ever deleted.
   * ══════════════════════════════════════════════════════════════════
   */
  supersededBy?: string;
  supersededAt?: string;
  supersedeReason?: string;
  reinstatedBy?: string;
  reinstatedAt?: string;
}

export interface FxStore {
  rates: FxRate[];
}

const SETTINGS_KEY = (companyId: string) => `pactum-currency-${companyId}`;
const FX_KEY = (companyId: string) => `pactum-fx-${companyId}`;

// ── Storage ────────────────────────────────────────────────────────────

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cleanCurrency(c: any, i: number): CurrencyDef {
  return {
    code: String(c?.code ?? `C${i}`).toUpperCase().slice(0, 3),
    name: String(c?.name ?? ''),
    symbol: String(c?.symbol ?? ''),
    decimals: Math.max(0, Math.min(4, num(c?.decimals))),
    active: c?.active !== false,
  };
}

/**
 * The reporting currency recorded on the company REGISTRY.
 *
 * SPRINT 3 · R1. Read without importing masterData: currency.ts sits
 * BELOW the master-data layer and importing upward would create a cycle
 * (masterData -> currency -> masterData). The registry key is a plain
 * array, so reading it directly costs one JSON.parse and keeps the
 * dependency graph acyclic.
 */
function registryReportingCurrency(companyId: string): string {
  if (!companyId) return '';
  try {
    const raw = JSON.parse(localStorage.getItem('pactum-enterprise-companies') || 'null');
    if (!Array.isArray(raw)) return '';
    const hit = raw.find((c: any) => c && c.id === companyId);
    return String(hit?.reportingCurrency ?? '').toUpperCase().slice(0, 3);
  } catch {
    return '';
  }
}

/**
 * Currency settings for one company.
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 3 · R1 — ONE SOURCE FOR THE COMPANY'S CURRENCY
 *
 * THE DEFECT, MEASURED
 *
 *   A company's reporting currency lived in TWO places:
 *
 *     pactum-enterprise-companies[].reportingCurrency
 *         written by the create-company wizard — ALWAYS present
 *     pactum-currency-{id}.baseCurrency
 *         written ONLY when a user opens Currency Management
 *
 *   This function read the second and, finding nothing, returned the
 *   hardcoded 'SAR'. So a company created as EUR reported as SAR
 *   everywhere until somebody happened to visit one specific screen.
 *
 *   Phase 3J measured the result: a EUR company whose portfolio card,
 *   project KPIs, cash ledger and risk register all printed "SAR".
 *
 * THE FIX — ORDER OF PRECEDENCE, STATED
 *
 *   1. `pactum-currency-{id}.baseCurrency` — an EXPLICIT decision made
 *      in Currency Management. It wins, because a user set it there on
 *      purpose and may have deliberately diverged from the registry.
 *   2. the registry's `reportingCurrency` — what the company was
 *      CREATED with. Always present, so this is the case that used to
 *      fall through to 'SAR'.
 *   3. 'SAR' — only when neither exists, i.e. no such company.
 *
 *   The currency LIST is unaffected and still falls back to the seed.
 *
 * WHAT THIS DOES NOT DO
 *
 *   It does not write anything. A read that repaired storage would mean
 *   opening a screen silently authors master data — the same rule that
 *   governs `resolveProjectCurrencies`.
 * ══════════════════════════════════════════════════════════════════════
 */
export function readCurrencySettings(companyId: string): CurrencySettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY(companyId)) || 'null');

    // No settings row at all: fall back to the registry before the
    // hardcoded default. This is the path that produced "SAR" on every
    // company that had never visited Currency Management.
    if (!raw || typeof raw !== 'object') {
      const fromRegistry = registryReportingCurrency(companyId);
      return fromRegistry
        ? { ...DEFAULT_CURRENCY_SETTINGS, baseCurrency: fromRegistry }
        : { ...DEFAULT_CURRENCY_SETTINGS };
    }

    const list = Array.isArray(raw.currencies) && raw.currencies.length
      ? raw.currencies.map(cleanCurrency)
      : CURRENCY_SEED;

    // A settings row exists but carries no base currency — same fallback
    // chain, for the same reason.
    const explicit = String(raw.baseCurrency ?? '').toUpperCase().slice(0, 3);
    const baseCurrency = explicit || registryReportingCurrency(companyId) || 'SAR';

    return { baseCurrency, currencies: list };
  } catch {
    return { ...DEFAULT_CURRENCY_SETTINGS };
  }
}

export function writeCurrencySettings(companyId: string, s: CurrencySettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY(companyId), JSON.stringify(s));
  } catch { /* quota */ }
}

/**
 * Coerces one stored rate.
 *
 * PHASE 5 BACKWARD COMPATIBILITY. A rate written before this phase has no
 * reportingCurrency, approvalDate or version. Each is derived from what the
 * row already says rather than left blank:
 *
 *   reportingCurrency <- baseCurrency   (they were the same fact)
 *   approvalDate      <- createdAt      (approval was implicit on entry)
 *   version           <- 1              (nothing had been corrected yet)
 *
 * Every one of those is what the row actually meant when it was written, so
 * no stored value changes and no migration is required.
 */
function cleanRate(r: any, i: number): FxRate {
  const st: FxStatus = ['draft', 'approved', 'superseded'].includes(r?.status) ? r.status : 'approved';
  const base = String(r?.baseCurrency ?? 'SAR').toUpperCase().slice(0, 3);
  const createdAt = String(r?.createdAt ?? '');
  return {
    id: String(r?.id ?? `fx-${i}`),
    currency: String(r?.currency ?? '').toUpperCase().slice(0, 3),
    baseCurrency: base,
    reportingCurrency: String(r?.reportingCurrency ?? base).toUpperCase().slice(0, 3),
    rate: num(r?.rate),
    effectiveDate: String(r?.effectiveDate ?? ''),
    approvalDate: String(r?.approvalDate ?? '') || createdAt.slice(0, 10),
    projectId: String(r?.projectId ?? ''),
    approvedBy: String(r?.approvedBy ?? ''),
    createdAt,
    reason: String(r?.reason ?? ''),
    status: st,
    version: Math.max(1, num(r?.version) || 1),
    correctsId: String(r?.correctsId ?? ''),
    correctedById: String(r?.correctedById ?? ''),
    correctionReason: String(r?.correctionReason ?? ''),
  };
}

export function readFx(companyId: string): FxStore {
  try {
    const raw = JSON.parse(localStorage.getItem(FX_KEY(companyId)) || 'null');
    if (!raw || typeof raw !== 'object') return { rates: [] };
    return { rates: Array.isArray(raw.rates) ? raw.rates.map(cleanRate) : [] };
  } catch {
    return { rates: [] };
  }
}

function writeFx(companyId: string, store: FxStore): void {
  try {
    localStorage.setItem(FX_KEY(companyId), JSON.stringify(store));
  } catch { /* quota */ }
}

// ── Append ─────────────────────────────────────────────────────────────

export interface AppendRateInput {
  currency: string;
  baseCurrency: string;
  rate: number;
  effectiveDate: string;
  projectId?: string;
  approvedBy: string;
  reason?: string;
  /** Phase 5. ISO yyyy-mm-dd. Defaults to today when the approver omits it. */
  approvalDate?: string;
  /** Phase 5. Defaults to `baseCurrency` — the same fact under its own name. */
  reportingCurrency?: string;
}

export interface AppendRateResult {
  store: FxStore;
  ok: boolean;
  reason?: 'invalid-rate' | 'invalid-currency' | 'missing-date' | 'duplicate'
         | 'slot-occupied';
  rate?: FxRate;
  /**
   * The rate already standing in the slot, when `slot-occupied` is returned.
   * Supplied so the caller can name it and offer the correction path rather
   * than leaving the user to work out what blocked them.
   */
  conflict?: FxRate;
}

/**
 * Records a new rate. Never edits an existing one.
 *
 * A rate of zero or below is refused: it would silently zero out every
 * amount converted through it, and a zero exchange rate is not a real
 * economic statement.
 */
export function appendRate(companyId: string, input: AppendRateInput): AppendRateResult {
  const store = readFx(companyId);
  const currency = (input.currency || '').toUpperCase().slice(0, 3);
  const base = (input.baseCurrency || '').toUpperCase().slice(0, 3);

  if (!currency || !base || currency.length < 3 || base.length < 3) {
    return { store, ok: false, reason: 'invalid-currency' };
  }
  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    return { store, ok: false, reason: 'invalid-rate' };
  }
  if (!input.effectiveDate) return { store, ok: false, reason: 'missing-date' };

  // ── Slot guard ───────────────────────────────────────────────────────
  //
  // A "slot" is one (currency, effectiveDate, scope) triple. At most ONE
  // approved rate may stand in it.
  //
  // WHY THIS IS A REFUSAL AND NOT A WARNING
  //
  //   Two approved rates in one slot leave `rateOn()` to pick between them
  //   by tie-break rather than by fact. The answer is deterministic, but
  //   "deterministic" is a weaker statement than the rest of this module
  //   makes: every other lookup here reads a single unambiguous record.
  //
  //   The platform already has an explicit path for restating a rate —
  //   `correctRate()` — which supersedes the standing version, records who
  //   restated it and demands a reason. Allowing `appendRate()` to reach a
  //   similar outcome with none of that would make the audit trail optional,
  //   and an optional audit trail is not one.
  //
  // TWO DISTINCT REFUSALS, because they need two different messages:
  //
  //   duplicate       same slot, SAME value  -> nothing new to say
  //   slot-occupied   same slot, NEW value   -> use correctRate()
  const standing = store.rates.find(r =>
    r.currency === currency && r.baseCurrency === base &&
    r.effectiveDate === input.effectiveDate &&
    r.projectId === (input.projectId ?? '') &&
    r.status === 'approved');

  if (standing) {
    return standing.rate === input.rate
      ? { store, ok: false, reason: 'duplicate', conflict: standing }
      : { store, ok: false, reason: 'slot-occupied', conflict: standing };
  }

  const nowIso = new Date().toISOString();
  const rate: FxRate = {
    id: `fx-${currency}-${input.effectiveDate}-${Date.now()}`,
    currency, baseCurrency: base,
    reportingCurrency: (input.reportingCurrency || base).toUpperCase().slice(0, 3),
    rate: input.rate,
    effectiveDate: input.effectiveDate,
    // Approval is a separate event from effect. Defaulting to today records
    // the truth — that it was approved when it was entered — rather than
    // back-dating approval to the effective date, which never happened.
    approvalDate: input.approvalDate || nowIso.slice(0, 10),
    projectId: input.projectId ?? '',
    approvedBy: input.approvedBy || 'unknown',
    createdAt: nowIso,
    reason: input.reason ?? '',
    status: 'approved',
    // An original statement. Corrections arrive through correctRate().
    version: nextRateVersion(store, currency, input.effectiveDate, input.projectId ?? ''),
    correctsId: '',
    correctedById: '',
    correctionReason: '',
  };
  const next: FxStore = { rates: [...store.rates, rate] };
  writeFx(companyId, next);
  return { store: next, ok: true, rate };
}

/**
 * Next version for a (currency, effectiveDate, scope) triple.
 *
 * Versions are per-slot, not per-currency: two different effective dates are
 * two different statements, each with its own V1. A version is never reused,
 * including after a correction is itself corrected.
 */
export function nextRateVersion(
  store: FxStore, currency: string, effectiveDate: string, projectId = '',
): number {
  const cur = (currency || '').toUpperCase();
  const peers = store.rates.filter(r =>
    r.currency === cur && r.effectiveDate === effectiveDate && r.projectId === projectId);
  return peers.length === 0 ? 1 : Math.max(...peers.map(r => r.version)) + 1;
}

export interface CorrectRateInput {
  /** The rate being corrected. Must exist and must be approved. */
  rateId: string;
  /** The value now believed correct for the SAME effective date. */
  rate: number;
  approvedBy: string;
  /** Mandatory. A correction with no stated cause cannot be audited. */
  correctionReason: string;
  approvalDate?: string;
}

export interface CorrectRateResult {
  store: FxStore;
  ok: boolean;
  reason?: 'not-found' | 'invalid-rate' | 'missing-reason' | 'not-approved' | 'already-corrected';
  rate?: FxRate;
}

/**
 * Corrects a published rate by APPENDING its next version.
 *
 * The wrong rate is never edited and never deleted. It is marked superseded,
 * stamped with the id of its replacement, and stays readable forever. This
 * matters more than it looks: any record already converted through the old
 * rate keeps its frozen `appliedRate`, and the only way a reader can later
 * explain why one August invoice used 3.75 and another used 3.78 is if both
 * rates are still on the register.
 *
 * The new version carries the SAME effective date. It is a restatement of
 * what was true on that date, not a new rate from a new date — using a later
 * effective date would leave the original period still priced at the value
 * everyone now agrees was wrong.
 */
export function correctRate(companyId: string, input: CorrectRateInput): CorrectRateResult {
  const store = readFx(companyId);
  const target = store.rates.find(r => r.id === input.rateId);

  if (!target) return { store, ok: false, reason: 'not-found' };
  // Order matters. A corrected rate is ALSO superseded, so the generic
  // status check would shadow the specific one and report "withdrawn" for a
  // rate that was actually restated — two different events that need two
  // different messages in front of the person trying to fix a number.
  if (target.correctedById) return { store, ok: false, reason: 'already-corrected' };
  if (target.status !== 'approved') return { store, ok: false, reason: 'not-approved' };
  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    return { store, ok: false, reason: 'invalid-rate' };
  }
  if (!input.correctionReason || !input.correctionReason.trim()) {
    return { store, ok: false, reason: 'missing-reason' };
  }

  const nowIso = new Date().toISOString();
  const version = nextRateVersion(store, target.currency, target.effectiveDate, target.projectId);

  const replacement: FxRate = {
    id: `fx-${target.currency}-${target.effectiveDate}-v${version}-${Date.now()}`,
    currency: target.currency,
    baseCurrency: target.baseCurrency,
    reportingCurrency: target.reportingCurrency,
    rate: input.rate,
    // Same effective date, deliberately — this restates that date.
    effectiveDate: target.effectiveDate,
    approvalDate: input.approvalDate || nowIso.slice(0, 10),
    projectId: target.projectId,
    approvedBy: input.approvedBy || 'unknown',
    createdAt: nowIso,
    reason: target.reason,
    status: 'approved',
    version,
    correctsId: target.id,
    correctedById: '',
    correctionReason: input.correctionReason.trim(),
  };

  const next: FxStore = {
    rates: [
      ...store.rates.map(r =>
        r.id === target.id
          ? { ...r, status: 'superseded' as FxStatus, correctedById: replacement.id }
          : r),
      replacement,
    ],
  };
  writeFx(companyId, next);
  return { store: next, ok: true, rate: replacement };
}

/** Every version ever published for one currency + effective date, oldest first. */
export function versionsOf(
  store: FxStore, currency: string, effectiveDate: string, projectId = '',
): FxRate[] {
  const cur = (currency || '').toUpperCase();
  return store.rates
    .filter(r => r.currency === cur && r.effectiveDate === effectiveDate && r.projectId === projectId)
    .sort((a, b) => a.version - b.version);
}

/** Withdraws a rate without deleting it. The row stays auditable. */
export function supersedeRate(
  companyId: string, rateId: string, by = 'unknown', reason = '',
): FxStore {
  const store = readFx(companyId);
  const at = new Date().toISOString();
  const next: FxStore = {
    rates: store.rates.map(r => r.id === rateId
      ? { ...r, status: 'superseded' as FxStatus,
          supersededBy: by, supersededAt: at, supersedeReason: reason }
      : r),
  };
  writeFx(companyId, next);
  return next;
}

export interface ReinstateResult {
  store: FxStore;
  ok: boolean;
  /** 'not-found' · 'not-superseded' · 'slot-occupied' */
  reason?: string;
  /** The approved rate already standing in the slot, when blocked. */
  conflict?: FxRate;
}

/**
 * Puts a withdrawn rate back into force.
 *
 * ══════════════════════════════════════════════════════════════════════
 * REFUSED WHEN THE SLOT IS TAKEN.
 *
 * A slot is one (currency, baseCurrency, effectiveDate, projectId).
 * At most ONE approved rate may stand in it — the same invariant
 * `appendRate()` enforces. If a replacement was published after this row
 * was withdrawn, reinstating would put two approved rates on one date
 * and leave `rateOn()` choosing by tie-break rather than by fact.
 *
 * So the caller is told what is blocking instead, and can withdraw that
 * one first if the reinstatement is really what they want.
 * ══════════════════════════════════════════════════════════════════════
 */
export function reinstateRate(
  companyId: string, rateId: string, by = 'unknown',
): ReinstateResult {
  const store = readFx(companyId);
  const target = store.rates.find(r => r.id === rateId);
  if (!target) return { store, ok: false, reason: 'not-found' };
  if (target.status !== 'superseded') {
    return { store, ok: false, reason: 'not-superseded' };
  }

  const conflict = store.rates.find(r =>
    r.id !== rateId &&
    r.status === 'approved' &&
    r.currency === target.currency &&
    r.baseCurrency === target.baseCurrency &&
    r.effectiveDate === target.effectiveDate &&
    r.projectId === target.projectId);
  if (conflict) return { store, ok: false, reason: 'slot-occupied', conflict };

  const next: FxStore = {
    rates: store.rates.map(r => r.id === rateId
      ? { ...r, status: 'approved' as FxStatus,
          reinstatedBy: by, reinstatedAt: new Date().toISOString() }
      : r),
  };
  writeFx(companyId, next);
  return { store: next, ok: true };
}

// ── Lookup ─────────────────────────────────────────────────────────────

/**
 * The rate in force for `currency` on `onDate`.
 *
 * Picks the latest approved rate whose effective date is on or before the
 * transaction date — never a future rate. A project-specific rate beats a
 * company-wide one for the same date, because a contract may fix its own
 * rate by clause.
 *
 * Returns null when no rate has been published yet. Null is deliberate:
 * defaulting to 1.0 would convert 10,000,000 USD into 10,000,000 SAR and
 * present a fabricated number as fact.
 */
export function rateOn(
  store: FxStore, currency: string, onDate: string, projectId = '',
  baseCurrency = '',
): FxRate | null {
  const cur = (currency || '').toUpperCase();
  if (!cur || !onDate) return null;

  // A currency is never priced against itself. Before this guard, a company
  // that switched its reporting currency to USD got 3.75 back for
  // rateOn('USD') — the old SAR-era row, applied to the base itself.
  // Optional argument, so no existing caller changes behaviour.
  const b = (baseCurrency || '').toUpperCase();
  if (b && cur === b) return null;

  const eligible = store.rates.filter(r =>
    r.status === 'approved' &&
    r.currency === cur &&
    r.effectiveDate <= onDate &&
    (r.projectId === '' || r.projectId === projectId));

  if (eligible.length === 0) return null;

  // Latest effective date wins; a project-scoped rate outranks a global one
  // on the same date; a higher correction version outranks the version it
  // replaced; a later entry breaks any remaining tie.
  eligible.sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? -1 : 1;
    if (a.projectId !== b.projectId) return a.projectId === '' ? -1 : 1;
    if (a.version !== b.version) return a.version - b.version;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return eligible[eligible.length - 1];
}

/**
 * The rate that was AVAILABLE on `knownAsOf`, for a transaction on `onDate`.
 *
 * Point-in-time reconstruction. `rateOn` answers "what do we now believe the
 * rate was on that date"; this answers "what rate could the August report
 * actually have used, given only what had been approved by the time it was
 * issued". A correction approved in November is invisible to a report dated
 * September, which is the only way a reissued historical report can come out
 * the same as the original.
 *
 * A separate function on purpose: `rateOn` keeps its exact existing
 * behaviour and every current caller is unaffected.
 */
export function rateOnAsKnown(
  store: FxStore, currency: string, onDate: string, knownAsOf: string, projectId = '',
): FxRate | null {
  const cur = (currency || '').toUpperCase();
  if (!cur || !onDate || !knownAsOf) return null;

  const eligible = store.rates.filter(r =>
    // A rate superseded AFTER the cut-off was still standing at the cut-off,
    // so status alone cannot be the filter — approval timing is.
    (r.status === 'approved' || r.status === 'superseded') &&
    r.currency === cur &&
    r.effectiveDate <= onDate &&
    r.approvalDate !== '' && r.approvalDate <= knownAsOf &&
    (r.projectId === '' || r.projectId === projectId));

  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? -1 : 1;
    if (a.projectId !== b.projectId) return a.projectId === '' ? -1 : 1;
    if (a.version !== b.version) return a.version - b.version;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return eligible[eligible.length - 1];
}

// ── Centralised conversion service (Phase 8) ───────────────────────────
//
// WHY THIS EXISTS
//
//   Until now a rate was stored one-way, `currency -> baseCurrency`, and a
//   conversion could only ever land in the base. That was correct while
//   every company reported in one currency, and it broke the moment the
//   platform became genuinely multi-currency:
//
//     EUR->SAR 4.10 published, USD->SAR 3.75 published
//     convert(1,000,000 EUR -> USD) returned 4,100,000 with resolved:true
//
//   — a riyal figure wearing a dollar label, stated with confidence. The
//   fix is not to store more rates but to derive the missing pair from the
//   two that exist, through the currency they were both published against.
//
// NO CALCULATION IS CHANGED BY THIS
//
//   Every existing caller converts INTO the company base, and for that
//   path `crossRate` returns exactly what `rateOn` returned before. The
//   derivation only engages when `to` is not the currency the rates were
//   published in — a case that previously produced a wrong answer.

/** How a rate was obtained. Printed in the audit line, never inferred later. */
export type RateSource = 'identity' | 'direct' | 'inverse' | 'cross';

export interface ResolvedRate {
  rate: number;
  from: string;
  to: string;
  source: RateSource;
  /** The rate rows used. One for direct/inverse, two for a cross. */
  legs: FxRate[];
  /** Currency the cross was routed through. '' unless source is 'cross'. */
  pivot: string;
  /** Latest effective date among the legs — the date this rate speaks for. */
  effectiveDate: string;
  resolved: boolean;
}

const unresolved = (from: string, to: string): ResolvedRate => ({
  rate: 0, from, to, source: 'cross', legs: [], pivot: '',
  effectiveDate: '', resolved: false,
});

/**
 * The rate to convert `from` into `to` on `onDate`.
 *
 * Resolution order, most authoritative first:
 *
 *   1. identity — same currency. Rate 1, always, with no lookup. This also
 *      fixes a live defect: after a company switched its reporting currency,
 *      `rateOn(USD)` returned 3.75 for a USD-reporting company, pricing the
 *      base against itself.
 *   2. direct   — a published `from -> to` row.
 *   3. inverse  — a published `to -> from` row, reciprocated. A rate book
 *      holding USD->SAR answers SAR->USD; refusing to invert would be
 *      pedantry that produces an unresolved conversion for a pair the
 *      organisation demonstrably has a rate for.
 *   4. cross    — both legs published against a pivot:
 *                   EUR -> USD  =  (EUR -> pivot) / (USD -> pivot)
 *
 * Returns `resolved:false` when no route exists. It never guesses, never
 * falls back to 1, and never returns a rate assembled from legs of
 * different effective dates without saying which date it speaks for.
 */
export function crossRate(
  store: FxStore, from: string, to: string, onDate: string,
  projectId = '', pivotHint = '',
): ResolvedRate {
  const f = (from || '').toUpperCase();
  const t = (to || '').toUpperCase();

  if (!f || !t || !onDate) return unresolved(f, t);

  // 1 · Identity.
  if (f === t) {
    return { rate: 1, from: f, to: t, source: 'identity', legs: [], pivot: '',
             effectiveDate: onDate, resolved: true };
  }

  // 2 · Direct: a row that prices f in t.
  const direct = store.rates.filter(r =>
    r.status === 'approved' && r.currency === f && r.baseCurrency === t &&
    r.effectiveDate <= onDate && (r.projectId === '' || r.projectId === projectId));
  if (direct.length) {
    const hit = pickLatest(direct);
    return { rate: hit.rate, from: f, to: t, source: 'direct', legs: [hit], pivot: '',
             effectiveDate: hit.effectiveDate, resolved: true };
  }

  // 3 · Inverse: a row that prices t in f.
  const inverse = store.rates.filter(r =>
    r.status === 'approved' && r.currency === t && r.baseCurrency === f &&
    r.effectiveDate <= onDate && (r.projectId === '' || r.projectId === projectId));
  if (inverse.length) {
    const hit = pickLatest(inverse);
    if (hit.rate > 0) {
      return { rate: 1 / hit.rate, from: f, to: t, source: 'inverse', legs: [hit], pivot: '',
               effectiveDate: hit.effectiveDate, resolved: true };
    }
  }

  // 4 · Cross through a pivot both legs were published against.
  //     Candidate pivots are tried in order of preference: the caller's
  //     hint first, then whichever base currency appears most often in the
  //     book — which in practice is the currency the organisation actually
  //     publishes against.
  const pivots = candidatePivots(store, f, t, pivotHint);
  for (const pv of pivots) {
    const legF = pickLatestOrNull(store.rates.filter(r =>
      r.status === 'approved' && r.currency === f && r.baseCurrency === pv &&
      r.effectiveDate <= onDate && (r.projectId === '' || r.projectId === projectId)));
    const legT = pickLatestOrNull(store.rates.filter(r =>
      r.status === 'approved' && r.currency === t && r.baseCurrency === pv &&
      r.effectiveDate <= onDate && (r.projectId === '' || r.projectId === projectId)));
    if (legF && legT && legT.rate > 0) {
      return {
        rate: legF.rate / legT.rate,
        from: f, to: t, source: 'cross', legs: [legF, legT], pivot: pv,
        // The older leg governs: a cross is only as current as its stalest
        // component, and reporting the newer date would overstate freshness.
        effectiveDate: legF.effectiveDate < legT.effectiveDate
          ? legF.effectiveDate : legT.effectiveDate,
        resolved: true,
      };
    }
  }

  return unresolved(f, t);
}

/** Latest effective date wins; project scope outranks global; version breaks ties. */
function pickLatest(list: FxRate[]): FxRate {
  const sorted = list.slice().sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? -1 : 1;
    if (a.projectId !== b.projectId) return a.projectId === '' ? -1 : 1;
    if (a.version !== b.version) return a.version - b.version;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return sorted[sorted.length - 1];
}

function pickLatestOrNull(list: FxRate[]): FxRate | null {
  return list.length ? pickLatest(list) : null;
}

/**
 * Pivot currencies worth trying, most likely first.
 *
 * A pivot is only useful if BOTH sides were published against it, so the
 * list is the intersection of the two currencies' known bases. Ordering by
 * frequency puts the organisation's actual reporting currency first without
 * hard-coding what that currency is.
 */
function candidatePivots(store: FxStore, f: string, t: string, hint = ''): string[] {
  const basesOf = (c: string) => new Set(
    store.rates.filter(r => r.status === 'approved' && r.currency === c).map(r => r.baseCurrency));
  const bf = basesOf(f), bt = basesOf(t);
  const shared = Array.from(bf).filter(b => bt.has(b));

  const freq = new Map<string, number>();
  store.rates.forEach(r => {
    if (r.status === 'approved') freq.set(r.baseCurrency, (freq.get(r.baseCurrency) ?? 0) + 1);
  });

  shared.sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || a.localeCompare(b));
  const h = (hint || '').toUpperCase();
  return h && shared.includes(h) ? [h, ...shared.filter(x => x !== h)] : shared;
}

/**
 * The one conversion entry point.
 *
 * `convert()` below is retained unchanged for every existing caller; this is
 * the general form that can land in any currency. It performs the conversion
 * ONCE and the result is meant to be stored, never recomputed — a rate added
 * next October must not be able to restate what August was worth.
 */
export interface ConversionResult {
  original: number;
  originalCurrency: string;
  targetCurrency: string;
  appliedRate: number;
  converted: number;
  effectiveDate: string;
  /** Date the rate was looked up against — the transaction date. */
  rateDate: string;
  source: RateSource;
  pivot: string;
  /** Ids of the rate rows used, so the conversion can be re-audited. */
  legIds: string[];
  resolved: boolean;
}

export function convertBetween(
  store: FxStore, amount: number, fromCurrency: string, toCurrency: string,
  onDate: string, projectId = '', pivotHint = '',
): ConversionResult {
  const amt = num(amount);
  const r = crossRate(store, fromCurrency, toCurrency, onDate, projectId, pivotHint);

  return {
    original: amt,
    originalCurrency: r.from,
    targetCurrency: r.to,
    appliedRate: r.resolved ? r.rate : 0,
    // Unresolved carries the original through UNCONVERTED rather than
    // inventing a rate of 1 and hiding the gap inside a total.
    converted: r.resolved ? amt * r.rate : amt,
    effectiveDate: r.effectiveDate,
    rateDate: onDate,
    source: r.source,
    pivot: r.pivot,
    legIds: r.legs.map(l => l.id),
    resolved: r.resolved,
  };
}

/** The audit line for a converted figure: `EUR 1,000,000 x 1.0933 = USD 1,093,333`. */
export function conversionAudit(c: ConversionResult): string {
  if (!c.resolved) return `${c.originalCurrency} ${grouped(c.original)} — no rate on record`;
  if (c.source === 'identity') return '';
  const via = c.source === 'cross' ? ` via ${c.pivot}` : c.source === 'inverse' ? ' (inverse)' : '';
  return `${c.originalCurrency} ${grouped(c.original)} x ${c.appliedRate.toFixed(6)}`
       + ` = ${c.targetCurrency} ${grouped(c.converted)}${via}`;
}

function grouped(n2: number): string {
  return Math.round(n2).toLocaleString('en-US');
}

/** Every approved rate for one currency, oldest first. Drives the FX chart. */
export function rateHistory(store: FxStore, currency: string, projectId = ''): FxRate[] {
  const cur = (currency || '').toUpperCase();
  return store.rates
    .filter(r => r.status === 'approved' && r.currency === cur &&
                 (r.projectId === '' || r.projectId === projectId))
    .sort((a, b) => a.effectiveDate < b.effectiveDate ? -1 : 1);
}

/** Currencies that actually have a published rate. */
export function ratedCurrencies(store: FxStore): string[] {
  return Array.from(new Set(store.rates.filter(r => r.status === 'approved').map(r => r.currency))).sort();
}

// ── Conversion ─────────────────────────────────────────────────────────

/**
 * A money amount as captured, with the conversion frozen alongside it.
 *
 * `converted` is the field every existing formula reads. `original` and
 * `appliedRate` exist so a reader can always answer "where did this number
 * come from?" — and so the answer never changes.
 */
export interface MoneyRecord {
  /** As entered by the user. */
  original: number;
  /** As entered by the user. */
  originalCurrency: string;
  /** Rate used at the transaction date. 1 when already in base. */
  appliedRate: number;
  /** original × appliedRate. What downstream modules consume. */
  converted: number;
  /** Currency `converted` is expressed in. */
  baseCurrency: string;
  /** Transaction date the rate was looked up against. */
  rateDate: string;
  /**
   * False when no rate existed for that date. `converted` then equals
   * `original` and must be treated as unconverted, not as correct.
   */
  resolved: boolean;
}

/**
 * Converts once and freezes the result.
 *
 * When the amount is already in the base currency the rate is 1 and the
 * record is resolved — no lookup is needed or wanted.
 */
export function convert(
  store: FxStore, amount: number, currency: string, onDate: string,
  baseCurrency: string, projectId = '',
): MoneyRecord {
  const cur = (currency || baseCurrency).toUpperCase();
  const base = baseCurrency.toUpperCase();
  const amt = num(amount);

  // Delegates to the one conversion engine. For the overwhelmingly common
  // case — a rate published directly against the target — `crossRate`
  // returns the identical row `rateOn` returned before, so every existing
  // caller is byte-identical. What changes is only the case that used to be
  // wrong: converting into a currency the rates were NOT published against,
  // which previously returned a base-currency figure under the target's
  // label. It is now derived through the pivot, or refused.
  const c = convertBetween(store, amt, cur, base, onDate, projectId, base);

  return {
    original: c.original,
    originalCurrency: c.originalCurrency,
    appliedRate: c.resolved ? c.appliedRate : 0,
    converted: c.converted,
    baseCurrency: base,
    rateDate: onDate,
    resolved: c.resolved,
  };
}

/**
 * Re-values an already-converted record at a LATER rate.
 *
 * Analytical only. It returns a new object and never mutates the stored
 * record — the contractual figure is `rec.converted` and stays that way.
 * This exists solely to answer "what would this be worth at today's rate?"
 */
export interface FxImpact {
  /** The frozen contractual figure. */
  atOriginalRate: number;
  /** The same original amount at the comparison rate. */
  atCurrentRate: number;
  /** atCurrentRate − atOriginalRate. Positive = the base weakened. */
  impact: number;
  originalRate: number;
  currentRate: number;
  /** False when either rate is missing; impact is then 0, not a guess. */
  comparable: boolean;
}

export function fxImpact(
  store: FxStore, rec: MoneyRecord, asOfDate: string, projectId = '',
): FxImpact {
  const flat: FxImpact = {
    atOriginalRate: rec.converted, atCurrentRate: rec.converted, impact: 0,
    originalRate: rec.appliedRate, currentRate: rec.appliedRate, comparable: false,
  };
  if (rec.originalCurrency === rec.baseCurrency) return { ...flat, comparable: true };
  if (!rec.resolved || rec.appliedRate <= 0) return flat;

  const now = rateOn(store, rec.originalCurrency, asOfDate, projectId);
  if (!now) return flat;

  const atCurrent = rec.original * now.rate;
  return {
    atOriginalRate: rec.converted,
    atCurrentRate: atCurrent,
    impact: atCurrent - rec.converted,
    originalRate: rec.appliedRate,
    currentRate: now.rate,
    comparable: true,
  };
}

// ── FX snapshot for Timeline ───────────────────────────────────────────

/**
 * One currency's rate at the moment a reporting period was approved.
 *
 * Phase 5 adds the full provenance of each frozen rate. `currency`, `rate`
 * and `effectiveDate` keep their exact meaning and position, so every
 * snapshot written before this phase reads back unchanged and every existing
 * consumer is unaffected. The additions are optional.
 */
export interface FxSnapshotEntry {
  currency: string;
  rate: number;
  effectiveDate: string;
  /** Phase 5 — what this rate prices into. */
  reportingCurrency?: string;
  /** Phase 5 — when the rate was approved, not when it took effect. */
  approvalDate?: string;
  approvedBy?: string;
  /** Phase 5 — correction version in force at freeze time. */
  version?: number;
  /** Phase 5 — the register row this was taken from, for traceability. */
  rateId?: string;
  status?: FxStatus;
}

/**
 * Every published rate as at `onDate`, ready to freeze into a Timeline
 * snapshot. Once stored it is never looked up again — that is the point.
 *
 * `knownAsOf` (Phase 5, optional) reconstructs the rate book as it stood on
 * a given approval date rather than as it stands now. Omitted, behaviour is
 * byte-identical to before: the current best view of each rate on `onDate`.
 */
export function fxSnapshotAt(
  store: FxStore, baseCurrency: string, onDate: string, projectId = '',
  knownAsOf?: string,
): FxSnapshotEntry[] {
  return ratedCurrencies(store)
    .map(code => {
      const r = knownAsOf
        ? rateOnAsKnown(store, code, onDate, knownAsOf, projectId)
        : rateOn(store, code, onDate, projectId);
      return r
        ? {
            currency: code,
            rate: r.rate,
            effectiveDate: r.effectiveDate,
            reportingCurrency: r.reportingCurrency || baseCurrency,
            approvalDate: r.approvalDate,
            approvedBy: r.approvedBy,
            version: r.version,
            rateId: r.id,
            status: r.status,
          }
        : null;
    })
    .filter(Boolean) as FxSnapshotEntry[];
}

/**
 * The rates a period ACTUALLY applied, harvested from the records themselves.
 *
 * `fxSnapshotAt` freezes the rate book — every rate that was available.
 * This freezes the rates that were used: read off the stored `exchangeRate`
 * on each converted row. The two are different questions, and only the
 * second can prove what a reported total was built from.
 *
 * Reads rows the caller already holds. It opens no store and writes nothing.
 */
export interface AppliedRateEntry {
  currency: string;
  rate: number;
  /** How many records were converted at this rate in this period. */
  count: number;
  /** Σ of the original (pre-conversion) amounts. */
  originalTotal: number;
  /** Σ of the converted amounts. */
  convertedTotal: number;
  /** Earliest and latest transaction date seen at this rate. */
  firstTxn: string;
  lastTxn: string;
}

export function appliedRatesFrom(
  rows: any[], amountField: string, baseCurrency: string,
): AppliedRateEntry[] {
  const base = (baseCurrency || '').toUpperCase();
  const acc = new Map<string, AppliedRateEntry>();

  (Array.isArray(rows) ? rows : []).forEach(row => {
    const cur = String(row?.currency ?? '').toUpperCase();
    // A row with no currency metadata was captured in base at rate 1. It is
    // not an applied FX rate and recording it as one would drown the real
    // conversions in a sea of 1.0000 entries.
    if (!cur || cur === base) return;

    const rate = num(row?.exchangeRate);
    if (rate <= 0) return;

    const key = `${cur}|${rate.toFixed(6)}`;
    const converted = num(row?.[amountField]);
    const original = num(row?.originalAmount) || (rate > 0 ? converted / rate : 0);
    const txn = String(row?.transactionDate ?? '');

    const e = acc.get(key);
    if (!e) {
      acc.set(key, {
        currency: cur, rate, count: 1,
        originalTotal: original, convertedTotal: converted,
        firstTxn: txn, lastTxn: txn,
      });
    } else {
      e.count += 1;
      e.originalTotal += original;
      e.convertedTotal += converted;
      if (txn && (!e.firstTxn || txn < e.firstTxn)) e.firstTxn = txn;
      if (txn && (!e.lastTxn || txn > e.lastTxn)) e.lastTxn = txn;
    }
  });

  return Array.from(acc.values())
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.rate - b.rate);
}

/** Merges applied-rate ledgers from several registers into one list. */
export function mergeAppliedRates(...groups: AppliedRateEntry[][]): AppliedRateEntry[] {
  const acc = new Map<string, AppliedRateEntry>();
  groups.flat().forEach(e => {
    const key = `${e.currency}|${e.rate.toFixed(6)}`;
    const cur = acc.get(key);
    if (!cur) {
      acc.set(key, { ...e });
    } else {
      cur.count += e.count;
      cur.originalTotal += e.originalTotal;
      cur.convertedTotal += e.convertedTotal;
      if (e.firstTxn && (!cur.firstTxn || e.firstTxn < cur.firstTxn)) cur.firstTxn = e.firstTxn;
      if (e.lastTxn && (!cur.lastTxn || e.lastTxn > cur.lastTxn)) cur.lastTxn = e.lastTxn;
    }
  });
  return Array.from(acc.values())
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.rate - b.rate);
}

/**
 * Resolves a converted figure using a FROZEN rate table, never the live one.
 *
 * This is the function a historical report calls. Given the rates a period
 * archived, it reproduces the conversion that period reported — even if the
 * live register has since been corrected six times. When the frozen table
 * has no entry for the currency it returns unresolved rather than reaching
 * for a current rate, because a report that quietly substitutes today's rate
 * is worse than one that says it cannot answer.
 */
export function convertFromFrozen(
  frozen: FxSnapshotEntry[], amount: number, currency: string, baseCurrency: string,
): MoneyRecord {
  const cur = (currency || baseCurrency).toUpperCase();
  const base = (baseCurrency || '').toUpperCase();
  const amt = num(amount);

  if (cur === base) {
    return {
      original: amt, originalCurrency: base, appliedRate: 1,
      converted: amt, baseCurrency: base, rateDate: '', resolved: true,
    };
  }

  const hit = (frozen ?? []).find(e => e.currency === cur);
  if (!hit || !(hit.rate > 0)) {
    return {
      original: amt, originalCurrency: cur, appliedRate: 0,
      converted: amt, baseCurrency: base, rateDate: '', resolved: false,
    };
  }

  return {
    original: amt, originalCurrency: cur, appliedRate: hit.rate,
    converted: amt * hit.rate, baseCurrency: base,
    rateDate: hit.effectiveDate, resolved: true,
  };
}

// ── Formatting ─────────────────────────────────────────────────────────

export function currencyDef(settings: CurrencySettings, code: string): CurrencyDef | null {
  const c = (code || '').toUpperCase();
  return settings.currencies.find(x => x.code === c) ?? null;
}

/** `USD 10,000,000` — honours the currency's own decimal places. */
export function formatCurrency(
  settings: CurrencySettings, amount: number, code: string,
): string {
  const def = currencyDef(settings, code);
  const dp = def?.decimals ?? 2;
  const n = num(amount).toLocaleString('en-US', {
    minimumFractionDigits: dp === 0 ? 0 : 0,
    maximumFractionDigits: dp,
  });
  return `${def?.code ?? code} ${n}`;
}

/**
 * The audit line a report prints under a converted figure:
 * `USD 10,000,000 × 3.7500 = SAR 37,500,000`
 */
export function conversionNote(settings: CurrencySettings, rec: MoneyRecord): string {
  if (rec.originalCurrency === rec.baseCurrency) return '';
  if (!rec.resolved) {
    return `${formatCurrency(settings, rec.original, rec.originalCurrency)} — no rate on record`;
  }
  return `${formatCurrency(settings, rec.original, rec.originalCurrency)}`
       + ` × ${rec.appliedRate.toFixed(4)}`
       + ` = ${formatCurrency(settings, rec.converted, rec.baseCurrency)}`;
}

/** A plain, already-base amount wrapped as a MoneyRecord. */
export function baseMoney(amount: number, baseCurrency: string, onDate = ''): MoneyRecord {
  return {
    original: num(amount), originalCurrency: baseCurrency, appliedRate: 1,
    converted: num(amount), baseCurrency, rateDate: onDate, resolved: true,
  };
}

/**
 * Reads a currency-aware record off any existing row.
 *
 * Legacy rows have no currency fields at all. They are treated as already
 * being in the base currency — which is exactly what they were, because
 * that was the platform's only assumption before this layer existed. No
 * migration is required and no stored value changes.
 */
export function moneyFrom(
  row: any, amountField: string, baseCurrency: string, onDate = '',
): MoneyRecord {
  const amt = num(row?.[amountField]);
  const cur = String(row?.[`${amountField}Currency`] ?? row?.currency ?? '').toUpperCase();
  const rate = num(row?.[`${amountField}Rate`] ?? row?.appliedRate);
  const orig = num(row?.[`${amountField}Original`] ?? row?.originalAmount);

  if (!cur || cur === baseCurrency.toUpperCase()) {
    return baseMoney(amt, baseCurrency, onDate);
  }
  return {
    original: orig || amt,
    originalCurrency: cur,
    appliedRate: rate || 0,
    converted: amt,
    baseCurrency,
    rateDate: String(row?.rateDate ?? onDate),
    resolved: rate > 0,
  };
}

/**
 * The fields to persist on a row so the conversion travels with the record.
 * Spread into whatever the module already stores; the amount field keeps
 * holding the CONVERTED value, so every existing reader is unaffected.
 */
export function moneyFields(amountField: string, rec: MoneyRecord): Record<string, unknown> {
  return {
    [amountField]: rec.converted,
    [`${amountField}Currency`]: rec.originalCurrency,
    [`${amountField}Original`]: rec.original,
    [`${amountField}Rate`]: rec.appliedRate,
    rateDate: rec.rateDate,
  };
}

// ── FX register & audit ────────────────────────────────────────────────
//
// Phase 5. The register is the complete, append-only history: every rate,
// every correction, every withdrawal, in the order it happened. Nothing here
// filters out a superseded row — that is the whole point of an audit trail.

/** One flat row of the FX register, for the table and the report. */
export interface FxRegisterRow {
  id: string;
  currency: string;
  reportingCurrency: string;
  rate: number;
  effectiveDate: string;
  approvalDate: string;
  approvedBy: string;
  reason: string;
  status: FxStatus;
  version: number;
  scope: string;
  projectId: string;
  /** 'original' | 'correction'. */
  kind: 'original' | 'correction';
  correctionReason: string;
  /** Version that replaced this one, as a label. '' when still standing. */
  correctedBy: string;
  /** Movement against the version this one corrected. null on an original. */
  delta: number | null;
  createdAt: string;
}

/**
 * The complete register, newest first within each currency.
 *
 * Superseded and corrected rows are INCLUDED. A register that hides the
 * value it used to publish cannot answer the only question anyone asks of
 * it — "what did we say before, and why did it change?"
 */
export function fxRegister(store: FxStore): FxRegisterRow[] {
  const byId = new Map(store.rates.map(r => [r.id, r]));
  return store.rates
    .slice()
    .sort((a, b) =>
      a.currency.localeCompare(b.currency) ||
      (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0) ||
      b.version - a.version)
    .map(r => {
      const prior = r.correctsId ? byId.get(r.correctsId) : undefined;
      const replacement = r.correctedById ? byId.get(r.correctedById) : undefined;
      return {
        id: r.id,
        currency: r.currency,
        reportingCurrency: r.reportingCurrency || r.baseCurrency,
        rate: r.rate,
        effectiveDate: r.effectiveDate,
        approvalDate: r.approvalDate,
        approvedBy: r.approvedBy,
        reason: r.reason,
        status: r.status,
        version: r.version,
        scope: r.projectId ? 'project' : 'company',
        projectId: r.projectId,
        kind: r.correctsId ? 'correction' : 'original',
        correctionReason: r.correctionReason,
        correctedBy: replacement ? `V${replacement.version}` : '',
        delta: prior ? r.rate - prior.rate : null,
        createdAt: r.createdAt,
      };
    });
}

/**
 * Corrections only — the shortest useful audit view.
 * Empty is the healthy state; a long list is a data-quality signal.
 */
export function fxCorrections(store: FxStore): FxRegisterRow[] {
  return fxRegister(store).filter(r => r.kind === 'correction');
}

/**
 * The rate curve for one currency, using only what was known at each point.
 *
 * Built from approval dates, not effective dates, so the curve shows how the
 * organisation's view of a currency evolved rather than a tidy retrospective
 * line that was never actually visible to anyone.
 */
export interface FxCurvePoint {
  effectiveDate: string;
  approvalDate: string;
  rate: number;
  version: number;
  status: FxStatus;
  /** Movement against the previous point. null on the first. */
  delta: number | null;
  /** Movement as a share of the previous rate. null when that was 0. */
  pctDelta: number | null;
}

export function fxCurve(store: FxStore, currency: string, projectId = ''): FxCurvePoint[] {
  const cur = (currency || '').toUpperCase();
  const rows = store.rates
    .filter(r => r.currency === cur && (r.projectId === '' || r.projectId === projectId))
    .sort((a, b) =>
      (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0) ||
      a.version - b.version);

  let prev: number | null = null;
  return rows.map(r => {
    const delta = prev !== null ? r.rate - prev : null;
    const pctDelta = prev !== null && prev !== 0 ? (r.rate - prev) / Math.abs(prev) : null;
    prev = r.rate;
    return {
      effectiveDate: r.effectiveDate,
      approvalDate: r.approvalDate,
      rate: r.rate,
      version: r.version,
      status: r.status,
      delta, pctDelta,
    };
  });
}

/**
 * Integrity check over the whole register.
 *
 * Runs on read, reports rather than repairs. A store this file did not write
 * — hand-edited, restored from a backup, produced by an older build — can be
 * inconsistent, and silently "fixing" it would destroy the evidence.
 */
export interface FxIntegrity {
  totalRates: number;
  approved: number;
  superseded: number;
  corrections: number;
  currencies: number;
  /** Rows missing an approval date; they cannot participate in point-in-time. */
  missingApprovalDate: string[];
  /** Rows whose reporting currency differs from their base currency. */
  reportingMismatch: string[];
  /** Rates approved BEFORE they took effect is normal; the reverse is a lag. */
  approvedBeforeEffective: number;
  /** Slots holding more than one standing approved version — must be zero. */
  duplicateStanding: string[];
  clean: boolean;
}

export function fxIntegrity(store: FxStore): FxIntegrity {
  const rates = store.rates;
  const missingApprovalDate = rates.filter(r => !r.approvalDate).map(r => r.id);
  const reportingMismatch = rates
    .filter(r => r.reportingCurrency && r.reportingCurrency !== r.baseCurrency)
    .map(r => r.id);

  // Two approved rows for the same currency, date and scope means a lookup
  // has to pick between them by tie-break rather than by fact.
  const slots = new Map<string, number>();
  rates.filter(r => r.status === 'approved').forEach(r => {
    const k = `${r.currency}|${r.effectiveDate}|${r.projectId}`;
    slots.set(k, (slots.get(k) ?? 0) + 1);
  });
  const duplicateStanding = Array.from(slots.entries())
    .filter(([, n]) => n > 1)
    .map(([k]) => k);

  const out: FxIntegrity = {
    totalRates: rates.length,
    approved: rates.filter(r => r.status === 'approved').length,
    superseded: rates.filter(r => r.status === 'superseded').length,
    corrections: rates.filter(r => r.correctsId).length,
    currencies: new Set(rates.map(r => r.currency)).size,
    missingApprovalDate,
    reportingMismatch,
    approvedBeforeEffective: rates.filter(r =>
      r.approvalDate && r.effectiveDate && r.approvalDate < r.effectiveDate).length,
    duplicateStanding,
    clean: false,
  };
  out.clean = missingApprovalDate.length === 0
           && reportingMismatch.length === 0
           && duplicateStanding.length === 0;
  return out;
}
