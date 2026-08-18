/**
 * Timeline Engine — the official historical record.
 * Destination: src/lib/timeline.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT THIS IS NOT
 *
 *   This file contains NO business logic. It does not compute a delay, an
 *   index, an exposure or a variance. There is not one arithmetic operator
 *   in it that produces a reportable figure.
 *
 *   Every number that enters a snapshot was already computed by the module
 *   that owns it — the Delay engine, the LD engine, the EVM engine, the
 *   subcontract engine. Timeline receives those outputs and writes them
 *   down. That is the whole job.
 *
 *   PHASE 1 (this implementation): aggregation only. Modules keep working
 *   exactly as they do today and remain the source of truth for live
 *   figures. Timeline is a parallel archive that nothing yet depends on.
 *
 * WHY IT EXISTS
 *
 *   Today "what did we report in March?" can only be answered by
 *   recalculating March from current data — which is not what March said.
 *   A snapshot is a statement made at a point in time; recomputing it later
 *   against a changed baseline produces a different statement wearing the
 *   same date.
 *
 * STORAGE
 *
 *   pactum-timeline-${projectId}  ->  TimelineStore
 *
 *   ONE new key. No existing key is written by this module, ever. The read
 *   helpers below open other stores read-only and never call setItem on
 *   them — a property that is asserted by the test suite.
 *
 * IMMUTABILITY
 *
 *   An approved snapshot is frozen. `appendSnapshot` refuses to overwrite
 *   one, and there is no update path. The only way to change history is to
 *   supersede it with a later period, which is how a project record should
 *   behave.
 * ══════════════════════════════════════════════════════════════════════
 */

// ── Snapshot model ─────────────────────────────────────────────────────

export type SnapshotStatus = 'draft' | 'approved' | 'superseded';

/**
 * Exchange rate carried with the period.
 *
 * PLACEHOLDER, deliberately. The brief asks to preserve the value and NOT
 * to implement conversion. Storing the rate at the moment of approval is
 * the part that cannot be reconstructed later — a rate table added in a
 * year's time cannot tell you what rate this report actually used. The
 * arithmetic can wait; the fact cannot.
 */
export interface ExchangeSnapshot {
  /** Currency the figures in this snapshot are expressed in. */
  baseCurrency: string;
  /** Rate against the reporting currency, 1 = same currency. */
  rate: number;
  /** Currency the group reports in. */
  reportingCurrency: string;
  /** ISO date the rate was effective. */
  effectiveDate: string;
  /** Where the rate came from — 'manual' until a rate service exists. */
  source: string;
  /**
   * EVERY published rate as at the data date, frozen with the period.
   *
   * The single `rate` above answers one currency. A multi-currency project
   * needs the whole FX environment of that month on record: if August was
   * approved at USD 3.75 / EUR 4.11, an October rate change must not be
   * able to alter what August reported. Storing the table — rather than
   * looking it up again at print time — is what makes that guarantee real.
   *
   * Optional: a period approved before this field existed simply has none,
   * and nothing about it changes.
   */
  rates?: {
    currency: string; rate: number; effectiveDate: string;
    /** Phase 5 provenance — optional, absent on pre-Phase-5 snapshots. */
    reportingCurrency?: string;
    approvalDate?: string;
    approvedBy?: string;
    version?: number;
    rateId?: string;
    status?: string;
  }[];

  /**
   * The rates this period ACTUALLY APPLIED — Phase 5.
   *
   * `rates` above is the rate book: every rate that was available. This is
   * what was used, harvested from the converted records themselves. The two
   * answer different questions, and only this one can prove what a reported
   * total was built from — a rate can sit in the book all month and never
   * touch a single transaction.
   *
   * Optional: a period with no foreign-currency records has none, which is
   * the correct statement, not an empty obligation.
   */
  appliedRates?: {
    currency: string;
    rate: number;
    count: number;
    originalTotal: number;
    convertedTotal: number;
    firstTxn: string;
    lastTxn: string;
  }[];

  /**
   * Cut-off used to reconstruct the rate book — Phase 5.
   *
   * Rates approved after this date were deliberately excluded. Recording it
   * makes the freeze reproducible: anyone can re-run the reconstruction and
   * get the same table.
   */
  ratesKnownAsOf?: string;

  /**
   * The project's CONTRACT currency at approval — Phase 8.
   *
   * Distinct from `reportingCurrency`. A project contracted in EUR whose
   * group reports in SAR has both, and a report that knows only the second
   * cannot say what the contract was actually denominated in. Optional:
   * absent on any period approved before Phase 8, which is correct, since
   * those projects had no contract currency of their own.
   */
  contractCurrency?: string;

  /**
   * Per-currency conversion totals frozen with the period — Phase 8.
   *
   * `appliedRates` above records which rates were used. This records the
   * six mandated fields in aggregate: what was captured, in what, at what
   * rate, and what it became. A historical report reproduces the period's
   * conversions from here without touching a live rate.
   */
  conversions?: {
    originalCurrency: string;
    originalAmount: number;
    exchangeRateSnapshot: number;
    exchangeRateEffectiveDate: string;
    reportingCurrencyValue: number;
    displayedReportingCurrency: string;
    /** identity | direct | inverse | cross. */
    rateSource?: string;
    ratePivot?: string;
    recordCount?: number;
  }[];
}

/** Delay position, copied from the Delay module's own outputs. */
export interface DelaySnapshot {
  /** project.delayDays — the authoritative manual figure. */
  totalDelay: number;
  /** Σ approved CO time + approved Claim time. */
  approvedEOT: number;
  /** totalDelay − approvedEOT, as the Delay module reports it. */
  unmitigated: number;
  culpableDelay: number;
  delayEventCount: number;
  approvedEventCount: number;
  /** Σ costImpact of APPROVED rows only. */
  approvedCostImpact: number;
}

/** Liquidated damages, copied from the LD engine. */
export interface LdSnapshot {
  ratePerDay: number;
  /** 0 means no cap entered. Preserved verbatim, not reinterpreted. */
  capAmount: number;
  grossExposure: number;
  exposure: number;
  capReached: boolean;
  netCostImpact: number;
}

/** Contract value position, copied from the Commercial module. */
export interface CommercialSnapshot {
  originalContract: number;
  approvedChangeOrders: number;
  pendingChangeOrders: number;
  approvedClaims: number;
  /**
   * Contract Amount = Contract Value + approved change orders + approved
   * claims.
   *
   * CORRECTED COMMENT — previously "Claims excluded, per platform rule".
   * That contradicted `commercialTotals.ts:200`, the single implementation,
   * which includes approved claims. Documentation fix only.
   */
  currentContract: number;
  certified: number;
  paid: number;
  outstanding: number;
  retentionHeld: number;
}

