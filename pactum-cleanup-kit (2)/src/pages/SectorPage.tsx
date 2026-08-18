import React from 'react';
import ContextBar from '../components/ContextBar';
import ProjectCard from '../components/ProjectCard';
import { findCompanyById } from '../mock/companies';
import { findSectorById } from '../mock/sectors';
import { useProjects } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { Clock, Plus, AlertTriangle, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../lib/store';
// Create a project FROM the sector it belongs to. Company and sector are
// implied by where the user already is, so neither can be mis-selected.
import { createProject, reportingCurrencyOf, PROJECT_STATUSES } from '../lib/projectMaster';
import { defaultContractCurrencyFor } from '../lib/masterData';
import { CURRENCY_SEED } from '../lib/currency';
// PHASE 3F-UX Task 2 — live master data: re-renders on any registry write.
import { useSector, useCompany } from '../lib/useMasterData';

export default function SectorPage({ params }: any) {
  const id = params?.id;
  const sector = useSector(id);
  const { projects, addProject } = useProjects();
  const { user } = useAuth();
  const { lang } = useTranslation();

  if (!sector) {
    return (
      <div className="pg pg-stack">
        <div className="text-center py-24">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <Clock className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <p className="font-serif text-xl text-muted-foreground mb-2">
            {lang === 'ar' ? 'القطاع غير موجود' : 'Sector Not Found'}
          </p>
        </div>
      </div>
    );
  }

  /**
   * Projects in this sector.
   *
   * `sectorId` on the record is authoritative; `projectIds` is the derived
   * cache and can lag a create by one reconcile. Reading BOTH means a
   * newly added project appears immediately.
   */
  const sectorProjects = projects.filter((p: any) =>
    p.sectorId === sector.id || sector.projectIds.includes(p.id));
  const company = useCompany(sector.companyId);

  // ── Create a project inside THIS sector ──────────────────────────────
  const isRtl = lang === 'ar';
  const canEdit = user?.role === 'admin';
  const [adding, setAdding] = React.useState(false);
  const [errs, setErrs] = React.useState<string[]>([]);
  const [msg, setMsg] = React.useState('');

  /** Inherited from the company — displayed, never entered. */
  const reportingCcy = reportingCurrencyOf(sector.companyId);
  /** Sector default, else the company reporting currency. */
  const suggestedCcy = defaultContractCurrencyFor(sector.companyId, sector.id);

  const [form, setForm] = React.useState({
    nameEn: '', nameAr: '', code: '', cityEn: '',
    // SPRINT 2 — the three currencies plus status are all collected here.
    contractCurrency: '', reportingCurrency: '', workingCurrency: '',
    status: 'Active',
    contractValue: '',
    commencementDate: '', contractualCompletion: '',
  });

  // Pre-fill from the inheritance chain once the sector's default is known.
  //
  //   base      <- sector default, else company reporting
  //   reporting <- company reporting
  //   working   <- base (a project spends in what it is paid in, absent
  //                any statement otherwise)
  //
  // These are DEFAULTS, not locks: every one is editable below, and what
  // the user leaves is what gets STORED on the project — so a later change
  // to the company cannot restate it.
  React.useEffect(() => {
    if (!adding) return;
    setForm(f => ({
      ...f,
      contractCurrency: f.contractCurrency || suggestedCcy || '',
      reportingCurrency: f.reportingCurrency || reportingCcy || '',
      workingCurrency: f.workingCurrency || suggestedCcy || '',
    }));
  }, [adding, suggestedCcy, reportingCcy]);

  const reasonText = (r?: string) => {
    const en: Record<string, string> = {
      'missing-name': 'Project name is required.',
      'missing-code': 'Project code is required.',
      'missing-currency': 'Select a contract currency.',
      'invalid-currency': 'Contract currency is not a valid ISO code.',
      'missing-start-date': 'Start date is required.',
      'missing-finish-date': 'Planned finish is required.',
      'invalid-date': 'Enter a real calendar date.',
      'finish-before-start': 'Planned finish cannot precede the start date.',
      'duplicate-name': 'Another project in this sector already has that name.',
      'duplicate-code': 'That project code is already in use.',
      'missing-reporting-currency': 'Select a reporting currency.',
      'invalid-reporting-currency': 'Reporting currency is not a valid ISO code.',
      'invalid-working-currency': 'Working currency is not a valid ISO code.',
      'missing-status': 'Select a project status.',
      'invalid-status': 'That project status is not recognised.',
    };
    const ar: Record<string, string> = {
      'missing-name': 'اسم المشروع مطلوب.',
      'missing-code': 'رمز المشروع مطلوب.',
      'missing-currency': 'اختر عملة العقد.',
      'invalid-currency': 'رمز العملة غير صالح.',
      'missing-start-date': 'تاريخ البدء مطلوب.',
      'missing-finish-date': 'تاريخ الانتهاء المخطط مطلوب.',
      'invalid-date': 'أدخل تاريخاً صحيحاً.',
      'finish-before-start': 'تاريخ الانتهاء لا يسبق تاريخ البدء.',
      'duplicate-name': 'يوجد مشروع بنفس الاسم في هذا القطاع.',
      'duplicate-code': 'رمز المشروع مستخدم بالفعل.',
      'missing-reporting-currency': 'اختر عملة التقرير.',
      'invalid-reporting-currency': 'رمز عملة التقرير غير صالح.',
      'invalid-working-currency': 'رمز عملة التشغيل غير صالح.',
      'missing-status': 'اختر حالة المشروع.',
      'invalid-status': 'حالة المشروع غير معروفة.',
    };
    return (isRtl ? ar : en)[r ?? ''] ?? (isRtl ? 'تعذّر إنشاء المشروع.' : 'Could not create the project.');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrs([]); setMsg('');
    // Company and sector come from the page, not from a dropdown — the
    // user is already standing inside them, so they cannot mismatch.
    const r = createProject({
      nameEn: form.nameEn, nameAr: form.nameAr, code: form.code,
      companyId: sector.companyId, sectorId: sector.id,
      contractCurrency: form.contractCurrency,
      reportingCurrency: form.reportingCurrency,
      workingCurrency: form.workingCurrency,
      status: form.status as any,
      commencementDate: form.commencementDate,
      contractualCompletion: form.contractualCompletion,
      cityEn: form.cityEn,
      contractValue: Number(form.contractValue) || 0,
      createdBy: user?.username ?? 'unknown',
    }, projects as any);

    if (!r.ok || !r.record) { setErrs(r.fields ?? []); setMsg(reasonText(r.reason)); return; }
    addProject(r.record as any);
    setForm({ nameEn:'', nameAr:'', code:'', cityEn:'',
              contractCurrency:'', reportingCurrency:'', workingCurrency:'',
              status:'Active', contractValue:'',
              commencementDate:'', contractualCompletion:'' });
    setAdding(false);
  };

  const bad = (f: string) =>
    errs.includes(f) ? 'border-chart-3/60 ring-1 ring-chart-3/30' : 'border-white/10';

  return (
    <div className="min-h-full w-full bg-background">

      {/* CONTEXT NAVIGATION BAR */}
      <ContextBar
        parentId={sector.companyId}
        items={[
          { label: 'Enterprise Portfolio', href: '/' },
          { label: company?.name ?? sector.companyId, href: `/company/${sector.companyId}` },
          { label: sector.name },
        ]}
      />

      <div className="pg pg-stack">

      {/* Header — mirrors Project Portal */}
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-[1px] w-8 bg-primary/40" />
            <span className="text-(length:--t-label) uppercase tracking-[0.25em] text-primary/60 font-mono">
              {company?.name ?? 'Sector'}
            </span>
          </div>
          <h1 className="font-serif text-3xl md:text-4xl text-white">
            {sector.name}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-black/30 px-4 py-2 border border-white/5 text-center">
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-0.5">
              {lang === 'ar' ? 'المشاريع' : 'Projects'}
            </div>
            <div className="text-sm font-mono text-white number-ltr">{sectorProjects.length}</div>
          </div>
          {canEdit && (
            <button
              onClick={() => { setAdding(v => !v); setMsg(''); setErrs([]); }}
              className="flex items-center gap-2 bg-primary/10 text-primary border border-primary/30 px-4 py-2 text-xs uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {adding
                ? (isRtl ? 'إلغاء' : 'Cancel')
                : (isRtl ? 'مشروع جديد' : 'New Project')}
            </button>
          )}
        </div>
      </div>

      {/* ── Create a project inside this sector ────────────────────────── */}
      {canEdit && adding && (
        <form onSubmit={submit} dir={isRtl ? 'rtl' : 'ltr'}
              className="mb-8 pactum-card bg-black/40 p-6 grid grid-cols-2 md:grid-cols-4 gap-4">

          {/* Ownership is FIXED by the page — shown, not chosen. */}
          <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-3 pb-3 border-b border-white/[0.04]">
            <span className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'التبعية' : 'Ownership'}
            </span>
            <span className="text-(length:--t-second) text-white">
              {company?.name ?? sector.companyId}
              <span className="text-muted-foreground mx-2">/</span>
              {sector.name}
            </span>
            <span className="ms-auto text-(length:--t-micro) text-muted-foreground">
              {isRtl ? 'عملة التقارير (موروثة): ' : 'Reporting currency (inherited): '}
              <span className="text-primary font-mono number-ltr">{reportingCcy}</span>
            </span>
          </div>

          <input
            placeholder={isRtl ? 'اسم المشروع (EN) *' : 'Project Name (EN) *'}
            value={form.nameEn} onChange={e => setForm({ ...form, nameEn: e.target.value })}
            required dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm', bad('nameEn'))} />

          <input
            placeholder={isRtl ? 'اسم المشروع (AR)' : 'Project Name (AR)'}
            value={form.nameAr} onChange={e => setForm({ ...form, nameAr: e.target.value })}
            dir="rtl" className="bg-black border border-white/10 px-3 py-2 text-sm" />

          <input
            placeholder={isRtl ? 'رمز المشروع *' : 'Project Code *'}
            value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
            required dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('code'))} />

          <input
            placeholder={isRtl ? 'المدينة' : 'City'}
            value={form.cityEn} onChange={e => setForm({ ...form, cityEn: e.target.value })}
            dir="ltr" className="bg-black border border-white/10 px-3 py-2 text-sm" />

          {/* Contract currency — mandatory, pre-filled from the sector default */}
          <select
            value={form.contractCurrency}
            onChange={e => setForm({ ...form, contractCurrency: e.target.value })}
            required dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('contractCurrency'))}
          >
            <option value="">{isRtl ? 'عملة العقد الأساسية *' : 'Base Contract Currency *'}</option>
            {CURRENCY_SEED.filter(c => c.active).map(c => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>

          {/* SPRINT 2 — Reporting currency. Defaults to the company's, but
              is STORED on the project: changing the company later cannot
              restate a project that already exists. */}
          <select
            value={form.reportingCurrency}
            onChange={e => setForm({ ...form, reportingCurrency: e.target.value })}
            required dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('reportingCurrency'))}
          >
            <option value="">{isRtl ? 'عملة التقرير *' : 'Reporting Currency *'}</option>
            {CURRENCY_SEED.filter(c => c.active).map(c => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>

          {/* Working currency — day-to-day site spend. Optional; defaults
              to the base contract currency. */}
          <select
            value={form.workingCurrency}
            onChange={e => setForm({ ...form, workingCurrency: e.target.value })}
            dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('workingCurrency'))}
          >
            <option value="">{isRtl ? 'عملة التشغيل (اختياري)' : 'Working Currency (optional)'}</option>
            {CURRENCY_SEED.filter(c => c.active).map(c => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>

          {/* SPRINT 2 — Status is required. No default is invented: a
              project being created has not necessarily started. */}
          <select
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value })}
            required dir={isRtl ? 'rtl' : 'ltr'}
            className={cn('bg-black border px-3 py-2 text-sm', bad('status'))}
          >
            {PROJECT_STATUSES.map(o => (
              <option key={o.value} value={o.value}>{isRtl ? o.ar : o.en}</option>
            ))}
          </select>

          <input
            type="number"
            placeholder={(isRtl ? 'قيمة العقد' : 'Contract Value')
              + (form.contractCurrency ? ` (${form.contractCurrency})` : '')}
            value={form.contractValue}
            onChange={e => setForm({ ...form, contractValue: e.target.value })}
            dir="ltr" className="bg-black border border-white/10 px-3 py-2 text-sm font-mono" />

          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'تاريخ البدء *' : 'Start Date *'}
            </label>
            <input type="date" value={form.commencementDate}
              onChange={e => setForm({ ...form, commencementDate: e.target.value })}
              required dir="ltr"
              className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('commencementDate'))} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'الانتهاء المخطط *' : 'Planned Finish *'}
            </label>
            <input type="date" value={form.contractualCompletion}
              onChange={e => setForm({ ...form, contractualCompletion: e.target.value })}
              required min={form.commencementDate || undefined} dir="ltr"
              className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('contractualCompletion'))} />
          </div>

          {/* Cross-currency warning — a rate must exist or nothing converts */}
          {form.contractCurrency && reportingCcy && form.contractCurrency !== reportingCcy && (
            <div className="col-span-2 md:col-span-4 flex items-start gap-2 border border-chart-5/30 bg-chart-5/[0.06] px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-chart-5 mt-0.5 flex-shrink-0" />
              <p className="text-(length:--t-second) text-chart-5">
                {isRtl
                  ? `عملة العقد ${form.contractCurrency} تختلف عن عملة تقارير الشركة ${reportingCcy}. انشر سعر صرف بينهما في إدارة العملات، وإلا لن تُحوَّل مبالغ هذا المشروع.`
                  : `Contract currency ${form.contractCurrency} differs from the company's reporting currency ${reportingCcy}. Publish a rate between them in Currency Management, or this project's amounts cannot be converted.`}
              </p>
            </div>
          )}

          {msg && (
            <div className="col-span-2 md:col-span-4 flex items-start gap-2 border border-chart-3/40 bg-chart-3/[0.07] px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-chart-3 mt-0.5 flex-shrink-0" />
              <p className="text-(length:--t-second) text-chart-3">{msg}</p>
            </div>
          )}

          <div className="col-span-2 md:col-span-4 flex justify-end">
            <button type="submit" className="bg-primary text-primary-foreground px-8 py-2 text-xs uppercase tracking-widest inline-flex items-center gap-2">
              <Check className="w-3.5 h-3.5" />
              {isRtl ? 'إضافة المشروع' : 'Add Project'}
            </button>
          </div>
        </form>
      )}

      {/* Projects grid */}
      <div className="ds-grid">
        {sectorProjects.map(p => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>

      {sectorProjects.length === 0 && (
        <div className="text-center py-24">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <Clock className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <p className="font-serif text-xl text-muted-foreground mb-2">
            {lang === 'ar' ? 'لا توجد مشاريع في هذا القطاع' : 'No Projects In This Sector'}
          </p>
          <p className="text-sm text-muted-foreground">
            {lang === 'ar' ? 'أضف مشاريع لهذا القطاع لعرضها هنا.' : 'Add projects to this sector to see them here.'}
          </p>
        </div>
      )}
    </div>
    </div>
  );
}
