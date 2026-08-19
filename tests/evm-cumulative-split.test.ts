/**
 * REGRESSION — النموذج التراكمي الصحيح (v3)
 * المكونات = قيمة الفترة نفسها | الإجماليات = تراكمية (مجموع جاري)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readEvm, writeEvm, setClassValue, classMetrics,
  DEFAULT_SETTINGS, type EvmStore, type EvmPeriod, type ProjectLike, type BacSplit,
} from '@/lib/evm';

const PID = 'cum-split-1';
const P: ProjectLike = {
  id: PID, contractValue: 1_000_000, progress: 30,
  commencementDate: '2026-01-01', plannedDurationDays: 365,
  contractualCompletion: '2026-12-31',
};

function per(n: number, dPv: number, iPv: number, typedTotal = 999_999): EvmPeriod {
  return {
    id: `p${n}`, seq: n, start: `2026-${String(n).padStart(2, '0')}-01`,
    end: `2026-${String(n).padStart(2, '0')}-28`, label: `M${n} 2026`,
    pv: typedTotal, ev: 0, ac: 0,                    // الإجمالي المكتوب قديمًا — لازم يتتجاوز
    directPv: dPv, indirectPv: iPv,
    pvSource: 'manual', evSource: 'auto', acSource: 'auto',
    status: 'draft',
  } as EvmPeriod;
}

const store = (periods: EvmPeriod[]): EvmStore => ({ settings: DEFAULT_SETTINGS, periods });
const bac = { available: true, directBac: 600_000, indirectBac: 400_000, totalBac: 1_000_000, packageVersion: 1 } as BacSplit;

describe('EVM cumulative split — regression tests (v3)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('pactum-projects', JSON.stringify([P]));
  });

  it('1️⃣ الإجمالي تراكمي: كل فترة مجموع جاري لمكونات كل الفترات لحدها', () => {
    writeEvm(PID, store([per(1, 100, 20), per(2, 80, 10), per(3, 60, 5)]));
    const s = readEvm(PID);
    expect(s.periods[0].pv).toBe(120);   // 100+20
    expect(s.periods[1].pv).toBe(210);   // 120+80+10
    expect(s.periods[2].pv).toBe(275);   // 210+60+5
  });

  it('2️⃣ تعديل مكون في فترة قديمة بيعيد حساب كل اللي بعدها', () => {
    const s = store([per(1, 100, 20), per(2, 80, 10)]);
    const next = setClassValue(s, 'p1', 'directPv', 150);
    expect(next.periods[0].pv).toBe(170);  // 150+20
    expect(next.periods[1].pv).toBe(260);  // 170+80+10
  });

  it('3️⃣ جدول Cost Class تراكمي زي اللوحة', () => {
    const periods = [per(1, 100, 20), per(2, 80, 10)];
    const cm = classMetrics(periods, periods[1], bac, 'cpi');
    expect(cm.direct.pv).toBe(180);       // 100+80
    expect(cm.indirect.pv).toBe(30);      // 20+10
    expect(cm.total.pv).toBe(210);        // 180+30 = نفس الإجمالي التراكمي
    // Total CPI من المجاميع مش متوسطات
    expect(cm.total.cpi).toBeNull();      // AC صفر → CPI=null بصدق
  });

  it('4️⃣ فترة مكتوبة قبل بدء التقسيم بتفضل أساس مجاميع التراكمي', () => {
    const pre: EvmPeriod = {
      id: 'p0', seq: 0, start: '2025-12-01', end: '2025-12-31', label: 'M0 2025',
      pv: 50, ev: 0, ac: 0, pvSource: 'manual', evSource: 'auto', acSource: 'auto', status: 'approved',
    } as EvmPeriod;
    writeEvm(PID, store([pre, per(1, 100, 20)]));
    const s = readEvm(PID);
    expect(s.periods[0].pv).toBe(50);     // قبل التقسيم — زي ما هي
    expect(s.periods[1].pv).toBe(170);    // 50 + (100+20)
  });

  it('5️⃣ زيادة EV غير المباشرة بتتوزن تراكميًا كمان', () => {
    const p1 = { ...per(1, 100, 20), directEv: 40, indirectEv: 10 } as EvmPeriod;
    const p2 = { ...per(2, 80, 10), directEv: 30, indirectEv: 8 } as EvmPeriod;
    writeEvm(PID, store([p1, p2]));
    const s = readEvm(PID);
    expect(s.periods[0].ev).toBe(50);     // 40+10
    expect(s.periods[1].ev).toBe(88);     // 50+30+8
  });
});

describe('applyIndirectEv — v3 fix: per-month increments, no double counting', () => {
  const PID2 = 'cum-indirect-1';
  const P2: ProjectLike = {
    id: PID2, contractValue: 1_000_000, progress: 30,
    commencementDate: '2026-01-01', plannedDurationDays: 365,
    contractualCompletion: '2026-12-31',
  };

  function per(n: number): EvmPeriod {
    return {
      id: `q${n}`, seq: n, start: `2026-${String(n).padStart(2, '0')}-01`,
      end: `2026-${String(n).padStart(2, '0')}-28`, label: `M${n} 2026`,
      pv: 0, ev: 0, ac: 0, pvSource: 'manual', evSource: 'auto', acSource: 'auto',
      status: 'draft',
    } as EvmPeriod;
  }

  it('6️⃣ القيم المخزنة زيادات شهرية — مجموعها = المنحنى التراكمي بالظبط', async () => {
    const { applyIndirectEv } = await import('@/lib/evm');
    const BAC_IND = 400_000;
    let st: any = { settings: DEFAULT_SETTINGS, periods: [per(1), per(2), per(3)] };
    // نسب تراكمية زي ما timePlannedPercent بيرجعها: 10% ثم 25% ثم 40%
    st = applyIndirectEv(st, 'q1', 0.10, BAC_IND);
    st = applyIndirectEv(st, 'q2', 0.25, BAC_IND);
    st = applyIndirectEv(st, 'q3', 0.40, BAC_IND);
    expect(st.periods[0].indirectEv).toBe(40_000);       // 10% × 400K
    expect(st.periods[1].indirectEv).toBeCloseTo(60_000, 6);
    expect(st.periods[2].indirectEv).toBeCloseTo(60_000, 6);
    // المجموع التراكمي = 40% × 400K = 160K (مش 40+100+160=300K زي الغلطة القديمة)
    const total = st.periods.reduce((a: number, p: any) => a + (p.indirectEv ?? 0), 0);
    expect(total).toBeCloseTo(160_000, 6);
  });

  it('7️⃣ EOT بيمدد المدة → الفرق السالب بيتقص بصفر (مفيش استرجاع شهور فاتت)', async () => {
    const { applyIndirectEv } = await import('@/lib/evm');
    let st: any = { settings: DEFAULT_SETTINGS, periods: [per(1), per(2)] };
    st = applyIndirectEv(st, 'q1', 0.30, 400_000);
    st = applyIndirectEv(st, 'q2', 0.20, 400_000); // النسبة التراكمية نزلت بعد التمديد
    expect(st.periods[0].indirectEv).toBe(120_000);
    expect(st.periods[1].indirectEv).toBe(0); // max(0, 20% − 30%) = 0
  });

  it('8️⃣ الإجمالي التراكمي للفترة من مجموع الزيادات (اتساق كامل مع deriveClassTotals)', async () => {
    const { applyIndirectEv, readEvm, writeEvm } = await import('@/lib/evm');
    localStorage.clear();
    localStorage.setItem('pactum-projects', JSON.stringify([P2]));
    let st: any = { settings: DEFAULT_SETTINGS, periods: [per(1), per(2)] };
    st = applyIndirectEv(st, 'q1', 0.10, 400_000);
    st = applyIndirectEv(st, 'q2', 0.30, 400_000);
    writeEvm(PID2, st);
    const s = readEvm(PID2);
    expect(s.periods[0].ev).toBe(40_000);
    expect(s.periods[1].ev).toBe(120_000); // 40K + 80K = 30% × 400K ✓
  });
});