/** Cash position at the close of the period. */
export interface CashSnapshot {
  totalIn: number;
  totalOut: number;
  netFlow: number;
  cumulativeNet: number;
}

/** Earned value, copied from the EVM engine's reporting period. */
export interface EvmSnapshot {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  /** null when the denominator was zero. Never coerced to 1.00. */
  spi: number | null;
  cpi: number | null;
  sv: number;
  cv: number;
  eac: number;
  etc: number;
  vac: number;
  tcpi: number | null;
  /** Which PMI method produced the EAC above. */
  eacMethod: string;
  /** The EVM period this came from, e.g. "Aug 2026". */
  periodLabel: string;
}

/** Claims register summary. */
export interface ClaimsSnapshot {
  count: number;
  totalClaimed: number;
  totalSettled: number;
  timeClaimed: number;
  approvedCount: number;
}

/** Subcontract position across the project. */
export interface SubcontractSnapshot {
  count: number;
  totalContractValue: number;
  totalCurrentContract: number;
  totalCertified: number;
  totalPaid: number;
  totalOutstanding: number;
  /** Contract-weighted performance score, or null when none evaluated. */
  performanceScore: number | null;
}

/**
 * Budget position at the close of the period.
 * Category detail is kept: a total alone cannot answer "which package
 * overran?", and that question is the reason anyone opens an old report.
 */
export interface BudgetSnapshot {
  totalPlanned: number;
  totalActual: number;
  totalForecast: number;
  /** planned − forecast, as the Budget module reports it. */
  variance: number;
  categoryCount: number;
  categories: { category: string; planned: number; actual: number; forecast: number }[];
}

/** Owner certificate position — revenue, never actual cost. */
export interface CertificatesSnapshot {
  count: number;
  totalGross: number;
  totalRetention: number;
  totalNet: number;
  /** Σ gross of rows marked certified or paid. */
  certified: number;
  paid: number;
  outstanding: number;
}

/**
 * Forecast at the close of the period.
 *
 * Stored SEPARATELY from the EVM section on purpose. The EVM block records
 * what was measured; this records what was expected. A later brief may
 * change how a forecast is produced, and the archive must still say what
 * this period actually predicted.
 */
export interface ForecastSnapshot {
  /** Method that produced the EAC, e.g. 'BAC / CPI'. */
  method: string;
  eac: number;
  etc: number;
  vac: number;
  /** Forecast completion date at the time of approval, ISO. */
  forecastFinish: string;
  /** Days late against the baseline finish. Negative = early. */
  slipDays: number;
  /** Cumulative periods the forecast was computed from. */
  basisPeriods: number;
  cpiCum: number | null;
  spiCum: number | null;
}

/** Overall project status as classified at approval. */
export interface ProjectStatusSnapshot {
  /** Healthy | Watch | Recovery | Critical, as the EVM engine classified it. */
  health: string;
  /** Why — the classifier's own reasons, so the verdict is auditable. */
  reasons: string[];
  progressPct: number;
  /** Quadrant label: ahead/behind × under/over budget. */
  quadrant: string;
  /** Contract value in force for this period. */
  contractValue: number;
  revisedContractValue: number;
}

/**
 * The baselines in force when the period was approved — IDENTITY ONLY.
 *
 * Phase 4. A snapshot points at the baseline register; it does not copy the
 * plan into itself. Duplicating five payloads into every monthly snapshot
 * would put the same numbers in two places, and two places is where they
 * start to disagree. The register holds one copy; this says which version
 * of it this period was reported against.
 *
 * Shaped structurally rather than imported, so timeline.ts keeps its
 * property of depending on nothing. Optional throughout: a project with no
 * baselines files snapshots exactly as it did before Phase 4.
 */
export interface BaselineRefSnapshot {
  id: string;
  type: string;
  version: number;
  name: string;
  activatedAt: string;
  createdBy: string;
  cause: string;
  reason: string;
  dataDate: string;
}

export interface BaselineRefsSnapshot {
  contract?: BaselineRefSnapshot;
  budget?: BaselineRefSnapshot;
  cashflow?: BaselineRefSnapshot;
  schedule?: BaselineRefSnapshot;
  forecast?: BaselineRefSnapshot;
}

/** Headline KPIs as displayed on the dashboard. */
export interface KpiSnapshot {
  progressPct: number;
  /** EVM health classification at approval. */
  health: string;
  overallScore: number | null;
}

/** Contract dates in force for this period. */
export interface ContractState {
  commencementDate: string;
  plannedDurationDays: number;
  baselineFinish: string;
  approvedFinish: string;
  forecastFinish: string;
  /** Baseline version id in force, '' when the project dates are the plan. */
  baselineId: string;
  baselineName: string;
  baselineVersion: number;
}

/**
 * One immutable statement of the project's position.
 *
 * Every field is optional except the identity block, because a project may
 * approve a period before every module carries data. A missing section is
 * recorded as absent rather than as zero — those are different facts.
 */
export interface TimelineSnapshot {
  id: string;
  /** Reporting period label, e.g. `2026-08`. */
  periodId: string;
  periodLabel: string;
  /**
   * DATA DATE — the cut-off the figures describe. Distinct from `approvedAt`,
   * which is when a human signed them off. A period ending 31 August may be
   * approved on 4 September; conflating the two loses that fact.
   */
  dataDate: string;
  /** ISO timestamp of approval. */
  approvedAt: string;
  approvedBy: string;
  status: SnapshotStatus;
  note: string;

  contract?: ContractState;
  exchange?: ExchangeSnapshot;
  delay?: DelaySnapshot;
  ld?: LdSnapshot;
  commercial?: CommercialSnapshot;
  cash?: CashSnapshot;
  evm?: EvmSnapshot;
  claims?: ClaimsSnapshot;
  subcontracts?: SubcontractSnapshot;
  kpi?: KpiSnapshot;
  budget?: BudgetSnapshot;
  certificates?: CertificatesSnapshot;
  forecast?: ForecastSnapshot;
  projectStatus?: ProjectStatusSnapshot;
  /** Phase 4 — which baseline versions this period was reported against. */
  baselines?: BaselineRefsSnapshot;

  /** Schema version, so a future migration can tell generations apart. */
  schema: number;
}

export interface TimelineStore {
  snapshots: TimelineSnapshot[];
  /** Reporting currency for the project. Placeholder until a currency engine. */
  reportingCurrency: string;
}

