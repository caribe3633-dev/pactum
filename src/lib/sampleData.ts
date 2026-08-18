/**
 * Sample data — opt-in only.
 * Destination: src/lib/sampleData.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3G · DEMO DATA ELIMINATION
 *
 * THE PROBLEM
 *
 *   PACTUM injected fabricated records in two places, both automatic:
 *
 *   1 · AT PROJECT CREATION
 *       `initializeProjectStorage` wrote 4 invented subcontractors and
 *       12 invented certificates into every new project. Measured:
 *
 *         SC-01 Arabian MEP Solutions Co.   280,000   score 71
 *         SC-02 SteelWorks Arabia Ltd.      180,000   score 94
 *         SC-03 Luxury Facades Int'l        120,000   score 62
 *         SC-04 Al-Bina Civil Contractors   220,000   score 88
 *
 *   2 · ON FIRST OPEN OF A MODULE
 *       Cash Flow, Certificates, Risk, Claims, Change Orders, Budget and
 *       the Delay Register each wrote a seed row the first time the
 *       screen was opened. Opening a screen CREATED data — which directly
 *       contradicts the rule already written in `projectLifecycle.ts`:
 *
 *         "Navigation displays data; it never creates it."
 *
 *   A clean enterprise dataset was therefore unobtainable through the UI.
 *
 * THE FIX
 *
 *   Nothing here runs on its own. Every generator below is called ONLY by
 *   an explicit "Load Sample Data" action. A newly created project owns
 *   nothing but its own identity until a human asks for more.
 *
 * WHY THE SEEDS ARE KEPT AT ALL
 *
 *   They are useful for demonstrations and for exercising a screen with
 *   realistic shapes. Deleting them would remove that; the defect was
 *   never the data, it was that nobody chose to create it. So the content
 *   is preserved VERBATIM — byte-identical to what the modules produced —
 *   and only the trigger changes.
 *
 * SAFETY
 *
 *   `loadSampleFor()` refuses to overwrite. A store that already holds
 *   anything is left exactly as found, so the button can never destroy
 *   real work by mis-click.
 * ══════════════════════════════════════════════════════════════════════
 */

export interface SampleProject {
  id: string;
  contractValue: number;
  commencementDate?: string;
  contractualCompletion?: string;
}

/** Every dataset the button can populate. */
export type SampleKind =
  | 'budget' | 'cashflow' | 'certs' | 'claims'
  | 'changes' | 'risk' | 'subs' | 'delays';

export const SAMPLE_LABELS: { kind: SampleKind; en: string; ar: string }[] = [
  { kind: 'budget',   en: 'Budget',            ar: 'الموازنة' },
  { kind: 'cashflow', en: 'Cash Flow',         ar: 'التدفق النقدي' },
  { kind: 'certs',    en: 'Certificates',      ar: 'الشهادات' },
  { kind: 'claims',   en: 'Claims',            ar: 'المطالبات' },
  { kind: 'changes',  en: 'Change Orders',     ar: 'أوامر التغيير' },
  { kind: 'risk',     en: 'Risk Register',     ar: 'سجل المخاطر' },
  { kind: 'subs',     en: 'Subcontractors',    ar: 'مقاولو الباطن' },
  { kind: 'delays',   en: 'Delay Register',    ar: 'سجل التأخير' },
];

const KEY: Record<SampleKind, (p: string) => string> = {
  budget:   p => `pactum-budget-${p}`,
  cashflow: p => `pactum-cashflow-${p}`,
  certs:    p => `pactum-certs-${p}`,
  claims:   p => `pactum-claims-${p}`,
  changes:  p => `pactum-co-${p}`,
  risk:     p => `pactum-risk-${p}`,
  subs:     p => `pactum-subs-${p}`,
  delays:   p => `pactum-delays-${p}`,
};

// ── Generators ─────────────────────────────────────────────────────────
//
// Content lifted VERBATIM from the modules that used to auto-write it, so
// a loaded sample is indistinguishable from what the old auto-seed
// produced. Only the trigger has changed.

function sampleBudget(p: SampleProject) {
  const v = p.contractValue;
  const rows = [
    { category: 'Structural',     planned: v * 0.30, actual: v * 0.28, forecast: v * 0.31 },
    { category: 'Mechanical',     planned: v * 0.15, actual: v * 0.12, forecast: v * 0.15 },
    { category: 'Electrical',     planned: v * 0.15, actual: v * 0.16, forecast: v * 0.18 },
    { category: 'Finishes',       planned: v * 0.25, actual: v * 0.10, forecast: v * 0.25 },
    { category: 'Elevators',      planned: v * 0.05, actual: v * 0.02, forecast: v * 0.05 },
    { category: 'Infrastructure', planned: v * 0.10, actual: v * 0.09, forecast: v * 0.10 },
  ];
  return rows.map(d => ({ ...d, variance: d.planned - d.forecast }));
}

function sampleCashflow(p: SampleProject) {
  const v = p.contractValue;
  const now = new Date();
  const months = [4, 3, 2, 1, 0].map(back => {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    return {
      month: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    };
  });
  let cumNet = 0;
  return months.map((m, i) => {
    const inflow = v * (0.04 + i * 0.01);
    const outflow = v * (0.035 + i * 0.009);
    const net = inflow - outflow;
    cumNet += net;
    return {
      month: m.month,
      transactionDate: `${m.iso}-01`,
      effectiveDate: `${m.iso}-01`,
      reportingWindow: m.iso,
      dateSource: 'inferred' as const,
      in: inflow, out: outflow, net, cumNet,
    };
  });
}

