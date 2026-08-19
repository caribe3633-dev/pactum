/**
 * REGRESSION — Package Lag (تنبيه النسخ الأحدث من الحزمة)
 * السيناريو: الحزمة السارية مبنية من Claims V1 واعتمدنا Claims V2 →
 * لازم يظهر تنبيه (كارت كهرماني + علامة على التاب)، ويختفي بعد اعتماد
 * حزمة جديدة مبنية من V2.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createVersion, submitVersion, approveVersion, readSourceVersions,
  type Actor,
} from '@/lib/sourceVersions';
import { packageLag, readBaselines } from '@/lib/baselines';

const PID = 'lag-1';
const ACTOR: Actor = { userId: 'tester', role: 'pm' } as any;

function approveNew(kind: any, snapshot: unknown) {
  const created = createVersion({ projectId: PID, kind, actor: ACTOR, snapshot });
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
  const drafts = created.store.versions.filter((v: any) => v.kind === kind && v.status === 'draft');
  const versionId = drafts[drafts.length - 1].id;
  const sub = submitVersion({ projectId: PID, versionId, actor: ACTOR });
  if (!sub.ok) throw new Error(`submit failed: ${JSON.stringify(sub)}`);
  const app = approveVersion({ projectId: PID, versionId, actor: ACTOR });
  if (!app.ok) throw new Error(`approve failed: ${JSON.stringify(app)}`);
}

// حزمة "يدوية" في ستور الـ baselines بأوزاع محددة
function seedPackage(refs: { claims?: number; budget?: number }) {
  const store = readBaselines(PID);
  const store2 = {
    ...store,
    packages: [{
      id: 'pkg-1', version: 1, status: 'approved',
      createdAt: new Date().toISOString(), createdBy: 'tester',
      approvedAt: new Date().toISOString(), approvedBy: 'tester',
      effectiveDate: '2026-01-01', reason: 'test',
      data: {
        sourceRefs: {
          contract: null,
          budget: refs.budget ? { id: 'x', version: refs.budget, approvedAt: '', approvedBy: '', digest: '' } : null,
          cashflow: null, evmPlanned: null,
          claims: refs.claims ? { id: 'x', version: refs.claims, approvedAt: '', approvedBy: '', digest: '' } : null,
          changeOrders: null,
        },
      },
    }] as any,
  } as any;
  localStorage.setItem(`pactum-baselines-${PID}`, JSON.stringify(store2));
}

describe('packageLag — regression tests', () => {
  beforeEach(() => { localStorage.clear(); });

  it('1️⃣ مفيش حاجة معتمدة → مفيش تنبيه', () => {
    const r = packageLag(PID);
    expect(r.alert).toBe(false);
    expect(r.behind).toHaveLength(0);
  });

  it('2️⃣ الكل معتمد ومفيش حزمة → تنبيه (محتاجين أول حزمة)', () => {
    const kinds = ['contract', 'budget', 'cashflow', 'evm-planned', 'claims', 'change-orders'] as any[];
    let st: any;
    kinds.forEach(k => { st = approveNew(k, k === "contract" ? { contractValue: 100 } : [{ v: 1 }]); });
    const r = packageLag(PID);
    expect(r.awaitingFirstPackage).toBe(true);
    expect(r.alert).toBe(true);
  });

  it('3️⃣ حزمة من Claims V1 + اعتمدنا V2 → Claims متأخرة والتنبيه شغال', () => {
    approveNew("claims", [{ v: 1 }]);
    seedPackage({ claims: 1 });
    approveNew("claims", [{ v: 1 }, { v: 2 }]);

    const r = packageLag(PID);
    expect(r.alert).toBe(true);
    expect(r.behind).toHaveLength(1);
    expect(r.behind[0].kind).toBe('claims');
    expect(r.behind[0].pkgVersion).toBe(1);
    expect(r.behind[0].approvedVersion).toBe(2);
  });

  it('4️⃣ اعتمدنا حزمة جديدة من V2 → التنبيه يختفي', () => {
    approveNew("claims", [{ v: 1 }, { v: 2 }]);
    seedPackage({ claims: 2 });
    const r = packageLag(PID);
    expect(r.alert).toBe(false);
    expect(r.behind).toHaveLength(0);
  });
});

describe('syncEvmPlannedApproval — the bridge', () => {
  beforeEach(() => { localStorage.clear(); });

  it('5️⃣ المزامنة تسجل نسخة معتمدة من المخزن الحي وتعيد true', async () => {
    const { syncEvmPlannedApproval, approvedOf, readSourceVersions, SRCVER_KEY } = await import('@/lib/sourceVersions');
    // مخزن EVM حي (غير فاضي) عشان اللقطة تتبني
    localStorage.setItem('pactum-evm-lag-1', JSON.stringify({ settings: {}, periods: [{ id: 'x' }] }));
    const ok = syncEvmPlannedApproval('lag-1', { userId: 'tester' });
    expect(ok).toBe(true);
    const approved = approvedOf(readSourceVersions('lag-1'), 'evm-planned');
    expect(approved?.version).toBe(1);
    expect(approved?.status).toBe('approved');
    expect(localStorage.getItem(SRCVER_KEY('lag-1'))).toBeTruthy();
  });

  it('6️⃣ مخزن فاضي → مفيش نسخة ومفيش ضجيج', async () => {
    const { syncEvmPlannedApproval, readSourceVersions } = await import('@/lib/sourceVersions');
    const ok = syncEvmPlannedApproval('lag-empty', { userId: 'tester' });
    expect(ok).toBe(false);
    expect(readSourceVersions('lag-empty').versions).toHaveLength(0);
  });
});
