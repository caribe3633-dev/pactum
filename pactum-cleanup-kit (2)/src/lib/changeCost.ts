/**
 * Change Order cost assessment and cost approval.
 * Destination: src/lib/changeCost.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * COMMERCIAL APPROVAL IS NOT COST APPROVAL.
 *
 *   A change order already has one `status` field. That field means, and
 *   continues to mean, COMMERCIAL agreement: the parties accept the
 *   change and its contract value. It is read by `computeBac`, by the
 *   contract-amount rollups and by the reports, and this module does not
 *   touch it.
 *
 *   What it never meant is that anyone costed the work. A commercially
 *   agreed change with no cost assessment is a known scope increase of
 *   unknown cost — a perfectly normal state on a live project, and one
 *   the software had no way to express. Every such order looked
 *   identical to a fully assessed one.
 *
 *   So cost lives in its own nested block with its own approval. The two
 *   axes move independently, and baseline readiness requires BOTH.
 *
 * WHY MISSING COST IS NOT ZERO.
 *
 *   Treating an unassessed order as costing nothing is the single most
 *   dangerous default available here: it produces a budget that looks
 *   complete, reconciles cleanly, and is understated by exactly the
 *   amount nobody has measured yet. Absent and zero are different facts.
 *   `assessed` is therefore an explicit flag, not an inference from the
 *   numbers — an order genuinely assessed at zero direct cost is a real
 *   and different thing from one never looked at.
 *
 * DIRECT AND INDIRECT ARE NOT INTERCHANGEABLE.
 *
 *   Both move the project budget. Only DIRECT moves BAC, because EVM is
 *   direct-cost only. The split therefore cannot be derived from the
 *   commercial `value`, and this module will not guess it.
 *
 * PURE. No storage, no currency conversion, no UI.
 * ══════════════════════════════════════════════════════════════════════
 */

/**
 * Cost assessment attached to a change order or, later, a claim.
 *
 * The whole block is OPTIONAL on the row. Its absence is the legacy
 * state and is never written by a migration.
 */
export interface CostAssessment {
  /**
   * ════════════════════════════════════════════════════════════════════
   * STEP 9 · Q1=C — WHICH BUDGET LINE THIS COST BELONGS TO.
   *
   * Empty string = NOT LINKED, and that is a meaningful state, not a
   * missing one.
   *
   * The problem it solves: PACTUM had no relationship at all between a
   * change order and the budget, so when a baseline is rebuilt there was
   * no way to know whether an approved 8M is ALREADY inside the budget
   * register (a planner raised the line) or sits OUTSIDE it (nobody has
   * touched the register yet). Adding it blindly double-counts; ignoring
   * it blindly understates. Both are silent and both are wrong.
   *
   * So the assessor states it:
   *
   *   LINKED   → the named budget line already carries this cost. The
   *              baseline records the reference and adds NOTHING; the
   *              register is the single source of the figure.
   *   UNLINKED → this cost is not in the register. The baseline adds it
   *              on top, and says so.
   *
   * The category NAME is the key, because that is the only identity a
   * budget line has — there is no id on those rows and inventing one
   * would mean rewriting every stored budget record.
   * ════════════════════════════════════════════════════════════════════
   */
  budgetLineRef?: string;

  /**
   * Cost impact that is part of the works — labour, materials, plant,
   * subcontract. Enters the direct budget and, once baselined, BAC.
   */
  directImpact: number;
  /**
   * Site overhead, management, insurance, preliminaries. Enters the
   * project budget and NEVER enters BAC.
   */
  indirectImpact: number;
  /**
   * Set when a person has actually costed the change. Explicit, because
   * `directImpact === 0` is a legitimate assessment outcome and must not
   * be confused with "nobody has looked".
   */
  assessed: boolean;
  assessedBy?: string;
  assessedAt?: string;
  /** Cost approval — separate from, and never implied by, commercial. */
  costApproval: CostApprovalState;
  costApprovedBy?: string;
  costApprovedAt?: string;
  /** Required when rejected, so a refusal is never unexplained. */
  costNote?: string;
}

export type CostApprovalState = 'pending' | 'approved' | 'rejected';