function sampleSubs(p: SampleProject) {
  const v = p.contractValue;
  return [
    { id: 'sub-1', code: 'SC-01', company: 'Arabian MEP Solutions Co.', trade: 'Mechanical, Electrical & Plumbing', contactName: 'Eng. Khalid Al-Rashidi', contractValue: v * 0.28, retention: v * 0.028, progressPct: 0.42, delayDays: 12, status: 'active', performanceScore: 71 },
    { id: 'sub-2', code: 'SC-02', company: 'SteelWorks Arabia Ltd.', trade: 'Structural Steel & Metal Works', contactName: 'Eng. Mohammed Al-Qahtani', contractValue: v * 0.18, retention: v * 0.018, progressPct: 0.95, delayDays: 0, status: 'completed', performanceScore: 94 },
    { id: 'sub-3', code: 'SC-03', company: 'Luxury Facades International', trade: 'Envelope, Curtain Wall & Glazing', contactName: 'Eng. Ahmad Al-Harbi', contractValue: v * 0.12, retention: v * 0.012, progressPct: 0.08, delayDays: 5, status: 'mobilizing', performanceScore: 62 },
    { id: 'sub-4', code: 'SC-04', company: 'Al-Bina Civil Contractors', trade: 'Civil & Concrete Works', contactName: 'Eng. Faisal Al-Otaibi', contractValue: v * 0.22, retention: v * 0.022, progressPct: 0.75, delayDays: 0, status: 'active', performanceScore: 88 },
  ];
}

function sampleSubCerts(subs: ReturnType<typeof sampleSubs>) {
  const map: Record<string, unknown[]> = {};
  subs.forEach(sub => {
    const base = sub.contractValue * sub.progressPct;
    map[sub.id] = [
      { id: `cert-${sub.id}-1`, certNo: 'SC-01', period: 'Jan 2024', grossAmount: base * 0.3, retentionHeld: base * 0.03, netPayable: base * 0.27, paidAmount: base * 0.27, remainingAmount: 0, status: 'paid' },
      { id: `cert-${sub.id}-2`, certNo: 'SC-02', period: 'Feb 2024', grossAmount: base * 0.4, retentionHeld: base * 0.04, netPayable: base * 0.36, paidAmount: base * 0.36, remainingAmount: 0, status: 'paid' },
      { id: `cert-${sub.id}-3`, certNo: 'SC-03', period: 'Mar 2024', grossAmount: base * 0.3, retentionHeld: base * 0.03, netPayable: base * 0.27, paidAmount: 0, remainingAmount: base * 0.27, status: 'certified' },
    ];
  });
  return map;
}

function sampleRisk() {
  return [{
    id: 'RSK-01', cause: 'Supply chain disruption',
    event: 'Delay in structural steel delivery',
    effect: 'Critical path delay by 3 weeks',
    prob: 0.4, impact: 2000000,
    status: 'active', category: 'Technical', owner: 'Procurement',
    linkedClaimNos: ['CLM-001'],
  }];
}

// ── The only entry point ───────────────────────────────────────────────

export interface LoadResult {
  loaded: SampleKind[];
  /** Stores left untouched because they already held data. */
  skipped: SampleKind[];
}

/**
 * Populates sample data for one project.
 *
 * NON-DESTRUCTIVE: a store holding anything is skipped, never overwritten.
 * Called ONLY from an explicit "Load Sample Data" control — nothing in the
 * application invokes it automatically.
 *
 * @param kinds  which datasets to load. Defaults to all.
 */
export function loadSampleFor(
  project: SampleProject, kinds: SampleKind[] = Object.keys(KEY) as SampleKind[],
): LoadResult {
  const loaded: SampleKind[] = [];
  const skipped: SampleKind[] = [];

  const put = (kind: SampleKind, value: unknown) => {
    const key = KEY[kind](project.id);
    try {
      const existing = localStorage.getItem(key);
      // "Already has data" means a non-empty array or object. An empty
      // array is a deliberate user state — they cleared it — so it is
      // treated as occupied and left alone.
      if (existing !== null) { skipped.push(kind); return; }
      localStorage.setItem(key, JSON.stringify(value));
      loaded.push(kind);
    } catch { skipped.push(kind); }
  };

  kinds.forEach(kind => {
    switch (kind) {
      case 'budget':   put('budget',   sampleBudget(project)); break;
      case 'cashflow': put('cashflow', sampleCashflow(project)); break;
      case 'risk':     put('risk',     sampleRisk()); break;
      case 'subs': {
        const subs = sampleSubs(project);
        put('subs', subs);
        // Sub-certificates ride with their subcontractors: certificates
        // for assignments that do not exist would be orphans.
        try {
          const ck = `pactum-sub-certs-${project.id}`;
          if (localStorage.getItem(ck) === null) {
            localStorage.setItem(ck, JSON.stringify(sampleSubCerts(subs)));
          }
        } catch { /* quota */ }
        break;
      }
      // Certificates, Claims, Change Orders and the Delay Register have
      // no sample content: their old seeds were single illustrative rows
      // that the modules can no longer write. They start empty, which is
      // the correct state for a real project.
      case 'certs': case 'claims': case 'changes': case 'delays':
        skipped.push(kind); break;
    }
  });

  return { loaded, skipped };
}

/** True when a project holds no data in any sampled store. */
export function isProjectEmpty(projectId: string): boolean {
  return (Object.keys(KEY) as SampleKind[]).every(k => {
    try { return localStorage.getItem(KEY[k](projectId)) === null; }
    catch { return true; }
  });
}
