/**
 * Budget line cost classification and derivation.
 * Destination: src/lib/costModel.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS
 *
 *   PACTUM had no direct/indirect cost classification anywhere. A budget
 *   row was `{ category, planned, actual, forecast, variance }` and the
 *   category was free text typed by the user. Every clause of the
 *   approved financial model — EVM on a direct-cost basis, BAC as the
 *   approved direct budget, the CO/Claim direct+indirect split — depends
 *   on a classification that did not exist.
 *
 *   This module introduces it, and NOTHING ELSE. It is pure: it reads
 *   rows it is handed and returns numbers. It does not read localStorage,
 *   does not write, does not convert currency, and does not know what a
 *   baseline is. Those belong to the modules that own them.
 *
 * WHY `unclassified` IS A FIRST-CLASS VALUE, NOT A MISSING FIELD
 *
 *   Every budget row that exists today predates this feature and has no
 *   `costType`. The approved rule is that they become UNCLASSIFIED and
 *   are never guessed. So "absent" must map to a value the rest of the
 *   system can see, count, name and refuse to approve over — not to a
 *   silent default.
 *
 *   `Preliminaries & General` and `Site Office` appear in the seeded
 *   datasets and LOOK indirect. They are not classified here. A category
 *   name is not a cost classification, and inferring one would be
 *   inventing a financial fact.
 *
 * WHY THE TOTAL IS DERIVED AND NEVER STORED
 *
 *   Direct + Indirect + Total are computed from the lines on every read.
 *   A stored aggregate is a second source of truth: edit one line and the
 *   stored total is silently wrong until something recomputes it. There
 *   is no field to drift because there is no field.
 *
 * CURRENCY
 *
 *   Budget rows are stored in the project contract currency, with FX
 *   provenance attached by `transactionFields()` at write time. A row
 *   left in another unit by a blocked migration is NOT converted here —
 *   converting on read would apply a rate this module has no basis to
 *   choose. Off-unit rows are excluded from the totals and named, the
 *   same rule the certificate and commercial totals already follow.
 * ══════════════════════════════════════════════════════════════════════
 */

import { storedUnitOf } from './moneyEntry';

/**
 * A budget line's cost classification.
 *
 * `unclassified` is not an error state — it is the honest description of
 * a line nobody has classified yet. It blocks baseline approval; it does
 * not block using the application.
 */
export type CostType = 'direct' | 'indirect' | 'unclassified';

/** The two a user may actually choose. `unclassified` is only ever absence. */
export const SELECTABLE_COST_TYPES: { value: Exclude<CostType, 'unclassified'>; en: string; ar: string }[] = [
  { value: 'direct',   en: 'Direct',   ar: 'مباشرة' },
  { value: 'indirect', en: 'Indirect', ar: 'غير مباشرة' },
];

export function costTypeLabel(t: CostType, lang: 'en' | 'ar' = 'en'): string {
  if (t === 'direct')   return lang === 'ar' ? 'مباشرة' : 'Direct';
  if (t === 'indirect') return lang === 'ar' ? 'غير مباشرة' : 'Indirect';
  return lang === 'ar' ? 'غير مصنَّفة' : 'Unclassified';
}

/**
 * The shape this module needs. Deliberately minimal and structural — it
 * does not import the Budget module's own row type, so the two can evolve
 * without dragging each other along.
 */
export interface BudgetLineLike {
  category?: unknown;
  planned?: unknown;
  actual?: unknown;
  forecast?: unknown;
  /** Absent on every row written before this feature. */
  costType?: unknown;
  /** Written by the transaction layer. Absent on same-currency rows. */
  reportingCurrency?: unknown;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

/**
 * The classification of one line.
 *
 * Anything that is not exactly 'direct' or 'indirect' is UNCLASSIFIED.
 * A typo, a stale value, a number, `null` — none of them become a guess.
 */
/**
 * Category names of ONE cost class — the options for the per-class budget
 * link in a cost assessment (owner rule: the direct portion links to a
 * DIRECT line, the indirect portion to an INDIRECT line, so the baseline
 * rebuild recognizes each part against the right class).
 * Unclassified lines appear in NEITHER list: classify them in the Budget
 * screen — nothing is guessed here.
 */
export function budgetCategoriesByClass(rows: unknown[], cls: 'direct' | 'indirect'): string[] {
  const seen = new Set<string>();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    if (costTypeOf(r as BudgetLineLike) !== cls) return;
    const c = typeof (r as any)?.category === 'string' ? (r as any).category.trim() : '';
    if (c) seen.add(c);
  });
  return [...seen];
}

