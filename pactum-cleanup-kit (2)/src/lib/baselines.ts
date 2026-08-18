/**
 * Enterprise Baseline System.
 * Destination: src/lib/baselines.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 *
 *   A baseline is a frozen statement of the plan — what the project said it
 *   would cost, earn, spend and finish, on the day someone signed for it.
 *   This module stores those statements, versions them, and can put any two
 *   of them side by side. Five families are supported:
 *
 *     contract · budget · cashflow · schedule · forecast
 *
 * WHAT THIS IS NOT
 *
 *   There is not one business formula in this file. Every figure that enters
 *   a baseline was produced by the module that owns it — Budget, Cash Flow,
 *   Delay, EVM, Commercial. The capture helpers read those stores and copy
 *   the numbers verbatim, using the owning module's own field names and its
 *   own filters, so an archived figure equals the one that was on screen.
 *
 *   No existing calculation is modified. No Timeline logic is modified.
 *   Timeline gains a REFERENCE to the active baselines; it does not gain a
 *   dependency on them, and a project with no baselines behaves exactly as
 *   it does today.
 *
 * STORAGE
 *
 *   pactum-baselines-${projectId}  ->  BaselineStore
 *
 *   ONE new key. Nothing else in the platform is written by this file. The
 *   capture helpers open other stores with getItem and never call setItem
 *   on them.
 *
 * IMMUTABILITY
 *
 *   A baseline is never overwritten and never edited once it leaves draft.
 *   `createBaseline` always allocates the next version number for its type;
 *   there is no update path for an active or superseded record. Replacing a
 *   plan means issuing the next version, which marks the previous one
 *   superseded and keeps it readable forever — a withdrawn plan is still
 *   part of the audit trail, and half the value of a baseline register is
 *   being able to say what the plan used to be.
 *
 *   Draft is the one editable state, because a draft has not been signed and
 *   nothing references it yet.
 * ══════════════════════════════════════════════════════════════════════
 */

// ── Model ──────────────────────────────────────────────────────────────

/**
 * PHASE 4 · STEP 9 — the rebuild reuses the modules that OWN these rules
 * rather than restating them. `deriveBudget` is the same derivation the
 * Budget screen displays, and the eligibility test is the same one the
 * change-order and claim registers show, so a package can never record a
 * figure or an inclusion the user did not see.
 *
 * No cycle: neither module imports this one.
 */
import { deriveBudget as __deriveBudgetRaw, type BudgetLineLike } from './costModel';
import {
  isBaselineEligible as __isEligible, costOf as __costOf,
  budgetLineRefOf as __refOf, type CostBearingRow,
} from './changeCost';
// STEP 10 — the authoritative gate, called not re-implemented. The gate
// imports back from here with `import type`, which is erased at build
// time, so the runtime module graph stays acyclic.
import { evaluateBaselineGate as __evaluateGate } from './baselineGate';
/**
 * SOURCE VERSIONING — decision ⑴=A.
 *
 * A package is built from, and judged against, the APPROVED source
 * versions it is bound to. Not the live registers. The two diverge the
 * moment somebody edits a budget line between capture and signature, and
 * measuring a package against a register it was never made from would
 * fail every approval that took longer than an afternoon.
 *
 * No cycle: `sourceVersions.ts` imports nothing from this module.
 */
import {
  approvedRefs as __approvedRefs, approvedRows as __approvedRows,
  approvedSnapshot as __approvedSnapshot, cleanSourceRefs as __cleanRefs,
  hasAnyVersions as __hasAnyVersions, refsReadiness as __refsReadiness,
  type SourceRefs, type SourceKind,
} from './sourceVersions';

export type BaselineType = 'contract' | 'budget' | 'cashflow' | 'schedule' | 'forecast';

/**
 * draft      — being prepared, editable, referenced by nothing.
 * active     — the plan in force. At most ONE per type.
 * superseded — replaced by a later version. Kept and readable.
 * rejected   — a draft that was never adopted. Kept, so the trail shows the
 *              option that was considered and declined.
 */
export type BaselineStatus = 'draft' | 'active' | 'superseded' | 'rejected';

export const BASELINE_TYPES: { value: BaselineType; en: string; ar: string }[] = [
  { value: 'contract', en: 'Contract Baseline', ar: 'خط الأساس التعاقدي' },
  { value: 'budget',   en: 'Budget Baseline',   ar: 'خط أساس الموازنة' },
  { value: 'cashflow', en: 'Cash Flow Baseline',ar: 'خط أساس التدفق النقدي' },
  { value: 'schedule', en: 'Schedule Baseline', ar: 'خط أساس البرنامج الزمني' },
  { value: 'forecast', en: 'Forecast Baseline', ar: 'خط أساس التوقعات' },
];

export const BASELINE_STATUSES: { value: BaselineStatus; en: string; ar: string }[] = [
  { value: 'draft',      en: 'Draft',      ar: 'مسودة' },
  { value: 'active',     en: 'Active',     ar: 'سارٍ' },
  { value: 'superseded', en: 'Superseded', ar: 'مُستبدَل' },
  { value: 'rejected',   en: 'Rejected',   ar: 'مرفوض' },
];

/**
 * Why a baseline was raised. Required for anything past V1 — a re-baseline
 * without a stated cause is the single most common way a project loses the
 * ability to explain its own history.
 */
export type BaselineCause =
  | 'initial'
  | 'change-order'
  | 'claim-settlement'
  | 'eot-award'
  | 'scope-change'
  | 'commercial-reset'
  | 'funding-change'
  | 'correction'
  | 'other';

export const BASELINE_CAUSES: { value: BaselineCause; en: string; ar: string }[] = [
  { value: 'initial',           en: 'Initial baseline',      ar: 'خط الأساس الابتدائي' },
  { value: 'change-order',      en: 'Approved change order', ar: 'أمر تغيير معتمد' },
  { value: 'claim-settlement',  en: 'Claim settlement',      ar: 'تسوية مطالبة' },
  { value: 'eot-award',         en: 'EOT award',             ar: 'تمديد معتمد' },
  { value: 'scope-change',      en: 'Scope change',          ar: 'تغيير في النطاق' },
  { value: 'commercial-reset',  en: 'Commercial reset',      ar: 'إعادة ضبط تجاري' },
  { value: 'funding-change',    en: 'Funding change',        ar: 'تغيير في التمويل' },
  { value: 'correction',        en: 'Correction of error',   ar: 'تصحيح خطأ' },
  { value: 'other',             en: 'Other',                 ar: 'أخرى' },
];

// ── Payloads ───────────────────────────────────────────────────────────
//
// One shape per family. Every field is a plain number, string or a flat row
// array: a baseline that cannot be serialised cannot be frozen.

/** The commercial plan: what the contract was worth when this was signed. */
export interface ContractBaselineData {
  originalContract: number;
  approvedChangeOrders: number;
  approvedClaims: number;
  /**
   * Contract Amount = Contract Value + approved change orders + approved
   * claims.
   *
   * CORRECTED COMMENT — the previous text read "Claims excluded, per
   * platform rule", which contradicted the only implementation of the
   * rule. `commercialTotals.ts:200` has always computed
   * `originalContract + approvedChangeOrders + approvedClaims`, and every
   * screen reads that figure. The comment was stale documentation, not a
   * second rule; nothing about the calculation changed here.
   */
  currentContract: number;
  currency: string;
  commencementDate: string;
  contractualCompletion: string;
  approvedCompletion: string;
  ldRatePerDay: number;
  /** 0 means no cap entered. Preserved verbatim, never reinterpreted. */
  ldCapAmount: number;
}

/** The cost plan, with category detail — a total cannot say which package moved. */
export interface BudgetBaselineData {
  totalPlanned: number;
  totalActual: number;
  totalForecast: number;
  variance: number;
  categoryCount: number;
  categories: { category: string; planned: number; actual: number; forecast: number }[];

  /**
   * ════════════════════════════════════════════════════════════════════
   * STEP 12 · Q6=B — THE APPROVED COST SPLIT, CAPTURED AT BASELINE TIME.
   *
   * Step 12 makes BAC the APPROVED budget rather than the contract value,
   * and splits it into Direct and Indirect. That needs a number nobody
   * can move after the fact.
   *
   * The live register (`pactum-budget-{p}`) splits, but it is not
   * approved: it changes the instant a planner edits a row, which would
   * drag BAC with it. This snapshot is approved and frozen — so the
   * split is captured HERE, at the moment the package is built, from the
   * same rows that produced `totalPlanned`.
   *
   * OPTIONAL, AND THAT IS DELIBERATE. Packages filed before Step 12 have
   * no split and must never be rewritten to invent one. A reader that
   * finds these fields absent is looking at a pre-Step-12 baseline and
   * must say so rather than guess — see `bacSplitFrom()` in evm.ts.
   *
   * `directPlanned + indirectPlanned` is deliberately NOT asserted to
   * equal `totalPlanned`: unclassified lines carry value that belongs to
   * neither class. `unclassifiedPlanned` exposes that gap instead of
   * hiding it inside one of the two.
   * ════════════════════════════════════════════════════════════════════
   */
  directPlanned?: number;
  indirectPlanned?: number;
  unclassifiedPlanned?: number;
  /** True when every line carried a cost type at capture time. */
  splitComplete?: boolean;
}

/** The funding plan, period by period. */
export interface CashflowBaselineData {
  totalIn: number;
  totalOut: number;
  netFlow: number;
  cumulativeNet: number;
  periodCount: number;
  periods: { period: string; in: number; out: number; cumNet: number }[];
}

/** The time plan. */
export interface ScheduleBaselineData {
  commencementDate: string;
  plannedDurationDays: number;
  baselineFinish: string;
  approvedFinish: string;
  forecastFinish: string;
  approvedEOT: number;
  totalDelay: number;
  /** totalDelay − approvedEOT, as the Delay module reports it. */
  unmitigated: number;
}

/** The outturn view held at the moment of signing. */
export interface ForecastBaselineData {
  method: string;
  bac: number;
  eac: number;
  etc: number;
  vac: number;
  forecastFinish: string;
  slipDays: number;
  cpiCum: number | null;
  spiCum: number | null;
  basisPeriods: number;
}

export type BaselineData =
  | ContractBaselineData | BudgetBaselineData | CashflowBaselineData
  | ScheduleBaselineData | ForecastBaselineData;

/**
 * One versioned, frozen statement of a plan.
 *
 * The six fields the brief requires — creation date, created by, reason,
 * status, version, notes — are first-class and never optional. A baseline
 * without a stated reason is an unexplained change to the plan, and the
 * register exists precisely to stop those from happening silently.
 */
export interface BaselineRecord {
  id: string;
  projectId: string;
  type: BaselineType;
  /** 1-based, per type. Allocated by the store, never supplied by a caller. */
  version: number;
  /**
   * The attempt number under this version. Same rule as the Baseline
   * Package: a REJECTED version is retried as V2 Rev 1, V2 Rev 2, and
   * only becomes settled when a version under it is ACTIVATED. 0 on a
   * first attempt.
   */
  revision: number;
  /** e.g. "Contract Baseline V3" or "Contract Baseline V3 Rev 1". */
  name: string;

  createdAt: string;
  createdBy: string;
  reason: string;
  cause: BaselineCause;
  status: BaselineStatus;
  notes: string;

  /** Set when a draft is adopted. Empty on a draft. */
  activatedAt: string;
  activatedBy: string;

  /** Set when a later version takes over, or on manual withdrawal. */
  supersededAt: string;
  supersededBy: string;
  /** Id of the version that replaced this one. '' on manual withdrawal. */
  supersededById: string;

  /** Data date the plan describes — distinct from when it was keyed in. */
  dataDate: string;

  data: BaselineData;
  schema: number;
}

