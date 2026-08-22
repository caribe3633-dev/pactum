import { describe, it, expect } from 'vitest';
import { cashSeries, cashCumulativeTable, cashNetTable } from '../src/lib/cashFlowMoney';

// ══════════════════════════════════════════════════════════════════════
// CASH FLOW — CUMULATIVE VIEW, DERIVED FROM PERIOD ENTRY.
//
// The standing rule of the platform, applied to cash: entry stays
// PERIOD BY PERIOD, and every cumulative figure is a pure function of
// those rows. Nothing cumulative is ever typed, so it can never
// disagree with the ledger it summarizes.
// ══════════════════════════════════════════════════════════════════════

/** Four periods, in chronological order — the caller owns the order. */
const rows = [
  { month: '2025-01', in: 100, out: 40, plannedIn: 120, plannedOut: 30 },
  { month: '2025-02', in: 80,  out: 60, plannedIn: 90,  plannedOut: 50 },
  { month: '2025-03', in: 0,   out: 20 },                          // NO plan stated
  { month: '2025-04', in: 200, out: 60, plannedIn: 150, plannedOut: 40 },
];

describe('cashCumulativeTable — the running position', () => {
  it('accumulates actual in / out / net in order', () => {
    const t = cashCumulativeTable(rows);
    expect(t.map(r => r.cumIn)).toEqual([100, 180, 180, 380]);
    expect(t.map(r => r.cumOut)).toEqual([40, 100, 120, 180]);
    expect(t.map(r => r.cumNet)).toEqual([60, 80, 60, 200]);
  });

  it('accumulates the planned columns and HOLDS FLAT across an unplanned period', () => {
    const t = cashCumulativeTable(rows);
    expect(t.map(r => r.cumPlannedIn)).toEqual([120, 210, 210, 360]);
    expect(t.map(r => r.cumPlannedOut)).toEqual([30, 80, 80, 120]);
    expect(t.map(r => r.cumPlannedNet)).toEqual([90, 130, 130, 240]);
    expect(t.map(r => r.planned)).toEqual([true, true, false, true]);
  });

  it('variance = cumulative actual net − cumulative planned net, per period', () => {
    const t = cashCumulativeTable(rows);
    expect(t.map(r => r.variance)).toEqual([-30, -50, -70, -40]);
  });

  it('the closing row is the plain totals of the ledger', () => {
    const last = cashCumulativeTable(rows).slice(-1)[0];
    expect(last.cumIn).toBe(100 + 80 + 0 + 200);
    expect(last.cumOut).toBe(40 + 60 + 20 + 60);
    expect(last.cumNet).toBe(last.cumIn - last.cumOut);
    expect(last.variance).toBe(last.cumNet - last.cumPlannedNet);
  });

  it('NEVER trusts the legacy stored cumNet — it was entry-order', () => {
    const poisoned = rows.map(r => ({ ...r, cumNet: 999 }));
    const t = cashCumulativeTable(poisoned);
    expect(t.map(r => r.cumNet)).toEqual([60, 80, 60, 200]);
  });

  it('derives without mutating the input rows', () => {
    const before = JSON.stringify(rows);
    cashCumulativeTable(rows);
    cashSeries(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('empty and malformed input answer empty, not a crash', () => {
    expect(cashCumulativeTable([])).toEqual([]);
    expect(cashCumulativeTable(undefined as any)).toEqual([]);
    expect(cashSeries([])).toEqual([]);
  });
});

describe('cashNetTable — the balance story', () => {
  it('planned net, actual net and variance, per period', () => {
    const t = cashNetTable([
      { month: '2025-01', in: 120, out: 30, plannedIn: 150, plannedOut: 30 },
      { month: '2025-02', in: 80,  out: 60 },                       // no plan stated
    ]);
    expect(t[0].plannedNet).toBe(120);          // 150 − 30
    expect(t[0].net).toBe(90);                  // 120 − 30
    expect(t[0].variance).toBe(-30);            // 90 − 120
    expect(t[1].plannedNet).toBeNull();
    expect(t[1].variance).toBeNull();
    expect(t[1].net).toBe(20);
    expect(t[1].planned).toBe(false);
  });

  it('a negative actual month is a fact, not an error', () => {
    const t = cashNetTable([{ month: '2025-03', in: 10, out: 90, plannedIn: 50, plannedOut: 20 }]);
    expect(t[0].net).toBe(-80);
    expect(t[0].variance).toBe(-110);
  });

  it('empty and malformed input answer empty; the input is never mutated', () => {
    expect(cashNetTable([])).toEqual([]);
    expect(cashNetTable(undefined as any)).toEqual([]);
    const rows = [{ month: '2025-01', in: 100, out: 40 }];
    const before = JSON.stringify(rows);
    cashNetTable(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('cashSeries — cumulative S-curve family', () => {
  it('carries the same running sums as the table (one story, two views)', () => {
    const s = cashSeries(rows);
    const t = cashCumulativeTable(rows);
    expect(s.map(p => p.cumIn)).toEqual(t.map(r => r.cumIn));
    expect(s.map(p => p.cumOut)).toEqual(t.map(r => r.cumOut));
    expect(s.map(p => p.cumNet)).toEqual(t.map(r => r.cumNet));
    expect(s.map(p => p.cumPlannedIn)).toEqual(t.map(r => r.cumPlannedIn));
    expect(s.map(p => p.cumPlannedOut)).toEqual(t.map(r => r.cumPlannedOut));
    expect(s.map(p => p.cumPlanned)).toEqual(t.map(r => r.cumPlannedNet));
  });

  it('per-period planned values stay NULL on an unplanned period', () => {
    const s = cashSeries(rows);
    expect(s[2].plannedIn).toBeNull();
    expect(s[2].plannedOut).toBeNull();
    expect(s[2].planned).toBe(false);
    // while the stated periods still carry theirs
    expect(s[0].plannedIn).toBe(120);
  });
});
