import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Project } from '../../lib/data';
import { useTranslation } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { formatDateOrDash } from '../../lib/dateFormat';
import { useAuth } from '../../lib/store';
import { abbrevMoney, exactMoney } from '../../lib/moneyFormat';
import { useProjectCurrency } from '../../lib/useProjectCurrency';
// The single authority for Contract Amount. Never reimplemented here.
import { commercialTotals } from '../../lib/commercialTotals';
import { companyIdOfProject } from '../../lib/projectMaster';
import { fetchSectors } from '../../mock/sectors';
import ReportButton from '../reporting/ReportButton';
import {
  Layers, Lock, Plus, GitCompare, Info, Check, Ban, AlertTriangle, History,
  FileSignature, Landmark, Wallet, Gauge, FileText, FileWarning,
} from 'lucide-react';

// Existing engines — READ ONLY. This module captures their published
// outputs. Not one of them is modified, and none of their formulas is
// reimplemented here.
import { computeLd, computeApprovedEOT, computeProgramme } from '../../lib/delayCalculations';
// PHASE 4 · STEP 8 — a DERIVED governance signal. Reads records, writes
// nothing; the current baseline stays authoritative until a person
// approves a new version.
import { baselineUpdateStateFor } from '../../lib/baselineGate';
import { readSyncedEvm, snapshot as evmSnapshot, EAC_META, type EvmStore } from '../../lib/evm';
/**
 * SOURCE VERSIONING. A baseline is built only from APPROVED source
 * versions, so the five version lines belong on the screen that files
 * baselines — the user should not have to visit five modules to find out
 * why an approval is blocked.
 */
import { refsReadiness, describeRefs, SOURCE_LABELS, SOURCE_KINDS, approvedOf, openOf, readSourceVersions } from '../../lib/sourceVersions';

import {
  readBaselines, createBaseline, activateBaseline, supersedeBaseline, rejectDraft,
  historyOf, activeOf, draftOf, byId, nextVersion, baselineCoverage,
  compareBaselines, compareDetail, registerRows, driftOf,
  captureContract, captureBudget, captureCashflow, captureSchedule, captureForecast,
  labelOf, statusLabel, causeLabel, fieldLabel,
  BASELINE_TYPES, BASELINE_CAUSES,
  // THE BASELINE PACKAGE — built from approved source versions, gated,
  // and the ONLY thing EVM reads for BAC. Until this screen called it,
  // the whole engine was unreachable from the UI.
  createPackageFromApprovedSources, approveAndActivate, rejectPackage,
  readBaselines as readPkgStore, packageHistory, currentPackage,
  draftPackage as pkgDraft, packageLabel, evaluatePackageGate, packageLag,
  BaselineStore, BaselineRecord, BaselineType, BaselineCause, BaselineData,
} from '../../lib/baselines';

/**
 * Baseline Management.
 * Destination: src/components/modules/BaselineModule.tsx
 *
 * PHASE 4.
 *
 * Five families of plan — contract, budget, cash flow, schedule, forecast —
 * each versioned, each frozen on adoption, each comparable against any
 * earlier version of itself.
 *
 * This screen performs no business calculation. Every figure it files was
 * produced by the module that owns it and is copied verbatim. The live
 * dashboards are untouched, and Timeline's logic is untouched: it merely
 * records which baseline version each approved period was reported against.
 */

/** Headline field per family, for the drift chart and the register. */
const SOURCE_ICONS: Record<string, { icon: any; color: string }> = {
  'contract':      { icon: FileSignature, color: 'text-primary' },
  'budget':        { icon: Landmark,      color: 'text-white' },
  'cashflow':      { icon: Wallet,        color: 'text-chart-5' },
  'evm-planned':   { icon: Gauge,         color: 'text-chart-4' },
  'claims':        { icon: FileText,      color: 'text-chart-3' },
  'change-orders': { icon: FileWarning,   color: 'text-white' },
};