export interface BaselineStore {
  baselines: BaselineRecord[];
  /**
   * PHASE 4 · STEP 3 — the authoritative Baseline Package.
   *
   * OPTIONAL, and absent on every project that has never created one, so
   * an untouched store serialises byte-for-byte as it always did.
   *
   * ════════════════════════════════════════════════════════════════════
   * WHY THIS IS NOT A SIXTH `BaselineType`.
   *
   * `TYPES` is enumerated in four places OUTSIDE this module:
   *
   *   baselineCoverage()            — drives the Reports completeness badge
   *   BaselineRefs                  — a struct with exactly five keys
   *   timeline.ts BaselineRefsSnapshot — the SAME five keys, written into
   *                                   FILED Timeline snapshots
   *   ReportsModule.tsx             — prints "present.length / 12"
   *
   * Adding a sixth member would mark every existing project incomplete,
   * and would change the shape of newly filed Timeline snapshots while
   * old ones kept five keys — two shapes of the same historical record.
   * The package is therefore a SEPARATE COLLECTION in the SAME store: one
   * authoritative baseline system, as decided, with the five-family
   * contract that history depends on left exactly as it is.
   * ════════════════════════════════════════════════════════════════════
   */
  packages?: BaselinePackage[];
}

/**
 * A complete, approved financial snapshot of the project.
 *
 * Everything here is a RECORD OF WHAT WAS APPROVED, captured once. It is
 * never recomputed on read: that is the entire point of a baseline, and
 * it is why the figures are stored rather than derived at display time.
 */
export interface BaselinePackage {
  id: string;
  projectId: string;
  /** 1-based, allocated by the store. Never supplied by a caller. */
  version: number;
  /**
   * ════════════════════════════════════════════════════════════════════
   * REJECTION DOES NOT BURN THE VERSION NUMBER.
   *
   *     V2 submitted -> REJECTED
   *     next attempt -> V2 Rev 1        (not V3)
   *     rejected again -> V2 Rev 2
   *     approved      -> V2, and the next plan is V3
   *
   * A version number names A PLAN. A revision names AN ATTEMPT to get
   * that plan approved. Letting a rejection consume V2 would mean the
   * project's baseline history read V1, V3, V6 — and every reader would
   * ask what happened to V2 and V4, when the answer is "nothing was ever
   * approved under those numbers".
   *
   * 0 on a first attempt, and 0 is written rather than omitted so the
   * field is always present and never has to be inferred.
   *
   * SEPARATE FIELD, NOT A DECIMAL. `version` stays an integer because
   * twelve places in this file and the gate sort and Math.max on it. A
   * 2.1 would silently reorder history the first time a project reached
   * V2 Rev 10.
   * ════════════════════════════════════════════════════════════════════
   */
  revision: number;
  /** e.g. "Baseline Package V2" or "Baseline Package V2 Rev 1". */
  name: string;

  /**
   * The date the plan DESCRIBES — the as-of point the figures were true.
   * Distinct from `approvedAt`, which is when a person signed it. The two
   * are routinely weeks apart and conflating them misdates the plan.
   * Same semantics as `BaselineRecord.dataDate`; no new date concept.
   */
  effectiveDate: string;

  status: PackageStatus;

  /** Set only when approved. Empty on a draft. */
  approvedAt: string;
  approvedBy: string;

  /** Set when a later version takes over. */
  supersededAt: string;
  supersededById: string;
  /** The version this one was built to replace. '' on V1. */
  supersedesId: string;

  createdAt: string;
  createdBy: string;
  reason: string;
  notes: string;

  data: PackageData;
  schema: number;
}

/**
 * Draft → approved → superseded. There is no path back: an approved
 * package is a historical statement, and `rejected` exists so a draft can
 * be abandoned without deleting the record of the attempt.
 */
export type PackageStatus = 'draft' | 'approved' | 'superseded' | 'rejected';

export interface PackageData {
  /** The unit every figure below is denominated in. */
  currency: string;

  // ── Budget, derived from the classified lines at capture time ────────
  directBudget: number;
  indirectBudget: number;
  /** directBudget + indirectBudget. Rule A holds by construction. */
  totalBudget: number;
  /**
   * Lines that carried no classification when this was captured. Named,
   * never guessed, and their value is NOT inside `totalBudget`.
   */
  unclassifiedRefs: string[];
  unclassifiedValue: number;
  /** Lines excluded because they were stored in another currency. */
  excludedRefs: string[];
  budgetLineCount: number;

  // ── Cash flow ────────────────────────────────────────────────────────
  plannedCashIn: number;
  plannedCashOut: number;
  cashPeriodCount: number;

  // ── EVM planned cost — DIRECT ONLY ───────────────────────────────────
  /**
   * The approved planned direct cost. Stored, not computed: Step 3 only
   * has to be able to HOLD it. The EVM engine is not changed here and
   * still runs on its own basis until the consolidation step.
   */
  evmPlannedDirectCost: number;

  // ── Commercial changes included in this package ──────────────────────
  /**
   * References only. No cost is recorded here in Step 3, because cost
   * assessment does not exist yet and inventing a number would be
   * fabricating a financial fact.
   */
  includedChangeOrderIds: string[];
  includedClaimIds: string[];

  /**
   * ════════════════════════════════════════════════════════════════════
   * WHICH APPROVED SOURCE VERSIONS THIS PACKAGE WAS BUILT FROM.
   *
   *     Budget V3 · Cash Flow V2 · EVM Planned V4 · Claims V2 · CO V7
   *
   * The numbers are independent by design. A source that did not change
   * did not gain a version, and forcing them into step would record an
   * event that never happened.
   *
   * `null` — the whole field, not a slot — means this package predates
   * source versioning. It is reported as "pre-versioning baseline",
   * never as "built from V1", because it was not. This is the ONE gap
   * the immutability attack test named: the package recorded which COs
   * and claims it included but nothing about which budget, cash flow or
   * EVM calendar. It records them now.
   *
   * Filed once, at capture. Never re-resolved on read — that would let
   * an old baseline silently point at a newer source, which is exactly
   * what the immutability rule forbids.
   * ════════════════════════════════════════════════════════════════════
   */
  sourceRefs?: SourceRefs | null;
}

export const PACKAGE_SCHEMA = 1;

export const BASELINE_SCHEMA = 1;

export const EMPTY_BASELINES: BaselineStore = { baselines: [] };

const KEY = (projectId: string) => `pactum-baselines-${projectId}`;

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

function str(v: any): string {
  return v === null || v === undefined ? '' : String(v);
}

const TYPES: BaselineType[] = ['contract', 'budget', 'cashflow', 'schedule', 'forecast'];
const STATUSES: BaselineStatus[] = ['draft', 'active', 'superseded', 'rejected'];

/**
 * Coerces one stored record.
 *
 * Nothing is re-derived. A baseline must say on read exactly what it said on
 * write; cleaning is limited to type safety so a corrupted store cannot take
 * the page down.
 */
function cleanData(type: BaselineType, d: any): BaselineData {
  const o = d && typeof d === 'object' ? d : {};
  switch (type) {
    case 'contract':
      return {
        originalContract: num(o.originalContract),
        approvedChangeOrders: num(o.approvedChangeOrders),
        approvedClaims: num(o.approvedClaims),
        currentContract: num(o.currentContract),
        currency: str(o.currency) || 'SAR',
        commencementDate: str(o.commencementDate),
        contractualCompletion: str(o.contractualCompletion),
        approvedCompletion: str(o.approvedCompletion),
        ldRatePerDay: num(o.ldRatePerDay),
        ldCapAmount: num(o.ldCapAmount),
      } as ContractBaselineData;
    case 'budget':
      return {
        totalPlanned: num(o.totalPlanned),
        totalActual: num(o.totalActual),
        totalForecast: num(o.totalForecast),
        variance: num(o.variance),
        categoryCount: num(o.categoryCount),
        categories: Array.isArray(o.categories)
          ? o.categories.map((c: any) => ({
              category: str(c?.category),
              planned: num(c?.planned), actual: num(c?.actual), forecast: num(c?.forecast),
            }))
          : [],
      } as BudgetBaselineData;
    case 'cashflow':
      return {
        totalIn: num(o.totalIn),
        totalOut: num(o.totalOut),
        netFlow: num(o.netFlow),
        cumulativeNet: num(o.cumulativeNet),
        periodCount: num(o.periodCount),
        periods: Array.isArray(o.periods)
          ? o.periods.map((p: any) => ({
              period: str(p?.period), in: num(p?.in), out: num(p?.out), cumNet: num(p?.cumNet),
            }))
          : [],
      } as CashflowBaselineData;
    case 'schedule':
      return {
        commencementDate: str(o.commencementDate),
        plannedDurationDays: num(o.plannedDurationDays),
        baselineFinish: str(o.baselineFinish),
        approvedFinish: str(o.approvedFinish),
        forecastFinish: str(o.forecastFinish),
        approvedEOT: num(o.approvedEOT),
        totalDelay: num(o.totalDelay),
        unmitigated: num(o.unmitigated),
      } as ScheduleBaselineData;
    case 'forecast':
    default:
      return {
        method: str(o.method),
        bac: num(o.bac), eac: num(o.eac), etc: num(o.etc), vac: num(o.vac),
        forecastFinish: str(o.forecastFinish),
        slipDays: num(o.slipDays),
        cpiCum: nullableNum(o.cpiCum),
        spiCum: nullableNum(o.spiCum),
        basisPeriods: num(o.basisPeriods),
      } as ForecastBaselineData;
  }
}

function cleanRecord(r: any, i: number): BaselineRecord {
  const type: BaselineType = TYPES.includes(r?.type) ? r.type : 'contract';
  const status: BaselineStatus = STATUSES.includes(r?.status) ? r.status : 'active';
  const version = num(r?.version) || 1;
  // Absent on every record filed before rejection-revisions existed.
  // 0 is the correct reading: it was a first attempt.
  const revision = num(r?.revision);
  return {
    id: str(r?.id) || `bl-${type}-${i}`,
    projectId: str(r?.projectId),
    type,
    version,
    revision,
    name: str(r?.name) || `${labelOf(type, 'en')} ${versionLabel({ version, revision })}`,
    createdAt: str(r?.createdAt),
    createdBy: str(r?.createdBy),
    reason: str(r?.reason),
    cause: (BASELINE_CAUSES.some(c => c.value === r?.cause) ? r.cause : 'other') as BaselineCause,
    status,
    notes: str(r?.notes),
    activatedAt: str(r?.activatedAt),
    activatedBy: str(r?.activatedBy),
    supersededAt: str(r?.supersededAt),
    supersededBy: str(r?.supersededBy),
    supersededById: str(r?.supersededById),
    dataDate: str(r?.dataDate),
    data: cleanData(type, r?.data),
    schema: num(r?.schema) || BASELINE_SCHEMA,
  };
}

export function labelOf(type: BaselineType, lang: 'en' | 'ar' = 'en'): string {
  const t = BASELINE_TYPES.find(x => x.value === type);
  return t ? (lang === 'ar' ? t.ar : t.en) : type;
}

export function statusLabel(status: BaselineStatus, lang: 'en' | 'ar' = 'en'): string {
  const s = BASELINE_STATUSES.find(x => x.value === status);
  return s ? (lang === 'ar' ? s.ar : s.en) : status;
}

export function causeLabel(cause: BaselineCause, lang: 'en' | 'ar' = 'en'): string {
  const c = BASELINE_CAUSES.find(x => x.value === cause);
  return c ? (lang === 'ar' ? c.ar : c.en) : cause;
}

export function readBaselines(projectId: string): BaselineStore {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(projectId)) || 'null');
    if (!raw || typeof raw !== 'object') return { baselines: [] };
    const out: BaselineStore = {
      baselines: Array.isArray(raw.baselines) ? raw.baselines.map(cleanRecord) : [],
    };
    // PHASE 4 · STEP 3 — the package list travels with the store. Only
    // attached when present, so a project that has never had a package
    // still serialises to exactly the same bytes it did before.
    if (Array.isArray(raw.packages) && raw.packages.length > 0) {
      out.packages = raw.packages.map(cleanPackage);
    }
    return out;
  } catch {
    return { baselines: [] };
  }
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS MERGES INSTEAD OF WRITING WHAT IT WAS HANDED.
 *
 * Every one of the five family writers builds its next state as
 * `{ baselines }` — a fresh object literal with no other key. That was
 * correct while `baselines` was the only field in the store. The moment a
 * second field exists, each of those writers would serialise a store with
 * `packages` MISSING, and the approved packages would be silently deleted
 * by an unrelated action such as activating a schedule baseline.
 *
 * Rather than edit five call sites and rely on nobody adding a sixth, the
 * single writer now re-reads what is on disk and preserves any field the
 * caller did not supply. A caller can only ever ADD to the store here; it
 * cannot drop a sibling collection by omission.
 * ══════════════════════════════════════════════════════════════════════
 */
