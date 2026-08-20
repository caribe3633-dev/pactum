import { describe, it, expect } from 'vitest';
import { periodIncrements, classCumulative, type EvmPeriod } from '../src/lib/evm';

// ══════════════════════════════════════════════════════════════════════
// PERIOD VIEW vs CUMULATIVE VIEW (owner rule).
//
// The Periods tab shows what each period ADDS — never the running total.
// A split row answers from Direct + Indirect; a legacy row answers as
// the difference between consecutive cumulative values. The Cumulative
// tab runs the sums, per class or in total.
// ══════════════════════════════════════════════════════════════════════

const m = (n: number, over: Partial<EvmPeriod> = {}): EvmPeriod => ({
  id: `m${n}`, label: `M${n}`, seq: n,
  start: `2026-0${n}-01`, end: `2026-0${n}-28`,
  cadence: 'monthly', status: 'draft',
  pv: 100 * n, ev: 0, ac: 0, acSource: 'manual',
  ...over,
} as EvmPeriod);

describe('periodIncrements — the Periods table shows ADDS, not totals', () => {
  it('a split row answers from Direct + Indirect, ignoring the cumulative fields', () => {
    const incs = periodIncrements([
      m(1, { directPv: 100, indirectPv: 20, directEv: 60, indirectEv: 10, directAc: 50,
             pv: 120, ev: 70, ac: 50 }),          // cumulative fields say 120/70/50
      m(2, { directPv: 90, indirectPv: 20, directEv: 40 }),
    ]);
    expect(incs.get('m1')).toEqual({ id: 'm1', pv: 120, ev: 70, ac: 50 });
    expect(incs.get('m2')).toEqual({ id: 'm2', pv: 110, ev: 40, ac: 0 });
  });

  it('a legacy no-split row answers as the difference between cumulative rows', () => {
    const incs = periodIncrements([
      m(1, { pv: 100, ev: 40, ac: 30 }),
      m(2, { pv: 250, ev: 90, ac: 60 }),
      m(3, { pv: 300, ev: 90, ac: 60 }),           // a nothing-happened month
    ]);
    expect(incs.get('m1')!.pv).toBe(100);
    expect(incs.get('m2')!.ev).toBe(50);
    expect(incs.get('m3')).toEqual({ id: 'm3', pv: 50, ev: 0, ac: 0 });
  });

  it('Σ increments of legacy rows equals the final cumulative', () => {
    const periods = [m(1, { pv: 100, ev: 40 }), m(2, { pv: 250, ev: 90 }), m(3, { pv: 400, ev: 160 })];
    const incs = periodIncrements(periods);
    const sumEv = periods.reduce((a, p) => a + (incs.get(p.id)?.ev ?? 0), 0);
    expect(sumEv).toBe(160);
  });
});

describe('classCumulative — the Cumulative tab per class', () => {
  it('running sums of one class, oldest → newest; pre-split rows add zero', () => {
    const rows = classCumulative([
      m(1, { pv: 100, ev: 40 }),                                   // no split
      m(2, { directPv: 100, directEv: 60, directAc: 50 }),
      m(3, { directPv: 90, directEv: 40 }),
    ], 'direct');
    expect(rows.map(r => r.pv)).toEqual([0, 100, 190]);
    expect(rows.map(r => r.ev)).toEqual([0, 60, 100]);
    expect(rows.map(r => r.ac)).toEqual([0, 50, 50]);
    expect(rows[0].label).toBe('M1');
  });

  it('the last row is the class total', () => {
    const rows = classCumulative([
      m(1, { indirectPv: 30, indirectEv: 8 }),
      m(2, { indirectPv: 30, indirectEv: 8 }),
    ], 'indirect');
    const last = rows[rows.length - 1];
    expect(last.pv).toBe(60);
    expect(last.ev).toBe(16);
  });
});