export const SCHEMA_VERSION = 1;

export const EMPTY_TIMELINE: TimelineStore = { snapshots: [], reportingCurrency: 'SAR' };

const KEY = (projectId: string) => `pactum-timeline-${projectId}`;

// ── Storage ────────────────────────────────────────────────────────────

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A stored snapshot is trusted as written.
 *
 * Re-deriving any field on read would defeat the entire purpose: the record
 * must say what it said on the day. Cleaning is limited to type coercion so
 * a corrupted store cannot crash the page.
 */
function cleanSnapshot(r: any, i: number): TimelineSnapshot {
  const st: SnapshotStatus =
    ['draft', 'approved', 'superseded'].includes(r?.status) ? r.status : 'approved';
  const sect = <T,>(v: any, map: (x: any) => T): T | undefined =>
    v && typeof v === 'object' ? map(v) : undefined;

  return {
    id: String(r?.id ?? `tl-${i}`),
    periodId: String(r?.periodId ?? ''),
    periodLabel: String(r?.periodLabel ?? ''),
    dataDate: String(r?.dataDate ?? ''),
    approvedAt: String(r?.approvedAt ?? ''),
    approvedBy: String(r?.approvedBy ?? ''),
    status: st,
    note: String(r?.note ?? ''),
    schema: num(r?.schema) || SCHEMA_VERSION,

    contract: sect(r?.contract, (c) => ({
      commencementDate: String(c.commencementDate ?? ''),
      plannedDurationDays: num(c.plannedDurationDays),
      baselineFinish: String(c.baselineFinish ?? ''),
      approvedFinish: String(c.approvedFinish ?? ''),
      forecastFinish: String(c.forecastFinish ?? ''),
      baselineId: String(c.baselineId ?? ''),
      baselineName: String(c.baselineName ?? ''),
      baselineVersion: num(c.baselineVersion),
    })),
    exchange: sect(r?.exchange, (x) => ({
      baseCurrency: String(x.baseCurrency ?? 'SAR'),
      rate: Number.isFinite(Number(x.rate)) ? Number(x.rate) : 1,
      reportingCurrency: String(x.reportingCurrency ?? 'SAR'),
      effectiveDate: String(x.effectiveDate ?? ''),
      source: String(x.source ?? 'manual'),
      rates: Array.isArray(x.rates)
        ? x.rates.map((e: any) => ({
            currency: String(e?.currency ?? '').toUpperCase(),
            rate: num(e?.rate),
            effectiveDate: String(e?.effectiveDate ?? ''),
            // Phase 5 provenance. Absent on a pre-Phase-5 snapshot, and left
            // absent rather than defaulted — "not recorded" is the fact.
            reportingCurrency: e?.reportingCurrency ? String(e.reportingCurrency) : undefined,
            approvalDate: e?.approvalDate ? String(e.approvalDate) : undefined,
            approvedBy: e?.approvedBy ? String(e.approvedBy) : undefined,
            version: e?.version === undefined ? undefined : num(e.version),
            rateId: e?.rateId ? String(e.rateId) : undefined,
            status: e?.status ? String(e.status) : undefined,
          }))
        : undefined,
      appliedRates: Array.isArray(x.appliedRates)
        ? x.appliedRates.map((e: any) => ({
            currency: String(e?.currency ?? '').toUpperCase(),
            rate: num(e?.rate),
            count: num(e?.count),
            originalTotal: num(e?.originalTotal),
            convertedTotal: num(e?.convertedTotal),
            firstTxn: String(e?.firstTxn ?? ''),
            lastTxn: String(e?.lastTxn ?? ''),
          }))
        : undefined,
      ratesKnownAsOf: x?.ratesKnownAsOf ? String(x.ratesKnownAsOf) : undefined,
      contractCurrency: x?.contractCurrency ? String(x.contractCurrency) : undefined,
      conversions: Array.isArray(x.conversions)
        ? x.conversions.map((c: any) => ({
            originalCurrency: String(c?.originalCurrency ?? '').toUpperCase(),
            originalAmount: num(c?.originalAmount),
            exchangeRateSnapshot: num(c?.exchangeRateSnapshot),
            exchangeRateEffectiveDate: String(c?.exchangeRateEffectiveDate ?? ''),
            reportingCurrencyValue: num(c?.reportingCurrencyValue),
            displayedReportingCurrency: String(c?.displayedReportingCurrency ?? '').toUpperCase(),
            rateSource: c?.rateSource ? String(c.rateSource) : undefined,
            ratePivot: c?.ratePivot ? String(c.ratePivot) : undefined,
            recordCount: c?.recordCount === undefined ? undefined : num(c.recordCount),
          }))
        : undefined,
    })),
    delay: sect(r?.delay, (d) => ({
      totalDelay: num(d.totalDelay),
      approvedEOT: num(d.approvedEOT),
      unmitigated: num(d.unmitigated),
      culpableDelay: num(d.culpableDelay),
      delayEventCount: num(d.delayEventCount),
      approvedEventCount: num(d.approvedEventCount),
      approvedCostImpact: num(d.approvedCostImpact),
    })),
    ld: sect(r?.ld, (l) => ({
      ratePerDay: num(l.ratePerDay),
      capAmount: num(l.capAmount),
      grossExposure: num(l.grossExposure),
      exposure: num(l.exposure),
      capReached: Boolean(l.capReached),
      netCostImpact: num(l.netCostImpact),
    })),
    commercial: sect(r?.commercial, (c) => ({
      originalContract: num(c.originalContract),
      approvedChangeOrders: num(c.approvedChangeOrders),
      pendingChangeOrders: num(c.pendingChangeOrders),
      approvedClaims: num(c.approvedClaims),
      currentContract: num(c.currentContract),
      certified: num(c.certified),
      paid: num(c.paid),
      outstanding: num(c.outstanding),
      retentionHeld: num(c.retentionHeld),
    })),
    cash: sect(r?.cash, (c) => ({
      totalIn: num(c.totalIn),
      totalOut: num(c.totalOut),
      netFlow: num(c.netFlow),
      cumulativeNet: num(c.cumulativeNet),
    })),
    evm: sect(r?.evm, (e) => ({
      bac: num(e.bac), pv: num(e.pv), ev: num(e.ev), ac: num(e.ac),
      spi: nullableNum(e.spi), cpi: nullableNum(e.cpi),
      sv: num(e.sv), cv: num(e.cv),
      eac: num(e.eac), etc: num(e.etc), vac: num(e.vac),
      tcpi: nullableNum(e.tcpi),
      eacMethod: String(e.eacMethod ?? ''),
      periodLabel: String(e.periodLabel ?? ''),
    })),
    claims: sect(r?.claims, (c) => ({
      count: num(c.count),
      totalClaimed: num(c.totalClaimed),
      totalSettled: num(c.totalSettled),
      timeClaimed: num(c.timeClaimed),
      approvedCount: num(c.approvedCount),
    })),
    subcontracts: sect(r?.subcontracts, (s) => ({
      count: num(s.count),
      totalContractValue: num(s.totalContractValue),
      totalCurrentContract: num(s.totalCurrentContract),
      totalCertified: num(s.totalCertified),
      totalPaid: num(s.totalPaid),
      totalOutstanding: num(s.totalOutstanding),
      performanceScore: nullableNum(s.performanceScore),
    })),
    kpi: sect(r?.kpi, (k) => ({
      progressPct: num(k.progressPct),
      health: String(k.health ?? ''),
      overallScore: nullableNum(k.overallScore),
    })),
    budget: sect(r?.budget, (b) => ({
      totalPlanned: num(b.totalPlanned),
      totalActual: num(b.totalActual),
      totalForecast: num(b.totalForecast),
      variance: num(b.variance),
      categoryCount: num(b.categoryCount),
      categories: Array.isArray(b.categories)
        ? b.categories.map((c: any) => ({
            category: String(c?.category ?? ''),
            planned: num(c?.planned), actual: num(c?.actual), forecast: num(c?.forecast),
          }))
        : [],
    })),
    certificates: sect(r?.certificates, (c) => ({
      count: num(c.count),
      totalGross: num(c.totalGross),
      totalRetention: num(c.totalRetention),
      totalNet: num(c.totalNet),
      certified: num(c.certified),
      paid: num(c.paid),
      outstanding: num(c.outstanding),
    })),
    forecast: sect(r?.forecast, (f) => ({
      method: String(f.method ?? ''),
      eac: num(f.eac), etc: num(f.etc), vac: num(f.vac),
      forecastFinish: String(f.forecastFinish ?? ''),
      slipDays: num(f.slipDays),
      basisPeriods: num(f.basisPeriods),
      cpiCum: nullableNum(f.cpiCum),
      spiCum: nullableNum(f.spiCum),
    })),
    baselines: sect(r?.baselines, (b) => {
      const ref = (v: any): BaselineRefSnapshot | undefined =>
        v && typeof v === 'object'
          ? {
              id: String(v.id ?? ''),
              type: String(v.type ?? ''),
              version: num(v.version),
              name: String(v.name ?? ''),
              activatedAt: String(v.activatedAt ?? ''),
              createdBy: String(v.createdBy ?? ''),
              cause: String(v.cause ?? ''),
              reason: String(v.reason ?? ''),
              dataDate: String(v.dataDate ?? ''),
            }
          : undefined;
      return {
        contract: ref(b.contract),
        budget: ref(b.budget),
        cashflow: ref(b.cashflow),
        schedule: ref(b.schedule),
        forecast: ref(b.forecast),
      };
    }),
    projectStatus: sect(r?.projectStatus, (p) => ({
      health: String(p.health ?? ''),
      reasons: Array.isArray(p.reasons) ? p.reasons.map(String) : [],
      progressPct: num(p.progressPct),
      quadrant: String(p.quadrant ?? ''),
      contractValue: num(p.contractValue),
      revisedContractValue: num(p.revisedContractValue),
    })),
  };
}