function writeBaselines(projectId: string, store: BaselineStore): void {
  try {
    let existing: any = null;
    try { existing = JSON.parse(localStorage.getItem(KEY(projectId)) || 'null'); } catch { /* noop */ }
    const merged: any = { ...(existing && typeof existing === 'object' ? existing : {}), ...store };
    // An empty package list is not written — it would change the stored
    // bytes of every project that has no package, for no benefit.
    if (Array.isArray(merged.packages) && merged.packages.length === 0) delete merged.packages;
    localStorage.setItem(KEY(projectId), JSON.stringify(merged));
  } catch {
    /* quota — same policy as every other store in the platform */
  }
}

// ── Queries ────────────────────────────────────────────────────────────

/** Every version of one family, oldest first. */
export function historyOf(store: BaselineStore, type: BaselineType): BaselineRecord[] {
  return store.baselines
    .filter(b => b.type === type)
    .sort((a, b) => a.version - b.version);
}

/** The plan in force for one family, or null when none has been adopted. */
export function activeOf(store: BaselineStore, type: BaselineType): BaselineRecord | null {
  return store.baselines.find(b => b.type === type && b.status === 'active') ?? null;
}

/** The open draft for one family, or null. At most one exists at a time. */
export function draftOf(store: BaselineStore, type: BaselineType): BaselineRecord | null {
  return store.baselines.find(b => b.type === type && b.status === 'draft') ?? null;
}

export function byId(store: BaselineStore, id: string): BaselineRecord | null {
  return store.baselines.find(b => b.id === id) ?? null;
}

/** Next version number for a family. Versions are never reused. */
export function nextVersion(store: BaselineStore, type: BaselineType): number {
  const list = store.baselines.filter(b => b.type === type);
  if (list.length === 0) return 1;
  const highest = Math.max(...list.map(b => num(b.version)));
  // A version is CONSUMED only when something under it was adopted.
  // 'active' and 'superseded' both mean it was activated at some point;
  // 'draft' and 'rejected' mean it never was, so the number is reusable.
  const settled = list.some(b =>
    num(b.version) === highest && (b.status === 'active' || b.status === 'superseded'));
  return settled ? highest + 1 : highest;
}

/** The attempt number for the next record of this family and version. */
export function nextRevision(
  store: BaselineStore, type: BaselineType, version: number,
): number {
  const attempts = store.baselines.filter(
    b => b.type === type && num(b.version) === version);
  if (attempts.length === 0) return 0;
  return attempts.reduce((m, b) => Math.max(m, num(b.revision)), 0) + 1;
}

/**
 * The human label for a baseline record. THE ONLY PLACE IT IS BUILT.
 *
 *     V2         a first attempt
 *     V2 Rev 1   the attempt after V2 was rejected once
 */
export function versionLabel(b: { version: number; revision?: number }): string {
  const rev = num(b?.revision);
  return rev > 0 ? `V${num(b?.version)} Rev ${rev}` : `V${num(b?.version)}`;
}

/** Which families have an active plan, and which never had one. */
export function baselineCoverage(store: BaselineStore): {
  present: BaselineType[]; missing: BaselineType[]; complete: boolean;
} {
  const present: BaselineType[] = [];
  const missing: BaselineType[] = [];
  TYPES.forEach(t => (activeOf(store, t) ? present : missing).push(t));
  return { present, missing, complete: missing.length === 0 };
}

// ── Create · Activate · Supersede ──────────────────────────────────────

export interface CreateBaselineInput {
  type: BaselineType;
  createdBy: string;
  reason: string;
  cause?: BaselineCause;
  notes?: string;
  dataDate?: string;
  data: BaselineData;
  /** Adopt immediately instead of parking as a draft. */
  activate?: boolean;
  name?: string;
}

export interface BaselineResult {
  store: BaselineStore;
  ok: boolean;
  reason?: 'missing-reason' | 'missing-type' | 'draft-exists' | 'not-found'
         | 'immutable' | 'already-superseded' | 'not-draft';
  record?: BaselineRecord;
}

/**
 * Raises the next version of a plan.
 *
 * Always allocates a fresh version number, so nothing that already exists
 * can be touched. A reason is mandatory: an unexplained re-baseline is the
 * fastest way for a project to lose the thread of its own history, and the
 * cost of refusing here is one sentence from the person raising it.
 *
 * Only one draft per family is allowed at a time — two competing unsigned
 * plans is an ambiguity nobody can resolve later.
 */
export function createBaseline(projectId: string, input: CreateBaselineInput): BaselineResult {
  const store = readBaselines(projectId);
  if (!input.type || !TYPES.includes(input.type)) {
    return { store, ok: false, reason: 'missing-type' };
  }
  if (!input.reason || !input.reason.trim()) {
    return { store, ok: false, reason: 'missing-reason' };
  }
  if (draftOf(store, input.type)) {
    return { store, ok: false, reason: 'draft-exists' };
  }

  const version = nextVersion(store, input.type);
  // Reusing a version that was never adopted means this is its next
  // REVISION, not a new plan.
  const revision = nextRevision(store, input.type, version);
  const now = new Date().toISOString();
  const activate = input.activate !== false;   // default: adopt on creation

  const record: BaselineRecord = {
    id: `bl-${input.type}-v${version}r${revision}-${Date.now()}`,
    projectId,
    type: input.type,
    version,
    revision,
    name: (input.name && input.name.trim())
      || `${labelOf(input.type, 'en')} ${versionLabel({ version, revision })}`,
    createdAt: now,
    createdBy: input.createdBy || 'unknown',
    reason: input.reason.trim(),
    cause: input.cause ?? (version === 1 && revision === 0 ? 'initial' : 'other'),
    status: activate ? 'active' : 'draft',
    notes: (input.notes ?? '').trim(),
    activatedAt: activate ? now : '',
    activatedBy: activate ? (input.createdBy || 'unknown') : '',
    supersededAt: '',
    supersededBy: '',
    supersededById: '',
    dataDate: input.dataDate || now.slice(0, 10),
    data: cleanData(input.type, input.data),
    schema: BASELINE_SCHEMA,
  };

  // Adopting a new plan retires the previous one. It stays on record.
  const prior = activate ? activeOf(store, input.type) : null;
  const baselines = store.baselines.map(b =>
    prior && b.id === prior.id
      ? {
          ...b,
          status: 'superseded' as BaselineStatus,
          supersededAt: now,
          supersededBy: input.createdBy || 'unknown',
          supersededById: record.id,
        }
      : b,
  );

  const next: BaselineStore = { baselines: [...baselines, record] };
  writeBaselines(projectId, next);
  return { store: next, ok: true, record };
}

/**
 * Adopts a draft. The previous active version of the same family is retired.
 * Refused for anything that is not a draft — an active or superseded record
 * is frozen and has no transitions back.
 */
export function activateBaseline(
  projectId: string, baselineId: string, activatedBy: string,
): BaselineResult {
  const store = readBaselines(projectId);
  const target = byId(store, baselineId);
  if (!target) return { store, ok: false, reason: 'not-found' };
  if (target.status !== 'draft') return { store, ok: false, reason: 'not-draft' };

  const now = new Date().toISOString();
  const prior = activeOf(store, target.type);

  const baselines = store.baselines.map(b => {
    if (b.id === target.id) {
      return { ...b, status: 'active' as BaselineStatus, activatedAt: now, activatedBy: activatedBy || 'unknown' };
    }
    if (prior && b.id === prior.id) {
      return {
        ...b,
        status: 'superseded' as BaselineStatus,
        supersededAt: now,
        supersededBy: activatedBy || 'unknown',
        supersededById: target.id,
      };
    }
    return b;
  });

  const next: BaselineStore = { baselines };
  writeBaselines(projectId, next);
  return { store: next, ok: true, record: baselines.find(b => b.id === target.id) };
}

/**
 * Withdraws a plan without a replacement.
 *
 * The record is kept and stays readable — a withdrawn plan is still part of
 * the trail, and deleting it would leave every snapshot that referenced it
 * pointing at nothing.
 */
export function supersedeBaseline(
  projectId: string, baselineId: string, supersededBy: string, note = '',
): BaselineResult {
  const store = readBaselines(projectId);
  const target = byId(store, baselineId);
  if (!target) return { store, ok: false, reason: 'not-found' };
  if (target.status === 'superseded') return { store, ok: false, reason: 'already-superseded' };

  const now = new Date().toISOString();
  const baselines = store.baselines.map(b =>
    b.id === baselineId
      ? {
          ...b,
          status: 'superseded' as BaselineStatus,
          supersededAt: now,
          supersededBy: supersededBy || 'unknown',
          supersededById: '',
          notes: note.trim() ? `${b.notes}${b.notes ? ' · ' : ''}${note.trim()}` : b.notes,
        }
      : b,
  );

  const next: BaselineStore = { baselines };
  writeBaselines(projectId, next);
  return { store: next, ok: true, record: baselines.find(b => b.id === baselineId) };
}

/** Declines a draft. Kept on record so the option considered is visible. */
export function rejectDraft(projectId: string, baselineId: string, by: string, note = ''): BaselineResult {
  const store = readBaselines(projectId);
  const target = byId(store, baselineId);
  if (!target) return { store, ok: false, reason: 'not-found' };
  if (target.status !== 'draft') return { store, ok: false, reason: 'not-draft' };

  const baselines = store.baselines.map(b =>
    b.id === baselineId
      ? {
          ...b,
          status: 'rejected' as BaselineStatus,
          supersededAt: new Date().toISOString(),
          supersededBy: by || 'unknown',
          notes: note.trim() ? `${b.notes}${b.notes ? ' · ' : ''}${note.trim()}` : b.notes,
        }
      : b,
  );
  const next: BaselineStore = { baselines };
  writeBaselines(projectId, next);
  return { store: next, ok: true, record: baselines.find(b => b.id === baselineId) };
}

/**
 * Edits a DRAFT only.
 *
 * There is deliberately no equivalent for an active or superseded record.
 * Once a plan is adopted the only way to change it is to raise the next
 * version, which is what makes the register trustworthy.
 */
export function updateDraft(
  projectId: string, baselineId: string,
  patch: Partial<Pick<BaselineRecord, 'reason' | 'notes' | 'name' | 'cause' | 'dataDate' | 'data'>>,
): BaselineResult {
  const store = readBaselines(projectId);
  const target = byId(store, baselineId);
  if (!target) return { store, ok: false, reason: 'not-found' };
  if (target.status !== 'draft') return { store, ok: false, reason: 'immutable' };

  const baselines = store.baselines.map(b =>
    b.id === baselineId
      ? {
          ...b,
          reason: patch.reason !== undefined ? String(patch.reason) : b.reason,
          notes: patch.notes !== undefined ? String(patch.notes) : b.notes,
          name: patch.name !== undefined ? String(patch.name) : b.name,
          cause: patch.cause !== undefined ? patch.cause : b.cause,
          dataDate: patch.dataDate !== undefined ? String(patch.dataDate) : b.dataDate,
          data: patch.data !== undefined ? cleanData(b.type, patch.data) : b.data,
        }
      : b,
  );
  const next: BaselineStore = { baselines };
  writeBaselines(projectId, next);
  return { store: next, ok: true, record: baselines.find(b => b.id === baselineId) };
}

// ── Comparison ─────────────────────────────────────────────────────────

/**
 * The human label for a baseline data field.
 *
 * Exported because the Baselines preview grid was printing the RAW OBJECT
 * KEY — the screen showed "ORIGINALCONTRACT" and "APPROVEDCHANGEORDERS"
 * uppercased by CSS. `FIELD_LABELS` already held the correct wording and
 * had done all along; the grid simply never consulted it.
 *
 * Falls back to the key so a field added later is still readable rather
 * than blank.
 */
export function fieldLabel(key: string, lang: 'en' | 'ar' = 'en'): string {
  const f = FIELD_LABELS[key];
  if (!f) return key;
  return lang === 'ar' ? f.ar : f.en;
}

