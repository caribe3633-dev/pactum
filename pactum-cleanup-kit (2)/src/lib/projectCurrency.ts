/**
 * Project contract currency.
 * Destination: src/lib/projectCurrency.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE HIERARCHY
 *
 *   Company      →  Reporting Currency   (pactum-currency-{companyId})
 *   Project      →  Contract Currency    (this file)
 *   Transaction  →  Original Currency    (overrides the project default)
 *
 *   A transaction inherits the project's contract currency unless it says
 *   otherwise, and a project inherits the company's reporting currency
 *   unless it says otherwise. Three levels, each able to override the one
 *   above, none of them guessing.
 *
 * WHY A SEPARATE STORE AND NOT A FIELD ON `Project`
 *
 *   `Project` lives in `data.ts` and is written by `store.ts`, which seeds
 *   from `INITIAL_PROJECTS` and is read by every module in the platform.
 *   Adding a required field there would touch the seed data, the hydration
 *   path and every consumer — a wide blast radius for one string.
 *
 *   A side store keyed by project id is additive: a project with no entry
 *   behaves exactly as it does today, and `contractCurrencyOf()` falls back
 *   to the company reporting currency, which is what every existing project
 *   implicitly used. No migration, no altered value, no touched module.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 *   It converts nothing and computes nothing. It answers one question —
 *   "what currency is this project's contract in?" — and records who set it
 *   and why.
 * ══════════════════════════════════════════════════════════════════════
 */

const KEY = 'pactum-project-currency';

export interface ProjectCurrencyRecord {
  projectId: string;
  /** ISO 4217. The default currency for new financial records. */
  contractCurrency: string;
  /** Company reporting currency at the time this was set, for context. */
  reportingCurrencyAtSet: string;
  setBy: string;
  setAt: string;
  reason: string;
}

export type ProjectCurrencyStore = Record<string, ProjectCurrencyRecord>;

function read(): ProjectCurrencyStore {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return {};
    const out: ProjectCurrencyStore = {};
    Object.entries(raw).forEach(([id, v]: [string, any]) => {
      const cur = String(v?.contractCurrency ?? '').toUpperCase().slice(0, 3);
      if (!cur) return;
      out[id] = {
        projectId: String(v?.projectId ?? id),
        contractCurrency: cur,
        reportingCurrencyAtSet: String(v?.reportingCurrencyAtSet ?? '').toUpperCase().slice(0, 3),
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

function write(store: ProjectCurrencyStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch { /* quota — same policy as every other store */ }
}

export function readProjectCurrencies(): ProjectCurrencyStore {
  return read();
}

/**
 * The contract currency in force for a project.
 *
 * Falls back to the company reporting currency when none is set. That is
 * not a guess: before this layer existed, every project's amounts were
 * captured in the company base, so the fallback states what those records
 * actually were rather than inventing a currency for them.
 */
export function contractCurrencyOf(projectId: string, reportingCurrency: string): string {
  const rec = read()[projectId];
  return rec?.contractCurrency || (reportingCurrency || '').toUpperCase();
}

/** True when the project has an explicit contract currency on record. */
export function hasExplicitCurrency(projectId: string): boolean {
  return Boolean(read()[projectId]?.contractCurrency);
}

export interface SetCurrencyResult {
  store: ProjectCurrencyStore;
  ok: boolean;
  reason?: 'invalid-currency' | 'missing-project';
  record?: ProjectCurrencyRecord;
}

/**
 * Sets a project's contract currency.
 *
 * Deliberately does NOT touch a single stored amount. Changing the contract
 * currency changes what NEW records default to and how existing ones are
 * labelled going forward; it cannot retroactively restate a figure that was
 * captured and converted months ago. Re-denominating history would silently
 * rewrite signed numbers, which is the one thing this platform refuses to
 * do anywhere else and will not start doing here.
 */
export function setContractCurrency(
  projectId: string, currency: string, setBy: string,
  reportingCurrency: string, reason = '',
): SetCurrencyResult {
  const store = read();
  const cur = (currency || '').toUpperCase().slice(0, 3);
  if (!projectId) return { store, ok: false, reason: 'missing-project' };
  if (cur.length !== 3) return { store, ok: false, reason: 'invalid-currency' };

  const record: ProjectCurrencyRecord = {
    projectId,
    contractCurrency: cur,
    reportingCurrencyAtSet: (reportingCurrency || '').toUpperCase().slice(0, 3),
    setBy: setBy || 'unknown',
    setAt: new Date().toISOString(),
    reason: reason.trim(),
  };
  const next = { ...store, [projectId]: record };
  write(next);
  return { store: next, ok: true, record };
}

/** Distinct contract currencies across a set of projects. */
export function currenciesInUse(projectIds: string[], reportingCurrency: string): string[] {
  const s = new Set<string>();
  projectIds.forEach(id => s.add(contractCurrencyOf(id, reportingCurrency)));
  return Array.from(s).filter(Boolean).sort();
}

/**
 * Which currencies a company must hold rates for.
 *
 * A project whose contract currency differs from the company's reporting
 * currency cannot be reported on at all without a rate between the two.
 * Surfacing that as a list lets the UI say so before a conversion silently
 * returns unresolved.
 */
export function requiredRatePairs(
  projectIds: string[], reportingCurrency: string,
): { currency: string; reportingCurrency: string; projectIds: string[] }[] {
  const base = (reportingCurrency || '').toUpperCase();
  const map = new Map<string, string[]>();
  projectIds.forEach(id => {
    const c = contractCurrencyOf(id, base);
    if (!c || c === base) return;
    map.set(c, [...(map.get(c) ?? []), id]);
  });
  return Array.from(map.entries())
    .map(([currency, ids]) => ({ currency, reportingCurrency: base, projectIds: ids }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
