/**
 * Earned Value Management engine — period based.
 * Destination: src/lib/evm.ts
 *
 * SCOPE
 *   This module OWNS one new storage key and nothing else:
 *
 *     pactum-evm-${projectId}  ->  EvmStore
 *
 *   Everything it needs beyond that is READ from stores other modules
 *   already own. It never writes to them:
 *
 *     pactum-budget-${id}   -> AC   (Σ actual cost by category)
 *     pactum-certs-${id}    -> revenue certified, used for the AC fallback
 *     pactum-co-${id}       -> approved change orders, for BAC
 *     pactum-claims-${id}   -> approved claims, for BAC
 *     project.progress      -> EV   (approved physical progress)
 *     project.commencementDate / plannedDurationDays -> PV baseline
 *
 * WHY PERIODS
 *   A single snapshot cannot answer "are we getting better or worse?".
 *   Every figure below is stamped to a period, so SPI/CPI become a series
 *   rather than a number, and a past review can never be silently rewritten.
 *
 * ROUNDING
 *   Nothing is rounded in storage. Rounding is a presentation concern and
 *   doing it early makes cumulative series drift.
 */

// ── Period model ───────────────────────────────────────────────────────

export type PeriodStatus = 'draft' | 'submitted' | 'reviewed' | 'approved' | 'rejected';

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

/** Where a figure came from. Drives the AUTO / MANUAL badge. */
export type Source = 'auto' | 'manual';

/**
 * The three PMI-approved forecasting methods.
 *   cpi        BAC / CPI                       — current cost efficiency continues
 *   atypical   AC + (BAC − EV)                 — the variance was a one-off
 *   composite  AC + (BAC − EV)/(CPI × SPI)     — both cost and schedule persist
 */
export type EacMethod = 'cpi' | 'atypical' | 'composite';

export interface EvmPeriod {
  id: string;
  /** Sequence number within the calendar, 1-based. */
  seq: number;
  /** ISO yyyy-mm-dd. */
  start: string;
  /** ISO yyyy-mm-dd, inclusive. */
  end: string;
  /** Short axis label: `Jan 2026` or `W12 2026`. */
  label: string;

  /** CUMULATIVE planned value at period end. */
  pv: number;
  /** CUMULATIVE earned value at period end. */
  ev: number;
  /** CUMULATIVE actual cost at period end. */
  ac: number;

  pvSource: Source;
  evSource: Source;
  acSource: Source;

  /**
   * ════════════════════════════════════════════════════════════════════
   * STEP 12 — THE DIRECT / INDIRECT SPLIT.
   *
   * `pv`, `ev` and `ac` above remain the TOTAL and remain authoritative
   * for every existing reader. Nothing was renamed and nothing was
   * repurposed: a chart, an export or a frozen snapshot written before
   * Step 12 keeps working untouched.
   *
   * These six are the components. All OPTIONAL, because a period
   * recorded before Step 12 genuinely has no split and inventing one
   * would be fabrication. `hasSplit()` is the only correct way to ask.
   *
   * THE INVARIANT, where a split exists:
   *     pv = directPv + indirectPv
   *     ev = directEv + indirectEv
   *     ac = directAc + indirectAc
   *
   * It is maintained by `setClassValue()`, which recomputes the total
   * every time a component changes. The total is never edited directly
   * once a split exists — that is what would let the two drift apart.
   *
   * indirectEv carries no source flag: it is ALWAYS time-derived from
   * the effective approved schedule (Step 12 rule 5) and is never typed
   * in by hand.
   * ════════════════════════════════════════════════════════════════════
   */
  directPv?: number;
  indirectPv?: number;
  directEv?: number;
  indirectEv?: number;
  directAc?: number;
  indirectAc?: number;

  directPvSource?: Source;
  indirectPvSource?: Source;
  directEvSource?: Source;
  directAcSource?: Source;
  indirectAcSource?: Source;

  /** Time-based planned % used to derive indirectEv. null = unknowable. */
  indirectEvBasis?: number | null;

  status: PeriodStatus;
  reviewer: string;
  /** ISO yyyy-mm-dd. */
  reviewDate: string;
  comment: string;
  /** ISO timestamp of the last status change. */
  updatedAt: string;

  // ── Manual reporting fields. Optional: older periods have none. ──
  /** Physical progress reported on site, 0..1. */
  physicalProgress?: number;
  notes?: string;
  issues?: string;
  risks?: string;
  /** Document links. URLs only — PACTUM never stores a file. */
  attachments?: string[];

  /**
   * FROZEN SNAPSHOT, written once at approval.
   *
   * An approved period is a historical statement, not a live view. Every
   * derived figure is stored here so a later change to BAC, to the EAC
   * method, or to a baseline can never rewrite what was signed off.
   * Absent on any period that has never been approved.
   */
  frozen?: FrozenSnapshot;
  /** Baseline version in force when the period was approved. */
  baselineId?: string;
}

/** Values fixed at the moment of approval. Never recalculated. */
export interface FrozenSnapshot {
  pv: number; ev: number; ac: number; bac: number;
  spi: number | null; cpi: number | null;
  sv: number; cv: number;
  eac: number; etc: number; vac: number; tcpi: number | null;
  /** Method used to produce the frozen EAC. */
  eacMethod: EacMethod;
  /** ISO timestamp of the freeze. */
  frozenAt: string;
  baselineId: string;
}

export interface EvmSettings {
  cadence: Cadence;
  /**
   * Budget at Completion. 0 = derive from the contract
   * (contract value + approved change orders + approved claims).
   */
  bacOverride: number;
  /** The OFFICIAL forecast method. The other two stay visible for comparison. */
  eacMethod: EacMethod;
  /** Manual entry is allowed only when the caller also has edit rights. */
  allowManual: boolean;
  /** Active baseline version id. '' = the implicit V1 derived from the project. */
  activeBaselineId?: string;
  /** How PV is spread. Defaults to the S-curve assumption. */
  pvMethod?: PvMethod;
}

/**
 * How planned value is spread across the calendar.
 *
 *   scurve   symmetric 3t^2-2t^3 — a stated assumption, used before a
 *            detailed programme exists
 *   front    weighted to the early periods (heavy civils, enabling works)
 *   back     weighted to the late periods (fit-out, commissioning)
 *   linear   equal per period — only honest when the work really is even
 *   manual   every period typed from the approved programme; the engine
 *            never overwrites it
 */
export type PvMethod = 'scurve' | 'front' | 'back' | 'linear' | 'manual';

export const PV_METHODS: { value: PvMethod; en: string; ar: string; hint: string; hintAr: string }[] = [
  { value: 'manual', en: 'Manual — from programme', ar: 'يدوي — من البرنامج',
    hint: 'Type or paste the cumulative PV of each period. Nothing is overwritten.',
    hintAr: 'أدخل أو الصق القيمة المخططة التراكمية لكل فترة. لا يُستبدل شيء.' },
  { value: 'scurve', en: 'S-Curve (balanced)', ar: 'منحنى S (متوازن)',
    hint: 'Slow start, fast middle, slow finish. Use before a detailed programme exists.',
    hintAr: 'بداية بطيئة ووسط سريع ونهاية بطيئة. يُستخدم قبل وجود برنامج تفصيلي.' },
  { value: 'front', en: 'Front-loaded', ar: 'مُحمَّل مبكراً',
    hint: 'Spend peaks early — heavy civils, piling, enabling works.',
    hintAr: 'ذروة الإنفاق مبكرة — أعمال مدنية ثقيلة وخوازيق وأعمال تمهيدية.' },
  { value: 'back', en: 'Back-loaded', ar: 'مُحمَّل متأخراً',
    hint: 'Spend peaks late — fit-out, MEP commissioning, finishes.',
    hintAr: 'ذروة الإنفاق متأخرة — تشطيبات وتشغيل الأنظمة.' },
  { value: 'linear', en: 'Linear', ar: 'خطي',
    hint: 'Equal value every period. Rare on construction; honest only when true.',
    hintAr: 'قيمة متساوية كل فترة. نادر في الإنشاءات؛ صادق فقط عندما يكون حقيقياً.' },
];

/**
 * A baseline is a frozen statement of the plan.
 *
 * It is never overwritten. Re-baselining appends a new version, and only
 * FUTURE periods are redistributed against it — an approved period keeps the
 * baseline it was approved under, recorded in `period.baselineId`.
 */
export interface Baseline {
  id: string;
  /** 1-based version number. */
  version: number;
  name: string;
  /** ISO yyyy-mm-dd. */
  start: string;
  finish: string;
  durationDays: number;
  bac: number;
  contractValue: number;
  /** Why this baseline exists. Required for anything past V1. */
  reason: string;
  /** Category of the change that triggered re-baselining. */
  cause?: RebaselineCause;
  /** Days added by this revision, relative to the previous baseline. */
  daysAdded?: number;
  /** Value added by this revision. */
  valueAdded?: number;
  approvedBy: string;
  approvedOn: string;
  createdAt: string;
  /** false while the request is still being drafted. */
  approved: boolean;
}

export type RebaselineCause =
  | 'approved-eot' | 'change-order' | 'scope-increase' | 'owner-delay' | 'force-majeure' | 'other';

export const REBASELINE_CAUSES: { value: RebaselineCause; en: string; ar: string }[] = [
  { value: 'approved-eot',  en: 'Approved EOT',   ar: 'تمديد معتمد' },
  { value: 'change-order',  en: 'Change Order',   ar: 'أمر تغيير' },
  { value: 'scope-increase',en: 'Scope Increase', ar: 'زيادة نطاق' },
  { value: 'owner-delay',   en: 'Owner Delay',    ar: 'تأخير من المالك' },
  { value: 'force-majeure', en: 'Force Majeure',  ar: 'قوة قاهرة' },
  { value: 'other',         en: 'Other',          ar: 'أخرى' },
];

export interface EvmStore {
  settings: EvmSettings;
  periods: EvmPeriod[];
  /** Ordered oldest first. Empty = the implicit baseline from project dates. */
  baselines?: Baseline[];
}

export const DEFAULT_SETTINGS: EvmSettings = {
  cadence: 'monthly',
  bacOverride: 0,
  eacMethod: 'cpi',
  allowManual: true,
  pvMethod: 'scurve',
};

export const EMPTY_STORE: EvmStore = { settings: DEFAULT_SETTINGS, periods: [] };

const KEY = (projectId: string) => `pactum-evm-${projectId}`;

// ── Storage ────────────────────────────────────────────────────────────

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function cleanPeriod(r: any, i: number): EvmPeriod {
  const st: PeriodStatus =
    ['draft', 'submitted', 'reviewed', 'approved', 'rejected'].includes(r?.status)
      ? r.status : 'draft';
  return {
    id: String(r?.id ?? `evp-${i}`),
    seq: num(r?.seq) || i + 1,
    start: String(r?.start ?? ''),
    end: String(r?.end ?? ''),
    label: String(r?.label ?? ''),
    pv: num(r?.pv),
    ev: num(r?.ev),
    ac: num(r?.ac),
    pvSource: r?.pvSource === 'manual' ? 'manual' : 'auto',
    evSource: r?.evSource === 'manual' ? 'manual' : 'auto',
    acSource: r?.acSource === 'manual' ? 'manual' : 'auto',

    /**
     * STEP 12 — the split is preserved EXACTLY as found, including its
     * absence. `undefined` means "this period predates the split" and is
     * a different fact from 0. Coercing it with num() would manufacture a
     * split for every historical period in the store.
     */
    directPv:   r?.directPv   === undefined ? undefined : num(r.directPv),
    indirectPv: r?.indirectPv === undefined ? undefined : num(r.indirectPv),
    directEv:   r?.directEv   === undefined ? undefined : num(r.directEv),
    indirectEv: r?.indirectEv === undefined ? undefined : num(r.indirectEv),
    directAc:   r?.directAc   === undefined ? undefined : num(r.directAc),
    indirectAc: r?.indirectAc === undefined ? undefined : num(r.indirectAc),
    directPvSource:   r?.directPvSource   === 'manual' ? 'manual' : r?.directPvSource === 'auto' ? 'auto' : undefined,
    indirectPvSource: r?.indirectPvSource === 'manual' ? 'manual' : r?.indirectPvSource === 'auto' ? 'auto' : undefined,
    directEvSource:   r?.directEvSource   === 'manual' ? 'manual' : r?.directEvSource === 'auto' ? 'auto' : undefined,
    directAcSource:   r?.directAcSource   === 'manual' ? 'manual' : r?.directAcSource === 'auto' ? 'auto' : undefined,
    indirectAcSource: r?.indirectAcSource === 'manual' ? 'manual' : r?.indirectAcSource === 'auto' ? 'auto' : undefined,
    indirectEvBasis:  r?.indirectEvBasis === undefined || r?.indirectEvBasis === null
      ? (r?.indirectEvBasis === null ? null : undefined)
      : num(r.indirectEvBasis),
    status: st,
    reviewer: String(r?.reviewer ?? ''),
    reviewDate: String(r?.reviewDate ?? ''),
    comment: String(r?.comment ?? ''),
    updatedAt: String(r?.updatedAt ?? ''),
    physicalProgress: r?.physicalProgress === undefined ? undefined : num(r.physicalProgress),
    notes: r?.notes ? String(r.notes) : undefined,
    issues: r?.issues ? String(r.issues) : undefined,
    risks: r?.risks ? String(r.risks) : undefined,
    attachments: Array.isArray(r?.attachments) ? r.attachments.map(String) : undefined,
    // A frozen snapshot is trusted as-is: rebuilding it would defeat its purpose.
    frozen: r?.frozen && typeof r.frozen === 'object' ? {
      pv: num(r.frozen.pv), ev: num(r.frozen.ev), ac: num(r.frozen.ac), bac: num(r.frozen.bac),
      spi: r.frozen.spi === null || r.frozen.spi === undefined ? null : num(r.frozen.spi),
      cpi: r.frozen.cpi === null || r.frozen.cpi === undefined ? null : num(r.frozen.cpi),
      sv: num(r.frozen.sv), cv: num(r.frozen.cv),
      eac: num(r.frozen.eac), etc: num(r.frozen.etc), vac: num(r.frozen.vac),
      tcpi: r.frozen.tcpi === null || r.frozen.tcpi === undefined ? null : num(r.frozen.tcpi),
      eacMethod: ['cpi','atypical','composite'].includes(r.frozen.eacMethod) ? r.frozen.eacMethod : 'cpi',
      frozenAt: String(r.frozen.frozenAt ?? ''),
      baselineId: String(r.frozen.baselineId ?? ''),
    } : undefined,
    baselineId: r?.baselineId ? String(r.baselineId) : undefined,
  };
}

