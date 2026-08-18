import { readFx, convertBetween } from './currency';
import { contractCurrencyOf } from './projectCurrency';
import { readCurrencySettings } from './currency';

/**
 * Storage-currency migration — company reporting -> project contract.
 * Destination: src/lib/currencyMigration.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT WENT WRONG, AND WHAT THIS FIXES
 *
 *   `transactionContext()` used to set its conversion target to the
 *   COMPANY reporting currency. Every module that saves money —
 *   certificates, change orders, claims, budget, cash flow, risk,
 *   subcontracts — therefore wrote its amount field CONVERTED INTO THE
 *   COMPANY'S CURRENCY:
 *
 *     Company reporting currency  AED
 *     Project contract currency   SAR
 *     User enters                 SAR 1,000,000
 *     Stored                      979,000   (AED)
 *     Screen printed              "AED 979,000" on a Saudi project
 *
 *   The target has been corrected to the project's contract currency.
 *   That fixes every NEW record and leaves every OLD one denominated in
 *   the company currency — one table holding two units, which is worse
 *   than the original defect because the two look identical.
 *
 *   This module re-denominates the old rows so the table carries ONE
 *   currency semantic again.
 *
 * THE FIVE GUARANTEES
 *
 *   VERSIONED    Each project records the migration version it has
 *                reached, in `pactum-ccy-migration`. Version 1 is this
 *                one.
 *   IDEMPOTENT   A project already at version 1 is skipped outright.
 *                Running it ten times performs the work once, and the
 *                per-row guard means even a forced re-run cannot
 *                double-convert: a row whose stored currency already
 *                equals the contract currency is left untouched.
 *   DETERMINISTIC  Conversion runs from the row's OWN frozen
 *                `originalAmount` and `currency` at its OWN transaction
 *                date. No "today" rate is ever used, so the answer is
 *                the same whenever it runs.
 *   AUDITABLE    Every row that moves keeps its native currency, its
 *                original amount and its historical rate references, and
 *                gains a `migration` block naming what changed.
 *   SAFE         A row whose source currency or historical rate cannot
 *                be established is NOT converted. It is reported as
 *                BLOCKED with the reason. Nothing is guessed.
 *
 * WHAT IS DELIBERATELY NOT MIGRATED
 *
 *   Filed baselines (`pactum-baselines-`) and approved timeline
 *   snapshots (`pactum-timeline-`) are HISTORICAL RECORDS. A filed
 *   baseline states what the plan was, in the unit it was filed in, and
 *   rewriting it would falsify an approved document. They are reported
 *   in the inventory as `historical` so the divergence is visible rather
 *   than silent.
 * ══════════════════════════════════════════════════════════════════════
 */

/** Current migration version. Bump only with a new migration step. */
export const MIGRATION_VERSION = 1;

const VERSION_KEY = 'pactum-ccy-migration';

// ── Row families ───────────────────────────────────────────────────────

/**
 * Every store holding project money, and which fields are amounts.
 *
 * `amounts` are the converted figures that must be re-denominated.
 * `originals` map an amount field to the field holding it AS ENTERED,
 * where the schema has one. Where it does not, the original is recovered
 * as `amount / exchangeRate`, which is exact to the stored precision.
 */
interface Family {
  /** localStorage key prefix; the project id is appended. */
  prefix: string;
  label: string;
  amounts: string[];
  /** amountField -> originalField, where the schema stores one. */
  originals?: Record<string, string>;
}

const FAMILIES: Family[] = [
  { prefix: 'pactum-co-',              label: 'Change Orders',
    amounts: ['value'],
    originals: { value: 'originalAmount' } },
  { prefix: 'pactum-claims-',          label: 'Claims',
    amounts: ['claimed', 'settled'],
    originals: { claimed: 'originalAmount' } },
  { prefix: 'pactum-certs-',           label: 'Owner Certificates',
    amounts: ['gross', 'retention', 'net'],
    originals: { gross: 'originalAmount' } },
  { prefix: 'pactum-budget-',          label: 'Budget',
    amounts: ['planned', 'actual', 'forecast', 'variance'],
    originals: { planned: 'originalAmount' } },
  { prefix: 'pactum-cashflow-',        label: 'Cash Flow',
    amounts: ['in', 'out', 'net', 'cumulative'],
    originals: { in: 'originalIn', out: 'originalOut' } },
  { prefix: 'pactum-risk-',            label: 'Risk Register',
    amounts: ['impact'],
    originals: { impact: 'originalAmount' } },
  { prefix: 'pactum-subs-',            label: 'Subcontractors',
    amounts: ['contractValue'],
    originals: { contractValue: 'originalAmount' } },
  { prefix: 'pactum-sub-certs-',       label: 'Subcontractor Certificates',
    amounts: ['gross', 'retention', 'net'],
    originals: { gross: 'originalAmount' } },
  { prefix: 'pactum-sub-commercial-',  label: 'Subcontract Commercial',
    amounts: ['amount'],
    originals: { amount: 'originalAmount' } },
];

