import { describe, it, expect, beforeEach } from 'vitest';
import {
  approveClass, reopenClass, classApproved, setClassValue, applyIndirectEv,
  syncCalendar, transition, DEFAULT_SETTINGS,
  type EvmStore, type EvmPeriod, type ProjectLike,
} from '../src/lib/evm';

// ══════════════════════════════════════════════════════════════════════
// SEPARATE CLASS APPROVALS (owner rule).
//
// Direct and Indirect sign off independently. The TOTAL is approved
// ONLY when both are — that is when the period freezes and counts for
// SPI/CPI. Reopening one class thaws the total but KEEPS every stored
// value: nothing is erased except by an explicit edit.
// ══════════════════════════════════════════════════════════════════════

const P: ProjectLike = {
  id: 'cls-appr', contractValue: 1_000_000, progress: 0,
  commencementDate: '2026-01-01', plannedDurationDays: 365,
  contractualCompletion: '2026-12-31',
};

const m = (n: number, over: Partial<EvmPeriod> = {}): EvmPeriod => ({
  id: `m${n}`, label: `M${n}`, seq: n,
  start: `2026-0${n}-01`, end: `2026-0${n}-28`,
  cadence: 'monthly', status: 'draft',
  pv: 100 * n, ev: 0, ac: 0, acSource: 'manual',
  directEv: 60 * n, directAc: 50 * n,
  indirectEv: 20 * n, indirectEvBasis: 0.08,
  ...over,
} as EvmPeriod);

const store = (periods: EvmPeriod[]): EvmStore => ({ settings: DEFAULT_SETTINGS, periods });

beforeEach(() => localStorage.clear());

describe('approveClass — the total waits for both signatures', () => {
  it('approving Direct alone leaves the period draft and unfrozen', () => {
    let s = store([m(1)]);
    s = approveClass(s, 'm1', 'direct', 'eng', 1_000_000).store;
    expect(s.periods[0].directStatus).toBe('approved');
    expect(s.periods[0].indirectStatus).toBeUndefined();
    expect(s.periods[0].status).toBe('draft');
    expect(s.periods[0].frozen).toBeUndefined();
  });

  it('approving the second class completes the period: frozen + approved', () => {
    let s = store([m(1)]);
    s = approveClass(s, 'm1', 'direct', 'eng', 1_000_000).store;
    s = approveClass(s, 'm1', 'indirect', 'fin', 1_000_000).store;
    expect(s.periods[0].status).toBe('approved');
    expect(s.periods[0].frozen).toBeDefined();
    expect(s.periods[0].frozen!.pv).toBe(100);
    expect(s.periods[0].reviewer).toBe('fin');       // the completing signature
  });

  it('approving is a decision, not an edit — values never change', () => {
    let s = store([m(1, { directEv: 700, directAc: 600, indirectEv: 200 })]);
    s = approveClass(s, 'm1', 'direct', 'eng', 1_000_000).store;
    s = approveClass(s, 'm1', 'indirect', 'eng', 1_000_000).store;
    expect(s.periods[0].directEv).toBe(700);
    expect(s.periods[0].directAc).toBe(600);
    expect(s.periods[0].indirectEv).toBe(200);
  });
});

describe('reopenClass — correct the signature, keep the data', () => {
  it('reopening one class thaws the total and KEEPS every value', () => {
    let s = store([m(1, { directEv: 700, directAc: 600, indirectEv: 200 })]);
    s = approveClass(s, 'm1', 'direct', 'eng', 1_000_000).store;
    s = approveClass(s, 'm1', 'indirect', 'eng', 1_000_000).store;
    expect(s.periods[0].status).toBe('approved');

    s = reopenClass(s, 'm1', 'indirect', 'eng').store;
    expect(s.periods[0].indirectStatus).toBe('draft');
    expect(s.periods[0].status).toBe('draft');
    expect(s.periods[0].frozen).toBeUndefined();
    expect(s.periods[0].directEv).toBe(700);          // data intact
    expect(s.periods[0].indirectEv).toBe(200);
    expect(s.periods[0].directStatus).toBe('approved'); // untouched class stays signed
  });
});