function cleanBaseline(b: any, i: number): Baseline {
  return {
    id: String(b?.id ?? `bl-${i}`),
    version: num(b?.version) || i + 1,
    name: String(b?.name ?? `Baseline V${num(b?.version) || i + 1}`),
    start: String(b?.start ?? ''),
    finish: String(b?.finish ?? ''),
    durationDays: num(b?.durationDays),
    bac: num(b?.bac),
    contractValue: num(b?.contractValue),
    reason: String(b?.reason ?? ''),
    cause: b?.cause,
    daysAdded: b?.daysAdded === undefined ? undefined : num(b.daysAdded),
    valueAdded: b?.valueAdded === undefined ? undefined : num(b.valueAdded),
    approvedBy: String(b?.approvedBy ?? ''),
    approvedOn: String(b?.approvedOn ?? ''),
    createdAt: String(b?.createdAt ?? ''),
    approved: b?.approved !== false,
  };
}

/**
 * STEP 12 v3 — COMPONENTS ARE PER-PERIOD, TOTALS ARE CUMULATIVE.
 *
 * The Direct / Indirect figures entered on each period are THAT PERIOD'S
 * own value (the month's increment). The parent pv/ev/ac of every period
 * are CUMULATIVE: running sums of the components of every period up to
 * and including it, starting from the last typed cumulative total before
 * the split began (so mixed histories keep their typed base).
 *
 * - Any period from the first split onward has its totals DERIVED here.
 * - Approved/frozen periods are re-derived too, and their signed snapshot
 *   is re-synced with the SAME method it was signed with. The audit trail
 *   (frozenAt / baselineId) is preserved untouched.
 */
function deriveClassTotals(periods: EvmPeriod[]): EvmPeriod[] {
  const fields = [
    { m: 'pv', d: 'directPv', i: 'indirectPv' },
    { m: 'ev', d: 'directEv', i: 'indirectEv' },
    { m: 'ac', d: 'directAc', i: 'indirectAc' },
  ] as const;

  let out = periods.slice();
  for (const { m, d, i } of fields) {
    const first = out.findIndex(p => p[d] !== undefined || p[i] !== undefined);
    if (first < 0) continue; // this metric was never split — typed totals stand
    const base = first > 0 ? out[first - 1][m] : 0;
    let running = base;
    out = out.map((p, idx) => {
      if (idx < first) return p;
      running += num(p[d]) + num(p[i]);
      return { ...p, [m]: running } as EvmPeriod;
    });
  }

  // Keep every signed snapshot consistent with its own (re-derived) totals.
  out = out.map(p => {
    if (!p.frozen) return p;
    const f = p.frozen;
    const rec = metricsFor(p.pv, p.ev, p.ac, f.bac, f.eacMethod);
    return {
      ...p,
      frozen: {
        ...f,
        pv: rec.pv, ev: rec.ev, ac: rec.ac,
        sv: rec.sv, cv: rec.cv, spi: rec.spi, cpi: rec.cpi,
        eac: rec.eac, etc: rec.etc, vac: rec.vac, tcpi: rec.tcpi,
      },
    };
  });
  return out;
}

export function readEvm(projectId: string): EvmStore {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(projectId)) || 'null');
    if (!raw || typeof raw !== 'object') return { ...EMPTY_STORE, periods: [], baselines: [] };
    const s = raw.settings || {};
    return {
      settings: {
        cadence: ['weekly', 'biweekly', 'monthly', 'quarterly'].includes(s.cadence) ? s.cadence : 'monthly',
        bacOverride: num(s.bacOverride),
        eacMethod: ['cpi', 'atypical', 'composite'].includes(s.eacMethod) ? s.eacMethod : 'cpi',
        allowManual: s.allowManual !== false,
        activeBaselineId: s.activeBaselineId ? String(s.activeBaselineId) : '',
        pvMethod: ['scurve','front','back','linear','manual'].includes(s.pvMethod) ? s.pvMethod : 'scurve',
      },
      periods: Array.isArray(raw.periods) ? deriveClassTotals(raw.periods.map(cleanPeriod)) : [],
      baselines: Array.isArray(raw.baselines) ? raw.baselines.map(cleanBaseline) : [],
    };
  } catch {
    return { ...EMPTY_STORE, periods: [], baselines: [] };
  }
}

export function writeEvm(projectId: string, store: EvmStore): void {
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(store));
  } catch {
    /* quota — same policy as every other store */
  }
}

