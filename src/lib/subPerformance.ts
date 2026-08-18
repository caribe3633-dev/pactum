/**
 * Subcontractor Performance KPI Engine.
 * Destination: src/lib/subPerformance.ts
 *
 * SCOPE
 *   This file ADDS an evaluation layer on top of data that already exists.
 *   It never writes to, or recalculates, any existing engine:
 *
 *     Delay engine        -> read via computeSubLd / computeSubSchedule
 *     Change orders       -> read via rollupCommercial (approved time impact)
 *     Claims              -> read via rollupCommercial (approved time impact)
 *     Contract value      -> read via currentContractValue
 *     Certificates / cash -> not touched at all
 *
 *   The ONLY thing this module owns is the manual evaluation record:
 *     pactum-sub-perf-${projectId}  ->  Record<subId, PerfRecord>
 *
 *   Automatic figures are never persisted — they are recomputed on read so a
 *   change anywhere upstream is reflected immediately, with no duplication.
 *
 * MODEL
 *   Time Performance is AUTOMATIC and measured against the CURRENT APPROVED
 *   contract duration:
 *
 *     currentApprovedDuration = baselineDuration + approvedExtension
 *     culpableDelay           = max(0, totalDelay − approvedExtension)
 *
 *   Approved extensions therefore never penalise the subcontractor: they
 *   lengthen the yardstick and cancel out of the numerator at the same time.
 */

import {
  SubCommercial,
  readCommercial,
  rollupCommercial,
  currentContractValue,
  computeSubLd,
  computeSubSchedule,
} from './subcontractCommercial';

// ── Categories & weights ───────────────────────────────────────────────

export type ManualKey =
  | 'quality' | 'financial' | 'hse' | 'communication' | 'documentation';

export type CategoryKey = 'time' | ManualKey;

/** Locked weights. Total = 100. */
export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  time: 25,
  quality: 20,
  financial: 15,
  hse: 15,
  communication: 10,
  documentation: 15,
};

export const MANUAL_KEYS: ManualKey[] = [
  'quality', 'financial', 'hse', 'communication', 'documentation',
];

export const CATEGORY_ORDER: CategoryKey[] = [
  'time', 'quality', 'financial', 'hse', 'communication', 'documentation',
];

export interface CategoryMeta {
  key: CategoryKey;
  weight: number;
  automatic: boolean;
  en: string;
  ar: string;
  /** Short axis label — radar charts have no room for the full name. */
  shortEn: string;
  shortAr: string;
  hintEn: string;
  hintAr: string;
}

export const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
  time: {
    key: 'time', weight: 25, automatic: true,
    en: 'Time Performance', ar: 'أداء الوقت',
    shortEn: 'Time', shortAr: 'الوقت',
    hintEn: 'Automatic — measured against the current approved contract duration.',
    hintAr: 'تلقائي — يُقاس مقابل مدة العقد المعتمدة الحالية.',
  },
  quality: {
    key: 'quality', weight: 20, automatic: false,
    en: 'Quality', ar: 'الجودة',
    shortEn: 'Quality', shortAr: 'الجودة',
    hintEn: 'Workmanship, rework, NCR closure.',
    hintAr: 'جودة التنفيذ وإعادة العمل وإغلاق الملاحظات.',
  },
  financial: {
    key: 'financial', weight: 15, automatic: false,
    en: 'Financial & Contractual Compliance', ar: 'الالتزام المالي والتعاقدي',
    shortEn: 'Financial', shortAr: 'المالي',
    hintEn: 'Accuracy of payment applications · contract compliance · claim quality.',
    hintAr: 'دقة مستخلصات الدفع · الالتزام بالعقد · جودة المطالبات.',
  },
  hse: {
    key: 'hse', weight: 15, automatic: false,
    en: 'HSE', ar: 'السلامة والصحة والبيئة',
    shortEn: 'HSE', shortAr: 'السلامة',
    hintEn: 'Incidents · violations · near misses.',
    hintAr: 'الحوادث · المخالفات · الحوادث الوشيكة.',
  },
  communication: {
    key: 'communication', weight: 10, automatic: false,
    en: 'Communication', ar: 'التواصل',
    shortEn: 'Comms', shortAr: 'التواصل',
    hintEn: 'Response time · meeting attendance.',
    hintAr: 'سرعة الاستجابة · حضور الاجتماعات.',
  },
  documentation: {
    key: 'documentation', weight: 15, automatic: false,
    en: 'Documentation', ar: 'التوثيق',
    shortEn: 'Docs', shortAr: 'التوثيق',
    hintEn: 'Method statements · shop drawings · as-built.',
    hintAr: 'بيانات الطريقة · المخططات التنفيذية · مخططات ما بعد التنفيذ.',
  },
};

