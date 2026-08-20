import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeBac, computeBacSplit, readEvm, writeEvm, DEFAULT_SETTINGS,
  type EvmSettings, type ProjectLike,
} from '../src/lib/evm';

// ══════════════════════════════════════════════════════════════════════
// ONE BAC, NO BACKDOOR (owner decision).
//
// BAC Override and the PV Distribution setting are cancelled: a typed
// number used to replace the SIGNED package total (breaking
// directBac + indirectBac = totalBac) and go stale the day a change
// order was approved. Legacy values are still PARSED — old stores must
// keep loading — but nothing obeys them.
// ══════════════════════════════════════════════════════════════════════

const P: ProjectLike = {
  id: 'bac-auth', contractValue: 1_000_000, progress: 0,
  commencementDate: '2026-01-01', plannedDurationDays: 365,
  contractualCompletion: '2026-12-31',
};

const settingsWith = (over: Partial<EvmSettings>): EvmSettings =>
  ({ ...DEFAULT_SETTINGS, ...over });

beforeEach(() => {
  localStorage.clear();
});

describe('computeBac — a stored override is parsed, never obeyed', () => {
  it('always derives from contract + approved COs + approved claims', () => {
    const r = computeBac(P, settingsWith({ bacOverride: 999_999_999 }));
    expect(r.bac).toBe(1_000_000);
    expect(r.overridden).toBe(false);
  });

  it('an empty override changes nothing (legacy default path intact)', () => {
    expect(computeBac(P, DEFAULT_SETTINGS).bac).toBe(1_000_000);
  });
});

describe('computeBacSplit — the signed package total is THE total', () => {
  const seedPackage = () => {
    localStorage.setItem('pactum-baselines-bac-auth', JSON.stringify({
      packages: [
        { version: 1, status: 'approved', data: { directBudget: 300_000, indirectBudget: 100_000 } },
      ],
    }));
  };

  it('directBac + indirectBac = totalBac, even with a stored override', () => {
    seedPackage();
    const r = computeBacSplit(P, settingsWith({ bacOverride: 999_999_999 }));
    expect(r.available).toBe(true);
    expect(r.directBac).toBe(300_000);
    expect(r.indirectBac).toBe(100_000);
    expect(r.totalBac).toBe(400_000);
    expect(r.directBac + r.indirectBac).toBe(r.totalBac);
    expect(r.overridden).toBe(false);
  });

  it('no approved package → unavailable, never zero-filled', () => {
    const r = computeBacSplit(P, DEFAULT_SETTINGS);
    expect(r.available).toBe(false);
    expect(r.totalBac).toBe(0);
  });
});

describe('readEvm — PV distribution is scurve-or-manual, nothing else', () => {
  it('legacy front/back/linear normalize to scurve on load', () => {
    for (const legacy of ['front', 'back', 'linear', 'nonsense'] as const) {
      localStorage.setItem('pactum-evm-bac-auth', JSON.stringify({
        settings: { ...DEFAULT_SETTINGS, pvMethod: legacy as any },
        periods: [],
      }));
      expect(readEvm('bac-auth').settings.pvMethod).toBe('scurve');
    }
  });

  it("a pasted programme keeps 'manual' — the planner's numbers are owned", () => {
    writeEvm('bac-auth', { ...readEvm('bac-auth'), settings: settingsWith({ pvMethod: 'manual' }) });
    localStorage.setItem('pactum-evm-bac-auth', JSON.stringify({
      settings: { ...DEFAULT_SETTINGS, pvMethod: 'manual' },
      periods: [],
    }));
    expect(readEvm('bac-auth').settings.pvMethod).toBe('manual');
  });
});