/** Field labels, so a comparison reads like a report rather than a diff. */
const FIELD_LABELS: Record<string, { en: string; ar: string; money?: boolean; date?: boolean; dayCount?: boolean }> = {
  // NAMING — platform-wide terminology, agreed and applied here only as
  // display text. The storage key `originalContract` is unchanged: renaming
  // a persisted key would invalidate every baseline already filed.
  originalContract:      { en: 'Contract Value',         ar: 'قيمة العقد', money: true },
  approvedChangeOrders:  { en: 'Approved Change Orders', ar: 'أوامر التغيير المعتمدة', money: true },
  approvedClaims:        { en: 'Approved Claims',        ar: 'المطالبات المعتمدة', money: true },
  // Contract Amount = Contract Value + approved COs + approved claims.
  currentContract:       { en: 'Contract Amount',        ar: 'إجمالي قيمة العقد', money: true },
  currency:              { en: 'Currency',               ar: 'العملة' },
  commencementDate:      { en: 'Commencement',           ar: 'تاريخ المباشرة', date: true },
  contractualCompletion: { en: 'Contractual Completion', ar: 'الإنجاز التعاقدي', date: true },
  approvedCompletion:    { en: 'Approved Completion',    ar: 'الإنجاز المعتمد', date: true },
  ldRatePerDay:          { en: 'LD Rate / Day',          ar: 'الغرامة اليومية', money: true },
  ldCapAmount:           { en: 'LD Cap',                 ar: 'سقف الغرامة', money: true },

  totalPlanned:  { en: 'Planned',  ar: 'المخطط', money: true },
  totalActual:   { en: 'Actual',   ar: 'الفعلي', money: true },
  totalForecast: { en: 'Forecast', ar: 'المتوقع', money: true },
  variance:      { en: 'Variance', ar: 'الانحراف', money: true },
  categoryCount: { en: 'Categories', ar: 'عدد البنود' },

  totalIn:       { en: 'Total In',       ar: 'إجمالي الوارد', money: true },
  totalOut:      { en: 'Total Out',      ar: 'إجمالي المنصرف', money: true },
  netFlow:       { en: 'Net Flow',       ar: 'صافي التدفق', money: true },
  cumulativeNet: { en: 'Cumulative Net', ar: 'الصافي التراكمي', money: true },
  periodCount:   { en: 'Periods',        ar: 'عدد الفترات' },

  plannedDurationDays: { en: 'Planned Duration', ar: 'المدة المخططة', dayCount: true },
  baselineFinish:      { en: 'Baseline Finish',  ar: 'الانتهاء الأساسي', date: true },
  approvedFinish:      { en: 'Approved Finish',  ar: 'الانتهاء المعتمد', date: true },
  forecastFinish:      { en: 'Forecast Finish',  ar: 'الانتهاء المتوقع', date: true },
  approvedEOT:         { en: 'Approved EOT',     ar: 'التمديد المعتمد', dayCount: true },
  totalDelay:          { en: 'Total Delay',      ar: 'إجمالي التأخير', dayCount: true },
  unmitigated:         { en: 'Unmitigated',      ar: 'غير المعوَّض', dayCount: true },

  method:       { en: 'EAC Method',   ar: 'طريقة الاحتساب' },
  bac:          { en: 'BAC',          ar: 'الموازنة عند الإنجاز', money: true },
  eac:          { en: 'EAC',          ar: 'التكلفة عند الإنجاز', money: true },
  etc:          { en: 'ETC',          ar: 'التكلفة المتبقية', money: true },
  vac:          { en: 'VAC',          ar: 'الانحراف عند الإنجاز', money: true },
  slipDays:     { en: 'Slip',         ar: 'الانزلاق', dayCount: true },
  cpiCum:       { en: 'CPI (cum)',    ar: 'مؤشر التكلفة التراكمي' },
  spiCum:       { en: 'SPI (cum)',    ar: 'مؤشر الجدول التراكمي' },
  basisPeriods: { en: 'Basis Periods', ar: 'الفترات المعتمدة' },
};

export interface ComparisonRow {
  key: string;
  label: string;
  labelAr: string;
  kind: 'money' | 'days' | 'date' | 'number' | 'text';
  from: string | number | null;
  to: string | number | null;
  /** Numeric movement. null for text/date fields or when either side is absent. */
  delta: number | null;
  /** Movement as a share of the earlier value. null when that value is 0. */
  pctDelta: number | null;
  changed: boolean;
}

export interface BaselineComparison {
  ok: boolean;
  reason?: 'type-mismatch' | 'missing';
  type?: BaselineType;
  from?: BaselineRecord;
  to?: BaselineRecord;
  rows: ComparisonRow[];
  /** Rows whose value actually moved. */
  changedCount: number;
  /** Elapsed days between the two data dates. null when either is absent. */
  daysBetween: number | null;
}

function kindOf(key: string): ComparisonRow['kind'] {
  const f = FIELD_LABELS[key];
  if (f?.money) return 'money';
  if (f?.date) return 'date';
  if (f?.dayCount) return 'days';
  return 'text';
}

/**
 * Puts two versions of the same plan side by side.
 *
 * Only scalar fields are compared. Category and period arrays are compared
 * separately by `compareDetail`, because a table of 30 cost codes inside a
 * summary diff is unreadable and hides the four figures that matter.
 *
 * Refuses two different families outright: a contract baseline and a
 * schedule baseline share no field, and a diff between them would be noise
 * dressed as analysis.
 */
export function compareBaselines(
  a: BaselineRecord | null, b: BaselineRecord | null,
): BaselineComparison {
  if (!a || !b) return { ok: false, reason: 'missing', rows: [], changedCount: 0, daysBetween: null };
  if (a.type !== b.type) {
    return { ok: false, reason: 'type-mismatch', rows: [], changedCount: 0, daysBetween: null };
  }

  const da = a.data as unknown as Record<string, unknown>;
  const db = b.data as unknown as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(da), ...Object.keys(db)]))
    .filter(k => !Array.isArray(da[k]) && !Array.isArray(db[k]));

  const rows: ComparisonRow[] = keys.map(k => {
    const from = (da[k] ?? null) as string | number | null;
    const to   = (db[k] ?? null) as string | number | null;
    const bothNum = typeof from === 'number' && typeof to === 'number';
    const delta = bothNum ? to - from : null;
    const pctDelta = bothNum && from !== 0 ? (to - from) / Math.abs(from) : null;
    const meta = FIELD_LABELS[k];
    return {
      key: k,
      label: meta?.en ?? k,
      labelAr: meta?.ar ?? k,
      kind: bothNum && !meta?.money && !meta?.dayCount ? 'number' : kindOf(k),
      from, to, delta, pctDelta,
      changed: from !== to,
    };
  });

  const t1 = Date.parse(a.dataDate), t2 = Date.parse(b.dataDate);
  const daysBetween = Number.isFinite(t1) && Number.isFinite(t2)
    ? Math.round((t2 - t1) / 86400000)
    : null;

  return {
    ok: true,
    type: a.type,
    from: a, to: b,
    rows,
    changedCount: rows.filter(r => r.changed).length,
    daysBetween,
  };
}

export interface DetailRow {
  key: string;
  from: number | null;
  to: number | null;
  delta: number | null;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
}

/**
 * Line-level movement inside a budget or cash flow baseline.
 *
 * A category that appears in one version and not the other is reported as
 * added or removed rather than as a movement from zero — a package that did
 * not exist and a package budgeted at nothing are different facts.
 */
export function compareDetail(
  a: BaselineRecord | null, b: BaselineRecord | null,
): DetailRow[] {
  if (!a || !b || a.type !== b.type) return [];

  const extract = (r: BaselineRecord): Record<string, number> => {
    const out: Record<string, number> = {};
    if (r.type === 'budget') {
      (r.data as BudgetBaselineData).categories.forEach(c => { out[c.category] = c.planned; });
    } else if (r.type === 'cashflow') {
      (r.data as CashflowBaselineData).periods.forEach(p => { out[p.period] = p.in - p.out; });
    }
    return out;
  };

  const from = extract(a), to = extract(b);
  const keys = Array.from(new Set([...Object.keys(from), ...Object.keys(to)]));
  return keys.map(k => {
    const f = k in from ? from[k] : null;
    const t = k in to ? to[k] : null;
    const status: DetailRow['status'] =
      f === null ? 'added' : t === null ? 'removed' : f === t ? 'unchanged' : 'changed';
    return { key: k, from: f, to: t, delta: f !== null && t !== null ? t - f : null, status };
  });
}

// ── Timeline reference ─────────────────────────────────────────────────

/**
 * The five active baselines, reduced to identity only.
 *
 * This is what a Timeline snapshot carries. It stores the ids and versions,
 * NOT the payloads: duplicating the plan into every monthly snapshot would
 * multiply the same numbers across the archive and create a second place
 * they could disagree. The baseline register is the one copy; a snapshot
 * points at it.
 *
 * Timeline is unaffected when this returns nothing. A project with no
 * baselines files snapshots exactly as it did before Phase 4.
 */
export interface BaselineRef {
  id: string;
  type: BaselineType;
  version: number;
  name: string;
  activatedAt: string;
  createdBy: string;
  cause: BaselineCause;
  reason: string;
  dataDate: string;
}

export interface BaselineRefs {
  contract?: BaselineRef;
  budget?: BaselineRef;
  cashflow?: BaselineRef;
  schedule?: BaselineRef;
  forecast?: BaselineRef;
}

function toRef(b: BaselineRecord): BaselineRef {
  return {
    id: b.id, type: b.type, version: b.version, name: b.name,
    activatedAt: b.activatedAt || b.createdAt,
    createdBy: b.createdBy, cause: b.cause, reason: b.reason, dataDate: b.dataDate,
  };
}

export function activeBaselineRefs(projectId: string): BaselineRefs {
  const store = readBaselines(projectId);
  const out: BaselineRefs = {};
  TYPES.forEach(t => {
    const b = activeOf(store, t);
    if (b) (out as any)[t] = toRef(b);
  });
  return out;
}

/** Same, from a store already in hand — avoids a second read on a hot path. */
export function refsFromStore(store: BaselineStore): BaselineRefs {
  const out: BaselineRefs = {};
  TYPES.forEach(t => {
    const b = activeOf(store, t);
    if (b) (out as any)[t] = toRef(b);
  });
  return out;
}

// ── Capture ────────────────────────────────────────────────────────────
//
// The functions below READ other modules' stores and copy their published
// figures. They open them with getItem and never write. Nothing here
// recomputes a total that a module already publishes; where one must be
// assembled from rows, it uses the same filter the owning module uses so the
// captured figure equals the one that was on screen.

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

interface ProjectLike {
  id: string;
  contractValue?: number;
  revisedContractValue?: number;
  totalApprovedCOs?: number;
  totalApprovedClaims?: number;
  commencementDate?: string;
  plannedDurationDays?: number;
  contractualCompletion?: string;
  approvedCompletion?: string;
  ldRatePerDay?: number;
  ldCapAmount?: number;
}

/** Contract plan, copied from the project record. */
export function captureContract(project: ProjectLike, currency = 'SAR'): ContractBaselineData {
  return {
    originalContract: num(project.contractValue),
    approvedChangeOrders: num(project.totalApprovedCOs),
    approvedClaims: num(project.totalApprovedClaims),
    currentContract: num(project.revisedContractValue) || num(project.contractValue),
    currency,
    commencementDate: str(project.commencementDate),
    contractualCompletion: str(project.contractualCompletion),
    approvedCompletion: str(project.approvedCompletion),
    ldRatePerDay: num(project.ldRatePerDay),
    // 0 is preserved as 0 — "no cap entered", never reinterpreted as a cap.
    ldCapAmount: num(project.ldCapAmount),
  };
}

/** Cost plan, read from `pactum-budget-{p}` using the module's own variance rule. */
export function captureBudget(projectId: string): BudgetBaselineData {
  const rows: any[] = readJson(`pactum-budget-${projectId}`, []);
  const list = Array.isArray(rows) ? rows : [];
  const totalPlanned  = list.reduce((a, r) => a + num(r.planned), 0);
  const totalActual   = list.reduce((a, r) => a + num(r.actual), 0);
  const totalForecast = list.reduce((a, r) => a + num(r.forecast), 0);

  /**
   * STEP 12 · Q6=B — freeze the Direct/Indirect split alongside the total.
   *
   * Reuses `deriveBudget` (Step 1), which is already the single authority
   * on what counts as direct, indirect or unclassified. No second
   * classifier is introduced here.
   */
  const split = __deriveBudgetRaw(list as BudgetLineLike[], '', 'planned');

  return {
    totalPlanned, totalActual, totalForecast,
    variance: totalPlanned - totalForecast,
    categoryCount: list.length,
    categories: list.map(r => ({
      category: str(r?.category),
      planned: num(r.planned), actual: num(r.actual), forecast: num(r.forecast),
    })),
    directPlanned: split.direct,
    indirectPlanned: split.indirect,
    unclassifiedPlanned: split.unclassified,
    splitComplete: split.complete,
  };
}

