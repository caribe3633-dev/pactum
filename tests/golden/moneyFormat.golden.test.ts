/**
 * GOLDEN MASTER — Money formatting (تنسيق العملات)
 */
import { describe, it, expect } from 'vitest';
import { abbrevMoney, kpiMoney, exactMoney, moneyCell } from '@/lib/moneyFormat';

describe('Money formatting (golden)', () => {
  it('abbrevMoney: الاختصار (K/M/B)', () => {
    expect(abbrevMoney(0)).toMatchSnapshot();
    expect(abbrevMoney(950)).toMatchSnapshot();
    expect(abbrevMoney(1_250_000)).toMatchSnapshot();
    expect(abbrevMoney(3_400_000_000)).toMatchSnapshot();
    expect(abbrevMoney(-2_750_000)).toMatchSnapshot();
    expect(abbrevMoney('not-a-number')).toMatchSnapshot();
  });

  it('kpiMoney: أرقام الـ KPI بعملات مختلفة', () => {
    expect(kpiMoney(10_500_000, 'SAR')).toMatchSnapshot();
    expect(kpiMoney(987_654.321, 'USD')).toMatchSnapshot();
    expect(kpiMoney(-45_000, 'EGP')).toMatchSnapshot();
    expect(kpiMoney(undefined, 'SAR')).toMatchSnapshot();
  });

  it('exactMoney: القيمة الدقيقة', () => {
    expect(exactMoney(1_234_567.891, 'SAR')).toMatchSnapshot();
    expect(exactMoney(0.5, 'USD')).toMatchSnapshot();
  });

  it('moneyCell: خلية الجدول (نص + عنوان)', () => {
    expect(moneyCell(5_600_000)).toMatchSnapshot();
    expect(moneyCell(5_600_000, 'USD')).toMatchSnapshot();
    expect(moneyCell(null)).toMatchSnapshot();
  });
});
