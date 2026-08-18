import React, { useEffect, useMemo, useState } from 'react';
import { useProjects, useAuth, getProjectPermission } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { formatCompactNumber, formatPercent, cn } from '../lib/utils';
import {
  ClipboardList, Wallet, Landmark, Gauge, Clock,
  FileWarning, FileText, ShieldAlert, Receipt, HardHat,
} from 'lucide-react';
import { findCompanyById } from '../mock/companies';
import { fetchSectors } from '../mock/sectors';
import OverviewModule from '../components/modules/OverviewModule';
import CashFlowModule from '../components/modules/CashFlowModule';
import BudgetModule from '../components/modules/BudgetModule';
import EVMModule from '../components/modules/EVMModule';
import DelayModule from '../components/modules/DelayModule';
import ChangesModule from '../components/modules/ChangesModule';
import ClaimsModule from '../components/modules/ClaimsModule';
import RiskModule from '../components/modules/RiskModule';
import CertsModule from '../components/modules/CertsModule';
import SubsModule from '../components/modules/SubsModule';
import Breadcrumb from '../components/Breadcrumb';
import BackButton from '../components/BackButton';

const TABS = [
  { id: 'overview',  icon: ClipboardList, en: 'Overview',           ar: 'نظرة عامة' },
  { id: 'cashflow',  icon: Wallet,         en: 'Cash Flow',          ar: 'التدفق النقدي' },
  { id: 'budget',    icon: Landmark,       en: 'Budget',             ar: 'الموازنة' },
  { id: 'evm',       icon: Gauge,          en: 'Earned Value',       ar: 'القيمة المكتسبة' },
  { id: 'delay',     icon: Clock,          en: 'Delay Analysis',     ar: 'تحليل التأخير' },
  { id: 'changes',   icon: FileWarning,    en: 'Change Orders',      ar: 'أوامر التغيير' },
  { id: 'claims',    icon: FileText,       en: 'Claims',             ar: 'المطالبات' },
  { id: 'risk',      icon: ShieldAlert,    en: 'Risk Register',      ar: 'سجل المخاطر' },
  { id: 'certs',     icon: Receipt,        en: 'Owner Certificates', ar: 'المستخلصات' },
  { id: 'subs',      icon: HardHat,        en: 'Subcontractors',     ar: 'مقاولو الباطن' },
];

export default function ProjectDashboard({ params }: { params: { id: string } }) {
  const { projects } = useProjects();
  const { user } = useAuth();
  const { t, lang } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');

  const project = projects.find((p) => p.id === params.id);
  const perm = getProjectPermission(user, project?.id ?? '');

  const sectors = useMemo(() => fetchSectors(), []);
  const sector = useMemo(
    () => project ? sectors.find((s) => s.projectIds.includes(project.id)) : undefined,
    [project, sectors]
  );
  const company = useMemo(
    () => sector ? findCompanyById(sector.companyId) : undefined,
    [sector]
  );

  const breadcrumbItems = useMemo(() => {
    const items = [
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
      case 'cashflow':  return <CashFlowModule  {...props} />;
      case 'budget':    return <BudgetModule    {...props} />;
      case 'evm':       return <EVMModule       {...props} />;
      case 'delay':     return <DelayModule     {...props} />;
      case 'changes':   return <ChangesModule   {...props} />;
      case 'claims':    return <ClaimsModule    {...props} />;
      case 'risk':      return <RiskModule      {...props} />;
      case 'certs':     return <CertsModule     {...props} />;
      case 'subs':      return <SubsModule      {...props} />;
      default:          return <OverviewModule  {...props} />;
    }
  };

  return (
    <div className="min-h-full w-full bg-background">
      <div className="pg pg-stack">
        <Breadcrumb items={breadcrumbItems} />

        {/* 1 · PAGE HEADER */}
        <div className="pg-head">
          <div className="min-w-0">
            <div className="mb-3">
              <BackButton
                parentId={sector?.id}
                label={lang === 'ar' ? `العودة إلى ${backLabel}` : `Back to ${backLabel}`}
                className="px-0 py-0 border-0 border-transparent bg-transparent hover:bg-transparent text-sm text-white/50 hover:text-white hover:border-transparent rounded-none"
              />
            </div>
            <div className="pg-eyebrow mb-1.5">{project.code}</div>
            <h1 className="pg-title">
              {lang === 'en' ? project.nameEn : project.nameAr}
            </h1>
          </div>
          {/* 2 · EXECUTIVE SUMMARY — the three figures a director checks first */}
          <div className="kpi-strip sm:!grid-cols-3 shrink-0 w-full sm:w-auto sm:min-w-[26rem]">
            <div className="kpi">
              <div className="kpi-k">{t.contractValue}</div>
              <div className="kpi-v">{formatCompactNumber(project.contractValue)}</div>
              <div className="kpi-sub">SAR</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">{t.progress}</div>
              <div className="kpi-v kpi-v-gold">{formatPercent(project.progress)}</div>
              <div className="kpi-sub">{lang === 'ar' ? 'مكتمل' : 'Complete'}</div>
            </div>
            <div className="kpi">
              <div className="kpi-k">{t.status}</div>
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
              </button>
            );
          })}
        </div>

        {/* 5 · DETAILED MODULE */}
        <div role="tabpanel">
          {renderModule()}
        </div>
      </div>
    </div>
  );
}