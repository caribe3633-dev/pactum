import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { readCurrencySettings } from '../lib/currency';
import ContextBar from '../components/ContextBar';
import CompanyTabs from '../components/CompanyTabs';
import { EditableText, EditableSelect } from '../components/EditableCell';
import { findCompanyById } from '../mock/companies';
import { findSectorsByCompany } from '../mock/sectors';
import { useProjects, useAuth } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { formatMoney, formatPercent, cn } from '../lib/utils';
import { getCompanyMeta } from '../lib/entityMeta';
import {
  readRegistry,
  createRegistrySubcontractor,
  updateRegistrySubcontractor,
  deleteRegistrySubcontractor,
  isDuplicateCode,
  aggregateRegistry,
  countProjectAssignments,
  RegistryAggregate,
} from '../lib/subcontractors';
import {
  Clock, HardHat, Plus, Trash2, Star, ChevronDown, ChevronUp, Award, LayoutDashboard,
} from 'lucide-react';
import { evaluateCompany } from '../lib/subPerformance';
// PHASE 3F-UX Task 2 — live master data: re-renders on any registry write.
import { useCompany, useCompanySectors } from '../lib/useMasterData';

const STATUS_OPTS = [
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
];

function getPerformanceColor(score: number) {
  if (score >= 80) return 'text-chart-4';
  if (score >= 60) return 'text-chart-5';
  return 'text-chart-3';
}

/**
 * Company Subcontractor Registry — master data only.
 *
 *   Company -> Subcontractor Registry (identity)
 *   Project -> Assignment -> Contract -> Certificates (execution)
 *
 * Editable here: subcontractorId | companyName | status
 * Everything else is derived read-only from this company's projects.
 *
 * Route: /company/:id/subcontractors
 */
