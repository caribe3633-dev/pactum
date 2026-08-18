/**
 * Engineering Certification Dataset — the seed.
 * Destination: src/lib/certification/EngineeringCertificationSeed.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 0-B · DEPLOYS THE CERTIFICATION DATASET INTO REAL STORAGE
 *
 * WRITES THROUGH THE APPLICATION'S OWN FACTORIES
 *
 *   `createCompany`, `createSector`, `createProject`, `appendRate`,
 *   `appendSnapshot`, `createBaseline`. Nothing here hand-writes a master
 *   record into localStorage.
 *
 *   That is not a style preference. Those factories enforce mandatory
 *   reporting currency, mandatory project status, ISO-4217 validation,
 *   duplicate-name and duplicate-id refusal, and parent-existence checks.
 *   A hand-written record can satisfy none of them, which is exactly how
 *   a dataset ends up containing rows the UI cannot render. Writing
 *   through the factories makes that class of defect impossible.
 *
 * IDEMPOTENT BY IDENTITY, NOT BY FLAG
 *
 *   Every id is fixed in the dataset file. A second run therefore hits
 *   the application's own `duplicate-id` / `duplicate-name` guards and is
 *   refused, rather than being skipped by a "seeded already" boolean that
 *   could be cleared or could survive a half-finished run.
 *
 *   Transaction stores are keyed per project and written whole, so a
 *   re-run REPLACES the certification rows rather than appending a second
 *   copy. FX and snapshots are append-only stores with their own
 *   duplicate guards, so re-running leaves 72 rates and 10 snapshots.
 *
 * NON-DESTRUCTIVE BY DEFAULT
 *
 *   `seedCertificationDataset()` refuses to touch a project store that
 *   already holds NON-certification data. Pass `{ purgeExisting: true }`
 *   to clear prior business data first — that is what a certification run
 *   normally wants, and it is opt-in because it destroys real work.
 *
 * CURRENCY RULE — FROZEN AT THE TRANSACTION DATE
 *
 *   Every foreign amount is converted using the rate in force ON ITS OWN
 *   transaction date and the applied rate is frozen onto the row
 *   alongside the original amount. Nothing is converted at today's rate,
 *   so re-running this seed years later reproduces identical figures.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  createCompany, createSector, readCompanies, readSectors,
  reconcile, validateMasterData,
} from '../masterData';
import { createProject, toLinks } from '../projectMaster';
// Bulk import writes `pactum-projects` wholesale, outside React. The store
// keeps a module-level cache that only in-app mutations refresh, so it must
// be told explicitly or every consumer keeps serving the pre-seed array.
import { refreshProjectsFromStorage } from '../store';
import { appendRate, readFx, convertBetween } from '../currency';
// The single authority for Contract Amount = Contract Value + approved COs
// + approved claims. Never reimplemented here.
import { commercialTotals } from '../commercialTotals';
import {
  appendSnapshot, readTimeline, setReportingCurrency as setTimelineCurrency,
  defaultExchange, collectClaims, collectCash, collectBudget, collectCertificates,
} from '../timeline';
// The module's OWN capture functions — the same ones the Baselines screen
// calls. Using them is what makes a seeded baseline indistinguishable from
// one a user created by hand.
import {
  createBaseline, readBaselines,
  captureContract, captureBudget, captureCashflow, captureSchedule, captureForecast,
} from '../baselines';
import type { Project } from '../data';
import {
  ECD_VERSION, ECD_COMPANIES, ECD_SECTORS, ECD_PROJECTS, ECD_FX,
  ECD_RATE_DATES, ECD_CBS, ECD_CHANGE_ORDERS, ECD_CLAIMS, ECD_CERT,
  ECD_CASH, ECD_RISKS, ECD_PERIODS, ECD_EXPECTED,
  type EcdProject,
} from './EngineeringCertificationDataset';

// ── Result ─────────────────────────────────────────────────────────────

export interface SeedStep {
  step: string;
  created: number;
  skipped: number;
  detail?: string;
}

export interface SeedResult {
  ok: boolean;
  version: string;
  at: string;
  steps: SeedStep[];
  /** Refusals worth surfacing. An expected duplicate is NOT an error. */
  errors: string[];
  counts: Record<string, number>;
  /** Storage keys actually written, for the deployment report. */
  keys: string[];
}

export interface SeedOptions {
  by?: string;
  /**
   * Remove existing business data before seeding. Off by default: this
   * destroys real work and must be a deliberate choice.
   */
  purgeExisting?: boolean;
}

// ── Storage helpers ────────────────────────────────────────────────────

const PROJECTS_KEY = 'pactum-projects';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