describe('locks are per class', () => {
  it('an approved Direct does not freeze Indirect edits — and vice versa', () => {
    let s = store([m(1)]);
    s = approveClass(s, 'm1', 'direct', 'eng', 1_000_000).store;
    s = setClassValue(s, 'm1', 'directEv', 999);       // refused
    expect(s.periods[0].directEv).toBe(60);
    s = setClassValue(s, 'm1', 'indirectAc', 120);     // allowed
    expect(s.periods[0].indirectAc).toBe(120);

    s = reopenClass(s, 'm1', 'direct', 'eng').store;
    s = approveClass(s, 'm1', 'indirect', 'eng', 1_000_000).store;
    s = applyIndirectEv(s, 'm1', 0.5, 500_000);        // indirect signed: refused
    expect(s.periods[0].indirectEv).toBe(20);
    s = setClassValue(s, 'm1', 'directEv', 80);        // direct live: allowed
    expect(s.periods[0].directEv).toBe(80);
  });
});

describe('transition coherence + the no-delete calendar', () => {
  it('a whole-period approval stamps both classes; resubmit reopens both', () => {
    let s = store([m(1)]);
    s = transition(s, 'm1', 'approved', 'eng', undefined, 1_000_000).store;
    expect(s.periods[0].directStatus).toBe('approved');
    expect(s.periods[0].indirectStatus).toBe('approved');
    s = transition(s, 'm1', 'draft', 'eng').store;
    expect(s.periods[0].directStatus).toBe('draft');
    expect(s.periods[0].indirectStatus).toBe('draft');
  });

  it('a cadence change never deletes stored periods — off-grid rows survive', () => {
    // Monthly store with entered data, then the cadence flips to quarterly.
    // m1 (Jan 1) sits on the quarterly grid; m2 (Feb) and an approved m3
    // (Mar) fall off it — before the fix they were deleted outright.
    const monthly = store([
      m(1, { directEv: 700, directAc: 600, status: 'approved',
             frozen: { pv: 100, ev: 80, ac: 60, bac: 1_000_000, spi: 0.8, cpi: 1.33,
                       sv: -20, cv: 20, eac: 750_000, etc: 690_000, vac: 250_000, tcpi: null,
                       eacMethod: 'cpi', frozenAt: '2026-02-01T00:00:00Z', baselineId: '' } }),
      m(2, { directEv: 120, directAc: 90 }),
      m(3, { directEv: 150, directAc: 110, status: 'approved',
             frozen: { pv: 300, ev: 250, ac: 210, bac: 1_000_000, spi: 0.83, cpi: 1.19,
                       sv: -50, cv: 40, eac: 840_000, etc: 630_000, vac: 160_000, tcpi: null,
                       eacMethod: 'cpi', frozenAt: '2026-04-01T00:00:00Z', baselineId: '' } }),
    ]);
    const quarterly = { ...monthly, settings: { ...monthly.settings, cadence: 'quarterly' as const } };
    const out = syncCalendar(P, quarterly).store;
    // grid (4, m1 matched) + both off-grid rows kept = 6
    expect(out.periods.length).toBe(6);
    const saved = out.periods.find(p => p.id === 'm1')!;
    expect(saved.status).toBe('approved');
    expect(saved.frozen).toBeDefined();
    const draft = out.periods.find(p => p.id === 'm2')!;
    expect(draft.directEv).toBe(120);                 // entered data intact
    const offGridApproved = out.periods.find(p => p.id === 'm3')!;
    expect(offGridApproved.status).toBe('approved');  // even an approved row survives
    expect(offGridApproved.frozen).toBeDefined();
  });
});