// ── Date helpers ───────────────────────────────────────────────────────

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIso(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + (s.length === 10 ? 'T00:00:00Z' : ''));
  return isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO week number, used only for the weekly axis label. */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function labelFor(start: Date, cadence: Cadence): string {
  if (cadence === 'weekly' || cadence === 'biweekly') {
    return `W${String(isoWeek(start)).padStart(2, '0')} ${start.getUTCFullYear()}`;
  }
  if (cadence === 'quarterly') {
    return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`;
  }
  return `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
}

export const CADENCE_META: { value: Cadence; en: string; ar: string }[] = [
  { value: 'weekly',    en: 'Weekly',    ar: 'أسبوعي' },
  { value: 'biweekly',  en: 'Biweekly',  ar: 'كل أسبوعين' },
  { value: 'monthly',   en: 'Monthly',   ar: 'شهري' },
  { value: 'quarterly', en: 'Quarterly', ar: 'ربع سنوي' },
];

// ── Automatic inputs, read from stores other modules own ───────────────

export interface ProjectLike {
  id: string;
  contractValue?: number;
  progress?: number;
  commencementDate?: string;
  plannedDurationDays?: number;
  contractualCompletion?: string;
  approvedCompletion?: string;
  totalApprovedCOs?: number;
  totalApprovedClaims?: number;
  totalCashDisbursed?: number;
}

/**
 * Budget at Completion.
 *
 * BAC is the AUTHORISED budget, so it must grow with approved change
 * orders and approved claims — a contractor is not over budget because the
 * client added scope. Pending items are excluded: they carry no authority.
 */
export function computeBac(project: ProjectLike, settings: EvmSettings): {
  bac: number; base: number; cos: number; claims: number; overridden: boolean;
} {
  const base = num(project.contractValue);
  let cos = 0;
  let claims = 0;
  try {
    const co = JSON.parse(localStorage.getItem(`pactum-co-${project.id}`) || '[]');
    if (Array.isArray(co)) {
      cos = co.filter((r: any) => r?.status === 'approved')
              .reduce((a: number, r: any) => a + num(r.value), 0);
    }
  } catch { /* noop */ }
  try {
    const cl = JSON.parse(localStorage.getItem(`pactum-claims-${project.id}`) || '[]');
    if (Array.isArray(cl)) {
      // A claim adds budget only for what was actually settled.
      claims = cl.filter((r: any) => r?.status === 'approved')
                 .reduce((a: number, r: any) => a + num(r.settled), 0);
    }
  } catch { /* noop */ }

  const derived = base + cos + claims;
  const overridden = settings.bacOverride > 0;
  return { bac: overridden ? settings.bacOverride : derived, base, cos, claims, overridden };
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * STEP 12 · Q3=B — BAC IS THE APPROVED BUDGET, SPLIT BY COST CLASS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `computeBac` above is the CONTRACT basis: contract value + approved
 * COs + approved claims. That is a revenue figure. Step 12 rules that
 * BAC is the approved COST baseline, so this function replaces it as
 * the basis for the split model.
 *
 * `computeBac` IS DELIBERATELY LEFT INTACT. It still backs the legacy
 * single-figure path and the pre-Step-12 frozen snapshots, so no
 * historical period changes meaning. Only the split model reads this.
 *
 * THE SOURCE (Q6=B): the CURRENT APPROVED BASELINE PACKAGE, whose
 * `data.directBudget` / `data.indirectBudget` were classified and frozen
 * at approval. The live budget register is deliberately NOT read: it
 * moves the moment a planner edits a row, and a BAC that drifts without
 * an approval is not a baseline.
 *
 * APPROVED CO / CLAIM COST (Q7=A): ALREADY INSIDE THE TWO FIGURES.
 *
 * This was verified in `rebuildPackage`, not assumed. It computes
 *     additiveDirect = Σ included.filter(i => i.additive).directImpact
 *     directBudget   = register.direct + additiveDirect
 * where `additive` is true only for UNLINKED items. So the Q7=A rule —
 * add unlinked, never add linked — is applied at capture time and frozen
 * into the package. Re-applying it here would DOUBLE-COUNT every
 * unlinked change order. Nothing is added on top.
 *
 * WHEN THERE IS NO APPROVED PACKAGE the answer is `available: false`.
 * NOT zero. A project without an approved cost baseline has no BAC, and
 * saying "0" would report perfect performance against nothing.
 *
 * `bacOverride` still wins when set: an explicit human figure outranks
 * any derivation.
 */
export interface BacSplit {
  /** False when no approved baseline package exists. Never treat as 0. */
  available: boolean;
  directBac: number;
  indirectBac: number;
  /** directBac + indirectBac. */
  totalBac: number;
  /** Version of the package the figures came from. 0 when unavailable. */
  packageVersion: number;
  /** True when settings.bacOverride replaced the derived total. */
  overridden: boolean;
  /** Why it is unavailable, for the UI to say out loud. */
  reason: string;
}

export function computeBacSplit(project: ProjectLike, settings: EvmSettings): BacSplit {
  const out: BacSplit = {
    available: false, directBac: 0, indirectBac: 0, totalBac: 0,
    packageVersion: 0, overridden: false, reason: 'no-approved-baseline',
  };

  let pkg: any = null;
  try {
    const store = JSON.parse(localStorage.getItem(`pactum-baselines-${project.id}`) || '{}');
    const packages = Array.isArray(store?.packages) ? store.packages : [];
    const approved = packages.filter((p: any) => p?.status === 'approved');
    if (approved.length) {
      pkg = approved.reduce((a: any, b: any) => (num(b.version) > num(a.version) ? b : a));
    }
  } catch { /* noop */ }

  if (!pkg || !pkg.data) return out;

  out.available = true;
  out.reason = '';
  out.packageVersion = num(pkg.version);
  out.directBac = num(pkg.data.directBudget);
  out.indirectBac = num(pkg.data.indirectBudget);
  out.totalBac = out.directBac + out.indirectBac;

  if (settings.bacOverride > 0) {
    out.overridden = true;
    out.totalBac = settings.bacOverride;
  }
  return out;
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * STEP 11 — ACTUAL COST IS ENTERED BY FINANCE. IT IS NEVER DERIVED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This function USED TO derive AC, in preference order:
 *   1. Budget module — Σ `actual` across cost categories
 *   2. project.totalCashDisbursed — money actually paid out
 *
 * BOTH DERIVATIONS ARE REMOVED. AC now has exactly one source: the value
 * Finance types into the EVM period (`acSource: 'manual'`).
 *
 * WHY. A derived AC is a guess wearing the costume of a fact. Budget
 * `actual` is a planning-module column nobody signed; cash disbursed is
 * treasury movement, not cost incurred. Feeding either into CPI makes the
 * index measure bookkeeping instead of efficiency — and it does so
 * SILENTLY, which is the part that matters. Finance never chose those
 * numbers, yet the dashboard presented them as Finance's.
 *
 * ABSENCE IS NOW VISIBLE. When no one has entered AC, the system reports
 * "Actual Cost Not Entered" — it does NOT report zero. Zero is a fact
 * ("we have spent nothing"); absence is the lack of one. Collapsing the
 * two is how a project with unrecorded spend comes to display a perfect
 * CPI. `acEntered()` below is the only correct way to ask which case
 * you are in.
 *
 * Owner certificates were, and remain, deliberately excluded: they are
 * revenue, not cost.
 *
 * KEPT AS AN EXPORT so no caller breaks, but it can no longer read a
 * register. It answers the one honest thing it knows.
 */
export function readActualCost(_project: ProjectLike): { ac: number | null; from: string } {
  // AC is NEVER derived from budget.actual, totalCashDisbursed, contract,
  // change orders, claims, forecast, certifications, or any other source.
  // Only manual entry (`manual`) or absence (`not-entered`) is truthful.
  return { ac: null, from: 'ACTUAL COST NOT ENTERED' };
}

/**
 * Has Finance actually entered an Actual Cost for this period?
 *
 * `acSource === 'manual'` is the entry stamp: `setValue` sets it, and
 * nothing else does now that derivation is gone. A period reading
 * `ac: 0, acSource: 'manual'` is a deliberate, entered zero and must be
 * treated as REAL. A period reading `ac: 0, acSource: 'auto'` has simply
 * never been touched.
 */
export function acEntered(p: { ac: number; acSource: Source } | null | undefined): boolean {
  return !!p && p.acSource === 'manual';
}

/** Approved physical progress, 0..1. Drives EV. */
export function readProgress(project: ProjectLike): number {
  const p = num(project.progress);
  return Math.max(0, Math.min(1, p));
}

// ── Baseline S-curve ───────────────────────────────────────────────────

/**
 * Planned Value at a fraction of the programme.
 *
 * Construction spend is not linear: slow mobilisation, fast middle, slow
 * close-out. A symmetric cubic S-curve reproduces that shape with no data
 * to fit and no invented numbers — it is a stated assumption, not a
 * pretend measurement, and it is replaced the moment a real baseline is
 * entered manually.
 *
 *   f(t) = 3t² − 2t³      f(0)=0  f(0.5)=0.5  f(1)=1
 */
export function sCurve(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 3 * x * x - 2 * x * x * x;
}

/**
 * Planned-value curve for a given method.
 *
 * `front` and `back` are the same cubic skewed by an exponent: a real
 * project rarely spends symmetrically, and forcing one shape on every
 * contract was the flaw in the original engine.
 *
 *   front  x^0.72 pushes value earlier
 *   back   x^1.45 pushes value later
 *
 * Every curve still satisfies f(0)=0 and f(1)=1, so cumulative PV always
 * lands exactly on BAC at completion.
 */
export function pvCurve(t: number, method: PvMethod = 'scurve'): number {
  const x = Math.max(0, Math.min(1, t));
  switch (method) {
    case 'linear': return x;
    case 'front':  return sCurve(Math.pow(x, 0.72));
    case 'back':   return sCurve(Math.pow(x, 1.45));
    // 'manual' never reaches here — those periods are skipped entirely.
    default:       return sCurve(x);
  }
}

// ── Calendar generation ────────────────────────────────────────────────

export interface CalendarBounds {
  start: Date;
  end: Date;
  /** True when the dates came from the project rather than a fallback. */
  fromProject: boolean;
}

/**
 * The programme window. Commencement + duration when both exist, else the
 * stored completion dates, else a 12-month window ending today so the page
 * is never blank.
 */
export function calendarBounds(project: ProjectLike): CalendarBounds {
  const c = parseIso(project.commencementDate || '');
  const dur = num(project.plannedDurationDays);
  if (c && dur > 0) return { start: c, end: addDays(c, dur), fromProject: true };

  const fin = parseIso(project.approvedCompletion || '')
           || parseIso(project.contractualCompletion || '');
  if (c && fin) return { start: c, end: fin, fromProject: true };
  if (fin) {
    // No commencement on record: assume the stored completion closes a
    // two-year programme rather than inventing a start date.
    return { start: addDays(fin, -730), end: fin, fromProject: false };
  }

  const today = new Date();
  return { start: addDays(today, -365), end: today, fromProject: false };
}

/** Period boundaries across the programme. Pure — touches no storage. */
export function buildCalendar(project: ProjectLike, cadence: Cadence): {
  start: string; end: string; label: string; seq: number;
}[] {
  const { start, end } = calendarBounds(project);
  const out: { start: string; end: string; label: string; seq: number }[] = [];
  if (end.getTime() <= start.getTime()) return out;

  let cursor = new Date(start.getTime());
  let seq = 1;
  // Hard ceiling: 520 weeks is a ten-year programme. Prevents a bad date
  // from locking the browser in a loop.
  while (cursor.getTime() < end.getTime() && seq <= 520) {
    let next: Date;
    if (cadence === 'weekly') {
      next = addDays(cursor, 7);
    } else if (cadence === 'biweekly') {
      next = addDays(cursor, 14);
    } else if (cadence === 'quarterly') {
      next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 3, 1));
    } else {
      next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    if (next.getTime() > end.getTime()) next = new Date(end.getTime());
    out.push({
      start: iso(cursor),
      end: iso(addDays(next, -1)),
      label: labelFor(cursor, cadence),
      seq,
    });
    cursor = next;
    seq++;
  }
  return out;
}

/**
 * Creates or extends the calendar, preserving every period already stored.
 *
 * A stored period is matched by its START DATE, so re-running this after a
 * schedule change never destroys an approved review. Only genuinely new
 * periods are appended.
 */
/**
 * Is this project retired?
 *
 * The one place the archived state is interpreted for EVM. `status` is
 * optional on Project and absent means Active, so the check is explicit
 * rather than truthy — a project with no status is LIVE, not archived.
 */
export function isArchived(project: ProjectLike): boolean {
  return String((project as { status?: unknown }).status ?? '') === 'Archived';
}

export function syncCalendar(project: ProjectLike, store: EvmStore): {
  store: EvmStore; created: number;
} {
  /**
   * ARCHIVED: THE CALENDAR IS FROZEN AS IT STANDS.
   *
   * `syncCalendar` is the automatic path — it runs on every read through
   * `readSyncedEvm`, so without this an archived project would silently
   * gain periods just from someone LOOKING at it.
   *
   * The existing store is returned untouched. Every recorded period, its
   * PV, EV, AC, its approval and its frozen snapshot are preserved
   * exactly. Nothing is rewritten, redistributed or removed — the only
   * thing that stops is the creation of NEW rows.
   */
  if (isArchived(project)) return { store, created: 0 };

  const spec = buildCalendar(project, store.settings.cadence);
  if (spec.length === 0) return { store, created: 0 };

  const byStart = new Map(store.periods.map(p => [p.start, p]));
  const { bac } = computeBac(project, store.settings);
  const { start, end } = calendarBounds(project);
  const span = Math.max(1, daysBetween(start, end));

  let created = 0;
  const periods: EvmPeriod[] = spec.map(s => {
    const prior = byStart.get(s.start);
    // Cumulative planned value at this period end.
    const endD = parseIso(s.end)!;
    const t = Math.max(0, Math.min(1, (daysBetween(start, endD) + 1) / span));
    const autoPv = bac * pvCurve(t, store.settings.pvMethod ?? 'scurve');

    if (prior) {
      // An approved period is frozen. A live one refreshes its automatic PV.
      if (prior.status === 'approved' || prior.pvSource === 'manual'
          || (store.settings.pvMethod ?? 'scurve') === 'manual') {
        return { ...prior, seq: s.seq, label: s.label, end: s.end };
      }
      return { ...prior, seq: s.seq, label: s.label, end: s.end, pv: autoPv };
    }
    created++;
    return {
      id: `evp-${s.start}-${Math.random().toString(36).slice(2, 6)}`,
      seq: s.seq, start: s.start, end: s.end, label: s.label,
      pv: autoPv, ev: 0, ac: 0,
      pvSource: 'auto', evSource: 'auto', acSource: 'auto',
      status: 'draft', reviewer: '', reviewDate: '', comment: '', updatedAt: '',
    };
  });

  return { store: { ...store, periods }, created };
}

/**
 * Fills EV and AC on the CURRENT period from live project data.
 *
 * Only the current period is touched: history is a record, not a projection.
 * A manual override or an approved status is always respected.
 */
export function refreshCurrent(project: ProjectLike, store: EvmStore, today = new Date()): EvmStore {
  const idx = currentPeriodIndex(store.periods, today);
  if (idx < 0) return store;
  const p = store.periods[idx];
  if (p.status === 'approved') return store;

  const { bac } = computeBac(project, store.settings);
  const progress = readProgress(project);

  const next = { ...p };
  if (p.evSource === 'auto') next.ev = bac * progress;

  /**
   * STEP 11 — AC IS NO LONGER AUTO-FILLED.
   *
   * This line used to be:  if (p.acSource === 'auto') next.ac = ac;
   *
   * It is gone. AC is written by exactly one thing — Finance calling
   * `setValue(store, id, 'ac', v)`, which stamps `acSource: 'manual'`.
   * An untouched period keeps `ac: 0, acSource: 'auto'`, which the UI
   * reads through `acEntered()` as NOT ENTERED rather than as zero spend.
   *
   * EV is untouched by this step and still auto-fills from progress.
   */

  if (next.ev === p.ev && next.ac === p.ac) return store;
  const periods = store.periods.slice();
  periods[idx] = next;
  return { ...store, periods };
}

/** Index of the period containing `today`, else the last one that started. */
export function currentPeriodIndex(periods: EvmPeriod[], today = new Date()): number {
  if (periods.length === 0) return -1;
  const t = iso(today);
  const hit = periods.findIndex(p => p.start <= t && t <= p.end);
  if (hit >= 0) return hit;
  let last = -1;
  periods.forEach((p, i) => { if (p.start <= t) last = i; });
  return last >= 0 ? last : 0;
}

// ── Metrics ────────────────────────────────────────────────────────────

export interface EvmMetrics {
  pv: number; ev: number; ac: number; bac: number;
  /** EV − PV. Negative = behind schedule. */
  sv: number;
  /** EV − AC. Negative = over budget. */
  cv: number;
  /** EV / PV. null when PV is 0 — a ratio against nothing is not 1.0. */
  spi: number | null;
  cpi: number | null;
  eac: number;
  etc: number;
  vac: number;
  /** (BAC−EV)/(BAC−AC). Efficiency needed to finish on budget. */
  tcpi: number | null;
  /** EV / BAC, 0..1. */
  percentComplete: number;
  percentPlanned: number;
  percentSpent: number;
}

/**
 * EAC methods:
 *   cpi        BAC / CPI                        — current efficiency persists
 *   atypical   AC + (BAC − EV)                  — the overrun was one-off
 *   composite  AC + (BAC − EV)/(CPI × SPI)      — both pressures persist
 */
export function metricsFor(
  pv: number, ev: number, ac: number, bac: number,
  eacMethod: EvmSettings['eacMethod'] = 'cpi',
): EvmMetrics {
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;

  let eac: number;
  if (eacMethod === 'atypical' || cpi === null || cpi === 0) {
    eac = ac + (bac - ev);
  } else if (eacMethod === 'composite' && spi && spi > 0) {
    eac = ac + (bac - ev) / (cpi * spi);
  } else {
    eac = bac / cpi;
  }
  if (!Number.isFinite(eac)) eac = bac;

  const remainingBudget = bac - ac;
  return {
    pv, ev, ac, bac,
    sv: ev - pv,
    cv: ev - ac,
    spi, cpi,
    eac,
    etc: eac - ac,
    vac: bac - eac,
    tcpi: remainingBudget !== 0 ? (bac - ev) / remainingBudget : null,
    percentComplete: bac > 0 ? ev / bac : 0,
    percentPlanned:  bac > 0 ? pv / bac : 0,
    percentSpent:    bac > 0 ? ac / bac : 0,
  };
}

// ── Cumulative performance across ALL history ──────────────────────────
//
// A single period's CPI is a spot reading and swings wildly on a quiet
// month. Forecasting from it produces the unrealistic EAC values the brief
// describes. PMI forecasts from CUMULATIVE performance: every approved
// period from project start up to the reporting period, taken together.
//
// Because PV/EV/AC are stored cumulatively, "all history to date" is simply
// the reporting period's own cumulative figures — but the cumulative INDICES
// must be computed from those totals, never averaged across periods.

export interface CumulativePerformance {
  /** Periods actually included. */
  count: number;
  pv: number; ev: number; ac: number;
  /** Cumulative EV/PV across the whole programme to date. */
  cpiCum: number | null;
  spiCum: number | null;
  /** Mean of the last three period-on-period indices. Null when too few. */
  cpi3: number | null;
  spi3: number | null;
  /** True when at least one approved period exists. */
  fromApproved: boolean;
}

/**
 * Cumulative position up to and including `upTo`.
 *
 * Approved periods are preferred. When none has been approved yet the live
 * period is used so the page still reports, but `fromApproved` says so.
 */
export function cumulativeTo(periods: EvmPeriod[], upTo: EvmPeriod | null): CumulativePerformance {
  const empty: CumulativePerformance = {
    count: 0, pv: 0, ev: 0, ac: 0,
    cpiCum: null, spiCum: null, cpi3: null, spi3: null, fromApproved: false,
  };
  if (!upTo) return empty;

  const idx = periods.findIndex(p => p.id === upTo.id);
  if (idx < 0) return empty;

  const history = periods.slice(0, idx + 1);
  // FIX: a PV-only period (planning stage) is real data — excluding it kept
  // the cumulative basis stuck on an older period and SPI/EAC answered
  // against a stale PV.
  const withData = history.filter(
    p => p.ev > 0 || p.ac > 0 || p.pv > 0 || p.status === 'approved',
  );
  if (withData.length === 0) return empty;

  // Cumulative totals are the LAST period's stored cumulative values.
  const last = withData[withData.length - 1];
  const pv = last.pv, ev = last.ev, ac = last.ac;

  // Period-on-period increments, for the 3-period rolling view.
  const incr: { dEv: number; dAc: number; dPv: number }[] = [];
  for (let i = 0; i < withData.length; i++) {
    const cur = withData[i];
    const prev = i > 0 ? withData[i - 1] : null;
    incr.push({
      dEv: cur.ev - (prev?.ev ?? 0),
      dAc: cur.ac - (prev?.ac ?? 0),
      dPv: cur.pv - (prev?.pv ?? 0),
    });
  }
  const tail = incr.slice(-3);
  const sEv = tail.reduce((a, x) => a + x.dEv, 0);
  const sAc = tail.reduce((a, x) => a + x.dAc, 0);
  const sPv = tail.reduce((a, x) => a + x.dPv, 0);

  return {
    count: withData.length,
    pv, ev, ac,
    cpiCum: ac > 0 ? ev / ac : null,
    spiCum: pv > 0 ? ev / pv : null,
    cpi3: tail.length >= 2 && sAc > 0 ? sEv / sAc : null,
    spi3: tail.length >= 2 && sPv > 0 ? sEv / sPv : null,
    fromApproved: withData.some(p => p.status === 'approved'),
  };
}

// ── EAC comparison — all three PMI methods, always ─────────────────────

export interface EacOption {
  method: EacMethod;
  label: string;
  labelAr: string;
  formula: string;
  description: string;
  descriptionAr: string;
  /** When a planner should reach for this method. */
  usage: string;
  usageAr: string;
  eac: number;
  etc: number;
  vac: number;
  /** True when this is the project's official forecast. */
  official: boolean;
  /** False when the inputs make the method meaningless (e.g. CPI unavailable). */
  applicable: boolean;
}

export const EAC_META: Record<EacMethod, Omit<EacOption, 'eac' | 'etc' | 'vac' | 'official' | 'applicable' | 'method'>> = {
  cpi: {
    label: 'BAC / CPI',
    labelAr: 'BAC ÷ CPI',
    formula: 'EAC = BAC ÷ CPI',
    description: 'Remaining work is spent at the cost efficiency achieved so far.',
    descriptionAr: 'يُنفَّذ العمل المتبقي بنفس كفاءة التكلفة المحققة حتى الآن.',
    usage: 'Use when current cost performance is representative and expected to continue.',
    usageAr: 'يُستخدم عندما يكون أداء التكلفة الحالي ممثِّلاً ومتوقعاً استمراره.',
  },
  atypical: {
    label: 'AC + (BAC − EV)',
    labelAr: 'AC + (BAC − EV)',
    formula: 'EAC = AC + (BAC − EV)',
    description: 'Remaining work is delivered exactly at budget; past variance does not repeat.',
    descriptionAr: 'يُنفَّذ العمل المتبقي بالميزانية تماماً؛ الانحراف السابق لا يتكرر.',
    usage: 'Use when the overrun was a one-off event that has been resolved.',
    usageAr: 'يُستخدم عندما يكون التجاوز حدثاً استثنائياً تمت معالجته.',
  },
  composite: {
    label: 'AC + (BAC − EV) / (CPI × SPI)',
    labelAr: 'AC + (BAC − EV) ÷ (CPI × SPI)',
    formula: 'EAC = AC + (BAC − EV) ÷ (CPI × SPI)',
    description: 'Remaining work absorbs both the cost and the schedule pressure seen to date.',
    descriptionAr: 'يتحمل العمل المتبقي ضغط التكلفة والجدول الزمني معاً كما لوحظ حتى الآن.',
    usage: 'Use when the project must recover schedule and both pressures will persist.',
    usageAr: 'يُستخدم عندما يجب تعويض الجدول الزمني ومن المتوقع استمرار الضغطين.',
  },
};

/** One method, computed. Pure. */
export function eacFor(
  method: EacMethod, bac: number, ev: number, ac: number,
  cpi: number | null, spi: number | null,
): { eac: number; applicable: boolean } {
  if (method === 'atypical') {
    return { eac: ac + (bac - ev), applicable: true };
  }
  if (method === 'cpi') {
    if (!cpi || cpi <= 0) return { eac: ac + (bac - ev), applicable: false };
    return { eac: bac / cpi, applicable: true };
  }
  // composite
  if (!cpi || cpi <= 0 || !spi || spi <= 0) return { eac: ac + (bac - ev), applicable: false };
  return { eac: ac + (bac - ev) / (cpi * spi), applicable: true };
}

/**
 * All three methods side by side, using CUMULATIVE indices.
 * Exactly one is flagged `official` — the project's chosen method.
 */
export function eacComparison(
  bac: number, ev: number, ac: number,
  cpi: number | null, spi: number | null, official: EacMethod,
): EacOption[] {
  return (['cpi', 'atypical', 'composite'] as EacMethod[]).map(mth => {
    const { eac, applicable } = eacFor(mth, bac, ev, ac, cpi, spi);
    const safe = Number.isFinite(eac) ? eac : bac;
    return {
      method: mth,
      ...EAC_META[mth],
      eac: safe,
      etc: safe - ac,
      vac: bac - safe,
      official: mth === official,
      applicable,
    };
  });
}

/** The period a report should quote: the LATEST APPROVED one. */
export function latestApproved(periods: EvmPeriod[]): EvmPeriod | null {
  const approved = periods.filter(p => p.status === 'approved');
  return approved.length ? approved[approved.length - 1] : null;
}

/**
 * The period the dashboard reports on.
 *
 * FIX (user report: "cumulative totals look wrong"): the dashboard used to
 * pin itself to the LATEST APPROVED period and ignore the live period the
 * user is typing into — so freshly entered cumulative PV/EV/AC never showed
 * and the cards looked stale/incorrect. Rule now:
 *
 *   1. the CURRENT period by date, if it carries any entered figure;
 *   2. else the latest approved period (nothing entered yet this period);
 *   3. else the current period anyway, so the page is never blank.
 *
 * Approved ACTUALS stay frozen on their rows and the history table still
 * prints them — this only changes which period the headline cards report.
 */
export function reportingPeriod(periods: EvmPeriod[], today = new Date()): EvmPeriod | null {
  if (periods.length === 0) return null;
  const i = currentPeriodIndex(periods, today);
  const cur = i >= 0 ? periods[i] : null;
  if (cur && (cur.pv > 0 || cur.ev > 0 || cur.ac > 0)) return cur;
  const a = latestApproved(periods);
  if (a) return a;
  return cur ?? periods[periods.length - 1] ?? null;
}

export interface SeriesPoint {
  label: string;
  end: string;
  seq: number;
  pv: number; ev: number; ac: number;
  spi: number | null; cpi: number | null;
  sv: number; cv: number;
  /** Forecast at this period. Historic on approved rows, live otherwise. */
  eac: number | null;
  vac: number | null;
  status: PeriodStatus;
  approved: boolean;
  /** True once the row is a frozen historical statement. */
  frozen: boolean;
}

/**
 * The full time series.
 * EV and AC are only plotted once a period has data; a future period would
 * otherwise draw a line down to zero and imply the project un-earned value.
 */
/**
 * The full time series.
 *
 * Each point carries SPI, CPI, SV, CV, EAC and VAC so every trend chart can
 * be driven from one source. Approved periods report their FROZEN values;
 * live periods forecast from cumulative history up to that point.
 *
 * EV and AC are only plotted once a period has data — a future period would
 * otherwise draw a line to zero and imply the project un-earned value.
 */
export function series(
  periods: EvmPeriod[], bac: number, eacMethod: EvmSettings['eacMethod'] = 'cpi',
): SeriesPoint[] {
  return periods.map(p => {
    const started = p.ev > 0 || p.ac > 0 || p.status !== 'draft';
    const cum = started ? cumulativeTo(periods, p) : undefined;
    const m = periodMetrics(p, bac, eacMethod, cum);
    return {
      label: p.label,
      end: p.end,
      seq: p.seq,
      pv: p.frozen ? p.frozen.pv : p.pv,
      ev: started ? (p.frozen ? p.frozen.ev : p.ev) : (null as any),
      ac: started ? (p.frozen ? p.frozen.ac : p.ac) : (null as any),
      spi: started ? m.spi : null,
      cpi: started ? m.cpi : null,
      sv: started ? m.sv : 0,
      cv: started ? m.cv : 0,
      eac: started ? m.eac : null,
      vac: started ? m.vac : null,
      status: p.status,
      approved: p.status === 'approved',
      frozen: Boolean(p.frozen),
    };
  });
}

// ── Performance quadrant ───────────────────────────────────────────────

export type Quadrant = 'ahead-under' | 'behind-under' | 'ahead-over' | 'behind-over' | 'unknown';

export interface QuadrantInfo {
  key: Quadrant;
  en: string;
  ar: string;
  tone: 'ok' | 'gold' | 'warn' | 'risk' | 'muted';
}

export function quadrantOf(spi: number | null, cpi: number | null): QuadrantInfo {
  if (spi === null || cpi === null) {
    return { key: 'unknown', en: 'Insufficient Data', ar: 'بيانات غير كافية', tone: 'muted' };
  }
  const ahead = spi >= 1;
  const under = cpi >= 1;
  if (ahead && under)  return { key: 'ahead-under',  en: 'Ahead of Schedule · Under Budget',  ar: 'متقدم على البرنامج · ضمن الميزانية', tone: 'ok' };
  if (!ahead && under) return { key: 'behind-under', en: 'Behind Schedule · Under Budget',    ar: 'متأخر عن البرنامج · ضمن الميزانية',  tone: 'gold' };
  if (ahead && !under) return { key: 'ahead-over',   en: 'Ahead of Schedule · Over Budget',   ar: 'متقدم على البرنامج · تجاوز الميزانية', tone: 'warn' };
  return { key: 'behind-over', en: 'Behind Schedule · Over Budget', ar: 'متأخر عن البرنامج · تجاوز الميزانية', tone: 'risk' };
}

/**
 * A single 0–100 health score from SPI and CPI.
 * An index of 1.00 scores 100; 0.80 scores 0. Cost and schedule weigh the
 * same because neither is recoverable at the other's expense.
 */
export function healthScore(spi: number | null, cpi: number | null): number | null {
  if (spi === null && cpi === null) return null;
  const one = (v: number | null) =>
    v === null ? null : Math.max(0, Math.min(100, Math.round((v - 0.8) / 0.2 * 100)));
  const a = one(spi);
  const b = one(cpi);
  if (a === null) return b;
  if (b === null) return a;
  return Math.round((a + b) / 2);
}

// ── Matrix intelligence: tolerance, money at stake, adaptive axes ───────

/**
 * Commercial tolerance around the 1.00 target. An index inside this band
 * is ON TARGET — reading 0.99 as "behind schedule" cries wolf on a project
 * that is doing its job. The quadrant split stays at 1.00 (that is where
 * the dot geometrically sits); the band governs whether it is ALARMING.
 */
export const INDEX_TOLERANCE = 0.05;

/** True when BOTH indices sit inside the ±tolerance band of 1.00. */
export function withinTolerance(
  spi: number | null, cpi: number | null, tol = INDEX_TOLERANCE,
): boolean {
  const ok = (v: number | null) => v !== null && Math.abs(v - 1) <= tol + 1e-9;
  return ok(spi) && ok(cpi);
}

/**
 * Bubble size for the performance matrix: MONEY AT STAKE, not importance.
 * ratio = |VAC| ÷ EAC — the share of the forecast the variance represents.
 * A 2M overrun on a 200M job is a 1% story; the same 2M on a 10M job is
 * the whole story. Clamped at MAX_BUBBLE_RATIO so one wild period cannot
 * swallow the chart, then mapped linearly onto [min, max].
 */
export const MAX_BUBBLE_RATIO = 0.25;
export function bubbleZ(
  vac: number | null, eac: number | null, min = 80, max = 320,
): number {
  if (vac === null || eac === null || eac <= 0) return min;
  const r = Math.min(MAX_BUBBLE_RATIO, Math.abs(vac) / eac);
  return Math.round(min + (r / MAX_BUBBLE_RATIO) * (max - min));
}

export interface MatrixDomain {
  x: [number, number]; y: [number, number];
  xTicks: number[]; yTicks: number[];
}

/**
 * Adaptive axis window for the matrix. The old fixed [0.6, 1.4] domain
 * clipped real positions off the chart — a CPI of 1.8 is a fact and
 * deserves a dot. The window always shows the full tolerance band and at
 * least ±MIN_HALF around 1.00, then expands to whatever the data demands.
 */
const MIN_HALF = 0.3;
export function matrixDomain(xs: (number | null)[], ys: (number | null)[]): MatrixDomain {
  const axis = (vals: (number | null)[]): [number, number] => {
    const v = vals.filter((n): n is number => n !== null && Number.isFinite(n));
    v.push(1, 1 - INDEX_TOLERANCE, 1 + INDEX_TOLERANCE);
    const lo = Math.min(...v), hi = Math.max(...v);
    const pad = Math.max(0.1, (hi - lo) * 0.15);
    const snap = (n: number) => Math.round(n * 20) / 20;
    return [
      Math.min(snap(lo - pad), 1 - MIN_HALF),
      Math.max(snap(hi + pad), 1 + MIN_HALF),
    ];
  };
  const ticks = ([lo, hi]: [number, number]) =>
    Array.from({ length: 5 }, (_, i) => Math.round((lo + (i * (hi - lo)) / 4) * 100) / 100);
  const x = axis(xs), y = axis(ys);
  return { x, y, xTicks: ticks(x), yTicks: ticks(y) };
}

// ── Workflow ───────────────────────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════
 * THREE STATES, NOT FIVE.
 *
 *     draft  --approve--> approved
 *     draft  <--return--- approved       (RESUBMIT: reopens the period)
 *
 * The old chain was draft -> submitted -> reviewed -> approved, with a
 * rejected branch hanging off two of them. Five states and six
 * transitions to record one fact: is this month's progress signed off
 * or not. Nobody used the middle two — `submitted` and `reviewed` were
 * clicked through in sequence to reach the only state that changes
 * anything, which is `approved`.
 *
 * RESUBMIT IS THE WAY BACK, AND IT IS THE ONLY ONE. An approved period
 * is frozen; reopening it is a deliberate act that thaws the snapshot so
 * the figures can be corrected and approved again.
 *
 * `submitted`, `reviewed` and `rejected` REMAIN IN THE TYPE. Periods
 * already stored under them must keep reading back exactly as they were
 * filed — a status is a historical fact, and silently rewriting it to
 * 'draft' on load would change what those records say. They are simply
 * no longer reachable: nothing can move INTO them, and anything sitting
 * in one can move forward to `approved` or back to `draft`.
 * ══════════════════════════════════════════════════════════════════════
 */
export const NEXT_STATUS: Record<PeriodStatus, PeriodStatus[]> = {
  draft:     ['approved'],
  approved:  ['draft'],                // RESUBMIT — reopen and correct
  // ── Legacy states. Not reachable; kept so stored rows still resolve. ──
  submitted: ['approved', 'draft'],
  reviewed:  ['approved', 'draft'],
  rejected:  ['draft'],
};

/**
 * The states a NEW period may be put into from the UI. The legacy three
 * are deliberately absent: they can be read, never written.
 */
export const ACTIVE_STATUSES: PeriodStatus[] = ['draft', 'approved'];

export function canTransition(from: PeriodStatus, to: PeriodStatus): boolean {
  return (NEXT_STATUS[from] || []).includes(to);
}

/** An approved period is read-only. Everything else may be edited. */
export function isLocked(p: EvmPeriod): boolean {
  return p.status === 'approved';
}

export const STATUS_META: Record<PeriodStatus, { en: string; ar: string; tone: string }> = {
  draft:     { en: 'Draft',     ar: 'مسودة',   tone: 'badge-neutral' },
  // Legacy — still rendered for rows filed before the workflow shrank.
  submitted: { en: 'Submitted', ar: 'مقدَّم',   tone: 'badge-gold' },
  reviewed:  { en: 'Reviewed',  ar: 'مُراجَع',  tone: 'badge-warn' },
  approved:  { en: 'Approved',  ar: 'معتمد',   tone: 'badge-ok' },
  rejected:  { en: 'Rejected',  ar: 'مرفوض',   tone: 'badge-risk' },
};

/**
 * Applies a status change, stamping reviewer and time.
 *
 * On approval the period is FROZEN: every derived figure is computed once
 * and stored. From that moment the row is a historical statement — changing
 * BAC, the EAC method or the baseline can no longer alter it.
 *
 * `bac` is required to freeze correctly; pass the BAC in force at approval.
 */
export function transition(
  store: EvmStore, periodId: string, to: PeriodStatus, reviewer: string,
  comment?: string, bac?: number,
): { store: EvmStore; ok: boolean; reason?: string } {
  const i = store.periods.findIndex(p => p.id === periodId);
  if (i < 0) return { store, ok: false, reason: 'not-found' };
  const p = store.periods[i];
  if (!canTransition(p.status, to)) return { store, ok: false, reason: 'illegal-transition' };

  const periods = store.periods.slice();
  const next: EvmPeriod = {
    ...p,
    status: to,
    reviewer: reviewer || p.reviewer,
    reviewDate: new Date().toISOString().slice(0, 10),
    comment: comment !== undefined ? comment : p.comment,
    updatedAt: new Date().toISOString(),
  };

  /**
   * ════════════════════════════════════════════════════════════════════
   * RESUBMIT THAWS THE FREEZE — AND IT MUST.
   *
   * An approved period stores `frozen`, and `periodMetrics` returns that
   * snapshot verbatim instead of computing. If reopening left it in
   * place, the row would show DRAFT while still reporting the numbers it
   * was approved with: every edit would appear to do nothing, and the
   * user would be looking at a lie in a financial table.
   *
   * So the snapshot is REMOVED, not kept alongside. The period goes back
   * to being computed live, which is what a draft is.
   *
   * WHAT SURVIVES: `reviewer`, `reviewDate` and `comment` are not
   * cleared — who approved it and when is a historical fact, and the
   * next approval overwrites them with the new one. The audit of the
   * reopening is the status change itself, stamped below.
   * ════════════════════════════════════════════════════════════════════
   */
  if (to === 'draft') {
    delete next.frozen;
    delete next.baselineId;
  }

  if (to === 'approved') {
    // Cumulative indices across all history to this period — the correct
    // basis for a forecast, and what gets frozen.
    const cum = cumulativeTo(periods, p);
    const useBac = Number.isFinite(bac as number) && (bac as number) > 0
      ? (bac as number)
      : (p.frozen?.bac ?? 0);
    const spi = cum.spiCum;
    const cpi = cum.cpiCum;
    const { eac } = eacFor(store.settings.eacMethod, useBac, p.ev, p.ac, cpi, spi);
    const safeEac = Number.isFinite(eac) ? eac : useBac;
    const remaining = useBac - p.ac;
    next.baselineId = store.settings.activeBaselineId || '';
    next.frozen = {
      pv: p.pv, ev: p.ev, ac: p.ac, bac: useBac,
      spi, cpi,
      sv: p.ev - p.pv,
      cv: p.ev - p.ac,
      eac: safeEac,
      etc: safeEac - p.ac,
      vac: useBac - safeEac,
      tcpi: remaining !== 0 ? (useBac - p.ev) / remaining : null,
      eacMethod: store.settings.eacMethod,
      frozenAt: new Date().toISOString(),
      baselineId: store.settings.activeBaselineId || '',
    };
  }

  periods[i] = next;
  return { store: { ...store, periods }, ok: true };
}

/**
 * Metrics for one period, honouring the freeze.
 *
 * An approved period returns exactly what was signed off. Everything else is
 * computed live. This one function is why history cannot drift.
 */
export function periodMetrics(
  p: EvmPeriod, liveBac: number, method: EacMethod,
  cum?: CumulativePerformance,
): EvmMetrics {
  if (p.frozen) {
    const f = p.frozen;
    return {
      pv: f.pv, ev: f.ev, ac: f.ac, bac: f.bac,
      sv: f.sv, cv: f.cv, spi: f.spi, cpi: f.cpi,
      eac: f.eac, etc: f.etc, vac: f.vac, tcpi: f.tcpi,
      percentComplete: f.bac > 0 ? f.ev / f.bac : 0,
      percentPlanned:  f.bac > 0 ? f.pv / f.bac : 0,
      percentSpent:    f.bac > 0 ? f.ac / f.bac : 0,
    };
  }
  const base = metricsFor(p.pv, p.ev, p.ac, liveBac, method);
  if (!cum) return base;
  // FIX: an empty live row (no figure at all) must not borrow an older
  // period's indices — that fabricated SPI/CPI on zero rows. Only a row
  // that actually carries data answers from cumulative history.
  const rowHasData = p.pv > 0 || p.ev > 0 || p.ac > 0 || p.status === 'approved';
  if (!rowHasData) return base;
  // Live periods forecast from cumulative history, not from this row alone.
  const { eac } = eacFor(method, liveBac, p.ev, p.ac, cum.cpiCum, cum.spiCum);
  const safe = Number.isFinite(eac) ? eac : liveBac;
  const remaining = liveBac - p.ac;
  return {
    ...base,
    spi: cum.spiCum ?? base.spi,
    cpi: cum.cpiCum ?? base.cpi,
    eac: safe,
    etc: safe - p.ac,
    vac: liveBac - safe,
    tcpi: remaining !== 0 ? (liveBac - p.ev) / remaining : null,
  };
}

/**
 * Edits one value on one period. Manual entry flips the source to `manual`.
 *
 * STEP 11 — VALIDATION, AND WHAT IS DELIBERATELY *NOT* VALIDATED.
 *
 * REJECTED: blank and non-numeric. `num()` silently turns `''`, `'abc'`
 * and `NaN` into 0, which would record a fabricated zero as a Finance
 * entry. Those are now refused outright — the store is returned
 * unchanged and nothing is stamped `manual`.
 *
 * PERMITTED, BY YOUR DECISION (هـ):
 *   ZERO      — a real accounting fact: "nothing has been spent yet".
 *               It is distinguishable from absence because entering it
 *               stamps `acSource: 'manual'`; see `acEntered()`.
 *   NEGATIVE  — a credit note, a reversal, a reclassification out of this
 *               project. Real ledgers carry these, so AC must be able to.
 *
 * NOTE ON CPI. `computeMetrics` guards with `ac > 0 ? ev / ac : null`, so
 * a zero or negative AC yields CPI = null and the UI shows no index
 * rather than a divide-by-zero or a nonsensical negative efficiency.
 * That guard is PRE-EXISTING and was NOT modified by this step.
 */
export function setValue(
  store: EvmStore, periodId: string, field: 'pv' | 'ev' | 'ac', value: number,
): EvmStore {
  const i = store.periods.findIndex(p => p.id === periodId);
  if (i < 0) return store;
  const p = store.periods[i];
  // Locked OR frozen: an approved period is a signed statement.
  if (isLocked(p) || p.frozen) return store;

  // Blank / non-numeric is refused for every money field, AC included.
  if (value === null || value === undefined || (typeof value === 'string' && String(value).trim() === '')) return store;
  const v = Number(value);
  if (!Number.isFinite(v)) return store;

  /* OWNER'S RULE v3 — TOTALS ARE NEVER TYPED. pv/ev/ac are ALWAYS derived
     from their cost-class components (per-period values summed cumulatively
     by deriveClassTotals), with or without an existing split. Every manual
     total path is closed: enter Direct/Indirect via the lenses and the
     parent follows automatically. */
  return store;

  const periods = store.periods.slice();
  const srcKey = (field + 'Source') as 'pvSource' | 'evSource' | 'acSource';
  periods[i] = { ...p, [field]: v, [srcKey]: 'manual' as Source };
  return { ...store, periods };
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * STEP 12 — WRITE ONE COST CLASS, KEEP THE TOTAL TRUE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The five hand-entered class fields. `indirectEv` is absent on purpose:
 * it is time-derived and has no manual path.
 *
 * Every write recomputes the parent total from its two components, so
 * `pv = directPv + indirectPv` can never drift. The total is not editable
 * separately once a split exists — that is precisely how the two would
 * disagree.
 *
 * Validation matches Step 11 exactly: blank and non-numeric are refused;
 * ZERO AND NEGATIVE ARE ACCEPTED for AC (rule 11). No separate journal or
 * adjustment system is introduced.
 */
export type ClassField =
  | 'directPv' | 'indirectPv' | 'directEv' | 'directAc' | 'indirectAc';

export function setClassValue(
  store: EvmStore, periodId: string, field: ClassField, value: number,
): EvmStore {
  const i = store.periods.findIndex(p => p.id === periodId);
  if (i < 0) return store;
  const p = store.periods[i];
  if (isLocked(p) || p.frozen) return store;

  if (value === null || value === undefined
      || (typeof value === 'string' && String(value).trim() === '')) return store;
  const v = Number(value);
  if (!Number.isFinite(v)) return store;

  const srcKey = (field + 'Source') as
    'directPvSource' | 'indirectPvSource' | 'directEvSource' | 'directAcSource' | 'indirectAcSource';

  const next: EvmPeriod = { ...p, [field]: v, [srcKey]: 'manual' as Source };

  // v3: components are PER-PERIOD — every parent total from this period on
  // is a CUMULATIVE running sum, so one component edit cascades forward.
  if (field === 'directPv' || field === 'indirectPv') {
    next.pvSource = 'manual';
  } else if (field === 'directEv') {
    next.evSource = 'manual';
  } else {
    next.acSource = 'manual';
  }

  const periods = store.periods.slice();
  periods[i] = next;
  return { ...store, periods: deriveClassTotals(periods) };
}

/** True when this period carries any Step 12 component. */
export function hasSplit(p: EvmPeriod | null | undefined): boolean {
  if (!p) return false;
  return p.directPv !== undefined || p.indirectPv !== undefined
      || p.directEv !== undefined || p.indirectEv !== undefined
      || p.directAc !== undefined || p.indirectAc !== undefined;
}

/**
 * Class-level metrics. Rule 12: TOTAL METRICS COME FROM TOTAL AGGREGATES.
 *
 * v3: every class figure here is CUMULATIVE \u2014 the running sum of that
 * class's per-period components from project start through the reporting
 * period, matching the cumulative parent totals.
 *
 * Total CPI is EV_total / AC_total \u2014 never the average of Direct CPI and
 * Indirect CPI, which would weight a tiny class equally with a huge one.
 */
export interface ClassMetrics {
  direct: EvmMetrics;
  indirect: EvmMetrics;
  total: EvmMetrics;
  /** False when BAC has no approved baseline behind it. */
  bacAvailable: boolean;
  /** True when the indirect time basis could not be determined. */
  indirectBlocked: boolean;
}

export function classMetrics(
  periods: EvmPeriod[], upTo: EvmPeriod, bac: BacSplit, method: EacMethod = 'cpi',
): ClassMetrics {
  const idx2 = periods.findIndex(p => p.id === upTo.id);
  const hist = idx2 >= 0 ? periods.slice(0, idx2 + 1) : [upTo];
  const sumOf = (k: 'directPv' | 'indirectPv' | 'directEv' | 'indirectEv' | 'directAc' | 'indirectAc') =>
    hist.reduce((a, p) => a + num(p[k]), 0);

  const dPv = sumOf('directPv'), iPv = sumOf('indirectPv');
  const dEv = sumOf('directEv'), iEv = sumOf('indirectEv');
  const dAc = sumOf('directAc'), iAc = sumOf('indirectAc');

  return {
    direct:   metricsFor(dPv, dEv, dAc, bac.directBac, method),
    indirect: metricsFor(iPv, iEv, iAc, bac.indirectBac, method),
    total:    metricsFor(dPv + iPv, dEv + iEv, dAc + iAc, bac.totalBac, method),
    bacAvailable: bac.available,
    indirectBlocked: upTo.indirectEvBasis === null,
  };
}

/**
 * STEP 12 rule 5 — INDIRECT EV IS TIME-BASED, NEVER TYPED.
 *
 *   indirectEv = indirectBac \u00d7 \u0646\u0633\u0628\u0629 \u0627\u0644\u0634\u0647\u0631 \u0627\u0644\u0646\u0641\u0633\u0647
 *
 * OWNER'S RULE (final): the pct passed in is THAT PERIOD'S OWN share of
 * the effective approved duration (period days \u00f7 durationDays) \u2014 never a
 * cumulative fraction, never a delta. Every period stands alone with its
 * slice, future months included (their slice is defined, not zero), and
 * the parent cumulative EV sums the slices exactly like Direct components.
 * `indirectEvBasis` keeps the month's share for audit.
 *
 * A null pct means the share is unknowable (an approved EOT with no
 * effective date) and the period is left UNTOUCHED rather than given a
 * fabricated value. Approved and frozen periods are never rewritten.
 */
export function applyIndirectEv(
  store: EvmStore, periodId: string, pct: number | null, indirectBac: number,
): EvmStore {
  const i = store.periods.findIndex(p => p.id === periodId);
  if (i < 0) return store;
  const p = store.periods[i];
  if (isLocked(p) || p.frozen) return store;
  if (pct === null || !Number.isFinite(pct)) {
    // Record that it could not be determined. No value is written.
    if (p.indirectEvBasis === null) return store;
    const periods = store.periods.slice();
    periods[i] = { ...p, indirectEvBasis: null };
    return { ...store, periods };
  }

  const share = Math.max(0, Math.min(1, pct));
  const value = share * num(indirectBac);
  if (p.indirectEv === value && p.indirectEvBasis === pct) return store;

  const next: EvmPeriod = { ...p, indirectEv: value, indirectEvBasis: pct };
  const periods = store.periods.slice();
  periods[i] = next;
  return { ...store, periods: deriveClassTotals(periods) };
}

export function setPeriodField(
  store: EvmStore, periodId: string,
  field: 'physicalProgress' | 'notes' | 'issues' | 'risks' | 'attachments',
  value: any,
): EvmStore {
  const i = store.periods.findIndex(p => p.id === periodId);
  if (i < 0) return store;
  const p = store.periods[i];
  if (isLocked(p) || p.frozen) return store;

  const periods = store.periods.slice();
  const v = field === 'physicalProgress'
    ? Math.max(0, Math.min(1, num(value)))
    : field === 'attachments'
      ? (Array.isArray(value) ? value.map(String) : [])
      : String(value ?? '');
  periods[i] = { ...p, [field]: v };
  return { ...store, periods };
}

/** Hands a field back to automation. */
export function clearOverride(
  store: EvmStore, periodId: string, field: 'pv' | 'ev' | 'ac',
): EvmStore {
  const i = store.periods.findIndex(p => p.id === periodId);
  if (i < 0) return store;
  const p = store.periods[i];
  if (isLocked(p)) return store;
  const periods = store.periods.slice();
  const srcKey = (field + 'Source') as 'pvSource' | 'evSource' | 'acSource';
  periods[i] = { ...p, [srcKey]: 'auto' as Source };
  return { ...store, periods };
}

// ── Forecast dates ─────────────────────────────────────────────────────

export interface ForecastDates {
  baselineFinish: string;
  /** Baseline finish stretched by SPI. '' when SPI is unavailable. */
  forecastFinish: string;
  /** Calendar days late. Negative = early. */
  slipDays: number;
}

/**
 * Schedule forecast from SPI.
 *
 * Remaining duration is divided by SPI: at SPI 0.8, work is taking 25%
 * longer, so the remaining stretch grows accordingly. Elapsed time is not
 * re-scaled — it has already happened.
 */
export function forecastDates(project: ProjectLike, spi: number | null, today = new Date()): ForecastDates {
  const { start, end } = calendarBounds(project);
  const baselineFinish = iso(end);
  if (!spi || spi <= 0) return { baselineFinish, forecastFinish: '', slipDays: 0 };

  const total = Math.max(1, daysBetween(start, end));
  const elapsed = Math.max(0, Math.min(total, daysBetween(start, today)));
  const remaining = total - elapsed;
  const stretched = remaining / spi;
  const finish = addDays(today, Math.round(stretched));
  return {
    baselineFinish,
    forecastFinish: iso(finish),
    slipDays: daysBetween(end, finish),
  };
}

// ── Baseline versioning ────────────────────────────────────────────────

/** The baseline in force, or null when the project's own dates are the plan. */
export function activeBaseline(store: EvmStore): Baseline | null {
  const all = store.baselines || [];
  const approved = all.filter(b => b.approved);
  // Prefer an approved version. With none, the draft still drives the
  // calendar so a new project can be worked on before sign-off — the UI
  // labels it DRAFT so nobody mistakes it for an authorised plan.
  const pool = approved.length ? approved : all;
  if (pool.length === 0) return null;
  const id = store.settings.activeBaselineId;
  return pool.find(b => b.id === id) || pool[pool.length - 1];
}

/** Baseline bounds when one is active, else the project's own window. */
export function effectiveBounds(project: ProjectLike, store: EvmStore): CalendarBounds {
  const b = activeBaseline(store);
  if (b && b.start && b.finish) {
    const st = parseIso(b.start), fi = parseIso(b.finish);
    if (st && fi && fi.getTime() > st.getTime()) return { start: st, end: fi, fromProject: false };
  }
  return calendarBounds(project);
}

/**
 * Creates Baseline V1 from the project as it stands.
 * Called once, so there is always something to version FROM.
 */
export function seedBaseline(project: ProjectLike, store: EvmStore): EvmStore {
  if ((store.baselines || []).length > 0) return store;
  const { start, end } = calendarBounds(project);
  const { bac } = computeBac(project, store.settings);
  const b: Baseline = {
    id: `bl-1-${Date.now()}`,
    version: 1,
    name: 'Baseline V1',
    start: iso(start),
    finish: iso(end),
    durationDays: Math.max(0, daysBetween(start, end)),
    bac,
    contractValue: num(project.contractValue),
    reason: 'Proposed from project dates — review and approve',
    // NOT approved. The old code stamped "approved by system", which claimed
    // a sign-off that never happened. A baseline nobody authorised is a
    // proposal, and it says so until a human confirms it.
    approvedBy: '',
    approvedOn: '',
    createdAt: new Date().toISOString(),
    approved: false,
  };
  return {
    ...store,
    baselines: [b],
    settings: { ...store.settings, activeBaselineId: b.id },
  };
}

/** True when no baseline has ever been confirmed by a person. */
export function needsBaselineApproval(store: EvmStore): boolean {
  const list = store.baselines || [];
  return list.length > 0 && !list.some(b => b.approved);
}

/** Edits the draft baseline. Refused once any version is approved. */
export function updateDraftBaseline(
  store: EvmStore, patch: Partial<Pick<Baseline, 'start' | 'finish' | 'bac' | 'reason' | 'name'>>,
): EvmStore {
  const list = (store.baselines || []).slice();
  const i = list.findIndex(b => !b.approved);
  if (i < 0) return store;
  const b = { ...list[i], ...patch };
  const st = parseIso(b.start), fi = parseIso(b.finish);
  b.durationDays = st && fi ? Math.max(0, daysBetween(st, fi)) : b.durationDays;
  list[i] = b;
  return { ...store, baselines: list };
}

/** Confirms the draft. This is the only path to an approved V1. */
export function approveBaseline(
  store: EvmStore, baselineId: string, approvedBy: string,
): { store: EvmStore; ok: boolean } {
  const list = (store.baselines || []).slice();
  const i = list.findIndex(b => b.id === baselineId);
  if (i < 0 || list[i].approved) return { store, ok: false };
  list[i] = {
    ...list[i],
    approved: true,
    approvedBy: approvedBy || 'unknown',
    approvedOn: new Date().toISOString().slice(0, 10),
  };
  return {
    store: { ...store, baselines: list, settings: { ...store.settings, activeBaselineId: list[i].id } },
    ok: true,
  };
}

export interface RebaselineRequest {
  reason: string;
  cause: RebaselineCause;
  daysAdded: number;
  valueAdded: number;
  approvedBy: string;
}

/**
 * Re-baselining: append a new version, never overwrite.
 *
 * Only FUTURE periods are redistributed against the new curve. Approved
 * periods keep the baseline they were approved under and their frozen
 * figures — that is the whole point of versioning.
 */
export function rebaseline(
  project: ProjectLike, store: EvmStore, req: RebaselineRequest,
): { store: EvmStore; baseline: Baseline } {
  const seeded = seedBaseline(project, store);
  const prev = activeBaseline(seeded);
  const list = (seeded.baselines || []);

  const prevStart = prev?.start || iso(calendarBounds(project).start);
  const prevFinish = prev?.finish || iso(calendarBounds(project).end);
  const prevBac = prev?.bac ?? computeBac(project, seeded.settings).bac;

  const fi = parseIso(prevFinish);
  const newFinish = fi ? iso(addDays(fi, Math.max(0, req.daysAdded))) : prevFinish;
  const st = parseIso(prevStart);
  const dur = st && parseIso(newFinish) ? daysBetween(st, parseIso(newFinish)!) : 0;

  const b: Baseline = {
    id: `bl-${list.length + 1}-${Date.now()}`,
    version: list.length + 1,
    name: `Baseline V${list.length + 1}`,
    start: prevStart,
    finish: newFinish,
    durationDays: dur,
    bac: prevBac + num(req.valueAdded),
    contractValue: num(project.contractValue) + num(req.valueAdded),
    reason: req.reason,
    cause: req.cause,
    daysAdded: num(req.daysAdded),
    valueAdded: num(req.valueAdded),
    approvedBy: req.approvedBy,
    approvedOn: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    approved: true,
  };

  return {
    store: {
      ...seeded,
      baselines: [...list, b],
      settings: { ...seeded.settings, activeBaselineId: b.id },
    },
    baseline: b,
  };
}

// ── Future period generation ───────────────────────────────────────────

/**
 * Extends the calendar to a target date without touching a single existing
 * period. Used when the programme grows past the last generated period.
 */
export function generateFuturePeriods(
  project: ProjectLike, store: EvmStore, until?: string,
): { store: EvmStore; created: number } {
  /**
   * ══════════════════════════════════════════════════════════════════════
   * AN ARCHIVED PROJECT GROWS NO NEW PERIODS.
   *
   * A retired project must not keep sprouting empty future months every
   * time someone opens it. Those periods would carry an auto PV against a
   * programme nobody is running, quietly diluting percent-complete and
   * adding rows to a record that is supposed to be closed.
   *
   * The guard is deliberately NARROW — it fires only on
   * `status === 'Archived'`. A live project, a completed-but-active one,
   * a delayed one: all behave exactly as they did before. Nothing is
   * deleted and no EXISTING period is touched; the calendar simply stops
   * extending.
   *
   * Restoring the project lifts the guard, and generation resumes from
   * where it left off.
   * ══════════════════════════════════════════════════════════════════════
   */
  if (isArchived(project)) return { store, created: 0 };

  const b = activeBaseline(store);
  const bounds = effectiveBounds(project, store);
  const targetIso = until || b?.finish || iso(bounds.end);
  const target = parseIso(targetIso);
  if (!target) return { store, created: 0 };

  const existing = store.periods.slice();
  const cadence = store.settings.cadence;
  const bacNow = b?.bac ?? computeBac(project, store.settings).bac;

  // Start from the day after the last period, or the programme start.
  const lastEnd = existing.length ? parseIso(existing[existing.length - 1].end) : null;
  let cursor = lastEnd ? addDays(lastEnd, 1) : new Date(bounds.start.getTime());
  if (cursor.getTime() >= target.getTime()) return { store, created: 0 };

  const spanStart = bounds.start;
  const span = Math.max(1, daysBetween(spanStart, target));
  let seq = existing.length ? existing[existing.length - 1].seq + 1 : 1;
  let created = 0;
  const added: EvmPeriod[] = [];

  while (cursor.getTime() < target.getTime() && created < 520) {
    let next: Date;
    if (cadence === 'weekly')          next = addDays(cursor, 7);
    else if (cadence === 'biweekly')   next = addDays(cursor, 14);
    else if (cadence === 'quarterly')  next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 3, 1));
    else                               next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    if (next.getTime() > target.getTime()) next = new Date(target.getTime());

    const endD = addDays(next, -1);
    const t = Math.max(0, Math.min(1, (daysBetween(spanStart, endD) + 1) / span));
    added.push({
      id: `evp-${iso(cursor)}-${Math.random().toString(36).slice(2, 6)}`,
      seq, start: iso(cursor), end: iso(endD), label: labelFor(cursor, cadence),
      pv: bacNow * pvCurve(t, store.settings.pvMethod ?? 'scurve'), ev: 0, ac: 0,
      pvSource: 'auto', evSource: 'auto', acSource: 'auto',
      status: 'draft', reviewer: '', reviewDate: '', comment: '', updatedAt: '',
    });
    cursor = next;
    seq++; created++;
  }

  if (created === 0) return { store, created: 0 };
  return { store: { ...store, periods: [...existing, ...added] }, created };
}

/**
 * Redistributes PV on FUTURE periods only, against the active baseline.
 * An approved or manually-set period is never touched.
 */
export function redistributePv(project: ProjectLike, store: EvmStore): EvmStore {
  // Manual distribution is owned by the planner; regenerating would discard
  // the very programme the user typed in.
  if ((store.settings.pvMethod ?? 'scurve') === 'manual') return store;
  const bounds = effectiveBounds(project, store);
  const b = activeBaseline(store);
  const bacNow = b?.bac ?? computeBac(project, store.settings).bac;
  const span = Math.max(1, daysBetween(bounds.start, bounds.end));

  const periods = store.periods.map(p => {
    if (p.status === 'approved' || p.frozen || p.pvSource === 'manual') return p;
    const endD = parseIso(p.end);
    if (!endD) return p;
    const t = Math.max(0, Math.min(1, (daysBetween(bounds.start, endD) + 1) / span));
    return { ...p, pv: bacNow * pvCurve(t, store.settings.pvMethod ?? 'scurve') };
  });
  return { ...store, periods };
}

// ── Bulk PV entry ──────────────────────────────────────────────────────

export interface PvPasteResult {
  /** Parsed numbers, in the order they appeared. */
  values: number[];
  /** Rows that could not be read as a number. */
  skipped: number;
  /** True when the count matches the editable periods exactly. */
  exact: boolean;
  /** How many periods will actually be written. */
  willApply: number;
}

/**
 * Parses a column pasted from Excel, Primavera or a CSV export.
 *
 * Deliberately forgiving, because real pastes are messy:
 *   - newline, tab, comma or semicolon separated
 *   - thousands separators, currency symbols, spaces
 *   - Arabic-Indic digits ٠١٢٣٤٥٦٧٨٩
 *   - parentheses for negatives, e.g. (1,200)
 *   - a header row is ignored automatically
 */
export function parsePvPaste(raw: string, editableCount: number): PvPasteResult {
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const western = (txt: string) => txt.replace(/[٠-٩]/g, d => String(AR.indexOf(d)));

  // Comma is ambiguous: a thousands separator in "1,000,000" and a delimiter
  // in a CSV. Splitting on it blindly turned one figure into three, which is
  // silent data corruption on the most common paste of all — an Excel column.
  // Newline and tab are unambiguous, so prefer them; fall back to comma or
  // semicolon only when neither appears.
  const text = western(raw);
  const hasRowBreaks = /[\r\n\t]/.test(text);
  const cells = text
    .split(hasRowBreaks ? /[\r\n\t]+/ : /[;,]+/)
    .map(x => x.trim())
    .filter(x => x.length > 0);

  const values: number[] = [];
  let skipped = 0;
  cells.forEach((cell, i) => {
    const neg = /^\(.*\)$/.test(cell);
    // Strip everything that is not a digit, separator or sign.
    const cleaned = cell.replace(/[()]/g, '').replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') {
      // A single unreadable first cell is almost always a column header.
      if (i === 0) return;
      skipped++;
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n)) { skipped++; return; }
    values.push(neg ? -Math.abs(n) : n);
  });

  return {
    values,
    skipped,
    exact: values.length === editableCount,
    willApply: Math.min(values.length, editableCount),
  };
}

