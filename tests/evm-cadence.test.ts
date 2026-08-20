import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCalendar, CADENCE_META, readEvm, DEFAULT_SETTINGS,
  type ProjectLike,
} from '../src/lib/evm';

// ══════════════════════════════════════════════════════════════════════
// CADENCE (owner decision): monthly / quarterly / semi-annual / annual.
// Weekly and biweekly are GONE — a weekly EVM report is a cash-flow
// statement wearing a costume. Legacy stores normalize to monthly.
// ══════════════════════════════════════════════════════════════════════

const P: ProjectLike = {
  id: 'cad-1', contractValue: 1_000_000, progress: 0,
  commencementDate: '2026-01-01', plannedDurationDays: 365,
  contractualCompletion: '2026-12-31',
};

beforeEach(() => localStorage.clear());

describe('the four cadences', () => {
  it('exactly monthly, quarterly, semi-annual and annual — no weeks', () => {
    expect(CADENCE_META.map(c => c.value)).toEqual(['monthly', 'quarterly', 'semiannual', 'annual']);
  });

  it('monthly builds 12 periods for 2026', () => {
    const rows = buildCalendar(P, 'monthly');
    expect(rows).toHaveLength(12);
    expect(rows[0].label.endsWith('2026')).toBe(true);
  });

  it('quarterly builds 4 periods labelled Q1..Q4', () => {
    const rows = buildCalendar(P, 'quarterly');
    expect(rows).toHaveLength(4);
    expect(rows.map(r => r.label)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
  });

  it('semi-annual builds 2 periods labelled H1 / H2', () => {
    const rows = buildCalendar(P, 'semiannual');
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.label)).toEqual(['H1 2026', 'H2 2026']);
    // The halves are real windows, not cosmetic labels.
    expect(rows[0].start).toBe('2026-01-01');
    expect(rows[0].end).toBe('2026-06-30');
    expect(rows[1].start).toBe('2026-07-01');
    expect(rows[1].end).toBe('2026-12-31');
  });

  it('annual builds one period labelled by year', () => {
    const rows = buildCalendar(P, 'annual');
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('2026');
    expect(rows[0].start).toBe('2026-01-01');
    expect(rows[0].end).toBe('2026-12-31');
  });
});

describe('legacy weekly stores normalize on load', () => {
  it.each(['weekly', 'biweekly'])('%s → monthly', (legacy) => {
    localStorage.setItem('pactum-evm-cad-1', JSON.stringify({
      settings: { ...DEFAULT_SETTINGS, cadence: legacy as any },
      periods: [],
    }));
    expect(readEvm('cad-1').settings.cadence).toBe('monthly');
  });
});
