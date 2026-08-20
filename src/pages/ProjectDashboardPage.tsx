import React, { useEffect, useMemo, useState } from 'react';
import { useProjects, useAuth, getProjectPermission } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { formatCompactNumber, formatPercent, cn } from '../lib/utils';
import {
  ClipboardList, Wallet, Landmark, Gauge, Clock,
  FileWarning, FileText, ShieldAlert, Receipt, HardHat, Archive, Layers, BookOpen, FileSignature,
} from 'lucide-react';
import { findCompanyById } from '../mock/companies';
import { fetchSectors } from '../mock/sectors';
// The unit label under a KPI must name the currency the figure is in.
import { readCurrencySettings } from '../lib/currency';
import { contractCurrencyOf } from '../lib/projectCurrency';
import OverviewModule from '../components/modules/OverviewModule';
import ContractModule from '../components/modules/ContractModule';
import CashFlowModule from '../components/modules/CashFlowModule';
import BudgetModule from '../components/modules/BudgetModule';
import EVMModule from '../components/modules/EVMModule';
import TimelineModule from '../components/modules/TimelineModule';
import BaselineModule from '../components/modules/BaselineModule';
import ReportsModule from '../components/modules/ReportsModule';
import DelayModule from '../components/modules/DelayModule';
import ChangesModule from '../components/modules/ChangesModule';
import ClaimsModule from '../components/modules/ClaimsModule';
import RiskModule from '../components/modules/RiskModule';
import CertsModule from '../components/modules/CertsModule';
import SubsModule from '../components/modules/SubsModule';
import ContextBar from '../components/ContextBar';
// PHASE 3F-UX Task 2 — live master data: re-renders on any registry write.
import { useSectors, useCompany } from '../lib/useMasterData';
// Phase 3G — opt-in sample data. Nothing seeds automatically any more.
import LoadSampleData from '../components/LoadSampleData';
// Baseline tab alert — approved sources newer than the package in force.
import { packageLag } from '../lib/baselines';
import { timelineNeedsAttention } from '../lib/timeline';
import { contractPhaseOption, isContractPhaseException } from '../lib/contractPhases';
import { snapshot as evmSnapshot, readSyncedEvm, withinTolerance } from '../lib/evm';

const TABS = [
  { id: 'overview',  icon: ClipboardList, en: 'Overview',           ar: 'نظرة عامة' },
  { id: 'contract',  icon: FileSignature, en: 'Contract',           ar: 'العقد' },
  { id: 'cashflow',  icon: Wallet,         en: 'Cash Flow',          ar: 'التدفق النقدي' },
  { id: 'budget',    icon: Landmark,       en: 'Budget',             ar: 'الموازنة' },
  { id: 'evm',       icon: Gauge,          en: 'Earned Value',       ar: 'القيمة المكتسبة' },
  { id: 'delay',     icon: Clock,          en: 'Delay Analysis',     ar: 'تحليل التأخير' },
  { id: 'changes',   icon: FileWarning,    en: 'Change Orders',      ar: 'أوامر التغيير' },
  { id: 'claims',    icon: FileText,       en: 'Claims',             ar: 'المطالبات' },
  { id: 'risk',      icon: ShieldAlert,    en: 'Risk Register',      ar: 'سجل المخاطر' },
  { id: 'certs',     icon: Receipt,        en: 'Owner Certificates', ar: 'المستخلصات' },
  { id: 'subs',      icon: HardHat,        en: 'Subcontractors',     ar: 'مقاولو الباطن' },
  // Appended last: no existing tab changes position or behaviour.
  { id: 'timeline',  icon: Archive,        en: 'Timeline',           ar: 'الخط الزمني' },
  { id: 'baselines', icon: Layers,         en: 'Baselines',          ar: 'خطوط الأساس' },
  { id: 'reports',   icon: BookOpen,       en: 'Reports',            ar: 'التقارير' },
];

