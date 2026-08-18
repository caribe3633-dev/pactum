import React, { useMemo, useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import ContextBar from '../components/ContextBar';
import { findCompanyById } from '../mock/companies';
import { findSectorsByCompany } from '../mock/sectors';
import { useProjects } from '../lib/store';
import { readCurrencySettings } from '../lib/currency';
import { useTranslation } from '../lib/i18n';
import { formatMoney, formatPercent, cn } from '../lib/utils';
import {
  aggregateOne, RegistryAggregate,
  readContacts, saveContacts, newContactId, RegistryContact,
} from '../lib/subcontractors';
import { useAuth } from '../lib/store';
import SubContractSummary, { LatestActivity } from '../components/SubContractSummary';
import SubPerformancePanel from '../components/SubPerformancePanel';
import { AssignmentRef, evaluateCompany } from '../lib/subPerformance';
import {
  readCommercial, rollupCommercial, computeSubLd, computeSubSchedule,
} from '../lib/subcontractCommercial';
import {
  ClipboardList, Layers, FileText, Receipt, Wallet, Gauge, BarChart2,
  Clock, HardHat, Star, Users, Plus, Trash2, Pencil, X, Briefcase, ExternalLink,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

const TABS = [
  { id: 'overview',     icon: ClipboardList, en: 'Overview',     ar: 'نظرة عامة' },
  // Performance sits directly after Overview: it is the headline judgement
  // on the subcontractor, not an afterthought at the end of the strip.
  { id: 'performance',  icon: Gauge,         en: 'Performance',  ar: 'الأداء' },
  { id: 'contacts',     icon: Users,         en: 'Contacts',     ar: 'جهات التواصل' },
  { id: 'projects',     icon: Layers,        en: 'Projects',     ar: 'المشاريع' },
  { id: 'contracts',    icon: FileText,      en: 'Contracts',    ar: 'العقود' },
  { id: 'commercial',   icon: Briefcase,     en: 'Commercial',   ar: 'الإدارة التجارية' },
  { id: 'certificates', icon: Receipt,       en: 'Certificates', ar: 'الشهادات' },
  { id: 'cashflow',     icon: Wallet,        en: 'Cash Flow',    ar: 'التدفق النقدي' },
  { id: 'analytics',    icon: BarChart2,     en: 'Analytics',    ar: 'التحليلات' },
];

const GOLD = '#D4AF5A';
const GREEN = '#7EA486';
const RED = '#B25450';
const BLUE = '#60a5fa';
const PURPLE = '#a78bfa';
const PIE_COLORS = [GOLD, GREEN, RED, BLUE, PURPLE, '#C98A3D', '#38bdf8'];

const CHART_STYLE = { background: 'transparent' };
const AXIS_PROPS = { tick: { fill: 'rgba(255,255,255,0.3)', fontSize: 10 }, axisLine: false, tickLine: false };
const GRID_PROPS = { stroke: 'rgba(255,255,255,0.04)', strokeDasharray: '3 3' };
const TT_STYLE = {
  background: '#161514', border: '1px solid rgba(179,138,61,0.3)',
  borderRadius: 0, color: 'rgba(255,255,255,0.8)', fontSize: 11,
};

function kpiColor(score: number) {
  if (score >= 80) return 'text-chart-4';
  if (score >= 60) return 'text-chart-5';
  return 'text-chart-3';
}

/**
 * Subcontractor Dashboard — 100% READ ONLY.
 *
 * All identity edits happen in the Company Registry.
 * All execution edits happen in Project Subcontracts.
 * This page never writes.
 *
 * Route: /company/:companyId/subcontractors/:internalId
 */
export default function SubcontractorDashboardPage({ params }: any) {
  const companyId = params?.companyId || '';
  // SPRINT 3 · R5 — the company's reporting currency. Every figure on this
  // page is a company-level total, so one currency governs the screen.
  // R1 is what makes this correct: readCurrencySettings now falls back to
  // the company registry instead of returning a hardcoded 'SAR'.
  const ccy = readCurrencySettings(params?.companyId || '').baseCurrency;
  const internalId = params?.internalId || '';

  const company = findCompanyById(companyId);
  const sectors = findSectorsByCompany(companyId);
  const { projects } = useProjects();
  const { lang } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');

  const isRtl = lang === 'ar';

  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [contacts, setContacts] = useState<RegistryContact[]>([]);
  const [draft, setDraft] = useState({ name: '', position: '', mobile: '', email: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contactError, setContactError] = useState('');
  const [showContactForm, setShowContactForm] = useState(false);

  const agg: RegistryAggregate | undefined = useMemo(
    () => (company ? aggregateOne(companyId, internalId, projects, sectors) : undefined),
    [company, companyId, internalId, projects, sectors],
  );

  // ── Chart data — all derived on read ──
  const bySector = useMemo(() => {
    const m = new Map<string, number>();
    (agg?.projects ?? []).forEach(p => {
      const k = p.sectorName ?? '—';
      m.set(k, (m.get(k) ?? 0) + p.contractValue);
    });
    return Array.from(m, ([name, value]) => ({ name, value }));
  }, [agg]);

  const byTrade = useMemo(() => {
    const m = new Map<string, number>();
    (agg?.projects ?? []).forEach(p => {
      const k = p.trade || '—';
      m.set(k, (m.get(k) ?? 0) + p.contractValue);
    });
    return Array.from(m, ([name, value]) => ({ name, value }));
  }, [agg]);

  const byProject = useMemo(
    () => (agg?.projects ?? []).map(p => ({
      code: p.projectCode || p.projectName.slice(0, 10),
      value: p.contractValue,
      certified: p.certified,
    })),
    [agg],
  );

  const perfByProject = useMemo(
    () => (agg?.projects ?? []).map(p => ({
      code: p.projectCode || p.projectName.slice(0, 10),
      progress: Math.round(p.progressPct * 100),
      kpi: p.performanceScore,
      delay: p.delayDays,
    })),
    [agg],
  );

  // Every certificate across every assignment — read-only
  const allCerts = useMemo(
    () => (agg?.projects ?? []).flatMap(p => {
      try {
        const raw = JSON.parse(localStorage.getItem(`pactum-sub-certs-${p.projectId}`) || '{}');
        const subs = JSON.parse(localStorage.getItem(`pactum-subs-${p.projectId}`) || '[]');
        const match = (Array.isArray(subs) ? subs : []).filter(
          (s: any) => (s.code ?? '').trim().toLowerCase() === (agg?.record.subcontractorId ?? '').trim().toLowerCase(),
        );
        return match.flatMap((s: any) =>
          (raw[s.id] || []).map((c: any) => ({ ...c, projectName: p.projectName, projectId: p.projectId })),
        );
      } catch {
        return [];
      }
    }),
    [agg],
  );

  useEffect(() => {
    if (companyId && internalId) setContacts(readContacts(companyId, internalId));
  }, [companyId, internalId]);

  // ── Performance KPI Engine ──
  // One reference per subcontract assignment. The engine reads the commercial
  // and delay data itself; nothing is recalculated here.
  const [perfVersion, setPerfVersion] = useState(0);

  const perfRefs: AssignmentRef[] = useMemo(
    () => (agg?.projects ?? []).map(p => ({
      projectId: p.projectId,
      subId: p.subId,
      projectName: p.projectName,
      projectCode: p.projectCode,
      trade: p.trade,
      contractValue: p.contractValue,
    })),
    [agg],
  );

  // Feeds the existing KPI tile. null while nothing has been evaluated.
  const engineResult = useMemo(
    () => evaluateCompany(perfRefs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perfRefs, perfVersion],
  );
  const engineScore = engineResult.scored ? engineResult.score : null;

  /**
   * LD exposure and Approved Finish Date per assignment, for the contract
   * strips. Read-only: the same functions the project panel already uses.
   */
  const scheduleByProject = useMemo(() => {
    const m = new Map<string, {
      ldExposure: number; approvedFinish: string; commencementDate: string;
    }>();
    perfRefs.forEach(ref => {
      const c = readCommercial(ref.projectId, ref.subId);
      const l = computeSubLd(c, rollupCommercial(c));
      const sc = computeSubSchedule(c, l);
      m.set(`${ref.projectId}::${ref.subId}`, {
        ldExposure: l.ldExposure,
        approvedFinish: sc.approvedFinish,
        commencementDate: sc.commencementDate,
      });
    });
    return m;
  }, [perfRefs]);

  /** Per-assignment engine score for the Projects table. null = not evaluated. */
  const engineByProject = useMemo(() => {
    const m = new Map<string, number | null>();
    engineResult.assignments.forEach(a => {
      m.set(`${a.projectId}::${a.subId}`, a.scored ? a.score : null);
    });
    return m;
  }, [engineResult]);

  if (!company || !agg) {
    return (
      <div className="pg pg-stack">
        <div className="ds-empty">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <Clock className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <p className="font-serif text-xl text-muted-foreground mb-2">
            {isRtl ? 'مقاول الباطن غير موجود' : 'Subcontractor Not Found'}
          </p>
        </div>
      </div>
    );
  }

  const r = agg.record;

  // Derived rows have no registry entry — nothing to persist against.
  const canEditContacts = user?.role === 'admin' && !agg.isDerived;

  const persist = (next: RegistryContact[]) => {
    setContacts(next);
    saveContacts(companyId, internalId, next);
  };

  const blankDraft = { name: '', position: '', mobile: '', email: '' };

  const validate = (): string => {
    if (!draft.name.trim()) return isRtl ? 'الاسم مطلوب' : 'Name is required';
    if (!draft.mobile.trim()) return isRtl ? 'رقم الهاتف مطلوب' : 'Mobile is required';
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      return isRtl ? 'صيغة الإيميل غير صحيحة' : 'Invalid email format';
    }
    return '';
  };

  const submitContact = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setContactError(err); return; }
    setContactError('');

    const clean = {
      name: draft.name.trim(),
      position: draft.position.trim(),
      mobile: draft.mobile.trim(),
      email: draft.email.trim(),
    };

    if (editingId) {
      persist(contacts.map(c => (c.id === editingId ? { ...c, ...clean } : c)));
      setEditingId(null);
    } else {
      persist([...contacts, { id: newContactId(), ...clean }]);
    }
    setDraft(blankDraft);
    setShowContactForm(false);
  };

  const startEdit = (c: RegistryContact) => {
    setEditingId(c.id);
    setDraft({ name: c.name, position: c.position, mobile: c.mobile, email: c.email });
    setContactError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(blankDraft);
    setContactError('');
  };

  const removeContact = (cid: string) => {
    persist(contacts.filter(c => c.id !== cid));
    if (editingId === cid) cancelEdit();
  };

  /**
   * Navigate to the subcontract inside its project.
   * The project owns the data; the dashboard only points at it.
   * ProjectDashboard listens for `pactum-navigate` to open the right tab.
   */
  const openSubcontract = (projectId: string, subId: string) => {
    setLocation(`/project/${projectId}`);
    // Fired after the route renders so the listener exists.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('pactum-navigate', {
        detail: { projectId, tab: 'subs', subId, view: 'commercial' },
      }));
    }, 120);
  };

  const tabLabel = (tab: typeof TABS[0]) => (isRtl ? tab.ar : tab.en);

  return (
    <div className="min-h-full w-full bg-background">
      <ContextBar
        items={[
          { label: 'Enterprise Portfolio', href: '/enterprise-portfolio' },
          { label: company.name, href: `/company/${companyId}` },
          { label: isRtl ? 'مقاولو الباطن' : 'Subcontractors', href: `/company/${companyId}/subcontractors` },
          { label: r.companyName },
        ]}
      />
      <div className="pg pg-stack">

        {/* ── Header — mirrors ProjectDashboardPage ── */}
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="font-mono text-(length:--t-micro) text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 inline-block mb-2">
              {r.subcontractorId}
            </div>
            <h2 className="font-serif text-3xl text-white leading-tight">{r.companyName}</h2>
            <p className="text-(length:--t-body) text-primary/70 mt-1">
              {isRtl ? 'الترتيب' : 'Rank'} #{agg.rank} · {agg.trades.join(' · ') || '—'}
            </p>
            {agg.isDerived && (
              <p className="text-(length:--t-second) text-muted-foreground italic mt-1">
                {isRtl
                  ? 'مشتق من إسنادات المشاريع — غير مسجل في سجل الشركة بعد.'
                  : 'Derived from project assignments — not yet in the company registry.'}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="p-4 border border-white/[0.06] bg-black/10">
              <div className="text-(length:--t-label) uppercase text-white/45">{isRtl ? 'قيمة العقود' : 'Contract Value'}</div>
              <div className="font-mono text-white text-xs number-ltr">{formatMoney(agg.totalContractValue, { currency: ccy })}</div>
            </div>
            {/* KPI tile — same place, same shape. Value now comes from the
                Performance KPI Engine (contract-weighted overall score). */}
            <div className="p-4 border border-white/[0.06] bg-black/10">
              <div className="text-(length:--t-label) uppercase text-white/45">KPI</div>
              <div className={cn('font-mono text-xs number-ltr', kpiColor(engineScore ?? 0))}>
                {engineScore === null ? '—' : engineScore}
              </div>
            </div>
            <div className="p-4 border border-white/[0.06] bg-black/10">
              <div className="text-(length:--t-label) uppercase text-white/45">{isRtl ? 'الحالة' : 'Status'}</div>
              <div className="flex items-center gap-2">
                <div className={cn('w-2.5 h-2.5 rounded-full', r.status === 'Active' ? 'bg-emerald-500' : 'bg-white/30')} />
                <span className="text-(length:--t-label) uppercase font-bold tracking-wider text-white/50">{r.status}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tabs — identical pattern to ProjectDashboardPage ── */}
        <div className="mb-6 overflow-x-auto">
          <nav className="inline-flex gap-2 pb-2">
            {TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 text-sm transition-all whitespace-nowrap border border-white/[0.06] rounded-md',
                    active
                      ? 'bg-primary/10 text-primary border-primary'
                      : 'text-white/60 hover:text-white hover:border-white/20 hover:bg-white/5'
                  )}
                >
                  <tab.icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-primary' : 'text-white/50')} />
                  <span>{tabLabel(tab)}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="bg-black/10 border border-white/[0.04] p-4">

          {/* ══ OVERVIEW ══ */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/[0.04]">
                {[
                  { label: isRtl ? 'العقود' : 'Contracts', val: String(agg.contractsCount) },
                  { label: isRtl ? 'المشاريع' : 'Projects', val: String(agg.projectsCount) },
                  { label: isRtl ? 'القطاعات' : 'Sectors', val: String(agg.sectors.length) },
                  { label: isRtl ? 'التخصصات' : 'Trades', val: String(agg.trades.length) },
                ].map((k, i) => (
                  <div key={i} className="bg-black/20 p-4">
                    <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{k.label}</div>
                    <div className="text-lg font-mono text-white number-ltr">{k.val}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-white/[0.06] bg-black/10 p-5">
                  <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-3">{isRtl ? 'التخصصات' : 'Trades'}</div>
                  <div className="flex flex-wrap gap-2">
                    {agg.trades.length === 0
                      ? <span className="text-xs text-muted-foreground italic">—</span>
                      : agg.trades.map(t => (
                        <span key={t} className="text-(length:--t-micro) uppercase tracking-widest px-2 py-1 border border-white/10 text-muted-foreground bg-white/5">{t}</span>
                      ))}
                  </div>
                </div>
                <div className="border border-white/[0.06] bg-black/10 p-5">
                  <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-3">{isRtl ? 'القطاعات' : 'Sectors'}</div>
                  <div className="flex flex-wrap gap-2">
                    {agg.sectors.length === 0
                      ? <span className="text-xs text-muted-foreground italic">—</span>
                      : agg.sectors.map(s => (
                        <span key={s.id} className="text-(length:--t-micro) uppercase tracking-widest px-2 py-1 border border-primary/20 text-primary/80 bg-primary/5">{s.name}</span>
                      ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-white/[0.04]">
                {[
                  { label: isRtl ? 'العقد الأصلي' : 'Original Contract', val: formatMoney(agg.totalOriginalContract, { currency: ccy }), c: 'text-white' },
                  { label: isRtl ? 'أوامر التغيير' : 'Change Orders', val: formatMoney(agg.totalApprovedChangeOrders, { currency: ccy }), c: agg.totalApprovedChangeOrders < 0 ? 'text-chart-3' : 'text-chart-4' },
                  { label: isRtl ? 'العقد الحالي' : 'Current Contract', val: formatMoney(agg.totalCurrentContract, { currency: ccy }), c: 'text-primary' },
                  { label: isRtl ? 'المطالبات' : 'Claims', val: formatMoney(agg.totalApprovedClaims, { currency: ccy }), c: 'text-white' },
                  { label: isRtl ? 'التمديد المعتمد' : 'Approved EOT', val: agg.totalApprovedEotDays > 0 ? `${agg.totalApprovedEotDays}d` : '—', c: agg.totalApprovedEotDays > 0 ? 'text-chart-5' : 'text-muted-foreground' },
                  { label: isRtl ? 'المعتمد' : 'Certified', val: formatMoney(agg.totalCertified, { currency: ccy }), c: 'text-chart-4' },
                  { label: isRtl ? 'المستحق' : 'Outstanding', val: formatMoney(agg.totalOutstanding, { currency: ccy }), c: 'text-chart-3' },
                  { label: isRtl ? 'متوسط التقدم' : 'Avg Progress', val: formatPercent(agg.overallProgress), c: 'text-primary' },
                  { label: isRtl ? 'أسوأ تأخير' : 'Worst Delay', val: agg.worstDelay > 0 ? `+${agg.worstDelay}d` : '✓', c: agg.worstDelay > 0 ? 'text-chart-5' : 'text-chart-4' },
                ].map((k, i) => (
                  <div key={i} className="bg-black/20 p-4">
                    <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{k.label}</div>
                    <div className={cn('text-sm font-mono number-ltr font-semibold', k.c)}>{k.val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ CONTACTS ══ */}
          {activeTab === 'contacts' && (
            !canEditContacts && agg.isDerived ? (
              <div className="text-center py-16">
                <Users className="w-8 h-8 text-primary/40 mx-auto mb-3" />
                <p className="text-sm text-white mb-1">
                  {isRtl
                    ? 'يجب تسجيل مقاول الباطن قبل إدارة جهات التواصل.'
                    : 'This subcontractor must be registered before contacts can be managed.'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isRtl
                    ? 'التسجيل يتم من: الشركة ← مقاولو الباطن ← إضافة مقاول باطن'
                    : 'Register from: Company → Subcontractors → Add Subcontractor'}
                </p>
              </div>
            ) : (
            <div className="space-y-4">
              {/* Title + Add */}
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-serif uppercase tracking-widest text-primary">
                  {isRtl ? 'جهات التواصل' : 'Contacts'}
                  <span className="text-muted-foreground ms-2 font-sans normal-case tracking-normal text-xs">
                    ({contacts.length})
                  </span>
                </h3>
                {canEditContacts && !editingId && (
                  <button
                    onClick={() => { setEditingId(null); setDraft(blankDraft); setContactError(''); setShowContactForm(v => !v); }}
                    className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 text-xs hover:bg-primary hover:text-primary-foreground transition-colors uppercase tracking-wider"
                  >
                    <Plus className="w-3 h-3" /> {isRtl ? 'إضافة جهة تواصل' : 'Add Contact'}
                  </button>
                )}
              </div>

              {/* Form — add or edit */}
              {canEditContacts && (showContactForm || editingId) && (
                <form onSubmit={submitContact} className="pactum-card bg-black/60 p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <input
                    placeholder={isRtl ? 'الاسم *' : 'Name *'}
                    value={draft.name}
                    onChange={e => setDraft({ ...draft, name: e.target.value })}
                    className="bg-black border border-white/10 px-3 py-1.5 text-sm"
                  />
                  <input
                    placeholder={isRtl ? 'الوظيفة' : 'Position'}
                    value={draft.position}
                    onChange={e => setDraft({ ...draft, position: e.target.value })}
                    className="bg-black border border-white/10 px-3 py-1.5 text-sm"
                  />
                  <input
                    placeholder={isRtl ? 'رقم الهاتف *' : 'Mobile *'}
                    value={draft.mobile}
                    onChange={e => setDraft({ ...draft, mobile: e.target.value })}
                    dir="ltr"
                    className="bg-black border border-white/10 px-3 py-1.5 text-sm font-mono"
                  />
                  <input
                    placeholder={isRtl ? 'الإيميل' : 'Email'}
                    value={draft.email}
                    onChange={e => setDraft({ ...draft, email: e.target.value })}
                    dir="ltr"
                    className="bg-black border border-white/10 px-3 py-1.5 text-sm"
                  />
                  <div className="col-span-2 md:col-span-4 flex gap-2 justify-end items-center">
                    {contactError && <p className="text-destructive text-xs me-auto">{contactError}</p>}
                    <button
                      type="button"
                      onClick={() => { cancelEdit(); setShowContactForm(false); }}
                      className="px-3 py-1.5 text-xs border border-white/10 text-muted-foreground hover:text-white"
                    >
                      {isRtl ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button type="submit" className="bg-primary text-primary-foreground px-4 py-1.5 text-xs uppercase tracking-wider">
                      {editingId ? (isRtl ? 'حفظ' : 'Save') : (isRtl ? 'إضافة' : 'Add')}
                    </button>
                  </div>
                </form>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[600px]">
                  <thead className="text-(length:--t-label) uppercase bg-black/60 text-muted-foreground border-b border-white/10">
                    <tr>
                      <th className="px-3 py-2 text-start">{isRtl ? 'الاسم' : 'Name'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'الوظيفة' : 'Position'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'رقم الهاتف' : 'Mobile'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'الإيميل' : 'Email'}</th>
                      {canEditContacts && <th className="px-3 py-2 text-start w-20">{isRtl ? 'إجراءات' : 'Actions'}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.length === 0 && (
                      <tr>
                        <td colSpan={canEditContacts ? 5 : 4} className="px-3 py-4 text-center text-muted-foreground italic">
                          {isRtl ? 'لا توجد جهات تواصل.' : 'No contacts yet.'}
                        </td>
                      </tr>
                    )}
                    {contacts.map(c => (
                      <tr key={c.id} className={cn(
                        'border-b border-white/5 hover:bg-white/[0.03] last:border-0 transition-colors',
                        editingId === c.id && 'bg-primary/[0.06]',
                      )}>
                        <td className="px-3 py-2 text-white">{c.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{c.position || '—'}</td>
                        <td className="px-3 py-2 font-mono text-white number-ltr">
                          {c.mobile
                            ? <a href={`tel:${c.mobile}`} className="hover:text-primary transition-colors">{c.mobile}</a>
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {c.email
                            ? <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a>
                            : '—'}
                        </td>
                        {canEditContacts && (
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => { startEdit(c); setShowContactForm(false); }}
                                className="text-muted-foreground hover:text-primary transition-colors"
                                title={isRtl ? 'تعديل' : 'Edit'}
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => removeContact(c.id)}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                title={isRtl ? 'حذف' : 'Delete'}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )
          )}

          {/* ══ PROJECTS ══ */}
          {activeTab === 'projects' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[700px]">
                <thead className="text-(length:--t-label) uppercase bg-black/60 text-muted-foreground border-b border-white/10">
                  <tr>
                    <th className="px-3 py-2 text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'القطاع' : 'Sector'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'التخصص' : 'Trade'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'التقدم' : 'Progress'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'التأخير' : 'Delay'}</th>
                    <th className="px-3 py-2 text-start">KPI</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'قيمة العقد' : 'Contract Value'}</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.projects.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground italic">
                      {isRtl ? 'لا توجد مشاريع.' : 'No projects.'}
                    </td></tr>
                  )}
                  {agg.projects.map((p, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03] last:border-0 transition-colors">
                      <td className="px-3 py-2">
                        <span
                          onClick={() => openSubcontract(p.projectId, p.subId)}
                          className="text-primary hover:underline cursor-pointer"
                        >
                          {p.projectName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.sectorName ?? '—'}</td>
                      <td className="px-3 py-2 text-white">{p.trade || '—'}</td>
                      <td className="px-3 py-2 font-mono text-white number-ltr">{formatPercent(p.progressPct)}</td>
                      <td className={cn('px-3 py-2 font-mono number-ltr', p.delayDays > 0 ? 'text-chart-5' : 'text-chart-4')}>
                        {p.delayDays > 0 ? `+${p.delayDays}d` : '✓'}
                      </td>
                      {/* KPI = Performance Engine score for this assignment. */}
                      {(() => {
                        const s = engineByProject.get(`${p.projectId}::${p.subId}`) ?? null;
                        return (
                          <td className={cn('px-3 py-2 font-mono number-ltr', kpiColor(s ?? 0))}>
                            {s === null ? '—' : s}
                          </td>
                        );
                      })()}
                      <td className="px-3 py-2 font-mono text-white number-ltr">{formatMoney(p.contractValue, { currency: ccy })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ══ CONTRACTS — one row per assignment ══ */}
          {activeTab === 'contracts' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[800px]">
                <thead className="text-(length:--t-label) uppercase bg-black/60 text-muted-foreground border-b border-white/10">
                  <tr>
                    <th className="px-3 py-2 text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'التخصص' : 'Trade'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'العقد الأصلي' : 'Original Contract'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'العقد الحالي' : 'Current Contract'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'الاحتجاز (العقد)' : 'Retention (Contract)'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'المحتجز فعلياً' : 'Retention Held'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'المعتمد' : 'Certified'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'المستحق' : 'Outstanding'}</th>
                    <th className="px-3 py-2 text-start">{isRtl ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.projects.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-4 text-center text-muted-foreground italic">
                      {isRtl ? 'لا توجد عقود.' : 'No contracts.'}
                    </td></tr>
                  )}
                  {agg.projects.map((p, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03] last:border-0 transition-colors">
                      <td className="px-3 py-2">
                        <span
                          onClick={() => openSubcontract(p.projectId, p.subId)}
                          className="text-primary hover:underline cursor-pointer"
                        >
                          {p.projectName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-white">{p.trade || '—'}</td>
                      <td className="px-3 py-2 font-mono text-white number-ltr">{formatMoney(p.originalContractValue, { currency: ccy })}</td>
                      <td className="px-3 py-2 font-mono text-primary number-ltr">{formatMoney(p.currentContractValue, { currency: ccy })}</td>
                      <td className="px-3 py-2 font-mono text-chart-5 number-ltr">{formatMoney(p.retention, { currency: ccy })}</td>
                      <td className="px-3 py-2 font-mono text-chart-5 number-ltr">{formatMoney(p.retentionHeld, { currency: ccy })}</td>
                      <td className="px-3 py-2 font-mono text-chart-4 number-ltr">{formatMoney(p.certified, { currency: ccy })}</td>
                      <td className="px-3 py-2 font-mono text-chart-3 number-ltr">{formatMoney(p.outstanding, { currency: ccy })}</td>
                      <td className="px-3 py-2">
                        <span className="text-(length:--t-micro) uppercase font-bold tracking-widest px-2 py-1 border border-white/10 text-muted-foreground bg-white/5">
                          {p.executionStatus || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ══ COMMERCIAL — aggregation only. Source of truth = project subcontract ══ */}
          {activeTab === 'commercial' && (
            <div className="space-y-6">

              {/* Rollup across every project — same component as the project view */}
              <SubContractSummary ccy={ccy}
                originalContract={agg.totalOriginalContract}
                approvedChangeOrders={agg.totalApprovedChangeOrders}
                pendingChangeOrders={agg.totalPendingChangeOrders}
                currentContract={agg.totalCurrentContract}
                approvedClaims={agg.totalApprovedClaims}
                approvedEotDays={agg.totalApprovedEotDays}
                certified={agg.totalCertified}
                paid={agg.totalPaid}
                outstanding={agg.totalOutstanding}
                retentionHeld={agg.totalRetentionHeld}
                retentionContract={agg.totalRetentionContract}
                variant="full"
              />

              {/* Latest activity across every project */}
              <LatestActivity ccy={ccy}
                latestChangeOrder={agg.latestChangeOrder}
                latestClaim={agg.latestClaim}
                latestEot={agg.latestEot}
              />

              <p className="text-(length:--t-second) text-muted-foreground italic">
                {isRtl
                  ? 'عرض وتجميع فقط. تُحرَّر البيانات التجارية داخل عقد الباطن في المشروع.'
                  : 'Read-only rollup. Commercial data is edited inside the project subcontract.'}
              </p>


              {/* Per-project contract cards — each project keeps its OWN contract data */}
              <div className="space-y-3">
                <h3 className="text-sm font-serif uppercase tracking-widest text-primary">
                  {isRtl ? 'العقود حسب المشروع' : 'Contracts by Project'}
                  <span className="text-muted-foreground ms-2 font-sans normal-case tracking-normal text-xs">
                    ({agg.projects.length})
                  </span>
                </h3>

                {agg.projects.map((p, i) => (
                  <div key={i} className="pactum-card bg-black/20 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                      <div className="min-w-0">
                        <div
                          onClick={() => openSubcontract(p.projectId, p.subId)}
                          className="font-serif text-base text-primary hover:underline cursor-pointer truncate"
                        >
                          {p.projectName}
                        </div>
                        <div className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground mt-0.5">
                          {p.projectCode ? `${p.projectCode} · ` : ''}{p.trade || '—'}
                          {p.sectorName ? ` · ${p.sectorName}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => openSubcontract(p.projectId, p.subId)}
                        title={isRtl ? 'فتح عقد الباطن في المشروع' : 'Open subcontract in project'}
                        className="flex items-center gap-2 text-(length:--t-label) uppercase tracking-[0.2em] text-primary/60 border border-primary/20 px-3 py-1.5 hover:bg-primary hover:text-primary-foreground transition-colors flex-shrink-0"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {isRtl ? 'إدارة' : 'Manage'}
                      </button>
                    </div>

                    <SubContractSummary ccy={ccy}
                      originalContract={p.originalContractValue}
                      approvedChangeOrders={p.approvedChangeOrders}
                      pendingChangeOrders={p.pendingChangeOrders}
                      currentContract={p.currentContractValue}
                      approvedClaims={p.approvedClaims}
                      approvedEotDays={p.approvedEotDays}
                      certified={p.certified}
                      paid={p.paidToDate}
                      outstanding={p.outstanding}
                      retentionHeld={p.retentionHeld}
                      retentionContract={p.retention}
                      ldExposure={scheduleByProject.get(`${p.projectId}::${p.subId}`)?.ldExposure}
                      approvedFinish={scheduleByProject.get(`${p.projectId}::${p.subId}`)?.approvedFinish}
                      commencementDate={scheduleByProject.get(`${p.projectId}::${p.subId}`)?.commencementDate}
                      variant="full"
                    />

                    {(p.latestChangeOrder || p.latestClaim || p.latestEot) && (
                      <LatestActivity ccy={ccy}
                        latestChangeOrder={p.latestChangeOrder}
                        latestClaim={p.latestClaim}
                        latestEot={p.latestEot}
                        className="border-t border-white/5"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Per-project breakdown */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[980px]">
                  <thead className="text-(length:--t-label) uppercase bg-black/60 text-muted-foreground border-b border-white/10">
                    <tr>
                      <th className="px-3 py-2 text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'التخصص' : 'Trade'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'العقد الأصلي' : 'Original'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'أوامر التغيير' : 'Change Orders'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'العقد الحالي' : 'Current'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'المعتمد' : 'Certified'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'المدفوع' : 'Paid'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'المستحق' : 'Outstanding'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'المطالبات' : 'Claims'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'التمديد' : 'EOT'}</th>
                      <th className="px-3 py-2 text-start w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {agg.projects.length === 0 && (
                      <tr><td colSpan={11} className="px-3 py-4 text-center text-muted-foreground italic">
                        {isRtl ? 'لا توجد عقود.' : 'No contracts.'}
                      </td></tr>
                    )}
                    {agg.projects.map((p, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03] last:border-0 transition-colors">
                        <td className="px-3 py-2">
                          <span
                            onClick={() => openSubcontract(p.projectId, p.subId)}
                            className="text-primary hover:underline cursor-pointer"
                          >
                            {p.projectName}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-white">{p.trade || '—'}</td>
                        <td className="px-3 py-2 font-mono text-white number-ltr">{formatMoney(p.originalContractValue, { currency: ccy })}</td>
                        <td className={cn('px-3 py-2 font-mono number-ltr',
                          p.approvedChangeOrders < 0 ? 'text-chart-3' : p.approvedChangeOrders > 0 ? 'text-chart-4' : 'text-muted-foreground')}>
                          {formatMoney(p.approvedChangeOrders, { currency: ccy })}
                        </td>
                        <td className="px-3 py-2 font-mono text-primary number-ltr">{formatMoney(p.currentContractValue, { currency: ccy })}</td>
                        <td className="px-3 py-2 font-mono text-primary number-ltr">{formatMoney(p.certified, { currency: ccy })}</td>
                        <td className="px-3 py-2 font-mono text-chart-4 number-ltr">{formatMoney(p.paidToDate, { currency: ccy })}</td>
                        <td className="px-3 py-2 font-mono text-chart-3 number-ltr">{formatMoney(p.outstanding, { currency: ccy })}</td>
                        <td className="px-3 py-2 font-mono text-white number-ltr">{formatMoney(p.approvedClaims, { currency: ccy })}</td>
                        <td className="px-3 py-2 font-mono text-chart-5 number-ltr">
                          {p.approvedEotDays > 0 ? `${p.approvedEotDays}d` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => openSubcontract(p.projectId, p.subId)}
                            title={isRtl ? 'فتح عقد الباطن في المشروع' : 'Open subcontract in project'}
                            className="text-muted-foreground hover:text-primary transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══ CERTIFICATES — read from project storage, never written ══ */}
          {activeTab === 'certificates' && (
            <div className="space-y-3">
              <p className="text-(length:--t-second) text-muted-foreground italic">
                {isRtl
                  ? 'الشهادات مملوكة للمشاريع. التعديل من داخل المشروع فقط.'
                  : 'Certificates are project-owned. Edit them inside the project.'}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[800px]">
                  <thead className="text-(length:--t-label) uppercase bg-black/60 text-muted-foreground border-b border-white/10">
                    <tr>
                      <th className="px-3 py-2 text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                      <th className="px-3 py-2 text-start">Cert No.</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'الفترة' : 'Period'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'الإجمالي' : 'Gross'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'المحتجز' : 'Retention'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'الصافي' : 'Net Payable'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'المدفوع' : 'Paid'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'المتبقي' : 'Remaining'}</th>
                      <th className="px-3 py-2 text-start">{isRtl ? 'الحالة' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allCerts.length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-4 text-center text-muted-foreground italic">
                        {isRtl ? 'لا توجد شهادات.' : 'No certificates.'}
                      </td></tr>
                    )}
                    {allCerts.map((c: any, i: number) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03] last:border-0 transition-colors">
                        <td className="px-3 py-2">
                          <Link href={`/project/${c.projectId}`}>
                            <span className="text-primary hover:underline cursor-pointer">{c.projectName}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2 font-mono text-primary">{c.certNo}</td>
                        <td className="px-3 py-2 text-white">{c.period}</td>
                        <td className="px-3 py-2 font-mono text-white number-ltr">{formatMoney(c.grossAmount, { currency: ccy })}</td>
                        <td className="px-3 py-2 font-mono text-chart-5 number-ltr">{formatMoney(c.retentionHeld, { currency: ccy })}</td>
                        <td className="px-3 py-2 font-mono text-white number-ltr">{formatMoney(c.netPayable, { currency: ccy })}</td>
                        <td className="px-3 py-2 font-mono text-chart-4 number-ltr">{formatMoney(c.paidAmount, { currency: ccy })}</td>
                        <td className="px-3 py-2 font-mono text-chart-3 number-ltr">{formatMoney(c.remainingAmount, { currency: ccy })}</td>
                        <td className="px-3 py-2">
                          <span className={cn('px-1.5 py-0.5 text-(length:--t-second) uppercase font-bold tracking-widest border rounded-full',
                            c.status === 'paid' ? 'bg-chart-4/10 text-chart-4 border-chart-4/30'
                            : c.status === 'certified' ? 'bg-primary/10 text-primary border-primary/30'
                            : 'bg-white/5 text-muted-foreground border-white/10')}>
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══ CASH FLOW ══ */}
          {activeTab === 'cashflow' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-white/[0.04]">
                {[
                  { label: isRtl ? 'المعتمد' : 'Certified', val: formatMoney(agg.totalCertified, { currency: ccy }), c: 'text-chart-4' },
                  { label: isRtl ? 'المدفوع' : 'Paid', val: formatMoney(agg.totalPaid, { currency: ccy }), c: 'text-chart-4' },
                  { label: isRtl ? 'المستحق' : 'Outstanding', val: formatMoney(agg.totalOutstanding, { currency: ccy }), c: 'text-chart-3' },
                  { label: isRtl ? 'الاحتجاز (العقد)' : 'Retention (Contract)', val: formatMoney(agg.totalRetentionContract, { currency: ccy }), c: 'text-chart-5' },
                  { label: isRtl ? 'المحتجز فعلياً' : 'Retention Held', val: formatMoney(agg.totalRetentionHeld, { currency: ccy }), c: 'text-chart-5' },
                ].map((k, i) => (
                  <div key={i} className="bg-black/20 p-4">
                    <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{k.label}</div>
                    <div className={cn('text-sm font-mono number-ltr font-semibold', k.c)}>{k.val}</div>
                  </div>
                ))}
              </div>

              <div className="border border-white/[0.06] bg-black/10 p-5">
                <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                  {isRtl ? 'العقود مقابل المعتمد' : 'Contract Value vs Certified'}
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byProject} style={CHART_STYLE}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="code" {...AXIS_PROPS} />
                    <YAxis {...AXIS_PROPS} />
                    <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => formatMoney(Number(v), { currency: ccy })} />
                    <Bar dataKey="value" name="Contract" fill={GOLD} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="certified" name="Certified" fill={GREEN} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ══ PERFORMANCE — Subcontractor Performance KPI Engine ══ */}
          {activeTab === 'performance' && (
            <div className="space-y-6">
              <SubPerformancePanel ccy={ccy}
                refs={perfRefs}
                canEdit={user?.role === 'admin'}
                reviewerName={user?.username ?? ''}
                version={perfVersion}
                onChange={() => setPerfVersion(v => v + 1)}
              />

              {/* Execution context kept from the previous view — current
                  values per project, never labelled as history. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="border border-white/[0.06] bg-black/10 p-5">
                  <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                    {isRtl ? 'التقدم الحالي لكل مشروع' : 'Current Progress by Project'}
                  </p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={perfByProject} style={CHART_STYLE}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="code" {...AXIS_PROPS} />
                      <YAxis domain={[0, 100]} {...AXIS_PROPS} />
                      <Tooltip contentStyle={TT_STYLE} />
                      <Bar dataKey="progress" name="Progress %" fill={GOLD} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="border border-white/[0.06] bg-black/10 p-5">
                  <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                    {isRtl ? 'التأخير الحالي لكل مشروع' : 'Current Delay by Project'}
                  </p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={perfByProject} style={CHART_STYLE}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="code" {...AXIS_PROPS} />
                      <YAxis {...AXIS_PROPS} />
                      <Tooltip contentStyle={TT_STYLE} />
                      <Bar dataKey="delay" name="Delay (days)" fill={RED} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* ══ ANALYTICS ══ */}
          {activeTab === 'analytics' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-white/[0.06] bg-black/10 p-5">
                <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                  {isRtl ? 'القيمة حسب القطاع' : 'Contract Value by Sector'}
                </p>
                {bySector.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart style={CHART_STYLE}>
                      <Pie data={bySector} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        outerRadius={75} innerRadius={35} paddingAngle={2}
                        label={({ name }) => name} labelLine={{ stroke: 'rgba(255,255,255,0.2)' }}>
                        {bySector.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => formatMoney(Number(v), { currency: ccy })} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-white/20 text-sm">—</div>
                )}
              </div>

              <div className="border border-white/[0.06] bg-black/10 p-5">
                <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                  {isRtl ? 'القيمة حسب التخصص' : 'Contract Value by Trade'}
                </p>
                {byTrade.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart style={CHART_STYLE}>
                      <Pie data={byTrade} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        outerRadius={75} innerRadius={35} paddingAngle={2}
                        label={({ name }) => name} labelLine={{ stroke: 'rgba(255,255,255,0.2)' }}>
                        {byTrade.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => formatMoney(Number(v), { currency: ccy })} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-white/20 text-sm">—</div>
                )}
              </div>

              <div className="border border-white/[0.06] bg-black/10 p-5 lg:col-span-2">
                <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                  {isRtl ? 'القيمة حسب المشروع' : 'Contract Value by Project'}
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byProject} style={CHART_STYLE}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="code" {...AXIS_PROPS} />
                    <YAxis {...AXIS_PROPS} />
                    <Tooltip contentStyle={TT_STYLE} formatter={(v: any) => formatMoney(Number(v), { currency: ccy })} />
                    <Bar dataKey="value" name="Contract Value" fill={GOLD} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