export function readTimeline(projectId: string): TimelineStore {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(projectId)) || 'null');
    if (!raw || typeof raw !== 'object') return { snapshots: [], reportingCurrency: 'SAR' };
    return {
      snapshots: Array.isArray(raw.snapshots) ? raw.snapshots.map(cleanSnapshot) : [],
      reportingCurrency: String(raw.reportingCurrency ?? 'SAR'),
    };
  } catch {
    return { snapshots: [], reportingCurrency: 'SAR' };
  }
}

function writeTimeline(projectId: string, store: TimelineStore): void {
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(store));
  } catch {
    /* quota — same policy as every other store in the platform */
  }
}

// ── Append ─────────────────────────────────────────────────────────────

export interface AppendResult {
  store: TimelineStore;
  ok: boolean;
  /** Why the append was refused, when it was. */
  reason?: 'duplicate-period' | 'missing-period';
  snapshot?: TimelineSnapshot;
}

/**
 * Records one approved period.
 *
 * Refuses a period that already has an APPROVED snapshot. History is
 * append-only: correcting a past period means approving the next one with
 * the corrected position, not editing what was signed.
 */
export function appendSnapshot(
  projectId: string,
  input: Omit<TimelineSnapshot, 'id' | 'schema' | 'status' | 'approvedAt'> &
         Partial<Pick<TimelineSnapshot, 'status' | 'approvedAt'>>,
): AppendResult {
  const store = readTimeline(projectId);
  if (!input.periodId) return { store, ok: false, reason: 'missing-period' };

  const clash = store.snapshots.find(
    s => s.periodId === input.periodId && s.status === 'approved',
  );
  if (clash) return { store, ok: false, reason: 'duplicate-period' };

  const snapshot: TimelineSnapshot = {
    ...input,
    id: `tl-${input.periodId}-${Date.now()}`,
    status: input.status ?? 'approved',
    approvedAt: input.approvedAt ?? new Date().toISOString(),
    schema: SCHEMA_VERSION,
  } as TimelineSnapshot;

  const next: TimelineStore = {
    ...store,
    snapshots: [...store.snapshots, snapshot].sort((a, b) => a.periodId.localeCompare(b.periodId)),
  };
  writeTimeline(projectId, next);
  return { store: next, ok: true, snapshot };
}

/**
 * Marks a snapshot superseded. It stays on record and stays readable — a
 * withdrawn statement is still part of the audit trail.
 */
export function supersedeSnapshot(projectId: string, snapshotId: string): TimelineStore {
  const store = readTimeline(projectId);
  const next: TimelineStore = {
    ...store,
    snapshots: store.snapshots.map(s =>
      s.id === snapshotId ? { ...s, status: 'superseded' as SnapshotStatus } : s),
  };
  writeTimeline(projectId, next);
  return next;
}

export function setReportingCurrency(projectId: string, currency: string): TimelineStore {
  const store = readTimeline(projectId);
  const next = { ...store, reportingCurrency: currency || 'SAR' };
  writeTimeline(projectId, next);
  return next;
}

// ── Queries ────────────────────────────────────────────────────────────