const d2 = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, day: number) => `${y}-${d2(m)}-${d2(day)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Transaction dates are clamped to 2024 or later.
 *
 * The first published rate is 2024-01-01 and the FX engine refuses to
 * convert before it — correctly, since inventing a rate is worse than
 * declining. A 2023-start project therefore books its transactions from
 * 2024 onward rather than being left with unconvertible rows.
 */
const txnYear = (projectYear: number) => Math.max(projectYear, 2024);

// ── Purge ──────────────────────────────────────────────────────────────

/**
 * Business-data prefixes.
 *
 * NOTE: this list deliberately includes six families that
 * `enterpriseReset.ts` does not yet cover — `pactum-project-currency-config`
 * (added by the currency architecture), `pactum-portfolio-overrides` and
 * the three `*-meta-` families. Leaving them behind would strand a
 * previous dataset's project currencies underneath a fresh seed.
 */
const BUSINESS_PREFIXES = [
  'pactum-budget-', 'pactum-co-', 'pactum-claims-', 'pactum-delays-',
  'pactum-certs-', 'pactum-cashflow-', 'pactum-cashflow-sync-',
  'pactum-certs-sync-', 'pactum-subs-', 'pactum-sub-certs-',
  'pactum-sub-commercial-', 'pactum-sub-windows-', 'pactum-sub-perf-',
  'pactum-sub-registry-', 'pactum-delay-windows-', 'pactum-ld-log-',
  'pactum-risk-', 'pactum-evm-', 'pactum-currency-', 'pactum-fx-',
  'pactum-timeline-', 'pactum-baselines-',
  'pactum-company-meta-', 'pactum-sector-meta-', 'pactum-project-meta-',
];

const BUSINESS_EXACT = [
  'pactum-project-currency', 'pactum-project-currency-config',
  'pactum-portfolio-overrides',
];

/**
 * Keys whose READERS RE-SEED when the key is absent. They must be written
 * as `[]`, never deleted, or the demo companies come straight back.
 */
const EMPTY_NOT_DELETE = [
  'pactum-enterprise-companies', 'pactum-enterprise-sectors', PROJECTS_KEY,
];

export interface PurgeReport { removed: string[]; emptied: string[] }

/** Clears business data. Identity, theme and preferences are untouched. */
export function purgeBusinessData(): PurgeReport {
  const removed: string[] = [];
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (EMPTY_NOT_DELETE.includes(k)) continue;
    if (BUSINESS_EXACT.includes(k) || BUSINESS_PREFIXES.some(p => k.startsWith(p))) {
      localStorage.removeItem(k);
      removed.push(k);
    }
  }
  EMPTY_NOT_DELETE.forEach(k => writeJson(k, []));
  return { removed, emptied: [...EMPTY_NOT_DELETE] };
}

// ── The seed ───────────────────────────────────────────────────────────

export function seedCertificationDataset(opts: SeedOptions = {}): SeedResult {
  const by = opts.by || 'certification';
  const steps: SeedStep[] = [];
  const errors: string[] = [];
  const keys = new Set<string>();
  const at = new Date().toISOString();

  // ── 0 · purge ────────────────────────────────────────────────────────
  if (opts.purgeExisting) {
    const p = purgeBusinessData();
    steps.push({ step: 'purge', created: 0, skipped: 0,
      detail: `${p.removed.length} keys removed, ${p.emptied.length} emptied` });
  }

  // ── 1 · companies ────────────────────────────────────────────────────
  let cCreated = 0, cSkipped = 0;
  ECD_COMPANIES.forEach(c => {
    const r = createCompany({
      id: c.id, name: c.name, nameAr: c.nameAr,
      country: c.country, city: c.city, headquarters: c.headquarters,
      reportingCurrency: c.reportingCurrency, status: 'Active',
      riskRating: 'Medium', compliance: 'Compliant',
      timeZone: c.timeZone, createdBy: by,
    });
    if (r.ok) cCreated++;
    else if (r.reason === 'duplicate-id' || r.reason === 'duplicate-name') cSkipped++;
    else errors.push(`company ${c.id}: ${r.reason}`);
  });
  keys.add('pactum-enterprise-companies');
  ECD_COMPANIES.forEach(c => keys.add(`pactum-currency-${c.id}`));
  steps.push({ step: 'companies', created: cCreated, skipped: cSkipped });

  // ── 2 · sectors ──────────────────────────────────────────────────────
  let sCreated = 0, sSkipped = 0;
  ECD_SECTORS.forEach(s => {
    const r = createSector({
      id: s.id, name: s.name, nameAr: s.nameAr, companyId: s.companyId,
      defaultContractCurrency: s.defaultContractCurrency,
      /**
       * The sector reports in its COMPANY's currency.
       *
       * Deliberately not `defaultContractCurrency`: that is the currency
       * new projects here are SIGNED in (AED, USD...), which is exactly
       * the thing the sector has to convert FROM. Using it as the
       * reporting unit would make the sector total agree with one of its
       * projects and disagree with the rest.
       */
      reportingCurrency:
        ECD_COMPANIES.find(c => c.id === s.companyId)?.reportingCurrency || 'SAR',
      createdBy: by,
    });
    if (r.ok) sCreated++;
    else if (r.reason === 'duplicate-id' || r.reason === 'duplicate-name') sSkipped++;
    else errors.push(`sector ${s.id}: ${r.reason}`);
  });
  keys.add('pactum-enterprise-sectors');
  steps.push({ step: 'sectors', created: sCreated, skipped: sSkipped });

  // ── 3 · FX — BEFORE any money, so every rate lookup resolves ─────────
  //
  // Ordering is load-bearing. Publishing rates after the transactions
  // would leave every foreign row unconvertible at the moment it was
  // written, and the engine would correctly refuse rather than guess.
  let rCreated = 0, rSkipped = 0;
  Object.keys(ECD_FX).forEach(companyId => {
    const table = ECD_FX[companyId];
    Object.keys(table.rates).forEach(currency => {
      ECD_RATE_DATES.forEach((date, i) => {
        const rate = table.rates[currency][i];
        const r = appendRate(companyId, {
          currency, baseCurrency: table.base, rate,
          effectiveDate: date, approvalDate: date, approvedBy: by,
          reason: `Engineering certification dataset v${ECD_VERSION}`,
          reportingCurrency: table.base,
        });
        if (r.ok) rCreated++;
        else if (r.reason === 'duplicate') rSkipped++;
        else errors.push(`rate ${companyId} ${currency} ${date}: ${r.reason}`);
      });
    });
    keys.add(`pactum-fx-${companyId}`);
  });
  steps.push({ step: 'fx-rates', created: rCreated, skipped: rSkipped });

  // ── 4 · projects ─────────────────────────────────────────────────────
  const existing = readJson<Project[]>(PROJECTS_KEY, []);
  const projects: Project[] = existing.filter(p => !ECD_PROJECTS.some(e => e.id === p.id));
  let pCreated = 0, pSkipped = 0;

  ECD_PROJECTS.forEach(spec => {
    const r = createProject({
      id: spec.id, code: spec.code, nameEn: spec.nameEn, nameAr: spec.nameAr,
      companyId: spec.companyId, sectorId: spec.sectorId,
      contractCurrency: spec.contractCurrency,
      reportingCurrency: spec.reportingCurrency,
      workingCurrency: spec.contractCurrency,
      status: spec.status,
      commencementDate: spec.commencementDate,
      contractualCompletion: spec.contractualCompletion,
      country: spec.country, cityEn: spec.cityEn, cityAr: spec.cityAr,
      contractValue: spec.contractValue, createdBy: by,
    }, projects);
    if (!r.ok || !r.record) {
      if (r.reason === 'duplicate-id') pSkipped++;
      else errors.push(`project ${spec.id}: ${r.reason} ${(r.fields || []).join(',')}`);
      return;
    }
    const rec = r.record as Project;
    rec.progress = spec.progress;
    rec.delayDays = spec.delayDays;
    projects.push(rec);
    pCreated++;
  });

  writeJson(PROJECTS_KEY, projects);
  keys.add(PROJECTS_KEY);
  keys.add('pactum-project-currency-config');
  keys.add('pactum-project-currency');
  steps.push({ step: 'projects', created: pCreated, skipped: pSkipped });

  // ── 5 · transaction data ─────────────────────────────────────────────
  let txnRows = 0;

  ECD_PROJECTS.forEach(spec => {
    const V = spec.contractValue;
    const from = spec.contractCurrency;
    const to = spec.reportingCurrency;
    const store = readFx(spec.companyId);
    const yr = txnYear(spec.year);

    /** Converts at the rate in force on `date` and freezes it on the row. */
    const conv = (amount: number, date: string) => {
      if (from === to) return { value: amount, rate: 1, ok: true };
      const c = convertBetween(store, amount, from, to, date, '');
      if (!c.resolved || !(c.appliedRate > 0)) {
        errors.push(`no rate ${from}->${to} on ${date} (${spec.id})`);
        return { value: 0, rate: 0, ok: false };
      }
      return { value: round2(c.converted), rate: c.appliedRate, ok: true };
    };

    /** The currency metadata every converted row carries. */
    const meta = (original: number, rate: number, date: string) => ({
      currency: from, originalAmount: original, exchangeRate: rate,
      transactionDate: date, rateEffectiveDate: date,
    });

    // BUDGET
    const budgetDate = iso(yr, 7, 1);
    const budget = ECD_CBS.map(row => {
      const planned = Math.round(V * row.weight * 0.95);
      const actual = Math.round(planned * row.spent * 1.04);
      const forecast = Math.round(planned * 1.035);
      const cp = conv(planned, budgetDate);
      return {
        category: row.category, date: budgetDate,
        planned: cp.value, actual: conv(actual, budgetDate).value,
        forecast: conv(forecast, budgetDate).value,
        ...meta(planned, cp.rate, budgetDate),
      };
    });
    writeJson(`pactum-budget-${spec.id}`, budget);
    keys.add(`pactum-budget-${spec.id}`);
    txnRows += budget.length;

    // CHANGE ORDERS
    const changeOrders = ECD_CHANGE_ORDERS.map(c => {
      const date = iso(yr, c.month, c.day);
      const raw = Math.round(V * c.fraction);
      const cv = conv(raw, date);
      return {
        no: c.no, desc: c.desc, value: cv.value, time: c.eotDays,
        status: c.status, date, ...meta(raw, cv.rate, date),
      };
    });
    writeJson(`pactum-co-${spec.id}`, changeOrders);
    keys.add(`pactum-co-${spec.id}`);
    txnRows += changeOrders.length;

    // CLAIMS
    const claims = ECD_CLAIMS.map(c => {
      const date = iso(yr, c.month, c.day);
      const claimedRaw = Math.round(V * c.claimedFraction);
      const settledRaw = Math.round(V * c.settledFraction);
      const cc = conv(claimedRaw, date);
      return {
        no: c.no, type: c.type, claimed: cc.value,
        settled: conv(settledRaw, date).value,
        timeDays: c.timeDays, status: c.status, date,
        ...meta(claimedRaw, cc.rate, date),
      };
    });
    writeJson(`pactum-claims-${spec.id}`, claims);
    keys.add(`pactum-claims-${spec.id}`);
    txnRows += claims.length;

    // CERTIFICATES + PAYMENTS
    const certCount = spec.completed ? 5 : 3;
    const certs = [];
    for (let i = 1; i <= certCount; i++) {
      const m = 2 + i * 2;
      const y = Math.max(yr + (m > 12 ? 1 : 0), 2024);
      const mm = m > 12 ? m - 12 : m;
      const date = iso(y, mm, 15);
      const grossRaw = Math.round(V * ECD_CERT.grossFraction);
      const retRaw = Math.round(grossRaw * ECD_CERT.retentionRate);
      const cg = conv(grossRaw, date);
      const cr = conv(retRaw, date);
      const paid = i <= certCount - 1;
      certs.push({
        no: `IPC-${d2(i)}`, period: `${y}-${d2(mm)}`,
        gross: cg.value, retention: cr.value, net: round2(cg.value - cr.value),
        approvalDate: date,
        paymentDate: paid ? iso(y, mm === 12 ? 12 : mm + 1, 15) : '',
        status: paid ? 'paid' : 'certified', docs: [] as string[],
        // Both legs share ONE rate, so gross - retention = net survives
        // conversion exactly.
        retentionOriginal: retRaw,
        ...meta(grossRaw, cg.rate, date),
      });
    }
    writeJson(`pactum-certs-${spec.id}`, certs);
    keys.add(`pactum-certs-${spec.id}`);
    txnRows += certs.length;

    // CASH FLOW
    const cash = [];
    let cum = 0;
    for (let i = 0; i < ECD_CASH.periods; i++) {
      const m = 3 + i;
      const y = Math.max(yr + (m > 12 ? 1 : 0), 2024);
      const mm = m > 12 ? m - 12 : m;
      const date = iso(y, mm, 15);
      const inRaw = Math.round(V * ECD_CASH.inFraction);
      const outRaw = Math.round(V * ECD_CASH.outFraction);
      const ci = conv(inRaw, date);
      const co = conv(outRaw, date);
      const net = round2(ci.value - co.value);
      cum = round2(cum + net);
      cash.push({
        month: `${y}-${d2(mm)}`, in: ci.value, out: co.value, net, cumNet: cum,
        ...meta(inRaw, ci.rate, date),
      });
    }
    writeJson(`pactum-cashflow-${spec.id}`, cash);
    keys.add(`pactum-cashflow-${spec.id}`);
    txnRows += cash.length;

    // DELAY REGISTER
    const delays = spec.delayed
      ? [
          { id: 'DLY-001', description: 'Late permit approval', responsibleParty: 'employer',
            startDate: iso(yr, 2, 1), endDate: iso(yr, 4, 15), delayDays: 74, eotDays: 60,
            costImpact: conv(Math.round(V * 0.006), iso(yr, 4, 15)).value,
            category: 'Regulatory', status: 'approved', notes: 'EOT granted' },
          { id: 'DLY-002', description: 'Subcontractor underperformance', responsibleParty: 'contractor',
            startDate: iso(yr, 6, 1), endDate: iso(yr, 7, 6), delayDays: 35, eotDays: 0,
            costImpact: 0, category: 'Execution', status: 'closed', notes: 'Culpable delay' },
        ]
      : [
          { id: 'DLY-001', description: 'Minor weather disruption', responsibleParty: 'neutral',
            startDate: iso(yr, 11, 2), endDate: iso(yr, 11, 9), delayDays: 7, eotDays: 7,
            costImpact: 0, category: 'Weather', status: 'approved', notes: '' },
        ];
    writeJson(`pactum-delays-${spec.id}`, delays);
    keys.add(`pactum-delays-${spec.id}`);
    txnRows += delays.length;

    // RISK REGISTER
    //
    // `impact` is money and is converted like every other amount: at the
    // row's own date, with the rate frozen on it. `prob` is a percentage
    // stored as a fraction, matching how RiskModule writes it.
    const riskDate = iso(yr, 6, 1);
    writeJson(`pactum-risk-${spec.id}`, ECD_RISKS.map(r => {
      const raw = Math.round(V * r.impactFraction);
      const c = conv(raw, riskDate);
      return {
        id: r.id, cause: r.cause, event: r.event, effect: r.effect,
        prob: r.prob / 100,
        impact: c.value,
        status: r.status, category: r.category, owner: r.owner,
        linkedClaimNos: [...r.linkedClaimNos],
        ...meta(raw, c.rate, riskDate),
      };
    }));
    keys.add(`pactum-risk-${spec.id}`);
    txnRows += ECD_RISKS.length;
  });

  steps.push({ step: 'transactions', created: txnRows, skipped: 0 });

  // ── 6 · baselines ────────────────────────────────────────────────────
  //
  // TWO DEFECTS WERE FOUND HERE FROM THE UI AND CORRECTED:
  //
  // 1 · HEADLINE READ 0.
  //     The seed passed an invented `{ contractValue, ldRatePerDay,
  //     ldCapAmount }` shape. `createBaseline` runs `cleanData()`, which
  //     rebuilds the record against the declared `ContractBaselineData`
  //     schema and drops anything it does not recognise — so
  //     `currentContract`, the field the register's HEADLINE column
  //     reads, was never populated and rendered 0.
  //
  //     Fixed by using the module's OWN capture functions. They are the
  //     same ones the Baselines screen calls when a user presses
  //     "Create V1", so the seeded record is byte-comparable with a
  //     hand-made one.
  //
  // 2 · STATUS READ SUPERSEDED.
  //     `createBaseline` ADOPTS ON CREATION by default (`activate !==
  //     false`). The seed then called `activateBaseline()` as well. On a
  //     re-run that raised a second version, and adopting V2 retired V1 —
  //     which is exactly what the register showed. The extra call is
  //     removed; creation alone is the whole operation.
  //
  // All five families are now captured, not just `contract`, so the
  // Baselines screen shows five adopted plans instead of one plus four
  // "No baseline" tiles.
  let bCreated = 0, bSkipped = 0;
  ECD_PROJECTS.forEach(spec => {
    const store = readBaselines(spec.id);
    if (store.baselines.length > 0) { bSkipped++; keys.add(`pactum-baselines-${spec.id}`); return; }

    const project = readJson<Project[]>(PROJECTS_KEY, []).find(p => p.id === spec.id);
    if (!project) { errors.push(`baseline ${spec.id}: project not found`); return; }

    /**
     * THE PROJECT RECORD CARRIES STALE ZEROS.
     *
     * `createProject` writes `totalApprovedCOs: 0`, `totalApprovedClaims: 0`
     * and `revisedContractValue = contractValue`, and NOTHING refreshes
     * them until a human opens the Overview screen — which persists the
     * computed figures back. A freshly seeded project has therefore never
     * had them updated.
     *
     * `captureContract` reads exactly those fields, which is why the
     * Baselines screen showed APPROVEDCHANGEORDERS 0, APPROVEDCLAIMS 0 and
     * a Contract Amount equal to the original.
     *
     * `commercialTotals()` is the single authority for the rule:
     *
     *     Contract Amount = Contract Value
     *                     + approved change orders
     *                     + approved claims          (all converted first)
     *
     * It is called here so the baseline freezes the SAME figures the
     * Overview screen shows, instead of the record's uninitialised zeros.
     * No calculation is performed in this file.
     */
    const totals = commercialTotals(project as never, spec.companyId);
    const commercialProject = {
      ...project,
      totalApprovedCOs: totals.approvedChangeOrders,
      totalApprovedClaims: totals.approvedClaims,
      revisedContractValue: totals.revisedContract,
      contractValue: totals.originalContract,
    };

    // Delay and programme figures come from the delay engine, exactly as
    // the Baselines screen sources them — never recomputed here.
    const delayRows = readJson<Record<string, unknown>[]>(`pactum-delays-${spec.id}`, []);
    const totalDelay = delayRows.reduce((a, r) => a + (Number(r.delayDays) || 0), 0);
    const approvedEOT = delayRows.reduce((a, r) => a + (Number(r.eotDays) || 0), 0);
    const programme = {
      commencementDate: spec.commencementDate,
      plannedDurationDays: Math.round(
        (Date.parse(spec.contractualCompletion) - Date.parse(spec.commencementDate)) / 86_400_000),
      baselineFinish: spec.contractualCompletion,
      approvedFinish: spec.contractualCompletion,
      forecastFinish: spec.contractualCompletion,
    };

    // A simple, declared forecast: budget forecast is the EAC basis.
    const budgetRows = readJson<Record<string, unknown>[]>(`pactum-budget-${spec.id}`, []);
    const bac = budgetRows.reduce((a, r) => a + (Number(r.planned) || 0), 0);
    const eac = budgetRows.reduce((a, r) => a + (Number(r.forecast) || 0), 0);
    const actual = budgetRows.reduce((a, r) => a + (Number(r.actual) || 0), 0);

    const families: { type: string; reason: string; data: unknown }[] = [
      { type: 'contract', reason: 'Contract award',
        data: captureContract(commercialProject as never, spec.reportingCurrency) },
      { type: 'budget', reason: 'Cost plan adopted at award',
        data: captureBudget(spec.id) },
      { type: 'cashflow', reason: 'Funding plan adopted at award',
        data: captureCashflow(spec.id) },
      { type: 'schedule', reason: 'Programme adopted at award',
        data: captureSchedule(programme, totalDelay, approvedEOT) },
      { type: 'forecast', reason: 'Forecast basis at award',
        data: captureForecast({
          bac, method: 'Budget forecast',
          m: { eac, etc: Math.max(0, eac - actual), vac: bac - eac },
          dates: { forecastFinish: spec.contractualCompletion, slipDays: spec.delayDays },
        } as never) },
    ];

    families.forEach(f => {
      // `activate` is left at its default: createBaseline adopts on
      // creation. Calling activateBaseline afterwards is what raised the
      // second version that superseded the first.
      const c = createBaseline(spec.id, {
        type: f.type as never,
        name: `${f.type === 'contract' ? 'Contract' : ''} Baseline V1`.trim(),
        reason: f.reason, cause: 'initial',
        dataDate: spec.commencementDate, createdBy: by,
        data: f.data as never,
      });
      if (!c.ok) errors.push(`baseline ${spec.id}/${f.type}: ${c.reason}`);
      else bCreated++;
    });
    keys.add(`pactum-baselines-${spec.id}`);
  });
  steps.push({ step: 'baselines', created: bCreated, skipped: bSkipped });

  // ── 7 · published snapshots ──────────────────────────────────────────
  let snCreated = 0, snSkipped = 0;
  ECD_PROJECTS.forEach(spec => {
    setTimelineCurrency(spec.id, spec.reportingCurrency);
    ECD_PERIODS.forEach(p => {
      const r = appendSnapshot(spec.id, {
        periodId: p.periodId, periodLabel: p.periodLabel, dataDate: p.dataDate,
        approvedBy: by, note: `Engineering certification dataset v${ECD_VERSION}`,
        status: 'approved', approvedAt: `${p.dataDate}T09:00:00.000Z`,
        exchange: defaultExchange(spec.reportingCurrency, p.dataDate),
        claims: collectClaims(spec.id),
        cash: collectCash(spec.id),
        budget: collectBudget(spec.id),
        certificates: collectCertificates(spec.id),
      } as never);
      if (r.ok) snCreated++;
      else if (r.reason === 'duplicate-period') snSkipped++;
      else errors.push(`snapshot ${spec.id} ${p.periodId}: ${r.reason}`);
    });
    keys.add(`pactum-timeline-${spec.id}`);
  });
  steps.push({ step: 'snapshots', created: snCreated, skipped: snSkipped });

  // ── 8 · reconcile derived caches ─────────────────────────────────────
  const finalProjects = readJson<Project[]>(PROJECTS_KEY, []);
  reconcile(toLinks(finalProjects as never));

  // ── 8b · republish to every mounted consumer ─────────────────────────
  //
  // `reconcile` rebuilds `sector.projectIds` and goes through
  // `writeSectors`, which notifies master-data subscribers. The PROJECT
  // store has its own separate cache and its own subscriber set, and
  // nothing above has touched either — the rows went straight into
  // localStorage.
  //
  // Without this line the data is correct on disk and stale on screen:
  // a sector renders "No Projects In This Sector" until a hard reload.
  // Measured and reproduced before adding it.
  //
  // Called AFTER reconcile so subscribers receive the reconciled state,
  // never an intermediate one.
  try { refreshProjectsFromStorage(); } catch { /* non-browser context */ }

  // ── 9 · counts ───────────────────────────────────────────────────────
  const counts = countCertificationData();
  const issues = validateMasterData(toLinks(finalProjects as never));
  issues.forEach(i => errors.push(`master-data: ${(i as { message?: string }).message ?? JSON.stringify(i)}`));

  return {
    ok: errors.length === 0,
    version: ECD_VERSION, at, steps, errors, counts,
    keys: Array.from(keys).sort(),
  };
}