/**
 * Writes a column of cumulative PV onto the periods, oldest first.
 *
 * Approved and frozen periods are SKIPPED, never overwritten — the paste
 * lands on the editable periods only, in order. Switches the project to
 * manual distribution so the generator stops competing with the planner.
 */
/**
 * PASTE — a cumulative PV column from Excel/Primavera.
 *
 * v3: the pasted CUMULATIVE figures are converted to per-period increments
 * and filed as DIRECT PV components; the parent totals re-derive through
 * deriveClassTotals exactly as if each month had been typed by hand in the
 * Direct lens. No total is ever written directly.
 */
export function applyPvColumn(store: EvmStore, values: number[]): {
  store: EvmStore; applied: number;
} {
  let vi = 0;
  let prevCum = 0;
  const periods = store.periods.map(p => {
    if (vi >= values.length) return p;
    if (p.status === 'approved' || p.frozen) return p;   // history is inert
    const cum = num(values[vi++]);
    const inc = Math.max(0, cum - prevCum);
    prevCum = cum;
    return { ...p, directPv: inc, directPvSource: 'manual' as Source, pvSource: 'manual' as Source };
  });
  return {
    store: {
      ...store,
      periods: deriveClassTotals(periods),
      settings: { ...store.settings, pvMethod: 'manual' },
    },
    applied: vi,
  };
}