// ── Grades ─────────────────────────────────────────────────────────────

export type GradeTone = 'ok' | 'gold' | 'warn' | 'risk';

export interface Grade {
  grade: string;
  en: string;
  ar: string;
  tone: GradeTone;
}

/** 95+ A+ · 90 A · 85 B+ · 75 B · 60 C · below D. */
export function gradeOf(score: number): Grade {
  const s = Number(score) || 0;
  if (s >= 95) return { grade: 'A+', en: 'Excellent', ar: 'ممتاز', tone: 'ok' };
  if (s >= 90) return { grade: 'A', en: 'Very Good', ar: 'جيد جداً', tone: 'ok' };
  if (s >= 85) return { grade: 'B+', en: 'Good', ar: 'جيد', tone: 'gold' };
  if (s >= 75) return { grade: 'B', en: 'Acceptable', ar: 'مقبول', tone: 'gold' };
  if (s >= 60) return { grade: 'C', en: 'Needs Improvement', ar: 'يحتاج تحسين', tone: 'warn' };
  return { grade: 'D', en: 'Critical', ar: 'حرج', tone: 'risk' };
}

// ── Manual record — the only thing this module stores ──────────────────

export interface ManualScore {
  /** 0–100. null = not evaluated yet; the weight is redistributed. */
  score: number | null;
  comment: string;
  reviewer: string;
  /** ISO yyyy-mm-dd. */
  reviewDate: string;
}

/** One point on the trend line. Written when a review is saved. */
export interface PerfSnapshot {
  /** ISO yyyy-mm-dd. */
  date: string;
  score: number;
  reviewer: string;
}

export interface PerfRecord {
  quality: ManualScore;
  financial: ManualScore;
  hse: ManualScore;
  communication: ManualScore;
  documentation: ManualScore;
  history: PerfSnapshot[];
}

const BLANK_SCORE: ManualScore = { score: null, comment: '', reviewer: '', reviewDate: '' };

export const EMPTY_PERF: PerfRecord = {
  quality: { ...BLANK_SCORE },
  financial: { ...BLANK_SCORE },
  hse: { ...BLANK_SCORE },
  communication: { ...BLANK_SCORE },
  documentation: { ...BLANK_SCORE },
  history: [],
};

const KEY = (projectId: string) => `pactum-sub-perf-${projectId}`;

type PerfMap = Record<string, PerfRecord>;

function cleanScore(v: any): ManualScore {
  const raw = v && typeof v === 'object' ? v : {};
  const n = raw.score === null || raw.score === undefined || raw.score === ''
    ? null
    : Math.max(0, Math.min(100, Number(raw.score) || 0));
  return {
    score: n,
    comment: typeof raw.comment === 'string' ? raw.comment : '',
    reviewer: typeof raw.reviewer === 'string' ? raw.reviewer : '',
    reviewDate: typeof raw.reviewDate === 'string' ? raw.reviewDate : '',
  };
}

export function readPerfMap(projectId: string): PerfMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(projectId)) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function writePerfMap(projectId: string, map: PerfMap): void {
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(map));
  } catch {
    /* quota — ignore, same policy as the commercial store */
  }
}

/** Always returns a complete record, even for a sub never evaluated. */
export function readPerf(projectId: string, subId: string): PerfRecord {
  const r: any = readPerfMap(projectId)[subId] || {};
  return {
    quality: cleanScore(r.quality),
    financial: cleanScore(r.financial),
    hse: cleanScore(r.hse),
    communication: cleanScore(r.communication),
    documentation: cleanScore(r.documentation),
    history: Array.isArray(r.history)
      ? r.history
          .filter((h: any) => h && typeof h === 'object')
          .map((h: any) => ({
            date: String(h.date || ''),
            score: Number(h.score) || 0,
            reviewer: String(h.reviewer || ''),
          }))
      : [],
  };
}

