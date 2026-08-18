import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Project } from '../../lib/data';
import { useTranslation } from '../../lib/i18n';
import { formatMoney, cn } from '../../lib/utils';
import { formatDateOrDash } from '../../lib/dateFormat';
import { useAuth } from '../../lib/store';
import { fetchSectors } from '../../mock/sectors';
import { abbrevMoney, exactMoney } from '../../lib/moneyFormat';
import ReportButton from '../reporting/ReportButton';
import {
  Archive, Check, Lock, AlertTriangle, ChevronRight, Info, Ban,
} from 'lucide-react';

// Existing engines — READ ONLY. Timeline receives their outputs and never
// recomputes them. Not one of these is modified by this module.
import { computeLd, computeApprovedEOT, computeProgramme, computeNetCostImpact, sumCostImpact } from '../../lib/delayCalculations';
import { readSyncedEvm, snapshot as evmSnapshot, EAC_META } from '../../lib/evm';
import {
  readCurrencySettings, readFx, fxSnapshotAt, rateOn,
  appliedRatesFrom, mergeAppliedRates,
} from '../../lib/currency';
// Phase 8 — the project's own contract currency, frozen with the period.
import { contractCurrencyOf } from '../../lib/projectCurrency';
import {
  readTimeline, appendSnapshot, supersedeSnapshot, approvedSnapshots,
  latestSnapshot, snapshotFor, isPeriodApproved, seriesOf, deltaBetween,
  collectClaims, collectCash, collectSubcontracts, collectDelayCounts,
  collectBudget, collectCertificates,
  defaultExchange, setReportingCurrency,
  trendRows, forecastComparison, executiveSummary, coverageOf, baselineTrail,
  appliedRateRows, reportingCurrencyTrail, hasMixedReportingCurrency, fxMovement,
  TimelineStore, TimelineSnapshot,
} from '../../lib/timeline';
// Phase 4 — Timeline REFERENCES the active baselines. It reads identity only
// and never the payload: the register holds one copy of the plan, and a
// snapshot points at it rather than duplicating it.
import { activeBaselineRefs } from '../../lib/baselines';
// Task 5 — authoritative company link; the projectIds cache can be stale.
import { companyIdOfProject } from '../../lib/projectMaster';

/**
 * Timeline — the official historical record.
 * Destination: src/components/modules/TimelineModule.tsx
 *
 * PHASE 1: aggregation only.
 *
 * This screen approves a reporting period and files one immutable snapshot.
 * Every figure it files was produced by the module that owns it; this file
 * performs no business calculation of its own. The live dashboards are
 * untouched and remain the source of truth for current figures.
 */