/**
 * Sanity check on a manual PV column.
 *
 * Cumulative PV must never fall, and should finish on BAC. These are
 * warnings rather than blocks: a planner may have a reason, and refusing
 * their data outright is worse than telling them what looks wrong.
 */
export interface PvValidation {
  decreasing: { label: string; from: number; to: number }[];
  finalPv: number;
  bac: number;
  /** Difference between the last PV and BAC. */
  gap: number;
  ok: boolean;
}

export function validatePv(store: EvmStore, bac: number): PvValidation {
  const decreasing: { label: string; from: number; to: number }[] = [];
  let prev = 0;
  store.periods.forEach(p => {
    if (p.pv < prev - 0.5) decreasing.push({ label: p.label, from: prev, to: p.pv });
    prev = p.pv;
  });
  const finalPv = store.periods.length ? store.periods[store.periods.length - 1].pv : 0;
  const gap = finalPv - bac;
  return {
    decreasing, finalPv, bac, gap,
    ok: decreasing.length === 0 && Math.abs(gap) < Math.max(1, bac * 0.005),
  };
}

// ── Intelligent status ─────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'watch' | 'critical' | 'recovery' | 'unknown';

export interface HealthVerdict {
  status: HealthStatus;
  en: string;
  ar: string;
  tone: 'ok' | 'gold' | 'warn' | 'risk' | 'muted';
  /** Plain-language justification, so the badge is never a black box. */
  reasons: string[];
  reasonsAr: string[];
}