/** Approved snapshots only, oldest first. */
export function approvedSnapshots(store: TimelineStore): TimelineSnapshot[] {
  return store.snapshots.filter(s => s.status === 'approved');
}

/** The most recently approved period, or null. */
export function latestSnapshot(store: TimelineStore): TimelineSnapshot | null {
  const a = approvedSnapshots(store);
  return a.length ? a[a.length - 1] : null;
}

export function snapshotFor(store: TimelineStore, periodId: string): TimelineSnapshot | null {
  return store.snapshots.find(s => s.periodId === periodId && s.status === 'approved') ?? null;
}

/** True when this period has already been signed off. */
export function isPeriodApproved(store: TimelineStore, periodId: string): boolean {
  return store.snapshots.some(s => s.periodId === periodId && s.status === 'approved');
}

/**
 * Period-on-period movement for one numeric path, e.g. 'delay.totalDelay'.
 * Returns null when either period lacks the section — an absent figure is
 * not a zero, and a delta against nothing is meaningless.
 */
export function deltaBetween(
  a: TimelineSnapshot | null, b: TimelineSnapshot | null, path: string,
): number | null {
  const read = (s: TimelineSnapshot | null): number | null => {
    if (!s) return null;
    const v = path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), s);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const x = read(a), y = read(b);
  return x === null || y === null ? null : y - x;
}

/** A named series across approved periods, for trend charts. */
export function seriesOf(store: TimelineStore, path: string): { period: string; value: number | null }[] {
  return approvedSnapshots(store).map(s => {
    const v = path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), s);
    return {
      period: s.periodLabel || s.periodId,
      value: typeof v === 'number' && Number.isFinite(v) ? v : null,
    };
  });
}

// ── Collection ─────────────────────────────────────────────────────────
//
// The functions below READ other modules' stores. They open them with
// getItem and never write. Every figure is taken as found: no sums are
// recomputed that a module already publishes, and where a total must be
// assembled from rows it uses the same filter the owning module uses, so
// the archived figure equals the one on screen.

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Claims summary, read from `pactum-claims-*`.
 * Mirrors the totals the Claims module itself displays.
 */
export function collectClaims(projectId: string): ClaimsSnapshot {
  const rows: any[] = readJson(`pactum-claims-${projectId}`, []);
  const list = Array.isArray(rows) ? rows : [];
  return {
    count: list.length,
    totalClaimed: list.reduce((a, r) => a + num(r.claimed), 0),
    totalSettled: list.reduce((a, r) => a + num(r.settled), 0),
    timeClaimed: list.reduce((a, r) => a + num(r.timeDays), 0),
    approvedCount: list.filter(r => r?.status === 'approved').length,
  };
}

/** Cash position, read from `pactum-cashflow-*`. */
export function collectCash(projectId: string): CashSnapshot {
  const rows: any[] = readJson(`pactum-cashflow-${projectId}`, []);
  const list = Array.isArray(rows) ? rows : [];
  const totalIn = list.reduce((a, r) => a + num(r.in), 0);
  const totalOut = list.reduce((a, r) => a + num(r.out), 0);
  return {
    totalIn,
    totalOut,
    netFlow: totalIn - totalOut,
    // The module maintains cumNet itself; the last row is the running total.
    cumulativeNet: list.length ? num(list[list.length - 1].cumNet) : 0,
  };
}

/** Subcontract rollup, read from `pactum-subs-*` and `pactum-sub-certs-*`. */
export function collectSubcontracts(projectId: string): SubcontractSnapshot {
  const subs: any[] = readJson(`pactum-subs-${projectId}`, []);
  const list = Array.isArray(subs) ? subs : [];
  const certMap: Record<string, any[]> = readJson(`pactum-sub-certs-${projectId}`, {});

  let certified = 0, paid = 0, retention = 0;
  list.forEach(s => {
    const certs = Array.isArray(certMap?.[s.id]) ? certMap[s.id] : [];
    certs.forEach((c: any) => {
      if (c?.status === 'certified' || c?.status === 'paid') certified += num(c.grossAmount);
      if (c?.status === 'paid') paid += num(c.paidAmount);
      retention += num(c.retentionHeld);
    });
  });

  const original = list.reduce((a, s) => a + num(s.contractValue), 0);
  return {
    count: list.length,
    totalContractValue: original,
    // Current contract needs the commercial store per subcontract; the
    // caller passes it when available. Falling back to original is honest:
    // with no variations recorded, the two are the same number.
    totalCurrentContract: original,
    totalCertified: certified,
    totalPaid: paid,
    totalOutstanding: certified - paid,
    performanceScore: null,
  };
}

/** Delay register counts, read from `pactum-delays-*`. */
export function collectDelayCounts(projectId: string): {
  delayEventCount: number; approvedEventCount: number; approvedCostImpact: number;
} {
  const rows: any[] = readJson(`pactum-delays-${projectId}`, []);
  const list = Array.isArray(rows) ? rows : [];
  const approved = list.filter(r => r?.status === 'approved');
  return {
    delayEventCount: list.length,
    approvedEventCount: approved.length,
    // Same filter the Delay window uses, so the archived figure matches.
    approvedCostImpact: approved.reduce((a, r) => a + num(r.costImpact), 0),
  };
}

/**
 * Budget position, read from `pactum-budget-{p}`.
 * Uses the module's own field names and its own variance rule, so the
 * archived figure equals what the Budget screen displayed.
 */
export function collectBudget(projectId: string): BudgetSnapshot {
  const rows: any[] = readJson(`pactum-budget-${projectId}`, []);
  const list = Array.isArray(rows) ? rows : [];
  const totalPlanned  = list.reduce((a, r) => a + num(r.planned), 0);
  const totalActual   = list.reduce((a, r) => a + num(r.actual), 0);
  const totalForecast = list.reduce((a, r) => a + num(r.forecast), 0);
  return {
    totalPlanned, totalActual, totalForecast,
    variance: totalPlanned - totalForecast,
    categoryCount: list.length,
    categories: list.map(r => ({
      category: String(r?.category ?? ''),
      planned: num(r.planned), actual: num(r.actual), forecast: num(r.forecast),
    })),
  };
}

/**
 * Owner certificates, read from `pactum-certs-{p}`.
 *
 * `certified` counts rows marked certified OR paid — a paid certificate was
 * necessarily certified first, and dropping it would understate revenue.
 * This mirrors the rule the Certificates module itself applies.
 */
