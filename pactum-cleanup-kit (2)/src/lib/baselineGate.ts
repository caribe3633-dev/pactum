/**
 * Baseline Approval Gate.
 * Destination: src/lib/baselineGate.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 *
 *   A pure validation layer that answers exactly one question:
 *
 *       is this Baseline Package eligible to be approved?
 *
 *   It returns a verdict and a list of named reasons. It never writes.
 *   Not to the budget, not to the cash flow, not to a change order, not
 *   to the package it is judging, and above all not to an approved
 *   baseline. Every function here takes data in and returns a verdict —
 *   there is no code path that can call localStorage.setItem, because
 *   this module never imports a writer.
 *
 * WHY VALIDATION AND MUTATION MUST BE SEPARATE
 *
 *   The tempting shortcut is a gate that "fixes" what it finds: nudge the
 *   cash flow to match the budget, default a missing figure to zero,
 *   classify the leftover lines. Every one of those turns a refusal into
 *   a silent edit of financial data, and the user is then approving a
 *   plan that the software wrote rather than the one they entered.
 *
 *   So the gate is deliberately powerless. It can only say no, and say
 *   why. Correcting the data is the user's act, in the module that owns
 *   it, and the gate is re-run afterwards.
 *
 * DETERMINISM
 *
 *   Same inputs, same verdict, same reasons, in the same order. Nothing
 *   here reads the clock or a random source. The reasons are ordered by
 *   gate number so a caller can render them stably and a test can assert
 *   on them.
 * ══════════════════════════════════════════════════════════════════════
 */

import type { BaselinePackage, BaselineStore } from './baselines';
import { deriveBudget, classificationStatus, type BudgetLineLike } from './costModel';

/**
 * The reconciliation tolerance, in project-currency units.
 *
 * Budget and cash-flow figures are floats that have been through FX
 * conversion, so exact equality would fail on rounding dust that means
 * nothing financially. Half a unit is below the smallest amount anyone
 * transacts in and well above accumulated float error.
 *
 * NOTE THE DISTINCTION the approved rules draw: a tolerance is not
 * silent rounding. Nothing is ever adjusted to fit inside it — the delta
 * is reported at full precision whether it passes or fails.
 */
export const RECONCILIATION_TOLERANCE = 0.5;

/** Stable identifiers, so a caller can key off the failure not the prose. */
export type GateCode =
  | 'budget-unclassified'
  | 'budget-empty'
  | 'budget-excluded-currency'
  | 'cash-out-mismatch'
  | 'cash-in-missing'
  | 'evm-planned-missing'
  | 'reference-missing'
  | 'package-incomplete';

export interface GateReason {
  /** 1..7, matching the approved gate numbering. */
  gate: number;
  code: GateCode;
  en: string;
  ar: string;
  /** Figures behind the reason, for display and audit. Never prose. */
  detail?: Record<string, unknown>;
}

export interface GateVerdict {
  eligible: boolean;
  /** English prose, ordered by gate. The shape the brief asked for. */
  reasons: string[];
  /** The same failures, structured — for UI, tests and audit. */
  failures: GateReason[];
  /**
   * The reconciliation figures, present whether it passed or failed.
   * A tolerance that hides the delta when it passes is not auditable.
   */
  reconciliation: {
    totalBudget: number;
    plannedCashOut: number;
    delta: number;
    tolerance: number;
    withinTolerance: boolean;
  };
  /** Derived budget position, so a caller need not recompute it. */
  budget: {
    direct: number;
    indirect: number;
    total: number;
    unclassifiedCount: number;
    unclassifiedRefs: string[];
  };
  currency: string;
}