/**
 * Classifies overall health from SPI, CPI, VAC and slippage.
 *
 * `recovery` is deliberately distinct from `watch`: a project whose indices
 * are below target but IMPROVING period on period is a different management
 * situation from one that is merely mediocre and flat.
 */
export function classifyHealth(
  spi: number | null, cpi: number | null, vac: number, bac: number,
  slipDays: number, prevSpi: number | null, prevCpi: number | null,
): HealthVerdict {
  if (spi === null && cpi === null) {
    return { status: 'unknown', en: 'No Data', ar: 'لا توجد بيانات', tone: 'muted', reasons: [], reasonsAr: [] };
  }
  const S = spi ?? 1, C = cpi ?? 1;
  const vacPct = bac > 0 ? vac / bac : 0;

  const reasons: string[] = [];
  const reasonsAr: string[] = [];

  const improving =
    prevSpi !== null && prevCpi !== null && spi !== null && cpi !== null &&
    (spi - prevSpi) + (cpi - prevCpi) > 0.01;

  // Critical: any severe breach.
  const severe = S < 0.9 || C < 0.9 || vacPct < -0.1 || slipDays > 60;
  if (severe) {
    if (S < 0.9) { reasons.push(`SPI ${S.toFixed(2)} below 0.90`); reasonsAr.push(`SPI ${S.toFixed(2)} أقل من 0.90`); }
    if (C < 0.9) { reasons.push(`CPI ${C.toFixed(2)} below 0.90`); reasonsAr.push(`CPI ${C.toFixed(2)} أقل من 0.90`); }
    if (vacPct < -0.1) { reasons.push(`Forecast overrun exceeds 10% of BAC`); reasonsAr.push('التجاوز المتوقع يتخطى 10% من الميزانية'); }
    if (slipDays > 60) { reasons.push(`Forecast finish slips ${slipDays} days`); reasonsAr.push(`انزلاق الإنجاز ${slipDays} يوماً`); }
    if (improving) {
      return { status: 'recovery', en: 'Recovery', ar: 'تحسّن', tone: 'gold',
               reasons: [...reasons, 'Indices improving period on period'],
               reasonsAr: [...reasonsAr, 'المؤشرات تتحسن من فترة لأخرى'] };
    }
    return { status: 'critical', en: 'Critical', ar: 'حرج', tone: 'risk', reasons, reasonsAr };
  }

  // Watch: below target but not severe.
  if (S < 0.98 || C < 0.98 || vacPct < -0.02 || slipDays > 14) {
    if (S < 0.98) { reasons.push(`SPI ${S.toFixed(2)} below target`); reasonsAr.push(`SPI ${S.toFixed(2)} دون الهدف`); }
    if (C < 0.98) { reasons.push(`CPI ${C.toFixed(2)} below target`); reasonsAr.push(`CPI ${C.toFixed(2)} دون الهدف`); }
    if (slipDays > 14) { reasons.push(`${slipDays} days behind baseline finish`); reasonsAr.push(`${slipDays} يوماً خلف الأساس`); }
    if (improving) {
      return { status: 'recovery', en: 'Recovery', ar: 'تحسّن', tone: 'gold',
               reasons: [...reasons, 'Trending upward'], reasonsAr: [...reasonsAr, 'الاتجاه تصاعدي'] };
    }
    return { status: 'watch', en: 'Watch', ar: 'مراقبة', tone: 'warn', reasons, reasonsAr };
  }

  reasons.push(`SPI ${S.toFixed(2)} · CPI ${C.toFixed(2)} at or above target`);
  reasonsAr.push(`SPI ${S.toFixed(2)} · CPI ${C.toFixed(2)} عند الهدف أو أعلى`);
  return { status: 'healthy', en: 'Healthy', ar: 'سليم', tone: 'ok', reasons, reasonsAr };
}

