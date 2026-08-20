import { describe, it, expect } from 'vitest';
import {
  reportingPeriod, snapshot, DEFAULT_SETTINGS,
  type EvmPeriod, type EvmStore, type ProjectLike,
} from '../src/lib/evm';

// ══════════════════════════════════════════════════════════════════════
// THE DATA DATE — which period the whole report answers from.
//
// An empty month is not a result: PV is auto-planned on every period,
// so counting PV as "data" let a month with no EV/AC yet drive the
// dashboard with zeros. The rule walks back from today to the latest
// period carrying ACTUALS.
//
// DELIBERATELY NOT APPROVED-ONLY (user decision): gating the report or
// the class totals on period approval would fight the Baseline track —
// indirect EV is time-derived from the approved schedule and EOTs, not
// from a period's approval state. This test pins that exact rule.
// ══════════════════════════════════════════════════════════════════════

/** Monthly periods through 2025. today = inside M4. */
const m = (n: number, over: Partial<EvmPeriod> = {}): EvmPeriod => ({
  id: `m${n}`,
  label: `M${n}`,
  seq: n,
  start: `2025-0${n}-01`,
  end: `2025-0${n}-28`,
  cadence: 'monthly',
  status: 'draft',
  pv: 100 * n,                 // auto-planned: ALWAYS present
  ev: 0, ac: 0,
  acSource: 'manual',
  ...over,
} as EvmPeriod);

const TODAY = new Date('2025-04-15');   // inside M4

describe('the data date — an empty month is not a result', () => {
  it('skips a current month with only its plan (no EV, no AC)', () => {
    const periods = [
      m(1, { ev: 80, ac: 70 }),
      m(2, { ev: 180, ac: 160 }),
      m(3, { ev: 260, ac: 240 }),
      m(4),                              // month arrived, nothing entered yet
    ];
    expect(reportingPeriod(periods, TODAY)?.id).toBe('m3');
  });

  it('still reports the live current month the moment it carries actuals', () => {
    // Live typing is visible immediately — approval NOT required:
    // the baseline track owns plan approval, not the reporting date.
    const periods = [
      m(1, { ev: 80, ac: 70 }),
      m(2, { ev: 180, ac: 160 }),
      m(3, { ev: 260, ac: 240 }),
      m(4, { ev: 300, status: 'draft' }),   // live EV typed, not approved
    ];
    expect(reportingPeriod(periods, TODAY)?.id).toBe('m4');
  });

  it('never reports a month that has not arrived on the calendar', () => {
    const early = new Date('2025-02-15');            // inside M2
    const periods = [
      m(1, { ev: 80, ac: 70 }),
      m(2, { ev: 180, ac: 160 }),
      m(3, { ev: 260, ac: 240 }),                     // future for `early`
      m(4, { ev: 320, ac: 300 }),
    ];
    expect(reportingPeriod(periods, early)?.id).toBe('m2');
  });

  it('with no actuals anywhere, the latest APPROVED period reports', () => {
    const periods = [
      m(1), m(2),
      m(3, { status: 'approved' }),                   // signed, plan-only
      m(4),
    ];
    expect(reportingPeriod(periods, TODAY)?.id).toBe('m3');
  });

  it('with no actuals and no approvals, the current period shows anyway', () => {
    const periods = [m(1), m(2), m(3), m(4)];
    expect(reportingPeriod(periods, TODAY)?.id).toBe('m4');
    expect(reportingPeriod([], TODAY)).toBeNull();
  });

  it('a draft with actuals outranks an older approved period', () => {
    // The numbers are the report; the baseline track approves the plan.
    const periods = [
      m(1, { ev: 80, ac: 70, status: 'approved' }),
      m(2, { ev: 180, ac: 160, status: 'approved' }),
      m(3, { ev: 260, ac: 240, status: 'draft' }),    // fresher actuals
      m(4),
    ];
    expect(reportingPeriod(periods, TODAY)?.id).toBe('m3');
  });
});

describe('SPI / CPI quote the LATEST APPROVED period', () => {
  const P: ProjectLike = {
    id: 'dd-1', contractValue: 1_000_000, progress: 30,
    commencementDate: '2025-01-01', plannedDurationDays: 365,
    contractualCompletion: '2025-12-31',
  };
  const st = (periods: EvmPeriod[]): EvmStore => ({ settings: DEFAULT_SETTINGS, periods });

  it('a fresher draft moves the MONEY but never the two indices', () => {
    // M1 approved: SPI 0.80, CPI 80/70. M2 live and half-entered: its own
    // indices would be 0.50 / 0.50 — the project is not judged by those.
    const s = st([
      m(1, { pv: 100, ev: 80, ac: 70, status: 'approved' }),
      m(2, { pv: 200, ev: 100, ac: 200, status: 'draft' }),
    ]);
    const snap = snapshot(P, s, new Date('2025-02-15'));
    // money reports from the data date (the live row carries actuals)
    expect(snap.m.ev).toBe(100);
    expect(snap.m.ac).toBe(200);
    // the indices quote the approved record
    expect(snap.m.spi).toBeCloseTo(0.80, 6);
    expect(snap.m.cpi).toBeCloseTo(80 / 70, 6);
  });

  it('with nothing approved, the live indices answer (nothing better exists)', () => {
    const s = st([
      m(1, { pv: 100, ev: 80, ac: 70, status: 'draft' }),
      m(2, { pv: 200, ev: 100, ac: 200, status: 'draft' }),
    ]);
    const snap = snapshot(P, s, new Date('2025-02-15'));
    expect(snap.m.spi).toBeCloseTo(0.50, 6);
    expect(snap.m.cpi).toBeCloseTo(0.50, 6);
  });

  it('the movement arrows compare approved against approved', () => {
    const s = st([
      m(1, { pv: 100, ev: 90, ac: 80, status: 'approved' }),   // SPI 0.90
      m(2, { pv: 200, ev: 160, ac: 140, status: 'approved' }), // SPI 0.80
      m(3, { pv: 300, ev: 300, ac: 300, status: 'draft' }),    // would be 1.00
    ]);
    const snap = snapshot(P, s, new Date('2025-03-15'));
    expect(snap.m.spi).toBeCloseTo(0.80, 6);
    expect(snap.prevM?.spi).toBeCloseTo(0.90, 6);
  });
});