export function collectCertificates(projectId: string): CertificatesSnapshot {
  const rows: any[] = readJson(`pactum-certs-${projectId}`, []);
  const list = Array.isArray(rows) ? rows : [];
  const certified = list
    .filter(r => r?.status === 'certified' || r?.status === 'paid')
    .reduce((a, r) => a + num(r.gross), 0);
  const paid = list.filter(r => r?.status === 'paid').reduce((a, r) => a + num(r.net), 0);
  return {
    count: list.length,
    totalGross: list.reduce((a, r) => a + num(r.gross), 0),
    totalRetention: list.reduce((a, r) => a + num(r.retention), 0),
    totalNet: list.reduce((a, r) => a + num(r.net), 0),
    certified,
    paid,
    outstanding: certified - paid,
  };
}

/** A neutral exchange placeholder: same currency, rate 1. */
export function defaultExchange(reportingCurrency = 'SAR', effectiveDate = ''): ExchangeSnapshot {
  return {
    baseCurrency: reportingCurrency,
    rate: 1,
    reportingCurrency,
    effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10),
    source: 'manual',
  };
}

// ── Reporting queries ──────────────────────────────────────────────────
//
// Timeline is the SOLE source for historical, executive, monthly, trend, FX,
// forecast-comparison and portfolio reporting. Every function below reads the
// archive and nothing else — none of them recomputes a figure, and none of
// them touches a live module store.

/** A trend row: one approved period, flattened for charts and tables. */
export interface TrendRow {
  periodId: string;
  period: string;
  dataDate: string;
  approvedBy: string;
  totalDelay: number | null;
  approvedEOT: number | null;
  unmitigated: number | null;
  ldExposure: number | null;
  spi: number | null;
  cpi: number | null;
  eac: number | null;
  vac: number | null;
  budgetActual: number | null;
  certified: number | null;
  cashNet: number | null;
  health: string;
}

const pick = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Every approved period as a flat row, oldest first. Drives Trend Analysis. */
export function trendRows(store: TimelineStore): TrendRow[] {
  return approvedSnapshots(store).map(s => ({
    periodId: s.periodId,
    period: s.periodLabel || s.periodId,
    dataDate: s.dataDate,
    approvedBy: s.approvedBy,
    totalDelay:   pick(s.delay?.totalDelay),
    approvedEOT:  pick(s.delay?.approvedEOT),
    unmitigated:  pick(s.delay?.unmitigated),
    ldExposure:   pick(s.ld?.exposure),
    spi:          s.evm?.spi ?? null,
    cpi:          s.evm?.cpi ?? null,
    eac:          pick(s.evm?.eac),
    vac:          pick(s.evm?.vac),
    budgetActual: pick(s.budget?.totalActual),
    certified:    pick(s.certificates?.certified),
    cashNet:      pick(s.cash?.netFlow),
    health:       s.projectStatus?.health ?? s.kpi?.health ?? '',
  }));
}

/**
 * Forecast comparison across periods.
 *
 * Answers the question an executive actually asks: "has our view of the
 * outturn been getting better or worse?" Each row is what that period
 * predicted, never a re-derivation.
 */
export interface ForecastComparisonRow {
  period: string;
  dataDate: string;
  method: string;
  eac: number | null;
  vac: number | null;
  forecastFinish: string;
  slipDays: number | null;
  /** Movement in EAC against the previous approved period. */
  eacDelta: number | null;
}

export function forecastComparison(store: TimelineStore): ForecastComparisonRow[] {
  const list = approvedSnapshots(store);
  return list.map((s, i) => {
    const prev = i > 0 ? list[i - 1] : null;
    const eac = pick(s.forecast?.eac ?? s.evm?.eac);
    const prevEac = prev ? pick(prev.forecast?.eac ?? prev.evm?.eac) : null;
    return {
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      method: s.forecast?.method ?? s.evm?.eacMethod ?? '',
      eac,
      vac: pick(s.forecast?.vac ?? s.evm?.vac),
      forecastFinish: s.forecast?.forecastFinish ?? s.contract?.forecastFinish ?? '',
      slipDays: pick(s.forecast?.slipDays),
      eacDelta: eac !== null && prevEac !== null ? eac - prevEac : null,
    };
  });
}

/**
 * FX analysis across periods.
 *
 * Each row is the rate that period was APPROVED at — the rate its figures
 * were converted with. Reading the live rate book instead would show today's
 * rates against yesterday's money, which is precisely the error the frozen
 * table exists to prevent.
 */
export interface FxTrendRow {
  period: string;
  dataDate: string;
  currency: string;
  rate: number;
  effectiveDate: string;
}

export function fxTrend(store: TimelineStore, currency?: string): FxTrendRow[] {
  const out: FxTrendRow[] = [];
  approvedSnapshots(store).forEach(s => {
    (s.exchange?.rates ?? []).forEach(r => {
      if (currency && r.currency !== currency.toUpperCase()) return;
      out.push({
        period: s.periodLabel || s.periodId,
        dataDate: s.dataDate,
        currency: r.currency,
        rate: r.rate,
        effectiveDate: r.effectiveDate,
      });
    });
  });
  return out;
}

/**
 * The rates each period actually applied — Phase 5.
 *
 * Sourced only from `exchange.appliedRates`, which was harvested from the
 * converted records at approval. Never from the live register: a historical
 * report that reaches for a current rate is not a historical report.
 */
export interface AppliedRateRow {
  period: string;
  dataDate: string;
  reportingCurrency: string;
  currency: string;
  rate: number;
  count: number;
  originalTotal: number;
  convertedTotal: number;
  firstTxn: string;
  lastTxn: string;
}

export function appliedRateRows(store: TimelineStore, currency?: string): AppliedRateRow[] {
  const out: AppliedRateRow[] = [];
  approvedSnapshots(store).forEach(s => {
    (s.exchange?.appliedRates ?? []).forEach(a => {
      if (currency && a.currency !== currency.toUpperCase()) return;
      out.push({
        period: s.periodLabel || s.periodId,
        dataDate: s.dataDate,
        reportingCurrency: s.exchange?.reportingCurrency ?? '',
        currency: a.currency,
        rate: a.rate,
        count: a.count,
        originalTotal: a.originalTotal,
        convertedTotal: a.convertedTotal,
        firstTxn: a.firstTxn,
        lastTxn: a.lastTxn,
      });
    });
  });
  return out;
}

/**
 * Movement of one currency's frozen rate between consecutive periods.
 *
 * Reads the archive only. When a rate moved between August and September,
 * this says so using the two values those periods reported — not the two
 * values the register holds today.
 */