/**
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 4 · STEP 7 — THE TWO AXES, REPORTED SEPARATELY.
 *
 * Storage has always held these apart: `assessed` (has anyone costed it)
 * and `costApproval` (has the cost been signed off). But the only API for
 * reading them was `costStage`, which FLATTENS both into one value, and
 * the screens rendered that single value as one chip.
 *
 * A flattened state cannot express the combination the approved model
 * cares most about — assessment complete AND approval rejected — without
 * the reader inferring it. `cost-rejected` implies the assessment is
 * complete, but only if you know the rules; the figures behind it are
 * invisible in the label.
 *
 * So the two axes are now first-class and reported independently.
 * `costStage` is UNCHANGED and still exported: it is a useful summary and
 * six suites already assert on it. Nothing is collapsed away; a second,
 * separated view is added beside it.
 * ══════════════════════════════════════════════════════════════════════
 */

/** Axis 1 — has the cost been measured? */
export type CostAssessmentStatus = 'required' | 'complete';

/** Axis 2 — has the measured cost been signed off? */
export type CostApprovalStatus = CostApprovalState;

export interface CostStatePair {
  /**
   * True when there is no cost block at all — a record written before the
   * feature existed. Distinct from `required`, which means the workflow
   * has started and nobody has costed it yet.
   */
  legacy: boolean;
  assessment: CostAssessmentStatus;
  approval: CostApprovalStatus;
  /** The measured figures. Null until an assessment exists. */
  figures: { direct: number; indirect: number; total: number } | null;
}

/**
 * Both axes, never merged.
 *
 * A legacy row reports `assessment: 'required'` and `approval: 'pending'`
 * with `legacy: true` — the honest reading of "nothing recorded", and
 * pointedly NOT `rejected`, which would be a decision nobody made.
 */
export function costState(row: CostBearingRow): CostStatePair {
  const c = costOf(row);
  if (!c) {
    return { legacy: true, assessment: 'required', approval: 'pending', figures: null };
  }
  return {
    legacy: false,
    assessment: c.assessed ? 'complete' : 'required',
    approval: c.costApproval,
    // Figures survive a rejection. They are the record of what was
    // measured and refused, and deleting them would destroy the audit
    // trail that explains the refusal.
    figures: c.assessed
      ? { direct: c.directImpact, indirect: c.indirectImpact,
          total: c.directImpact + c.indirectImpact }
      : null,
  };
}

export function assessmentStatusLabel(s: CostAssessmentStatus, lang: 'en' | 'ar' = 'en'): string {
  if (s === 'complete') return lang === 'ar' ? 'مكتمل' : 'Complete';
  return lang === 'ar' ? 'مطلوب' : 'Required';
}

export function approvalStatusLabel(s: CostApprovalStatus, lang: 'en' | 'ar' = 'en'): string {
  if (s === 'approved') return lang === 'ar' ? 'معتمدة' : 'Approved';
  if (s === 'rejected') return lang === 'ar' ? 'مرفوضة' : 'Rejected';
  return lang === 'ar' ? 'قيد الانتظار' : 'Pending';
}

/**
 * BASELINE ELIGIBILITY — the single rule, stated once.
 *
 *   commercial approved  AND  assessment complete  AND  approval approved
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT THIS DOES NOT MEAN.
 *
 * Eligible does NOT mean the baseline is approved, the budget is
 * approved, BAC has moved or PV has moved. It means exactly one thing:
 * this item's assessed cost has been signed off, so a FUTURE baseline is
 * permitted to consider it. Nothing downstream is touched by this
 * function — it reads a row and returns a boolean.
 * ══════════════════════════════════════════════════════════════════════
 */
export function isBaselineEligible(row: CostBearingRow): boolean {
  const s = costState(row);
  return isCommerciallyApproved(row)
    && s.assessment === 'complete'
    && s.approval === 'approved';
}

/** The single, ordered lifecycle a reader sees on screen. */
export type CostStage =
  | 'legacy'               // no cost block at all — historical record
  | 'assessment-required'  // block exists but nobody has costed it
  | 'assessed'             // costed, awaiting cost approval
  | 'cost-approved'        // costed and approved
  | 'cost-rejected';       // costed and refused