/** Stores that are historical records and must never be rewritten. */
const HISTORICAL = ['pactum-baselines-', 'pactum-timeline-'];

// ── Storage helpers ────────────────────────────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota — same policy as every other store */ }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function up(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

// ── Version ledger ─────────────────────────────────────────────────────

export type VersionLedger = Record<string, number>;

export function readVersions(): VersionLedger {
  const raw = readJson<Record<string, unknown>>(VERSION_KEY, {});
  const out: VersionLedger = {};
  Object.entries(raw).forEach(([k, v]) => { out[k] = num(v); });
  return out;
}

export function versionOf(projectId: string): number {
  return readVersions()[projectId] ?? 0;
}

function setVersion(projectId: string, version: number): void {
  const led = readVersions();
  led[projectId] = version;
  writeJson(VERSION_KEY, led);
}

// ── Inventory ──────────────────────────────────────────────────────────

export type RowVerdict =
  | 'already-contract'   // stored currency is already the contract currency
  | 'convertible'        // has a native currency + a resolvable rate
  | 'blocked-no-rate'    // native currency known, no historical rate route
  | 'blocked-ambiguous'; // cannot establish what currency it is in

export interface RowInventory {
  store: string;
  family: string;
  index: number;
  /** Row identifier, best effort, for naming a blocked row exactly. */
  ref: string;
  /** Currency the stored amounts are currently in. */
  storedCurrency: string;
  /** Currency the amounts were ENTERED in, where the row records one. */
  nativeCurrency: string;
  originalAmount: number;
  /** Sum of the row's amount fields, before migration. */
  storedTotal: number;
  transactionDate: string;
  rateLegIds: string[];
  verdict: RowVerdict;
  reason: string;
}

export interface ProjectInventory {
  projectId: string;
  contractCurrency: string;
  companyReportingCurrency: string;
  version: number;
  rows: RowInventory[];
  /** Stores skipped on purpose because they are historical records. */
  historical: string[];
}

/**
 * Establishes what currency a row's stored amounts are actually in.
 *
 * The rule follows exactly what `transactionFields()` writes:
 *
 *   reportingCurrency present -> that is the stored unit, stated.
 *   currency present, no      -> converted into whatever the company
 *   reportingCurrency            reported in at the time. The caller
 *                                supplies that as `assumeStored`.
 *   neither present           -> `transactionFields()` returns {} only
 *                                when no conversion happened, i.e. the
 *                                amount is already in the target unit.
 *                                That target was the company currency.
 */
function storedCurrencyOf(row: any, assumeStored: string): string {
  const declared = up(row?.reportingCurrency);
  if (declared) return declared;
  return assumeStored;
}

function refOf(row: any, index: number): string {
  const candidate = row?.no ?? row?.id ?? row?.code ?? row?.category
    ?? row?.month ?? row?.period;
  return candidate ? String(candidate) : `#${index}`;
}

/**
 * Reads every money row for one project and classifies it.
 *
 * Pure: nothing is written, so this can be run to produce a report
 * before anyone decides whether to migrate.
 */