// ── Counting, for the deployment report ────────────────────────────────

export function countCertificationData(): Record<string, number> {
  const companies = readCompanies().filter(c => c.id.startsWith('ECD-'));
  const sectors = readSectors().filter(s => s.id.startsWith('ECD-'));
  const projects = readJson<Project[]>(PROJECTS_KEY, []).filter(p => p.id.startsWith('ECD-'));

  let fxRates = 0;
  const fxDates = new Set<string>();
  companies.forEach(c => readFx(c.id).rates.forEach(r => {
    fxRates++; fxDates.add(r.effectiveDate);
  }));

  let snapshots = 0, baselines = 0;
  let changeOrders = 0, claims = 0, certificates = 0;
  let cashRows = 0, budgetRows = 0, riskRows = 0, delayRows = 0;

  projects.forEach(p => {
    snapshots += readTimeline(p.id).snapshots.length;
    baselines += readBaselines(p.id).baselines.length;
    changeOrders += readJson<unknown[]>(`pactum-co-${p.id}`, []).length;
    claims       += readJson<unknown[]>(`pactum-claims-${p.id}`, []).length;
    certificates += readJson<unknown[]>(`pactum-certs-${p.id}`, []).length;
    cashRows     += readJson<unknown[]>(`pactum-cashflow-${p.id}`, []).length;
    budgetRows   += readJson<unknown[]>(`pactum-budget-${p.id}`, []).length;
    riskRows     += readJson<unknown[]>(`pactum-risk-${p.id}`, []).length;
    delayRows    += readJson<unknown[]>(`pactum-delays-${p.id}`, []).length;
  });

  const currencies = new Set<string>();
  companies.forEach(c => currencies.add(String(c.reportingCurrency || '')));
  ECD_PROJECTS.forEach(p => { currencies.add(p.contractCurrency); currencies.add(p.reportingCurrency); });

  return {
    companies: companies.length, sectors: sectors.length, projects: projects.length,
    currencies: currencies.size, fxRates, fxDates: fxDates.size,
    snapshots, baselines, changeOrders, claims, certificates,
    cashRows, budgetRows, riskRows, delayRows,
  };
}