export default function ProjectDashboard({ params }: { params: { id: string } }) {
  const { projects } = useProjects();
  const { user } = useAuth();
  const { t, lang } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');
  /** Bumped after a sample load so the active module re-reads storage. */
  const [sampleTick, setSampleTick] = useState(0);

  const project = projects.find((p) => p.id === params.id);
  const perm = getProjectPermission(user, project?.id ?? '');

  // Baseline tab alert — recomputed as the user moves around the project so
  // a newly approved source version raises the mark without a reload.
  const baselineLag = useMemo(
    () => (project ? packageLag(project.id) : { behind: [], alert: false, awaitingFirstPackage: false }),
    [project, activeTab],
  );

  // Timeline tab alert — an approved Baseline Package exists while this
  // project has no approved timeline snapshot yet.
  const timelineAlert = useMemo(
    () => (project ? timelineNeedsAttention(project.id) : false),
    [project, activeTab],
  );

  /* Header cards — the contract phase the user selects in the Contract tab,
     and the EVM position from the same engine the Matrix reports: the
     quadrant state (ahead/behind × under/over budget), not a verdict. */
  const contractPhase = project ? contractPhaseOption(project.contractPhase) : null;
  const evmPosition = useMemo(() => {
    if (!project) return { quadrant: null, health: null, onTarget: false };
    try {
      const snap = evmSnapshot(project as any, readSyncedEvm(project as any));
      return {
        quadrant: snap.quadrant ?? null,
        health: snap.health ?? null,
        onTarget: withinTolerance(snap.m.spi, snap.m.cpi),
      };
    } catch {
      return { quadrant: null, health: null, onTarget: false };
    }
  }, [project, activeTab]);

  const sectors = useSectors();
  const sector = useMemo(
    () => project ? sectors.find((s) => s.projectIds.includes(project.id)) : undefined,
    [project, sectors]
  );
  const company = useCompany(sector?.companyId);
  /**
   * The company's reporting currency — what `project.contractValue` is
   * denominated in. Previously hardcoded 'SAR' in the KPI unit label.
   */
  /**
   * The unit beside the header's Contract Value.
   *
   * `project.contractValue` is the figure the user TYPED, stored raw in
   * the CONTRACT currency and never converted. Labelling it with the
   * company's reporting currency — which is what this did — put "AED"
   * over a number of Saudi riyals. The value was right; the unit was
   * invented. Read from the project, never from the company.
   */
  const reportingCcy = useMemo(
    () => contractCurrencyOf(
      project?.id ?? '',
      readCurrencySettings(sector?.companyId ?? '').baseCurrency),
    [project?.id, sector?.companyId],
  );

  const breadcrumbItems = useMemo(() => {
    const items: { label: string; href?: string }[] = [
      { label: 'Enterprise Portfolio', href: '/' },
    ];
    if (company) {
      items.push({ label: company.name, href: `/company/${company.id}` });
    }
    if (sector) {
      items.push({ label: sector.name, href: `/sector/${sector.id}` });
    }
    if (project) {
      items.push({ label: lang === 'ar' ? project.nameAr : project.nameEn });
    }
    return items;
  }, [company, sector, project, lang]);

  const backLabel = sector ? sector.name : company ? company.name : 'Enterprise Portfolio';

  useEffect(() => {
    if (!project) return;
    const handleNav = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.projectId === project.id && detail.tab) {
        setActiveTab(detail.tab);
      }
    };
    window.addEventListener('pactum-navigate', handleNav);
    return () => window.removeEventListener('pactum-navigate', handleNav);
  }, [project?.id]);

  if (!project) return (
    <div className="p-12 text-center text-muted-foreground">Project not found</div>
  );

  if (!perm.canView) return (
    <div className="p-12 text-center">
      <p className="text-destructive font-mono text-lg mb-2">403 — Access Denied</p>
      <p className="text-muted-foreground text-sm">
        {lang === 'ar' ? 'ليس لديك صلاحية لعرض هذا المشروع.' : 'You do not have permission to view this project.'}
      </p>
    </div>
  );

  const canEdit = perm.canEdit;
  const tabLabel = (tab: typeof TABS[0]) => lang === 'ar' ? tab.ar : tab.en;

  const handleTabClick = (id: string) => {
    setActiveTab(id);
  };

  const renderModule = () => {
    const props = { project, canEdit };
    switch (activeTab) {
      case 'overview':  return <OverviewModule  {...props} />;
      case 'contract':  return <ContractModule  {...props} />;
      case 'cashflow':  return <CashFlowModule  {...props} />;
      case 'budget':    return <BudgetModule    {...props} />;
      case 'evm':       return <EVMModule       {...props} />;
      case 'delay':     return <DelayModule     {...props} />;
      case 'changes':   return <ChangesModule   {...props} />;
      case 'claims':    return <ClaimsModule    {...props} />;
      case 'risk':      return <RiskModule      {...props} />;
      case 'certs':     return <CertsModule     {...props} />;
      case 'subs':      return <SubsModule      {...props} />;
      case 'timeline':  return <TimelineModule  {...props} />;
      case 'baselines': return <BaselineModule  {...props} />;
      case 'reports':   return <ReportsModule   {...props} />;
      default:          return <OverviewModule  {...props} />;
    }
  };

  return (
    <div className="min-h-full w-full bg-background">
      {/* CONTEXT NAVIGATION BAR — full bleed, identical on every page */}
      <ContextBar
        items={breadcrumbItems}
        parentId={sector?.id}
        backLabel={lang === 'ar' ? backLabel : backLabel}
        code={project.code}
      />

      <div className="pg pg-stack">
        {/*
          PHASE 3G — the ONLY entry point for demonstration records.
          Renders nothing unless the project is completely empty AND the
          user is an admin, so it cannot contaminate real work.
        */}
        <LoadSampleData
          project={project as any}
          onLoaded={() => setSampleTick(t => t + 1)}
        />

        {/* 1 · PAGE HEADER */}
        <div className="pg-head">
          <div className="min-w-0">
            <div className="pg-eyebrow mb-1.5">
              {lang === 'ar' ? TABS.find(x => x.id === activeTab)?.ar : TABS.find(x => x.id === activeTab)?.en}
            </div>
            <h1 className="pg-title">
              {lang === 'en' ? project.nameEn : project.nameAr}
            </h1>
          </div>
          {/* 2 · EXECUTIVE SUMMARY — the three figures a director checks first */}
          <div className="kpi-strip sm:!grid-cols-2 lg:!grid-cols-4 shrink-0 w-full sm:w-auto">
            <div className="kpi">
              <div className="kpi-k">{t.contractValue}</div>
              <div className="kpi-v">{formatCompactNumber(project.contractValue)}</div>
              <div className="kpi-sub">{reportingCcy}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">{t.progress}</div>
              <div className="kpi-v kpi-v-gold">{formatPercent(project.progress)}</div>
              <div className="kpi-sub">{lang === 'ar' ? 'مكتمل' : 'Complete'}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">{t.status}</div>
              {contractPhase ? (
                <>
                  <div className="mt-0.5">
                    <span className={cn('badge',
                      isContractPhaseException(project.contractPhase ?? '') || project.contractPhase === 'SUSPENDED'
                        ? 'badge-warn'
                        : 'badge-ok')}>
                      {lang === 'ar' ? contractPhase.ar : contractPhase.en}
                    </span>
                  </div>
                  <div className="kpi-sub font-mono">{contractPhase.value}</div>
                </>
              ) : (
                <>
                  <div className="mt-0.5">
                    <span className={cn('badge', project.delayDays > 0 ? 'badge-warn' : 'badge-ok')}>
                      {project.delayDays > 0 ? t.delayed : t.onTrack}
                    </span>
                  </div>
                  {project.delayDays > 0 && (
                    <div className="kpi-sub">
                      {project.delayDays} {lang === 'ar' ? 'يوم تأخير' : 'days delay'}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* EVM POSITION — the Matrix's Current Position state, same
                engine, same words: ahead/behind × under/over budget. The
                old Healthy/Watch/Critical verdict rides along as the
                first-reason sub-line, so nothing is lost. */}
            <div className="kpi">
              <div className="kpi-k">{lang === 'ar' ? 'صحة القيمة المكتسبة' : 'EVM Health'}</div>
              <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                <span className={cn('badge',
                  !evmPosition.quadrant ? 'badge-neutral'
                  : evmPosition.quadrant.tone === 'ok' ? 'badge-ok'
                  : evmPosition.quadrant.tone === 'gold' ? 'badge-gold'
                  : evmPosition.quadrant.tone === 'warn' ? 'badge-warn'
                  : evmPosition.quadrant.tone === 'risk' ? 'badge-risk' : 'badge-neutral')}>
                  {evmPosition.quadrant
                    ? (lang === 'ar' ? evmPosition.quadrant.ar : evmPosition.quadrant.en)
                    : (lang === 'ar' ? 'لا توجد بيانات' : 'No data')}
                </span>
                {evmPosition.onTarget && (
                  <span className="text-(length:--t-micro) tracking-widest text-primary border border-primary/30 bg-primary/[0.07] px-1.5 py-0.5 number-ltr">
                    {lang === 'ar' ? 'على الهدف ±٥٪' : 'ON TARGET ±5%'}
                  </span>
                )}
              </div>
              {evmPosition.health && evmPosition.quadrant && evmPosition.quadrant.key !== 'unknown'
                && evmPosition.health.tone !== 'ok' && evmPosition.health.tone !== 'muted' && (
                <div className="kpi-sub">
                  {lang === 'ar' ? (evmPosition.health.reasonsAr[0] ?? '') : (evmPosition.health.reasons[0] ?? '')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 4 · NAVIGATION — arrow keys move between tabs */}
        <div className="ds-tabs" role="tablist" aria-label={lang === 'ar' ? 'وحدات المشروع' : 'Project modules'}>
          {TABS.map((tab, i) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => handleTabClick(tab.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  // Mirror the step in RTL so the arrow always moves visually.
                  const dir = (e.key === 'ArrowRight') === (lang !== 'ar') ? 1 : -1;
                  handleTabClick(TABS[(i + dir + TABS.length) % TABS.length].id);
                }}
                className="ds-tab"
              >
                <tab.icon className="w-4 h-4 flex-shrink-0" />
                <span>{tabLabel(tab)}</span>
                {((tab.id === 'baselines' && baselineLag.alert) || (tab.id === 'timeline' && timelineAlert)) && (
                  <span
                    title={tab.id === 'timeline'
                      ? (lang === 'ar'
                          ? 'فيه حزمة خط أساس معتمدة وما فيش تايم لاين معتمد بعد — اعتمد لقطة التايم لاين'
                          : 'An approved Baseline Package exists with no approved timeline snapshot yet — approve a timeline period')
                      : (lang === 'ar'
                          ? 'فيه مصادر معتمدة أحدث من حزمة خط الأساس السارية — يحتاج اعتماد حزمة جديدة'
                          : 'Approved sources are newer than the package in force — a new Baseline Package approval is needed')}
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0"
                    style={{ background: 'rgba(192,138,62,0.18)', color: 'var(--c-warning)', fontWeight: 700, fontSize: '10px' }}
                  >
                    !
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 5 · DETAILED MODULE */}
        <div role="tabpanel">
          {/* `sampleTick` remounts the module after a sample load so it
              re-reads storage — modules read on mount, by design. */}
          <React.Fragment key={sampleTick}>{renderModule()}</React.Fragment>
        </div>
      </div>
    </div>
  );
}
