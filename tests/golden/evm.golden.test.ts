/**
 * GOLDEN MASTER — EVM engine (computeBac / computeBacSplit)
 * القاعدة: الملف ده بيسجل سلوك المعادلات الحالي. أي ريفاكتور لازم يحافظ
 * على نفس الأرقام بالظبط — لو رقم واحد اتغير، الاختبار بيفشل.
 */
import { describe, it, expect } from 'vitest';
import {
  computeBac,
  computeBacSplit,
  readProgress,
  DEFAULT_SETTINGS,
  type ProjectLike,
  type EvmSettings,
} from '@/lib/evm';

const P = (over: Partial<ProjectLike> = {}): ProjectLike => ({
  id: 'proj-1',
  contractValue: 10_000_000,
  progress: 42.5,
  commencementDate: '2025-06-01',
  plannedDurationDays: 540,
  contractualCompletion: '2026-11-23',
  totalApprovedCOs: 750_000,
  totalApprovedClaims: 250_000,
  totalCashDisbursed: 4_100_000,
  ...over,
});

const S = (over: Partial<EvmSettings> = {}): EvmSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

describe('EVM — Budget at Completion (golden)', () => {
  it('computeBac: العقد الأساسي + COs + Claims معتمدة', () => {
    const r = computeBac(P(), S());
    expect(r).toMatchSnapshot();
  });

  it('computeBac: من غير أوامر تغيير ولا مطالبات', () => {
    const r = computeBac(P({ totalApprovedCOs: undefined, totalApprovedClaims: undefined }), S());
    expect(r).toMatchSnapshot();
  });

  it('computeBac: مشروع ناقص البيانات (دفاعي)', () => {
    const r = computeBac(P({ contractValue: undefined, progress: undefined }), S());
    expect(r).toMatchSnapshot();
  });

  it('computeBacSplit: توزيع الـ BAC على مكوناته', () => {
    expect(computeBacSplit(P(), S())).toMatchSnapshot();
    expect(computeBacSplit(P({ totalApprovedCOs: 0, totalApprovedClaims: 0 }), S())).toMatchSnapshot();
  });

  it('readProgress: قراءة نسبة التقدم (رقمي/نصي/فاضي)', () => {
    expect(readProgress(P())).toMatchSnapshot();
    expect(readProgress(P({ progress: undefined }))).toMatchSnapshot();
    expect(readProgress(P({ progress: 0 }))).toMatchSnapshot();
    expect(readProgress(P({ progress: 100 }))).toMatchSnapshot();
  });
});