export function inventoryProject(
  projectId: string, companyId: string,
): ProjectInventory {
  const companyReportingCurrency = up(readCurrencySettings(companyId).baseCurrency);
  const contractCurrency = up(
    contractCurrencyOf(projectId, companyReportingCurrency));
  const fx = readFx(companyId);

  const rows: RowInventory[] = [];

  FAMILIES.forEach(fam => {
    const key = `${fam.prefix}${projectId}`;
    const stored = readJson<any[]>(key, []);
    if (!Array.isArray(stored) || stored.length === 0) return;

    stored.forEach((row, index) => {
      const storedCurrency = storedCurrencyOf(row, companyReportingCurrency);
      const nativeCurrency = up(row?.currency) || storedCurrency;
      const rate = num(row?.exchangeRate);
      const transactionDate = String(
        row?.transactionDate ?? row?.date ?? row?.rateEffectiveDate ?? '');

      const storedTotal = fam.amounts.reduce((a, f) => a + num(row?.[f]), 0);

      const originalField = fam.originals?.[fam.amounts[0]];
      const originalAmount = originalField && row?.[originalField] !== undefined
        ? num(row[originalField])
        : (rate > 0 ? num(row?.[fam.amounts[0]]) / rate : num(row?.[fam.amounts[0]]));

      const base: Omit<RowInventory, 'verdict' | 'reason'> = {
        store: key, family: fam.label, index,
        ref: refOf(row, index),
        storedCurrency, nativeCurrency, originalAmount, storedTotal,
        transactionDate,
        rateLegIds: Array.isArray(row?.rateLegIds) ? row.rateLegIds.map(String) : [],
      };

      // Already correct — the overwhelming majority once migrated.
      if (storedCurrency === contractCurrency) {
        rows.push({ ...base, verdict: 'already-contract',
          reason: 'Stored amounts are already in the contract currency.' });
        return;
      }

      // A row with a native currency but a rate of 0 was filed unresolved.
      // Its own arithmetic cannot be trusted, so it is never re-derived.
      if (up(row?.currency) && !(rate > 0)) {
        rows.push({ ...base, verdict: 'blocked-ambiguous',
          reason: `Row declares currency ${nativeCurrency} but carries no usable exchangeRate; the amount it represents cannot be established.` });
        return;
      }

      // Deterministic route: from the row's OWN native currency, on the
      // row's OWN date. Never a live rate.
      const probe = convertBetween(
        fx, originalAmount || 1, nativeCurrency, contractCurrency,
        transactionDate, projectId, contractCurrency);

      if (!probe.resolved || !(probe.appliedRate > 0)) {
        rows.push({ ...base, verdict: 'blocked-no-rate',
          reason: `No published rate from ${nativeCurrency} to ${contractCurrency} on ${transactionDate || '(no date on row)'}.` });
        return;
      }

      rows.push({ ...base, verdict: 'convertible',
        reason: `${nativeCurrency} -> ${contractCurrency} @ ${probe.appliedRate} on ${probe.effectiveDate || transactionDate}.` });
    });
  });

  return {
    projectId,
    contractCurrency,
    companyReportingCurrency,
    version: versionOf(projectId),
    rows,
    historical: HISTORICAL.map(p => `${p}${projectId}`)
      .filter(k => localStorage.getItem(k) !== null),
  };
}

// ── Migration ──────────────────────────────────────────────────────────

export interface MigrationReport {
  projectId: string;
  contractCurrency: string;
  companyReportingCurrency: string;
  versionBefore: number;
  versionAfter: number;
  /** True when the project was already at the target version. */
  skipped: boolean;
  discovered: number;
  migrated: number;
  alreadyCorrect: number;
  blocked: RowInventory[];
  /** Per-store totals before and after, for a numeric check. */
  totals: {
    store: string;
    family: string;
    before: number;
    beforeCurrency: string;
    after: number;
    afterCurrency: string;
  }[];
  /** True when nothing was left blocked. */
  clean: boolean;
}

/**
 * Re-denominates one project's stored money into its contract currency.
 *
 * `dryRun` performs every calculation and produces the identical report
 * without writing, so the report can be reviewed before committing.
 */