/** Funding plan, read from `pactum-cashflow-{p}`. */
export function captureCashflow(projectId: string): CashflowBaselineData {
  const rows: any[] = readJson(`pactum-cashflow-${projectId}`, []);
  const list = Array.isArray(rows) ? rows : [];
  const totalIn = list.reduce((a, r) => a + num(r.in), 0);
  const totalOut = list.reduce((a, r) => a + num(r.out), 0);
  return {
    totalIn, totalOut,
    netFlow: totalIn - totalOut,
    // The module maintains cumNet itself; the last row is the running total.
    cumulativeNet: list.length ? num(list[list.length - 1].cumNet) : 0,
    periodCount: list.length,
    periods: list.map(r => ({
      period: str(r?.period ?? r?.month),
      in: num(r.in), out: num(r.out), cumNet: num(r.cumNet),
    })),
  };
}

/**
 * Time plan. The caller passes the programme object the Delay engine already
 * produced — this file does not call the engine and does not re-derive a
 * single date.
 */
export function captureSchedule(programme: {
  commencementDate?: string; plannedDurationDays?: number;
  baselineFinish?: string; approvedFinish?: string; forecastFinish?: string;
}, totalDelay: number, approvedEOT: number): ScheduleBaselineData {
  return {
    commencementDate: str(programme.commencementDate),
    plannedDurationDays: num(programme.plannedDurationDays),
    baselineFinish: str(programme.baselineFinish),
    approvedFinish: str(programme.approvedFinish),
    forecastFinish: str(programme.forecastFinish),
    approvedEOT: num(approvedEOT),
    totalDelay: num(totalDelay),
    // The platform rule, copied not invented: Unmitigated = totalDelay − EOT.
    unmitigated: num(totalDelay) - num(approvedEOT),
  };
}

/**
 * Outturn view. The caller passes the EVM snapshot it already holds; the EVM
 * engine remains the only thing that produces these numbers.
 */
export function captureForecast(evm: {
  bac?: number; method?: string;
  m?: { eac?: number; etc?: number; vac?: number };
  dates?: { forecastFinish?: string; slipDays?: number };
  cum?: { cpiCum?: number | null; spiCum?: number | null; count?: number };
}): ForecastBaselineData {
  return {
    method: str(evm.method),
    bac: num(evm.bac),
    eac: num(evm.m?.eac),
    etc: num(evm.m?.etc),
    vac: num(evm.m?.vac),
    forecastFinish: str(evm.dates?.forecastFinish),
    slipDays: num(evm.dates?.slipDays),
    cpiCum: nullableNum(evm.cum?.cpiCum),
    spiCum: nullableNum(evm.cum?.spiCum),
    basisPeriods: num(evm.cum?.count),
  };
}

// ── Register view ──────────────────────────────────────────────────────

/** One flat row per baseline, for the register table and the report. */
export interface RegisterRow {
  id: string;
  type: BaselineType;
  typeLabel: string;
  version: number;
  name: string;
  status: BaselineStatus;
  createdAt: string;
  createdBy: string;
  dataDate: string;
  cause: BaselineCause;
  reason: string;
  notes: string;
  supersededAt: string;
  supersededBy: string;
  /** Headline figure of the family, so the register reads at a glance. */
  headline: number | null;
  headlineLabel: string;
}

export function registerRows(store: BaselineStore, lang: 'en' | 'ar' = 'en'): RegisterRow[] {
  return store.baselines
    .slice()
    .sort((a, b) =>
      a.type.localeCompare(b.type) || a.version - b.version)
    .map(b => {
      let headline: number | null = null;
      let headlineLabel = '';
      switch (b.type) {
        case 'contract':
          headline = (b.data as ContractBaselineData).currentContract;
          headlineLabel = lang === 'ar' ? 'قيمة العقد' : 'Current Contract'; break;
        case 'budget':
          headline = (b.data as BudgetBaselineData).totalPlanned;
          headlineLabel = lang === 'ar' ? 'المخطط' : 'Planned'; break;
        case 'cashflow':
          headline = (b.data as CashflowBaselineData).netFlow;
          headlineLabel = lang === 'ar' ? 'صافي التدفق' : 'Net Flow'; break;
        case 'schedule':
          headline = (b.data as ScheduleBaselineData).plannedDurationDays;
          headlineLabel = lang === 'ar' ? 'المدة' : 'Duration'; break;
        case 'forecast':
          headline = (b.data as ForecastBaselineData).eac;
          headlineLabel = 'EAC'; break;
      }
      return {
        id: b.id, type: b.type, typeLabel: labelOf(b.type, lang),
        version: b.version, name: b.name, status: b.status,
        createdAt: b.createdAt, createdBy: b.createdBy, dataDate: b.dataDate,
        cause: b.cause, reason: b.reason, notes: b.notes,
        supersededAt: b.supersededAt, supersededBy: b.supersededBy,
        headline, headlineLabel,
      };
    });
}

/**
 * Movement of one family's headline figure across every version.
 * Drives the "how has the plan drifted?" chart.
 */
export interface DriftRow {
  version: number;
  name: string;
  dataDate: string;
  status: BaselineStatus;
  cause: BaselineCause;
  value: number | null;
  delta: number | null;
}