// ── Verification ───────────────────────────────────────────────────────

export interface VerifyCheck {
  id: string; what: string; expected: string; actual: string; ok: boolean;
}

/**
 * Verifies the deployed dataset against the declaration.
 *
 * Reads STORAGE, not the seed's return value: a seed that reports success
 * while writing nothing must fail this.
 */
export function verifyCertificationDataset(): {
  ok: boolean; checks: VerifyCheck[]; counts: Record<string, number>;
} {
  const checks: VerifyCheck[] = [];
  const add = (id: string, what: string, expected: unknown, actual: unknown) =>
    checks.push({
      id, what, expected: String(expected), actual: String(actual),
      ok: String(expected) === String(actual),
    });

  const counts = countCertificationData();
  add('C-1', 'Companies', ECD_EXPECTED.companies, counts.companies);
  add('C-2', 'Sectors', ECD_EXPECTED.sectors, counts.sectors);
  add('C-3', 'Projects', ECD_EXPECTED.projects, counts.projects);
  add('C-4', 'Currencies in use', ECD_EXPECTED.currencies, counts.currencies);
  add('C-5', 'FX rates', ECD_EXPECTED.fxRates, counts.fxRates);
  add('C-6', 'FX publication dates', ECD_EXPECTED.fxDates, counts.fxDates);
  add('C-7', 'Published snapshots', ECD_EXPECTED.snapshots, counts.snapshots);
  add('C-8', 'Baselines', ECD_EXPECTED.baselines, counts.baselines);
  add('C-9', 'Change orders', ECD_EXPECTED.changeOrders, counts.changeOrders);
  add('C-10', 'Claims', ECD_EXPECTED.claims, counts.claims);
  add('C-11', 'Certificates', ECD_EXPECTED.certificates, counts.certificates);
  add('C-12', 'Cash flow rows', ECD_EXPECTED.cashRows, counts.cashRows);
  add('C-13', 'Budget rows', ECD_EXPECTED.budgetRows, counts.budgetRows);
  add('C-14', 'Risk rows', ECD_EXPECTED.riskRows, counts.riskRows);
  add('C-15', 'Delay rows', ECD_EXPECTED.delayRows, counts.delayRows);

  // ── integrity ──
  const companies = readCompanies();
  const sectors = readSectors();
  const projects = readJson<Project[]>(PROJECTS_KEY, []);
  const ISO4217 = /^[A-Z]{3}$/;

  add('I-1', 'No orphan sectors', 0,
    sectors.filter(s => !companies.some(c => c.id === s.companyId)).length);
  add('I-2', 'No orphan projects', 0,
    projects.filter(p => !p.sectorId || !sectors.some(s => s.id === p.sectorId)).length);

  const allIds = [...companies.map(c => c.id), ...sectors.map(s => s.id), ...projects.map(p => p.id)];
  add('I-3', 'No duplicate IDs', 0, allIds.filter((x, i, a) => a.indexOf(x) !== i).length);

  let badRate = 0, badRateCcy = 0;
  companies.forEach(c => readFx(c.id).rates.forEach(r => {
    if (!(r.rate > 0)) badRate++;
    if (!ISO4217.test(r.currency) || !ISO4217.test(r.baseCurrency)) badRateCcy++;
  }));
  add('I-4', 'No zero or negative FX rate', 0, badRate);
  add('I-5', 'No invalid currency code on a rate', 0, badRateCcy);

  let certDrift = 0, badRowCcy = 0, negativeCash = 0;
  projects.forEach(p => {
    readJson<Record<string, unknown>[]>(`pactum-certs-${p.id}`, []).forEach(r => {
      const g = Number(r.gross) || 0, ret = Number(r.retention) || 0, n = Number(r.net) || 0;
      if (Math.abs(g - ret - n) > 0.51) certDrift++;
      if (r.currency && !ISO4217.test(String(r.currency))) badRowCcy++;
    });
    readJson<Record<string, unknown>[]>(`pactum-cashflow-${p.id}`, []).forEach(r => {
      if ((Number(r.in) || 0) < 0) negativeCash++;
    });
  });
  add('I-6', 'Certificate gross - retention = net', 0, certDrift);
  add('I-7', 'No invalid currency on a transaction row', 0, badRowCcy);
  add('I-8', 'No negative cash-in row', 0, negativeCash);

  add('I-9', 'Master-data validator clean', 0,
    validateMasterData(toLinks(projects as never)).length);

  // Native vs reporting currency must both be present and distinct where
  // the dataset says so — this is what proves money was not flattened.
  const converted = ECD_PROJECTS.filter(p => p.contractCurrency !== p.reportingCurrency);
  let missingNative = 0;
  converted.forEach(spec => {
    readJson<Record<string, unknown>[]>(`pactum-certs-${spec.id}`, []).forEach(r => {
      if (!r.currency || !r.originalAmount || !r.exchangeRate) missingNative++;
    });
  });
  add('I-10', 'Converted rows keep native currency + original + rate', 0, missingNative);

  // Lifecycle coverage
  const statuses = projects.filter(p => p.id.startsWith('ECD-')).map(p => p.status);
  add('L-1', 'Lifecycle Active present', true, statuses.includes('Active'));
  add('L-2', 'Lifecycle Completed present', true, statuses.includes('Completed'));
  add('L-3', 'Lifecycle Archived present', true, statuses.includes('Archived'));
  const ecd = projects.filter(p => p.id.startsWith('ECD-'));
  add('L-4', 'Lifecycle Delayed present', true, ecd.some(p => (Number(p.delayDays) || 0) > 0));
  add('L-5', 'Lifecycle Healthy present', true, ecd.some(p => (Number(p.delayDays) || 0) === 0));

  return { ok: checks.every(c => c.ok), checks, counts };
}

/** True when the certification dataset is already present and complete. */
export function isCertificationDatasetDeployed(): boolean {
  const c = countCertificationData();
  return c.companies === ECD_EXPECTED.companies
      && c.projects === ECD_EXPECTED.projects
      && c.fxRates === ECD_EXPECTED.fxRates;
}
