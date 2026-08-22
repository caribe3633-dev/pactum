/**
 * TWO LINKS, ONE PER COST CLASS (owner rule) — the regression net.
 *
 * The cost assessment of a change order or a claim carries a DIRECT budget
 * link and an INDIRECT budget link. Each class states independently which
 * budget line already carries it, and the baseline rebuild adds only the
 * unlinked classes. A legacy single `budgetLineRef` counts for BOTH
 * classes, so a row written before the split keeps its exact behaviour.
 */
import { describe, it, expect } from 'vitest';
import {
  assessCost, approveCost, beginAssessment, costOf,
  directBudgetRefOf, indirectBudgetRefOf, budgetLineRefOf,
  additiveBudgetImpact, budgetImpact,
} from '../src/lib/changeCost';
import { budgetCategoriesByClass } from '../src/lib/costModel';

const row = { no: 'CO-01', status: 'approved' };

describe('Per-class budget links', () => {
  it('assessCost stores both refs and re-opens approval when either changes', () => {
    const a = assessCost(row, 100, 20, 'qa', undefined, undefined, 'Earthworks', 'Prelims');
    const c = costOf(a)!;
    expect(c.directBudgetRef).toBe('Earthworks');
    expect(c.indirectBudgetRef).toBe('Prelims');
    const approved = approveCost(a, 'qa');
    expect(costOf(approved)!.costApproval).toBe('approved');

    // Changing ONLY the indirect link re-opens approval — the link is part
    // of the assessment exactly as a figure is.
    const b = assessCost(approved, 100, 20, 'qa', undefined, undefined, 'Earthworks', 'Site Overhead');
    expect(costOf(b)!.costApproval).toBe('pending');

    // Same figures, same links → approval survives a re-save.
    const d = assessCost(b, 100, 20, 'qa', undefined, undefined, 'Earthworks', 'Site Overhead');
    expect(costOf(d)!.costApproval).toBe('pending');
  });

  it('a legacy single budgetLineRef counts for BOTH classes', () => {
    const legacy = assessCost(row, 80, 10, 'qa', undefined, 'Earthworks');
    expect(budgetLineRefOf(legacy)).toBe('Earthworks');
    expect(directBudgetRefOf(legacy)).toBe('Earthworks');
    expect(indirectBudgetRefOf(legacy)).toBe('Earthworks');
    // Fully linked by the legacy ref → nothing additive, old behaviour.
    expect(additiveBudgetImpact(legacy)).toEqual({ direct: 0, indirect: 0 });
  });

  it('additiveBudgetImpact recognizes each class independently', () => {
    const base = beginAssessment(row);
    // Direct linked, indirect unlinked: only the indirect half is added.
    const a = assessCost(base, 100, 20, 'qa', undefined, undefined, 'Earthworks', '');
    const approvedA = approveCost(a, 'qa');
    expect(costOf(approvedA)!.costApproval).toBe('approved');
    expect(additiveBudgetImpact(approvedA)).toEqual({ direct: 0, indirect: 20 });
    expect(budgetImpact(approvedA)).toEqual({ direct: 100, indirect: 20, total: 120 });

    // Indirect linked, direct unlinked: only the direct half is added.
    const b = assessCost(base, 100, 20, 'qa', undefined, undefined, '', 'Prelims');
    const approvedB = approveCost(b, 'qa');
    expect(costOf(approvedB)!.costApproval).toBe('approved');
    expect(additiveBudgetImpact(approvedB)).toEqual({ direct: 100, indirect: 0 });
  });

  it('budgetCategoriesByClass lists only the lines of that class', () => {
    const lines = [
      { category: 'Earthworks', costType: 'direct' },
      { category: 'Concrete',   costType: 'direct' },
      { category: 'Prelims',    costType: 'indirect' },
      { category: 'Unsorted' },                 // unclassified → in NEITHER
      { category: '', costType: 'direct' },     // nameless → ignored
    ];
    expect(budgetCategoriesByClass(lines, 'direct')).toEqual(['Earthworks', 'Concrete']);
    expect(budgetCategoriesByClass(lines, 'indirect')).toEqual(['Prelims']);
    expect(budgetCategoriesByClass('not-an-array' as any, 'direct')).toEqual([]);
  });
});
