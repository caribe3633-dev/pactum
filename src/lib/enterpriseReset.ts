/**
 * Enterprise reset.
 * Destination: src/lib/enterpriseReset.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3H
 *
 * Two levels, both destructive, both requiring explicit confirmation:
 *
 *   ENTERPRISE RESET  clears all business data — companies, sectors,
 *                     projects and every operational store — but keeps
 *                     the installation usable: users, the signed-in
 *                     session and UI preferences survive.
 *
 *   FACTORY RESET     clears everything above PLUS users, session and
 *                     preferences. The application returns to the state
 *                     of a browser that has never opened it.
 *
 * ── THE TRAP THIS MODULE EXISTS TO AVOID ──────────────────────────────
 *
 *   `seedMasterData` seeds when a key is ABSENT. Measured:
 *
 *       localStorage.removeItem('pactum-enterprise-companies')
 *       fetchCompanies()  ->  5 companies       ← re-seeded!
 *
 *       localStorage.setItem('pactum-enterprise-companies', '[]')
 *       fetchCompanies()  ->  0 companies       ← stays empty
 *
 *   A reset built on `removeItem` would therefore silently undo itself
 *   the moment any page read the store. The two master-data keys are
 *   written as `[]` — "deliberately empty" — rather than deleted.
 *
 *   `pactum-projects` has the same shape: `readProjectsFromStorage()`
 *   re-seeds INITIAL_PROJECTS when the key is missing, so it is also
 *   written as `[]`.
 *
 * ── SEEDS NOTHING ─────────────────────────────────────────────────────
 *
 *   Per the brief. After a reset the enterprise is genuinely empty and
 *   the first company must be created by a human.
 * ══════════════════════════════════════════════════════════════════════
 */

// ── What each level touches ────────────────────────────────────────────

/**
 * Keys that must be EMPTIED rather than deleted, because a reader
 * re-seeds them when they are absent. Verified by execution, not assumed.
 */
const EMPTY_NOT_DELETE = [
  'pactum-enterprise-companies',
  'pactum-enterprise-sectors',
  'pactum-projects',
] as const;

/** Global business stores with no per-project suffix. */
const GLOBAL_BUSINESS_KEYS = [
  'pactum-project-currency',
] as const;

/**
 * Per-entity prefixes. Anything matching `prefix-<id>` is business data.
 *
 * Ordered so the append-only archives come last: a partial failure then
 * leaves the audit trail rather than the working data.
 */
const SCOPED_PREFIXES = [
  // project-owned operational stores
  'pactum-budget-',
  'pactum-co-',
  'pactum-claims-',
  'pactum-delays-',
  'pactum-certs-',
  'pactum-cashflow-',
  'pactum-cashflow-sync-',
  'pactum-certs-sync-',
  'pactum-subs-',
  'pactum-sub-certs-',
  'pactum-sub-commercial-',
  'pactum-sub-windows-',
  'pactum-delay-windows-',
  'pactum-ld-log-',
  'pactum-risk-',
  'pactum-evm-',
  'pactum-sub-perf-',
  // company-owned
  'pactum-currency-',
  'pactum-fx-',
  // append-only archives — last, deliberately
  'pactum-timeline-',
  'pactum-baselines-',
] as const;

/**
 * Identity and preference keys. Survive an Enterprise Reset; removed by a
 * Factory Reset.
 *
 * `pactum-auth` is the signed-in session: clearing it on an Enterprise
 * Reset would log the admin out mid-operation, which is a worse outcome
 * than leaving it.
 */
const IDENTITY_KEYS = [
  'pactum-auth',
  'pactum-users',
  'pactum-username',
  'pactum-password',
] as const;

const PREFERENCE_KEYS = [
  'pactum-density',
  'pactum-card',
  'pactum-navigate',
  'pactum-watermark',
  'pactum-watermark-art',
  'pactum-watermark-credit',
  'pactum-contact-submissions',
  'pactum-feedback',
] as const;

export type ResetScope = 'enterprise' | 'factory';

// ── Report ─────────────────────────────────────────────────────────────

export interface ResetReport {
  scope: ResetScope;
  /** ISO timestamp the reset completed. */
  at: string;
  by: string;
  /** Keys deleted outright. */
  removed: string[];
  /** Keys written as `[]` because deleting them would re-seed. */
  emptied: string[];
  /** Keys deliberately left alone. */
  preserved: string[];
  /** Counts before the reset, for the report. */
  before: {
    companies: number;
    sectors: number;
    projects: number;
    businessKeys: number;
    totalKeys: number;
  };
  /** Anything still present afterwards that looks like business data. */
  residual: string[];
  ok: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Every `pactum-*` key currently in storage. */
function allPactumKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pactum-')) out.push(k);
    }
  } catch { /* storage unavailable */ }
  return out;
}

function isScoped(key: string): boolean {
  return SCOPED_PREFIXES.some(p => key.startsWith(p) && key.length > p.length);
}

function countArray(key: string): number {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(raw) ? raw.length : 0;
  } catch { return 0; }
}

/** What a reset would touch, without touching it. For the confirm dialog. */
export function previewReset(scope: ResetScope): {
  companies: number; sectors: number; projects: number;
  businessKeys: number; identityKeys: number; preferenceKeys: number;
  totalKeys: number;
} {
  const keys = allPactumKeys();
  const business = keys.filter(k =>
    isScoped(k) ||
    (EMPTY_NOT_DELETE as readonly string[]).includes(k) ||
    (GLOBAL_BUSINESS_KEYS as readonly string[]).includes(k));
  const identity = keys.filter(k => (IDENTITY_KEYS as readonly string[]).includes(k));
  const prefs = keys.filter(k => (PREFERENCE_KEYS as readonly string[]).includes(k));

  return {
    companies: countArray('pactum-enterprise-companies'),
    sectors: countArray('pactum-enterprise-sectors'),
    projects: countArray('pactum-projects'),
    businessKeys: business.length,
    identityKeys: scope === 'factory' ? identity.length : 0,
    preferenceKeys: scope === 'factory' ? prefs.length : 0,
    totalKeys: keys.length,
  };
}