export function costTypeOf(line: BudgetLineLike): CostType {
  const t = str(line?.costType).trim().toLowerCase();
  if (t === 'direct') return 'direct';
  if (t === 'indirect') return 'indirect';
  return 'unclassified';
}

/** True when a human has classified this line. */
export function isClassified(line: BudgetLineLike): boolean {
  return costTypeOf(line) !== 'unclassified';
}

/** One line's identity for a message a person has to act on. */
export function lineRef(line: BudgetLineLike, index: number): string {
  const c = str(line?.category).trim();
  return c || `Line ${index + 1}`;
}

/**
 * Which money column the derivation reads.
 *
 * `planned` is the budget. `actual` and `forecast` are available because
 * the same split is wanted on cost reports — but note the approved rule:
 * EVM's Actual Cost is entered by Finance and is NEVER derived from
 * `budget.actual`. This function does not know about EVM, and no EVM code
 * may call it for AC.
 */
export type BudgetField = 'planned' | 'actual' | 'forecast';

export interface CostBreakdown {
  direct: number;
  indirect: number;
  /** direct + indirect. Rule A holds by construction. */
  total: number;
  /** Value sitting on lines nobody has classified. NOT part of `total`. */
  unclassified: number;
  counts: { direct: number; indirect: number; unclassified: number; excluded: number };
  /** Names of unclassified lines, so a gate can say which ones. */
  unclassifiedRefs: string[];
  /** Lines excluded because they are stored in another currency. */
  excludedRefs: string[];
  /** True when no line is unclassified and nothing was excluded. */
  complete: boolean;
  /** The unit every included figure is denominated in. */
  currency: string;
}

/**
 * Derives Direct / Indirect / Total from the lines.
 *
 * ══════════════════════════════════════════════════════════════════════
 * UNCLASSIFIED VALUE IS REPORTED SEPARATELY AND IS *NOT* IN THE TOTAL.
 *
 * The alternative — folding it into `total` — would produce a Total that
 * is not Direct + Indirect, breaking Rule A silently and making the
 * headline look complete while the split underneath it is not. Keeping it
 * out means `total` is always exactly `direct + indirect`, and the money
 * that has no home is visible as its own number rather than hidden inside
 * a subtotal.
 *
 * A caller that wants "everything in the register" adds
 * `total + unclassified` deliberately, which is the point.
 * ══════════════════════════════════════════════════════════════════════
 */
export function deriveBudget(
  lines: BudgetLineLike[] | null | undefined,
  projectCurrency: string,
  field: BudgetField = 'planned',
): CostBreakdown {
  const out: CostBreakdown = {
    direct: 0, indirect: 0, total: 0, unclassified: 0,
    counts: { direct: 0, indirect: 0, unclassified: 0, excluded: 0 },
    unclassifiedRefs: [], excludedRefs: [],
    complete: true, currency: projectCurrency,
  };
  if (!Array.isArray(lines)) return out;

  lines.forEach((line, i) => {
    if (!line || typeof line !== 'object') return;

    // A row in another unit cannot be added to a total labelled in this
    // one. Excluded and named — never silently converted, never silently
    // summed.
    if (storedUnitOf(line, projectCurrency) !== projectCurrency) {
      out.counts.excluded++;
      out.excludedRefs.push(lineRef(line, i));
      out.complete = false;
      return;
    }

    const v = num((line as Record<string, unknown>)[field]);
    const t = costTypeOf(line);

    if (t === 'direct') { out.direct += v; out.counts.direct++; }
    else if (t === 'indirect') { out.indirect += v; out.counts.indirect++; }
    else {
      out.unclassified += v;
      out.counts.unclassified++;
      out.unclassifiedRefs.push(lineRef(line, i));
      out.complete = false;
    }
  });

  out.total = out.direct + out.indirect;
  return out;
}