/** Month id for a date: `2026-08`. Matches the Delay window convention. */
function periodIdFor(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                   'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

function periodLabel(id: string, ar: boolean): string {
  const [y, m] = id.split('-').map(Number);
  if (!y || !m) return id;
  return `${(ar ? MONTHS_AR : MONTHS_EN)[m - 1]} ${y}`;
}

/** Last calendar day of the month — the data date for a month-end close. */
function lastDayOf(id: string): string {
  const [y, m] = id.split('-').map(Number);
  if (!y || !m) return '';
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

export default function TimelineModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  const { lang } = useTranslation();
  const { user } = useAuth();
  const isRtl = lang === 'ar';

  const [store, setStore] = useState<TimelineStore>(() => readTimeline(project.id));

  /**
   * The company that owns this project — FX rates are company-scoped.
   * Same derivation SubsModule uses, so both read the identical book.
   */
  const companyId = useMemo(
    () => companyIdOfProject(project as any, fetchSectors()),
    [project.id],
  );

  const fxSettings = useMemo(() => readCurrencySettings(companyId), [companyId]);
  const fxStore = useMemo(() => readFx(companyId), [companyId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [rate, setRate] = useState('1');
  /**
   * THE BASE CURRENCY OF AN APPROVED SNAPSHOT — DERIVED, NEVER TYPED.
   *
   * ══════════════════════════════════════════════════════════════════
   * This was `useState('SAR')` and nothing ever updated it, yet its
   * value is written into `exchange.baseCurrency` on a FILED, APPROVED
   * period snapshot. So an AED project closing its month recorded
   * "SAR" unless somebody happened to change a dropdown by hand — and
   * the same object simultaneously stored the real reporting currency
   * in `exchange.reportingCurrency`, leaving one record stating two
   * different units.
   *
   * A snapshot is a historical financial record. Its unit is a FACT
   * about the project, not a preference, so it is derived from the
   * project's contract currency and the picker is gone.
   * ══════════════════════════════════════════════════════════════════
   */
  const baseCcy = useMemo(
    () => contractCurrencyOf(project.id, fxSettings.baseCurrency),
    [project.id, fxSettings.baseCurrency],
  );

  useEffect(() => {
    setStore(readTimeline(project.id));
    setSelected(null);
  }, [project.id]);

  const today = new Date();
  const currentPeriod = periodIdFor(today);
  const alreadyApproved = isPeriodApproved(store, currentPeriod);

  // ── Live position, assembled from the OWNING modules ──
  //
  // Each engine is called exactly as the dashboards call it. Nothing here
  // reimplements a formula; the values are the same objects the Delay, LD
  // and EVM screens are rendering right now.
  const live = useMemo(() => {
    const delays: any[] = (() => {
      try { return JSON.parse(localStorage.getItem(`pactum-delays-${project.id}`) || '[]'); }
      catch { return []; }
    })();
    const claimsRows: any[] = (() => {
      try { return JSON.parse(localStorage.getItem(`pactum-claims-${project.id}`) || '[]'); }
      catch { return []; }
    })();

    // Delay + LD, from lib/delayCalculations — unchanged engine.
    const eot = computeApprovedEOT(project.id);
    const ld = computeLd(project, eot);
    const programme = computeProgramme(project, ld.totalApprovedEOT, ld.totalDelay);
    const counts = collectDelayCounts(project.id);
    const netCost = computeNetCostImpact(counts.approvedCostImpact, ld.ldExposure);

    // EVM, from lib/evm — unchanged engine.
    const evmStore = readSyncedEvm(project);
    const evm = evmSnapshot(project, evmStore);

    // Applied rates, harvested from every register that stores money. Each
    // row already carries the rate it was converted at; nothing is looked up
    // and nothing is recomputed.
    const readRows = (key: string): any[] => {
      try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }
      catch { return []; }
    };
    const base = fxSettings.baseCurrency;
    const appliedRates = mergeAppliedRates(
      appliedRatesFrom(readRows(`pactum-co-${project.id}`), 'value', base),
      appliedRatesFrom(claimsRows, 'claimed', base),
      appliedRatesFrom(readRows(`pactum-certs-${project.id}`), 'gross', base),
      appliedRatesFrom(readRows(`pactum-budget-${project.id}`), 'planned', base),
      appliedRatesFrom(readRows(`pactum-subs-${project.id}`), 'contractValue', base),
    );

    return {
      ld, programme, counts, netCost, evm, evmStore, appliedRates,
      contractCurrency: contractCurrencyOf(project.id, base),
      claims: collectClaims(project.id),
      cash: collectCash(project.id),
      subs: collectSubcontracts(project.id),
      budget: collectBudget(project.id),
      certs: collectCertificates(project.id),
    };
  }, [project, store, fxSettings.baseCurrency]);

  const persist = useCallback((next: TimelineStore) => setStore(next), []);

  /** Files the current period. Every value is copied, none is derived here. */
  const approvePeriod = () => {
    const { ld, programme, counts, netCost, evm } = live;
    const res = appendSnapshot(project.id, {
      periodId: currentPeriod,
      periodLabel: periodLabel(currentPeriod, isRtl),
      dataDate: lastDayOf(currentPeriod),
      approvedBy: user?.username ?? 'unknown',
      note: note.trim(),

      contract: {
        commencementDate: programme.commencementDate,
        plannedDurationDays: programme.plannedDurationDays,
        baselineFinish: programme.baselineFinish,
        approvedFinish: programme.approvedFinish,
        forecastFinish: programme.forecastFinish,
        baselineId: evm.baseline?.id ?? '',
        baselineName: evm.baseline?.name ?? '',
        baselineVersion: evm.baseline?.version ?? 0,
      },
      exchange: {
        ...defaultExchange(fxSettings.baseCurrency, lastDayOf(currentPeriod)),
        baseCurrency: baseCcy,
        rate: Number(rate) || 1,
        reportingCurrency: fxSettings.baseCurrency,
        // The ENTIRE FX environment of this month, frozen — reconstructed as
        // it was KNOWN on the approval date, so a correction approved later
        // cannot retroactively alter what this period could have used.
        rates: fxSnapshotAt(
          fxStore, fxSettings.baseCurrency, lastDayOf(currentPeriod), project.id,
          new Date().toISOString().slice(0, 10),
        ),
        // What the period actually APPLIED, harvested from the converted
        // records themselves. The table above says what was available; this
        // says what was used, and only the second proves a reported total.
        appliedRates: live.appliedRates,
        ratesKnownAsOf: new Date().toISOString().slice(0, 10),
        // ── Phase 8 ──
        // The contract currency is a separate fact from the reporting
        // currency. A project contracted in EUR reporting into SAR has
        // both, and a period that records only the second cannot later
        // say what the contract was denominated in.
        contractCurrency: live.contractCurrency,
        // The six mandated fields, aggregated per original currency and
        // frozen. Derived from the applied-rate ledger already harvested
        // from the converted records — nothing is looked up here.
        conversions: live.appliedRates.map(a => ({
          originalCurrency: a.currency,
          originalAmount: a.originalTotal,
          exchangeRateSnapshot: a.rate,
          exchangeRateEffectiveDate: '',
          reportingCurrencyValue: a.convertedTotal,
          displayedReportingCurrency: fxSettings.baseCurrency,
          recordCount: a.count,
        })),
      },
      delay: {
        totalDelay: ld.totalDelay,
        approvedEOT: ld.totalApprovedEOT,
        unmitigated: ld.totalDelay - ld.totalApprovedEOT,
        culpableDelay: ld.culpableDelay,
        ...counts,
      },
      ld: {
        ratePerDay: ld.ldRatePerDay,
        capAmount: ld.ldCapAmount,
        grossExposure: ld.grossExposure,
        exposure: ld.ldExposure,
        capReached: ld.capReached,
        netCostImpact: netCost,
      },
      commercial: {
        originalContract: project.contractValue,
        approvedChangeOrders: project.totalApprovedCOs ?? 0,
        pendingChangeOrders: 0,
        approvedClaims: project.totalApprovedClaims ?? 0,
        currentContract: project.revisedContractValue ?? project.contractValue,
        certified: live.subs.totalCertified,
        paid: live.subs.totalPaid,
        outstanding: live.subs.totalOutstanding,
        retentionHeld: 0,
      },
      cash: live.cash,
      claims: live.claims,
      subcontracts: live.subs,
      evm: {
        bac: evm.bac, pv: evm.m.pv, ev: evm.m.ev, ac: evm.m.ac,
        spi: evm.m.spi, cpi: evm.m.cpi, sv: evm.m.sv, cv: evm.m.cv,
        eac: evm.m.eac, etc: evm.m.etc, vac: evm.m.vac, tcpi: evm.m.tcpi,
        eacMethod: EAC_META[live.evmStore.settings.eacMethod].label,
        periodLabel: evm.period?.label ?? '',
      },
      kpi: {
        progressPct: project.progress,
        health: isRtl ? evm.health.ar : evm.health.en,
        overallScore: evm.score,
      },
      // ── Sections added in Phase 3B ──
      budget: live.budget,
      certificates: live.certs,
      forecast: {
        // Recorded separately from the EVM block: that says what was
        // measured, this says what was expected. A later change to how a
        // forecast is produced must not rewrite what this period predicted.
        method: EAC_META[live.evmStore.settings.eacMethod].label,
        eac: evm.m.eac,
        etc: evm.m.etc,
        vac: evm.m.vac,
        forecastFinish: evm.dates.forecastFinish,
        slipDays: evm.dates.slipDays,
        basisPeriods: evm.cum.count,
        cpiCum: evm.cum.cpiCum,
        spiCum: evm.cum.spiCum,
      },
      projectStatus: {
        health: isRtl ? evm.health.ar : evm.health.en,
        // The classifier's own reasons, so the verdict stays auditable.
        reasons: isRtl ? evm.health.reasonsAr : evm.health.reasons,
        progressPct: project.progress,
        quadrant: isRtl ? evm.quadrant.ar : evm.quadrant.en,
        contractValue: project.contractValue,
        revisedContractValue: project.revisedContractValue ?? project.contractValue,
      },
      // ── Phase 4 ──
      // Identity of the five plans in force, so a later reader can tell
      // whether a movement in variance was performance or a re-baseline.
      // Absent when the project has no baselines — behaviour is unchanged.
      baselines: activeBaselineRefs(project.id),
    });

    if (res.ok) {
      persist(res.store);
      setNote('');
      setConfirming(false);
      setSelected(res.snapshot!.periodId);
    }
  };

  const approved = approvedSnapshots(store);
  const shown = selected ? snapshotFor(store, selected) : latestSnapshot(store);
  const shownIdx = shown ? approved.findIndex(s => s.id === shown.id) : -1;
  const prior = shownIdx > 0 ? approved[shownIdx - 1] : null;

  const reportCtx = {
    project,
    // SPRINT 4 — a Timeline report is ARCHIVED money. Its unit is the
    // currency the snapshot was frozen in, NOT whatever the company
    // reports in today; those differ the moment a company re-bases.
    // Only when no snapshot is shown does the live setting stand in.
    reportCurrency: shown?.exchange?.reportingCurrency || fxSettings.baseCurrency,
    timeline: shown
      ? {
          periodLabel: shown.periodLabel, dataDate: shown.dataDate,
          approvedBy: shown.approvedBy, approvedAt: shown.approvedAt,
          note: shown.note,
          baselineName: shown.contract?.baselineName ?? '',
          exchangeRate: shown.exchange?.rate ?? 1,
          exchangeCurrency: shown.exchange?.reportingCurrency ?? '',
          exchangeRates: shown.exchange?.rates ?? [],
        }
      : null,
    snapshot: shown,
    trend: trendRows(store),
    forecastSeries: forecastComparison(store),
    executive: executiveSummary(store),
    baselineTrail: baselineTrail(store),
    baselineRefs: shown?.baselines ?? null,
    // Phase 5 — historical FX, read from the archive only.
    frozenRates: shown?.exchange?.rates ?? [],
    appliedRatesFrozen: shown?.exchange?.appliedRates ?? [],
    ratesKnownAsOf: shown?.exchange?.ratesKnownAsOf ?? '',
    appliedRateHistory: appliedRateRows(store),
    reportingCurrencyTrail: reportingCurrencyTrail(store),
    mixedReportingCurrency: hasMixedReportingCurrency(store),
    snapshots: approved.map(s => ({
      period: s.periodLabel, dataDate: s.dataDate, approvedBy: s.approvedBy,
      totalDelay: s.delay?.totalDelay ?? null,
      approvedEOT: s.delay?.approvedEOT ?? null,
      ldExposure: s.ld?.exposure ?? null,
      spi: s.evm?.spi ?? null, cpi: s.evm?.cpi ?? null,
    })),
  };

  /** One archived figure with its movement against the previous period. */
  const Fig = ({ label, value, path, money, days, tone }: {
    label: string; value: React.ReactNode; path?: string;
    money?: boolean; days?: boolean; tone?: string;
  }) => {
    const d = path ? deltaBetween(prior, shown, path) : null;
    return (
      <div className="bg-black/30 px-4 py-3">
        <div className="lbl mb-1.5">{label}</div>
        <div className={cn('val', tone)}>{value}</div>
        {d !== null && d !== 0 && (
          <div className={cn('text-(length:--t-second) font-mono mt-1',
            d > 0 ? 'text-chart-5' : 'text-chart-4')}>
            {d > 0 ? '+' : ''}{money ? abbrevMoney(d) : d}{days ? 'd' : ''}{' '}
            <span className="text-muted-foreground">{isRtl ? 'عن السابق' : 'vs prev'}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      {/* ── What this screen is ── */}
      <div className="ds-card ds-card-tight">
        <div className="flex items-start gap-2.5">
          <Info className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" />
          <p className="text-(length:--t-second) text-muted-foreground leading-relaxed">
            {isRtl
              ? 'الخط الزمني سجل تاريخي فقط. لا يحسب شيئاً — يستقبل الأرقام من الوحدات التي تملكها (التأخير، الغرامات، القيمة المكتسبة، المطالبات) ويحفظها كما هي عند اعتماد الفترة. اللوحات الحية تعمل كما هي تماماً ولم تتغير.'
              : 'Timeline is a historical record only. It calculates nothing — it receives figures from the modules that own them (Delay, LD, Earned Value, Claims) and files them verbatim when a period is approved. The live dashboards are unchanged and remain the source of truth for current figures.'}
          </p>
        </div>
      </div>

      {/* ── Approve the current period ── */}
      <div className="ds-card ds-card-raised">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="sec-head !mb-1">
              {isRtl ? 'اعتماد فترة التقرير' : 'Approve Reporting Period'}
            </h3>
            <p className="text-(length:--t-second) text-muted-foreground">
              {periodLabel(currentPeriod, isRtl)}
              {' · '}
              {isRtl ? 'تاريخ البيانات' : 'Data date'}{' '}
              <span className="font-mono">{formatDateOrDash(lastDayOf(currentPeriod), isRtl ? 'ar' : 'en')}</span>
            </p>
          </div>
          {alreadyApproved ? (
            <span className="badge badge-ok">
              <Lock className="w-3 h-3" />
              {isRtl ? 'معتمدة ومجمَّدة' : 'Approved & frozen'}
            </span>
          ) : canEdit ? (
            <button onClick={() => setConfirming(v => !v)} className="btn btn-primary btn-sm">
              <Archive className="w-3 h-3" />
              {isRtl ? 'اعتماد وحفظ اللقطة' : 'Approve & File Snapshot'}
            </button>
          ) : null}
        </div>

        {confirming && !alreadyApproved && canEdit && (
          <>
            {/* Preview: exactly what will be filed, before anything is written. */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-px bg-white/5 mt-4">
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'إجمالي التأخير' : 'Total Delay'}</div>
                <div className="val">{live.ld.totalDelay}d</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'التمديد المعتمد' : 'Approved EOT'}</div>
                <div className="val text-primary">{live.ld.totalApprovedEOT}d</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'غير المعوّض' : 'Unmitigated'}</div>
                <div className="val text-chart-3">{live.ld.totalDelay - live.ld.totalApprovedEOT}d</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">{isRtl ? 'الغرامة' : 'LD Exposure'}</div>
                <div className="val" title={exactMoney(live.ld.ldExposure, baseCcy)}>{abbrevMoney(live.ld.ldExposure)}</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">SPI</div>
                <div className="val">{live.evm.m.spi === null ? '—' : live.evm.m.spi.toFixed(3)}</div>
              </div>
              <div className="bg-black/30 px-4 py-3">
                <div className="lbl mb-1.5">CPI</div>
                <div className="val">{live.evm.m.cpi === null ? '—' : live.evm.m.cpi.toFixed(3)}</div>
              </div>
            </div>

            <div className="form-grid mt-4">
              <div className="field xl:col-span-2">
                <label className="field-label">{isRtl ? 'ملاحظة الاعتماد' : 'Approval Note'}</label>
                <input className="field-input" value={note} onChange={e => setNote(e.target.value)}
                       placeholder={isRtl ? 'مرجع محضر الإغلاق الشهري' : 'Month-end close reference'} />
              </div>
              <div className="field">
                <label className="field-label">{isRtl ? 'عملة الأساس' : 'Base Currency'}</label>
                {/* Stated, not chosen — see the note on `baseCcy`. */}
                <div className="field-input font-mono flex items-center justify-between">
                  <span>{baseCcy}</span>
                  <span className="text-(length:--t-micro) text-muted-foreground uppercase tracking-wider">
                    {isRtl ? 'عملة العقد' : 'contract currency'}
                  </span>
                </div>
              </div>
              <div className="field">
                <label className="field-label">
                  {isRtl ? 'سعر الصرف' : 'Exchange Rate'}
                  <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                    {isRtl ? 'يُحفظ فقط' : 'stored only'}
                  </span>
                </label>
                <input className="field-input font-mono number-ltr" type="number" step="0.0001" dir="ltr"
                       value={rate} onChange={e => setRate(e.target.value)} />
              </div>
            </div>
            <p className="text-(length:--t-second) text-muted-foreground italic mt-1">
              {isRtl
                ? 'سعر الصرف يُحفظ مع الفترة ولا يُطبَّق على أي رقم. محرك العملات لم يُنفَّذ بعد — المحفوظ هو الحقيقة التي لا يمكن استرجاعها لاحقاً.'
                : 'The rate is filed with the period and applied to nothing. No currency engine exists yet — what is preserved is the fact that cannot be reconstructed later.'}
            </p>

            <div className="form-actions">
              <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost">
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="button" onClick={approvePeriod} className="btn btn-primary">
                <Check className="w-3 h-3" />
                {isRtl ? 'اعتماد' : 'Approve'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Archived periods ── */}
      {approved.length === 0 ? (
        <div className="ds-empty">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <Archive className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <div className="ds-empty-title">{isRtl ? 'لا توجد فترات معتمدة' : 'No Approved Periods'}</div>
          <p className="text-(length:--t-second) text-muted-foreground mt-2 max-w-md mx-auto">
            {isRtl
              ? 'اعتمد فترة لتسجيل أول لقطة تاريخية. لا شيء يتغير في اللوحات الحية.'
              : 'Approve a period to file the first historical snapshot. Nothing on the live dashboards changes.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {approved.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.periodId)}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-1.5 text-(length:--t-second) border rounded-md transition-colors uppercase tracking-wider',
                    shown?.id === s.id
                      ? 'bg-primary/10 text-primary border-primary'
                      : 'border-white/[0.06] text-muted-foreground hover:text-white',
                  )}
                >
                  <Lock className="w-3 h-3" />
                  {s.periodLabel}
                </button>
              ))}
            </div>
            <ReportButton reportId="timeline-snapshot" context={reportCtx} />
          </div>

          {shown && (
            <>
              <div className="ds-card ds-card-tight !p-0 overflow-hidden">
                <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-primary/15">
                  <span className="text-(length:--t-second) font-serif uppercase tracking-widest text-primary">
                    {shown.periodLabel}
                    <span className="text-muted-foreground normal-case tracking-normal ms-2">
                      {isRtl ? 'تاريخ البيانات' : 'data date'}{' '}
                      {formatDateOrDash(shown.dataDate, isRtl ? 'ar' : 'en')}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-(length:--t-second) text-muted-foreground">
                      {isRtl ? 'اعتمدها' : 'approved by'} {shown.approvedBy}
                      {' · '}
                      {formatDateOrDash(shown.approvedAt.slice(0, 10), isRtl ? 'ar' : 'en')}
                    </span>
                    <span className="badge badge-ok"><Lock className="w-3 h-3" />{isRtl ? 'مجمَّدة' : 'FROZEN'}</span>
                  </span>
                </div>

                {shown.delay && (
                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-px bg-white/5">
                    <Fig label={isRtl ? 'إجمالي التأخير' : 'Total Delay'}
                         value={`${shown.delay.totalDelay}d`} path="delay.totalDelay" days />
                    <Fig label={isRtl ? 'التمديد المعتمد' : 'Approved EOT'}
                         value={`${shown.delay.approvedEOT}d`} path="delay.approvedEOT" days tone="text-primary" />
                    <Fig label={isRtl ? 'غير المعوّض' : 'Unmitigated'}
                         value={`${shown.delay.unmitigated}d`} path="delay.unmitigated" days
                         tone={shown.delay.unmitigated > 0 ? 'text-chart-3' : 'text-chart-4'} />
                    {shown.ld && (
                      <Fig label={isRtl ? 'الغرامة' : 'LD Exposure'}
                           value={abbrevMoney(shown.ld.exposure)} path="ld.exposure" money
                           tone={shown.ld.exposure > 0 ? 'text-chart-3' : 'text-muted-foreground'} />
                    )}
                    {shown.contract && (
                      <Fig label={isRtl ? 'الانتهاء المعتمد' : 'Approved Finish'}
                           value={formatDateOrDash(shown.contract.approvedFinish, isRtl ? 'ar' : 'en')}
                           tone="text-primary" />
                    )}
                    {shown.ld && (
                      <Fig label={isRtl ? 'صافي التكلفة' : 'Net Cost Impact'}
                           value={abbrevMoney(shown.ld.netCostImpact)} path="ld.netCostImpact" money />
                    )}
                  </div>
                )}

                {shown.evm && (
                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-px bg-white/5 border-t border-white/5">
                    <Fig label="SPI" value={shown.evm.spi === null ? '—' : shown.evm.spi.toFixed(3)} path="evm.spi" />
                    <Fig label="CPI" value={shown.evm.cpi === null ? '—' : shown.evm.cpi.toFixed(3)} path="evm.cpi" />
                    <Fig label="BAC" value={abbrevMoney(shown.evm.bac)} path="evm.bac" money tone="text-primary" />
                    <Fig label="EAC" value={abbrevMoney(shown.evm.eac)} path="evm.eac" money />
                    <Fig label="VAC" value={abbrevMoney(shown.evm.vac)} path="evm.vac" money
                         tone={shown.evm.vac < 0 ? 'text-chart-3' : 'text-chart-4'} />
                    <Fig label={isRtl ? 'العملة' : 'Exchange'}
                         value={`${shown.exchange?.baseCurrency ?? '—'} ${shown.exchange?.rate ?? 1}`} />
                  </div>
                )}
              </div>

              {/* Sections filed in Phase 3B */}
              {(shown.budget || shown.certificates || shown.forecast) && (
                <div className="ds-card ds-card-tight !p-0 overflow-hidden">
                  <div className="px-4 py-2 border-b border-white/5">
                    <span className="lbl">{isRtl ? 'الموقف المالي المؤرشف' : 'Archived Financial Position'}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-px bg-white/5">
                    {shown.budget && (
                      <>
                        <Fig label={isRtl ? 'الموازنة المخططة' : 'Budget Planned'}
                             value={abbrevMoney(shown.budget.totalPlanned)} path="budget.totalPlanned" money />
                        <Fig label={isRtl ? 'التكلفة الفعلية' : 'Budget Actual'}
                             value={abbrevMoney(shown.budget.totalActual)} path="budget.totalActual" money />
                        <Fig label={isRtl ? 'انحراف الموازنة' : 'Budget Variance'}
                             value={abbrevMoney(shown.budget.variance)} path="budget.variance" money
                             tone={shown.budget.variance < 0 ? 'text-chart-3' : 'text-chart-4'} />
                      </>
                    )}
                    {shown.certificates && (
                      <>
                        <Fig label={isRtl ? 'المعتمد' : 'Certified'}
                             value={abbrevMoney(shown.certificates.certified)} path="certificates.certified" money
                             tone="text-primary" />
                        <Fig label={isRtl ? 'المدفوع' : 'Paid'}
                             value={abbrevMoney(shown.certificates.paid)} path="certificates.paid" money
                             tone="text-chart-4" />
                      </>
                    )}
                    {shown.forecast && (
                      <Fig label={isRtl ? 'انزلاق متوقع' : 'Forecast Slip'}
                           value={`${shown.forecast.slipDays}d`} path="forecast.slipDays" days
                           tone={shown.forecast.slipDays > 0 ? 'text-chart-5' : 'text-chart-4'} />
                    )}
                  </div>
                </div>
              )}

              {/* Phase 5 — the rates this period actually applied.
                  The frozen rate book says what was available; this says
                  what was used, and only the second proves a total. */}
              {(shown.exchange?.appliedRates ?? []).length > 0 && (
                <div className="ds-card ds-card-tight !p-0 overflow-hidden">
                  <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
                    <span className="lbl">
                      {isRtl ? 'الأسعار المطبَّقة في هذه الفترة' : 'Rates Applied in This Period'}
                    </span>
                    <span className="text-(length:--t-micro) text-muted-foreground font-mono">
                      {isRtl ? 'عملة التقارير' : 'Reporting'}{': '}
                      {shown.exchange?.reportingCurrency || '—'}
                      {shown.exchange?.ratesKnownAsOf && <>
                        {' · '}{isRtl ? 'معلومة حتى' : 'known as of'}{' '}
                        {formatDateOrDash(shown.exchange.ratesKnownAsOf, isRtl ? 'ar' : 'en')}
                      </>}
                    </span>
                  </div>
                  <div className="ds-table-wrap">
                    <table className="ds-table">
                      <thead>
                        <tr>
                          <th className="col-pin">{isRtl ? 'العملة' : 'Currency'}</th>
                          <th className="money">{isRtl ? 'السعر المطبَّق' : 'Applied Rate'}</th>
                          <th className="money">{isRtl ? 'عدد السجلات' : 'Records'}</th>
                          <th className="money">{isRtl ? 'المبلغ الأصلي' : 'Original'}</th>
                          <th className="money">{isRtl ? 'المحوَّل' : 'Converted'}</th>
                          <th>{isRtl ? 'أول معاملة' : 'First Txn'}</th>
                          <th>{isRtl ? 'آخر معاملة' : 'Last Txn'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(shown.exchange?.appliedRates ?? []).map(a => (
                          <tr key={`${a.currency}-${a.rate}`}>
                            <td className="col-pin font-mono text-primary">{a.currency}</td>
                            <td className="money font-mono">{a.rate.toFixed(4)}</td>
                            <td className="money">{a.count}</td>
                            <td className="money text-muted-foreground" title={exactMoney(a.originalTotal, a.currency)}>
                              {abbrevMoney(a.originalTotal)}
                            </td>
                            <td className="money" title={exactMoney(a.convertedTotal, shown.exchange?.reportingCurrency ?? '')}>
                              {abbrevMoney(a.convertedTotal)}
                            </td>
                            <td className="text-muted-foreground font-mono whitespace-nowrap">
                              {formatDateOrDash(a.firstTxn, isRtl ? 'ar' : 'en')}
                            </td>
                            <td className="text-muted-foreground font-mono whitespace-nowrap">
                              {formatDateOrDash(a.lastTxn, isRtl ? 'ar' : 'en')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-(length:--t-second) text-muted-foreground italic px-4 py-2">
                    {isRtl
                      ? 'هذه الأسعار مُجمَّدة مع الفترة ومأخوذة من السجلات المحوَّلة نفسها. التقارير التاريخية تستخدمها ولا تستخدم سعر اليوم أبداً.'
                      : 'These rates are frozen with the period and were harvested from the converted records themselves. Historical reports use them and never today’s rate.'}
                  </p>
                </div>
              )}

              {/* Phase 4 — which plan this period was reported against.
                  A movement in variance means one thing when both periods
                  sat on Budget V2, and something else when the second sat
                  on V3. Saying so is the whole point of the reference. */}
              {shown.baselines && Object.values(shown.baselines).some(Boolean) && (
                <div className="ds-card ds-card-tight !p-0 overflow-hidden">
                  <div className="px-4 py-2 border-b border-white/5">
                    <span className="lbl">
                      {isRtl ? 'خطوط الأساس المرجعية لهذه الفترة' : 'Baselines Referenced by This Period'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-px bg-white/5">
                    {([
                      ['contract', isRtl ? 'العقد' : 'Contract'],
                      ['budget',   isRtl ? 'الموازنة' : 'Budget'],
                      ['cashflow', isRtl ? 'التدفق النقدي' : 'Cash Flow'],
                      ['schedule', isRtl ? 'البرنامج' : 'Schedule'],
                      ['forecast', isRtl ? 'التوقعات' : 'Forecast'],
                    ] as const).map(([k, label]) => {
                      const ref = (shown.baselines as any)?.[k];
                      return (
                        <div key={k} className="bg-black/30 px-4 py-3">
                          <div className="lbl mb-1.5">{label}</div>
                          <div className={cn('val', ref ? 'text-primary' : 'text-muted-foreground')}>
                            {ref ? `V${ref.version}` : '—'}
                          </div>
                          {ref?.reason && (
                            <div className="text-(length:--t-second) text-muted-foreground mt-1 truncate"
                                 title={ref.reason}>
                              {ref.reason}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Completeness — a period approved before a section existed
                  simply lacks it, and saying so beats printing a zero. */}
              {(() => {
                const cov = coverageOf(shown);
                if (cov.complete) return null;
                return (
                  <p className="text-(length:--t-second) text-muted-foreground italic">
                    {isRtl ? 'أقسام غير مسجّلة في هذه الفترة' : 'Sections not recorded in this period'}
                    {': '}
                    <span className="font-mono">{cov.missing.join(' · ')}</span>
                  </p>
                );
              })()}

              {/* Provenance — what produced these numbers */}
              <div className="ds-card ds-card-tight">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-(length:--t-second)">
                  <div>
                    <div className="lbl mb-1">{isRtl ? 'الأساس' : 'Baseline'}</div>
                    <div className="text-white">{shown.contract?.baselineName || '—'}</div>
                  </div>
                  <div>
                    <div className="lbl mb-1">{isRtl ? 'طريقة EAC' : 'EAC Method'}</div>
                    <div className="text-white font-mono">{shown.evm?.eacMethod || '—'}</div>
                  </div>
                  <div>
                    <div className="lbl mb-1">{isRtl ? 'فترة القيمة المكتسبة' : 'EVM Period'}</div>
                    <div className="text-white">{shown.evm?.periodLabel || '—'}</div>
                  </div>
                  <div>
                    <div className="lbl mb-1">{isRtl ? 'ملاحظة' : 'Note'}</div>
                    <div className="text-white">{shown.note || '—'}</div>
                  </div>
                </div>
                {canEdit && shown.status === 'approved' && (
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={() => persist(supersedeSnapshot(project.id, shown.id))}
                      className="inline-flex items-center gap-1 text-(length:--t-second) uppercase tracking-widest text-muted-foreground border border-white/10 px-3 py-1.5 hover:text-chart-5 hover:border-chart-5/40 transition-colors"
                      title={isRtl ? 'يبقى السجل محفوظاً' : 'The record is kept'}
                    >
                      <Ban className="w-3 h-3" />
                      {isRtl ? 'سحب الاعتماد' : 'Supersede'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Cross-period history */}
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                  <th>{isRtl ? 'تاريخ البيانات' : 'Data Date'}</th>
                  <th className="money">{isRtl ? 'التأخير' : 'Delay'}</th>
                  <th className="money">{isRtl ? 'التمديد' : 'EOT'}</th>
                  <th className="money">{isRtl ? 'غير معوّض' : 'Unmit.'}</th>
                  <th className="money">{isRtl ? 'الغرامة' : 'LD'}</th>
                  <th className="money">SPI</th>
                  <th className="money">CPI</th>
                  <th>{isRtl ? 'اعتمدها' : 'Approved By'}</th>
                  <th>{isRtl ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {store.snapshots.map(s => (
                  <tr key={s.id} className={cn(shown?.id === s.id && 'bg-primary/[0.04]')}>
                    <td className="col-pin font-mono text-primary">{s.periodLabel}</td>
                    <td className="text-muted-foreground font-mono whitespace-nowrap">
                      {formatDateOrDash(s.dataDate, isRtl ? 'ar' : 'en')}
                    </td>
                    <td className="money">{s.delay ? `${s.delay.totalDelay}d` : '—'}</td>
                    <td className="money text-primary">{s.delay ? `${s.delay.approvedEOT}d` : '—'}</td>
                    <td className="money text-chart-3">{s.delay ? `${s.delay.unmitigated}d` : '—'}</td>
                    <td className="money" title={s.ld ? exactMoney(s.ld.exposure, baseCcy) : undefined}>
                      {s.ld ? abbrevMoney(s.ld.exposure) : '—'}
                    </td>
                    <td className="money">{s.evm?.spi != null ? s.evm.spi.toFixed(3) : '—'}</td>
                    <td className="money">{s.evm?.cpi != null ? s.evm.cpi.toFixed(3) : '—'}</td>
                    <td className="text-muted-foreground">{s.approvedBy || '—'}</td>
                    <td>
                      <span className={cn('badge',
                        s.status === 'approved' ? 'badge-ok'
                        : s.status === 'superseded' ? 'badge-neutral' : 'badge-gold')}>
                        {s.status === 'approved' ? (isRtl ? 'معتمدة' : 'Approved')
                         : s.status === 'superseded' ? (isRtl ? 'مسحوبة' : 'Superseded')
                         : (isRtl ? 'مسودة' : 'Draft')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-(length:--t-second) text-muted-foreground italic">
            {isRtl
              ? 'اللقطات المعتمدة لا تُعدَّل أبداً. تصحيح فترة سابقة يتم باعتماد الفترة التالية بالموقف المصحَّح، لا بتعديل ما وُقّع عليه.'
              : 'Approved snapshots are never edited. A past period is corrected by approving the next one with the corrected position, not by rewriting what was signed.'}
          </p>
        </>
      )}
    </div>
  );
}