export interface FxMovementRow {
  period: string;
  dataDate: string;
  currency: string;
  rate: number;
  priorRate: number | null;
  delta: number | null;
  pctDelta: number | null;
  /** Correction version frozen with the period, when recorded. */
  version: number | null;
}

export function fxMovement(store: TimelineStore, currency: string): FxMovementRow[] {
  const cur = (currency || '').toUpperCase();
  const list = approvedSnapshots(store);
  let prev: number | null = null;
  const out: FxMovementRow[] = [];

  list.forEach(s => {
    const hit = (s.exchange?.rates ?? []).find(r => r.currency === cur);
    if (!hit) return;
    const delta = prev !== null ? hit.rate - prev : null;
    const pctDelta = prev !== null && prev !== 0 ? (hit.rate - prev) / Math.abs(prev) : null;
    out.push({
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      currency: cur,
      rate: hit.rate,
      priorRate: prev,
      delta, pctDelta,
      version: hit.version ?? null,
    });
    prev = hit.rate;
  });
  return out;
}

/**
 * The reporting currency each period was expressed in.
 *
 * A group that changes reporting currency must not have its history
 * re-labelled. Every period says which currency it reported in, and a
 * comparison across a switch is flagged rather than silently summed.
 */
export interface ReportingCurrencyRow {
  period: string;
  dataDate: string;
  reportingCurrency: string;
  /** True when this period reports in a different currency to the previous. */
  changed: boolean;
}

export function reportingCurrencyTrail(store: TimelineStore): ReportingCurrencyRow[] {
  const list = approvedSnapshots(store);
  return list.map((s, i) => {
    const cur = s.exchange?.reportingCurrency ?? '';
    const prev = i > 0 ? (list[i - 1].exchange?.reportingCurrency ?? '') : '';
    return {
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      reportingCurrency: cur,
      changed: i > 0 && Boolean(cur) && Boolean(prev) && cur !== prev,
    };
  });
}

/**
 * True when the archive spans more than one reporting currency.
 * A caller that sums across periods must refuse, or convert, when this holds.
 */
export function hasMixedReportingCurrency(store: TimelineStore): boolean {
  const set = new Set(
    approvedSnapshots(store)
      .map(s => s.exchange?.reportingCurrency ?? '')
      .filter(Boolean));
  return set.size > 1;
}

/**
 * The frozen rate table of one period, for a historical report.
 *
 * The ONLY sanctioned way for a report to obtain a rate for a past period.
 * Returns an empty table when the period recorded none — the caller must
 * then say "not recorded" rather than reach for a live rate.
 */
export function frozenRatesFor(store: TimelineStore, periodId: string): {
  reportingCurrency: string;
  knownAsOf: string;
  rates: NonNullable<ExchangeSnapshot['rates']>;
  applied: NonNullable<ExchangeSnapshot['appliedRates']>;
} {
  const s = snapshotFor(store, periodId);
  return {
    reportingCurrency: s?.exchange?.reportingCurrency ?? '',
    knownAsOf: s?.exchange?.ratesKnownAsOf ?? '',
    rates: s?.exchange?.rates ?? [],
    applied: s?.exchange?.appliedRates ?? [],
  };
}

/**
 * The conversions one period froze — Phase 8.
 *
 * The ONLY sanctioned source for a historical currency question. Reads the
 * archive; the live rate register is never opened, so a rate corrected next
 * month cannot restate what this period reported.
 */
export interface FrozenConversion {
  period: string;
  dataDate: string;
  originalCurrency: string;
  originalAmount: number;
  exchangeRateSnapshot: number;
  exchangeRateEffectiveDate: string;
  reportingCurrencyValue: number;
  displayedReportingCurrency: string;
  rateSource: string;
  ratePivot: string;
  recordCount: number;
}

export function frozenConversions(store: TimelineStore, periodId?: string): FrozenConversion[] {
  const list = periodId
    ? approvedSnapshots(store).filter(s => s.periodId === periodId)
    : approvedSnapshots(store);
  const out: FrozenConversion[] = [];
  list.forEach(s => {
    (s.exchange?.conversions ?? []).forEach(c => {
      out.push({
        period: s.periodLabel || s.periodId,
        dataDate: s.dataDate,
        originalCurrency: c.originalCurrency,
        originalAmount: c.originalAmount,
        exchangeRateSnapshot: c.exchangeRateSnapshot,
        exchangeRateEffectiveDate: c.exchangeRateEffectiveDate,
        reportingCurrencyValue: c.reportingCurrencyValue,
        displayedReportingCurrency: c.displayedReportingCurrency,
        rateSource: c.rateSource ?? '',
        ratePivot: c.ratePivot ?? '',
        recordCount: c.recordCount ?? 0,
      });
    });
  });
  return out;
}

/** The contract currency a period was approved under. '' when not recorded. */
export function contractCurrencyAt(store: TimelineStore, periodId?: string): string {
  const s = periodId ? snapshotFor(store, periodId) : latestSnapshot(store);
  return s?.exchange?.contractCurrency ?? '';
}

/** Currencies that appear in any frozen FX table. */
export function archivedCurrencies(store: TimelineStore): string[] {
  const set = new Set<string>();
  approvedSnapshots(store).forEach(s =>
    (s.exchange?.rates ?? []).forEach(r => set.add(r.currency)));
  return Array.from(set).sort();
}

/**
 * Executive summary of the latest approved period, with movement.
 *
 * Deliberately small. An executive report that reprints everything is a
 * monthly report; this is the half-page that precedes it.
 */
export interface ExecutiveSummary {
  period: string;
  dataDate: string;
  approvedBy: string;
  health: string;
  reasons: string[];
  contractValue: number | null;
  eac: number | null;
  vac: number | null;
  spi: number | null;
  cpi: number | null;
  totalDelay: number | null;
  unmitigated: number | null;
  ldExposure: number | null;
  forecastFinish: string;
  /** Movement against the previous approved period, null when first. */
  deltas: {
    spi: number | null; cpi: number | null;
    eac: number | null; totalDelay: number | null; ldExposure: number | null;
  };
}

