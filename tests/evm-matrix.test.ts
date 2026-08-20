import { describe, it, expect } from 'vitest';
import {
  INDEX_TOLERANCE, withinTolerance, bubbleZ, MAX_BUBBLE_RATIO, matrixDomain,
  metricsFor, quadrantOf, cumulativeTo,
} from '../src/lib/evm';

// ══════════════════════════════════════════════════════════════════════
// STEP 20 — PROJECT PERFORMANCE MATRIX, COMMERCIAL GRADE.
// Six upgrades: tolerance band, money-scaled bubbles, TCPI on the board,
// adaptive axes, a trend projection and delay-days. The pure halves live
// in lib/evm.ts; this file pins them so the chart can never drift.
// ══════════════════════════════════════════════════════════════════════

describe('withinTolerance — the ±5% on-target band', () => {
  it('both indices inside the band are ON TARGET', () => {
    expect(withinTolerance(0.96, 1.04)).toBe(true);
    expect(withinTolerance(1.0, 0.95)).toBe(true);
    expect(withinTolerance(1.05, 0.95)).toBe(true);
  });

  it('a real breach on either axis is not on target', () => {
    expect(withinTolerance(0.94, 1.2)).toBe(false);
    expect(withinTolerance(1.2, 0.94)).toBe(false);
  });

  it('missing indices never claim on target', () => {
    expect(withinTolerance(null, 1.0)).toBe(false);
    expect(withinTolerance(1.0, null)).toBe(false);
    expect(withinTolerance(null, null)).toBe(false);
  });

  it('tolerance is the commercial ±5%', () => {
    expect(INDEX_TOLERANCE).toBe(0.05);
  });
});

describe('quadrantOf — the split stays at 1.00 (the band is not a fifth quadrant)', () => {
  it('0.99 is geometrically behind, even though it is on target', () => {
    // The dot sits where it sits; withinTolerance governs the ALARM,
    // not the geometry. Both must stay honest.
    expect(quadrantOf(0.99, 1.05).key).toBe('behind-under');
    expect(withinTolerance(0.99, 1.05)).toBe(true);
  });

  it('the four quadrants keep their boundaries', () => {
    expect(quadrantOf(1.1, 1.1).key).toBe('ahead-under');
    expect(quadrantOf(0.9, 1.1).key).toBe('behind-under');
    expect(quadrantOf(1.1, 0.9).key).toBe('ahead-over');
    expect(quadrantOf(0.9, 0.9).key).toBe('behind-over');
    expect(quadrantOf(null, 1).key).toBe('unknown');
  });
});

describe('bubbleZ — bubble size is money at stake', () => {
  it('no forecast collapses to the minimum bubble', () => {
    expect(bubbleZ(null, 500_000)).toBe(80);
    expect(bubbleZ(50_000, null)).toBe(80);
    expect(bubbleZ(50_000, 0)).toBe(80);
  });

  it('grows with |VAC| relative to EAC', () => {
    // Same 2M variance: a footnote on a 200M job, the whole story on 10M.
    const footnote = bubbleZ(2_000_000, 200_000_000);
    const wholeStory = bubbleZ(2_000_000, 10_000_000);
    expect(wholeStory).toBeGreaterThan(footnote);
    expect(footnote).toBeGreaterThan(bubbleZ(10_000, 200_000_000));
  });

  it('clamps at MAX_BUBBLE_RATIO so one wild period cannot swallow the chart', () => {
    expect(bubbleZ(1_000_000, 1_000_000)).toBe(320);
    expect(bubbleZ(250_000, 1_000_000)).toBe(320);
    expect(MAX_BUBBLE_RATIO).toBe(0.25);
  });

  it('always stays inside [min, max]', () => {
    for (const vac of [0, 1, 5_000, 900_000]) {
      const z = bubbleZ(vac, 900_000, 100, 300);
      expect(z).toBeGreaterThanOrEqual(100);
      expect(z).toBeLessThanOrEqual(300);
    }
  });
});

describe('matrixDomain — axes follow the data', () => {
  it('default window shows the full tolerance band around 1.00', () => {
    const d = matrixDomain([1], [1]);
    expect(d.x[0]).toBeLessThanOrEqual(1 - INDEX_TOLERANCE);
    expect(d.x[1]).toBeGreaterThanOrEqual(1 + INDEX_TOLERANCE);
    expect(d.y[0]).toBeLessThanOrEqual(1 - INDEX_TOLERANCE);
    expect(d.y[1]).toBeGreaterThanOrEqual(1 + INDEX_TOLERANCE);
    expect(d.xTicks).toHaveLength(5);
    expect(d.yTicks).toHaveLength(5);
  });

  it('expands beyond the old 1.4 ceiling — a CPI of 1.8 deserves a dot', () => {
    const d = matrixDomain([1], [1.8]);
    expect(d.y[1]).toBeGreaterThanOrEqual(1.8);
  });

  it('expands below the old 0.6 floor', () => {
    const d = matrixDomain([0.45], [1]);
    expect(d.x[0]).toBeLessThanOrEqual(0.45);
  });

  it('ticks are ascending and land on the domain ends', () => {
    const d = matrixDomain([0.5, 1.9], [0.8, 1.2]);
    expect(d.xTicks[0]).toBeCloseTo(d.x[0], 2);
    expect(d.xTicks[4]).toBeCloseTo(d.x[1], 2);
    expect(d.xTicks).toEqual([...d.xTicks].sort((a, b) => a - b));
    expect(d.yTicks).toEqual([...d.yTicks].sort((a, b) => a - b));
  });

  it('nulls are simply ignored, they do not shrink the window', () => {
    const d = matrixDomain([null, 1.6, null], [null, null]);
    expect(d.x[1]).toBeGreaterThanOrEqual(1.6);
    expect(d.y[0]).toBeLessThanOrEqual(0.7);
    expect(d.y[1]).toBeGreaterThanOrEqual(1.3);
  });
});

describe('TCPI — verified against the PMI formula (BAC − EV) ÷ (BAC − AC)', () => {
  it('computes the efficiency required on the remaining work', () => {
    const m = metricsFor(400, 300, 250, 1000);
    // (1000 − 300) ÷ (1000 − 250) = 700 ÷ 750
    expect(m.tcpi).toBeCloseTo(700 / 750, 6);
  });

  it('is null when no budget remains to perform', () => {
    expect(metricsFor(0, 0, 0, 0).tcpi).toBeNull();
  });

  it('an overrun project needs TCPI above 1 — better than it has ever performed', () => {
    const m = metricsFor(500, 400, 500, 1000); // CPI 0.8
    expect(m.tcpi!).toBeGreaterThan(1);
    expect(m.tcpi!).toBeGreaterThan(m.cpi!);
  });

  it('the trend projection uses period-on-period increments, not cumulative', () => {
    const cum = cumulativeTo([
      { id: 'm1', label: 'P1', seq: 1, start: '', end: '', cadence: 'monthly',
        status: 'approved', pv: 100, ev: 90, ac: 100, acSource: 'manual' },
      { id: 'm2', label: 'P2', seq: 2, start: '', end: '', cadence: 'monthly',
        status: 'approved', pv: 200, ev: 170, ac: 200, acSource: 'manual' },
    ] as any, { id: 'm2' } as any);
    // Increments: dEv 90+80, dPv 100+100, dAc 100+100.
    expect(cum.spi3).toBeCloseTo(170 / 200, 6);
    expect(cum.cpi3).toBeCloseTo(170 / 200, 6);
  });
});
