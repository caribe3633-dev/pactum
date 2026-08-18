/**
 * GOLDEN MASTER — Cost assessment rows (تكلفة أوامر التغيير/المطالبات)
 */
import { describe, it, expect } from 'vitest';
import {
  costState,
  costOf,
  isBaselineEligible,
  isLegacy,
  approvalStatusLabel,
  assessmentStatusLabel,
} from '@/lib/changeCost';

describe('Cost bearing rows (golden)', () => {
  it('costState: زوج الحالة (تقييم + اعتماد)', () => {
    expect(costState({ status: 'approved', cost: { amount: 5000, assessment: 'approved' } } as any)).toMatchSnapshot();
    expect(costState({ status: 'submitted', cost: undefined } as any)).toMatchSnapshot();
    expect(costState({} as any)).toMatchSnapshot();
  });

  it('costOf: قراءة كتلة التكلفة دفاعيًا', () => {
    expect(costOf({ cost: { amount: 100, status: 'pending' } } as any)).toMatchSnapshot();
    expect(costOf({ cost: null } as any)).toMatchSnapshot();
    expect(costOf({} as any)).toMatchSnapshot();
  });

  it('isBaselineEligible / isLegacy', () => {
    expect(isBaselineEligible({ cost: { amount: 10, approval: 'approved' } } as any)).toMatchSnapshot();
    expect(isBaselineEligible({} as any)).toMatchSnapshot();
    expect(isLegacy({ legacy: true, cost: 500 } as any)).toMatchSnapshot();
    expect(isLegacy({ cost: { amount: 1 } } as any)).toMatchSnapshot();
  });

  it('labels: تسميات الحالة عربي/إنجليزي', () => {
    expect(approvalStatusLabel('approved' as any, 'en')).toMatchSnapshot();
    expect(approvalStatusLabel('approved' as any, 'ar')).toMatchSnapshot();
    expect(assessmentStatusLabel('pending' as any, 'en')).toMatchSnapshot();
    expect(assessmentStatusLabel('pending' as any, 'ar')).toMatchSnapshot();
  });
});