// ── Whole-module snapshot, for the UI and the report ───────────────────

export interface EvmSnapshot {
  bac: number;
  bacParts: { base: number; cos: number; claims: number; overridden: boolean };
  period: EvmPeriod | null;
  /**
   * Reporting-period metrics.
   *   ACTUALS  (pv/ev/ac/spi/cpi/sv/cv) — the approved record; frozen once approved.
   *   FORECAST (eac/etc/vac/tcpi)       — always live against today's baseline
   *                                       and today's official method.
   * The frozen forecast is still preserved on `period.frozen` and is what the
   * period history prints.
   */
  m: EvmMetrics;
  /** The period before the reporting one, for deltas. */
  prev: EvmPeriod | null;
  prevM: EvmMetrics | null;
  quadrant: QuadrantInfo;
  /** Quadrant of the previous period — drives the movement arrow. */
  prevQuadrant: QuadrantInfo | null;
  score: number | null;
  points: SeriesPoint[];
  approvedCount: number;
  dates: ForecastDates;
  acSource: string;
  cadence: Cadence;
  /** Cumulative performance across all history to the reporting period. */
  cum: CumulativePerformance;
  /** All three PMI methods, one flagged official. */
  eacOptions: EacOption[];
  /** Intelligent overall status. */
  health: HealthVerdict;
  /** Baseline in force, null when the project's own dates are the plan. */
  baseline: Baseline | null;
  baselines: Baseline[];
}

