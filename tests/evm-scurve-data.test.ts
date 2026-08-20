import { describe, it, expect } from 'vitest';
import { series, reportingPeriod, hasActuals, type EvmPeriod } from '../src/lib/evm';

// ══════════════════════════════════════════════════════════════════════
// TIME IS NOT PERFORMANCE — the S-curve data rule (Step 18 fallout).
//
// Since every period, future ones included, carries its time-derived
// indirect EV slice, `ev > 0` stopped meaning "this month was worked".
// The chart drew future months as earned, sent AC diving to zero, and
// the data date landed on a month holding nothing but its slice.
// STARTED / REPORTED now require TYPED work: direct value or cost, any
// class AC, or a non-draft status.
// ══════════════════════════════════════════════════════════════════════

const m = (n: number, over: Partial<EvmPeriod> = {}): EvmPeriod => ({
  id: `m${n}`, label: `M${n}`, seq: n,
  start: `2025-0${n}-01`, end: `2025-0${n}-28`,
  cadence: 'monthly', status: 'draft',
  pv: 250 * n, ev: 0, ac: 0, acSource: 'manual',
  ...over,
} as EvmPeriod);

/** The post-#18 shape: M1 worked, M2-M4 future carrying indirect slices. */
const indirectSliced = [
  m(1, { directEv: 100, directAc: 80, indirectEv: 40, indirectEvBasis: 0.083,
         ev: 140, ac: 80 }),
  m(2, { indirectEv: 40, indirectEvBasis: 0.083, ev: 40 }),
  m(3, { indirectEv: 40, indirectEvBasis: 0.083, ev: 40 }),
  m(4, { indirectEv: 40, indirectEvBasis: 0.083, ev: 40 }),
];

describe('hasActuals — typed work, not the calendar', () => {
  it('an indirect-only slice is NOT actuals, however large', () => {
    expect(hasActuals(m(2, { indirectEv: 500_000, ev: 500_000 }))).toBe(false);
  });

  it('direct value, direct cost, class AC or approval all count', () => {
    expect(hasActuals(m(2, { directEv: 10 }))).toBe(true);
    expect(hasActuals(m(2, { directAc: 10 }))).toBe(true);
    expect(hasActuals(m(2, { indirectAc: 10 }))).toBe(true);
    expect(hasActuals(m(2, { status: 'approved' }))).toBe(true);
  });

  it('legacy no-split periods: the typed ev/ac record still counts', () => {
    expect(hasActuals(m(2, { ev: 120, ac: 100 }))).toBe(true);
    expect(hasActuals(m(2))).toBe(false);
  });
});

describe('the S-curve series — future months are not earned', () => {
  it('EV and AC stop at the last worked month; PV keeps the full horizon', () => {
    const s = series(indirectSliced, 1_000_000);
    expect(s[0].ev).toBe(140);
    expect(s[0].ac).toBe(80);
    for (const p of s.slice(1)) {
      expect(p.ev).toBeNull();
      expect(p.ac).toBeNull();
      expect(p.spi).toBeNull();
      expect(p.cpi).toBeNull();
      expect(p.pv).toBeGreaterThan(0);        // the plan runs to the end
    }
  });

  it('an AC-only month is worked (cost with no earned value is a fact)', () => {
    const s = series([
      m(1, { directEv: 100, directAc: 80, ev: 140, ac: 80 }),
      m(2, { directAc: 50, indirectEv: 40, ev: 40, ac: 50 }),
    ], 1_000_000);
    expect(s[1].ac).toBe(50);
    expect(s[1].ev).toBe(40);
  });
});

describe('the data date — a slice-only month is not a result', () => {
  it('skips indirect-only months, current included', () => {
    expect(reportingPeriod(indirectSliced, new Date('2025-03-15'))?.id).toBe('m1');
  });
});