export function writePerf(projectId: string, subId: string, rec: PerfRecord): void {
  const map = readPerfMap(projectId);
  map[subId] = rec;
  writePerfMap(projectId, map);
}

/** Called when a subcontract is removed. Keeps the store from orphaning. */
export function deletePerf(projectId: string, subId: string): void {
  const map = readPerfMap(projectId);
  if (!(subId in map)) return;
  delete map[subId];
  writePerfMap(projectId, map);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Saves one manual category and stamps the trend.
 * The snapshot carries the WHOLE weighted score at that moment, so the trend
 * line reflects the assignment, not a single category.
 */
export function saveManualCategory(
  projectId: string,
  subId: string,
  key: ManualKey,
  patch: Partial<ManualScore>,
  contractValue = 0,
): PerfRecord {
  const cur = readPerf(projectId, subId);
  const merged: ManualScore = cleanScore({ ...cur[key], ...patch });
  if (!merged.reviewDate) merged.reviewDate = todayIso();

  const next: PerfRecord = { ...cur, [key]: merged } as PerfRecord;

  // Recompute with the new value so the snapshot is the post-save score.
  const evald = evaluateAssignment(projectId, subId, contractValue, next);
  const stamp = merged.reviewDate;
  const history = next.history.filter(h => h.date !== stamp);
  history.push({ date: stamp, score: evald.score, reviewer: merged.reviewer });
  history.sort((a, b) => a.date.localeCompare(b.date));
  next.history = history.slice(-60);   // a five-year monthly record is plenty

  writePerf(projectId, subId, next);
  return next;
}

// ── Time Performance — fully automatic ─────────────────────────────────

export interface TimePerformance {
  /** False when no programme has been entered; the weight is redistributed. */
  available: boolean;
  baselineDuration: number;
  /** Σ approved CO time + approved Claim time. Never a penalty. */
  approvedExtension: number;
  /** baselineDuration + approvedExtension — the yardstick. */
  currentApprovedDuration: number;
  /** Manual figure from the subcontract schedule: actual delay on site. */
  totalDelay: number;
  /** max(0, totalDelay − approvedExtension). */
  culpableDelay: number;
  /** Current approved contract completion date, ISO. */
  currentCompletion: string;
  /** Where the works are actually heading, ISO. */
  forecastFinish: string;
  approvedCoDays: number;
  approvedClaimDays: number;
  delayEvents: number;
  /** 0–100. */
  score: number;
}

/**
 * Culpable delay is expressed as a fraction of the CURRENT APPROVED duration.
 * A slip of half the approved programme scores zero; anything on or ahead of
 * the approved date scores 100.
 */
export function computeTimePerformance(c: SubCommercial): TimePerformance {
  const roll = rollupCommercial(c);
  const ld = computeSubLd(c, roll);
  const sch = computeSubSchedule(c, ld);

  const baselineDuration = sch.baselineDuration;
  const approvedExtension = ld.approvedExtension;
  const currentApprovedDuration = baselineDuration + approvedExtension;
  const culpableDelay = ld.culpableDelay;

  const available = currentApprovedDuration > 0;
  const ratio = available ? culpableDelay / currentApprovedDuration : 0;
  const score = available
    ? Math.max(0, Math.min(100, Math.round(100 - ratio * 200)))
    : 0;

  return {
    available,
    baselineDuration,
    approvedExtension,
    currentApprovedDuration,
    totalDelay: ld.totalDelay,
    culpableDelay,
    currentCompletion: sch.approvedFinish,
    forecastFinish: sch.estimatedFinish || sch.forecastFinish,
    approvedCoDays: roll.approvedCoEotDays,
    approvedClaimDays: roll.approvedClaimEotDays,
    delayEvents: roll.delayCount,
    score,
  };
}

// ── Assignment evaluation ──────────────────────────────────────────────

export interface CategoryResult {
  key: CategoryKey;
  weight: number;
  automatic: boolean;
  /** null when not evaluated / no data. */
  score: number | null;
  comment: string;
  reviewer: string;
  reviewDate: string;
  /** weight ÷ Σ weights actually scored. 0 when the category is absent. */
  effectiveWeight: number;
}

export interface AssignmentPerformance {
  projectId: string;
  subId: string;
  /** Original + approved change orders. The aggregation weight. */
  contractAmount: number;
  categories: CategoryResult[];
  time: TimePerformance;
  /** Weighted score over the categories that carry a value. */
  score: number;
  grade: Grade;
  /** Σ of the raw weights that were actually scored. 0 → nothing scored. */
  coverage: number;
  scored: boolean;
  missing: CategoryKey[];
  lastReview: { reviewer: string; date: string } | null;
  history: PerfSnapshot[];
}

/**
 * One subcontract = one evaluation.
 * `rec` is only passed internally so a save can score its own result before
 * it is written; callers read from storage.
 */
export function evaluateAssignment(
  projectId: string,
  subId: string,
  originalContractValue = 0,
  rec?: PerfRecord,
): AssignmentPerformance {
  const commercial = readCommercial(projectId, subId);
  const perf = rec ?? readPerf(projectId, subId);
  const time = computeTimePerformance(commercial);

  const contractAmount = currentContractValue(
    Number(originalContractValue) || 0,
    rollupCommercial(commercial),
  );

  const raw: CategoryResult[] = CATEGORY_ORDER.map(key => {
    if (key === 'time') {
      return {
        key,
        weight: CATEGORY_WEIGHTS.time,
        automatic: true,
        score: time.available ? time.score : null,
        comment: '',
        reviewer: '',
        reviewDate: '',
        effectiveWeight: 0,
      };
    }
    const m = perf[key as ManualKey];
    return {
      key,
      weight: CATEGORY_WEIGHTS[key],
      automatic: false,
      score: m.score,
      comment: m.comment,
      reviewer: m.reviewer,
      reviewDate: m.reviewDate,
      effectiveWeight: 0,
    };
  });

  // Unscored categories are dropped and their weight redistributed, so a
  // partially reviewed subcontractor is not silently punished with zeros.
  const coverage = raw.reduce((a, c) => a + (c.score === null ? 0 : c.weight), 0);
  const categories = raw.map(c => ({
    ...c,
    effectiveWeight: coverage > 0 && c.score !== null ? (c.weight / coverage) * 100 : 0,
  }));

  const score = coverage > 0
    ? Math.round(
        categories.reduce((a, c) => a + (c.score === null ? 0 : c.score * c.weight), 0) / coverage,
      )
    : 0;

  // Most recent manual review across the five categories.
  let lastReview: { reviewer: string; date: string } | null = null;
  categories.forEach(c => {
    if (c.automatic || !c.reviewDate) return;
    if (!lastReview || c.reviewDate >= lastReview.date) {
      lastReview = { reviewer: c.reviewer, date: c.reviewDate };
    }
  });

  return {
    projectId,
    subId,
    contractAmount,
    categories,
    time,
    score,
    grade: gradeOf(score),
    coverage,
    scored: coverage > 0,
    missing: categories.filter(c => c.score === null).map(c => c.key),
    lastReview,
    history: perf.history,
  };
}

// ── Company aggregation — weighted by contract amount ──────────────────

/** What the caller already holds for each assignment. Nothing is re-derived. */
export interface AssignmentRef {
  projectId: string;
  subId: string;
  projectName?: string;
  projectCode?: string;
  trade?: string;
  /** Original contract value from pactum-subs-${projectId}. */
  contractValue: number;
}

export interface ScoredAssignment extends AssignmentPerformance {
  projectName: string;
  projectCode: string;
  trade: string;
  /** Share of the total contract amount, 0–100. */
  weightPct: number;
}

export interface CategoryBreakdown {
  key: CategoryKey;
  weight: number;
  automatic: boolean;
  /** Contract-weighted average across assignments that scored it. null = none. */
  score: number | null;
  /** How many assignments carry a value for this category. */
  count: number;
}

export interface TrendPoint {
  date: string;
  score: number;
}

export interface CompanyPerformance {
  assignments: ScoredAssignment[];
  /** Contract-amount-weighted overall score, 0–100. */
  score: number;
  grade: Grade;
  /** True when at least one assignment carries a value. */
  scored: boolean;
  breakdown: CategoryBreakdown[];
  trend: TrendPoint[];
  lastReview: { reviewer: string; date: string; project: string } | null;
  comments: { project: string; category: CategoryKey; comment: string; reviewer: string; date: string }[];
  totalContractAmount: number;
}

function weightedAvg(pairs: { value: number; weight: number }[]): number {
  const w = pairs.reduce((a, p) => a + p.weight, 0);
  if (w > 0) return pairs.reduce((a, p) => a + p.value * p.weight, 0) / w;
  if (pairs.length === 0) return 0;
  // Every contract is zero-valued — fall back to a plain average rather than
  // dropping the evaluation entirely.
  return pairs.reduce((a, p) => a + p.value, 0) / pairs.length;
}

/**
 * ONE score for the company.
 * Projects are NOT equal: each assignment is weighted by its current contract
 * amount, so a large subcontract moves the number more than a small one.
 */
export function evaluateCompany(refs: AssignmentRef[]): CompanyPerformance {
  const assignments: ScoredAssignment[] = refs.map(ref => {
    const a = evaluateAssignment(ref.projectId, ref.subId, ref.contractValue);
    return {
      ...a,
      projectName: ref.projectName || '',
      projectCode: ref.projectCode || '',
      trade: ref.trade || '',
      weightPct: 0,
    };
  });

  const scored = assignments.filter(a => a.scored);
  const totalContractAmount = assignments.reduce((s, a) => s + a.contractAmount, 0);

  assignments.forEach(a => {
    a.weightPct = totalContractAmount > 0
      ? (a.contractAmount / totalContractAmount) * 100
      : (assignments.length ? 100 / assignments.length : 0);
  });

  const score = scored.length
    ? Math.round(weightedAvg(scored.map(a => ({ value: a.score, weight: a.contractAmount }))))
    : 0;

  const breakdown: CategoryBreakdown[] = CATEGORY_ORDER.map(key => {
    const pairs = assignments
      .map(a => ({ a, c: a.categories.find(c => c.key === key)! }))
      .filter(x => x.c && x.c.score !== null)
      .map(x => ({ value: x.c.score as number, weight: x.a.contractAmount }));
    return {
      key,
      weight: CATEGORY_WEIGHTS[key],
      automatic: CATEGORY_META[key].automatic,
      score: pairs.length ? Math.round(weightedAvg(pairs)) : null,
      count: pairs.length,
    };
  });

  // Trend: at every date any review happened, the company score is rebuilt
  // from each assignment's latest snapshot on or before that date.
  const dates = Array.from(
    new Set(assignments.flatMap(a => a.history.map(h => h.date)).filter(Boolean)),
  ).sort();

  const trend: TrendPoint[] = dates.map(d => {
    const pairs = assignments
      .map(a => {
        const past = a.history.filter(h => h.date <= d);
        if (!past.length) return null;
        return { value: past[past.length - 1].score, weight: a.contractAmount };
      })
      .filter(Boolean) as { value: number; weight: number }[];
    return { date: d, score: pairs.length ? Math.round(weightedAvg(pairs)) : 0 };
  });

  let lastReview: CompanyPerformance['lastReview'] = null;
  assignments.forEach(a => {
    if (!a.lastReview) return;
    if (!lastReview || a.lastReview.date >= lastReview.date) {
      lastReview = {
        reviewer: a.lastReview.reviewer,
        date: a.lastReview.date,
        project: a.projectName || a.projectCode || a.projectId,
      };
    }
  });

  const comments = assignments.flatMap(a =>
    a.categories
      .filter(c => !c.automatic && (c.comment || '').trim())
      .map(c => ({
        project: a.projectName || a.projectCode || a.projectId,
        category: c.key,
        comment: c.comment,
        reviewer: c.reviewer,
        date: c.reviewDate,
      })),
  ).sort((x, y) => (y.date || '').localeCompare(x.date || ''));

  return {
    assignments,
    score,
    grade: gradeOf(score),
    scored: scored.length > 0,
    breakdown,
    trend,
    lastReview,
    comments,
    totalContractAmount,
  };
}

/**
 * Badge helper. Returns the engine score, or null when nothing has been
 * evaluated yet so the caller can decide what to show instead of a fake 0.
 */
export function badgeScore(refs: AssignmentRef[]): number | null {
  if (!refs.length) return null;
  const r = evaluateCompany(refs);
  return r.scored ? r.score : null;
}

/** Same colour rule the rest of the platform already uses for KPI text. */
export function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 85) return 'text-chart-4';
  if (score >= 75) return 'text-primary';
  if (score >= 60) return 'text-chart-5';
  return 'text-chart-3';
}
