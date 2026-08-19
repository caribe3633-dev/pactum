/**
 * REGRESSION — EVM cumulative aggregation (إصلاحات معتمدة)
 * الثلاثة عيوب اللي اتصلحوا:
 *   1. الكروت كانت واقفة على آخر فترة معتمدة وتتجاهل الفترة الحية
 *   2. الفترة اللي فيها PV بس كانت مستبعدة من الأساس التراكمي
 *   3. الصفوف الصفرية كانت بتستعير SPI/CPI من فترات أقدم
 */
import { describe, it, expect } from 'vitest';
import {
  snapshot, cumulativeTo, periodMetrics, reportingPeriod,
  DEFAULT_SETTINGS, type EvmStore, type EvmPeriod, type ProjectLike,
} from '@/lib/evm';

const P: ProjectLike = {
  id: 'agg-1', contractValue: 1_000_000, progress: 30,
  commencementDate: '2026-01-01', plannedDurationDays: 365,
  contractualCompletion: '2026-12-31',
};

function period(n: number, pv: number, ev: number, ac: number, status: EvmPeriod['status'] = 'approved'): EvmPeriod {
  return {
    id: `p${n}`, seq: n, start: `2026-${String(n).padStart(2, '0')}-01`,
    end: `2026-${String(n).padStart(2, '0')}-28`, label: `M${n} 2026`,
    pv, ev, ac, pvSource: 'manual', evSource: 'manual', acSource: 'manual', status,
  } as EvmPeriod;
}

const store = (periods: EvmPeriod[]): EvmStore => ({ settings: DEFAULT_SETTINGS, periods });

describe('EVM aggregation — regression tests', () => {
  it('1️⃣ الفترة الحية اللي فيها بيانات هي اللي بتتعرض في الكروت', () => {
    const s = store([
      period(1, 100, 0, 0),
      period(2, 200, 50, 40),
      period(3, 300, 120, 100),
      period(4, 400, 180, 160, 'draft'),
    ]);
    const snap = snapshot(P, s, new Date('2026-04-15'));
    expect(snap.m.pv).toBe(400);
    expect(snap.m.ev).toBe(180);
    expect(snap.m.ac).toBe(160);
    expect(snap.period?.id).toBe('p4');
  });

  it('2️⃣ الفترة الحية الفاضية → بترجع لآخر معتمدة', () => {
    const s = store([
      period(1, 100, 10, 10, 'approved'),
      period(2, 200, 50, 40, 'approved'),
      period(3, 0, 0, 0, 'draft'),
    ]);
    const snap = snapshot(P, s, new Date('2026-03-15'));
    expect(snap.m.pv).toBe(200);
    expect(snap.m.ev).toBe(50);
    expect(snap.m.ac).toBe(40);
  });

  it('3️⃣ فترة PV-b فقط تدخل في الأساس التراكمي', () => {
    const s = store([
      period(1, 100, 0, 0, 'approved'),
      period(2, 250, 0, 0, 'draft'),
    ]);
    const cum = cumulativeTo(s.periods, s.periods[1]);
    expect(cum.pv).toBe(250);
    expect(cum.ev).toBe(0);
    expect(cum.ac).toBe(0);
  });

  it('4️⃣ الصف الصفري مبيستعيرش SPI/CPI من فترة أقدم', () => {
    const s = store([
      period(1, 100, 20, 20, 'approved'),
      period(2, 0, 0, 0, 'draft'),
      period(3, 300, 120, 100, 'approved'),
    ]);
    const pm2 = periodMetrics(s.periods[1], 1_000_000, 'cpi', cumulativeTo(s.periods, s.periods[1]));
    expect(pm2.pv).toBe(0);
    expect(pm2.spi).toBeNull();
    expect(pm2.cpi).toBeNull();
  });

  it('5️⃣ المؤشرات التراكمية من الإجماليات مش متوسطات', () => {
    const s = store([
      period(1, 100, 10, 10),
      period(2, 200, 50, 40),
      period(3, 300, 120, 100, 'draft'),
    ]);
    const rp = reportingPeriod(s.periods, new Date('2026-03-15'));
    expect(rp?.id).toBe('p3');
    const cum = cumulativeTo(s.periods, rp!);
    expect(cum.spiCum).toBeCloseTo(120 / 300, 10);
    expect(cum.cpiCum).toBeCloseTo(120 / 100, 10);
  });
});