/** Everything the gate needs. Supplied by the caller; never fetched here. */
export interface GateInput {
  pkg: BaselinePackage;
  /** The live budget register the package was captured from. */
  budgetLines: BudgetLineLike[];
  /** Project contract currency — the unit every figure must share. */
  currency: string;
  /** Reference numbers that exist in the CO register (`row.no`). */
  changeOrderRefs: string[];
  /** Reference numbers that exist in the claims register (`row.no`). */
  claimRefs: string[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Grouped money for a human-readable reason. Never used for arithmetic. */
function money(n: number, ccy: string): string {
  const s = Math.abs(n) < 1000
    ? String(Math.round(n * 100) / 100)
    : Math.round(n).toLocaleString('en-US');
  return ccy ? `${ccy} ${s}` : s;
}

/**
 * Evaluates every gate and returns one deterministic verdict.
 *
 * ALL gates are evaluated — it does not stop at the first failure. A user
 * fixing one problem only to be shown the next one on re-submission is
 * being drip-fed; the whole list is what lets them fix it in one pass.
 */
export function evaluateBaselineGate(input: GateInput): GateVerdict {
  const { pkg, budgetLines, currency } = input;
  const failures: GateReason[] = [];

  // The gate judges against the LIVE register, deriving it exactly as the
  // Budget screen does. A package whose stored figures disagree with the
  // register it claims to describe must not slip through on its own
  // stored numbers.
  const derived = deriveBudget(budgetLines, currency, 'planned');
  const status = classificationStatus(budgetLines, currency);

  // ── GATE 1 · classification ─────────────────────────────────────────
  if (status.lineCount === 0) {
    failures.push({
      gate: 1, code: 'budget-empty',
      en: 'Budget register is empty — there is no cost plan to baseline.',
      ar: 'سجل الموازنة فارغ — لا توجد خطة تكلفة لاعتمادها كخط أساس.',
    });
  }
  if (derived.counts.unclassified > 0) {
    failures.push({
      gate: 1, code: 'budget-unclassified',
      en: 'Budget contains unclassified lines',
      ar: 'الموازنة تحتوي على بنود غير مصنَّفة',
      detail: {
        count: derived.counts.unclassified,
        refs: derived.unclassifiedRefs,
        value: derived.unclassified,
      },
    });
  }
  // An off-unit line is not unclassified, but it is excluded from the
  // totals — so the package would be baselining a partial budget while
  // looking complete. Distinct code, distinct reason.
  if (derived.counts.excluded > 0) {
    failures.push({
      gate: 1, code: 'budget-excluded-currency',
      en: 'Budget contains lines stored in another currency, excluded from the totals',
      ar: 'الموازنة تحتوي على بنود مخزَّنة بعملة أخرى ومستبعدة من الإجماليات',
      detail: { count: derived.counts.excluded, refs: derived.excludedRefs },
    });
  }

  // ── GATE 2 · the derived total is authoritative ─────────────────────
  // Not a user-facing failure in normal use: the package is captured FROM
  // this derivation. It fires when a stored package has drifted from the
  // register — a stored aggregate silently overriding the lines is
  // precisely what the model forbids, so it is caught rather than trusted.
  /**
   * ══════════════════════════════════════════════════════════════════
   * STEP 9 · THE AUTHORITATIVE TOTAL IS REGISTER + APPROVED ADDITIONS.
   *
   * Gate 2 was written when a package could only ever restate the budget
   * register. Q1=C changed that: an approved, UNLINKED cost is genuinely
   * outside the register and the rebuild adds it on top.
   *
   * Measuring against the raw register alone produced two failures at
   * once — Gate 2 called the legitimate addition "drift", and Gate 3
   * compared cash out against a budget 9.5M smaller than the package's
   * own, so a package that did NOT reconcile passed with delta 0.
   *
   * The package's own direct/indirect figures are therefore taken as the
   * total, and the register is used to check the IDENTITY (total =
   * direct + indirect) and to catch a package that has drifted BELOW the
   * register — money removed from the plan that the register still
   * carries.
   * ══════════════════════════════════════════════════════════════════
   */
  const storedTotal = num(pkg?.data?.totalBudget);
  const storedDirect = num(pkg?.data?.directBudget);
  const storedIndirect = num(pkg?.data?.indirectBudget);
  const totalBudget = storedTotal;
  const identityBroken =
    Math.abs(storedTotal - (storedDirect + storedIndirect)) > RECONCILIATION_TOLERANCE;
  // A package may exceed the register (approved additions) but never fall
  // short of it — that would mean baselining less than the cost plan.
  const driftedFromRegister =
    storedDirect + RECONCILIATION_TOLERANCE < derived.direct
    || storedIndirect + RECONCILIATION_TOLERANCE < derived.indirect;

  if (identityBroken || driftedFromRegister) {
    failures.push({
      gate: 2, code: 'package-incomplete',
      en: identityBroken
        ? 'Package budget total does not equal Direct + Indirect'
        : 'Package budget is below the Budget Lines in the register',
      ar: identityBroken
        ? 'إجمالي موازنة الحزمة لا يساوي المباشرة + غير المباشرة'
        : 'موازنة الحزمة أقل من بنود الموازنة في السجل',
      detail: {
        storedDirect, storedIndirect, storedTotal,
        derivedDirect: derived.direct, derivedIndirect: derived.indirect,
        derivedTotal: totalBudget,
      },
    });
  }

  // ── GATE 3 · cash-out reconciliation ────────────────────────────────
  // Measured against the DERIVED total, which is the authoritative one.
  const plannedCashOut = num(pkg?.data?.plannedCashOut);
  const delta = totalBudget - plannedCashOut;
  const withinTolerance = Math.abs(delta) <= RECONCILIATION_TOLERANCE;
  if (!withinTolerance) {
    failures.push({
      gate: 3, code: 'cash-out-mismatch',
      en: 'Cash Out does not reconcile with Budget',
      ar: 'التدفق النقدي الخارج لا يطابق الموازنة',
      detail: {
        totalBudget, plannedCashOut, delta,
        tolerance: RECONCILIATION_TOLERANCE,
        display: `${money(totalBudget, currency)} − ${money(plannedCashOut, currency)} = ${money(delta, currency)}`,
      },
    });
  }

  // ── GATE 4 · planned cash in ────────────────────────────────────────
  // Required to be PRESENT and positive. It is never derived from the
  // contract amount: no such rule exists in PACTUM, and inventing the
  // link would make the funding plan a restatement of the revenue plan.
  const plannedCashIn = num(pkg?.data?.plannedCashIn);
  if (plannedCashIn <= 0) {
    failures.push({
      gate: 4, code: 'cash-in-missing',
      en: 'Approved Planned Cash In is missing',
      ar: 'التدفق النقدي الداخل المخطط المعتمد غير موجود',
      detail: { plannedCashIn },
    });
  }

  // ── GATE 5 · EVM planned cost, direct only ──────────────────────────
  const evmPlanned = num(pkg?.data?.evmPlannedDirectCost);
  if (evmPlanned <= 0) {
    failures.push({
      gate: 5, code: 'evm-planned-missing',
      en: 'Approved EVM Planned Cost is missing',
      ar: 'التكلفة المخططة المعتمدة لإدارة القيمة المكتسبة غير موجودة',
      detail: { evmPlannedDirectCost: evmPlanned },
    });
  } else if (Math.abs(evmPlanned - storedDirect) > RECONCILIATION_TOLERANCE) {
    // EVM is direct-cost only. Compared against the PACKAGE'S direct
    // budget, not the raw register: after Q1=C the package legitimately
    // includes approved additions the register does not carry, and EVM
    // must plan against the same figure BAC will use.
    failures.push({
      gate: 5, code: 'evm-planned-missing',
      en: 'EVM Planned Cost does not equal the Direct Budget (EVM is direct-cost only)',
      ar: 'التكلفة المخططة لإدارة القيمة المكتسبة لا تساوي الموازنة المباشرة (القيمة المكتسبة تكلفة مباشرة فقط)',
      detail: {
        evmPlannedDirectCost: evmPlanned,
        directBudget: storedDirect,
        registerDirect: derived.direct,
        delta: evmPlanned - storedDirect,
      },
    });
  }

  // ── GATE 6 · referenced COs and Claims must exist ───────────────────
  // Existence only. No cost is read, assessed or invented — that
  // workflow does not exist yet and this gate does not pre-empt it.
  const coRefs = pkg?.data?.includedChangeOrderIds || [];
  const clRefs = pkg?.data?.includedClaimIds || [];
  const missingCos = coRefs.filter(r => !input.changeOrderRefs.includes(r));
  const missingClaims = clRefs.filter(r => !input.claimRefs.includes(r));
  if (missingCos.length > 0 || missingClaims.length > 0) {
    failures.push({
      gate: 6, code: 'reference-missing',
      en: 'Baseline references a missing Change Order/Claim',
      ar: 'خط الأساس يشير إلى أمر تغيير أو مطالبة غير موجودة',
      detail: { missingChangeOrders: missingCos, missingClaims },
    });
  }

  // ── GATE 7 · package integrity ──────────────────────────────────────
  const missingFields: string[] = [];
  if (!pkg?.projectId) missingFields.push('projectId');
  if (!num(pkg?.version)) missingFields.push('version');
  if (!pkg?.effectiveDate) missingFields.push('effectiveDate');
  if (!pkg?.data) missingFields.push('data');
  if (pkg?.data && !pkg.data.currency) missingFields.push('data.currency');
  if (missingFields.length > 0) {
    failures.push({
      gate: 7, code: 'package-incomplete',
      en: `Baseline package is incomplete: ${missingFields.join(', ')}`,
      ar: `حزمة خط الأساس غير مكتملة: ${missingFields.join(', ')}`,
      detail: { missingFields },
    });
  }
  // A package denominated in one unit cannot be judged against a register
  // in another; the comparison would be meaningless rather than merely wrong.
  if (pkg?.data?.currency && currency && pkg.data.currency !== currency) {
    failures.push({
      gate: 7, code: 'package-incomplete',
      en: `Package currency ${pkg.data.currency} does not match the project currency ${currency}`,
      ar: `عملة الحزمة ${pkg.data.currency} لا تطابق عملة المشروع ${currency}`,
      detail: { packageCurrency: pkg.data.currency, projectCurrency: currency },
    });
  }

  failures.sort((a, b) => a.gate - b.gate);

  return {
    eligible: failures.length === 0,
    reasons: failures.map(f => f.en),
    failures,
    reconciliation: {
      totalBudget, plannedCashOut, delta,
      tolerance: RECONCILIATION_TOLERANCE, withinTolerance,
    },
    budget: {
      direct: derived.direct,
      indirect: derived.indirect,
      total: derived.total,
      unclassifiedCount: derived.counts.unclassified,
      unclassifiedRefs: derived.unclassifiedRefs,
    },
    currency,
  };
}

/**
 * GATE 8 — historical integrity, as an assertion rather than a promise.
 *
 * ══════════════════════════════════════════════════════════════════════
 * The gate cannot modify an approved package: it has no writer. But
 * "cannot" is a claim about code that a reader has to take on trust, and
 * an approval flow around it might not be so careful.
 *
 * This function makes it checkable. Take a fingerprint of every
 * non-draft package before an approval, take another after, and compare.
 * Any drift is named with the version that changed. A test asserts it;
 * an approval flow can assert it too.
 * ══════════════════════════════════════════════════════════════════════
 */
export interface HistoryFingerprint {
  [packageId: string]: string;
}

export function fingerprintHistory(store: BaselineStore): HistoryFingerprint {
  const out: HistoryFingerprint = {};
  (store.packages || [])
    .filter(p => p.status !== 'draft')
    .forEach(p => {
      // The DATA and the identity of an approved package are immutable.
      // Lifecycle fields (status/supersededAt/supersededById) are excluded
      // because retiring V1 when V2 arrives is a legitimate transition.
      out[p.id] = JSON.stringify({
        version: p.version,
        effectiveDate: p.effectiveDate,
        approvedAt: p.approvedAt,
        approvedBy: p.approvedBy,
        data: p.data,
      });
    });
  return out;
}

export function historyUnchanged(
  before: HistoryFingerprint, after: HistoryFingerprint,
): { ok: boolean; changed: string[]; removed: string[] } {
  const changed = Object.keys(before).filter(
    id => after[id] !== undefined && after[id] !== before[id]);
  const removed = Object.keys(before).filter(id => after[id] === undefined);
  return { ok: changed.length === 0 && removed.length === 0, changed, removed };
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 4 · STEP 8 — BASELINE UPDATE REQUIRED
//
// A governance signal, not an action. Everything below is a pure
// derivation: it reads records and returns a verdict. It changes no
// baseline, no BAC, no PV and no register — which is the entire point.
// The current baseline stays authoritative until a person approves a new
// version, and this code exists to make that fact visible rather than to
// work around it.
// ══════════════════════════════════════════════════════════════════════

import {
  isBaselineEligible, costState, type CostBearingRow,
} from './changeCost';

/** One item that is financially approved but outside the current baseline. */
export interface UpdateTrigger {
  /** Reference number as it appears in the register (`row.no`). */
  ref: string;
  kind: 'change-order' | 'claim';
  /** Approved direct cost — what WOULD move BAC once baselined. */
  directImpact: number;
  /** Approved indirect cost — budget only, never BAC. */
  indirectImpact: number;
  totalImpact: number;
  /** When the cost was signed off, if the record carries it. */
  costApprovedAt?: string;
  costApprovedBy?: string;
}

/**
 * ONE state, however many items are outside the baseline.
 *
 * Deliberately a single object with a list, not one signal per item.
 * Several approved change orders do not create several conflicting
 * demands — they create one demand: raise the next baseline version, and
 * here is everything it must take in.
 */
export interface BaselineUpdateState {
  required: boolean;
  /** Version of the baseline in force. null when none is approved yet. */
  currentBaselineVersion: number | null;
  currentBaselineId: string | null;
  affectedChangeOrderIds: string[];
  affectedClaimIds: string[];
  /** Full detail per item, for the notification and the audit trail. */
  triggers: UpdateTrigger[];
  /** Sum of the DIRECT impacts — the eventual BAC movement. NOT applied. */
  pendingDirectImpact: number;
  /** Sum of the INDIRECT impacts — budget only. NOT applied. */
  pendingIndirectImpact: number;
  pendingTotalImpact: number;
  /** English and Arabic, ready to render. Empty when nothing is required. */
  message: string;
  messageAr: string;
}

function impactOf(row: CostBearingRow): { direct: number; indirect: number } {
  const s = costState(row);
  return s.figures
    ? { direct: s.figures.direct, indirect: s.figures.indirect }
    : { direct: 0, indirect: 0 };
}

function refOf(row: CostBearingRow): string {
  const n = (row as Record<string, unknown>)?.no;
  return typeof n === 'string' && n.trim() ? n : '(unnumbered)';
}

function approvalMeta(row: CostBearingRow): { at?: string; by?: string } {
  const c = (row as Record<string, unknown>)?.cost as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return {};
  return {
    at: typeof c.costApprovedAt === 'string' ? c.costApprovedAt : undefined,
    by: typeof c.costApprovedBy === 'string' ? c.costApprovedBy : undefined,
  };
}

/**
 * Detects whether the current baseline has fallen behind the approved
 * financial scope.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE TRIGGER IS DELIBERATELY NARROW.
 *
 * An item counts ONLY when it is commercially approved AND cost assessed
 * AND cost approved AND absent from the current baseline's included
 * list. Every weaker state — created, commercially approved but
 * unassessed, assessed but unapproved, rejected, legacy — is silent.
 *
 * That narrowness is the feature. A signal that fires on a draft change
 * order is noise, and a governance banner that is usually wrong is one
 * users learn to dismiss. It fires when, and only when, the approved
 * plan genuinely no longer matches the approved scope.
 *
 * INCLUSION IS READ FROM THE BASELINE'S OWN RECORD, never inferred from
 * dates. The package states which items it took in; an item is inside it
 * because it says so, not because a timestamp falls in a window.
 *
 * WITH NO APPROVED BASELINE, NOTHING IS REQUIRED. There is no plan to
 * have fallen behind. A project mid-setup would otherwise show a
 * governance alarm for work nobody has baselined yet.
 * ══════════════════════════════════════════════════════════════════════
 */
export function detectBaselineUpdate(input: {
  store: BaselineStore;
  changeOrders: CostBearingRow[];
  claims: CostBearingRow[];
  currency?: string;
}): BaselineUpdateState {
  const empty: BaselineUpdateState = {
    required: false,
    currentBaselineVersion: null,
    currentBaselineId: null,
    affectedChangeOrderIds: [],
    affectedClaimIds: [],
    triggers: [],
    pendingDirectImpact: 0,
    pendingIndirectImpact: 0,
    pendingTotalImpact: 0,
    message: '',
    messageAr: '',
  };

  const pkgs = (input.store?.packages || []).filter(p => p.status === 'approved');
  if (pkgs.length === 0) return empty;
  const current = pkgs.reduce((a, b) => (b.version > a.version ? b : a));

  const includedCos = new Set(current.data?.includedChangeOrderIds || []);
  const includedClaims = new Set(current.data?.includedClaimIds || []);

  const triggers: UpdateTrigger[] = [];

  const scan = (rows: CostBearingRow[], kind: UpdateTrigger['kind'], included: Set<string>) => {
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (!row || typeof row !== 'object') return;
      if (!isBaselineEligible(row)) return;          // the narrow gate
      const ref = refOf(row);
      if (included.has(ref)) return;                 // already baselined
      const { direct, indirect } = impactOf(row);
      const meta = approvalMeta(row);
      triggers.push({
        ref, kind,
        directImpact: direct,
        indirectImpact: indirect,
        totalImpact: direct + indirect,
        costApprovedAt: meta.at,
        costApprovedBy: meta.by,
      });
    });
  };

  scan(input.changeOrders, 'change-order', includedCos);
  scan(input.claims, 'claim', includedClaims);

  if (triggers.length === 0) {
    return { ...empty,
      currentBaselineVersion: current.version,
      currentBaselineId: current.id };
  }

  const cos = triggers.filter(t => t.kind === 'change-order');
  const cls = triggers.filter(t => t.kind === 'claim');
  const direct = triggers.reduce((a, t) => a + t.directImpact, 0);
  const indirect = triggers.reduce((a, t) => a + t.indirectImpact, 0);
  const ccy = input.currency || current.data?.currency || '';
  const money = (n: number) =>
    (ccy ? ccy + ' ' : '') + Math.round(n).toLocaleString('en-US');

  const names = triggers.map(t => t.ref).join(', ');
  const message =
    `${triggers.length} financially approved ` +
    `${triggers.length === 1 ? 'item is' : 'items are'} not included in Baseline ` +
    `Package V${current.version}: ${names}. ` +
    `Direct cost ${money(direct)} · Indirect cost ${money(indirect)}. ` +
    `Review and create Baseline Package V${current.version + 1} to include ` +
    `${triggers.length === 1 ? 'it' : 'them'}.`;
  const messageAr =
    `${triggers.length} بند معتمد مالياً غير مُدرَج في حزمة خط الأساس ` +
    `V${current.version}: ${names}. ` +
    `تكلفة مباشرة ${money(direct)} · تكلفة غير مباشرة ${money(indirect)}. ` +
    `راجع وأنشئ حزمة خط الأساس V${current.version + 1} لإدراجها.`;

  return {
    required: true,
    currentBaselineVersion: current.version,
    currentBaselineId: current.id,
    affectedChangeOrderIds: cos.map(t => t.ref),
    affectedClaimIds: cls.map(t => t.ref),
    triggers,
    pendingDirectImpact: direct,
    pendingIndirectImpact: indirect,
    pendingTotalImpact: direct + indirect,
    message, messageAr,
  };
}

/**
 * Reads the three stores and derives the state for one project.
 *
 * A convenience wrapper only — it READS localStorage and writes nothing.
 * The pure function above stays available for callers that already hold
 * the records, and it is what the tests exercise directly.
 */
export function baselineUpdateStateFor(projectId: string, currency?: string): BaselineUpdateState {
  const read = (key: string): CostBearingRow[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  };
  let store: BaselineStore = { baselines: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(`pactum-baselines-${projectId}`) || 'null');
    if (raw && typeof raw === 'object') store = raw as BaselineStore;
  } catch { /* noop */ }

  return detectBaselineUpdate({
    store,
    changeOrders: read(`pactum-co-${projectId}`),
    claims: read(`pactum-claims-${projectId}`),
    currency,
  });
}
