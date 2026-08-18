/**
 * GOLDEN MASTER — Cash flow dates (تواريخ التدفقات النقدية)
 */
import { describe, it, expect } from 'vitest';
import {
  lastDayOfMonth,
  windowOf,
  parseMonthLabel,
  normaliseIso,
  monthLabel,
  groupByWindow,
} from '@/lib/cashFlowDates';

describe('Cash flow dates (golden)', () => {
  it('lastDayOfMonth: آخر يوم في الشهر', () => {
    expect(lastDayOfMonth(2026, 2)).toMatchSnapshot(); // فبراير عادي
    expect(lastDayOfMonth(2028, 2)).toMatchSnapshot(); // فبراير كبيسة
    expect(lastDayOfMonth(2026, 12)).toMatchSnapshot();
  });

  it('windowOf: نافذة الشهر من تاريخ ISO', () => {
    expect(windowOf('2026-03-15')).toMatchSnapshot();
    expect(windowOf('2026-12-31')).toMatchSnapshot();
    expect(windowOf('bogus')).toMatchSnapshot();
  });

  it('parseMonthLabel: تحليل تسميات الشهور', () => {
    expect(parseMonthLabel('Mar 2026')).toMatchSnapshot();
    expect(parseMonthLabel('يناير 2026')).toMatchSnapshot();
    expect(parseMonthLabel('12/2025')).toMatchSnapshot();
    expect(parseMonthLabel('nonsense', 2026)).toMatchSnapshot();
  });

  it('normaliseIso: تطبيع التواريخ المدخلة', () => {
    expect(normaliseIso('2026-3-5')).toMatchSnapshot();
    expect(normaliseIso('2026-03-15T10:00:00Z')).toMatchSnapshot();
    expect(normaliseIso(null)).toMatchSnapshot();
    expect(normaliseIso(42)).toMatchSnapshot();
  });

  it('monthLabel + groupByWindow: تجميع الصفوف بالنافذة', () => {
    expect(monthLabel('2026-04')).toMatchSnapshot();
    const rows = [
      { month: '2026-03-10', in: 100 },
      { month: '2026-03-25', in: 50 },
      { month: '2026-04-02', in: 200 },
      { month: '', in: 10 },
    ];
    expect(groupByWindow(rows)).toMatchSnapshot();
  });
});