export function driftOf(store: BaselineStore, type: BaselineType, field: string): DriftRow[] {
  const list = historyOf(store, type);
  let prev: number | null = null;
  return list.map(b => {
    const raw = (b.data as unknown as Record<string, unknown>)[field];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    const delta = value !== null && prev !== null ? value - prev : null;
    if (value !== null) prev = value;
    return { version: b.version, name: b.name, dataDate: b.dataDate, status: b.status, cause: b.cause, value, delta };
  });
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 4 · STEP 3 — THE AUTHORITATIVE BASELINE PACKAGE
//
// Everything below is additive. No function above it changed behaviour,
// no existing record shape moved, and the five-family contract — TYPES,
// baselineCoverage, BaselineRefs and the Timeline snapshot shape — is
// untouched.
//
// The functions here are pure with one deliberate exception: the two that
// persist (`createPackage`, `approvePackage`) go through the same single
// writer every family record already uses, so there is exactly one place
// in the codebase that writes this store.
// ══════════════════════════════════════════════════════════════════════

const PACKAGE_STATUSES: PackageStatus[] = ['draft', 'approved', 'superseded', 'rejected'];

/** Structural repair on read. Never throws on a malformed record. */
function cleanPackage(r: any, i: number): BaselinePackage {
  const version = num(r?.version) || i + 1;
  // Absent on every package filed before rejection-revisions existed.
  // 0 is the correct reading: it was a first attempt.
  const revision = num(r?.revision);
  const status: PackageStatus =
    PACKAGE_STATUSES.includes(r?.status) ? r.status : 'draft';
  const d = r?.data && typeof r.data === 'object' ? r.data : {};
  const direct = num(d.directBudget);
  const indirect = num(d.indirectBudget);
  return {
    id: str(r?.id) || `blp-v${version}-${i}`,
    projectId: str(r?.projectId),
    version,
    revision,
    name: str(r?.name) || `Baseline Package ${packageLabel({ version, revision })}`,
    effectiveDate: str(r?.effectiveDate),
    status,
    approvedAt: str(r?.approvedAt),
    approvedBy: str(r?.approvedBy),
    supersededAt: str(r?.supersededAt),
    supersededById: str(r?.supersededById),
    supersedesId: str(r?.supersedesId),
    createdAt: str(r?.createdAt),
    createdBy: str(r?.createdBy),
    reason: str(r?.reason),
    notes: str(r?.notes),
    data: {
      currency: str(d.currency),
      directBudget: direct,
      indirectBudget: indirect,
      // Recomputed from its own two parts, so a corrupted stored total can
      // never contradict the split it is made of.
      totalBudget: direct + indirect,
      unclassifiedRefs: Array.isArray(d.unclassifiedRefs) ? d.unclassifiedRefs.map(str) : [],
      unclassifiedValue: num(d.unclassifiedValue),
      excludedRefs: Array.isArray(d.excludedRefs) ? d.excludedRefs.map(str) : [],
      budgetLineCount: num(d.budgetLineCount),
      plannedCashIn: num(d.plannedCashIn),
      plannedCashOut: num(d.plannedCashOut),
      cashPeriodCount: num(d.cashPeriodCount),
      evmPlannedDirectCost: num(d.evmPlannedDirectCost),
      includedChangeOrderIds: Array.isArray(d.includedChangeOrderIds)
        ? d.includedChangeOrderIds.map(str) : [],
      includedClaimIds: Array.isArray(d.includedClaimIds)
        ? d.includedClaimIds.map(str) : [],
      // Absent on every package filed before source versioning existed.
      // It stays absent — nothing is back-filled, because there is no
      // honest value to back-fill it with.
      sourceRefs: __cleanRefs(d.sourceRefs),
    },
    schema: num(r?.schema) || PACKAGE_SCHEMA,
  };
}

// ── Queries (pure) ────────────────────────────────────────────────────

/** Every package, oldest first. */
export function packageHistory(store: BaselineStore): BaselinePackage[] {
  return (store.packages || []).slice().sort((a, b) => a.version - b.version);
}

/** The package in force. Null when none has been approved. */
export function currentPackage(store: BaselineStore): BaselinePackage | null {
  const approved = (store.packages || []).filter(p => p.status === 'approved');
  if (approved.length === 0) return null;
  return approved.reduce((a, b) => (b.version > a.version ? b : a));
}

/** The open draft, if one exists. At most one is allowed at a time. */
export function draftPackage(store: BaselineStore): BaselinePackage | null {
  return (store.packages || []).find(p => p.status === 'draft') || null;
}

export function packageById(store: BaselineStore, id: string): BaselinePackage | null {
  return (store.packages || []).find(p => p.id === id) || null;
}

/**
 * The human label for a package. THE ONLY PLACE THIS STRING IS BUILT.
 *
 *     V2            a first attempt
 *     V2 Rev 1      the attempt after V2 was rejected once
 */
export function packageLabel(p: { version: number; revision?: number }): string {
  const rev = num(p?.revision);
  return rev > 0 ? `V${num(p?.version)} Rev ${rev}` : `V${num(p?.version)}`;
}

/**
 * The version number the NEXT package should carry.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A REJECTED VERSION IS RETRIED, NOT SKIPPED.
 *
 * The old rule was "one more than the highest version ever seen,
 * including rejected ones". That burned a number on every rejection and
 * produced histories reading V1, V3, V6 — numbers whose absence nobody
 * could explain.
 *
 * The rule now: a version number is CONSUMED only when a package under
 * it is APPROVED (or has been superseded, which means it was approved
 * once). If the highest number ever used has never been approved, the
 * next attempt reuses it as a new REVISION.
 * ══════════════════════════════════════════════════════════════════════
 */
export function nextPackageVersion(store: BaselineStore): number {
  const list = store.packages || [];
  if (list.length === 0) return 1;
  const highest = list.reduce((m, p) => Math.max(m, num(p.version)), 0);
  // Was anything under the highest number ever actually approved?
  const settled = list.some(p =>
    num(p.version) === highest
    && (p.status === 'approved' || p.status === 'superseded'));
  return settled ? highest + 1 : highest;
}

/**
 * The revision number the next package should carry.
 *
 * 0 when this version has never been attempted. Otherwise one more than
 * the highest revision already recorded under it — so a version rejected
 * three times reaches Rev 3, and every rejected attempt stays on record
 * under its own label.
 */
export function nextPackageRevision(store: BaselineStore, version: number): number {
  const attempts = (store.packages || []).filter(p => num(p.version) === version);
  if (attempts.length === 0) return 0;
  return attempts.reduce((m, p) => Math.max(m, num(p.revision)), 0) + 1;
}

/**
 * Every attempt at one version, oldest first. Rejected ones included —
 * that a plan was refused twice before it was accepted is part of the
 * history, not noise to be tidied away.
 */
export function revisionsOf(store: BaselineStore, version: number): BaselinePackage[] {
  return (store.packages || [])
    .filter(p => num(p.version) === version)
    .slice()
    .sort((a, b) => num(a.revision) - num(b.revision));
}

// ── Capture (pure) ────────────────────────────────────────────────────

/**
 * Builds the package payload from records already in hand.
 *
 * PURE ON PURPOSE. It reads nothing and writes nothing, so the caller
 * decides what "the approved records as of this date" means and this
 * function cannot silently disagree with the screen that showed them.
 *
 * The budget figures are supplied by `deriveBudget()` from costModel —
 * the same derivation the Budget screen displays, so a package can never
 * record a split the user did not see.
 */
export function capturePackage(input: {
  currency: string;
  budget: {
    direct: number; indirect: number;
    unclassifiedRefs?: string[]; unclassified?: number;
    excludedRefs?: string[]; lineCount?: number;
  };
  plannedCashIn?: number;
  plannedCashOut?: number;
  cashPeriodCount?: number;
  evmPlannedDirectCost?: number;
  includedChangeOrderIds?: string[];
  includedClaimIds?: string[];
  /** The approved source versions this payload was built from. */
  sourceRefs?: SourceRefs | null;
}): PackageData {
  const direct = num(input.budget?.direct);
  const indirect = num(input.budget?.indirect);
  return {
    currency: str(input.currency),
    directBudget: direct,
    indirectBudget: indirect,
    totalBudget: direct + indirect,
    unclassifiedRefs: (input.budget?.unclassifiedRefs || []).map(str),
    unclassifiedValue: num(input.budget?.unclassified),
    excludedRefs: (input.budget?.excludedRefs || []).map(str),
    budgetLineCount: num(input.budget?.lineCount),
    plannedCashIn: num(input.plannedCashIn),
    plannedCashOut: num(input.plannedCashOut),
    cashPeriodCount: num(input.cashPeriodCount),
    evmPlannedDirectCost: num(input.evmPlannedDirectCost),
    includedChangeOrderIds: (input.includedChangeOrderIds || []).map(str),
    includedClaimIds: (input.includedClaimIds || []).map(str),
    // Passed through, not resolved here. This function is PURE and
    // reading the version store would make it disagree with the screen
    // that produced the figures it is being handed.
    sourceRefs: input.sourceRefs ?? null,
  };
}

// ── Create · Approve ──────────────────────────────────────────────────

export interface PackageResult {
  store: BaselineStore;
  ok: boolean;
  reason?: 'missing-reason' | 'missing-effective-date' | 'draft-exists'
         | 'not-found' | 'not-a-draft' | 'gate-blocked'
         // SOURCE VERSIONING — the two ways a versioned build is refused.
         | 'sources-not-approved' | 'missing-currency';
  pkg?: BaselinePackage;
  /**
   * Present when `reason === 'gate-blocked'`. The full Step 4 verdict, so
   * a caller can show the exact named reasons rather than a generic
   * refusal — a blocked approval the user cannot diagnose is a dead end.
   */
  gate?: GateVerdictLike;
}

/**
 * The shape of the Step 4 verdict this module passes through.
 *
 * Declared structurally rather than imported so `baselines.ts` does not
 * depend on `baselineGate.ts` at TYPE level — the gate already imports
 * types from here, and a mutual type import is a cycle waiting to be
 * introduced. The runtime call is made through a lazy import below.
 */
export interface GateVerdictLike {
  eligible: boolean;
  reasons: string[];
  reconciliation?: { totalBudget: number; plannedCashOut: number; delta: number };
}

/**
 * Creates a package as a DRAFT. Never approved on creation.
 *
 * Approval is a separate, explicit act because a package is a financial
 * sign-off — and because Step 4's gate has to be able to refuse between
 * the two. Creating and approving in one call would leave no point at
 * which a gate could intervene.
 */
export function createPackage(projectId: string, input: {
  effectiveDate: string;
  createdBy: string;
  reason: string;
  notes?: string;
  data: PackageData;
}): PackageResult {
  const store = readBaselines(projectId);
  if (!input.reason || !input.reason.trim()) {
    return { store, ok: false, reason: 'missing-reason' };
  }
  if (!input.effectiveDate || !input.effectiveDate.trim()) {
    // A baseline with no as-of date cannot say when it applies, which
    // makes every PV question about it unanswerable.
    return { store, ok: false, reason: 'missing-effective-date' };
  }
  if (draftPackage(store)) {
    return { store, ok: false, reason: 'draft-exists' };
  }

  const version = nextPackageVersion(store);
  // Reusing a rejected version means this is its next REVISION.
  const revision = nextPackageRevision(store, version);
  const now = new Date().toISOString();
  const prior = currentPackage(store);

  const pkg: BaselinePackage = {
    id: `blp-v${version}r${revision}-${Date.now()}`,
    projectId,
    version,
    revision,
    name: `Baseline Package ${packageLabel({ version, revision })}`,
    effectiveDate: input.effectiveDate.trim(),
    status: 'draft',
    approvedAt: '',
    approvedBy: '',
    supersededAt: '',
    supersededById: '',
    // Recorded at CREATION, so the lineage survives even if this draft is
    // never approved. "Which plan was this built to replace" is a fact
    // about the attempt, not about its outcome.
    supersedesId: prior ? prior.id : '',
    createdAt: now,
    createdBy: input.createdBy || 'unknown',
    reason: input.reason.trim(),
    notes: (input.notes ?? '').trim(),
    data: input.data,
    schema: PACKAGE_SCHEMA,
  };

  const next: BaselineStore = {
    ...store,
    packages: [...(store.packages || []), pkg],
  };
  writeBaselines(projectId, next);
  return { store: next, ok: true, pkg };
}

/**
 * Approves a draft and retires the package it supersedes.
 *
 * ══════════════════════════════════════════════════════════════════════
 * V1 IS NOT REWRITTEN WHEN V2 ARRIVES.
 *
 * The outgoing package keeps every figure it was approved with. Only its
 * lifecycle fields move — `status`, `supersededAt`, `supersededById` —
 * which is what makes it findable as history rather than mistakable for
 * the current plan. Its `data` object is passed through by reference and
 * never reconstructed.
 *
 * Refused for anything that is not a draft: an approved or superseded
 * package has no transitions back.
 * ══════════════════════════════════════════════════════════════════════
 */
export function approvePackage(
  projectId: string, packageId: string, approvedBy: string,
): PackageResult {
  const store = readBaselines(projectId);
  const list = store.packages || [];
  const i = list.findIndex(p => p.id === packageId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };
  if (list[i].status !== 'draft') return { store, ok: false, reason: 'not-a-draft' };

  /**
   * ════════════════════════════════════════════════════════════════════
   * THE GATE IS MANDATORY. THERE IS NO WAY PAST IT.
   *
   * This function previously took `{ enforceGate }`, defaulting to
   * FALSE. That made the plain, obvious, shortest call —
   * `approvePackage(p, id, who)` — the UNSAFE one, and the safe path an
   * opt-in that a caller had to know to ask for.
   *
   * That is backwards. A financial control either holds for every caller
   * or it is not a control: the next person to add an approval button
   * would have reached for the short form and silently bypassed every
   * rule in Step 4. Backward compatibility is not worth preserving when
   * what it preserves is a bypass.
   *
   * The flag is gone. Not defaulted to true — REMOVED, so there is no
   * argument anyone can pass to switch the gate off, and no second
   * "checked" wrapper to choose between. One function, one path, always
   * gated.
   *
   * NO NEW ARCHITECTURAL DEPENDENCY. Every input the gate needs is
   * already read by this module:
   *   budget lines    captureBudget() / rebuildFromStores() read
   *                   `pactum-budget-{p}` here already
   *   CO/Claim refs   rebuildFromStores() reads both stores here already
   *   currency        carried on the package itself (`data.currency`),
   *                   stamped when it was captured
   * ════════════════════════════════════════════════════════════════════
   */
  const verdict = evaluatePackageGate(projectId, list[i]);
  if (!verdict.eligible) {
    return { store, ok: false, reason: 'gate-blocked', gate: verdict };
  }

  const now = new Date().toISOString();
  const outgoing = currentPackage(store);
  const approved: BaselinePackage = {
    ...list[i],
    status: 'approved',
    approvedAt: now,
    approvedBy: approvedBy || 'unknown',
  };

  const packages = list.map((p, idx) => {
    if (idx === i) return approved;
    if (outgoing && p.id === outgoing.id) {
      return { ...p, status: 'superseded' as PackageStatus,
               supersededAt: now, supersededById: approved.id };
    }
    return p;
  });

  const next: BaselineStore = { ...store, packages };
  writeBaselines(projectId, next);
  return { store: next, ok: true, pkg: approved };
}

/**
 * RETURNS a package to its author for another attempt.
 *
 * ══════════════════════════════════════════════════════════════════════
 * RETURNING IS NOT REJECTING, AND IT DOES NOT CREATE A REVISION.
 *
 *     draft --approve--> approved      committed
 *     draft --reject---> rejected      closed, next attempt is Rev n+1
 *     draft --return---> draft         SAME label, sent back for edits
 *
 * A revision number counts REFUSED attempts. A package handed back with
 * "fix the cash-out line" was not refused, so burning a revision on it
 * would overstate how many times the plan was turned down.
 *
 * The package stays a draft — the same draft — and the return is
 * recorded in its notes so the author can read what to change. Because
 * the status does not move, this is the one review action that leaves
 * the record where it was; everything it changes is the note.
 * ══════════════════════════════════════════════════════════════════════
 */
export function returnPackage(
  projectId: string, packageId: string, by: string, reason = '',
): PackageResult {
  const store = readBaselines(projectId);
  const list = store.packages || [];
  const i = list.findIndex(p => p.id === packageId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };
  // An approved or rejected package is settled; only open work returns.
  if (list[i].status !== 'draft') return { store, ok: false, reason: 'not-a-draft' };

  const why = reason.trim();
  const packages = list.slice();
  packages[i] = {
    ...packages[i],
    notes: [packages[i].notes,
            why && `Returned for revision by ${by || 'unknown'}: ${why}`]
      .filter(Boolean).join(' · '),
  };
  const next: BaselineStore = { ...store, packages };
  writeBaselines(projectId, next);
  return { store: next, ok: true, pkg: packages[i] };
}

/**
 * REJECTS a package. The counterpart to approve — every package can go
 * either way, which is what you asked for.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE RECORD OF THE ATTEMPT SURVIVES, AND THE NUMBER IS NOT BURNED.
 *
 * The rejected package keeps its figures, its author, its dates and its
 * label — V2, or V2 Rev 1 — forever. Only its status moves. It is never
 * deleted, because "we tried this plan and it was refused" is a fact
 * about the project that the next reader needs.
 *
 * What it does NOT do is consume the version number. The next attempt
 * comes back as V2 Rev 1, then V2 Rev 2, and V2 only becomes settled
 * when a package under it is APPROVED. The rejection reason is appended
 * to the notes, so WHY it was refused travels with the record.
 *
 * Refused for anything that is not a draft: an approved package is a
 * historical statement and has no transitions back, and a rejected one
 * is already rejected.
 * ══════════════════════════════════════════════════════════════════════
 */
export function rejectPackage(
  projectId: string, packageId: string, by: string, note = '',
): PackageResult {
  const store = readBaselines(projectId);
  const list = store.packages || [];
  const i = list.findIndex(p => p.id === packageId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };
  if (list[i].status !== 'draft') return { store, ok: false, reason: 'not-a-draft' };

  const packages = list.slice();
  packages[i] = {
    ...packages[i],
    status: 'rejected',
    notes: [packages[i].notes, note && `Rejected by ${by || 'unknown'}: ${note}`]
      .filter(Boolean).join(' · '),
  };
  const next: BaselineStore = { ...store, packages };
  writeBaselines(projectId, next);
  return { store: next, ok: true, pkg: packages[i] };
}

/**
 * Why BAC changed between two packages, traceable to the included items.
 *
 * Answers Part 8's question directly, and does it by DIFFERENCE OF
 * RECORDED SETS rather than by inferring from dates — an item is in a
 * package because that package says so, not because its timestamp falls
 * in a window.
 */
export interface PackageDelta {
  fromVersion: number;
  toVersion: number;
  directDelta: number;
  indirectDelta: number;
  totalDelta: number;
  addedChangeOrderIds: string[];
  addedClaimIds: string[];
  removedChangeOrderIds: string[];
  removedClaimIds: string[];
}

export function packageDelta(from: BaselinePackage, to: BaselinePackage): PackageDelta {
  const diff = (a: string[], b: string[]) => b.filter(x => !a.includes(x));
  return {
    fromVersion: from.version,
    toVersion: to.version,
    directDelta: to.data.directBudget - from.data.directBudget,
    indirectDelta: to.data.indirectBudget - from.data.indirectBudget,
    totalDelta: to.data.totalBudget - from.data.totalBudget,
    addedChangeOrderIds: diff(from.data.includedChangeOrderIds, to.data.includedChangeOrderIds),
    addedClaimIds: diff(from.data.includedClaimIds, to.data.includedClaimIds),
    removedChangeOrderIds: diff(to.data.includedChangeOrderIds, from.data.includedChangeOrderIds),
    removedClaimIds: diff(to.data.includedClaimIds, from.data.includedClaimIds),
  };
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 4 · STEP 9 — AS-OF REBUILD OF A NEW BASELINE VERSION
//
// A new version is a COMPLETE SNAPSHOT rebuilt from the approved records,
// never `previous + delta`. The old `V1 + valueAdded` mechanism in evm.ts
// is not used, not called, and not touched.
//
// The four business decisions this implements, so a later reader does not
// have to reconstruct them:
//
//   Q1=C  A cost assessment may name the budget line that already carries
//         it. LINKED costs are already in the register and are added
//         NOTHING; UNLINKED costs are added on top. Nothing is inferred.
//   Q2=A  Cash flow stays manual. The rebuild snapshots what is there and
//         lets the Step 4 gate block if it does not reconcile.
//   Q3=A  The as-of date filters CO/Claim inclusion via `costApprovedAt` —
//         the only real approval date in the model. Budget and cash flow
//         have no approval date at all, so they are snapshotted as they
//         stand, and the package records that honestly.
//   Q4=C  Items V1 already included are carried forward. Ones that can no
//         longer be assessed are marked `legacy-carried` and contribute
//         nothing financially.
// ══════════════════════════════════════════════════════════════════════

/** Why an item is in this package. Recorded so the audit is explainable. */
export type InclusionBasis =
  | 'newly-approved'    // cost approved on/before the as-of date
  | 'carried-forward'   // was in the previous version, still assessable
  | 'legacy-carried';   // was in the previous version, no cost assessment

export interface IncludedItem {
  ref: string;
  kind: 'change-order' | 'claim';
  basis: InclusionBasis;
  /** Assessed direct cost. 0 for a legacy-carried item — never invented. */
  directImpact: number;
  indirectImpact: number;
  /**
   * The budget line that already carries this cost, '' when unlinked.
   * Q1=C: linked items add nothing, because the register holds the money.
   */
  budgetLineRef: string;
  /** True when this item's cost was ADDED to the register total. */
  additive: boolean;
  costApprovedAt: string;
}

export interface RebuildInput {
  projectId: string;
  effectiveDate: string;
  createdBy: string;
  reason: string;
  notes?: string;
  currency: string;
  /** Live budget register. */
  budgetLines: unknown[];
  changeOrders: unknown[];
  claims: unknown[];
  /** Live cash flow rows. */
  cashRows: { plannedIn?: unknown; plannedOut?: unknown }[];
  /** Existing store, to find the version being superseded. */
  store: BaselineStore;
  /**
   * The approved source versions the four registers above came from.
   * Supplied by the caller so this function stays pure — it does not
   * read the version store and cannot disagree with what was passed.
   * `null` on the legacy path, and the package then says so.
   */
  sourceRefs?: SourceRefs | null;
}

export interface RebuildResult {
  data: PackageData;
  included: IncludedItem[];
  /** Register totals before any additive impact — for the audit trail. */
  registerDirect: number;
  registerIndirect: number;
  /** What the unlinked approved items added on top. */
  additiveDirect: number;
  additiveIndirect: number;
  /** Items excluded, with the reason, so nothing disappears silently. */
  excluded: { ref: string; kind: string; reason: string }[];
  supersedesVersion: number | null;
}

function iso10(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return s ? s.slice(0, 10) : '';
}

/** Eligibility, delegated to the single rule Step 7 established. */
function __eligible(r: unknown): boolean {
  return __isEligible(r as CostBearingRow);
}

/** Reads one row's identity and assessed figures. Invents nothing. */
function __readItem(r: unknown): {
  ref: string; direct: number; indirect: number;
  budgetLineRef: string; approvedAt: string; assessed: boolean;
} {
  const row = r as CostBearingRow;
  const c = __costOf(row);
  const no = (row as unknown as Record<string, unknown>)?.no;
  return {
    ref: typeof no === 'string' && no.trim() ? no : '(unnumbered)',
    direct: c && c.assessed ? c.directImpact : 0,
    indirect: c && c.assessed ? c.indirectImpact : 0,
    budgetLineRef: __refOf(row),
    approvedAt: c?.costApprovedAt ?? '',
    assessed: !!(c && c.assessed),
  };
}

/**
 * Rebuilds the next version's payload from the records as they stand.
 *
 * PURE. It reads what it is handed and returns a payload; it does not
 * persist, and it does not touch the previous version. Determinism: no
 * clock, no randomness, and the output depends only on the inputs and the
 * as-of date — the same inputs always produce the same financial result.
 */
export function rebuildPackage(input: RebuildInput): RebuildResult {
  const asOf = iso10(input.effectiveDate);
  const prev = currentPackage(input.store);
  const prevCos = new Set(prev?.data?.includedChangeOrderIds || []);
  const prevClaims = new Set(prev?.data?.includedClaimIds || []);

  const included: IncludedItem[] = [];
  const excluded: { ref: string; kind: string; reason: string }[] = [];

  const consider = (
    rows: unknown[], kind: IncludedItem['kind'], carried: Set<string>,
    eligible: (r: unknown) => boolean,
    read: (r: unknown) => {
      ref: string; direct: number; indirect: number;
      budgetLineRef: string; approvedAt: string; assessed: boolean;
    },
  ) => {
    (Array.isArray(rows) ? rows : []).forEach(r => {
      if (!r || typeof r !== 'object') return;
      const info = read(r);
      const wasIncluded = carried.has(info.ref);
      const ok = eligible(r);

      if (ok) {
        // Q3=A — the as-of date gates inclusion on the real approval date.
        // An item approved AFTER the date belongs to a later version, not
        // this one; that is what makes the snapshot reproducible.
        const approvedOn = iso10(info.approvedAt);
        if (asOf && approvedOn && approvedOn > asOf) {
          if (wasIncluded) {
            // It was already in the previous version. Carry it, because
            // dropping it would make this version claim the item was
            // never baselined.
            included.push({
              ref: info.ref, kind, basis: 'carried-forward',
              directImpact: info.direct, indirectImpact: info.indirect,
              budgetLineRef: info.budgetLineRef,
              additive: false,          // already counted by the prior version
              costApprovedAt: approvedOn,
            });
          } else {
            excluded.push({ ref: info.ref, kind,
              reason: `cost approved ${approvedOn}, after the as-of date ${asOf}` });
          }
          return;
        }
        included.push({
          ref: info.ref, kind,
          basis: wasIncluded ? 'carried-forward' : 'newly-approved',
          directImpact: info.direct, indirectImpact: info.indirect,
          budgetLineRef: info.budgetLineRef,
          // Q1=C — only an UNLINKED, newly approved item adds money. A
          // linked one is already in the register; a carried-forward one
          // was already counted when its own version was approved.
          additive: !info.budgetLineRef && !wasIncluded,
          costApprovedAt: approvedOn,
        });
        return;
      }

      // Not eligible today.
      if (wasIncluded) {
        // Q4=C — carry it forward, flagged, with NO financial impact. Its
        // inclusion is a historical fact about the previous version.
        included.push({
          ref: info.ref, kind,
          basis: info.assessed ? 'carried-forward' : 'legacy-carried',
          directImpact: info.assessed ? info.direct : 0,
          indirectImpact: info.assessed ? info.indirect : 0,
          budgetLineRef: info.budgetLineRef,
          additive: false,
          costApprovedAt: iso10(info.approvedAt),
        });
      } else {
        excluded.push({ ref: info.ref, kind, reason: 'not financially approved' });
      }
    });
  };

  consider(input.changeOrders, 'change-order', prevCos, __eligible, __readItem);
  consider(input.claims, 'claim', prevClaims, __eligible, __readItem);

  // ── Budget: the register as it stands (Q3=A) ─────────────────────────
  // Budget lines carry no approval date and no validity window, so an
  // "as-of" rebuild of them is not possible. This is the register at
  // capture time, and the package says so rather than implying otherwise.
  const b = __deriveBudgetRaw(input.budgetLines as BudgetLineLike[], input.currency, 'planned');
  const reg = {
    direct: b.direct, indirect: b.indirect,
    unclassified: b.unclassified,
    unclassifiedRefs: b.unclassifiedRefs,
    excludedRefs: b.excludedRefs,
    lineCount: Array.isArray(input.budgetLines) ? input.budgetLines.length : 0,
  };

  // ── Q1=C: add only what the register does not already carry ──────────
  const additiveDirect = included
    .filter(i => i.additive).reduce((a, i) => a + i.directImpact, 0);
  const additiveIndirect = included
    .filter(i => i.additive).reduce((a, i) => a + i.indirectImpact, 0);

  const direct = reg.direct + additiveDirect;
  const indirect = reg.indirect + additiveIndirect;

  // ── Q2=A: cash flow snapshotted as entered. Never derived, never ─────
  //     adjusted to make the gate pass.
  const plannedCashIn = (Array.isArray(input.cashRows) ? input.cashRows : [])
    .reduce((a, r) => a + num((r as unknown as Record<string, unknown>)?.plannedIn), 0);
  const plannedCashOut = (Array.isArray(input.cashRows) ? input.cashRows : [])
    .reduce((a, r) => a + num((r as unknown as Record<string, unknown>)?.plannedOut), 0);

  const data: PackageData = {
    currency: str(input.currency),
    directBudget: direct,
    indirectBudget: indirect,
    totalBudget: direct + indirect,
    unclassifiedRefs: reg.unclassifiedRefs,
    unclassifiedValue: reg.unclassified,
    excludedRefs: reg.excludedRefs,
    budgetLineCount: reg.lineCount,
    plannedCashIn,
    plannedCashOut,
    cashPeriodCount: Array.isArray(input.cashRows) ? input.cashRows.length : 0,
    // EVM is direct-cost only. Unchanged rule from Step 4's gate.
    evmPlannedDirectCost: direct,
    includedChangeOrderIds: included.filter(i => i.kind === 'change-order').map(i => i.ref),
    includedClaimIds: included.filter(i => i.kind === 'claim').map(i => i.ref),
    // Bound at BUILD time and frozen. Resolving this on read would let
    // an approved baseline drift onto a newer source version, which is
    // the exact failure the immutability rule exists to prevent.
    sourceRefs: input.sourceRefs ?? null,
  };

  return {
    data, included,
    registerDirect: reg.direct, registerIndirect: reg.indirect,
    additiveDirect, additiveIndirect,
    excluded,
    supersedesVersion: prev ? prev.version : null,
  };
}

/**
 * Rebuilds and FILES the next version as a DRAFT.
 *
 * ══════════════════════════════════════════════════════════════════════
 * CREATING IS NOT APPROVING.
 *
 * The new version lands as a draft, so PV keeps using the current
 * approved baseline until a person puts the draft through the gate and
 * approves it. That separation is the entire reason a "baseline update
 * required" state exists rather than an automatic re-baseline.
 *
 * The previous version is not read for its figures, not copied and not
 * touched. It is consulted for exactly one thing: which items it already
 * included, so Q4=C can carry them forward.
 * ══════════════════════════════════════════════════════════════════════
 */
export function createNextPackageFromProject(input: {
  projectId: string;
  effectiveDate: string;
  createdBy: string;
  reason: string;
  notes?: string;
  currency: string;
  budgetLines: unknown[];
  changeOrders: unknown[];
  claims: unknown[];
  cashRows: { plannedIn?: unknown; plannedOut?: unknown }[];
}): PackageResult & { rebuild?: RebuildResult } {
  const store = readBaselines(input.projectId);
  const rebuild = rebuildPackage({ ...input, store });
  const res = createPackage(input.projectId, {
    effectiveDate: input.effectiveDate,
    createdBy: input.createdBy,
    reason: input.reason,
    notes: input.notes,
    data: rebuild.data,
  });
  return { ...res, rebuild };
}

/** Reads the project's live records and rebuilds. Convenience only. */
export function rebuildFromStores(
  projectId: string, currency: string, effectiveDate: string,
): RebuildResult {
  const read = (key: string): unknown[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  };
  return rebuildPackage({
    projectId, effectiveDate, createdBy: '', reason: '', currency,
    budgetLines: read(`pactum-budget-${projectId}`),
    changeOrders: read(`pactum-co-${projectId}`),
    claims: read(`pactum-claims-${projectId}`),
    cashRows: read(`pactum-cashflow-${projectId}`) as { plannedIn?: unknown; plannedOut?: unknown }[],
    store: readBaselines(projectId),
  });
}

// ══════════════════════════════════════════════════════════════════════
// SOURCE-VERSIONED BUILD — THE ONLY PATH FOR A VERSIONED PROJECT
// ══════════════════════════════════════════════════════════════════════

export type SourceBuildRefusal =
  | 'sources-not-approved'
  | 'missing-currency';

export interface SourceBuildBlocked {
  ok: false;
  reason: SourceBuildRefusal;
  /** Sources with no approved version, named. Never counted silently. */
  missing: SourceKind[];
  /** Approved, but the live register has moved on since. Not a blocker. */
  stale: SourceKind[];
}

export interface SourceBuildReady {
  ok: true;
  refs: SourceRefs;
  stale: SourceKind[];
  budgetLines: unknown[];
  changeOrders: unknown[];
  claims: unknown[];
  cashRows: { plannedIn?: unknown; plannedOut?: unknown }[];
  evmSnapshot: unknown;
}

/**
 * Gathers the five APPROVED source snapshots for a project.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A BASELINE IS NOT BUILT FROM LIVE RECORDS, AND NOT FROM DRAFTS.
 *
 * This reads nothing but approved versions. If a source has none, the
 * build is REFUSED and the missing sources are named — not substituted
 * from the live register, not taken from the latest draft, not zeroed.
 * A package assembled from four approved sources and one guess is not a
 * baseline, it is four facts and a fiction.
 *
 * `stale` reports sources whose live register has moved past the
 * approved version. It is INFORMATION, not a refusal: continuing to
 * build from the approved snapshot is the correct behaviour, and the
 * user is told a newer capture is available so the choice is theirs.
 * ══════════════════════════════════════════════════════════════════════
 */
export function gatherApprovedSources(projectId: string): SourceBuildBlocked | SourceBuildReady {
  const readiness = __refsReadiness(projectId);
  if (!readiness.ready) {
    return { ok: false, reason: 'sources-not-approved',
             missing: readiness.missing, stale: readiness.stale };
  }
  return {
    ok: true,
    refs: readiness.refs,
    stale: readiness.stale,
    budgetLines: __approvedRows(projectId, 'budget'),
    changeOrders: __approvedRows(projectId, 'change-orders'),
    claims: __approvedRows(projectId, 'claims'),
    cashRows: __approvedRows(projectId, 'cashflow') as { plannedIn?: unknown; plannedOut?: unknown }[],
    evmSnapshot: __approvedSnapshot(projectId, 'evm-planned'),
  };
}

/**
 * Rebuilds the next package FROM APPROVED SOURCE VERSIONS.
 *
 * The versioned twin of `rebuildFromStores`. Same rebuild logic, same
 * Q1=C additivity, same Q3=A as-of filtering — the ONLY difference is
 * where the four registers come from, and that difference is the whole
 * point.
 */
export function rebuildFromApprovedSources(
  projectId: string, currency: string, effectiveDate: string,
): { ok: false; blocked: SourceBuildBlocked } | { ok: true; rebuild: RebuildResult; stale: SourceKind[] } {
  const src = gatherApprovedSources(projectId);
  if (!src.ok) return { ok: false, blocked: src };
  return {
    ok: true,
    stale: src.stale,
    rebuild: rebuildPackage({
      projectId, effectiveDate, createdBy: '', reason: '', currency,
      budgetLines: src.budgetLines,
      changeOrders: src.changeOrders,
      claims: src.claims,
      cashRows: src.cashRows,
      store: readBaselines(projectId),
      sourceRefs: src.refs,
    }),
  };
}

export interface VersionedPackageResult extends PackageResult {
  rebuild?: RebuildResult;
  blocked?: SourceBuildBlocked;
  stale?: SourceKind[];
}

/**
 * Creates the next Baseline Package DRAFT from approved source versions.
 *
 * Refuses outright when any of the five has no approved version. The
 * refusal carries the names, so the screen can say "Cash Flow and EVM
 * Planned have no approved version" instead of a generic block.
 */
export function createPackageFromApprovedSources(input: {
  projectId: string;
  effectiveDate: string;
  createdBy: string;
  reason: string;
  notes?: string;
  currency: string;
}): VersionedPackageResult {
  const store = readBaselines(input.projectId);
  if (!input.currency) {
    return { store, ok: false, reason: 'missing-currency' as any };
  }
  const built = rebuildFromApprovedSources(
    input.projectId, input.currency, input.effectiveDate);
  if (!built.ok) {
    return { store, ok: false, reason: 'sources-not-approved' as any,
             blocked: built.blocked };
  }
  const res = createPackage(input.projectId, {
    effectiveDate: input.effectiveDate,
    createdBy: input.createdBy,
    reason: input.reason,
    notes: input.notes,
    data: built.rebuild.data,
  });
  return { ...res, rebuild: built.rebuild, stale: built.stale };
}

/**
 * Whether a project is on the versioned path at all.
 *
 * MIGRATION, STATED PLAINLY. A project that has never captured a version
 * keeps working exactly as it did — the gate reads its live registers and
 * nothing about its history changes. The moment it captures its first
 * version, it moves onto the approved-source path. Nothing is retro-fitted
 * and no approval, date or user is invented for the records it already had.
 */
export function isVersionedProject(projectId: string): boolean {
  return __hasAnyVersions(projectId);
}

/**
 * The five approved source versions as they stand right now.
 *
 * Re-exported here so a caller building a package never has to reach
 * into two modules to ask one question. It resolves LIVE and is
 * therefore only ever used at BUILD time — a filed package reads its own
 * frozen `data.sourceRefs`, never this.
 */
export function currentApprovedSourceRefs(projectId: string): SourceRefs {
  return __approvedRefs(projectId);
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 4 · STEP 10 — GATE-ENFORCED APPROVAL AND ACTIVATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Runs the authoritative Step 4 gate against a package.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE GATE LOGIC IS NOT DUPLICATED. This reads the three registers this
 * module already reads elsewhere, hands them to `evaluateBaselineGate`,
 * and returns its verdict verbatim. If the rules change, they change in
 * one place.
 *
 * No import cycle: `baselineGate.ts` imports from here with `import
 * type`, which is erased at build time, so the runtime graph has a
 * single edge — this file to the gate.
 * ══════════════════════════════════════════════════════════════════════
 */
export function evaluatePackageGate(
  projectId: string, pkg: BaselinePackage,
): GateVerdictLike {
  const read = (key: string): any[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  };

  /**
   * ════════════════════════════════════════════════════════════════════
   * DECISION ⑴=A — THE GATE MEASURES THE PACKAGE AGAINST THE SOURCE
   * VERSIONS IT WAS BUILT FROM, NOT AGAINST THE LIVE REGISTERS.
   *
   * This is the one place source versioning genuinely CHANGED an
   * approved rule, and it was changed deliberately rather than worked
   * around. Step 4 wrote the gate when the live register was the only
   * thing a package could have come from, so reading it was the same as
   * reading the source. That stopped being true the moment a package
   * could be bound to Budget V3 while the register moved on to V4 work.
   *
   * Left as it was, every approval would have failed the instant a
   * budget line was edited between capture and signature — the package
   * would be judged against a register it was never made from, and the
   * user would be told their baseline "drifted" when nothing about it
   * had moved. The reconciliation figures would be arithmetic between
   * two different plans.
   *
   * So: when the project is on the versioned path AND the package
   * carries `sourceRefs`, the gate reads the APPROVED SNAPSHOTS. The
   * rules themselves — all eight — are untouched. Only the inputs are
   * now the ones the package was actually assembled from.
   *
   * A pre-versioning package keeps the original behaviour exactly. It
   * has no `sourceRefs` and there is nothing else it could honestly be
   * measured against; its approval path is bit-for-bit what it was.
   * ════════════════════════════════════════════════════════════════════
   */
  const refs = pkg?.data?.sourceRefs || null;
  const versioned = !!refs && (
    !!refs.budget || !!refs.cashflow || !!refs.claims || !!refs.changeOrders
  );

  const budgetLines = versioned && refs?.budget
    ? __approvedRows(projectId, 'budget')
    : read(`pactum-budget-${projectId}`);
  const cos = versioned && refs?.changeOrders
    ? __approvedRows(projectId, 'change-orders')
    : read(`pactum-co-${projectId}`);
  const claims = versioned && refs?.claims
    ? __approvedRows(projectId, 'claims')
    : read(`pactum-claims-${projectId}`);

  return __evaluateGate({
    pkg,
    budgetLines,
    // The unit is carried on the package itself, stamped when it was
    // captured. Reading it from anywhere else could judge a package
    // against a currency it was never denominated in.
    currency: pkg?.data?.currency || '',
    changeOrderRefs: (cos as any[]).map(r => str(r?.no)).filter(Boolean),
    claimRefs: (claims as any[]).map(r => str(r?.no)).filter(Boolean),
  }) as GateVerdictLike;
}

export interface ActivationResult extends PackageResult {
  /** The version retired by this activation. null when this is the first. */
  supersededVersion?: number | null;
  /** The version now in force. */
  currentVersion?: number | null;
}

/**
 * The complete Step 10 lifecycle: validate → approve → activate.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ATOMIC BY CONSTRUCTION.
 *
 * `approvePackage` builds the ENTIRE next store in memory — the newly
 * approved package and the retired one together — and commits it with a
 * SINGLE `localStorage.setItem`. There is no window in which two
 * packages are approved, and none in which zero are: the write either
 * lands whole or does not land at all.
 *
 * That is why no transaction workaround was needed and none was
 * invented. The guarantee comes from the storage shape, not from
 * defensive code.
 *
 * CREATED ≠ APPROVED ≠ CURRENT is preserved: a draft that fails the gate
 * stays a draft, the previous version stays current, and the caller gets
 * the named reasons back.
 * ══════════════════════════════════════════════════════════════════════
 */
export function approveAndActivate(
  projectId: string, packageId: string, approvedBy: string,
): ActivationResult {
  const before = readBaselines(projectId);
  const outgoing = currentPackage(before);

  // No flag to pass: approvePackage is gated unconditionally.
  const res = approvePackage(projectId, packageId, approvedBy);
  if (!res.ok) {
    // Nothing was written. The previous version is untouched and still
    // current — verified by returning the store as it was read.
    return { ...res, supersededVersion: outgoing?.version ?? null,
             currentVersion: outgoing?.version ?? null };
  }

  const after = readBaselines(projectId);
  return {
    ...res,
    store: after,
    supersededVersion: outgoing?.version ?? null,
    currentVersion: (currentPackage(after) || {}).version ?? null,
  };
}

/**
 * Every package that claims to be in force. Should never exceed one.
 *
 * Exists so the invariant can be ASSERTED rather than assumed — a
 * guarantee nobody can check is a guarantee nobody should trust.
 */
export function approvedPackages(store: BaselineStore): BaselinePackage[] {
  return (store.packages || []).filter(p => p.status === 'approved');
}
