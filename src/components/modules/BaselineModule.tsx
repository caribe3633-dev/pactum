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
  draftPackage as pkgDraft, packageLabel, evaluatePackageGate,
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
   * version exists yet. This replaces the two static text lines.
   */
  const sourceCards = useMemo(() => {
    const sv = readSourceVersions(project.id);
    return SOURCE_KINDS.map(kind => {
      const approved = approvedOf(sv, kind);
      const open = openOf(sv, kind);
      return {
        kind,
        approvedVersion: approved ? approved.version : null,
        openVersion: open ? open.version : null,
        openStatus: open ? open.status : null,
      };
    });
  }, [project.id, pkgTick, store]);

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
            {/* ── Source approval cards (auto-read) — replaced the old
                "Built from" / "Latest approved" text lines. Green means
                approved with nothing pending; red means action needed. */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5 mt-3">
              {sourceCards.map(s => {
                const ok = !s.openVersion && s.approvedVersion !== null;
                const tone = ok ? 'text-success' : 'text-chart-3';
                return (
                  <div
                    key={s.kind}
                    className={cn(
                      'px-3 py-2.5',
                      ok
                        ? 'bg-success/[0.06] ring-1 ring-inset ring-success/20'
                        : 'bg-chart-3/[0.06] ring-1 ring-inset ring-chart-3/20',
                    )}
                  >
                    <div className={cn('lbl mb-1 flex items-center gap-1.5', tone)}>
                      <span className={cn('w-1.5 h-1.5 rounded-full inline-block', ok ? 'bg-success' : 'bg-chart-3')} />
                      {isRtl ? SOURCE_LABELS[s.kind].ar : SOURCE_LABELS[s.kind].en}
                    </div>
                    <div className={cn('val font-mono', tone)}>
                      {s.approvedVersion !== null
                        ? `V${s.approvedVersion}`
                        : s.openVersion !== null
                        ? `V${s.openVersion}`
                        : '—'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {s.openStatus === 'submitted'
                        ? (isRtl ? `مُقدَّمة V${s.openVersion} — تنتظر الاعتماد` : `V${s.openVersion} submitted — awaiting approval`)
                        : s.openStatus === 'draft'
                        ? (isRtl ? `مسودة V${s.openVersion} — تحتاج مراجعة وإرسالًا` : `Draft V${s.openVersion} — needs review`)
                        : ok
                        ? (isRtl ? 'معتمدة ✓' : 'Approved ✓')
                        : (isRtl ? 'لا توجد نسخة بعد' : 'No version yet')}
                    </div>
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

      {/* ── Family selector — replaced the old coverage card strip (the
          "cards that don't read"). The contract family is GONE: the
          contract is versioned as a source and lives in the Contract tab. */}
      <div className="flex items-center gap-2 flex-wrap">
        {BASELINE_TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => setActiveType(t.value)}
            className={cn(
              'btn btn-sm',
              activeType === t.value ? 'btn-primary' : 'btn-secondary',
            )}
          >
            {isRtl ? t.ar : t.en}
          </button>
        ))}
      </div>

      {/* ── BASELINE UPDATE REQUIRED ────────────────────────────────────
          A governance state, not an error and not a blocker. The project
          stays fully operational: the current baseline remains
          authoritative, BAC and PV are untouched, and this banner exists
          purely to say the approved plan no longer matches the approved
          scope — and what to do about it. */}
      {updateState.required && (
        <div className="ds-card border-chart-5/40 bg-chart-5/[0.06]">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-chart-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-(length:--t-label) uppercase tracking-wider text-chart-5 mb-1">
                {isRtl ? 'مطلوب تحديث خط الأساس' : 'Baseline Update Required'}
              </h4>
              <p className="text-(length:--t-body) text-white/70 max-w-[95ch] leading-relaxed">
                {isRtl ? updateState.messageAr : updateState.message}
              </p>

              {/* Each affected item named with its own figures — a total
                  alone is not actionable, and the direct/indirect split
                  is what tells a reader how much of this will reach BAC. */}
              <div className="ds-table-wrap mt-3">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="text-start">{isRtl ? 'المرجع' : 'Ref'}</th>
                      <th className="text-start">{isRtl ? 'النوع' : 'Type'}</th>
                      <th className="money">{isRtl ? 'مباشرة' : 'Direct'}</th>
                      <th className="money">{isRtl ? 'غير مباشرة' : 'Indirect'}</th>
                      <th className="money">{isRtl ? 'الإجمالي' : 'Total'}</th>
                      <th className="text-start">{isRtl ? 'اعتُمدت التكلفة' : 'Cost approved'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {updateState.triggers.map(tr => (
                      <tr key={tr.kind + tr.ref}>
                        <td className="font-mono text-primary">{tr.ref}</td>
                        <td className="text-muted-foreground">
                          {tr.kind === 'change-order'
                            ? (isRtl ? 'أمر تغيير' : 'Change Order')
                            : (isRtl ? 'مطالبة' : 'Claim')}
                        </td>
                        <td className="money">{exactMoney(tr.directImpact, ccy)}</td>
                        <td className="money text-muted-foreground">{exactMoney(tr.indirectImpact, ccy)}</td>
                        <td className="money">{exactMoney(tr.totalImpact, ccy)}</td>
                        <td className="text-muted-foreground">
                          {tr.costApprovedBy || '—'}
                          {tr.costApprovedAt
                            ? ` · ${formatDateOrDash(tr.costApprovedAt.slice(0, 10), isRtl ? 'ar' : 'en')}`
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Stating what has NOT happened is the whole governance
                  promise. Without it a reader assumes the figures above
                  are already in the plan. */}
              <p className="text-(length:--t-second) text-muted-foreground mt-2">
                {isRtl
                  ? `خط الأساس V${updateState.currentBaselineVersion} لا يزال السارِي. لم تتغير BAC ولا PV، ولن تتغير إلا عند اعتماد النسخة التالية. أثر BAC المنتظر ${exactMoney(updateState.pendingDirectImpact, ccy)} (مباشرة فقط).`
                  : `Baseline V${updateState.currentBaselineVersion} remains in force. BAC and PV are unchanged and will not move until the next version is approved. Pending BAC impact ${exactMoney(updateState.pendingDirectImpact, ccy)} (direct only).`}
              </p>
            </div>
          </div>
        </div>
      )}

      {!coverage.complete && (
        <p className="text-(length:--t-second) text-muted-foreground italic">
          <AlertTriangle className="w-3 h-3 inline-block me-1.5 text-chart-5" />
          {isRtl ? 'أنواع بلا خط أساس سارٍ' : 'Families with no baseline in force'}
          {': '}
          <span className="font-mono">
            {coverage.missing.map(t => labelOf(t, isRtl ? 'ar' : 'en')).join(' · ')}
          </span>
        </p>
      )}

      {/* ── Selected family ── */}
      <div className="ds-card ds-card-raised">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="sec-head !mb-1">
              <Layers className="w-4 h-4 inline-block me-2 text-primary/70" />
              {labelOf(activeType, isRtl ? 'ar' : 'en')}
            </h3>
            <p className="text-(length:--t-second) text-muted-foreground">
              {current
                ? <>
                    {isRtl ? 'السارٍ' : 'In force'}{': '}
                    <span className="font-mono text-primary">{current.name}</span>
                    {' · '}
                    {isRtl ? 'اعتُمد' : 'adopted'}{' '}
                    <span className="font-mono">
                      {formatDateOrDash(current.activatedAt.slice(0, 10), isRtl ? 'ar' : 'en')}
                    </span>
                    {' · '}{current.createdBy}
                  </>
                : (isRtl ? 'لم يُعتمد أي خط أساس لهذا النوع بعد' : 'No baseline adopted for this family yet')}
            </p>
            {/* Where this family IS adopted now, said plainly rather than
                leaving the user hunting for a button that moved. */}
            {activeType !== 'contract' && (
              <p className="text-(length:--t-second) text-muted mt-1">
                {activeType === 'budget' || activeType === 'cashflow'
                  ? (isRtl
                      ? 'يُعتمد هذا المصدر الآن من لوحة نسخ المصادر أعلاه، ثم يدخل خط الأساس عبر الحزمة أدناه.'
                      : 'This source is now approved in the Source Versions panel above, then enters the baseline through the Package below.')
                  : (isRtl
                      ? 'هذه العائلة للقراءة والتاريخ فقط. السجلات المعتمدة سابقاً كما هي ولم تتغيّر.'
                      : 'This family is read-only history. Previously adopted records are untouched.')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ReportButton reportId="baseline-register" context={reportCtx} />
            {/*
              ══════════════════════════════════════════════════════════
              ONLY THE CONTRACT FAMILY IS STILL ADOPTED HERE.

              Budget, Cash Flow, Schedule and Forecast used to each get
              their own "create version / adopt" button on this screen.
              That is now the SOURCE VERSIONS panel's job for budget and
              cash flow, and the BASELINE PACKAGE below is what actually
              feeds BAC. Three competing ways to approve the same plan is
              how two of them end up disagreeing.

              The contract baseline stays: it records the contractual
              position — value, dates, LD rate — which no source version
              covers and which the package does not carry either.

              The other four families remain fully READABLE. Their filed
              history is untouched; this screen simply stops minting new
              ones. Never rewrite an approved historical record.
              ══════════════════════════════════════════════════════════
            */}
            {canEdit && activeType === 'contract' && (
              <button onClick={() => { setCreating(v => !v); setErr(''); }} className="btn btn-primary btn-sm">
                <Plus className="w-3 h-3" />
                {isRtl ? `إنشاء النسخة V${nextVersion(store, activeType)}` : `Create V${nextVersion(store, activeType)}`}
              </button>
            )}
          </div>
        </div>

        {creating && canEdit && (
          <>
            {/* Preview: exactly what will be frozen, before anything is written. */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-px bg-white/5 mt-4">
              {Object.entries(preview)
                .filter(([, v]) => !Array.isArray(v))
                .map(([k, v]) => (
                  <div key={k} className="bg-black/30 px-4 py-3">
                    {/* Was `{k}` — the raw object key, which rendered as
                        ORIGINALCONTRACT / APPROVEDCHANGEORDERS on screen.
                        FIELD_LABELS already held the correct wording. */}
                    <div className="lbl mb-1.5">{fieldLabel(k, isRtl ? 'ar' : 'en')}</div>
                    <div className="val" title={typeof v === 'number' ? exactMoney(v, ccy) : undefined}>
                      {typeof v === 'number'
                        ? (Math.abs(v) >= 1000 ? abbrevMoney(v) : String(v))
                        : (v === '' || v === null ? '—' : String(v))}
                    </div>
                  </div>
                ))}
            </div>

            <div className="form-grid mt-4">
              <div className="field xl:col-span-2">
                <label className="field-label">
                  {isRtl ? 'سبب خط الأساس' : 'Baseline Reason'}
                  <span className="text-chart-3 ms-1">*</span>
                </label>
                <input className="field-input" value={reason} onChange={e => setReason(e.target.value)}
                       placeholder={isRtl ? 'مثال: اعتماد أمر التغيير رقم 7 بقيمة 4.2 مليون'
                                          : 'e.g. Approval of Change Order 7, value 4.2M'} />
              </div>
              <div className="field">
                <label className="field-label">{isRtl ? 'المُسبِّب' : 'Cause'}</label>
                <select className="field-input" value={cause} onChange={e => setCause(e.target.value as BaselineCause)}>
                  {BASELINE_CAUSES.map(c => (
                    <option key={c.value} value={c.value}>{isRtl ? c.ar : c.en}</option>
                  ))}
                </select>
              </div>
              <div className="field xl:col-span-2">
                <label className="field-label">{isRtl ? 'ملاحظات' : 'Notes'}</label>
                <input className="field-input" value={notes} onChange={e => setNotes(e.target.value)}
                       placeholder={isRtl ? 'مرجع المحضر أو الخطاب' : 'Minute or letter reference'} />
              </div>
              <div className="field">
                <label className="field-label">{isRtl ? 'الحالة عند الإنشاء' : 'Status on creation'}</label>
                <select className="field-input" value={asDraft ? 'draft' : 'active'}
                        onChange={e => setAsDraft(e.target.value === 'draft')}>
                  <option value="active">{isRtl ? 'اعتماد فوري' : 'Adopt immediately'}</option>
                  <option value="draft">{isRtl ? 'حفظ كمسودة' : 'Save as draft'}</option>
                </select>
              </div>
            </div>

            {err && <p className="field-error mt-2">{err}</p>}

            <div className="form-actions mt-3">
              <button onClick={() => setCreating(false)} className="btn btn-ghost btn-sm">
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button onClick={submit} className="btn btn-primary btn-sm">
                <Lock className="w-3 h-3" />
                {asDraft
                  ? (isRtl ? 'حفظ المسودة' : 'Save Draft')
                  : (isRtl ? 'تجميد واعتماد' : 'Freeze & Adopt')}
              </button>
            </div>

            <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
              {isRtl
                ? 'الاعتماد يُحيل النسخة السارية الحالية إلى «مُستبدَل». تبقى محفوظة ومقروءة — الخطة المسحوبة جزء من سجل التدقيق.'
                : 'Adopting retires the version currently in force to “superseded”. It is kept and stays readable — a withdrawn plan is part of the audit trail.'}
            </p>
          </>
        )}

        {openDraft && canEdit && (
          <div className="mt-4 border border-primary/25 bg-primary/[0.04] px-4 py-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <span className="badge badge-gold">{isRtl ? 'مسودة' : 'Draft'}</span>
                <span className="ms-3 font-mono text-primary">{openDraft.name}</span>
                <span className="ms-3 text-(length:--t-second) text-muted-foreground">{openDraft.reason}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => persist(rejectDraft(project.id, openDraft.id, user?.username ?? 'unknown').store)}
                  className="btn btn-ghost btn-sm">
                  <Ban className="w-3 h-3" />
                  {isRtl ? 'رفض' : 'Reject'}
                </button>
                <button
                  onClick={() => persist(activateBaseline(project.id, openDraft.id, user?.username ?? 'unknown').store)}
                  className="btn btn-primary btn-sm">
                  <Check className="w-3 h-3" />
                  {isRtl ? 'اعتماد' : 'Adopt'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Version history of the selected family ── */}
      {history.length > 0 && (
        <div className="ds-card ds-card-tight !p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
            <span className="lbl">
              <History className="w-3 h-3 inline-block me-1.5" />
              {isRtl ? 'تاريخ النسخ' : 'Version History'}
            </span>
            <span className="text-(length:--t-micro) text-muted-foreground font-mono">
              {history.length} {isRtl ? 'نسخة' : history.length === 1 ? 'version' : 'versions'}
            </span>
          </div>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{isRtl ? 'النسخة' : 'Version'}</th>
                  <th className="money">{isRtl ? HEADLINE[activeType].ar : HEADLINE[activeType].en}</th>
                  <th className="money">{isRtl ? 'الحركة' : 'Movement'}</th>
                  <th>{isRtl ? 'تاريخ البيانات' : 'Data Date'}</th>
                  <th>{isRtl ? 'المُسبِّب' : 'Cause'}</th>
                  <th>{isRtl ? 'السبب' : 'Reason'}</th>
                  <th>{isRtl ? 'أنشأها' : 'Created By'}</th>
                  <th>{isRtl ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b, i) => {
                  const d = drift[i];
                  const money = HEADLINE[activeType].money;
                  return (
                    <tr key={b.id} className={cn(b.status === 'active' && 'bg-primary/[0.04]')}>
                      <td className="col-pin font-mono text-primary">{b.name}</td>
                      <td className="money" title={money ? exactMoney(d?.value, ccy) : undefined}>
                        {d?.value === null || d?.value === undefined
                          ? '—'
                          : money ? abbrevMoney(d.value) : `${d.value}d`}
                      </td>
                      <td className={cn('money font-mono', Tone(d?.delta ?? null))}>
                        {d?.delta === null || d?.delta === undefined || d.delta === 0
                          ? '—'
                          : `${d.delta > 0 ? '+' : ''}${money ? abbrevMoney(d.delta) : `${d.delta}d`}`}
                      </td>
                      <td className="text-muted-foreground font-mono whitespace-nowrap">
                        {formatDateOrDash(b.dataDate, isRtl ? 'ar' : 'en')}
                      </td>
                      <td className="text-muted-foreground">{causeLabel(b.cause, isRtl ? 'ar' : 'en')}</td>
                      <td className="text-white">{b.reason || '—'}</td>
                      <td className="text-muted-foreground">{b.createdBy || '—'}</td>
                      <td>
                        <span className={cn('badge',
                          b.status === 'active' ? 'badge-ok'
                          : b.status === 'draft' ? 'badge-gold'
                          : b.status === 'rejected' ? 'badge-risk' : 'badge-neutral')}>
                          {statusLabel(b.status, isRtl ? 'ar' : 'en')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {current && canEdit && (
            <div className="flex justify-end px-4 py-2 border-t border-white/5">
              <button
                onClick={() => persist(supersedeBaseline(project.id, current.id, user?.username ?? 'unknown').store)}
                className="inline-flex items-center gap-1 text-(length:--t-second) uppercase tracking-widest text-muted-foreground border border-white/10 px-3 py-1.5 hover:text-chart-5 hover:border-chart-5/40 transition-colors"
                title={isRtl ? 'يبقى السجل محفوظاً' : 'The record is kept'}
              >
                <Ban className="w-3 h-3" />
                {isRtl ? 'سحب السارٍ بلا بديل' : 'Withdraw active (no replacement)'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Comparison ── */}
      {history.length >= 2 && (
        <div className="ds-card">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <h3 className="sec-head !mb-0">
              <GitCompare className="w-4 h-4 inline-block me-2 text-primary/70" />
              {isRtl ? 'مقارنة النسخ' : 'Compare Baselines'}
            </h3>
          </div>

          <div className="form-grid mt-3">
            <div className="field">
              <label className="field-label">{isRtl ? 'من' : 'From'}</label>
              <select className="field-input" value={cmpFrom} onChange={e => setCmpFrom(e.target.value)}>
                {history.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">{isRtl ? 'إلى' : 'To'}</label>
              <select className="field-input" value={cmpTo} onChange={e => setCmpTo(e.target.value)}>
                {history.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          {comparison.ok && (
            <>
              <p className="text-(length:--t-second) text-muted-foreground mt-2">
                {comparison.changedCount === 0
                  ? (isRtl ? 'لا فرق بين النسختين في أي حقل.' : 'No field differs between these versions.')
                  : <>
                      <span className="text-white font-mono">{comparison.changedCount}</span>{' '}
                      {isRtl ? 'حقل تغيّر' : comparison.changedCount === 1 ? 'field changed' : 'fields changed'}
                      {comparison.daysBetween !== null && <>
                        {' · '}
                        <span className="font-mono">{comparison.daysBetween}d</span>{' '}
                        {isRtl ? 'بين تاريخي البيانات' : 'between data dates'}
                      </>}
                    </>}
              </p>

              <div className="ds-table-wrap mt-3">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="col-pin">{isRtl ? 'الحقل' : 'Field'}</th>
                      <th className="money">{comparison.from?.name}</th>
                      <th className="money">{comparison.to?.name}</th>
                      <th className="money">{isRtl ? 'الفرق' : 'Delta'}</th>
                      <th className="money">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map(r => (
                      <tr key={r.key} className={cn(r.changed && 'bg-primary/[0.03]')}>
                        <td className="col-pin">{isRtl ? r.labelAr : r.label}</td>
                        <td className="money text-muted-foreground"
                            title={r.kind === 'money' ? exactMoney(r.from, ccy) : undefined}>
                          {fmt(r.kind, r.from)}
                        </td>
                        <td className={cn('money', r.changed ? 'text-white' : 'text-muted-foreground')}
                            title={r.kind === 'money' ? exactMoney(r.to, ccy) : undefined}>
                          {fmt(r.kind, r.to)}
                        </td>
                        <td className={cn('money font-mono', Tone(r.delta))}>
                          {r.delta === null || r.delta === 0
                            ? '—'
                            : `${r.delta > 0 ? '+' : ''}${r.kind === 'money' ? abbrevMoney(r.delta) : r.kind === 'days' ? `${r.delta}d` : r.delta}`}
                        </td>
                        <td className={cn('money font-mono', Tone(r.pctDelta))}>
                          {r.pctDelta === null || r.pctDelta === 0
                            ? '—'
                            : `${r.pctDelta > 0 ? '+' : ''}${(r.pctDelta * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detail.length > 0 && (
                <>
                  <div className="sec-head !mb-2 mt-6">
                    {activeType === 'budget'
                      ? (isRtl ? 'الحركة على مستوى البند' : 'Movement by Category')
                      : (isRtl ? 'الحركة على مستوى الفترة' : 'Movement by Period')}
                  </div>
                  <div className="ds-table-wrap">
                    <table className="ds-table">
                      <thead>
                        <tr>
                          <th className="col-pin">
                            {activeType === 'budget' ? (isRtl ? 'البند' : 'Category') : (isRtl ? 'الفترة' : 'Period')}
                          </th>
                          <th className="money">{comparison.from?.name}</th>
                          <th className="money">{comparison.to?.name}</th>
                          <th className="money">{isRtl ? 'الفرق' : 'Delta'}</th>
                          <th>{isRtl ? 'الحالة' : 'Status'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.map(d => (
                          <tr key={d.key} className={cn(d.status !== 'unchanged' && 'bg-primary/[0.03]')}>
                            <td className="col-pin">{d.key || '—'}</td>
                            <td className="money text-muted-foreground" title={exactMoney(d.from, ccy)}>
                              {d.from === null ? '—' : abbrevMoney(d.from)}
                            </td>
                            <td className="money text-white" title={exactMoney(d.to, ccy)}>
                              {d.to === null ? '—' : abbrevMoney(d.to)}
                            </td>
                            <td className={cn('money font-mono', Tone(d.delta))}>
                              {d.delta === null || d.delta === 0 ? '—' : `${d.delta > 0 ? '+' : ''}${abbrevMoney(d.delta)}`}
                            </td>
                            <td>
                              <span className={cn('badge',
                                d.status === 'added' ? 'badge-ok'
                                : d.status === 'removed' ? 'badge-risk'
                                : d.status === 'changed' ? 'badge-warn' : 'badge-neutral')}>
                                {d.status === 'added' ? (isRtl ? 'مضاف' : 'Added')
                                 : d.status === 'removed' ? (isRtl ? 'محذوف' : 'Removed')
                                 : d.status === 'changed' ? (isRtl ? 'متغيّر' : 'Changed')
                                 : (isRtl ? 'بلا تغيير' : 'Unchanged')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
                    {isRtl
                      ? 'بند موجود في نسخة وغائب عن الأخرى يُعرض «مضاف» أو «محذوف» لا كحركة من صفر — بند لم يكن موجوداً وبند بموازنة صفر واقعتان مختلفتان.'
                      : 'A line present in one version and absent from the other is reported as added or removed, not as a movement from zero — a package that did not exist and a package budgeted at nothing are different facts.'}
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Full register across all five families ── */}
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
