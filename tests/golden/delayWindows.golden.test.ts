/**
 * GOLDEN MASTER — Delay windows (نوافذ التأخير الشهرية)
 * كل التواريخ ثابتة عمدًا — مفيش Date.now() هنا أبدًا.
 */
import { describe, it, expect } from 'vitest';
import {
  windowIdFor,
  windowClosesOn,
  windowLabel,
  monthRange,
  isWindowClosed,
  windowDelta,
} from '@/lib/delayWindows';

describe('Delay windows (golden)', () => {
  it('windowIdFor: معرّف النافذة من تاريخ', () => {
    expect(windowIdFor(new Date(2026, 7, 18))).toMatchSnapshot(); // أغسطس 2026
    expect(windowIdFor(new Date(2025, 0, 1))).toMatchSnapshot();  // يناير 2025
    expect(windowIdFor(new Date(2025, 11, 31))).toMatchSnapshot(); // ديسمبر 2025
  });

  it('windowClosesOn: تاريخ إغلاق النافذة', () => {
    expect(windowClosesOn('2026-08')).toMatchSnapshot();
    expect(windowClosesOn('2025-02')).toMatchSnapshot();
  });

  it('windowLabel: التسمية عربي/إنجليزي', () => {
    expect(windowLabel('2026-08', 'en')).toMatchSnapshot();
    expect(windowLabel('2026-08', 'ar')).toMatchSnapshot();
    expect(windowLabel('2025-12', 'en')).toMatchSnapshot();
  });

  it('monthRange: نطاق الشهور من-إلى', () => {
    expect(monthRange('2026-01', '2026-08')).toMatchSnapshot();
    expect(monthRange('2025-11', '2026-02')).toMatchSnapshot(); // عابرة للسنة
    expect(monthRange('2026-05', '2026-05')).toMatchSnapshot(); // نفس الشهر
  });

  it('isWindowClosed: هل النافذة مقفولة؟', () => {
    const now = new Date(2026, 7, 18); // 2026-08-18
    expect(isWindowClosed('2026-07', now)).toMatchSnapshot();
    expect(isWindowClosed('2026-08', now)).toMatchSnapshot();
    expect(isWindowClosed('2026-09', now)).toMatchSnapshot();
  });

  it('windowDelta: الفرق بين نافذتين', () => {
    const prev = { id: '2026-07', project: { totalDelay: 12, approvedEot: 5, unmitigatedDelay: 12 } } as any;
    const cur = { id: '2026-08', project: { totalDelay: 20, approvedEot: 8, unmitigatedDelay: 20 } } as any;
    expect(windowDelta(prev, cur)).toMatchSnapshot();
    expect(windowDelta(undefined, cur)).toMatchSnapshot();
  });
});