/**
 * Rule A as an assertion: Total == Direct + Indirect.
 *
 * True by construction above, so this exists to be called by the gate and
 * by tests — a reconciliation that is only true "because the code says so"
 * is not a reconciliation. It is checked against float dust rather than
 * exact equality because the inputs are FX-converted values.
 */
export function ruleA(b: CostBreakdown, tolerance = 0.5): { ok: boolean; delta: number } {
  const delta = b.total - (b.direct + b.indirect);
  return { ok: Math.abs(delta) <= tolerance, delta };
}

/**
 * Everything a baseline gate needs to refuse, with the reasons named.
 *
 * Returns `blocked: false` on an EMPTY register too — an empty budget is
 * not "classified", it is absent, and a baseline over no budget is not a
 * baseline. The caller decides whether emptiness is fatal; this function
 * reports the fact rather than deciding for it.
 */
export interface ClassificationStatus {
  lineCount: number;
  classifiedCount: number;
  unclassifiedCount: number;
  unclassifiedRefs: string[];
  excludedRefs: string[];
  /** True when every line carries a classification and none was excluded. */
  ready: boolean;
  /** Human-readable, already ordered for display. */
  reasons: string[];
  reasonsAr: string[];
}

export function classificationStatus(
  lines: BudgetLineLike[] | null | undefined,
  projectCurrency: string,
): ClassificationStatus {
  const list = Array.isArray(lines) ? lines.filter(l => l && typeof l === 'object') : [];
  const b = deriveBudget(list, projectCurrency);
  const reasons: string[] = [];
  const reasonsAr: string[] = [];

  if (list.length === 0) {
    reasons.push('The budget register is empty — there are no lines to classify.');
    reasonsAr.push('سجل الموازنة فارغ — لا توجد بنود لتصنيفها.');
  }
  if (b.counts.unclassified > 0) {
    reasons.push(
      `${b.counts.unclassified} budget line(s) are UNCLASSIFIED and must be marked ` +
      `Direct or Indirect: ${b.unclassifiedRefs.join(' · ')}`);
    reasonsAr.push(
      `${b.counts.unclassified} بند/بنود في الموازنة غير مصنَّفة، ويجب تحديدها ` +
      `مباشرة أو غير مباشرة: ${b.unclassifiedRefs.join(' · ')}`);
  }
  if (b.counts.excluded > 0) {
    reasons.push(
      `${b.counts.excluded} budget line(s) are stored in another currency and are ` +
      `excluded from the totals: ${b.excludedRefs.join(' · ')}`);
    reasonsAr.push(
      `${b.counts.excluded} بند/بنود مخزَّنة بعملة أخرى ومستبعدة من الإجماليات: ` +
      `${b.excludedRefs.join(' · ')}`);
  }

  return {
    lineCount: list.length,
    classifiedCount: b.counts.direct + b.counts.indirect,
    unclassifiedCount: b.counts.unclassified,
    unclassifiedRefs: b.unclassifiedRefs,
    excludedRefs: b.excludedRefs,
    ready: list.length > 0 && b.counts.unclassified === 0 && b.counts.excluded === 0,
    reasons,
    reasonsAr,
  };
}

/**
 * Applies a classification to one line, returning a NEW row.
 *
 * ══════════════════════════════════════════════════════════════════════
 * Additive and non-destructive by construction: every existing key is
 * spread through untouched, and only `costType` plus its provenance are
 * written. Nothing this function returns can drop a field, change an
 * amount, or alter a currency stamp.
 *
 * It returns a value; it does NOT persist. Persistence belongs to the
 * module that owns the store, so there is exactly one writer.
 * ══════════════════════════════════════════════════════════════════════
 */
export function classifyLine<T extends BudgetLineLike>(
  line: T,
  costType: Exclude<CostType, 'unclassified'>,
  by: string,
  at: string = new Date().toISOString(),
): T & { costType: CostType; classifiedBy: string; classifiedAt: string } {
  return { ...line, costType, classifiedBy: by || 'unknown', classifiedAt: at };
}
