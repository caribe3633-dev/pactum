/**
 * REGRESSION — Cost-class split invariant (إصلاح العنصر السابع)
 * الثلاث قواعد:
 *   1. الإجمالي مش بيتكتب يدوي فوق تقسيم موجود (setValue يترفض)
 *   2. أي بيانات قديمة منحرفة بتتصلح عند القراءة (المكونات هي المرجع)
 *   3. اللوحة والجدول لازم يتفقوا دايمًا: m.pv = direct + indirect
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readEvm, writeEvm, setValue, setClassValue, snapshot,
  DEFAULT_SETTINGS, type EvmStore, type EvmPeriod, type ProjectLike,
} from '@/lib/evm';

const PID = 'split-fix-1';

const P: ProjectLike = {
  id: PID, contractValue: 1_000_000, progress: 30,
  commencementDate: '2026-01-01', plannedDurationDays: 365,
  contractualCompletion: '2026-12-31',
};

function period(): EvmPeriod {
  return {
    id: 'p1', seq: 1, start: '2026-01-01', end: '2026-01-31', label: 'M1 2026',
    // الحالة المنحرفة: الإجمالي المكتوب 340 والمكونات مجموعها 180
    pv: 340_000, ev: 200_000, ac: 150_000,
    directPv: 100_000, indirectPv: 80_000,
    directEv: 90_000, indirectEv: 30_000,
    directAc: 100_000, indirectAc: 50_000,
    pvSource: 'manual', evSource: 'manual', acSource: 'manual',
    status: 'draft',
  } as EvmPeriod;
}

const store = (periods: EvmPeriod[]): EvmStore => ({ settings: DEFAULT_SETTINGS, periods });

describe('Cost-class split invariant — regression tests', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('pactum-projects', JSON.stringify([P]));
  });

  it('1️⃣ البيانات المنحرفة تتصلح عند القراءة: pv = direct + indirect', () => {
    writeEvm(PID, store([period()]));
    const s = readEvm(PID);
    expect(s.periods[0].pv).toBe(180_000);
    expect(s.periods[0].ev).toBe(120_000);
    expect(s.periods[0].ac).toBe(150_000); // ac components 100k+50k = 150k ✓
  });

  it('2️⃣ setValue يترفض كتابة الإجمالي فوق تقسيم موجود', () => {
    const s = store([period()]);
    const next = setValue(s, 'p1', 'pv', 999_999);
    // الرفض معناه نفس الستور (الإجمالي بيتصلح من المكونات فقط)
    expect(next.periods[0].directPv).toBe(100_000);
    expect(next.periods[0].indirectPv).toBe(80_000);
  });

  it('3️⃣ setValue شغال عادي لما مفيش تقسيم', () => {
    const p = { ...period() };
    delete (p as any).directPv; delete (p as any).indirectPv;
    delete (p as any).directEv; delete (p as any).indirectEv;
    delete (p as any).directAc; delete (p as any).indirectAc;
    const next = setValue(store([p]), 'p1', 'pv', 400_000);
    // v3: totals are never typed — refused even without a split
    expect(next.periods[0].pv).toBe(340_000);
    expect((next.periods[0] as any).directPv).toBeUndefined();
  });

  it('4️⃣ setClassValue بيعيد حساب الإجمالي من المكونات', () => {
    const next = setClassValue(store([period()]), 'p1', 'directPv', 150_000);
    expect(next.periods[0].pv).toBe(230_000); // 150k + 80k
  });

  it('5️⃣ اللوحة بتقرا نفس أرقام المكونات بعد الإصلاح', () => {
    writeEvm(PID, store([period()]));
    const s = readEvm(PID);
    const snap = snapshot(P, s, new Date('2026-01-15'));
    expect(snap.m.pv).toBe(180_000);
    expect(snap.m.ev).toBe(120_000);
    expect(snap.m.ac).toBe(150_000);
  });

  it('6️⃣ الفترات المعتمدة/المجمدة بتتصلح هي كمان (بما فيها السجل الموقّع)', () => {
    const approved = {
      ...period(),
      id: 'p1f', status: 'approved' as const,
      frozen: {
        pv: 340_000, ev: 200_000, ac: 150_000, bac: 1_000_000,
        spi: 200_000 / 340_000, cpi: 200_000 / 150_000,
        sv: 200_000 - 340_000, cv: 200_000 - 150_000,
        eac: 1_000_000 / (200_000 / 150_000), etc: 0, vac: 0, tcpi: null,
        eacMethod: 'cpi' as const, frozenAt: '2026-02-01T00:00:00.000Z', baselineId: 'b1',
      },
    } as EvmPeriod;
    writeEvm(PID, store([approved]));
    const s = readEvm(PID);
    const p = s.periods[0];
    expect(p.pv).toBe(180_000);           // الإجمالي اتصلح
    expect(p.frozen?.pv).toBe(180_000);   // والسجل الموقّع اتزامن
    expect(p.frozen?.ev).toBe(120_000);
    expect(p.frozen?.cpi).toBeCloseTo(120_000 / 150_000, 6);
    expect(p.frozen?.frozenAt).toBe('2026-02-01T00:00:00.000Z'); // الأثر الرقابي محفوظ
  });
});


describe('applyPvColumn - paste writes components not totals', () => {
  it("9: cumulative column becomes monthly increments in Direct PV and the total derives", async () => {
    const { applyPvColumn } = await import('@/lib/evm');
    const p1: any = { id: 'a1', seq: 1, start: '2026-01-01', end: '2026-01-31', label: 'M1', pv: 0, ev: 0, ac: 0, status: 'draft' };
    const p2: any = { id: 'a2', seq: 2, start: '2026-02-01', end: '2026-02-28', label: 'M2', pv: 0, ev: 0, ac: 0, status: 'draft' };
    const st: any = { settings: DEFAULT_SETTINGS, periods: [p1, p2] };
    const res = applyPvColumn(st, [100, 250]);
    expect(res.applied).toBe(2);
    expect(res.store.periods[0].directPv).toBe(100);
    expect(res.store.periods[1].directPv).toBe(150);
    expect(res.store.periods[0].pv).toBe(100);
    expect(res.store.periods[1].pv).toBe(250);
    expect(res.store.periods[1].pvSource).toBe('manual');
  });
});
