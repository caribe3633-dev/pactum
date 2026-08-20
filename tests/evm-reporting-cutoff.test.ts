import { describe, it, expect } from 'vitest';
import { reportingPeriod, EvmPeriod } from '../src/lib/evm';

// ══════════════════════════════════════════════════════════════════════
// THE DATA DATE — which period the whole report answers from.
//
// An empty month is not a result: PV is auto-planned on every period,
// so the old rule (current period if ANY figure) let a month with no
// EV/AC yet drive the dashboard with zeros. AUTO now walks back to the
// latest period carrying ACTUALS; a manual cutoff pins the data date.
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

describe('AUTO — an empty month is not a result', () => {
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
    // The earlier fix, preserved: typed figures appear immediately,
    // approval or not.
    const periods = [
      m(1, { ev: 80, ac: 70 }),
      m(2, { ev: 180, ac: 160 }),
      m(3, { ev: 260, ac: 240 }),
      m(4, { ev: 300 }),                 // EV typed, AC not yet
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
});

describe('MANUAL cutoff — the pinned data date', () => {
  const periods = [
    m(1, { ev: 80, ac: 70 }),
    m(2, { ev: 180, ac: 160 }),
    m(3, { ev: 260, ac: 240 }),
    m(4, { ev: 300, ac: 280 }),                       // complete current month
  ];

  it('pins the report to the chosen period, even older', () => {
    expect(reportingPeriod(periods, TODAY, 'm2')?.id).toBe('m2');
  });

  it('a pinned id that no longer exists falls back to AUTO', () => {
    expect(reportingPeriod(periods, TODAY, 'deleted-period')?.id).toBe('m4');
  });

  it("explicit 'auto' behaves exactly like no cutoff at all", () => {
    expect(reportingPeriod(periods, TODAY, 'auto')?.id)
      .toBe(reportingPeriod(periods, TODAY)?.id);
  });
});