export default function CompanySubcontractorsPage({ params }: any) {
  const id = params?.id || 'unknown';
  // SPRINT 3 · R5 — see SubcontractorDashboardPage: company-scoped screen,
  // one reporting currency for every figure on it.
  const ccy = readCurrencySettings(params?.id || '').baseCurrency;
  const company = useCompany(id);
  const sectors = useCompanySectors(id);
  const { projects } = useProjects();
  const { user } = useAuth();
  const { lang } = useTranslation();
  const [, setLocation] = useLocation();

  const isRtl = lang === 'ar';
  const canEdit = user?.role === 'admin';

  const [isAdding, setIsAdding] = useState(false);
  const [newSub, setNewSub] = useState({ subcontractorId: '', companyName: '', status: 'Active' });
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // re-read registry after writes

  const aggregates: RegistryAggregate[] = useMemo(
    () => (company ? aggregateRegistry(id, projects, sectors) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company, id, projects, sectors, version],
  );

  if (!company) return (
    <div className="min-h-full w-full bg-background">
      <ContextBar items={[{ label: 'Enterprise Portfolio', href: '/enterprise-portfolio' }, { label: 'Unknown company' }]} />
      <div className="pg pg-stack">
        <div className="ds-empty">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <Clock className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <p className="ds-empty-title">
            {isRtl ? 'الشركة غير موجودة' : 'Company Not Found'}
          </p>
        </div>
      </div>
    </div>
  );

  const meta = getCompanyMeta(id);
  const city = meta.city || company.city;
  const country = meta.country || company.country;
  const location = [city, country].filter(Boolean).join(' • ');

  const refresh = () => setVersion(v => v + 1);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const code = newSub.subcontractorId.trim();
    const name = newSub.companyName.trim();
    if (!code || !name) return;

    // Duplicate check is scoped to THIS company only
    if (isDuplicateCode(id, code)) {
      setError(isRtl
        ? `الكود ${code} مستخدم بالفعل في هذه الشركة`
        : `Code ${code} already exists in this company`);
      return;
    }

    createRegistrySubcontractor(id, {
      subcontractorId: code,
      companyName: name,
      status: newSub.status as 'Active' | 'Inactive',
    });
    setNewSub({ subcontractorId: '', companyName: '', status: 'Active' });
    setIsAdding(false);
    refresh();
  };

  const handleDelete = (agg: RegistryAggregate) => {
    const count = countProjectAssignments(agg.record, projects, sectors);
    if (count > 0) {
      window.alert(isRtl
        ? `مقاول الباطن هذا مسنَد إلى ${count} مشروع.\nأزل إسنادات المشاريع أولاً.`
        : `This subcontractor is assigned to ${count} projects.\nRemove project assignments first.`);
      return;
    }
    deleteRegistrySubcontractor(id, agg.record.internalId);
    refresh();
  };

  const patch = (internalId: string, field: 'subcontractorId' | 'companyName' | 'status', value: string) => {
    if (field === 'subcontractorId' && isDuplicateCode(id, value, internalId)) {
      window.alert(isRtl
        ? `الكود ${value} مستخدم بالفعل في هذه الشركة`
        : `Code ${value} already exists in this company`);
      return;
    }
    updateRegistrySubcontractor(id, internalId, { [field]: value } as any);
    refresh();
  };

  // Company-wide totals — all derived, never stored
  const totalContractValue = aggregates.reduce((a, x) => a + x.totalContractValue, 0);
  const totalCertified = aggregates.reduce((a, x) => a + x.totalCertified, 0);
  const totalOutstanding = aggregates.reduce((a, x) => a + x.totalOutstanding, 0);
  const activeAssignments = aggregates.reduce((a, x) => a + x.contractsCount, 0);
  const projectsUsingSubs = new Set(
    aggregates.flatMap(x => x.projects.map(p => p.projectId)),
  ).size;
  const workingSectors = new Set(
    aggregates.flatMap(x => x.sectors.map(sec => sec.id)),
  ).size;

  return (
    <div className="min-h-full w-full bg-background">

      <ContextBar
        items={[
          { label: 'Enterprise Portfolio', href: '/enterprise-portfolio' },
          { label: company.name, href: `/company/${id}` },
          { label: isRtl ? 'مقاولو الباطن' : 'Subcontractors' },
        ]}
      />

      <div className="pg pg-stack">

      {/* ── Page header — same pattern as Company Sectors ── */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-[1px] w-8 bg-primary/40" />
          <span className="text-(length:--t-label) uppercase tracking-[0.25em] text-primary/60 font-mono">
            {isRtl ? 'مقاولو الباطن' : 'Subcontractors'}
          </span>
        </div>
        <h1 className="font-serif text-3xl md:text-4xl text-white leading-tight">
          {company.name}
        </h1>
        {location && <p className="text-(length:--t-body) text-primary/70 mt-1">{location}</p>}
      </div>

      <CompanyTabs companyId={id} active="subcontractors" />

      {/* ── Top summary — 7 derived metrics ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/[0.04] mb-4">
        {[
          { label: isRtl ? 'المقاولون المسجلون' : 'Registered Subcontractors', val: String(aggregates.length) },
          { label: isRtl ? 'العقود النشطة' : 'Active Assignments', val: String(activeAssignments) },
          { label: isRtl ? 'مشاريع تستخدم مقاولين' : 'Projects Using Subs', val: String(projectsUsingSubs) },
          { label: isRtl ? 'القطاعات' : 'Working Sectors', val: String(workingSectors) },
        ].map((k, i) => (
          <div key={i} className="bg-black/20 p-4">
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{k.label}</div>
            <div className="text-lg font-mono text-white number-ltr">{k.val}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="pactum-card bg-black/30 p-5 border-t-primary border-t-2">
          <div className="text-(length:--t-label) uppercase text-muted-foreground mb-1">
            {isRtl ? 'إجمالي قيمة العقود' : 'Total Contract Value'}
          </div>
          <div className="text-xl font-mono text-primary number-ltr">{formatMoney(totalContractValue, { currency: ccy })}</div>
        </div>
        <div className="pactum-card bg-black/30 p-5 border-t-chart-4 border-t-2">
          <div className="text-(length:--t-label) uppercase text-muted-foreground mb-1">
            {isRtl ? 'إجمالي المعتمد' : 'Total Certified'}
          </div>
          <div className="text-xl font-mono text-chart-4 number-ltr">{formatMoney(totalCertified, { currency: ccy })}</div>
        </div>
        <div className="pactum-card bg-black/30 p-5 border-t-chart-3 border-t-2">
          <div className="text-(length:--t-label) uppercase text-muted-foreground mb-1">
            {isRtl ? 'الرصيد المستحق' : 'Outstanding Balance'}
          </div>
          <div className="text-xl font-mono text-chart-3 number-ltr">{formatMoney(totalOutstanding, { currency: ccy })}</div>
        </div>
      </div>

      {/* ── Title + Add ── */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-serif uppercase tracking-widest text-primary">
          {isRtl ? 'سجل مقاولي الباطن' : 'Subcontractor Registry'}
          <span className="text-muted-foreground ms-2 font-sans normal-case tracking-normal text-xs">
            ({aggregates.length})
          </span>
        </h3>
        {canEdit && (
          <button
            onClick={() => { setIsAdding(!isAdding); setError(''); }}
            className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 text-xs hover:bg-primary hover:text-primary-foreground transition-colors uppercase tracking-wider"
          >
            <Plus className="w-3 h-3" /> {isRtl ? 'مقاول باطن جديد' : 'Add Subcontractor'}
          </button>
        )}
      </div>

      {/* ── Add form — only three editable fields ── */}
      {isAdding && (
        <form onSubmit={handleAdd} className="pactum-card bg-black/60 p-4 grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <input
            placeholder={isRtl ? 'اسم الشركة' : 'Company Name'}
            value={newSub.companyName}
            onChange={e => setNewSub({ ...newSub, companyName: e.target.value })}
            className="col-span-2 bg-black border border-white/10 px-3 py-1.5 text-sm"
            required
          />
          <input
            placeholder={isRtl ? 'كود مقاول الباطن (مثال SC-01)' : 'Subcontractor ID (e.g. SC-01)'}
            value={newSub.subcontractorId}
            onChange={e => setNewSub({ ...newSub, subcontractorId: e.target.value })}
            className="bg-black border border-white/10 px-3 py-1.5 text-sm font-mono"
            required
          />
          <select
            value={newSub.status}
            onChange={e => setNewSub({ ...newSub, status: e.target.value })}
            className="bg-black border border-white/10 px-3 py-1.5 text-sm text-white"
          >
            {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="col-span-2 md:col-span-2 flex gap-2 justify-end items-center">
            {error && <p className="text-destructive text-xs me-auto">{error}</p>}
            <button type="button" onClick={() => { setIsAdding(false); setError(''); }} className="px-3 py-1.5 text-xs border border-white/10 text-muted-foreground hover:text-white">
              {isRtl ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" className="bg-primary text-primary-foreground px-4 py-1.5 text-xs uppercase tracking-wider">
              {isRtl ? 'إضافة' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {/* ── Registry cards — ranked ── */}
      <div className="space-y-4">
        {aggregates.map(agg => {
          const r = agg.record;
          // KPI badge value comes from the Performance KPI Engine — same badge,
          // same position, contract-weighted score across every assignment.
          const perf = evaluateCompany(agg.projects.map(p => ({
            projectId: p.projectId,
            subId: p.subId,
            projectName: p.projectName,
            projectCode: p.projectCode,
            trade: p.trade,
            contractValue: p.contractValue,
          })));
          const perfScore = perf.scored ? perf.score : null;
          const isExpanded = expanded === r.internalId;
          // Derived rows have no registry record — nothing to edit or delete.
          const rowEditable = canEdit && !agg.isDerived;

          return (
            <div key={r.internalId} className="pactum-card bg-black/20 overflow-hidden transition-all duration-300">
              {/* Header */}
              <div
                className="p-4 md:p-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between cursor-pointer hover:bg-black/40"
                onClick={() => setExpanded(isExpanded ? null : r.internalId)}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <HardHat className="w-5 h-5 text-primary/70" />
                  </div>
                  <div className="min-w-0" onClick={e => e.stopPropagation()}>
                    <h4 className="text-base font-serif text-white leading-tight">
                      <EditableText
                        value={r.companyName}
                        onSave={v => patch(r.internalId, 'companyName', v)}
                        canEdit={rowEditable}
                        className="inline-block hover:bg-white/5 px-1"
                      />
                    </h4>
                    <div className="flex items-center gap-1 text-(length:--t-label) uppercase tracking-widest text-primary/70 mt-0.5 flex-wrap">
                      <span>{isRtl ? 'الكود:' : 'ID:'}</span>
                      <EditableText
                        value={r.subcontractorId}
                        onSave={v => patch(r.internalId, 'subcontractorId', v)}
                        canEdit={rowEditable}
                        className="inline-block hover:bg-white/5 px-1 font-mono"
                      />
                      {agg.isDerived && (
                        <>
                          <span>—</span>
                          <span className="text-(length:--t-micro) uppercase tracking-widest px-1.5 py-0.5 border border-white/10 text-muted-foreground bg-white/5 normal-case tracking-normal">
                            {isRtl ? 'من المشاريع' : 'From Projects'}
                          </span>
                        </>
                      )}
                      {agg.trades.length > 0 && (
                        <>
                          <span>—</span>
                          <span className="text-muted-foreground normal-case tracking-normal">
                            {agg.trades.join(' · ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 w-full md:w-auto">
                  {/* Rank */}
                  <div className="text-center hidden md:block">
                    <Award className="w-4 h-4 mx-auto mb-0.5 text-primary/60" />
                    <div className="text-sm font-mono font-bold text-primary number-ltr">#{agg.rank}</div>
                    <div className="text-(length:--t-label) text-muted-foreground uppercase">Rank</div>
                  </div>

                  {/* Progress */}
                  <div className="flex-1 md:w-40">
                    <div className="flex justify-between text-(length:--t-second) text-muted-foreground mb-1">
                      <span>{isRtl ? 'التقدم' : 'Progress'}</span>
                      <span className="font-mono number-ltr">{formatPercent(agg.overallProgress)}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-sm overflow-hidden">
                      <div
                        className={cn('h-full', agg.worstDelay > 0 ? 'bg-chart-5' : 'bg-chart-4')}
                        style={{ width: `${agg.overallProgress * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* KPI */}
                  <div className="text-center hidden md:block">
                    <Star className={cn('w-4 h-4 mx-auto mb-0.5', getPerformanceColor(perfScore ?? 0))} />
                    <div className={cn('text-sm font-mono font-bold number-ltr', getPerformanceColor(perfScore ?? 0))}>
                      {perfScore === null ? '—' : perfScore}
                    </div>
                    <div className="text-(length:--t-label) text-muted-foreground uppercase">KPI</div>
                  </div>

                  {/* Contracts */}
                  <div className="text-center hidden md:block">
                    <div className="text-sm font-mono font-bold text-white number-ltr">{agg.contractsCount}</div>
                    <div className="text-(length:--t-label) text-muted-foreground uppercase">{isRtl ? 'عقود' : 'Contracts'}</div>
                  </div>

                  {/* Projects */}
                  <div className="text-center hidden md:block">
                    <div className="text-sm font-mono font-bold text-white number-ltr">{agg.projectsCount}</div>
                    <div className="text-(length:--t-label) text-muted-foreground uppercase">{isRtl ? 'مشاريع' : 'Projects'}</div>
                  </div>

                  {/* Worst delay */}
                  <div className="text-center hidden md:block">
                    <div className={cn('text-sm font-mono font-bold number-ltr', agg.worstDelay > 0 ? 'text-chart-5' : 'text-chart-4')}>
                      {agg.worstDelay > 0 ? `+${agg.worstDelay}d` : '✓'}
                    </div>
                    <div className="text-(length:--t-label) text-muted-foreground uppercase">{isRtl ? 'أسوأ تأخير' : 'Worst Delay'}</div>
                  </div>

                  {/* Status — editable */}
                  <div onClick={e => e.stopPropagation()}>
                    <EditableSelect
                      value={r.status}
                      options={STATUS_OPTS}
                      onSave={v => patch(r.internalId, 'status', v)}
                      canEdit={rowEditable}
                      className={cn('text-(length:--t-second) uppercase font-bold tracking-widest',
                        r.status === 'Active'
                          ? 'border-chart-4/40 !text-chart-4 bg-chart-4/10'
                          : 'border-chart-3/40 !text-chart-3 bg-chart-3/10')}
                    />
                  </div>

                  {/* View Dashboard — routes by immutable internalId */}
                  <button
                    onClick={e => { e.stopPropagation(); setLocation(`/company/${id}/subcontractors/${r.internalId}`); }}
                    className="flex items-center gap-1.5 text-(length:--t-label) uppercase tracking-[0.2em] text-primary/60 border border-primary/20 px-3 py-2 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors font-medium whitespace-nowrap"
                  >
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    <span className="hidden lg:inline">{isRtl ? 'لوحة المقاول' : 'View Dashboard'}</span>
                  </button>

                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                </div>
              </div>

              {/* Expanded — all derived, read-only */}
              {isExpanded && (
                <div className="border-t border-white/5 bg-black/40">
                  {/* Derived KPI row */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-px border-b border-white/5">
                    {[
                      { label: isRtl ? 'قيمة العقود' : 'Contract Value', val: formatMoney(agg.totalContractValue, { currency: ccy }), color: 'text-white' },
                      { label: isRtl ? 'المعتمد' : 'Total Certified', val: formatMoney(agg.totalCertified, { currency: ccy }), color: 'text-chart-4' },
                      { label: isRtl ? 'المستحق' : 'Outstanding', val: formatMoney(agg.totalOutstanding, { currency: ccy }), color: 'text-chart-3' },
                      { label: isRtl ? 'الشهادات' : 'Certificates', val: String(agg.certificatesCount), color: 'text-primary' },
                      { label: isRtl ? 'آخر شهادة' : 'Latest Cert', val: agg.latestCertificatePeriod ?? '—', color: 'text-muted-foreground' },
                    ].map((kpi, i) => (
                      <div key={i} className="p-4 bg-black/20">
                        <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{kpi.label}</div>
                        <div className={cn('text-sm font-mono number-ltr font-semibold', kpi.color)}>{kpi.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Sectors + trades */}
                  <div className="p-4 border-b border-white/5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-2">
                        {isRtl ? 'القطاعات' : 'Working Sectors'}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {agg.sectors.length === 0
                          ? <span className="text-xs text-muted-foreground italic">—</span>
                          : agg.sectors.map(s => (
                            <span key={s.id} className="text-(length:--t-micro) uppercase tracking-widest px-2 py-1 border border-primary/20 text-primary/80 bg-primary/5">
                              {s.name}
                            </span>
                          ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-2">
                        {isRtl ? 'التخصصات' : 'Trades'}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {agg.trades.length === 0
                          ? <span className="text-xs text-muted-foreground italic">—</span>
                          : agg.trades.map(t => (
                            <span key={t} className="text-(length:--t-micro) uppercase tracking-widest px-2 py-1 border border-white/10 text-muted-foreground bg-white/5">
                              {t}
                            </span>
                          ))}
                      </div>
                    </div>
                  </div>

                  {/* Projects table */}
                  <div className="p-4">
                    <div className="flex justify-between items-center mb-3">
                      <h5 className="text-xs font-serif uppercase tracking-widest text-primary">
                        {isRtl ? 'المشاريع' : 'Working Projects'}
                      </h5>
                      {rowEditable && (
                        <button
                          onClick={() => handleDelete(agg)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1"
                          title={isRtl ? 'حذف من السجل' : 'Delete from registry'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[700px]">
                        <thead className="text-(length:--t-label) uppercase bg-black/60 text-muted-foreground border-b border-white/10">
                          <tr>
                            <th className="px-3 py-2 text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                            <th className="px-3 py-2 text-start">{isRtl ? 'القطاع' : 'Sector'}</th>
                            <th className="px-3 py-2 text-start">{isRtl ? 'التخصص' : 'Trade'}</th>
                            <th className="px-3 py-2 text-start">{isRtl ? 'قيمة العقد' : 'Contract Value'}</th>
                            <th className="px-3 py-2 text-start">{isRtl ? 'المعتمد' : 'Certified'}</th>
                            <th className="px-3 py-2 text-start">{isRtl ? 'المستحق' : 'Outstanding'}</th>
                            <th className="px-3 py-2 text-start">{isRtl ? 'التقدم' : 'Progress'}</th>
                            <th className="px-3 py-2 text-start">{isRtl ? 'التأخير' : 'Delay'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agg.projects.length === 0 && (
                            <tr>
                              <td colSpan={8} className="px-3 py-4 text-center text-muted-foreground italic">
                                {isRtl ? 'غير مسنَد لأي مشروع بعد.' : 'Not assigned to any project yet.'}
                              </td>
                            </tr>
                          )}
                          {agg.projects.map((p, i) => (
                            <tr key={`${p.projectId}-${i}`} className="border-b border-white/5 hover:bg-white/[0.03] last:border-0 transition-colors">
                              <td className="px-3 py-2">
                                <Link href={`/project/${p.projectId}`}>
                                  <span className="text-primary hover:underline cursor-pointer">{p.projectName}</span>
                                </Link>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{p.sectorName ?? '—'}</td>
                              <td className="px-3 py-2 text-white">{p.trade || '—'}</td>
                              <td className="px-3 py-2 font-mono text-white number-ltr">{formatMoney(p.contractValue, { currency: ccy })}</td>
                              <td className="px-3 py-2 font-mono text-chart-4 number-ltr">{formatMoney(p.certified, { currency: ccy })}</td>
                              <td className="px-3 py-2 font-mono text-chart-3 number-ltr">{formatMoney(p.outstanding, { currency: ccy })}</td>
                              <td className="px-3 py-2 font-mono text-white number-ltr">{formatPercent(p.progressPct)}</td>
                              <td className={cn('px-3 py-2 font-mono number-ltr', p.delayDays > 0 ? 'text-chart-5' : 'text-chart-4')}>
                                {p.delayDays > 0 ? `+${p.delayDays}d` : '✓'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {aggregates.length === 0 && (
        <div className="text-center py-24">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <HardHat className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <p className="font-serif text-xl text-muted-foreground mb-2">
            {isRtl ? 'لا يوجد مقاولو باطن' : 'No Subcontractors Registered'}
          </p>
          <p className="text-sm text-muted-foreground">
            {isRtl
              ? 'لا توجد إسنادات في مشاريع هذه الشركة، ولا سجلات في السجل.'
              : 'No assignments in this company\u2019s projects and no registry records.'}
          </p>
        </div>
      )}
    </div>
    </div>
  );
}