const HEADLINE: Record<BaselineType, { field: string; en: string; ar: string; money: boolean }> = {
  // Contract Amount = Contract Value + approved COs + approved claims.
  contract: { field: 'currentContract',      en: 'Contract Amount',  ar: 'إجمالي قيمة العقد', money: true },
  budget:   { field: 'totalPlanned',         en: 'Planned',          ar: 'المخطط',     money: true },
  cashflow: { field: 'netFlow',              en: 'Net Flow',         ar: 'صافي التدفق', money: true },
  schedule: { field: 'plannedDurationDays',  en: 'Duration',         ar: 'المدة',      money: false },
  // STEP 11 / PHASE 4 — EV baseline is the authoritative forecast reference.
  // Label renamed from 'Forecast' to 'EV' to match EVM engine terminology.
  forecast: { field: 'eac',                  en: 'EV Baseline',      ar: 'خط الأساس للقيمة المكتسبة (EV)', money: true },
};

export default function BaselineModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  const { lang } = useTranslation();
  const { user } = useAuth();
  const isRtl = lang === 'ar';

  const [store, setStore] = useState<BaselineStore>(() => readBaselines(project.id));
  const [activeType, setActiveType] = useState<BaselineType>('budget');

  /**
   * ════════════════════════════════════════════════════════════════════
   * THE BASELINE PACKAGE — THE MISSING HALF OF THE LOOP.
   *
   * Approving Budget V2 or Change Orders V1 did nothing visible, and the
   * reason was not a refresh bug: NOTHING IN THE UI EVER BUILT A
   * PACKAGE. `createPackageFromApprovedSources` had zero callers, so
   * `store.packages` stayed empty forever — and `computeBacSplit` reads
   * ONLY approved packages, which is why EVM reported "no approved
   * baseline, BAC unavailable" no matter how many sources were signed.
   *
   * DECISION (1)=A — BUILT MANUALLY, NEVER AUTOMATICALLY. Approving the
   * fifth source does not mint a package on its own. Creating is not
   * approving, and a system that files a financial record because a
   * counter reached five is signing on the user's behalf.
   * ════════════════════════════════════════════════════════════════════
   */
  // THE BASELINE PACKAGE — reads ONLY from approved source versions
  // (store.packages / currentPackage / approvedRefs). If approved versions
  // exist but are not recognized, verify sourceVersions.ts and baselines.ts.
  const [pkgTick, setPkgTick] = useState(0);
  const [pkgMsg, setPkgMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [pkgForm, setPkgForm] = useState({ reason: '', effectiveDate: '' });
  const [creating, setCreating] = useState(false);
  const [reason, setReason] = useState('');
  const [cause, setCause] = useState<BaselineCause>('initial');
  const [notes, setNotes] = useState('');
  const [asDraft, setAsDraft] = useState(false);
  const [cmpFrom, setCmpFrom] = useState('');
  const [cmpTo, setCmpTo] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    setStore(readBaselines(project.id));
    setCreating(false);
    setCmpFrom(''); setCmpTo('');
    setErr('');
  }, [project.id]);

  const persist = useCallback((next: BaselineStore) => setStore(next), []);

  /**
   * The live position, assembled from the OWNING modules.
   *
   * Every engine is called exactly as its own dashboard calls it. Nothing
   * here reimplements a formula — these are the same objects the Delay, LD
   * and EVM screens are rendering right now.
   */
  /**
   * EV BASELINE LINK — the EV family reads from the LATEST APPROVED
   * 'EVM Planned' source version rather than the live EVM store, so a
   * baseline can never silently drift from what was actually approved.
   * Falls back to live only while no approved version exists.
   */
  const approvedEvmPlanned = useMemo(() => {
    const v = approvedOf(readSourceVersions(project.id), 'evm-planned');
    const snap = v?.snapshot as { settings?: unknown; periods?: unknown[] } | undefined;
    if (!v || !snap || !Array.isArray(snap.periods) || !snap.settings) return null;
    return { version: v.version, snapshot: snap as unknown as EvmStore };
  }, [project.id, pkgTick]);

  const live = useMemo(() => {
    const claimsRows: any[] = (() => {
      try { return JSON.parse(localStorage.getItem(`pactum-claims-${project.id}`) || '[]'); }
      catch { return []; }
    })();

    const eot = computeApprovedEOT(project.id);
    const ld = computeLd(project, eot);
    const programme = computeProgramme(project, ld.totalApprovedEOT, ld.totalDelay);

    const evmStore = approvedEvmPlanned?.snapshot ?? readSyncedEvm(project);
    const evm = evmSnapshot(project, evmStore);

    return { ld, programme, evm, evmStore };
  }, [project, store, approvedEvmPlanned]);

  /** The project's reporting currency — stamped onto captured baselines. */
  // PROJECT SCREENS ARE DENOMINATED IN THE CONTRACT CURRENCY.
  // `.reporting` is the AGGREGATION currency, used when this project is
  // rolled up into a company or portfolio figure. Reading it here is what
  // printed the company's unit on a project's own numbers.
  const ccy = useProjectCurrency(project).base;

  /** What would be captured for the selected family, right now. */
  const capture = useCallback((type: BaselineType): BaselineData => {
    switch (type) {
      // SPRINT 4 — was the literal 'SAR'. This is the worst class of the
      // defect in the sweep: a baseline is WRITTEN TO STORAGE with its
      // currency, so a EUR project was persisting euro figures stamped
      // SAR, and every later comparison inherited the wrong label from
      // the record rather than from the screen. Corrected at the source.
      case 'contract': {
        /**
         * THE PROJECT RECORD CARRIES STALE ZEROS.
         *
         * `createProject` writes `totalApprovedCOs: 0`,
         * `totalApprovedClaims: 0` and `revisedContractValue =
         * contractValue`. Nothing refreshes them until someone opens the
         * Overview screen, which persists the computed figures back.
         *
         * `captureContract` reads exactly those fields, so on a project
         * whose Overview has never been opened this screen showed
         * APPROVED CHANGE ORDERS 0, APPROVED CLAIMS 0 and a Contract
         * Amount equal to the Contract Value — while Change Orders and
         * Claims plainly held approved rows.
         *
         * `commercialTotals()` is the single authority for
         *
         *     Contract Amount = Contract Value
         *                     + approved change orders
         *                     + approved claims
         *
         * with every term converted before it is summed. Reading it here
         * means the baseline freezes the SAME figures Overview shows.
         * No arithmetic is performed in this file.
         */
        const t = commercialTotals(project as any, companyIdOfProject(project as any, fetchSectors()));
        return captureContract({
          ...project,
          contractValue: t.originalContract,
          totalApprovedCOs: t.approvedChangeOrders,
          totalApprovedClaims: t.approvedClaims,
          revisedContractValue: t.revisedContract,
        } as any, ccy);
      }
      case 'budget':   return captureBudget(project.id);
      case 'cashflow': return captureCashflow(project.id);
      case 'schedule': return captureSchedule(live.programme, live.ld.totalDelay, live.ld.totalApprovedEOT);
      case 'forecast':
      default:
        return captureForecast({
          bac: live.evm.bac,
          method: EAC_META[live.evmStore.settings.eacMethod].label,
          m: live.evm.m,
          dates: live.evm.dates,
          cum: live.evm.cum,
        });
    }
  }, [project, live, ccy]);

  // ── Package: read the store, and the readiness of the five sources ──
  const pkgStore = useMemo(
    () => readPkgStore(project.id), [project.id, pkgTick, store]);
  const pkgCurrent = useMemo(() => currentPackage(pkgStore), [pkgStore]);
  const pkgOpenDraft = useMemo(() => pkgDraft(pkgStore), [pkgStore]);
  const pkgList = useMemo(() => packageHistory(pkgStore), [pkgStore]);
  const srcReady = useMemo(
    () => refsReadiness(project.id), [project.id, pkgTick, store]);
  /**
   * SOURCE APPROVAL CARDS — one card per source kind, AUTO-READ from the
   * versions store on every render. Green = approved with nothing pending;
   * red = a draft needs review, a submission awaits approval, or no
   * version exists yet; AMBER = a newer version was approved after the
   * current Baseline Package was built — a new package approval is needed.
   */
  const lag = useMemo(() => packageLag(project.id), [project.id, pkgTick, store]);

  const sourceCards = useMemo(() => {
    const sv = readSourceVersions(project.id);
    return SOURCE_KINDS.map(kind => {
      const approved = approvedOf(sv, kind);
      const open = openOf(sv, kind);
      const lb = lag.behind.find(b => b.kind === kind);
      return {
        kind,
        approvedVersion: approved ? approved.version : null,
        openVersion: open ? open.version : null,
        openStatus: open ? open.status : null,
        pkgVersion: lb ? lb.pkgVersion : null,
        behind: !!lb,
      };
    });
  }, [project.id, pkgTick, store, lag]);

  /** Builds the next package DRAFT from the approved source versions. */
  const buildPackage = () => {
    if (!pkgForm.reason.trim()) {
      setPkgMsg({ bad: true, text: isRtl
        ? 'سبب إنشاء الحزمة مطلوب. لم يُنفَّذ شيء.'
        : 'A reason is required. Nothing was created.' });
      return;
    }
    const res = createPackageFromApprovedSources({
      projectId: project.id,
      effectiveDate: pkgForm.effectiveDate || new Date().toISOString().slice(0, 10),
      createdBy: user?.username ?? 'unknown',
      reason: pkgForm.reason.trim(),
      currency: ccy,
    });
    if (!res.ok) {
      // The refusal NAMES the sources that are missing. A generic
      // "cannot build" leaves the user with nowhere to go.
      const missing = (res.blocked?.missing || [])
        .map(k => (isRtl ? SOURCE_LABELS[k].ar : SOURCE_LABELS[k].en)).join(' · ');
      setPkgMsg({ bad: true, text: missing
        ? (isRtl
            ? `لا يمكن بناء الحزمة — المصادر التالية بلا نسخة معتمدة: ${missing}`
            : `Cannot build — these sources have no approved version: ${missing}`)
        : (isRtl ? `تعذّر الإنشاء: ${res.reason}` : `Could not create: ${res.reason}`) });
      setPkgTick(n => n + 1);
      return;
    }
    setPkgMsg({ bad: false, text: isRtl
      ? `أُنشئت حزمة خط الأساس ${packageLabel(res.pkg!)} كمسودة. راجعها ثم اعتمدها.`
      : `Baseline Package ${packageLabel(res.pkg!)} created as a draft. Review it, then approve.` });
    setPkgForm({ reason: '', effectiveDate: '' });
    setPkgTick(n => n + 1);
  };

  /** Runs the eight-gate check, then approves and activates. */
  const approvePackage = (id: string) => {
    const res = approveAndActivate(project.id, id, user?.username ?? 'unknown');
    if (!res.ok) {
      const reasons = (res.gate?.reasons || []).join(' · ');
      setPkgMsg({ bad: true, text: reasons
        ? (isRtl ? `البوابة رفضت الاعتماد: ${reasons}` : `The gate refused approval: ${reasons}`)
        : (isRtl ? `تعذّر الاعتماد: ${res.reason}` : `Could not approve: ${res.reason}`) });
    } else {
      setPkgMsg({ bad: false, text: isRtl
        ? `اعتُمدت ${packageLabel(res.pkg!)}. الآن تقرأ القيمة المكتسبة موازنة الإنجاز منها.`
        : `${packageLabel(res.pkg!)} approved. Earned Value now reads BAC from it.` });
    }
    setPkgTick(n => n + 1);
  };

  const rejectPkg = (id: string) => {
    const why = window.prompt(isRtl ? 'سبب الرفض؟' : 'Why is it being rejected?') || '';
    if (!why.trim()) {
      setPkgMsg({ bad: true, text: isRtl
        ? 'الرفض يحتاج سبباً. لم يُنفَّذ شيء.' : 'A rejection needs a reason. Nothing changed.' });
      return;
    }
    const res = rejectPackage(project.id, id, user?.username ?? 'unknown', why.trim());
    setPkgMsg(res.ok
      ? { bad: false, text: isRtl
          ? 'رُفضت الحزمة وتبقى مسجَّلة. المحاولة التالية تحمل رقم مراجعة جديداً.'
          : 'Rejected and kept on record. The next attempt carries a new revision.' }
      : { bad: true, text: isRtl ? `تعذّر الرفض: ${res.reason}` : `Could not reject: ${res.reason}` });
    setPkgTick(n => n + 1);
  };

  const preview = useMemo(() => capture(activeType) as Record<string, any>, [capture, activeType]);

  const history = useMemo(() => historyOf(store, activeType), [store, activeType]);
  const current = useMemo(() => activeOf(store, activeType), [store, activeType]);
  const openDraft = useMemo(() => draftOf(store, activeType), [store, activeType]);
  const coverage = useMemo(() => baselineCoverage(store), [store]);
  /**
   * Step 8 — has the approved plan fallen behind the approved scope?
   * Recomputed from the registers whenever the store changes. Nothing is
   * cached to disk: a stale governance flag would be worse than none.
   */
  const updateState = useMemo(
    () => baselineUpdateStateFor(project.id, ccy),
    [project.id, ccy, store]);
  const rows = useMemo(() => registerRows(store, isRtl ? 'ar' : 'en'), [store, isRtl]);
  const drift = useMemo(
    () => driftOf(store, activeType, HEADLINE[activeType].field),
    [store, activeType],
  );

  // Default the comparison to the two most recent versions of this family.
  useEffect(() => {
    if (history.length >= 2) {
      setCmpFrom(history[history.length - 2].id);
      setCmpTo(history[history.length - 1].id);
    } else {
      setCmpFrom(''); setCmpTo('');
    }
  }, [activeType, history.length]);

  const comparison = useMemo(
    () => compareBaselines(byId(store, cmpFrom), byId(store, cmpTo)),
    [store, cmpFrom, cmpTo],
  );
  const detail = useMemo(
    () => compareDetail(byId(store, cmpFrom), byId(store, cmpTo)),
    [store, cmpFrom, cmpTo],
  );

  const submit = () => {
    setErr('');
    const res = createBaseline(project.id, {
      type: activeType,
      createdBy: user?.username ?? 'unknown',
      reason,
      cause,
      notes,
      data: capture(activeType),
      activate: !asDraft,
    });
    if (!res.ok) {
      setErr(
        res.reason === 'missing-reason'
          ? (isRtl ? 'السبب مطلوب. أي خط أساس بلا سبب مُعلن يفقد قابلية التفسير لاحقاً.'
                   : 'A reason is required. An unexplained baseline cannot be interpreted later.')
          : res.reason === 'draft-exists'
          ? (isRtl ? 'توجد مسودة مفتوحة لهذا النوع. اعتمدها أو ارفضها أولاً.'
                   : 'An open draft already exists for this type. Adopt or reject it first.')
          : (isRtl ? 'تعذّر الإنشاء.' : 'Could not create.'),
      );
      return;
    }
    persist(res.store);
    setCreating(false);
    setReason(''); setNotes('');
  };

  const reportCtx = {
    project,
    reportCurrency: ccy,
    baselineType: activeType,
    baselineTypeLabel: labelOf(activeType, isRtl ? 'ar' : 'en'),
    register: rows,
    history: history.map(b => ({
      version: b.version, name: b.name, status: b.status,
      createdAt: b.createdAt, createdBy: b.createdBy, dataDate: b.dataDate,
      cause: causeLabel(b.cause, isRtl ? 'ar' : 'en'), reason: b.reason, notes: b.notes,
      supersededAt: b.supersededAt, supersededBy: b.supersededBy,
    })),
    active: current,
    comparison: comparison.ok ? comparison : null,
    detail,
    drift,
    coverage,
  };

  const Tone = (v: number | null) =>
    v === null || v === 0 ? 'text-muted-foreground' : v > 0 ? 'text-chart-5' : 'text-chart-4';

  const fmt = (kind: string, v: string | number | null): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (kind === 'money') return abbrevMoney(v);
    if (kind === 'days') return `${v}d`;
    if (kind === 'date') return formatDateOrDash(String(v), isRtl ? 'ar' : 'en');
    return String(v);
  };

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      {/* ── What this screen is ── */}
      <div className="ds-card ds-card-tight">
        <div className="flex items-start gap-2.5">
          <Info className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" />
          <p className="text-(length:--t-second) text-muted-foreground leading-relaxed">
            {isRtl
              ? 'خطوط الأساس بيان مُجمَّد للخطة. هذه الشاشة لا تحسب شيئاً — تنسخ الأرقام من الوحدات التي تملكها (العقد، الموازنة، التدفق النقدي، التأخير، القيمة المكتسبة) وتحفظها بنسخة مرقّمة. لا يُعدَّل خط أساس معتمد أبداً؛ تغيير الخطة يعني إصدار النسخة التالية، وتبقى السابقة مقروءة للأبد.'
              : 'A baseline is a frozen statement of the plan. This screen calculates nothing — it copies figures from the modules that own them (Contract, Budget, Cash Flow, Delay, Earned Value) and files them as a numbered version. An adopted baseline is never edited; changing the plan means issuing the next version, and the previous one stays readable forever.'}
          </p>
        </div>
      </div>

      {/* (Source Versions panel removed from this page by request —
          the Baseline Package below already AUTO-READS the latest
          approved versions, and each module still shows its own
          version line in place.) */}

      {/*
        ══════════════════════════════════════════════════════════════════
        BASELINE PACKAGE — WHERE THE FIVE APPROVED SOURCES BECOME BAC.

        This panel is the loop the system was missing. Everything below
        it (the five families) predates the package and stays readable;
        everything above it (the source versions) feeds into it.
        ══════════════════════════════════════════════════════════════════
      */}
      <div className="ds-card ds-card-raised">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-[280px] flex-1">
            <h3 className="sec-head !mb-1">
              <Layers className="w-4 h-4 inline-block me-2 text-primary/70" />
              {isRtl ? 'حزمة خط الأساس' : 'Baseline Package'}
            </h3>
            <p className="text-(length:--t-second) text-muted-foreground">
              {pkgCurrent
                ? <>
                    {isRtl ? 'السارية' : 'In force'}{': '}
                    <span className="font-mono text-primary">{packageLabel(pkgCurrent)}</span>
                    {' · '}{isRtl ? 'اعتُمدت' : 'approved'}{' '}
                    <span className="font-mono">
                      {formatDateOrDash(pkgCurrent.approvedAt.slice(0, 10), isRtl ? 'ar' : 'en')}
                    </span>
                    {' · '}{pkgCurrent.approvedBy}
                  </>
                : (isRtl
                    ? 'لم تُعتمد أي حزمة بعد — ولهذا تظهر موازنة الإنجاز (BAC) غير متاحة في القيمة المكتسبة.'
                    : 'No package approved yet — which is why Earned Value reports BAC as unavailable.')}
            </p>
            {/* ── Source approval cards (auto-read) — same KPI tile design
                as the Overview grid. Green badge = approved with nothing
                pending; red badge = action needed. */}
            <div className="ds-grid mt-3">
              {sourceCards.map(s => {
                const ok = !s.openVersion && s.approvedVersion !== null && !s.behind;
                const amber = !s.openVersion && s.approvedVersion !== null && s.behind;
                const meta = SOURCE_ICONS[s.kind] ?? { icon: History, color: 'text-muted-foreground' };
                const Icon = meta.icon;
                const badge = ok
                  ? <span className="badge badge-ok">{isRtl ? 'معتمدة ✓' : 'Approved ✓'}</span>
                  : amber
                  ? <span className="badge badge-warn">{isRtl ? 'نسخة أحدث معتمدة' : 'Newer approved'}</span>
                  : s.openStatus === 'submitted'
                  ? <span className="badge badge-risk">{isRtl ? 'تنتظر الاعتماد' : 'Awaiting'}</span>
                  : s.openStatus === 'draft'
                  ? <span className="badge badge-risk">{isRtl ? 'مسودة' : 'Draft'}</span>
                  : <span className="badge badge-risk">{isRtl ? 'لا نسخة' : 'No version'}</span>;
                const version = s.approvedVersion !== null
                  ? `V${s.approvedVersion}`
                  : s.openVersion !== null
                  ? `V${s.openVersion}`
                  : '—';
                const detail = amber
                  ? (isRtl
                      ? `الحزمة السارية مبنية من V${s.pkgVersion ?? '—'} — اعتمد حزمة جديدة (V${s.pkgVersion ?? '—'} ← V${s.approvedVersion})`
                      : `package in force is built from V${s.pkgVersion ?? '—'} — approve a new package (V${s.pkgVersion ?? '—'} → V${s.approvedVersion})`)
                  : s.openStatus === 'submitted'
                  ? (isRtl ? `مُقدَّمة V${s.openVersion} — تنتظر قرار الاعتماد` : `V${s.openVersion} submitted — awaiting approval`)
                  : s.openStatus === 'draft'
                  ? (isRtl ? `مسودة V${s.openVersion} — تحتاج مراجعة وإرسالًا` : `Draft V${s.openVersion} — needs review`)
                  : ok
                  ? (isRtl ? 'معتمدة وتقرأ تلقائيًا في الحزمة' : 'approved — auto-read by the package')
                  : (isRtl ? 'لا توجد نسخة بعد' : 'No version yet');
                return (
                  <div
                    key={s.kind}
                    className={cn(
                      'ds-card ds-card-raised hover:bg-black/40 transition-colors',
                      amber && 'bg-chart-5/[0.06] ring-1 ring-inset ring-chart-5/25',
                    )}
                  >
                    <div className="flex justify-between items-start !mt-0">
                      <Icon className={cn('w-5 h-5', meta.color, 'opacity-60')} />
                      {badge}
                    </div>
                    <div className="mb-2">
                      <p className={cn('t-metric', ok ? 'kpi-v-ok' : amber ? 'kpi-v-warn' : 'text-(--c-destructive)')}>
                        {version}
                      </p>
                    </div>
                    <h3 className="text-(length:--t-label) uppercase tracking-wider text-muted-foreground leading-tight">
                      {isRtl ? SOURCE_LABELS[s.kind].ar : SOURCE_LABELS[s.kind].en}
                    </h3>
                    <p className="kpi-sub text-muted-foreground mt-1">{detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && !pkgOpenDraft && srcReady.ready && (
              <button onClick={buildPackage} className="btn btn-primary btn-sm">
                <Plus className="w-3 h-3" />
                {isRtl ? 'بناء الحزمة من النسخ المعتمدة' : 'Build from Approved Sources'}
              </button>
            )}
            {canEdit && pkgOpenDraft && (
              <>
                <button onClick={() => rejectPkg(pkgOpenDraft.id)} className="btn btn-secondary btn-sm">
                  <Ban className="w-3 h-3" /> {isRtl ? 'رفض' : 'Reject'}
                </button>
                <button onClick={() => approvePackage(pkgOpenDraft.id)} className="btn btn-primary btn-sm">
                  <Check className="w-3 h-3" />
                  {isRtl ? `اعتماد ${packageLabel(pkgOpenDraft)}` : `Approve ${packageLabel(pkgOpenDraft)}`}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Blocked, with the missing sources NAMED — never a bare count. */}
        {!srcReady.ready && !pkgOpenDraft && (
          <div className="ds-card border-chart-3/30 bg-chart-3/[0.05] !py-3 mt-3">
            <p className="text-(length:--t-second) text-chart-3">
              <AlertTriangle className="w-3.5 h-3.5 inline" />{' '}
              {isRtl
                ? `لا يمكن بناء الحزمة — المصادر التالية بلا نسخة معتمدة: ${srcReady.missing.map(k => SOURCE_LABELS[k].ar).join(' · ')}`
                : `Cannot build — these sources have no approved version: ${srcReady.missing.map(k => SOURCE_LABELS[k].en).join(' · ')}`}
            </p>
          </div>
        )}

        {canEdit && !pkgOpenDraft && srcReady.ready && (
          <div className="form-grid mt-3">
            <div className="field">
              <label className="field-label" data-required>{isRtl ? 'سبب الحزمة' : 'Reason'}</label>
              <input className="field-input" value={pkgForm.reason}
                     onChange={e => setPkgForm({ ...pkgForm, reason: e.target.value })}
                     placeholder={isRtl ? 'لماذا تُنشأ هذه الحزمة' : 'Why this package exists'} />
            </div>
            <div className="field">
              <label className="field-label">{isRtl ? 'تاريخ السريان' : 'Effective Date'}</label>
              <input className="field-input font-mono" type="date" dir="ltr"
                     value={pkgForm.effectiveDate}
                     onChange={e => setPkgForm({ ...pkgForm, effectiveDate: e.target.value })} />
            </div>
          </div>
        )}

        {pkgMsg && (
          <p className={cn('text-(length:--t-second) mt-3',
                           pkgMsg.bad ? 'text-chart-3' : 'text-success')}>
            {pkgMsg.text}
          </p>
        )}

        {pkgList.length > 0 && (
          <div className="ds-table-wrap mt-3">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{isRtl ? 'النسخة' : 'Version'}</th>
                  <th>{isRtl ? 'الحالة' : 'Status'}</th>
                  <th className="money">{isRtl ? 'موازنة الإنجاز' : 'BAC'}</th>
                  <th>{isRtl ? 'المصادر' : 'Sources'}</th>
                  <th>{isRtl ? 'أنشأها' : 'Created By'}</th>
                  <th>{isRtl ? 'اعتمدها' : 'Approved By'}</th>
                  <th>{isRtl ? 'تاريخ الاعتماد' : 'Approved'}</th>
                </tr>
              </thead>
              <tbody>
                {pkgList.slice().reverse().map(pk => (
                  <tr key={pk.id}>
                    <td className="col-pin font-mono text-primary">{packageLabel(pk)}</td>
                    <td>
                      <span className={cn('badge',
                        pk.status === 'approved' ? 'badge-ok'
                        : pk.status === 'rejected' ? 'badge-risk'
                        : pk.status === 'superseded' ? 'badge-neutral' : 'badge-gold')}>
                        {statusLabel(pk.status as any, isRtl ? 'ar' : 'en')}
                      </span>
                    </td>
                    <td className="money" title={exactMoney(pk.data.totalBudget, ccy)}>
                      {abbrevMoney(pk.data.totalBudget)}
                    </td>
                    <td className="text-(length:--t-second) text-muted font-mono">
                      {describeRefs(pk.data.sourceRefs, isRtl)}
                    </td>
                    <td className="text-muted-foreground">{pk.createdBy || '—'}</td>
                    <td className="text-muted-foreground">{pk.approvedBy || '—'}</td>
                    <td className="text-muted-foreground font-mono">
                      {formatDateOrDash(pk.approvedAt.slice(0, 10), isRtl ? 'ar' : 'en')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Full register — read-only history of every filed baseline.
          The family editing section was removed by request: baselines
          now enter exclusively through approved sources + the Package. */}
      {rows.length > 0 && (
        <>
          <div className="sec-head">{isRtl ? 'سجل خطوط الأساس' : 'Baseline Register'}</div>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{isRtl ? 'النوع' : 'Type'}</th>
                  <th>{isRtl ? 'النسخة' : 'Version'}</th>
                  <th className="money">{isRtl ? 'القيمة الرئيسية' : 'Headline'}</th>
                  <th>{isRtl ? 'تاريخ الإنشاء' : 'Created'}</th>
                  <th>{isRtl ? 'أنشأها' : 'Created By'}</th>
                  <th>{isRtl ? 'المُسبِّب' : 'Cause'}</th>
                  <th>{isRtl ? 'السبب' : 'Reason'}</th>
                  <th>{isRtl ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="col-pin">{r.typeLabel}</td>
                    <td className="font-mono text-primary">V{r.version}</td>
                    <td className="money" title={exactMoney(r.headline, ccy)}>
                      {r.headline === null ? '—' : abbrevMoney(r.headline)}
                    </td>
                    <td className="text-muted-foreground font-mono whitespace-nowrap">
                      {formatDateOrDash(r.createdAt.slice(0, 10), isRtl ? 'ar' : 'en')}
                    </td>
                    <td className="text-muted-foreground">{r.createdBy || '—'}</td>
                    <td className="text-muted-foreground">{causeLabel(r.cause, isRtl ? 'ar' : 'en')}</td>
                    <td className="text-white">{r.reason || '—'}</td>
                    <td>
                      <span className={cn('badge',
                        r.status === 'active' ? 'badge-ok'
                        : r.status === 'draft' ? 'badge-gold'
                        : r.status === 'rejected' ? 'badge-risk' : 'badge-neutral')}>
                        {statusLabel(r.status, isRtl ? 'ar' : 'en')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-(length:--t-second) text-muted-foreground italic">
        {isRtl
          ? 'خط الأساس المعتمد لا يُعدَّل أبداً. تغيير الخطة يتم بإصدار النسخة التالية، وتُحال السابقة إلى «مُستبدَل» وتبقى محفوظة. لقطات الخط الزمني تشير إلى رقم النسخة السارية وقت الاعتماد، ولا تنسخ محتواها.'
          : 'An adopted baseline is never edited. Changing the plan means issuing the next version; the previous one is retired to superseded and kept. Timeline snapshots reference the version in force at approval — they do not copy its contents.'}
      </p>
    </div>
  );
}