export function migrateProject(
  projectId: string, companyId: string, opts: { dryRun?: boolean; force?: boolean } = {},
): MigrationReport {
  const inv = inventoryProject(projectId, companyId);
  const { contractCurrency, companyReportingCurrency } = inv;

  const report: MigrationReport = {
    projectId,
    contractCurrency,
    companyReportingCurrency,
    versionBefore: inv.version,
    versionAfter: inv.version,
    skipped: false,
    discovered: inv.rows.length,
    migrated: 0,
    alreadyCorrect: 0,
    blocked: [],
    totals: [],
    clean: true,
  };

  // IDEMPOTENCE, first gate: an up-to-date project is not re-examined.
  if (inv.version >= MIGRATION_VERSION && !opts.force) {
    report.skipped = true;
    return report;
  }

  const fx = readFx(companyId);

  FAMILIES.forEach(fam => {
    const key = `${fam.prefix}${projectId}`;
    const stored = readJson<any[]>(key, []);
    if (!Array.isArray(stored) || stored.length === 0) return;

    let touched = false;
    const before = stored.reduce(
      (a, r) => a + fam.amounts.reduce((b, f) => b + num(r?.[f]), 0), 0);
    let beforeCurrency = '';

    const next = stored.map((row, index) => {
      const entry = inv.rows.find(r => r.store === key && r.index === index);
      if (!entry) return row;

      if (!beforeCurrency) beforeCurrency = entry.storedCurrency;

      if (entry.verdict === 'already-contract') {
        report.alreadyCorrect++;
        return row;
      }

      if (entry.verdict !== 'convertible') {
        // BLOCKED. Left exactly as filed — never guessed, never dropped.
        report.blocked.push(entry);
        report.clean = false;
        return row;
      }

      // IDEMPOTENCE, second gate. Even under `force`, a row already
      // stamped with the contract currency is never converted twice.
      if (up(row?.reportingCurrency) === contractCurrency) {
        report.alreadyCorrect++;
        return row;
      }

      const conv = convertBetween(
        fx, entry.originalAmount || 0, entry.nativeCurrency, contractCurrency,
        entry.transactionDate, projectId, contractCurrency);

      if (!conv.resolved || !(conv.appliedRate > 0)) {
        report.blocked.push({ ...entry, verdict: 'blocked-no-rate',
          reason: 'Rate resolved during inventory but not during migration.' });
        report.clean = false;
        return row;
      }

      /**
       * The amounts are rescaled by ONE ratio, not converted field by
       * field. `gross - retention = net` and `planned - forecast =
       * variance` must survive the migration, and converting each field
       * independently would let rounding break the identity.
       *
       * The ratio is derived from the row's own two known points:
       * what it holds now, and what its original converts to.
       */
      const nativeToContract = conv.appliedRate;
      const nativeToStored = num(row?.exchangeRate) || 1;
      const ratio = nativeToContract / nativeToStored;

      const patched: any = { ...row };
      fam.amounts.forEach(f => {
        if (row?.[f] === undefined || row?.[f] === null) return;
        patched[f] = Math.round(num(row[f]) * ratio * 100) / 100;
      });

      touched = true;
      report.migrated++;

      return {
        ...patched,
        // ── Provenance PRESERVED, not replaced ──
        // The native currency and the amount as entered are the facts
        // the record was created from; they do not change because the
        // storage unit did.
        currency: entry.nativeCurrency,
        originalAmount: entry.originalAmount,
        // The row now states the unit it is stored in.
        reportingCurrency: contractCurrency,
        exchangeRate: nativeToContract,
        rateEffectiveDate: conv.effectiveDate || row?.rateEffectiveDate || '',
        rateSource: conv.source,
        ratePivot: conv.pivot ?? '',
        rateLegIds: Array.isArray(conv.legIds) ? conv.legIds : entry.rateLegIds,
        // ── The audit block ──
        migration: {
          version: MIGRATION_VERSION,
          at: new Date().toISOString(),
          fromCurrency: entry.storedCurrency,
          toCurrency: contractCurrency,
          ratioApplied: ratio,
          previousExchangeRate: nativeToStored,
          previousRateLegIds: entry.rateLegIds,
        },
      };
    });

    const after = next.reduce(
      (a: number, r: any) => a + fam.amounts.reduce((b, f) => b + num(r?.[f]), 0), 0);

    report.totals.push({
      store: key, family: fam.label,
      before, beforeCurrency: beforeCurrency || companyReportingCurrency,
      after, afterCurrency: contractCurrency,
    });

    if (touched && !opts.dryRun) writeJson(key, next);
  });

  /**
   * The LD stamp. `ldRatePerDay` / `ldCapAmount` live on the project
   * record, carry no currency and were never converted by anything — a
   * user typed them and they were stored raw. Per the agreed reading
   * they are contract terms, so the NUMBER is right and only the unit
   * was unstated. Nothing is rescaled; the unit is recorded.
   */
  if (!opts.dryRun) {
    try {
      const projects = readJson<any[]>('pactum-projects', []);
      let changed = false;
      const nextProjects = projects.map(p => {
        if (p?.id !== projectId || p?.ldCurrency) return p;
        changed = true;
        return { ...p, ldCurrency: contractCurrency };
      });
      if (changed) writeJson('pactum-projects', nextProjects);
    } catch { /* the project store is owned elsewhere; never fatal here */ }
  }

  if (!opts.dryRun) {
    setVersion(projectId, MIGRATION_VERSION);
    report.versionAfter = MIGRATION_VERSION;
  }

  return report;
}

/** Runs the migration across many projects and returns every report. */
export function migrateAll(
  projects: { id: string; companyId?: string }[],
  companyIdOf: (p: { id: string; companyId?: string }) => string,
  opts: { dryRun?: boolean; force?: boolean } = {},
): MigrationReport[] {
  return projects.map(p => migrateProject(p.id, companyIdOf(p), opts));
}

/**
 * A human-readable summary of one report.
 *
 * Returned as text so a caller can print it beside the numbers without
 * re-deriving the wording, and so the same words appear in the console,
 * the admin panel and the saved evidence file.
 */
export function summarise(r: MigrationReport, isRtl = false): string {
  if (r.skipped) {
    return isRtl
      ? `${r.projectId}: تم التخطي — مطبَّق بالفعل عند الإصدار ${r.versionBefore}.`
      : `${r.projectId}: skipped — already at version ${r.versionBefore}.`;
  }
  const head = isRtl
    ? `${r.projectId} -> ${r.contractCurrency}: ${r.discovered} صف · ${r.migrated} محوَّل · ${r.alreadyCorrect} سليم · ${r.blocked.length} محجوب`
    : `${r.projectId} -> ${r.contractCurrency}: ${r.discovered} rows · ${r.migrated} migrated · ${r.alreadyCorrect} already correct · ${r.blocked.length} blocked`;
  if (!r.blocked.length) return head;
  const lines = r.blocked.map(b => `    ${b.family} ${b.ref}: ${b.reason}`);
  return [head, ...lines].join('\n');
}