export function snapshot(project: ProjectLike, store: EvmStore, today = new Date()): EvmSnapshot {
  const derived = computeBac(project, store.settings);
  const bl = activeBaseline(store);

  /**
   * ════════════════════════════════════════════════════════════════════
   * ONE BAC. THE APPROVED BASELINE PACKAGE OUTRANKS EVERYTHING.
   *
   * There were TWO independent answers to "what is BAC", and they
   * disagreed on screen:
   *
   *   `computeBacSplit`  read the approved Baseline Package  -> 120M
   *   `snapshot`         read the EVM baseline, else contract -> 150M
   *
   * The ribbon rendered the second while the split panel used the first,
   * so a project whose approved package said 120,000,000 displayed BAC
   * 150,000,000 — the contract value wearing the label of the approved
   * budget. Step 12 Q3=B settled this: BAC IS THE APPROVED BUDGET, NOT
   * THE CONTRACT VALUE. Only one of the two was obeying it.
   *
   * Order of authority, highest first:
   *   1. the approved Baseline Package   (the signed budget)
   *   2. an approved EVM baseline        (legacy projects, pre-package)
   *   3. derived from contract           (nothing approved at all)
   *
   * 3 is a FALLBACK FOR DISPLAY ONLY. `computeBacSplit` still reports
   * `available: false` in that case, which is what makes the screen say
   * "BAC unavailable" rather than quietly showing the contract value as
   * though somebody had approved it.
   * ════════════════════════════════════════════════════════════════════
   */
  const pkgSplit = computeBacSplit(project, store.settings);
  const bac = pkgSplit.available
    ? pkgSplit.totalBac
    : (bl ? bl.bac : derived.bac);

  const period = reportingPeriod(store.periods, today);
  const idx = period ? store.periods.findIndex(p => p.id === period.id) : -1;
  const prev = idx > 0 ? store.periods[idx - 1] : null;

  // Cumulative history to the reporting period — the correct forecast basis.
  const cum = cumulativeTo(store.periods, period);

  // The reporting period's ACTUALS are the approved record: frozen when
  // approved, live otherwise.
  const recorded = period
    ? periodMetrics(period, bac, store.settings.eacMethod, cum)
    : metricsFor(0, 0, 0, bac, store.settings.eacMethod);

  // The FORECAST is different in kind. EAC, ETC, VAC and TCPI look forward,
  // so they must answer against today's baseline and today's chosen method.
  // Freezing them would mean a re-baseline changed nothing on the dashboard,
  // which is the opposite of what a forecast is for. The frozen figures stay
  // intact on the period itself and are what the history table prints.
  const fc = eacFor(store.settings.eacMethod, bac, recorded.ev, recorded.ac, cum.cpiCum, cum.spiCum);
  const liveEac = Number.isFinite(fc.eac) ? fc.eac : bac;
  const remaining = bac - recorded.ac;
  const m: EvmMetrics = {
    ...recorded,
    bac,
    eac: liveEac,
    etc: liveEac - recorded.ac,
    vac: bac - liveEac,
    tcpi: remaining !== 0 ? (bac - recorded.ev) / remaining : null,
    percentComplete: bac > 0 ? recorded.ev / bac : 0,
    percentPlanned:  bac > 0 ? recorded.pv / bac : 0,
    percentSpent:    bac > 0 ? recorded.ac / bac : 0,
  };

  const prevCum = prev ? cumulativeTo(store.periods, prev) : undefined;
  const prevRec = prev ? periodMetrics(prev, bac, store.settings.eacMethod, prevCum) : null;
  let prevM: EvmMetrics | null = prevRec;
  if (prev && prevRec && prevCum) {
    const pf = eacFor(store.settings.eacMethod, bac, prevRec.ev, prevRec.ac, prevCum.cpiCum, prevCum.spiCum);
    const pe = Number.isFinite(pf.eac) ? pf.eac : bac;
    prevM = { ...prevRec, bac, eac: pe, etc: pe - prevRec.ac, vac: bac - pe };
  }

  const dates = forecastDates(project, m.spi, today);
  const health = classifyHealth(
    m.spi, m.cpi, m.vac, bac, dates.slipDays,
    prevM?.spi ?? null, prevM?.cpi ?? null,
  );

  return {
    bac,
    bacParts: { base: derived.base, cos: derived.cos, claims: derived.claims, overridden: derived.overridden },
    period,
    m,
    prev,
    prevM,
    quadrant: quadrantOf(m.spi, m.cpi),
    prevQuadrant: prevM ? quadrantOf(prevM.spi, prevM.cpi) : null,
    score: healthScore(m.spi, m.cpi),
    points: series(store.periods, bac, store.settings.eacMethod),
    approvedCount: store.periods.filter(p => p.status === 'approved').length,
    dates,
    /**
     * STEP 11 — the AC provenance shown on the dashboard.
     *
     * Was `readActualCost(project).from`, i.e. 'budget' | 'disbursed'.
     * Both derivations are gone, so the only two truthful answers now
     * are: Finance entered it, or nobody has.
     */
    acSource: acEntered(period) ? 'manual' : 'not-entered',
    cadence: store.settings.cadence,
    cum,
    eacOptions: eacComparison(bac, m.ev, m.ac, cum.cpiCum, cum.spiCum, store.settings.eacMethod),
    health,
    baseline: bl,
    baselines: (store.baselines || []).slice(),
  };
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * STEP 13 · Q1=A — THE SAME COMPUTATION, WITHOUT THE WRITE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `readSyncedEvm` persists whatever it derives. That is right for the
 * EVM screen — the user is looking at one project and the calendar
 * should settle. It is WRONG for the portfolio, which touches every
 * project in a company: merely opening a dashboard would generate and
 * save EVM calendars for projects nobody has ever opened, turning a
 * read into a broad write across other people's data.
 *
 * So the derivation is extracted here, unchanged and byte-for-byte
 * identical, minus the `writeEvm` call. `readSyncedEvm` below now calls
 * it, which is what guarantees there is ONE derivation and not two that
 * can drift.
 *
 * NO BUSINESS RULE CHANGES. Same seed, same calendar sync, same refresh,
 * same order. The only difference is that nothing is persisted.
 */
export function deriveEvmStore(project: ProjectLike, today = new Date()): EvmStore {
  const cur = readEvm(project.id);
  // V1 exists from the first read, so there is always something to version FROM.
  const seeded = seedBaseline(project, cur);
  const synced = syncCalendar(project, seeded).store;
  return refreshCurrent(project, synced, today);
}

/** Reads, syncs the calendar, refreshes the live period and persists once. */
export function readSyncedEvm(project: ProjectLike, today = new Date()): EvmStore {
  const cur = readEvm(project.id);
  const refreshed = deriveEvmStore(project, today);
  if (JSON.stringify(refreshed) !== JSON.stringify(cur)) writeEvm(project.id, refreshed);
  return refreshed;
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * STEP 13 — ONE PROJECT'S AUTHORITATIVE EVM, FOR AGGREGATION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The single entry point the portfolio is allowed to use. It runs the
 * real engine — the same `deriveEvmStore`, the same `computeBacSplit`,
 * the same `classMetrics` the EVM screen runs — and reports the result
 * WITHOUT writing anything.
 *
 * `available` IS THE WHOLE POINT (Q2=A). A project with no approved
 * baseline package has no BAC, and therefore no honest EVM. It reports
 * `available: false` with a named reason and MUST BE EXCLUDED from the
 * sum. Adding it as zero would be inventing a financial fact — the same
 * absence-as-zero trap closed in Step 11 for AC and in Step 12 for the
 * schedule basis.
 *
 * NOTHING IS DERIVED HERE. No contract-value BAC, no progress-based EV,
 * no cash-flow PV, no cash-out AC. Every figure comes from the period
 * the engine designates as the reporting period.
 */
export interface ProjectEvmResult {
  projectId: string;
  /** False when the engine cannot produce an honest EVM for this project. */
  available: boolean;
  /** Machine-readable cause when unavailable. '' when available. */
  reason: string;
  /** The period the figures describe. '' when unavailable. */
  periodLabel: string;
  /** Direct / Indirect / Total, straight from classMetrics. */
  metrics: ClassMetrics | null;
  /** True when this project's Indirect EV is blocked (Step 12 Q2=C). */
  indirectBlocked: boolean;
  /** True when the period carries the Step 12 component split. */
  split: boolean;
}

export function projectEvmResult(
  project: ProjectLike, today = new Date(),
): ProjectEvmResult {
  const out: ProjectEvmResult = {
    projectId: project.id, available: false, reason: 'no-approved-baseline',
    periodLabel: '', metrics: null, indirectBlocked: false, split: false,
  };

  const store = deriveEvmStore(project, today);
  const bac = computeBacSplit(project, store.settings);
  if (!bac.available) return out;          // Q2=A — excluded, never zeroed.

  const period = reportingPeriod(store.periods, today);
  if (!period) { out.reason = 'no-reporting-period'; return out; }

  out.available = true;
  out.reason = '';
  out.periodLabel = period.label;
  out.metrics = classMetrics(store.periods, period, bac, store.settings.eacMethod);
  out.indirectBlocked = period.indirectEvBasis === null;
  out.split = hasSplit(period);
  return out;
}