// ── The reset ──────────────────────────────────────────────────────────

/**
 * Performs the reset.
 *
 * DESTRUCTIVE AND IRREVERSIBLE. There is no undo: `localStorage` is the
 * whole database and nothing is backed up elsewhere. The caller is
 * responsible for confirmation — `LoadSampleData`-style double-confirm is
 * implemented in the UI component.
 *
 * SEEDS NOTHING. After this returns, the enterprise is empty and the
 * first company must be created by a human.
 */
export function performReset(scope: ResetScope, by = 'unknown'): ResetReport {
  const before = previewReset(scope);
  const removed: string[] = [];
  const emptied: string[] = [];
  const preserved: string[] = [];

  const keys = allPactumKeys();

  keys.forEach(key => {
    const isIdentity = (IDENTITY_KEYS as readonly string[]).includes(key);
    const isPref = (PREFERENCE_KEYS as readonly string[]).includes(key);
    const mustEmpty = (EMPTY_NOT_DELETE as readonly string[]).includes(key);
    const isBusiness = isScoped(key)
      || mustEmpty
      || (GLOBAL_BUSINESS_KEYS as readonly string[]).includes(key);

    // Enterprise reset keeps identity and preferences.
    if (scope === 'enterprise' && (isIdentity || isPref)) {
      preserved.push(key);
      return;
    }

    try {
      if (mustEmpty) {
        // Deleting these re-seeds them. `[]` means "deliberately empty".
        localStorage.setItem(key, '[]');
        emptied.push(key);
        return;
      }
      if (isBusiness || isIdentity || isPref) {
        localStorage.removeItem(key);
        removed.push(key);
        return;
      }
      // An unrecognised pactum-* key. Removed on a factory reset (the
      // point of which is a clean slate) but PRESERVED on an enterprise
      // reset, because guessing that an unknown key is business data
      // risks destroying something this module has not been told about.
      if (scope === 'factory') {
        localStorage.removeItem(key);
        removed.push(key);
      } else {
        preserved.push(key);
      }
    } catch { /* storage unavailable — continue with the rest */ }
  });

  // A factory reset must also leave the three re-seeding keys absent, not
  // empty: the point is a browser that has never run the app. They were
  // written as '[]' above, so remove them now that nothing will read them
  // before the page reloads.
  if (scope === 'factory') {
    EMPTY_NOT_DELETE.forEach(k => {
      try {
        localStorage.removeItem(k);
        const i = emptied.indexOf(k);
        if (i >= 0) { emptied.splice(i, 1); removed.push(k); }
      } catch { /* ignore */ }
    });
  }

  // ── Verify ──
  // Re-read and report anything that still looks like business data,
  // rather than trusting the loop above to have been exhaustive.
  const after = allPactumKeys();
  const residual = after.filter(k => {
    if (scope === 'enterprise'
      && ((IDENTITY_KEYS as readonly string[]).includes(k)
        || (PREFERENCE_KEYS as readonly string[]).includes(k))) return false;
    if ((EMPTY_NOT_DELETE as readonly string[]).includes(k)) {
      return countArray(k) > 0;         // present is fine; non-empty is not
    }
    return isScoped(k) || (GLOBAL_BUSINESS_KEYS as readonly string[]).includes(k);
  });

  return {
    scope,
    at: new Date().toISOString(),
    by,
    removed: removed.sort(),
    emptied: emptied.sort(),
    preserved: preserved.sort(),
    before,
    residual,
    ok: residual.length === 0,
  };
}

/** True when no business data remains. */
export function isEnterpriseEmpty(): boolean {
  return countArray('pactum-enterprise-companies') === 0
    && countArray('pactum-enterprise-sectors') === 0
    && countArray('pactum-projects') === 0
    && allPactumKeys().filter(isScoped).length === 0;
}

/** Human-readable summary for the report panel. */
export function summariseReset(r: ResetReport, lang: 'en' | 'ar' = 'en'): string[] {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  return [
    L(`Scope: ${r.scope === 'factory' ? 'Factory Reset' : 'Enterprise Reset'}`,
      `النطاق: ${r.scope === 'factory' ? 'إعادة ضبط المصنع' : 'إعادة ضبط المؤسسة'}`),
    L(`Companies cleared: ${r.before.companies}`, `الشركات المحذوفة: ${r.before.companies}`),
    L(`Sectors cleared: ${r.before.sectors}`, `القطاعات المحذوفة: ${r.before.sectors}`),
    L(`Projects cleared: ${r.before.projects}`, `المشاريع المحذوفة: ${r.before.projects}`),
    L(`Storage keys removed: ${r.removed.length}`, `مفاتيح حُذفت: ${r.removed.length}`),
    L(`Storage keys emptied: ${r.emptied.length}`, `مفاتيح أُفرغت: ${r.emptied.length}`),
    L(`Preserved: ${r.preserved.length}`, `مُستبقاة: ${r.preserved.length}`),
    r.ok
      ? L('Verified: no business data remains.', 'تم التحقق: لا تبقى أي بيانات أعمال.')
      : L(`WARNING: ${r.residual.length} key(s) still present — ${r.residual.join(', ')}`,
          `تحذير: ${r.residual.length} مفتاح ما زال موجوداً — ${r.residual.join('، ')}`),
  ];
}