/** Minimal structural shape. Deliberately not the module's own row type. */
export interface CostBearingRow {
  no?: unknown;
  status?: unknown;        // COMMERCIAL status — untouched by this module
  cost?: unknown;          // CostAssessment | undefined
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

/** Reads the cost block defensively. Returns null when there is none. */
export function costOf(row: CostBearingRow): CostAssessment | null {
  const c = row?.cost;
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const state = str(o.costApproval).toLowerCase();
  return {
    budgetLineRef: o.budgetLineRef ? str(o.budgetLineRef) : undefined,
    directImpact: num(o.directImpact),
    indirectImpact: num(o.indirectImpact),
    assessed: o.assessed === true,
    assessedBy: o.assessedBy ? str(o.assessedBy) : undefined,
    assessedAt: o.assessedAt ? str(o.assessedAt) : undefined,
    costApproval:
      state === 'approved' ? 'approved' : state === 'rejected' ? 'rejected' : 'pending',
    costApprovedBy: o.costApprovedBy ? str(o.costApprovedBy) : undefined,
    costApprovedAt: o.costApprovedAt ? str(o.costApprovedAt) : undefined,
    costNote: o.costNote ? str(o.costNote) : undefined,
  };
}

/**
 * A row written before this feature. Distinguished by the ABSENCE of the
 * cost block, never by its values — a legacy row and a fresh unassessed
 * row are different situations and the screen says so differently.
 */
export function isLegacy(row: CostBearingRow): boolean {
  return costOf(row) === null;
}

/** Commercial approval, reading the existing status field unchanged. */
export function isCommerciallyApproved(row: CostBearingRow): boolean {
  return str(row?.status).trim().toLowerCase() === 'approved';
}

export function costStage(row: CostBearingRow): CostStage {
  const c = costOf(row);
  if (!c) return 'legacy';
  if (!c.assessed) return 'assessment-required';
  if (c.costApproval === 'approved') return 'cost-approved';
  if (c.costApproval === 'rejected') return 'cost-rejected';
  return 'assessed';
}

export function costStageLabel(s: CostStage, lang: 'en' | 'ar' = 'en'): string {
  const en: Record<CostStage, string> = {
    'legacy': 'Legacy — cost assessment not available',
    'assessment-required': 'Cost assessment required',
    'assessed': 'Assessed — cost approval pending',
    'cost-approved': 'Cost approved',
    'cost-rejected': 'Cost rejected',
  };
  const ar: Record<CostStage, string> = {
    'legacy': 'قديم — تقييم التكلفة غير متاح',
    'assessment-required': 'مطلوب تقييم التكلفة',
    'assessed': 'مُقيَّم — بانتظار اعتماد التكلفة',
    'cost-approved': 'التكلفة معتمدة',
    'cost-rejected': 'التكلفة مرفوضة',
  };
  return lang === 'ar' ? ar[s] : en[s];
}

/** Total budget impact. Direct + indirect, and only when assessed. */
export function totalCostImpact(row: CostBearingRow): number {
  const c = costOf(row);
  if (!c || !c.assessed) return 0;
  return c.directImpact + c.indirectImpact;
}

/**
 * The BAC impact of this change order.
 *
 * DIRECT ONLY. Indirect cost is real and belongs in the project budget,
 * but EVM is measured on a direct-cost basis, so putting indirect into
 * BAC would inflate the baseline against which every SPI and CPI is
 * computed.
 *
 * Returns 0 unless the cost is BOTH assessed AND cost-approved: an
 * unapproved figure has no business moving a baseline.
 */
export function bacImpact(row: CostBearingRow): number {
  const c = costOf(row);
  if (!c || !c.assessed || c.costApproval !== 'approved') return 0;
  return c.directImpact;
}

/** Budget impact, split. Same approval requirement as `bacImpact`. */
export function budgetImpact(row: CostBearingRow): { direct: number; indirect: number; total: number } {
  const c = costOf(row);
  if (!c || !c.assessed || c.costApproval !== 'approved') {
    return { direct: 0, indirect: 0, total: 0 };
  }
  return {
    direct: c.directImpact,
    indirect: c.indirectImpact,
    total: c.directImpact + c.indirectImpact,
  };
}

export interface ReadinessVerdict {
  ready: boolean;
  stage: CostStage;
  commercial: boolean;
  /** Ordered, named, never a generic error. */
  reasons: string[];
  reasonsAr: string[];
}

/**
 * Baseline readiness. All three conditions, every time.
 *
 *   commercial approved  AND  assessed  AND  cost approved
 *
 * A legacy order is never ready — not because it is invalid, but because
 * nothing is known about its cost. It stays usable everywhere else; it
 * simply cannot create a NEW baseline cost impact until someone assesses
 * it. That is the grandfathering rule, enforced rather than described.
 */
export function baselineReadiness(row: CostBearingRow): ReadinessVerdict {
  const stage = costStage(row);
  const commercial = isCommerciallyApproved(row);
  const reasons: string[] = [];
  const reasonsAr: string[] = [];

  if (!commercial) {
    reasons.push('Not commercially approved');
    reasonsAr.push('غير معتمد تجارياً');
  }
  if (stage === 'legacy') {
    reasons.push('Legacy — cost assessment not available');
    reasonsAr.push('قديم — تقييم التكلفة غير متاح');
  } else if (stage === 'assessment-required') {
    reasons.push('Cost assessment required');
    reasonsAr.push('مطلوب تقييم التكلفة');
  } else if (stage === 'assessed') {
    reasons.push('Cost approval pending');
    reasonsAr.push('اعتماد التكلفة قيد الانتظار');
  } else if (stage === 'cost-rejected') {
    reasons.push('Cost was rejected');
    reasonsAr.push('التكلفة مرفوضة');
  }

  return {
    // DELEGATED, not recomputed. Step 7 introduced `isBaselineEligible`
    // as the single statement of the rule; evaluating the same condition
    // a second time here would be two definitions of eligibility that
    // could drift apart under a later edit. One rule, one place.
    ready: isBaselineEligible(row),
    stage, commercial, reasons, reasonsAr,
  };
}

/** Every change order that may be included in a baseline. */
export function baselineReadyRows<T extends CostBearingRow>(rows: T[] | null | undefined): T[] {
  return (Array.isArray(rows) ? rows : []).filter(r => baselineReadiness(r).ready);
}

/** Portfolio-style summary for the screen's tiles. */
export interface CostSummary {
  total: number;
  legacy: number;
  assessmentRequired: number;
  assessed: number;
  costApproved: number;
  costRejected: number;
  baselineReady: number;
  /** Approved-and-assessed impacts only. */
  approvedDirect: number;
  approvedIndirect: number;
  approvedTotal: number;
  /** Commercially approved but NOT baseline ready — the actionable gap. */
  blockedRefs: string[];
}

export function summariseCosts(rows: CostBearingRow[] | null | undefined): CostSummary {
  const list = Array.isArray(rows) ? rows : [];
  const s: CostSummary = {
    total: list.length, legacy: 0, assessmentRequired: 0, assessed: 0,
    costApproved: 0, costRejected: 0, baselineReady: 0,
    approvedDirect: 0, approvedIndirect: 0, approvedTotal: 0, blockedRefs: [],
  };
  list.forEach(r => {
    const stage = costStage(r);
    if (stage === 'legacy') s.legacy++;
    else if (stage === 'assessment-required') s.assessmentRequired++;
    else if (stage === 'assessed') s.assessed++;
    else if (stage === 'cost-approved') s.costApproved++;
    else if (stage === 'cost-rejected') s.costRejected++;

    const v = baselineReadiness(r);
    if (v.ready) {
      s.baselineReady++;
      const b = budgetImpact(r);
      s.approvedDirect += b.direct;
      s.approvedIndirect += b.indirect;
      s.approvedTotal += b.total;
    } else if (v.commercial) {
      // Commercially agreed but financially incomplete — the set a
      // planner actually has to act on before a baseline can be raised.
      s.blockedRefs.push(str(r?.no) || '(unnumbered)');
    }
  });
  return s;
}

// ── Mutating helpers — return NEW rows, never persist ──────────────────

/**
 * Records an assessment. Additive by construction: every existing key on
 * the row is spread through untouched and only `cost` is written.
 *
 * Approval is deliberately reset to `pending` whenever the figures
 * change. Approving 8M and then editing it to 20M while the approval
 * stands would let an unapproved number reach a baseline.
 */
export function assessCost<T extends CostBearingRow>(
  row: T, directImpact: number, indirectImpact: number,
  by: string, at: string = new Date().toISOString(),
  budgetLineRef?: string,
): T {
  const prev = costOf(row);
  const ref = (budgetLineRef !== undefined ? str(budgetLineRef) : (prev?.budgetLineRef ?? '')).trim();
  // The LINK is part of the assessment, so changing it re-opens approval
  // exactly as changing a figure does. Approving "8M, already in
  // Earthworks" and then silently re-pointing it at "not in the budget"
  // would move 8M into the baseline on an approval nobody gave.
  const changed = !prev
    || prev.directImpact !== num(directImpact)
    || prev.indirectImpact !== num(indirectImpact)
    || (prev.budgetLineRef ?? '') !== ref;
  const cost: CostAssessment = {
    budgetLineRef: ref || undefined,
    directImpact: num(directImpact),
    indirectImpact: num(indirectImpact),
    assessed: true,
    assessedBy: by || 'unknown',
    assessedAt: at,
    costApproval: changed ? 'pending' : (prev ? prev.costApproval : 'pending'),
    costApprovedBy: changed ? undefined : prev?.costApprovedBy,
    costApprovedAt: changed ? undefined : prev?.costApprovedAt,
    costNote: changed ? undefined : prev?.costNote,
  };
  return { ...row, cost };
}

/**
 * Is this cost already carried by a budget line?
 *
 * The whole point of Q1=C: a LINKED cost is inside the register already,
 * so a baseline records the reference and adds nothing. An UNLINKED cost
 * is outside it and must be added on top. Nothing is inferred — the
 * assessor stated which it is.
 */
export function isBudgetLinked(row: CostBearingRow): boolean {
  const c = costOf(row);
  return !!(c && c.budgetLineRef && c.budgetLineRef.trim());
}

/** The linked line's category name, or '' when unlinked. */
export function budgetLineRefOf(row: CostBearingRow): string {
  const c = costOf(row);
  return (c?.budgetLineRef ?? '').trim();
}

/**
 * The cost this item ADDS to the budget on top of the register.
 *
 * Zero when linked (the register already holds it) and zero unless the
 * cost is both assessed and approved. This is the only function a
 * baseline rebuild may use to add money, and it is deliberately the one
 * place the double-count question is answered.
 */
export function additiveBudgetImpact(row: CostBearingRow): { direct: number; indirect: number } {
  if (isBudgetLinked(row)) return { direct: 0, indirect: 0 };
  const b = budgetImpact(row);
  return { direct: b.direct, indirect: b.indirect };
}

/**
 * Approves the assessed cost.
 *
 * Refuses an unassessed row by returning it UNCHANGED — approving a cost
 * nobody has measured is exactly the defect this module exists to
 * prevent, and it must not be possible even by calling the function
 * directly.
 */
export function approveCost<T extends CostBearingRow>(
  row: T, by: string, at: string = new Date().toISOString(),
): T {
  const c = costOf(row);
  if (!c || !c.assessed) return row;
  return { ...row, cost: { ...c, costApproval: 'approved' as CostApprovalState,
                           costApprovedBy: by || 'unknown', costApprovedAt: at } };
}

/** Refuses the assessed cost, with a stated reason. */
export function rejectCost<T extends CostBearingRow>(
  row: T, by: string, note: string, at: string = new Date().toISOString(),
): T {
  const c = costOf(row);
  if (!c || !c.assessed) return row;
  return { ...row, cost: { ...c, costApproval: 'rejected' as CostApprovalState,
                           costApprovedBy: by || 'unknown', costApprovedAt: at,
                           costNote: note || '' } };
}

/**
 * Opens an empty assessment on a legacy row.
 *
 * This is the ONLY way a legacy order acquires a cost block, and it is
 * always a deliberate user action. It writes no figures — it records
 * that someone has started, moving the row from `legacy` to
 * `assessment-required`. Nothing is invented.
 */
export function beginAssessment<T extends CostBearingRow>(row: T): T {
  if (costOf(row)) return row;
  const cost: CostAssessment = {
    directImpact: 0, indirectImpact: 0,
    assessed: false,
    costApproval: 'pending',
  };
  return { ...row, cost };
}
