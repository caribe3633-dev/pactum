import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Project } from '../../lib/data';
import { useProjectCurrency } from '../../lib/useProjectCurrency';
import { useTranslation } from '../../lib/i18n';
import { formatMoney, formatPercent, cn } from '../../lib/utils';
import { abbrevMoney, exactMoney } from '../../lib/moneyFormat';
import { formatDateOrDash } from '../../lib/dateFormat';
import { useAuth } from '../../lib/store';
import ReportButton from '../reporting/ReportButton';
// SPRINT 3 · R6 — one source for approved EOT.
import { computeApprovedEOT, daysBetween } from '../../lib/delayCalculations';
import {
  approvedOf, openOf, readSourceVersions, syncEvmPlannedApproval,
  fileEvmPlannedFromBaseline,
} from '../../lib/sourceVersions';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ScatterChart, Scatter, ReferenceArea, ReferenceLine, ZAxis, Cell,
  LineChart, Brush,
} from 'recharts';
import {
  Activity, TrendingUp, Grid3x3, ClipboardCheck, Settings2, RotateCcw,
  Check, AlertTriangle, Lock, Info, Layers, CalendarPlus,
  ArrowUpRight, ArrowDownRight, Plus, ClipboardPaste, PencilLine,
} from 'lucide-react';
import {
  readSyncedEvm, writeEvm, snapshot, metricsFor, setValue, clearOverride,
  transition, canTransition, isLocked, syncCalendar, refreshCurrent, approveClass, reopenClass, classApproved,
  STATUS_META, NEXT_STATUS, ACTIVE_STATUSES, currentPeriodIndex,
  EvmStore, EvmPeriod, PeriodStatus, Cadence, EvmSnapshot,
  // ── Refinement additions ──
  periodMetrics, cumulativeTo, eacComparison, EAC_META, EacMethod, EacOption, latestApproved,
  periodIncrements, classCumulative,
  classifyHealth, HealthVerdict, activeBaseline, rebaseline, seedBaseline,
  generateFuturePeriods, redistributePv, effectiveBounds,
  CADENCE_META, REBASELINE_CAUSES, RebaselineCause, Baseline,
  setPeriodField,
  // ── Step 20: matrix intelligence ──
  INDEX_TOLERANCE, withinTolerance, bubbleZ, matrixDomain,
  // ── Baseline entry + manual PV ──
  PvMethod, PV_METHODS, pvCurve, updateDraftBaseline,
  parsePvPaste, applyPvColumn, validatePv,
  // ── Step 12: Direct / Indirect / Total ──
  computeBacSplit, setClassValue, applyIndirectEv, classMetrics, hasSplit,
  BacSplit, ClassField,
} from '../../lib/evm';
import { effectiveScheduleDuration, timePlannedPercent } from '../../lib/delayCalculations';
/**
 * SOURCE VERSIONING. This register is one of the five a Baseline Package
 * is built from, so the version line belongs on the screen that owns the
 * data — not only on the Baseline screen. Capturing a version reads this
 * store; it never writes to it.
 */
import SourceVersionsPanel from '../SourceVersionsPanel';


/**
 * Earned Value Management — period based.
 * Destination: src/components/modules/EVMModule.tsx
 *
 * The previous version was a simulator: three sliders drove the numbers and
 * the S-curve was generated with Math.random(). Nothing on screen came from
 * the project. This replaces it with a real EVM system.
 *
 * All calculation lives in lib/evm.ts. This file renders and edits; it never
 * computes a metric of its own, so the screen and the report can never
 * disagree.
 *
 * Reads from other modules (never writes): budget, change orders, claims.
 * Owns exactly one key: pactum-evm-${projectId}.
 */

// Muted palette — existing design tokens only, no new colours.
const C_PV   = '#a5a49f';   // --c-muted     : the plan, deliberately quiet
const C_EV   = '#d4af37';   // --c-primary   : what we earned, the headline
const C_AC   = '#a85450';   // --c-destructive: what it cost
const C_GRID = 'rgba(212,175,55,0.08)';
const C_OK   = '#6f9b78';
const C_WARN = '#c08a3e';

/** Example of the column a planner pastes. Two lines, so the intent is obvious. */
const PASTE_PLACEHOLDER = '1,000,000\n2,500,000\n4,000,000';

const AXIS = { stroke: '#a5a49f', tick: { fontSize: 10, fill: '#a5a49f' } };

const TT_STYLE: React.CSSProperties = {
  background: '#1b1c1c',
  border: '1px solid rgba(212,175,55,0.3)',
  borderRadius: 0,
  fontSize: 11,
};

// The five original tabs are preserved exactly. Forecast and Baseline are
// additive — the brief forbids removing tabs, not adding them.
type Tab = 'dashboard' | 'scurve' | 'matrix' | 'periods' | 'trend' | 'forecast' | 'baseline';

const TABS: { id: Tab; icon: any; en: string; ar: string }[] = [
  { id: 'dashboard', icon: Activity,       en: 'Dashboard',   ar: 'اللوحة' },
  { id: 'periods',   icon: ClipboardCheck, en: 'Periods',     ar: 'الفترات' },
  // The Cumulative tab — the S-curve relabelled and seated BESIDE
  // Periods (owner rule): entry on one tab, the automatic cumulative
  // views + their chart on the other. Chart and table tell one story.
  { id: 'scurve',    icon: TrendingUp,     en: 'Cumulative',  ar: 'التراكمي' },
  { id: 'matrix',    icon: Grid3x3,        en: 'Matrix',      ar: 'المصفوفة' },
  { id: 'trend',     icon: Activity,       en: 'Trend',       ar: 'الاتجاه' },
  { id: 'forecast',  icon: TrendingUp,     en: 'Forecast',    ar: 'التوقعات' },
  { id: 'baseline',  icon: Layers,         en: 'Baseline',    ar: 'الأساس' },
];

/** Health badge tone -> existing badge class. No new colours. */
function healthBadge(tone: string): string {
  return tone === 'ok' ? 'badge-ok'
       : tone === 'gold' ? 'badge-gold'
       : tone === 'warn' ? 'badge-warn'
       : tone === 'risk' ? 'badge-risk' : 'badge-neutral';
}

/** Index colour: 1.00 is the target, 0.95 the tolerance floor. */
function indexTone(v: number | null): string {
  if (v === null) return 'text-muted-foreground';
  if (v >= 1)    return 'text-chart-4';
  if (v >= 0.95) return 'text-primary';
  if (v >= 0.9)  return 'text-chart-5';
  return 'text-chart-3';
}

function varianceTone(v: number): string {
  if (v > 0) return 'text-chart-4';
  if (v < 0) return 'text-chart-3';
  return 'text-muted-foreground';
}

function fmtIndex(v: number | null): string {
  return v === null ? '—' : v.toFixed(3);
}

/** TCPI colour — INVERTED vs an index: above 1 means the remaining work
 *  must outperform everything achieved so far just to land on BAC. */
function tcpiTone(v: number | null): string {
  if (v === null) return 'text-muted-foreground';
  if (v <= 1)    return 'text-chart-4';
  if (v <= 1.1)  return 'text-primary';
  return 'text-chart-3';
}