export function executiveSummary(store: TimelineStore): ExecutiveSummary | null {
  const list = approvedSnapshots(store);
  if (list.length === 0) return null;
  const s = list[list.length - 1];
  const p = list.length > 1 ? list[list.length - 2] : null;

  return {
    period: s.periodLabel || s.periodId,
    dataDate: s.dataDate,
    approvedBy: s.approvedBy,
    health: s.projectStatus?.health ?? s.kpi?.health ?? '',
    reasons: s.projectStatus?.reasons ?? [],
    contractValue: pick(s.projectStatus?.contractValue ?? s.commercial?.originalContract),
    eac: pick(s.forecast?.eac ?? s.evm?.eac),
    vac: pick(s.forecast?.vac ?? s.evm?.vac),
    spi: s.evm?.spi ?? null,
    cpi: s.evm?.cpi ?? null,
    totalDelay: pick(s.delay?.totalDelay),
    unmitigated: pick(s.delay?.unmitigated),
    ldExposure: pick(s.ld?.exposure),
    forecastFinish: s.forecast?.forecastFinish ?? s.contract?.forecastFinish ?? '',
    deltas: {
      spi: deltaBetween(p, s, 'evm.spi'),
      cpi: deltaBetween(p, s, 'evm.cpi'),
      eac: deltaBetween(p, s, 'evm.eac'),
      totalDelay: deltaBetween(p, s, 'delay.totalDelay'),
      ldExposure: deltaBetween(p, s, 'ld.exposure'),
    },
  };
}

/**
 * One project's latest archived position, for portfolio roll-ups.
 *
 * Returns null when a project has never approved a period. Null is the
 * honest answer: a project with no approved history has no archived
 * position, and substituting live figures would mix two different kinds of
 * statement inside one portfolio table.
 */
export interface PortfolioRow {
  projectId: string;
  period: string;
  dataDate: string;
  health: string;
  contractValue: number | null;
  eac: number | null;
  vac: number | null;
  spi: number | null;
  cpi: number | null;
  totalDelay: number | null;
  ldExposure: number | null;
  progressPct: number | null;
}

export function portfolioRow(projectId: string): PortfolioRow | null {
  const store = readTimeline(projectId);
  const s = latestSnapshot(store);
  if (!s) return null;
  return {
    projectId,
    period: s.periodLabel || s.periodId,
    dataDate: s.dataDate,
    health: s.projectStatus?.health ?? s.kpi?.health ?? '',
    contractValue: pick(s.projectStatus?.contractValue ?? s.commercial?.originalContract),
    eac: pick(s.forecast?.eac ?? s.evm?.eac),
    vac: pick(s.forecast?.vac ?? s.evm?.vac),
    spi: s.evm?.spi ?? null,
    cpi: s.evm?.cpi ?? null,
    totalDelay: pick(s.delay?.totalDelay),
    ldExposure: pick(s.ld?.exposure),
    progressPct: pick(s.projectStatus?.progressPct ?? s.kpi?.progressPct),
  };
}

/** Portfolio view across many projects. Projects with no history are omitted. */
export function portfolioRows(projectIds: string[]): PortfolioRow[] {
  return projectIds.map(portfolioRow).filter(Boolean) as PortfolioRow[];
}

/**
 * Completeness of one snapshot — which of the twelve sections it carries.
 *
 * A period approved before a section existed simply lacks it. Reporting must
 * be able to say "not recorded" rather than print a zero.
 */
export interface Coverage {
  present: string[];
  missing: string[];
  complete: boolean;
}

const SECTIONS = [
  'budget', 'cash', 'delay', 'claims', 'subcontracts', 'certificates',
  'commercial', 'evm', 'exchange', 'forecast', 'projectStatus', 'contract',
] as const;

export function coverageOf(s: TimelineSnapshot): Coverage {
  const present: string[] = [];
  const missing: string[] = [];
  SECTIONS.forEach(k => {
    ((s as any)[k] ? present : missing).push(k);
  });
  return { present, missing, complete: missing.length === 0 };
}

/**
 * Which baseline versions each approved period was reported against.
 *
 * Answers the question that makes a trend readable: "did the plan change
 * under us?" A jump in variance between two periods means one thing when
 * both were measured against Budget V2, and something entirely different
 * when the second was measured against V3.
 */
export interface BaselineTrailRow {
  period: string;
  dataDate: string;
  contract: string;
  budget: string;
  cashflow: string;
  schedule: string;
  forecast: string;
  /** True when any family's version differs from the previous period. */
  rebaselined: boolean;
}

export function baselineTrail(store: TimelineStore): BaselineTrailRow[] {
  const list = approvedSnapshots(store);
  const label = (r?: BaselineRefSnapshot) => (r ? `V${r.version}` : '—');
  return list.map((s, i) => {
    const prev = i > 0 ? list[i - 1] : null;
    const b = s.baselines ?? {};
    const p = prev?.baselines ?? {};
    const moved = (['contract', 'budget', 'cashflow', 'schedule', 'forecast'] as const)
      .some(k => (b[k]?.id ?? '') !== (p[k]?.id ?? ''));
    return {
      period: s.periodLabel || s.periodId,
      dataDate: s.dataDate,
      contract: label(b.contract),
      budget: label(b.budget),
      cashflow: label(b.cashflow),
      schedule: label(b.schedule),
      forecast: label(b.forecast),
      rebaselined: prev ? moved : false,
    };
  });
}

// ── Reporting helper ───────────────────────────────────────────────────

/**
 * Flattens a snapshot for the PDF layer.
 *
 * The report reads these values directly. No recalculation happens during
 * generation — that is the point of archiving them in the first place.
 */
export function snapshotForReport(s: TimelineSnapshot): Record<string, unknown> {
  return {
    periodId: s.periodId,
    periodLabel: s.periodLabel,
    dataDate: s.dataDate,
    approvedAt: s.approvedAt,
    approvedBy: s.approvedBy,
    status: s.status,
    note: s.note,
    baselineName: s.contract?.baselineName ?? '',
    baselineVersion: s.contract?.baselineVersion ?? 0,
    approvedFinish: s.contract?.approvedFinish ?? '',
    forecastFinish: s.contract?.forecastFinish ?? '',
    exchangeRate: s.exchange?.rate ?? 1,
    exchangeCurrency: s.exchange?.reportingCurrency ?? '',
    exchangeRates: s.exchange?.rates ?? [],
    appliedRates: s.exchange?.appliedRates ?? [],
    ratesKnownAsOf: s.exchange?.ratesKnownAsOf ?? '',
    contractCurrency: s.exchange?.contractCurrency ?? '',
    conversions: s.exchange?.conversions ?? [],
    delay: s.delay ?? null,
    ld: s.ld ?? null,
    commercial: s.commercial ?? null,
    cash: s.cash ?? null,
    evm: s.evm ?? null,
    claims: s.claims ?? null,
    subcontracts: s.subcontracts ?? null,
    kpi: s.kpi ?? null,
    baselines: s.baselines ?? null,
  };
}