/** Compact money for axes: 145M, 8.5M, 900K. */
function shortMoney(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

export default function EVMModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  /**
   * EVM STORES NO MONEY OF ITS OWN. Confirmed rule.
   *
   * BAC, EAC, PV, EV, AC and VAC are all DERIVED from Budget, approved
   * Change Orders, approved Claims and Certificates, every one of which
   * has already been converted at its own transaction date and frozen.
   * There is nothing here to enter in a currency, and no second
   * conversion may happen — converting an already-converted figure is
   * how a total silently doubles its own rate.
   *
   * So this module only needs to know what unit its inputs arrived in,
   * which is the project's reporting currency.
   */
  // PROJECT SCREENS ARE DENOMINATED IN THE CONTRACT CURRENCY.
  // `.reporting` is the AGGREGATION currency, used when this project is
  // rolled up into a company or portfolio figure. Reading it here is what
  // printed the company's unit on a project's own numbers.
  const ccy = useProjectCurrency(project).base;
  const { lang } = useTranslation();
  const { user } = useAuth();
  const isRtl = lang === 'ar';
  const isAdmin = user?.role === 'admin';

  const [store, setStore] = useState<EvmStore>(() => readSyncedEvm(project));

  /* Approved EVM Planned source version — shown beside the period badge so
     "approved" is visible where the user looks, whichever track it came from. */
  const evmSrc = useMemo(() => {
    const sv = readSourceVersions(project.id);
    return {
      approved: approvedOf(sv, 'evm-planned'),
      open: openOf(sv, 'evm-planned'),
    };
  }, [project.id, store]);

  /** ONE approval, ONE number: files the EVM Planned source version with the
      ACTIVE EVM BASELINE's version number (V3 baseline = source V3). */
  const activeBaseline = useMemo(
    () => (store.baselines ?? []).find(b => b.id === store.settings.activeBaselineId) ?? null,
    [store],
  );
  const fileFromActiveBaseline = (versionOverride?: number) => {
    const v = versionOverride ?? activeBaseline?.version ?? 0;
    if (v > 0) {
      fileEvmPlannedFromBaseline(project.id, { userId: user?.username ?? 'unknown' }, v);
    } else {
      syncEvmPlannedApproval(project.id, { userId: user?.username ?? 'unknown' });
    }
  };
  const [tab, setTab] = useState<Tab>('dashboard');
  const [showSettings, setShowSettings] = useState(false);
  // SETTINGS ARE STAGED, NOT LIVE: the panel edits a DRAFT and the Save
  // button commits it — one deliberate act, instead of every dropdown
  // rewriting the store (and rebuilding the calendar) on each change.
  const [settingsDraft, setSettingsDraft] = useState({
    cadence: store.settings.cadence,
    eacMethod: store.settings.eacMethod,
  });
  useEffect(() => {
    if (showSettings) {
      setSettingsDraft({ cadence: store.settings.cadence, eacMethod: store.settings.eacMethod });
    }
  }, [showSettings, store.settings.cadence, store.settings.eacMethod]);
  const [rbOpen, setRbOpen] = useState(false);
  const [rb, setRb] = useState({ reason: '', cause: 'approved-eot' as RebaselineCause, daysAdded: '', valueAdded: '' });
  const [editV1, setEditV1] = useState(false);
  const [v1, setV1] = useState({ start: '', finish: '', bac: '', reason: '' });
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Re-read whenever the project changes; the calendar follows its dates.
  useEffect(() => {
    const st = readSyncedEvm(project);
    setStore(st);
    // SELF-CONVERGE: legacy projects (approved baselines but no matching
    // source versions) are filed once on open, so the numbers unify without
    // waiting for the next approval act.
    const bl = (st.baselines ?? []).find(b => b.id === st.settings.activeBaselineId);
    if (bl?.approved) {
      fileEvmPlannedFromBaseline(project.id, { userId: user?.username ?? 'unknown' }, bl.version);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const persist = useCallback((next: EvmStore) => {
    setStore(next);
    writeEvm(project.id, next);
  }, [project.id]);

  const snap: EvmSnapshot = useMemo(() => snapshot(project, store), [project, store]);
  const { bac, m, period, prevM, quadrant, prevQuadrant, points, dates, cum, eacOptions, health, baseline } = snap;

  const liveIndex = currentPeriodIndex(store.periods);
  const canWrite = canEdit && store.settings.allowManual;

  // ── MATRIX INTELLIGENCE (Step 20) ────────────────────────────────────
  // Trend point: last-3-period rolling indices from cumulative performance —
  // where the project lands if the current rhythm holds.
  const trendSpi = cum.spi3, trendCpi = cum.cpi3;
  // Both indices inside the ±5% band: on target, no alarm.
  const onTarget = withinTolerance(m.spi, m.cpi);
  // Axes follow the data; the tolerance band is always fully on screen.
  const mDom = matrixDomain(
    [...points.map(p => p.spi), prevM?.spi ?? null, m.spi, trendSpi],
    [...points.map(p => p.cpi), prevM?.cpi ?? null, m.cpi, trendCpi],
  );
  /** Long horizons lose the dots and zoom with the brush — a 5-year
   *  monthly programme draws 60 points per series. */
  const manyPeriods = points.length > 24;
  /** PER-PERIOD INCREMENTS for the Periods table (owner rule): that
   *  table shows what each period ADDS — the running total lives on the
   *  Cumulative tab. */
  const incs = useMemo(() => periodIncrements(store.periods), [store.periods]);

  /**
   * ══════════════════════════════════════════════════════════════════════
   * STEP 12 — THE COST-CLASS LENS.
   *
   * One toggle, three views, ONE table. The alternative — six money
   * columns — would have pushed the row past readable width and invented
   * a layout that exists nowhere else in PACTUM. The columns stay as they
   * are; only which class they describe changes.
   * ══════════════════════════════════════════════════════════════════════
   */
  const [lens, setLens] = useState<'total' | 'direct' | 'indirect'>('total');

  /** BAC from the APPROVED baseline package, split by class (Q3=B/Q6=B). */
  const bacSplit: BacSplit = useMemo(
    () => computeBacSplit(project, store.settings),
    [project, store.settings],
  );

  /**
   * The effective approved schedule, as at the reporting period end.
   * `blocked` is Q2=C: an approved EOT with no effective date makes the
   * time basis unknowable, so Indirect EV is refused rather than guessed.
   */
  const sched = useMemo(() => {
    const asOf = period?.end || new Date().toISOString().slice(0, 10);
    return effectiveScheduleDuration(
      project.id,
      project.commencementDate || '',
      Number(project.plannedDurationDays) || 0,
      asOf,
    );
  }, [project, period?.end]);

  /**
   * Recompute the time-based Indirect EV for every OPEN period.
   *
   * Approved and frozen periods are skipped by `applyIndirectEv` itself,
   * so history is never rewritten when an EOT lands (Q4=A). Each period
   * is measured at ITS OWN end date, which is what keeps March measured
   * against March's approved duration.
   */
  const recomputeIndirectEv = useCallback(() => {
    if (!bacSplit.available) return;
    let next = store;
    for (const p of store.periods) {
      // Signed rows are never rewritten: the whole period, or the
      // indirect class on its own (separate approvals).
      if (p.status === 'approved' || p.frozen || p.indirectStatus === 'approved') continue;

      /* OWNER'S RULE: indirectEv = indirectBac \u00d7 \u0646\u0633\u0628\u0629 \u0627\u0644\u0634\u0647\u0631 \u0627\u0644\u0646\u0641\u0633\u0647.
         The month's own share = the period's days \u00f7 the effective approved
         duration at that period's end. Every period is independent \u2014 past,
         current and future alike each carry their slice, so no month is
         ever zero and no month swallows another's curve. */
      const eff = effectiveScheduleDuration(
        project.id,
        project.commencementDate || '',
        Number(project.plannedDurationDays) || 0,
        p.end,
      );
      const days = daysBetween(p.start, p.end) + 1; // inclusive
      const pct = eff.blocked || eff.effectiveDurationDays <= 0 || !p.start
        ? null
        : Math.min(1, days / eff.effectiveDurationDays);
      next = applyIndirectEv(next, p.id, pct, bacSplit.indirectBac);
    }
    if (next !== store) persist(next);
  }, [project, store, bacSplit, persist]);

  /** One component write. The parent total is recomputed by the engine. */
  const editClass = (id: string, field: ClassField, raw: string) => {
    if (raw === null || raw === undefined || String(raw).trim() === '') return;
    const v = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(v)) return;
    persist(setClassValue(store, id, field, v));
  };

  // ── Settings ──
  const setCadence = (c: Cadence) => {
    const base = { ...store, settings: { ...store.settings, cadence: c } };
    // Changing cadence rebuilds the calendar. Approved periods survive
    // because syncCalendar matches on start date.
    persist(refreshCurrent(project, syncCalendar(project, base).store));
  };
  const setEacMethod = (v: EvmStore['settings']['eacMethod']) =>
    persist({ ...store, settings: { ...store.settings, eacMethod: v } });
  /** Commit the staged settings — only what actually changed applies
   *  (a cadence change rebuilds the calendar; it must not run for free). */
  const saveSettings = () => {
    if (settingsDraft.cadence !== store.settings.cadence) setCadence(settingsDraft.cadence);
    if (settingsDraft.eacMethod !== store.settings.eacMethod) setEacMethod(settingsDraft.eacMethod);
    setShowSettings(false);
  };

  // ── Period editing ──
  const edit = (id: string, field: 'pv' | 'ev' | 'ac', raw: string) => {
    /**
     * STEP 11 — blank is REFUSED, not coerced.
     *
     * `Number('')` is 0, so clearing the box and pressing Enter used to
     * record a Finance entry of zero that nobody typed. Blank means "I
     * did not enter anything" and must leave the value alone. An
     * explicit "0" still passes and is stored as a real, entered zero.
     */
    if (raw === null || raw === undefined || String(raw).trim() === '') return;
    const v = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(v)) return;
    persist(setValue(store, id, field, v));
  };
  const unlock = (id: string, field: 'pv' | 'ev' | 'ac') =>
    persist(refreshCurrent(project, clearOverride(store, id, field)));

  const move = (p: EvmPeriod, to: PeriodStatus) => {
    // BAC is passed so the frozen snapshot records the budget in force.
    /* No comment argument: the box it came from is gone. `transition`
       still accepts one, and preserves any comment already stored on the
       period, so passing undefined changes nothing that was recorded. */
    const res = transition(store, p.id, to, user?.username ?? 'unknown', undefined, bac);
    if (res.ok) {
      persist(res.store);
      // BRIDGE: signing off a period also files an approved EVM Planned
      // source version, so the Baseline cards and lag alerts move at once.
      if (to === 'approved') {
        fileFromActiveBaseline();
      }
    }
  };

  // ── SEPARATE CLASS APPROVALS (owner rule) ──
  // Direct and Indirect sign off independently; the total freezes only
  // when both have. Reopening one class thaws the total but KEEPS every
  // stored value — a signature is corrected, the data is not erased.
  const approveCls = (p: EvmPeriod, cls: 'direct' | 'indirect') => {
    const res = approveClass(store, p.id, cls, user?.username ?? 'unknown', bac);
    if (res.ok) {
      persist(res.store);
      // Completing the pair is a full approval — file the source version.
      if (res.store.periods.find(x => x.id === p.id)?.status === 'approved') {
        fileFromActiveBaseline();
      }
    }
  };
  const reopenCls = (p: EvmPeriod, cls: 'direct' | 'indirect') => {
    const res = reopenClass(store, p.id, cls, user?.username ?? 'unknown');
    if (res.ok) persist(res.store);
  };

  const doRebaseline = () => {
    if (!rb.reason.trim()) return;
    const res = rebaseline(project, store, {
      reason: rb.reason.trim(),
      cause: rb.cause,
      daysAdded: Number(rb.daysAdded) || 0,
      valueAdded: Number(rb.valueAdded) || 0,
      approvedBy: user?.username ?? 'unknown',
    });
    // New baseline -> extend the calendar and redistribute FUTURE PV only.
    const grown = generateFuturePeriods(project, res.store).store;
    persist(redistributePv(project, grown));
    // BRIDGE (unified numbering): the new baseline version IS the source version.
    const bv = (res.store.baselines ?? []).reduce((mx: number, b: any) => Math.max(mx, Number(b.version) || 0), 0);
    fileFromActiveBaseline(bv || undefined);
    setRb({ reason: '', cause: 'approved-eot', daysAdded: '', valueAdded: '' });
    setRbOpen(false);
  };

  /**
   * The banner asks ONE question: does an approved Baseline Package
   * exist? It used to ask `needsBaselineApproval(store)`, which inspects
   * the EVM baseline list — a different object entirely. After approving
   * a package the banner still read "No approved Baseline Package",
   * because nothing had changed in the list it was watching.
   */
  const draftPending = !bacSplit.available;

  const openV1 = () => {
    const b = baseline;
    setV1({
      start: b?.start ?? '', finish: b?.finish ?? '',
      bac: b ? String(Math.round(b.bac)) : '', reason: b?.reason ?? '',
    });
    setEditV1(true);
  };

  const saveV1 = () => {
    let next = updateDraftBaseline(store, {
      start: v1.start, finish: v1.finish,
      bac: Number(v1.bac) || 0, reason: v1.reason.trim(),
    });
    // The calendar follows the dates the planner just entered.
    next = syncCalendar(project, next).store;
    next = redistributePv(project, next);
    persist(next);
    setEditV1(false);
  };

  // PV DISTRIBUTION + BAC OVERRIDE SETTINGS REMOVED (owner decision):
  // distribution is scurve until a programme is pasted (then manual),
  // and BAC is always the signed package / derived contract total.

  const editableCount = store.periods.filter(p => p.status !== 'approved' && !p.frozen).length;
  const pasteParsed = pasteText.trim() ? parsePvPaste(pasteText, editableCount) : null;

  const doPaste = () => {
    if (!pasteParsed || pasteParsed.values.length === 0) return;
    const res = applyPvColumn(store, pasteParsed.values);
    persist(res.store);
    setPasteText('');
    setPasteOpen(false);
  };

  const pvCheck = validatePv(store, bac);

  const doGenerate = () => {
    const res = generateFuturePeriods(project, store);
    if (res.created > 0) persist(res.store);
  };

  const switchBaseline = (id: string) => {
    const next = { ...store, settings: { ...store.settings, activeBaselineId: id } };
    // Switching recalculates FUTURE forecasts only; frozen history is inert.
    persist(redistributePv(project, next));
    // BRIDGE (unified numbering): activating BL V3 files source version V3.
    const bv = (store.baselines ?? []).find(b => b.id === id)?.version ?? 0;
    fileFromActiveBaseline(bv || undefined);
  };

  // ── Report context: exactly what the screen shows ──
  const reportCtx = {
    project,
    // SPRINT 4 — declares the unit every EVM money figure is in.
    reportCurrency: ccy,
    evm: {
      bac, pv: m.pv, ev: m.ev, ac: m.ac,
      spi: m.spi, cpi: m.cpi, sv: m.sv, cv: m.cv,
      eac: m.eac, etc: m.etc, vac: m.vac, tcpi: m.tcpi,
      percentComplete: m.percentComplete,
      percentPlanned: m.percentPlanned,
      percentSpent: m.percentSpent,
      period: period?.label ?? '',
      periodStatus: period?.status ?? '',
      quadrant: isRtl ? quadrant.ar : quadrant.en,
      score: snap.score,
      baselineFinish: dates.baselineFinish,
      forecastFinish: dates.forecastFinish,
      slipDays: dates.slipDays,
      approvedPeriods: snap.approvedCount,
      cadence: snap.cadence,
      // Refinement: the basis of the forecast must be auditable in print.
      health: isRtl ? health.ar : health.en,
      healthReasons: (isRtl ? health.reasonsAr : health.reasons).join(' · '),
      eacMethod: store.settings.eacMethod,
      eacMethodLabel: EAC_META[store.settings.eacMethod].label,
      eacFormula: EAC_META[store.settings.eacMethod].formula,
      baselineName: baseline?.name ?? 'Project dates',
      baselineVersion: baseline?.version ?? 0,
      cumulativePeriods: cum.count,
      cpiCum: cum.cpiCum,
      spiCum: cum.spiCum,
    },
    eacOptions: eacOptions.map(o => ({
      method: o.method, label: o.label, formula: o.formula,
      eac: o.eac, etc: o.etc, vac: o.vac,
      official: o.official, applicable: o.applicable,
    })),
    baselines: (store.baselines ?? []).map(b => ({
      name: b.name, version: b.version, start: b.start, finish: b.finish,
      durationDays: b.durationDays, bac: b.bac, reason: b.reason,
      approvedBy: b.approvedBy, approvedOn: b.approvedOn,
      active: b.id === (baseline?.id ?? ''),
    })),
    // periodMetrics honours the freeze, so a printed history matches what
    // was approved even after a re-baseline.
    periods: store.periods.map(p => {
      const pm = periodMetrics(p, bac, store.settings.eacMethod, cumulativeTo(store.periods, p));
      return {
        label: p.label, start: p.start, end: p.end,
        pv: pm.pv, ev: pm.ev, ac: pm.ac,
        spi: pm.spi, cpi: pm.cpi, sv: pm.sv, cv: pm.cv,
        eac: pm.eac, vac: pm.vac,
        status: p.status, reviewer: p.reviewer, reviewDate: p.reviewDate,
        frozen: Boolean(p.frozen),
      };
    }),
  };

  // ── No programme, no periods ──
  if (store.periods.length === 0) {
    return (
      <div className="pg-stack animate-in fade-in duration-500">

      <SourceVersionsPanel projectId={project.id} only="evm-planned" canEdit={canEdit} compact />

        <div className="ds-empty">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <Activity className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <div className="ds-empty-title">
            {isRtl ? 'لا يوجد تقويم أداء' : 'No Performance Calendar'}
          </div>
          <p className="text-(length:--t-body) text-muted-foreground mt-2 max-w-md mx-auto">
            {isRtl
              ? 'أدخل تاريخ البدء والمدة المخططة في بيانات المشروع، وسيُبنى التقويم تلقائياً.'
              : 'Enter a Commencement Date and Planned Duration on the project record and the calendar builds itself.'}
          </p>
        </div>
      </div>
    );
  }

  const q = quadrant;
  const qTone = q.tone === 'ok' ? 'text-chart-4'
              : q.tone === 'gold' ? 'text-primary'
              : q.tone === 'warn' ? 'text-chart-5'
              : q.tone === 'risk' ? 'text-chart-3' : 'text-muted-foreground';

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      {/* ══ EXECUTIVE RIBBON — two rows, nothing more ══ */}
      <div className="ds-card ds-card-tight !p-0 overflow-hidden">
        {/* Primary */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-white/5">
          {[
            { k: isRtl ? 'قيمة العقد' : 'Contract Value', v: formatMoney(project.contractValue, { currency: ccy }), c: 'text-white' },
            { k: isRtl ? 'المدة المعتمدة' : 'Approved Duration',
              v: project.plannedDurationDays ? `${project.plannedDurationDays}d` : '—', c: 'text-white' },
            { k: isRtl ? 'الانتهاء المتوقع' : 'Forecast Finish',
              v: formatDateOrDash(dates.forecastFinish, isRtl ? 'ar' : 'en'),
              c: dates.slipDays > 0 ? 'text-chart-5' : 'text-chart-4' },
            { k: 'SPI', v: fmtIndex(m.spi), c: indexTone(m.spi) },
            { k: 'CPI', v: fmtIndex(m.cpi), c: indexTone(m.cpi) },
          ].map((x, i) => (
            <div key={i} className="bg-black/30 px-4 py-3">
              <div className="text-(length:--t-label) font-medium uppercase tracking-widest text-muted-foreground mb-1">{x.k}</div>
              <div className={cn('font-mono text-base font-semibold number-ltr', x.c)}>{x.v}</div>
            </div>
          ))}
          {/* CURRENT POSITION — the Matrix's own state, in the header tile:
              ahead/behind × under/over budget, straight from SPI and CPI.
              The old Healthy/Watch/Critical verdict moves into the tooltip
              (with its reasons) so no signal is lost. */}
          <div className="bg-black/30 px-4 py-3"
               title={[isRtl ? health.ar : health.en, ...(isRtl ? health.reasonsAr : health.reasons)].join(' · ')}>
            <div className="text-(length:--t-label) font-medium uppercase tracking-widest text-muted-foreground mb-1">
              {isRtl ? 'الحالة' : 'EVM Health'}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('badge', healthBadge(quadrant.tone))}>
                {isRtl ? quadrant.ar : quadrant.en}
              </span>
              {onTarget && (
                <span className="text-(length:--t-micro) tracking-widest text-primary border border-primary/30 bg-primary/[0.07] px-1.5 py-0.5 number-ltr">
                  {isRtl ? 'على الهدف ±٥٪' : 'ON TARGET ±5%'}
                </span>
              )}
              <span className="font-mono text-xs text-muted-foreground number-ltr">
                {snap.score === null ? '—' : snap.score}
              </span>
            </div>
          </div>
        </div>
        {/* Secondary */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-white/5 border-t border-primary/15">
          {[
            /**
             * NO DATA IS NOT ZERO.
             *
             * These printed "SAR 0" on a project with no approved
             * baseline — a budget of zero is a claim, and nobody made
             * it. EAC and VAC are derived from BAC, so when BAC is
             * unavailable neither of them means anything either. All
             * three now show an em dash, matching SPI and CPI directly
             * above them, which already did this correctly.
             */
            { k: 'BAC', v: bacSplit.available ? formatMoney(bac, { currency: ccy }) : '—',
              c: 'text-primary' },
            { k: 'EAC', v: bacSplit.available ? formatMoney(m.eac, { currency: ccy }) : '—',
              c: bacSplit.available ? (m.eac > bac ? 'text-chart-3' : 'text-chart-4') : 'text-muted-foreground' },
            { k: 'VAC', v: bacSplit.available ? formatMoney(m.vac, { currency: ccy }) : '—',
              c: bacSplit.available ? varianceTone(m.vac) : 'text-muted-foreground' },
            /**
             * A project that has never had a delay assessed has no
             * `delayDays` at all, and this rendered the literal string
             * "undefinedd" on a financial ribbon. Substituting 0 would be
             * just as wrong in the other direction — it would assert
             * "zero days late", which nobody measured. NO DATA is not
             * ZERO: an unassessed delay shows a dash.
             */
            { k: isRtl ? 'التأخير' : 'Delay',
              v: Number.isFinite(Number(project.delayDays))
                ? `${Number(project.delayDays)}d` : '—',
              c: Number(project.delayDays) > 0 ? 'text-chart-5'
                 : Number.isFinite(Number(project.delayDays)) ? 'text-chart-4'
                 : 'text-muted-foreground' },
            { k: isRtl ? 'أيام المطالبات' : 'Claim Days', v: `${claimDays(project.id)}d`, c: 'text-muted-foreground' },
            { k: isRtl ? 'التمديدات المعتمدة' : 'Approved Ext.', v: `${approvedExtensions(project.id)}d`, c: 'text-primary' },
          ].map((x, i) => (
            <div key={i} className="bg-black/30 px-4 py-2.5">
              <div className="text-(length:--t-label) font-medium uppercase tracking-widest text-muted-foreground mb-1">{x.k}</div>
              <div className={cn('font-mono text-xs font-semibold number-ltr', x.c)}>{x.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ BASELINE NOT YET APPROVED ══
          A new project starts here. The plan is a proposal until someone
          confirms it, and the page says so rather than pretending. */}
      {/*
        ══════════════════════════════════════════════════════════════════
        THE SEPARATE "APPROVE BASELINE" BANNER IS GONE FROM THIS SCREEN.

        EVM had its OWN approval — a provisional baseline proposed from
        the project dates, approved with one click, right here. Budget,
        Cash Flow, Claims and Change Orders went through a completely
        different route: capture a source version, submit it, approve it,
        then build a Baseline Package. Two ceremonies for the same act,
        and only one of them was gated.

        Worse, they disagreed about what "approved" meant. Approving here
        set `settings.activeBaselineId` and nothing else; `computeBacSplit`
        never looked at it, so a user could approve an EVM baseline and
        still be told BAC was unavailable — which is exactly what
        happened.

        ONE ROUTE NOW, for all five sources:

            capture -> submit -> approve   (per source)
                    -> Build Baseline Package
                    -> gate -> approve     (Baselines screen)

        `approveBaseline` REMAINS in evm.ts and still works. The PV
        calendar it governs is unchanged, and projects that already
        approved one keep it. This screen simply no longer offers a
        second, ungated way to sign off a plan.
        ══════════════════════════════════════════════════════════════════
      */}
      {draftPending && (
        <div className="ds-card ds-card-tight border-chart-5/40 bg-chart-5/[0.05]">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-chart-5 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-serif text-chart-5">
                {isRtl ? 'لا توجد حزمة خط أساس معتمدة' : 'No approved Baseline Package'}
              </div>
              <p className="text-(length:--t-body) text-muted-foreground mt-1 max-w-3xl">
                {isRtl
                  ? 'موازنة الإنجاز (BAC) تُقرأ من حزمة خط الأساس وحدها. اعتمد نسخ المصادر الخمسة ثم ابنِ الحزمة واعتمدها من شاشة خطوط الأساس — لا يوجد اعتماد منفصل هنا.'
                  : 'BAC is read from the Baseline Package alone. Approve the five source versions, then build and approve the package on the Baselines screen — there is no separate approval here.'}
              </p>
              {canEdit && (
                <button onClick={openV1} className="btn btn-secondary btn-sm mt-2">
                  <PencilLine className="w-3 h-3" />
                  {isRtl ? 'تحرير توزيع القيمة المخططة' : 'Edit Planned-Value Distribution'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ BASELINE V1 EDITOR ══ */}
      {editV1 && canEdit && (
        <div className="ds-card ds-card-tight">
          <h3 className="sec-head">
            {isRtl ? 'بيانات الأساس' : 'Baseline Details'}
            <span className="text-muted-foreground font-sans normal-case tracking-normal text-xs ms-2">
              {baseline?.name}
            </span>
          </h3>
          <div className="form-grid">
            <div className="field">
              <label className="field-label" data-required>{isRtl ? 'تاريخ البدء' : 'Start Date'}</label>
              <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                     style={{ colorScheme: 'dark' }}
                     value={v1.start} onChange={e => setV1({ ...v1, start: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label" data-required>{isRtl ? 'تاريخ الانتهاء' : 'Finish Date'}</label>
              <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                     style={{ colorScheme: 'dark' }}
                     value={v1.finish} onChange={e => setV1({ ...v1, finish: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">
                BAC
                <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                  {isRtl ? 'الميزانية عند الإنجاز' : 'Budget at Completion'}
                </span>
              </label>
              <input className="field-input font-mono number-ltr" type="number" dir="ltr"
                     value={v1.bac} onChange={e => setV1({ ...v1, bac: e.target.value })} />
            </div>
            <div className="field xl:col-span-2">
              <label className="field-label">{isRtl ? 'المرجع' : 'Reference'}</label>
              <input className="field-input" value={v1.reason}
                     placeholder={isRtl ? 'رقم العقد أو محضر الاعتماد' : 'Contract number or approval minute'}
                     onChange={e => setV1({ ...v1, reason: e.target.value })} />
            </div>
          </div>
          {v1.start && v1.finish && (
            <p className="text-(length:--t-body) text-muted-foreground mt-2">
              {isRtl ? 'المدة المحسوبة' : 'Computed duration'}{': '}
              <span className="font-mono text-white number-ltr">
                {Math.max(0, Math.round((new Date(v1.finish).getTime() - new Date(v1.start).getTime()) / 86400000))}d
              </span>
            </p>
          )}
          <div className="form-actions">
            <button type="button" onClick={() => setEditV1(false)} className="btn btn-ghost">
              {isRtl ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="button" onClick={saveV1} className="btn btn-primary">
              {isRtl ? 'حفظ' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* ══ CONTROL BAR ══ */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {TABS.map(x => (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 text-xs border rounded-md transition-colors uppercase tracking-wider',
                tab === x.id
                  ? 'bg-primary/10 text-primary border-primary'
                  : 'border-white/[0.06] text-muted-foreground hover:text-white',
              )}
            >
              <x.icon className="w-3.5 h-3.5" />
              {isRtl ? x.ar : x.en}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {(() => {
            /* ONE badge, the whole truth: the reporting period, the approved
               EVM Planned version the Baseline reads, and — when a newer
               version is in flight — its state, so nothing looks stuck. */
            const aV = evmSrc.approved?.version;
            const oV = evmSrc.open?.version;
            const oSt = evmSrc.open?.status;
            const newerInFlight = oV !== undefined && (aV === undefined || oV > aV);
            const inFlight = newerInFlight
              ? ` · ${isRtl ? `V${oV} ${oSt === 'submitted' ? 'مُقدَّمة' : 'مسودة'}` : `V${oV} ${oSt === 'submitted' ? 'submitted' : 'draft'}`}`
              : '';
            const blV = activeBaseline?.version ?? aV;
            if (evmSrc.approved || (activeBaseline?.approved && blV)) {
              return (
                <span className="badge badge-ok" title={isRtl
                  ? 'اعتماد الـ EV الموحد — نفس رقم أساس الـ EVM اللي بتقراها خطوط الأساس'
                  : 'the unified EV approval — same number as the EVM baseline the Baseline reads'}>
                  {period?.label}
                  {' · '}
                  {isRtl ? `EV V${blV} معتمدة ✓` : `EV V${blV} approved ✓`}
                  {inFlight}
                </span>
              );
            }
            return (
              <span className={cn('badge', period?.status === 'approved' ? 'badge-ok' : 'badge-gold')}>
                {period?.label}
                {' · '}
                {isRtl ? STATUS_META[period?.status ?? 'draft'].ar : STATUS_META[period?.status ?? 'draft'].en}
                {evmSrc.open && ` · EV Planned ${isRtl ? `V${oV} ${oSt === 'submitted' ? 'مُقدَّمة' : 'مسودة'}` : `V${oV} ${oSt === 'submitted' ? 'submitted' : 'draft'}`}`}
              </span>
            );
          })()}
          {isAdmin && (
            <button onClick={() => setShowSettings(v => !v)} className="btn btn-secondary btn-sm">
              <Settings2 className="w-3 h-3" />
              {isRtl ? 'الإعدادات' : 'Settings'}
            </button>
          )}
          <ReportButton reportId="earned-value" context={reportCtx} />
        </div>
      </div>

      {/* ══ SETTINGS ══ */}
      {showSettings && isAdmin && (
        <div className="ds-card ds-card-tight">
          {/*
            TWO SETTINGS SURVIVE, AND THEY ARE STAGED (owner decision):
            BAC Override and PV Distribution are GONE — BAC is always the
            signed package / derived contract total, and PV is the
            S-curve assumption until a programme is pasted. What remains
            edits a DRAFT; nothing touches the store until Save.
          */}
          <div className="form-grid">
            <div className="field">
              <label className="field-label">{isRtl ? 'دورية التقييم' : 'Cadence'}</label>
              <select className="field-input" value={settingsDraft.cadence}
                      onChange={e => setSettingsDraft(d => ({ ...d, cadence: e.target.value as Cadence }))}>
                {CADENCE_META.map(c => (
                  <option key={c.value} value={c.value}>{isRtl ? c.ar : c.en}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">{isRtl ? 'طريقة EAC' : 'EAC Method'}</label>
              <select className="field-input" value={settingsDraft.eacMethod}
                      onChange={e => setSettingsDraft(d => ({ ...d, eacMethod: e.target.value as EvmStore['settings']['eacMethod'] }))}>
                <option value="cpi">BAC / CPI</option>
                <option value="atypical">AC + (BAC − EV)</option>
                <option value="composite">AC + (BAC − EV) / (CPI × SPI)</option>
              </select>
            </div>
          </div>
          <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
            {isRtl
              ? `BAC = قيمة العقد ${formatMoney(snap.bacParts.base, { currency: ccy })} + أوامر تغيير معتمدة ${formatMoney(snap.bacParts.cos, { currency: ccy })} + مطالبات معتمدة ${formatMoney(snap.bacParts.claims, { currency: ccy })} — لا تجاوز يدوياً؛ الميزانية الموقَّعة هي الحكم.`
              : `BAC = Contract ${formatMoney(snap.bacParts.base, { currency: ccy })} + approved COs ${formatMoney(snap.bacParts.cos, { currency: ccy })} + approved claims ${formatMoney(snap.bacParts.claims, { currency: ccy })} — no manual override; the signed budget rules.`}
          </p>
          <div className="form-actions">
            <button type="button" onClick={() => setShowSettings(false)} className="btn btn-ghost">
              {isRtl ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="button" onClick={saveSettings} className="btn btn-primary">
              {isRtl ? 'حفظ الإعدادات' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════ DASHBOARD ══════════════════ */}
      {tab === 'dashboard' && (
        <>
          {/* Variance cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <VarianceCard ccy={ccy}
              title={isRtl ? 'الجدول الزمني' : 'Schedule'}
              index={m.spi} indexLabel="SPI"
              variance={m.sv} varianceLabel="SV"
              prev={prevM?.spi ?? null}
              isRtl={isRtl}
            />
            <VarianceCard ccy={ccy}
              title={isRtl ? 'التكلفة' : 'Cost'}
              index={m.cpi} indexLabel="CPI"
              variance={m.cv} varianceLabel="CV"
              prev={prevM?.cpi ?? null}
              isRtl={isRtl}
            />
            {/* Forecast card */}
            <div className="ds-card ds-card-raised">
              <div className="flex items-center justify-between mb-3">
                <h3 className="sec-head !mb-0">{isRtl ? 'التوقعات' : 'Forecast'}</h3>
                {m.vac < 0 && (
                  <span className="badge badge-risk">
                    <AlertTriangle className="w-3 h-3" />
                    {isRtl ? 'تجاوز متوقع' : 'Overrun'}
                  </span>
                )}
              </div>
              <div className="space-y-2.5">
                {[
                  { k: 'BAC', v: bac, c: 'text-primary' },
                  { k: 'EAC', v: m.eac, c: m.eac > bac ? 'text-chart-3' : 'text-chart-4' },
                  { k: 'ETC', v: m.etc, c: 'text-white' },
                  { k: 'VAC', v: m.vac, c: varianceTone(m.vac) },
                ].map(x => (
                  <div key={x.k} className="flex items-center justify-between">
                    <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">{x.k}</span>
                    <span className={cn('font-mono text-sm font-semibold number-ltr', x.c)}>{formatMoney(x.v, { currency: ccy })}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">TCPI</span>
                  <span className={cn('font-mono text-sm font-semibold number-ltr', indexTone(m.tcpi))}>
                    {fmtIndex(m.tcpi)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* BAC progress */}
          <div className="ds-card ds-card-raised">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="sec-head !mb-0">{isRtl ? 'تقدم الميزانية' : 'BAC Progress'}</h3>
              <span className="font-mono text-lg text-primary number-ltr">{formatMoney(bac, { currency: ccy })}</span>
            </div>
            <div className="space-y-3">
              {[
                { k: isRtl ? 'مخطط' : 'Planned',  short: 'PV', pct: m.percentPlanned,  val: m.pv, colour: C_PV },
                { k: isRtl ? 'مكتسب' : 'Earned',  short: 'EV', pct: m.percentComplete, val: m.ev, colour: C_EV },
                { k: isRtl ? 'فعلي' : 'Actual',   short: 'AC', pct: m.percentSpent,    val: m.ac, colour: C_AC },
              ].map(x => (
                <div key={x.short}>
                  <div className="flex items-center justify-between text-(length:--t-body) mb-1">
                    <span className="text-white/70">
                      {x.k}<span className="text-muted-foreground font-mono ms-2">{x.short}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-muted-foreground number-ltr">{formatMoney(x.val, { currency: ccy })}</span>
                      <span className="font-mono text-white number-ltr w-12 text-end">{formatPercent(x.pct)}</span>
                    </span>
                  </div>
                  <div className="h-2 bg-white/[0.06] overflow-hidden">
                    <div className="h-full transition-all duration-500"
                         style={{ width: `${Math.min(100, x.pct * 100)}%`, background: x.colour }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-(length:--t-second) text-muted-foreground italic mt-3">
              {isRtl
                ? `القيم المعروضة من فترة ${period?.label} · مصدر التكلفة الفعلية: ${acLabel(snap.acSource, true)}`
                : `Figures from ${period?.label} · Actual cost source: ${acLabel(snap.acSource, false)}`}
            </p>
          </div>

          {/* Forecast trend */}
          <div className="ds-card ds-card-raised">
            <h3 className="sec-head">{isRtl ? 'خط التوقعات' : 'Forecast Trend'}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={shortMoney} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => v === null ? '—' : formatMoney(Number(v), { currency: ccy })} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={bac} stroke={C_EV} strokeDasharray="4 4"
                               label={{ value: 'BAC', fill: C_EV, fontSize: 10, position: 'insideTopRight' }} />
                {m.eac > 0 && (
                  <ReferenceLine y={m.eac} stroke={m.eac > bac ? C_AC : C_OK} strokeDasharray="2 4"
                                 label={{ value: 'EAC', fill: m.eac > bac ? C_AC : C_OK, fontSize: 10, position: 'insideBottomRight' }} />
                )}
                <Line type="monotone" dataKey="pv" name="PV" stroke={C_PV} strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="ev" name="EV" stroke={C_EV} strokeWidth={2} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="ac" name="AC" stroke={C_AC} strokeWidth={1.5} dot={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* ══════════════════ S-CURVE ══════════════════ */}
      {tab === 'scurve' && (
        <>
        {/* CUMULATIVE TAB (owner rule): the same class lens as Periods —
            Total, Direct and Indirect — but every figure here is the
            AUTOMATIC running position, read-only. Chart above, its table
            below: one story told twice, never two. */}
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">
              {isRtl ? 'فئة التكلفة' : 'Cost Class'}
            </span>
            {([
              { id: 'total',    en: 'Total',    ar: 'الإجمالي' },
              { id: 'direct',   en: 'Direct',   ar: 'مباشرة' },
              { id: 'indirect', en: 'Indirect', ar: 'غير مباشرة' },
            ] as const).map(x => (
              <button key={x.id} onClick={() => setLens(x.id)}
                      className={cn('btn btn-sm', lens === x.id ? 'btn-primary' : 'btn-secondary')}>
                {isRtl ? x.ar : x.en}
              </button>
            ))}
            <span className="text-(length:--t-micro) uppercase tracking-widest text-muted-foreground border border-white/[0.06] px-2 py-0.5">
              {isRtl ? 'قراءة فقط · تلقائي بالكامل' : 'READ-ONLY · FULLY AUTOMATIC'}
            </span>
          </div>
        </div>

        <div className="ds-card ds-card-raised">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <h3 className="sec-head !mb-0">
              {isRtl ? 'منحنى S — القيمة التراكمية' : 'S-Curve — Cumulative Value'}
            </h3>
            <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">
              {(() => { const c = CADENCE_META.find(x => x.value === store.settings.cadence);
                        return c ? (isRtl ? c.ar : c.en) : store.settings.cadence; })()}
              {' · '}{store.periods.length} {isRtl ? 'فترة' : 'periods'}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={440}>
            <ComposedChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={shortMoney} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => v === null ? '—' : formatMoney(Number(v), { currency: ccy })} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="pv" name="PV — Planned" stroke={C_PV}
                    fill="rgba(139,138,134,0.10)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="ev" name="EV — Earned" stroke={C_EV}
                    fill="rgba(212,175,55,0.12)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="ac" name="AC — Actual" stroke={C_AC}
                    strokeWidth={1.5} dot={false} connectNulls={false} />
              {/* Forecast at completion, so the curve shows where it ends up. */}
              <ReferenceLine y={bac} stroke={C_EV} strokeDasharray="4 4"
                             label={{ value: 'BAC', fill: C_EV, fontSize: 10, position: 'insideTopRight' }} />
              {m.eac > 0 && (
                <ReferenceLine y={m.eac} stroke={m.eac > bac ? C_AC : C_OK} strokeDasharray="2 4"
                               label={{ value: 'EAC', fill: m.eac > bac ? C_AC : C_OK, fontSize: 10, position: 'insideBottomRight' }} />
              )}
              {/* Current reporting period marker. */}
              {period && (
                <ReferenceLine x={period.label} stroke="rgba(212,175,55,0.5)" strokeDasharray="3 3"
                               label={{ value: isRtl ? 'الآن' : 'NOW', fill: '#d4af37', fontSize: 9, position: 'top' }} />
              )}
              {/* Brush = zoom. Drag the handles to focus a window. */}
              <Brush dataKey="label" height={22} stroke="rgba(212,175,55,0.4)"
                     fill="rgba(0,0,0,0.3)" travellerWidth={8} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
            {isRtl
              ? 'اسحب المقبضين أسفل الرسم للتكبير على نافذة زمنية. تبدأ خطوط EV و AC عند أول فترة تحمل بيانات.'
              : 'Drag the handles below the chart to zoom a window. EV and AC begin at the first period carrying data.'}
          </p>
        </div>

        {/* ════════ THE TABLE THE CHART ANSWERS TO ════════ */}
        {lens === 'total' ? (() => {
          /** Final cumulative figures: the last stated plan and the last
           *  EARNED figures (time is not performance — future indirect
           *  slices never count). */
          let lastEv = null;
          let lastAc = null;
          let lastSv = 0, lastCv = 0;
          for (let i = points.length - 1; i >= 0; i--) {
            if (lastEv === null && points[i].ev !== null) { lastEv = points[i].ev; lastSv = points[i].sv; }
            if (lastAc === null && points[i].ac !== null) { lastAc = points[i].ac; lastCv = points[i].cv; }
            if (lastEv !== null && lastAc !== null) break;
          }
          const lastPv = points.length ? points[points.length - 1].pv : 0;
          return (
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h3 className="sec-head !mb-0 flex-1">
                  {isRtl ? 'الموقف التراكمي' : 'Cumulative Position'}
                </h3>
              </div>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                      <th className="money">PV</th>
                      <th className="money">EV</th>
                      <th className="money">AC</th>
                      <th className="money">SV</th>
                      <th className="money">CV</th>
                      <th className="money">SPI</th>
                      <th className="money">CPI</th>
                      <th className="money">EAC</th>
                      <th className="money">VAC</th>
                      <th>{isRtl ? 'الحالة' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map(pt => (
                      <tr key={pt.seq}>
                        <td className="col-pin font-mono">{pt.label}</td>
                        <td className="money">{formatMoney(pt.pv, { currency: ccy })}</td>
                        <td className="money">{pt.ev === null ? '—' : formatMoney(pt.ev, { currency: ccy })}</td>
                        <td className="money">{pt.ac === null ? '—' : formatMoney(pt.ac, { currency: ccy })}</td>
                        <td className={cn('money', pt.ev === null ? 'text-muted-foreground' : varianceTone(pt.sv))}>
                          {pt.ev === null ? '—' : formatMoney(pt.sv, { currency: ccy })}
                        </td>
                        <td className={cn('money', pt.ev === null ? 'text-muted-foreground' : varianceTone(pt.cv))}>
                          {pt.ev === null ? '—' : formatMoney(pt.cv, { currency: ccy })}
                        </td>
                        <td className={cn('money', indexTone(pt.spi))}>{fmtIndex(pt.spi)}</td>
                        <td className={cn('money', indexTone(pt.cpi))}>{fmtIndex(pt.cpi)}</td>
                        <td className="money">{pt.eac === null ? '—' : formatMoney(pt.eac, { currency: ccy })}</td>
                        <td className={cn('money', pt.vac === null ? 'text-muted-foreground' : varianceTone(pt.vac))}>
                          {pt.vac === null ? '—' : formatMoney(pt.vac, { currency: ccy })}
                        </td>
                        <td>
                          <span className={cn('badge', STATUS_META[pt.status].tone)}>
                            {isRtl ? STATUS_META[pt.status].ar : STATUS_META[pt.status].en}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {/* TOTAL — after the last period (owner rule). */}
                    {points.length > 0 && (
                      <tr className="border-t-2 border-primary/30 font-semibold">
                        <td className="col-pin text-primary uppercase tracking-wider">
                          {isRtl ? 'الإجمالي' : 'Total'}
                        </td>
                        <td className="money">{formatMoney(lastPv, { currency: ccy })}</td>
                        <td className="money">{lastEv === null ? '—' : formatMoney(lastEv, { currency: ccy })}</td>
                        <td className="money">{lastAc === null ? '—' : formatMoney(lastAc, { currency: ccy })}</td>
                        <td className={cn('money', varianceTone(lastSv))}>{lastEv === null ? '—' : formatMoney(lastSv, { currency: ccy })}</td>
                        <td className={cn('money', varianceTone(lastCv))}>{lastEv === null ? '—' : formatMoney(lastCv, { currency: ccy })}</td>
                        <td className={cn('money', indexTone(m.spi))}>{fmtIndex(m.spi)}</td>
                        <td className={cn('money', indexTone(m.cpi))}>{fmtIndex(m.cpi)}</td>
                        <td className="money">{formatMoney(m.eac, { currency: ccy })}</td>
                        <td className={cn('money', varianceTone(m.vac))}>{formatMoney(m.vac, { currency: ccy })}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
                {isRtl
                  ? 'قراءة فقط — كل رقم مشتق تلقائيًا من مدخلات الفترات؛ لا يُدخَل يدويًا. EV وAC يقفان عند آخر فترة شغّالة فعلًا.'
                  : 'Read-only — every figure is derived automatically from the period entries; EV and AC stop at the last truly-worked period.'}
              </p>
            </div>
          );
        })() : (() => {
          /** Class lenses: the running position of ONE class. */
          const rows = classCumulative(store.periods, lens);
          const last = rows.length ? rows[rows.length - 1] : null;
          return (
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h3 className="sec-head !mb-0 flex-1">
                  {isRtl
                    ? 'الموقف التراكمي — ' + (lens === 'direct' ? 'مباشرة' : 'غير مباشرة')
                    : 'Cumulative Position — ' + (lens === 'direct' ? 'Direct' : 'Indirect')}
                </h3>
              </div>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                      <th className="money">PV</th>
                      <th className="money">EV</th>
                      <th className="money">AC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id}>
                        <td className="col-pin font-mono">{r.label}</td>
                        <td className="money">{formatMoney(r.pv, { currency: ccy })}</td>
                        <td className="money">{formatMoney(r.ev, { currency: ccy })}</td>
                        <td className="money">{formatMoney(r.ac, { currency: ccy })}</td>
                      </tr>
                    ))}
                    {last && (
                      <tr className="border-t-2 border-primary/30 font-semibold">
                        <td className="col-pin text-primary uppercase tracking-wider">
                          {isRtl ? 'الإجمالي' : 'Total'}
                        </td>
                        <td className="money">{formatMoney(last.pv, { currency: ccy })}</td>
                        <td className="money">{formatMoney(last.ev, { currency: ccy })}</td>
                        <td className="money">{formatMoney(last.ac, { currency: ccy })}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
                {isRtl
                  ? 'قراءة فقط — مجاميع جارية لمكوّنات هذه الفئة؛ الفترات الأقدم من ظهور الفئة تساهم بصفر.'
                  : 'Read-only — running sums of this class; periods older than the class contribute zero.'}
              </p>
            </div>
          );
        })()}
        </>

      )}

      {/* ══════════════════ MATRIX ══════════════════ */}
      {tab === 'matrix' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="ds-card ds-card-raised xl:col-span-2">
            <h3 className="sec-head">{isRtl ? 'مصفوفة أداء المشروع' : 'Project Performance Matrix'}</h3>
            <ResponsiveContainer width="100%" height={430}>
              <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} />
                <XAxis type="number" dataKey="spi" name="SPI" domain={mDom.x}
                       ticks={mDom.xTicks} {...AXIS}
                       label={{ value: 'SPI →', fill: '#a5a49f', fontSize: 10, position: 'insideBottomRight', offset: -6 }} />
                <YAxis type="number" dataKey="cpi" name="CPI" domain={mDom.y}
                       ticks={mDom.yTicks} {...AXIS}
                       label={{ value: 'CPI ↑', fill: '#a5a49f', fontSize: 10, position: 'insideTopLeft' }} />
                <ZAxis type="number" dataKey="z" range={[40, 320]} />
                {/* On-target zone: both indices within ±5% of 1.00. */}
                <ReferenceArea x1={1 - INDEX_TOLERANCE} x2={1 + INDEX_TOLERANCE}
                               y1={1 - INDEX_TOLERANCE} y2={1 + INDEX_TOLERANCE}
                               fill="rgba(212,175,55,0.06)" stroke="rgba(212,175,55,0.18)" strokeDasharray="2 4" />
                {/* The 1.00 crosshair defines the four quadrants. */}
                <ReferenceLine x={1} stroke="rgba(212,175,55,0.35)" strokeDasharray="4 4" />
                <ReferenceLine y={1} stroke="rgba(212,175,55,0.35)" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={TT_STYLE}
                  formatter={(v: any, n: any) =>
                    n === 'vac' || n === 'eac'
                      ? [formatMoney(Number(v), { currency: ccy }), n.toUpperCase()]
                      : [Number(v).toFixed(3), n]}
                  labelFormatter={() => ''}
                />
                {/* Trail of approved history, faint. */}
                <Scatter
                  name={isRtl ? 'المسار' : 'History'}
                  data={points.filter(p => p.spi !== null && p.cpi !== null)
                               .map((p, i, a) => ({ ...p, z: 40 + (i / Math.max(1, a.length - 1)) * 60 }))}
                  fill="rgba(139,138,134,0.45)"
                  line={{ stroke: 'rgba(139,138,134,0.25)', strokeWidth: 1 }}
                  lineType="joint"
                />
                {/* Previous position, so movement is visible not implied.
                    Bubble size = money at stake when that period reported. */}
                {prevM?.spi != null && prevM?.cpi != null && (
                  <Scatter
                    name={isRtl ? 'الفترة السابقة' : 'Previous'}
                    data={[{
                      spi: prevM.spi, cpi: prevM.cpi,
                      z: bubbleZ(prevM.vac, prevM.eac, 90, 260),
                      vac: prevM.vac, eac: prevM.eac,
                    }]}
                    fill="rgba(139,138,134,0.85)"
                  />
                )}
                {/* Current position: bubble size = money at stake (|VAC| ÷ EAC). */}
                {m.spi !== null && m.cpi !== null && (
                  <Scatter
                    name={isRtl ? 'الموقف الحالي' : 'Current'}
                    data={[{
                      spi: m.spi, cpi: m.cpi,
                      z: bubbleZ(m.vac, m.eac, 120, 320),
                      vac: m.vac, eac: m.eac,
                    }]}
                    fill={C_EV}
                  >
                    <Cell fill={C_EV} />
                  </Scatter>
                )}
                {/* Projection: where the last-3-period rhythm lands.
                    Hollow diamond — a heading, not a position. */}
                {trendSpi !== null && trendCpi !== null && (
                  <Scatter
                    name={isRtl ? 'الاتجاه (٣ فترات)' : 'Trend (3p)'}
                    data={[{ spi: trendSpi, cpi: trendCpi, z: 90 }]}
                    shape={(props: any) => (
                      <rect
                        x={props.cx - 5} y={props.cy - 5} width={10} height={10}
                        transform={`rotate(45 ${props.cx} ${props.cy})`}
                        fill="rgba(111,155,120,0.25)" stroke={C_OK} strokeWidth={1.5}
                      />
                    )}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Quadrant legend */}
          <div className="space-y-3">
            <div className="ds-card ds-card-raised">
              <div className="text-(length:--t-label) font-medium uppercase tracking-widest text-muted-foreground mb-2">
                {isRtl ? 'الموقف الحالي' : 'Current Position'}
              </div>
              <div className={cn('font-serif text-lg leading-tight mb-2', qTone)}>
                {isRtl ? q.ar : q.en}
              </div>
              {/* Inside the band on both axes: no alarm, whatever the quadrant. */}
              {onTarget && (
                <div className="inline-block text-(length:--t-micro) tracking-widest text-primary border border-primary/30 bg-primary/[0.07] px-2 py-0.5 mb-3 number-ltr">
                  {isRtl ? 'على الهدف · ضمن السماحية ±٥٪' : 'ON TARGET · WITHIN ±5%'}
                </div>
              )}
              <div className="grid grid-cols-2 gap-px bg-white/5">
                <div className="bg-black/30 p-3">
                  <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">SPI</div>
                  <div className={cn('font-mono text-xl number-ltr', indexTone(m.spi))}>{fmtIndex(m.spi)}</div>
                  <Movement now={m.spi} was={prevM?.spi ?? null} />
                  {/* Delay in calendar days, beside the schedule index. */}
                  <div className={cn('text-(length:--t-data) font-mono number-ltr mt-1',
                      dates.slipDays > 60 ? 'text-chart-3'
                    : dates.slipDays > 14 ? 'text-chart-5'
                    : dates.slipDays < 0  ? 'text-chart-4'
                    : 'text-muted-foreground')}>
                    {isRtl ? 'الإنجاز المتوقع' : 'Forecast finish'}:{' '}
                    {dates.slipDays > 0
                      ? (isRtl ? `${dates.slipDays} يوم تأخير` : `${dates.slipDays}d late`)
                      : dates.slipDays < 0
                        ? (isRtl ? `${-dates.slipDays} يوم مبكر` : `${-dates.slipDays}d early`)
                        : (isRtl ? 'على الأساس' : 'on baseline')}
                  </div>
                </div>
                <div className="bg-black/30 p-3">
                  <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">CPI</div>
                  <div className={cn('font-mono text-xl number-ltr', indexTone(m.cpi))}>{fmtIndex(m.cpi)}</div>
                  <Movement now={m.cpi} was={prevM?.cpi ?? null} />
                </div>
              </div>
              {/* The money the position implies — TCPI to finish on BAC,
                  and the forecast it feeds. */}
              <div className="grid grid-cols-3 gap-px bg-white/5 mt-px">
                <div className="bg-black/30 p-3">
                  <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">TCPI</div>
                  <div className={cn('font-mono text-lg number-ltr', tcpiTone(m.tcpi))}>{fmtIndex(m.tcpi)}</div>
                  <div className="text-(length:--t-micro) text-muted-foreground mt-1">
                    {isRtl ? 'كفاءة مطلوبة للعمل المتبقي' : 'needed on remaining work'}
                  </div>
                </div>
                <div className="bg-black/30 p-3">
                  <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">EAC</div>
                  <div className="font-mono text-(length:--t-data) number-ltr">
                    {formatMoney(m.eac, { currency: ccy })}
                  </div>
                </div>
                <div className="bg-black/30 p-3">
                  <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">VAC</div>
                  <div className={cn('font-mono text-(length:--t-data) number-ltr', varianceTone(m.vac))}>
                    {formatMoney(m.vac, { currency: ccy })}
                  </div>
                </div>
              </div>
              {trendSpi !== null && trendCpi !== null && (
                <div className="text-(length:--t-second) text-muted-foreground mt-3">
                  {isRtl ? 'اتجاه آخر ٣ فترات' : 'Last-3-period trend'}:{' '}
                  <span className="font-mono number-ltr">
                    SPI {fmtIndex(trendSpi)} · CPI {fmtIndex(trendCpi)}
                  </span>
                </div>
              )}
              {prevQuadrant && prevQuadrant.key !== quadrant.key &&
               !(onTarget && withinTolerance(prevM?.spi ?? null, prevM?.cpi ?? null)) && (
                <p className="text-(length:--t-second) text-muted-foreground mt-3 border-s-2 border-primary/30 ps-2">
                  {isRtl ? 'انتقل من' : 'Moved from'}{' '}
                  <span className="text-white/70">{isRtl ? prevQuadrant.ar : prevQuadrant.en}</span>
                </p>
              )}
            </div>

            {[
              { t: isRtl ? 'أعلى يمين' : 'Top Right',    d: isRtl ? 'متقدم · ضمن الميزانية' : 'Ahead · Under Budget',  c: 'text-chart-4', on: q.key === 'ahead-under' },
              { t: isRtl ? 'أعلى يسار' : 'Top Left',     d: isRtl ? 'متأخر · ضمن الميزانية' : 'Behind · Under Budget', c: 'text-primary', on: q.key === 'behind-under' },
              { t: isRtl ? 'أسفل يمين' : 'Bottom Right', d: isRtl ? 'متقدم · تجاوز' : 'Ahead · Over Budget',           c: 'text-chart-5', on: q.key === 'ahead-over' },
              { t: isRtl ? 'أسفل يسار' : 'Bottom Left',  d: isRtl ? 'متأخر · تجاوز' : 'Behind · Over Budget',          c: 'text-chart-3', on: q.key === 'behind-over' },
            ].map((x, i) => (
              <div key={i} className={cn(
                'border px-3 py-2 transition-colors',
                x.on ? 'border-primary bg-primary/[0.07]' : 'border-white/[0.06] bg-black/20',
              )}>
                <div className="text-(length:--t-label) font-medium uppercase tracking-widest text-muted-foreground">{x.t}</div>
                <div className={cn('text-xs', x.on ? x.c : 'text-white/40')}>{x.d}</div>
              </div>
            ))}
            <p className="text-(length:--t-second) text-muted-foreground italic">
              {isRtl
                ? 'حجم الفقاعة = المال المعرَّض للخطر (|VAC| ÷ EAC) · المنطقة الذهبية = على الهدف ±٥٪ ◆ المعيّن الأخضر = اتجاه آخر ٣ فترات'
                : 'Bubble size = money at stake (|VAC| ÷ EAC) · gold zone = on target ±5% · green diamond ◆ = last-3-period trend.'}
            </p>
          </div>
        </div>
      )}

      {/* ══════════════════ PERIODS / REVIEW WORKFLOW ══════════════════ */}
      {tab === 'periods' && (
        <>
        {/* ── STEP 12 · cost-class lens ── */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">
              {isRtl ? 'فئة التكلفة' : 'Cost Class'}
            </span>
            {([
              { id: 'total',    en: 'Total',    ar: 'الإجمالي' },
              { id: 'direct',   en: 'Direct',   ar: 'مباشرة' },
              { id: 'indirect', en: 'Indirect', ar: 'غير مباشرة' },
            ] as const).map(x => (
              <button key={x.id} onClick={() => setLens(x.id)}
                      className={cn('btn btn-sm', lens === x.id ? 'btn-primary' : 'btn-secondary')}>
                {isRtl ? x.ar : x.en}
              </button>
            ))}
            <span className="text-(length:--t-second) text-muted-foreground">
              {bacSplit.available
                ? `BAC ${formatMoney(
                    lens === 'direct' ? bacSplit.directBac
                    : lens === 'indirect' ? bacSplit.indirectBac
                    : bacSplit.totalBac, { currency: ccy })}`
                : (isRtl ? 'لا توجد خطة أساس معتمدة — BAC غير متاح'
                         : 'No approved baseline — BAC unavailable')}
            </span>
          </div>
          {canWrite && bacSplit.available && (
            <button onClick={recomputeIndirectEv} className="btn btn-secondary btn-sm">
              {isRtl ? 'إعادة حساب القيمة غير المباشرة' : 'Recompute Indirect EV'}
            </button>
          )}
        </div>

        {/* Total lens + split: totals are cumulative, derived from components */}
        {lens === 'total' && (
          <p className="text-(length:--t-second) text-muted-foreground mt-1">
            {isRtl
              ? 'الإجمالي (PV · EV · AC) كامل التلقائية ومقفول للكتابة: بيتحسب من مكونات مباشرة/غير مباشرة لكل فترة — والمكونات دي هي قيمة الفترة نفسها.'
              : 'Totals (PV · EV · AC) are fully automatic and read-only: derived from each period Direct/Indirect components — which hold the period own value.'}
          </p>
        )}

        {/*
          Q2=C — an approved EOT with no effective date makes the time
          basis unknowable. Say so, name the rows, and refuse to compute.
          Silence here would let a wrong Indirect EV look authoritative.
        */}
        {sched.blocked && (
          <div className="ds-card ds-card-tight border-chart-3/40">
            <p className="text-(length:--t-body) text-chart-3">
              {isRtl
                ? 'القيمة المكتسبة غير المباشرة محجوبة: تمديد معتمد بلا تاريخ سريان.'
                : 'Indirect EV is blocked: an approved extension has no effective date.'}
            </p>
            <p className="text-(length:--t-second) text-muted-foreground mt-1">
              {isRtl ? 'الصفوف غير المؤرَّخة' : 'Undated rows'}{': '}
              <span className="font-mono">{sched.undatedRefs.join(' · ')}</span>
            </p>
            <p className="text-(length:--t-second) text-muted-foreground mt-1">
              {isRtl
                ? 'أدخل تاريخ السريان في أمر التغيير أو المطالبة، أو في سجل التأخير للصفوف اليدوية.'
                : 'Enter the effective date on the change order or claim, or in the Delay Register for manual rows.'}
            </p>
          </div>
        )}

        {/*
          The schedule authority is Commencement Date + Planned Duration.
          Both are optional on a Project and are genuinely unset on many.
          Printing "0 days" would state a fact nobody entered — the same
          absence-as-zero trap Step 11 closed for AC. Say it is not set.
        */}
        {!sched.blocked && (sched.baseDurationDays <= 0 || !project.commencementDate) && (
          <div className="text-(length:--t-second) text-chart-3">
            {isRtl
              ? 'الجدول المعتمد غير مُدخَل (تاريخ المباشرة / المدة المخططة) — القيمة المكتسبة غير المباشرة غير متاحة.'
              : 'Approved schedule not set (Commencement Date / Planned Duration) — Indirect EV unavailable.'}
          </div>
        )}

        {!sched.blocked && sched.baseDurationDays > 0 && project.commencementDate && (
          <div className="text-(length:--t-second) text-muted-foreground">
            {isRtl ? 'المدة المعتمدة السارية' : 'Effective approved duration'}{': '}
            <span className="font-mono number-ltr text-white">{sched.effectiveDurationDays}</span>
            {' '}{isRtl ? 'يوم' : 'days'}
            {sched.effectiveEotDays > 0 && (
              <> {' · '}{isRtl ? 'تمديد سارٍ' : 'effective EOT'}{': '}
                <span className="font-mono number-ltr text-primary">+{sched.effectiveEotDays}</span></>
            )}
            {sched.pendingEotDays > 0 && (
              <> {' · '}{isRtl ? 'معتمد ولم يسرِ بعد' : 'approved, not yet effective'}{': '}
                <span className="font-mono number-ltr text-chart-5">+{sched.pendingEotDays}</span></>
            )}
          </div>
        )}

        {/* PV entry toolbar */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">
              {isRtl ? 'توزيع PV' : 'PV Distribution'}
            </span>
            <span className={cn('badge', (store.settings.pvMethod ?? 'scurve') === 'manual' ? 'badge-gold' : 'badge-neutral')}>
              {(() => { const pm = PV_METHODS.find(x => x.value === (store.settings.pvMethod ?? 'scurve'));
                        return pm ? (isRtl ? pm.ar : pm.en) : ''; })()}
            </span>
            <span className="text-(length:--t-second) text-muted-foreground">
              {editableCount} {isRtl ? 'فترة قابلة للتحرير' : 'editable periods'}
            </span>
          </div>
          {canWrite && (
            <button onClick={() => setPasteOpen(v => !v)} className="btn btn-secondary btn-sm">
              <ClipboardPaste className="w-3 h-3" />
              {isRtl ? 'لصق عمود PV' : 'Paste PV Column'}
            </button>
          )}
        </div>

        {pasteOpen && canWrite && (
          <div className="ds-card ds-card-tight">
            <h3 className="sec-head">{isRtl ? 'لصق القيمة المخططة من البرنامج' : 'Paste Planned Value from Programme'}</h3>
            <p className="text-(length:--t-body) text-muted-foreground mb-2">
              {isRtl
                ? 'الصق عموداً من Excel أو Primavera — قيمة تراكمية واحدة لكل فترة، بالترتيب. تُقبل الفواصل والعملة والأرقام العربية. الفترات المعتمدة تُتخطّى ولا تُمس.'
                : 'Paste a column from Excel or Primavera — one cumulative value per period, in order. Commas, currency symbols and Arabic-Indic digits are accepted. Approved periods are skipped and never touched.'}
            </p>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={6} dir="ltr"
              placeholder={PASTE_PLACEHOLDER}
              className="w-full bg-black border border-white/10 px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary"
            />
            {pasteParsed && (
              <div className="flex items-center gap-3 flex-wrap mt-2 text-(length:--t-body)">
                <span className="text-muted-foreground">
                  {isRtl ? 'قيم مقروءة' : 'Parsed'}{': '}
                  <span className="font-mono text-white number-ltr">{pasteParsed.values.length}</span>
                </span>
                <span className="text-muted-foreground">
                  {isRtl ? 'ستُطبَّق على' : 'Will apply to'}{': '}
                  <span className="font-mono text-primary number-ltr">{pasteParsed.willApply}</span>
                </span>
                {pasteParsed.skipped > 0 && (
                  <span className="text-chart-5">
                    {isRtl ? 'صفوف متجاهَلة' : 'Skipped rows'}{': '}
                    <span className="font-mono number-ltr">{pasteParsed.skipped}</span>
                  </span>
                )}
                {!pasteParsed.exact && pasteParsed.values.length > 0 && (
                  <span className="text-chart-5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {isRtl
                      ? `العدد لا يطابق ${editableCount} فترة`
                      : `Count does not match ${editableCount} editable periods`}
                  </span>
                )}
              </div>
            )}
            <div className="form-actions">
              <button type="button" onClick={() => { setPasteOpen(false); setPasteText(''); }} className="btn btn-ghost">
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="button" onClick={doPaste} className="btn btn-primary"
                      disabled={!pasteParsed || pasteParsed.values.length === 0}>
                {isRtl ? 'تطبيق' : 'Apply'}
              </button>
            </div>
          </div>
        )}

        {!pvCheck.ok && store.periods.length > 0 && (
          <div className="ds-card ds-card-tight border-chart-5/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-chart-5 mt-0.5 flex-shrink-0" />
              <div className="text-(length:--t-body) space-y-1">
                {pvCheck.decreasing.length > 0 && (
                  <p className="text-chart-5">
                    {isRtl
                      ? `القيمة المخططة التراكمية تنخفض في ${pvCheck.decreasing.length} فترة — أولها ${pvCheck.decreasing[0].label}. القيمة التراكمية لا تنقص عادةً.`
                      : `Cumulative PV falls in ${pvCheck.decreasing.length} period(s), first at ${pvCheck.decreasing[0].label}. A cumulative figure should not decrease.`}
                  </p>
                )}
                {Math.abs(pvCheck.gap) >= Math.max(1, bac * 0.005) && (
                  <p className="text-muted-foreground">
                    {isRtl
                      ? `آخر قيمة مخططة ${formatMoney(pvCheck.finalPv, { currency: ccy })} مقابل BAC ${formatMoney(bac, { currency: ccy })} — الفرق ${formatMoney(pvCheck.gap, { currency: ccy })}.`
                      : `Final PV ${formatMoney(pvCheck.finalPv, { currency: ccy })} against BAC ${formatMoney(bac, { currency: ccy })} — a gap of ${formatMoney(pvCheck.gap, { currency: ccy })}.`}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="ds-table-wrap">
          <table className="ds-table min-w-[1080px]">
            <thead>
              <tr>
                <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                <th className="money">PV</th>
                <th className="money">EV</th>
                <th className="money">AC</th>
                <th className="money">SPI</th>
                <th className="money">CPI</th>
                <th>{isRtl ? 'الحالة' : 'Status'}</th>
                {/* WHO decided, and when. The status control writes both. */}
                <th>{isRtl ? 'القرار بواسطة' : 'Decision By'}</th>
              </tr>
            </thead>
            <tbody>
              {store.periods.map((p, i) => {
                // Frozen periods report what was approved, never a live recompute.
                const pm = periodMetrics(p, bac, store.settings.eacMethod, cumulativeTo(store.periods, p));
                const locked = isLocked(p);
                const isLive = i === liveIndex;
                return (
                  <React.Fragment key={p.id}>
                    <tr className={cn(isLive && 'bg-primary/[0.04]')}>
                      <td className="col-pin font-mono text-primary font-medium">
                        <span className="flex items-center gap-1.5">
                          {locked && <Lock className="w-3 h-3 text-muted-foreground" />}
                          {p.label}
                          {isLive && <span className="text-(length:--t-micro) uppercase tracking-widest text-primary/60 border border-primary/20 px-1">
                            {isRtl ? 'حالي' : 'LIVE'}
                          </span>}
                        </span>
                      </td>
                      {/*
                        STEP 12 — the same three columns, viewed through the
                        cost-class lens. TOTAL keeps the pre-Step-12 behaviour
                        exactly, so nothing changes for a project that has no
                        split. DIRECT and INDIRECT read and write the
                        components; the engine keeps the parent total true.

                        Indirect EV has NO editor: it is time-derived, never
                        typed. It renders read-only and says why.
                      */}
                      {lens === 'total' ? (
                        /* v3 — totals are READ-ONLY: always derived from the
                           Direct/Indirect components. canWrite=false on every
                           cell closes the manual path at the UI as well.
                           No provenance chips either: a derived figure has
                           no AUTO/MANUAL story to tell.
                           PERIOD VIEW (owner rule): the figure is what this
                           period ADDS — the running total lives on the
                           Cumulative tab, not here. */
                        <>
                          <ValueCell ccy={ccy} v={incs.get(p.id)?.pv ?? 0} src={p.pvSource} locked={locked} canWrite={false}
                                     hideBadge
                                     onSave={() => {}} onAuto={() => {}} />
                          <ValueCell ccy={ccy} v={incs.get(p.id)?.ev ?? 0} src={p.evSource} locked={locked} canWrite={false}
                                     hideBadge
                                     onSave={() => {}} onAuto={() => {}} />
                          {/* STEP 11 — absence still reads as absence. */}
                          <ValueCell ccy={ccy} v={incs.get(p.id)?.ac ?? 0} src={p.acSource} locked={locked} canWrite={false}
                                     notEntered={p.acSource !== 'manual'} isRtl={isRtl}
                                     hideBadge
                                     onSave={() => {}} onAuto={() => {}} />
                        </>
                      ) : lens === 'direct' ? (
                        <>
                          <ValueCell ccy={ccy} v={p.directPv ?? 0} src={p.directPvSource ?? 'auto'}
                                     notEntered={p.directPv === undefined} isRtl={isRtl}
                                     locked={locked} canWrite={canWrite}
                                     onSave={x => editClass(p.id, 'directPv', x)} onAuto={() => {}} />
                          <ValueCell ccy={ccy} v={p.directEv ?? 0} src={p.directEvSource ?? 'auto'}
                                     notEntered={p.directEv === undefined} isRtl={isRtl}
                                     locked={locked} canWrite={canWrite}
                                     onSave={x => editClass(p.id, 'directEv', x)} onAuto={() => {}} />
                          <ValueCell ccy={ccy} v={p.directAc ?? 0} src={p.directAcSource ?? 'auto'}
                                     notEntered={p.directAc === undefined} isRtl={isRtl}
                                     locked={locked} canWrite={canWrite}
                                     onSave={x => editClass(p.id, 'directAc', x)} onAuto={() => {}} />
                        </>
                      ) : (
                        <>
                          <ValueCell ccy={ccy} v={p.indirectPv ?? 0} src={p.indirectPvSource ?? 'auto'}
                                     notEntered={p.indirectPv === undefined} isRtl={isRtl}
                                     locked={locked} canWrite={canWrite}
                                     onSave={x => editClass(p.id, 'indirectPv', x)} onAuto={() => {}} />
                          <td className="money">
                            {p.indirectEvBasis === null ? (
                              <span className="font-mono text-chart-3/80 text-(length:--t-micro)">
                                {isRtl ? 'محجوبة' : 'BLOCKED'}
                              </span>
                            ) : p.indirectEv === undefined ? (
                              <span className="font-mono text-muted-foreground/70 italic">
                                {isRtl ? 'لم تُحسب' : 'Not computed'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 justify-end">
                                <span className="font-mono">{formatMoney(p.indirectEv, { currency: ccy })}</span>
                                <span className="text-(length:--t-micro) tracking-widest text-primary/50 border border-primary/20 px-1 leading-[1.4]">
                                  {isRtl ? 'زمنية' : 'TIME'}
                                </span>
                              </span>
                            )}
                          </td>
                          <ValueCell ccy={ccy} v={p.indirectAc ?? 0} src={p.indirectAcSource ?? 'auto'}
                                     notEntered={p.indirectAc === undefined} isRtl={isRtl}
                                     locked={locked} canWrite={canWrite}
                                     onSave={x => editClass(p.id, 'indirectAc', x)} onAuto={() => {}} />
                        </>
                      )}
                      <td className={cn('money', indexTone(pm.spi))}>{fmtIndex(pm.spi)}</td>
                      <td className={cn('money', indexTone(pm.cpi))}>{fmtIndex(pm.cpi)}</td>
                      {/*
                        ══════════════════════════════════════════════════
                        THE STATUS IS THE CONTROL. There is no second
                        place to go and no panel to open first.

                        Clicking it offers the states this period may
                        legally move to, plus its own — selecting the
                        current state is a no-op, which is what makes the
                        menu safe to open out of curiosity.

                        Approving stamps WHO decided and WHEN, and the
                        Reviewer column beside it shows exactly that. No
                        comment box, no workflow diagram, no chevron.
                        ══════════════════════════════════════════════════
                      */}
                      <td>
                        {hasSplit(p) ? (
                          lens === 'direct' || lens === 'indirect' ? (
                            /* ONE CLASS PER PAGE (owner rule): the Direct
                               page carries the Direct signature only, the
                               Indirect page the Indirect one. The Total
                               page shows the pair and the total badge. */
                            (() => {
                              const ok = classApproved(p, lens);
                              return (
                                <span className="flex items-center gap-1.5">
                                  <span className={cn('badge', ok ? 'badge-ok' : 'badge-neutral')}>
                                    {ok
                                      ? (isRtl ? 'معتمد ✓' : 'Approved ✓')
                                      : (isRtl ? 'مسودة' : 'Draft')}
                                  </span>
                                  {canEdit && (
                                    ok ? (
                                      <button onClick={() => reopenCls(p, lens)}
                                            title={isRtl ? 'إعادة فتح هذه الفئة — البيانات لا تُمسح' : 'Reopen this class — data is kept'}
                                            className="text-(length:--t-micro) text-muted-foreground hover:text-primary underline cursor-pointer">
                                        {isRtl ? 'إعادة فتح' : 'Reopen'}
                                      </button>
                                    ) : (
                                      <button onClick={() => approveCls(p, lens)}
                                              title={isRtl
                                                ? 'اعتماد هذه الفئة — الإجمالي يُعتمد عند اكتمال الاثنتين'
                                                : 'Approve this class — the total approves when both are complete'}
                                              className="text-(length:--t-micro) text-primary hover:text-white underline cursor-pointer">
                                        {isRtl ? 'اعتمد' : 'Approve'}
                                      </button>
                                    )
                                  )}
                                </span>
                              );
                            })()
                          ) : (
                          /* TOTAL PAGE: READ-ONLY (owner rule). It states the
                             approval state of each class and the derived
                             total — the signatures themselves are cast on
                             the class pages, never here. */
                          <span className="flex flex-col gap-1 items-start">
                            <span className={cn('badge',
                              p.status === 'approved' ? STATUS_META.approved.tone : 'badge-gold')}>
                              {p.status === 'approved'
                                ? (isRtl ? 'معتمد ✓' : 'Approved ✓')
                                : classApproved(p, 'direct') || classApproved(p, 'indirect')
                                  ? (isRtl ? 'جزئي — بانتظار الفئة الأخرى' : 'Partial — awaiting the other class')
                                  : (isRtl ? 'مسودة' : 'Draft')}
                            </span>
                            {(['direct', 'indirect'] as const).map(cls => {
                              const ok = classApproved(p, cls);
                              return (
                                <span key={cls} className={cn('badge', ok ? 'badge-ok' : 'badge-neutral')}
                                      title={ok
                                        ? (isRtl ? 'معتمدة من صفحة الفئة' : 'approved on its class page')
                                        : (isRtl ? 'لم تُعتمد بعد — الاعتماد من صفحة الفئة' : 'not yet approved — from its class page')}>
                                  {cls === 'direct'
                                    ? (isRtl ? 'دايركت' : 'Direct')
                                    : (isRtl ? 'اندايركت' : 'Indirect')}
                                  {ok ? ' ✓' : ''}
                                </span>
                              );
                            })}
                          </span>
                          )
                        ) : canEdit && NEXT_STATUS[p.status].length > 0 ? (
                          <select
                            value={p.status}
                            aria-label={isRtl ? 'حالة الفترة' : 'Period status'}
                            onChange={e => {
                              const to = e.target.value as PeriodStatus;
                              if (to !== p.status) move(p, to);
                            }}
                            className={cn(
                              'badge cursor-pointer bg-transparent focus:outline-none focus:border-primary',
                              STATUS_META[p.status].tone,
                            )}
                          >
                            {/* Its own state first, so the menu opens on
                                what is true rather than on a proposal. */}
                            <option value={p.status}>
                              {isRtl ? STATUS_META[p.status].ar : STATUS_META[p.status].en}
                            </option>
                            {NEXT_STATUS[p.status].map(to => (
                              <option key={to} value={to}>
                                {to === 'draft' && p.status === 'approved'
                                  ? (isRtl ? 'إعادة التقديم' : 'Resubmit')
                                  : (isRtl ? STATUS_META[to].ar : STATUS_META[to].en)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={cn('badge', STATUS_META[p.status].tone)}>
                            {isRtl ? STATUS_META[p.status].ar : STATUS_META[p.status].en}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground text-(length:--t-body)">
                        {p.reviewer || '—'}
                        {p.reviewDate && (
                          <span className="block text-(length:--t-data) opacity-60 font-mono">
                            {formatDateOrDash(p.reviewDate, isRtl ? 'ar' : 'en')}
                          </span>
                        )}
                      </td>

                    </tr>
                    {/*
                      ══════════════════════════════════════════════════
                      THE EXPANDING PANEL IS GONE ENTIRELY.

                      It held three things and none of them earned a row:

                        · a four-box workflow diagram restating two states
                        · a review comment box nobody filled in
                        · the Period Report — physical progress, notes,
                          issues, risks, attachments

                      The report fields were wired to nothing. They were
                      stored and never read: no metric, no chart, no
                      report and no gate consulted one of them. Fields
                      that only ever absorb typing are worse than absent,
                      because they imply somebody downstream is using
                      them. Removed on the user's explicit instruction.

                      `setPeriodField` REMAINS in evm.ts and still guards
                      its writes. Deleting the engine function would
                      orphan the data already stored on existing periods,
                      and a period that carries notes keeps carrying them
                      — this screen simply no longer offers to edit them.

                      What replaced all of it: the STATUS cell is the
                      control, and Decision By is the record.
                      ══════════════════════════════════════════════════
                    */}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/*
          ══════════════════════════════════════════════════════════════
          STEP 12 · rule 13 — ALL THREE LEVELS, INDEPENDENTLY INSPECTABLE.

          Rule 12 is what makes this table honest: the TOTAL row is not
          the average of the two above it. Every total metric is computed
          from summed aggregates (EV_total / AC_total), so a large class
          cannot be outvoted by a small one.
          ══════════════════════════════════════════════════════════════
        */}
        {period && bacSplit.available && hasSplit(latestApproved(store.periods) ?? period) && (() => {
          /* PERFORMANCE RECORD, NOT LIVE TYPING: this table answers from
             the LATEST APPROVED period — the signed month. Computing it
             on the live reporting row let a half-entered month shift
             every class figure before anyone had approved it. CPI is
             gone per owner decision: a per-class CPI divides a class's
             EV by its AC, and the indirect class carries little or no
             AC by nature — the column answered a question the classes
             cannot support. Cost verdicts live in CV / VAC. */
          const classP = latestApproved(store.periods) ?? period;
          const cm = classMetrics(store.periods, classP, bacSplit, store.settings.eacMethod);
          const rows = [
            { k: isRtl ? 'مباشرة' : 'Direct',      m: cm.direct },
            { k: isRtl ? 'غير مباشرة' : 'Indirect', m: cm.indirect },
            { k: isRtl ? 'الإجمالي' : 'Total',      m: cm.total, bold: true },
          ];
          return (
            <div className="ds-card ds-card-raised">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                <h3 className="sec-head !mb-0">
                  {isRtl ? 'الأداء حسب فئة التكلفة' : 'Performance by Cost Class'}
                </h3>
                <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">
                  {classP.label}
                  {' · '}{isRtl ? 'آخر فترة معتمدة' : 'latest approved'}
                  {' · '}{isRtl ? 'خطة أساس' : 'baseline'} V{bacSplit.packageVersion}
                </span>
              </div>
              <p className="text-(length:--t-second) text-muted-foreground italic mb-4">
                {isRtl
                  ? 'مقاييس الإجمالي محسوبة من مجاميع القيمة والتكلفة — وليست متوسط الفئتين — من واقع آخر فترة معتمدة.'
                  : 'Total metrics are computed from summed value and cost aggregates — never averaged from the two classes — at the latest approved period.'}
              </p>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="col-pin">{isRtl ? 'الفئة' : 'Class'}</th>
                      <th className="money">BAC</th>
                      <th className="money">PV</th>
                      <th className="money">EV</th>
                      <th className="money">AC</th>
                      <th className="money">CV</th>
                      <th className="money">EAC</th>
                      <th className="money">ETC</th>
                      <th className="money">VAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.k} className={cn(r.bold && 'border-t border-primary/30')}>
                        <td className={cn('col-pin font-mono', r.bold ? 'text-primary font-medium' : 'text-white')}>
                          {r.k}
                        </td>
                        <td className="money">{formatMoney(r.m.bac, { currency: ccy })}</td>
                        <td className="money">{formatMoney(r.m.pv, { currency: ccy })}</td>
                        <td className="money">{formatMoney(r.m.ev, { currency: ccy })}</td>
                        <td className="money">{formatMoney(r.m.ac, { currency: ccy })}</td>
                        <td className={cn('money', varianceTone(r.m.cv))}>{formatMoney(r.m.cv, { currency: ccy })}</td>
                        <td className="money">{formatMoney(r.m.eac, { currency: ccy })}</td>
                        <td className="money">{formatMoney(r.m.etc, { currency: ccy })}</td>
                        <td className={cn('money', varianceTone(r.m.vac))}>{formatMoney(r.m.vac, { currency: ccy })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cm.indirectBlocked && (
                <p className="text-(length:--t-second) text-chart-3 mt-2">
                  {isRtl
                    ? 'القيمة المكتسبة غير المباشرة محجوبة لهذه الفترة — تمديد معتمد بلا تاريخ سريان.'
                    : 'Indirect EV is blocked for this period — an approved extension has no effective date.'}
                </p>
              )}
            </div>
          );
        })()}
        </>
      )}

      {/* ══════════════════ FORECAST — EAC COMPARISON ══════════════════ */}
      {tab === 'forecast' && (
        <>
          <div className="ds-card ds-card-raised">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
              <h3 className="sec-head !mb-0">{isRtl ? 'مقارنة طرق التنبؤ' : 'EAC Comparison'}</h3>
              <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">
                {isRtl ? 'الأساس التراكمي' : 'Cumulative basis'} · {cum.count} {isRtl ? 'فترة' : 'periods'}
                {' · '}CPI {fmtIndex(cum.cpiCum)} · SPI {fmtIndex(cum.spiCum)}
              </span>
            </div>
            <p className="text-(length:--t-second) text-muted-foreground italic mb-4">
              {isRtl
                ? 'كل الطرق محسوبة من الأداء التراكمي لكل الفترات المعتمدة منذ بداية المشروع — لا من آخر فترة وحدها. طريقة واحدة فقط هي التوقع الرسمي.'
                : 'Every method is computed from cumulative performance across all approved periods since project start — never from the latest row alone. Exactly one method is the official forecast.'}
            </p>

            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'الطريقة' : 'Method'}</th>
                    <th>{isRtl ? 'الصيغة' : 'Formula'}</th>
                    <th className="money">EAC</th>
                    <th className="money">ETC</th>
                    <th className="money">VAC</th>
                    <th className="col-act" />
                  </tr>
                </thead>
                <tbody>
                  {eacOptions.map(o => (
                    <tr key={o.method} className={cn(o.official && 'bg-primary/[0.06]')}>
                      <td className="col-pin">
                        <span className="flex items-center gap-2">
                          <span className={cn('font-mono', o.official ? 'text-primary' : 'text-white/70')}>
                            {isRtl ? o.labelAr : o.label}
                          </span>
                          {o.official && (
                            <span className="badge badge-gold">{isRtl ? 'رسمي' : 'OFFICIAL'}</span>
                          )}
                          {!o.applicable && (
                            <span className="badge badge-neutral">{isRtl ? 'غير منطبق' : 'N/A'}</span>
                          )}
                        </span>
                      </td>
                      <td className="text-muted-foreground text-(length:--t-body)">
                        <span className="inline-flex items-center gap-1.5" title={`${o.formula}\n\n${isRtl ? o.descriptionAr : o.description}\n\n${isRtl ? o.usageAr : o.usage}`}>
                          <Info className="w-3 h-3 text-primary/50" />
                          <span className="font-mono">{o.formula}</span>
                        </span>
                      </td>
                      <td className={cn('money', o.eac > bac ? 'text-chart-3' : 'text-chart-4')}>
                        {formatMoney(o.eac, { currency: ccy })}
                      </td>
                      <td className="money text-white" title={exactMoney(o.etc, ccy)}>{abbrevMoney(o.etc)}</td>
                      <td className={cn('money', varianceTone(o.vac))}>{formatMoney(o.vac, { currency: ccy })}</td>
                      <td className="col-act">
                        {canEdit && !o.official && o.applicable && (
                          <button
                            onClick={() => setEacMethod(o.method)}
                            title={isRtl ? 'اجعلها الطريقة الرسمية' : 'Make official'}
                            className="text-muted-foreground hover:text-primary transition-colors p-1"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Method guidance — the tooltip content, always readable */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {eacOptions.map(o => (
              <div key={o.method} className={cn(
                'ds-card',
                o.official ? 'ds-card-raised border-primary/40' : '',
              )}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs text-primary">{isRtl ? o.labelAr : o.label}</span>
                  {o.official && <span className="badge badge-gold">{isRtl ? 'رسمي' : 'OFFICIAL'}</span>}
                </div>
                <div className="font-mono text-(length:--t-data) text-white/60 mb-2">{o.formula}</div>
                <p className="text-(length:--t-body) text-white/70 mb-2">{isRtl ? o.descriptionAr : o.description}</p>
                <p className="text-(length:--t-second) text-muted-foreground italic">{isRtl ? o.usageAr : o.usage}</p>
                <div className="flex items-baseline gap-2 mt-3 pt-3 border-t border-white/5">
                  <span className={cn('font-mono text-xl number-ltr', o.eac > bac ? 'text-chart-3' : 'text-chart-4')}>
                    {formatMoney(o.eac, { currency: ccy })}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* EAC / VAC over time */}
          <div className="ds-card ds-card-raised">
            <h3 className="sec-head">{isRtl ? 'تطور التوقعات' : 'Forecast Evolution'}</h3>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={shortMoney} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => v === null ? '—' : formatMoney(Number(v), { currency: ccy })} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={bac} stroke={C_EV} strokeDasharray="4 4"
                               label={{ value: 'BAC', fill: C_EV, fontSize: 10, position: 'insideTopRight' }} />
                <Line type="monotone" dataKey="eac" name="EAC" stroke={C_AC} strokeWidth={2}
                      dot={manyPeriods ? false : { r: 2 }} connectNulls={false} />
                <Brush dataKey="label" height={22} stroke="rgba(212,175,55,0.4)"
                       fill="rgba(0,0,0,0.3)" travellerWidth={8} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* ══════════════════ BASELINE VERSIONING ══════════════════ */}
      {tab === 'baseline' && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-(length:--t-body) text-muted-foreground max-w-2xl">
              {isRtl
                ? 'الأساس لا يُستبدل أبداً. كل إعادة ضبط تُنشئ إصداراً جديداً، ويُعاد توزيع القيمة المخططة على الفترات المستقبلية فقط. الفترات المعتمدة تحتفظ بأساسها وأرقامها المجمَّدة.'
                : 'A baseline is never overwritten. Re-baselining appends a version and redistributes planned value across FUTURE periods only. Approved periods keep the baseline they were approved under and their frozen figures.'}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={doGenerate} className="btn btn-secondary btn-sm">
                <CalendarPlus className="w-3 h-3" />
                {isRtl ? 'توليد فترات' : 'Generate Periods'}
              </button>
              {canEdit && (
                <button onClick={() => setRbOpen(v => !v)} className="btn btn-primary btn-sm">
                  <Plus className="w-3 h-3" />
                  {isRtl ? 'إعادة ضبط الأساس' : 'Re-baseline'}
                </button>
              )}
            </div>
          </div>

          {rbOpen && canEdit && (
            <div className="ds-card ds-card-tight">
              <h3 className="sec-head">{isRtl ? 'طلب إعادة ضبط الأساس' : 'Re-baselining Request'}</h3>
              <div className="form-grid">
                <div className="field">
                  <label className="field-label" data-required>{isRtl ? 'السبب' : 'Cause'}</label>
                  <select className="field-input" value={rb.cause}
                          onChange={e => setRb({ ...rb, cause: e.target.value as RebaselineCause })}>
                    {REBASELINE_CAUSES.map(c => (
                      <option key={c.value} value={c.value}>{isRtl ? c.ar : c.en}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">{isRtl ? 'أيام مضافة' : 'Days Added'}</label>
                  <input className="field-input font-mono number-ltr" type="number" dir="ltr"
                         value={rb.daysAdded} placeholder="0"
                         onChange={e => setRb({ ...rb, daysAdded: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">{isRtl ? 'قيمة مضافة' : 'Value Added'}</label>
                  <input className="field-input font-mono number-ltr" type="number" dir="ltr"
                         value={rb.valueAdded} placeholder="0"
                         onChange={e => setRb({ ...rb, valueAdded: e.target.value })} />
                </div>
                <div className="field xl:col-span-2">
                  <label className="field-label" data-required>{isRtl ? 'المبرر' : 'Reason'}</label>
                  <input className="field-input" value={rb.reason}
                         placeholder={isRtl ? 'مرجع التمديد أو أمر التغيير' : 'EOT or change order reference'}
                         onChange={e => setRb({ ...rb, reason: e.target.value })} />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" onClick={() => setRbOpen(false)} className="btn btn-ghost">
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button type="button" onClick={doRebaseline} className="btn btn-primary">
                  {isRtl ? 'اعتماد وإنشاء إصدار' : 'Approve & Create Version'}
                </button>
              </div>
            </div>
          )}

          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{isRtl ? 'الإصدار' : 'Version'}</th>
                  <th>{isRtl ? 'من' : 'Start'}</th>
                  <th>{isRtl ? 'إلى' : 'Finish'}</th>
                  <th className="money">{isRtl ? 'المدة' : 'Duration'}</th>
                  <th className="money">BAC</th>
                  <th>{isRtl ? 'السبب' : 'Cause'}</th>
                  <th>{isRtl ? 'المبرر' : 'Reason'}</th>
                  <th>{isRtl ? 'اعتمده' : 'Approved By'}</th>
                  <th className="col-act" />
                </tr>
              </thead>
              <tbody>
                {(store.baselines ?? []).length === 0 && (
                  <tr><td colSpan={9}><div className="ds-empty">
                    <div className="ds-empty-title">{isRtl ? 'لا توجد إصدارات' : 'No baseline versions'}</div>
                  </div></td></tr>
                )}
                {(store.baselines ?? []).map(b => {
                  const active = b.id === (baseline?.id ?? '');
                  const cause = REBASELINE_CAUSES.find(c => c.value === b.cause);
                  return (
                    <tr key={b.id} className={cn(active && 'bg-primary/[0.06]')}>
                      <td className="col-pin font-mono text-primary">
                        <span className="flex items-center gap-2">
                          {b.name}
                          {active && <span className="badge badge-gold">{isRtl ? 'نشط' : 'ACTIVE'}</span>}
                        </span>
                      </td>
                      <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">
                        {formatDateOrDash(b.start, isRtl ? 'ar' : 'en')}
                      </td>
                      <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">
                        {formatDateOrDash(b.finish, isRtl ? 'ar' : 'en')}
                      </td>
                      <td className="money text-white">
                        {b.durationDays}d
                        {b.daysAdded ? <span className="text-chart-5 ms-1">+{b.daysAdded}</span> : null}
                      </td>
                      <td className="money text-primary" title={exactMoney(b.bac, ccy)}>{abbrevMoney(b.bac)}</td>
                      <td className="text-muted-foreground text-(length:--t-body)">{cause ? (isRtl ? cause.ar : cause.en) : '—'}</td>
                      <td className="text-white/70 text-(length:--t-body) max-w-[220px] truncate" title={b.reason}>{b.reason || '—'}</td>
                      <td className="text-muted-foreground text-(length:--t-body)">
                        {b.approvedBy || '—'}
                        {b.approvedOn && (
                          <span className="block text-(length:--t-data) opacity-60 font-mono">
                            {formatDateOrDash(b.approvedOn, isRtl ? 'ar' : 'en')}
                          </span>
                        )}
                      </td>
                      <td className="col-act">
                        {canEdit && !active && (
                          <button onClick={() => switchBaseline(b.id)}
                                  title={isRtl ? 'تفعيل' : 'Make active'}
                                  className="text-muted-foreground hover:text-primary transition-colors p-1">
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ══════════════════ TREND ══════════════════ */}
      {tab === 'trend' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="ds-card ds-card-raised">
            <h3 className="sec-head">{isRtl ? 'مؤشرات الأداء' : 'Performance Indices'}</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis domain={[0.6, 1.4]} {...AXIS} tickFormatter={(v: number) => v.toFixed(2)} />
                <Tooltip contentStyle={TT_STYLE}
                         formatter={(v: any) => v === null ? '—' : Number(v).toFixed(3)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={1} stroke="rgba(212,175,55,0.4)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="spi" name="SPI" stroke={C_EV} strokeWidth={2}
                      dot={manyPeriods ? false : { r: 2 }} connectNulls={false} />
                <Line type="monotone" dataKey="cpi" name="CPI" stroke={C_OK} strokeWidth={2}
                      dot={manyPeriods ? false : { r: 2 }} connectNulls={false} />
                <Brush dataKey="label" height={22} stroke="rgba(212,175,55,0.4)"
                       fill="rgba(0,0,0,0.3)" travellerWidth={8} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="ds-card ds-card-raised">
            <h3 className="sec-head">{isRtl ? 'الانحرافات' : 'Variances'}</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={shortMoney} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => formatMoney(Number(v), { currency: ccy })} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="rgba(212,175,55,0.4)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="sv" name="SV" stroke={C_WARN} strokeWidth={2}
                      dot={manyPeriods ? false : { r: 2 }} />
                <Line type="monotone" dataKey="cv" name="CV" stroke={C_AC} strokeWidth={2}
                      dot={manyPeriods ? false : { r: 2 }} />
                <Brush dataKey="label" height={22} stroke="rgba(212,175,55,0.4)"
                       fill="rgba(0,0,0,0.3)" travellerWidth={8} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Forecast trend — VAC over time */}
          <div className="xl:col-span-2 ds-card ds-card-raised">
            <h3 className="sec-head">{isRtl ? 'اتجاه التوقعات — VAC / EAC' : 'Forecast Trend — VAC / EAC'}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={shortMoney} />
                <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => v === null ? '—' : formatMoney(Number(v), { currency: ccy })} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="rgba(212,175,55,0.4)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="vac" name="VAC" stroke={C_WARN} strokeWidth={2}
                      dot={manyPeriods ? false : { r: 2 }} connectNulls={false} />
                <Line type="monotone" dataKey="eac" name="EAC" stroke={C_AC} strokeWidth={1.5}
                      dot={false} connectNulls={false} />
                <Brush dataKey="label" height={22} stroke="rgba(212,175,55,0.4)"
                       fill="rgba(0,0,0,0.3)" travellerWidth={8} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Approved history table */}
          <div className="xl:col-span-2 ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                  <th className="money">SPI</th>
                  <th className="money">CPI</th>
                  <th className="money">SV</th>
                  <th className="money">CV</th>
                  <th className="money">EAC</th>
                  <th className="money">VAC</th>
                  <th>{isRtl ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {points.filter(p => p.spi !== null || p.cpi !== null).length === 0 && (
                  <tr><td colSpan={8}><div className="ds-empty">
                    <div className="ds-empty-title">{isRtl ? 'لا توجد فترات بها بيانات' : 'No periods carry data yet'}</div>
                  </div></td></tr>
                )}
                {points.filter(p => p.spi !== null || p.cpi !== null).map(p => (
                  <tr key={p.seq}>
                    <td className="col-pin font-mono text-primary">{p.label}</td>
                    <td className={cn('money', indexTone(p.spi))}>{fmtIndex(p.spi)}</td>
                    <td className={cn('money', indexTone(p.cpi))}>{fmtIndex(p.cpi)}</td>
                    <td className={cn('money', varianceTone(p.sv))}>{formatMoney(p.sv, { currency: ccy })}</td>
                    <td className={cn('money', varianceTone(p.cv))}>{formatMoney(p.cv, { currency: ccy })}</td>
                    <td className={cn('money', p.eac !== null && p.eac > bac ? 'text-chart-3' : 'text-chart-4')}>
                      {p.eac === null ? '—' : formatMoney(p.eac, { currency: ccy })}
                    </td>
                    <td className={cn('money', varianceTone(p.vac ?? 0))}>
                      {p.vac === null ? '—' : formatMoney(p.vac, { currency: ccy })}
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5">
                        <span className={cn('badge', STATUS_META[p.status].tone)}>
                          {isRtl ? STATUS_META[p.status].ar : STATUS_META[p.status].en}
                        </span>
                        {p.frozen && <Lock className="w-3 h-3 text-muted-foreground" />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

/** Executive variance card: index, delta against the previous period, variance. */
function VarianceCard({
  title, index, indexLabel, variance, varianceLabel, prev, isRtl, ccy,
}: {
  title: string; index: number | null; indexLabel: string;
  variance: number; varianceLabel: string; prev: number | null; isRtl: boolean;
  /** SPRINT 3 · R5 — passed down; the card has no project of its own. */
  ccy: string;
}) {
  const delta = index !== null && prev !== null ? index - prev : null;
  return (
    <div className="ds-card ds-card-raised">
      <h3 className="sec-head">{title}</h3>
      <div className="flex items-baseline gap-3 mb-3">
        <span className={cn('font-mono text-4xl font-semibold number-ltr', indexTone(index))}>
          {fmtIndex(index)}
        </span>
        <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">{indexLabel}</span>
        {delta !== null && Math.abs(delta) >= 0.001 && (
          <span className={cn('text-(length:--t-data) font-mono number-ltr',
            delta > 0 ? 'text-chart-4' : 'text-chart-3')}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(3)}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">{varianceLabel}</span>
        <span className={cn('font-mono text-sm font-semibold number-ltr', varianceTone(variance))}>
          {formatMoney(variance, { currency: ccy })}
        </span>
      </div>
      <p className="text-(length:--t-second) text-muted-foreground mt-2">
        {index === null
          ? (isRtl ? 'لا توجد بيانات كافية' : 'Insufficient data')
          : index >= 1
            ? (isRtl ? 'ضمن الهدف' : 'At or above target')
            : (isRtl ? 'دون الهدف 1.00' : 'Below the 1.00 target')}
      </p>
    </div>
  );
}

/** Period-on-period movement arrow. Silent when the change is negligible. */
function Movement({ now, was }: { now: number | null; was: number | null }) {
  if (now === null || was === null) return null;
  const d = now - was;
  if (Math.abs(d) < 0.001) {
    return <div className="text-(length:--t-second) text-muted-foreground mt-0.5">→ no change</div>;
  }
  const up = d > 0;
  return (
    <div className={cn('text-(length:--t-data) mt-0.5 flex items-center gap-0.5 font-mono',
      up ? 'text-chart-4' : 'text-chart-3')}>
      {up ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
      {Math.abs(d).toFixed(3)}
    </div>
  );
}

/** One editable money cell with an AUTO / MANUAL provenance badge.
 *  `hideBadge` strips the badge — used by the Total lens, where every
 *  figure is derived from Direct + Indirect and provenance chips beside
 *  derived numbers only suggested a choice that does not exist. */
function ValueCell({
  v, src, locked, canWrite, onSave, onAuto, ccy, notEntered, isRtl, hideBadge,
}: {
  v: number; src: 'auto' | 'manual'; locked: boolean; canWrite: boolean;
  onSave: (raw: string) => void; onAuto: () => void;
  /** SPRINT 3 · R5 — passed down; the cell has no project of its own. */
  ccy: string;
  /**
   * STEP 11 — true when no Finance value has been entered for this field.
   * Only AC passes it. Renders "Actual Cost Not Entered" in place of a
   * figure, because printing 0 would assert a spend of zero that nobody
   * recorded. Still clickable, so entering the first value is one click.
   */
  notEntered?: boolean;
  isRtl?: boolean;
  /** Omit the AUTO / MANUAL / NOT ENTERED chips (the Total lens). */
  hideBadge?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.round(v)));

  if (editing) {
    return (
      <td className="money">
        <input
          autoFocus type="number" dir="ltr" value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { onSave(draft); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { onSave(draft); setEditing(false); }
            if (e.key === 'Escape') setEditing(false);
          }}
          className="bg-primary/10 border border-primary/50 px-2 py-0.5 font-mono text-xs w-32 focus:outline-none text-white number-ltr"
        />
      </td>
    );
  }

  return (
    <td className="money">
      <span className="inline-flex items-center gap-1.5 justify-end">
        <span
          onClick={() => { if (canWrite && !locked) { setDraft(notEntered ? '' : String(Math.round(v))); setEditing(true); } }}
          className={cn('font-mono', canWrite && !locked && 'cursor-pointer hover:text-primary transition-colors',
                        notEntered && 'text-muted-foreground/70 italic')}
          title={locked ? 'Approved — locked' : canWrite ? 'Click to edit' : undefined}
        >
          {notEntered
            ? (isRtl ? 'لم تُدخَل' : 'Not Entered')
            : formatMoney(v, { currency: ccy })}
        </span>
        {/* hideBadge (Total lens): derived numbers carry no provenance to
            state. The value itself already prints "Not Entered" when
            nothing was recorded, so absence stays stated without chips. */}
        {hideBadge ? null : src === 'manual' ? (
          <>
            <span className="text-(length:--t-micro) tracking-widest text-chart-5/70 border border-chart-5/25 px-1 leading-[1.4]">
              MANUAL
            </span>
            {canWrite && !locked && (
              <button onClick={onAuto} title="Return to automatic"
                      className="text-muted-foreground hover:text-primary transition-colors">
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </>
        ) : notEntered ? (
          /* STEP 11 — nothing derives AC any more, so "AUTO" would be a
             lie here: no automation is standing by to fill it. */
          <span className="text-(length:--t-micro) tracking-widest text-muted-foreground/50 border border-muted-foreground/20 px-1 leading-[1.4]">
            {isRtl ? 'لم تُدخَل' : 'NOT ENTERED'}
          </span>
        ) : (
          <span className="text-(length:--t-micro) tracking-widest text-primary/50 border border-primary/20 px-1 leading-[1.4]">
            AUTO
          </span>
        )}
      </span>
    </td>
  );
}

/** One inline-editable reporting field. Read-only once the period is frozen. */
// ── Small readers for the ribbon. Read-only, never written. ────────────

/** Σ time claimed across all claims. Read from the claims register. */
function claimDays(projectId: string): number {
  try {
    const rows = JSON.parse(localStorage.getItem(`pactum-claims-${projectId}`) || '[]');
    if (!Array.isArray(rows)) return 0;
    return rows.reduce((a: number, r: any) => a + (Number(r.timeDays) || 0), 0);
  } catch { return 0; }
}

/**
 * Approved extensions = Sigma approved CO time + Sigma approved claim time.
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 3 · R6 — WAS A THIRD COPY OF THE RULE.
 *
 * This function re-implemented `computeApprovedEOT` by hand, reading the
 * two storage keys directly. The arithmetic happened to agree with the
 * canonical version, but a rule written three times is a rule that will
 * eventually be changed twice — and the Delay screen proved it, showing
 * 140d against this function's 95d for the same project.
 *
 * It now DELEGATES. The body is gone; only the call site's name remains,
 * so nothing above had to change.
 * ══════════════════════════════════════════════════════════════════════
 */
function approvedExtensions(projectId: string): number {
  return computeApprovedEOT(projectId).totalApprovedEOT;
}

/**
 * STEP 11 — AC provenance label.
 *
 * 'budget' and 'disbursed' are gone: AC is no longer derived from
 * anything. The only two truthful states are Finance-entered, or not
 * entered at all. The old values are still mapped so an EVM store
 * persisted before Step 11 does not render a blank.
 */
function acLabel(from: string, ar: boolean): string {
  if (from === 'manual')      return ar ? 'إدخال الإدارة المالية' : 'Finance entry';
  if (from === 'not-entered') return ar ? 'لم تُدخَل التكلفة الفعلية' : 'Actual Cost Not Entered';
  if (from === 'budget')      return ar ? 'وحدة الميزانية (قديم)' : 'Budget module (legacy)';
  if (from === 'disbursed')   return ar ? 'المصروفات النقدية (قديم)' : 'Cash disbursed (legacy)';
  return ar ? 'لم تُدخَل التكلفة الفعلية' : 'Actual Cost Not Entered';
}
