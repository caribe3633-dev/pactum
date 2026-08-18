import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAuth, useProjects, getProjectPermission } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { getCountries } from '../lib/countries';
// PHASE 3G — a project must be created under a Company and a Sector, with
// an explicit contract currency and real dates. Phase 3E CRIT-3E-01.
import { fetchCompanies, findSectorsByCompany, defaultContractCurrencyFor } from '../lib/masterData';
import { createProject, reportingCurrencyOf, PROJECT_STATUSES } from '../lib/projectMaster';
import { contractCurrencyOf } from '../lib/projectCurrency';
import { CURRENCY_SEED } from '../lib/currency';
import { formatCompactNumber, formatMoney, formatPercent } from '../lib/utils';
import { Link, useLocation } from 'wouter';
import { Plus, X, Clock, TrendingUp, AlertTriangle, ShieldAlert, UploadCloud, Trash2, ImageIcon, Archive, RotateCcw, LayoutGrid } from 'lucide-react';
import { cn } from '../lib/utils';

import buildingImg from '../assets/login-building.png';
import hospitalImg from '../assets/project-hospital.jpg';
import residentialImg from '../assets/project-residential.jpg';
import towerImg from '../assets/project-tower.jpg';
import villasImg from '../assets/project-villas.jpg';

const PROJECT_IMAGES: Record<string, string> = {
  'p1': towerImg,
  'p2': residentialImg,
  'p3': hospitalImg,
  'p4': villasImg,
};

function getProjectImage(id: string): string {
  return PROJECT_IMAGES[id] || buildingImg;
}

function getRiskLevel(projectId: string, contractValue: number): { label: string; color: string } {
  const risks = JSON.parse(localStorage.getItem(`pactum-risk-${projectId}`) || '[]');
  const threshold = contractValue * 0.01;
  const hasHigh = risks.some((r: any) => (r.prob || 0) * (r.impact || 0) > threshold);
  const hasMed = risks.some((r: any) => {
    const e = (r.prob || 0) * (r.impact || 0);
    return e > threshold * 0.2 && e <= threshold;
  });
  if (hasHigh) return { label: 'HIGH', color: 'text-chart-3 border-chart-3/40 bg-chart-3/10' };
  if (hasMed) return { label: 'MED', color: 'text-chart-5 border-chart-5/40 bg-chart-5/10' };
  return { label: 'LOW', color: 'text-chart-4 border-chart-4/40 bg-chart-4/10' };
}

function getOpenClaims(projectId: string): number {
  const claims = JSON.parse(localStorage.getItem(`pactum-claims-${projectId}`) || '[]');
  return claims.filter((c: any) => c.status !== 'approved' && c.status !== 'rejected').length;
}

function getVOCount(projectId: string): number {
  const cos = JSON.parse(localStorage.getItem(`pactum-co-${projectId}`) || '[]');
  return cos.length;
}

/**
 * The currency a project's figures are actually stated in.
 *
 * Phase 3D MIN-01 / Phase 3E MED-3E-06: the card hardcoded `SAR` under
 * every KPI. Resolved from the project's own contract currency, falling
 * back to its company's reporting currency — the same two-level
 * inheritance `projectMaster` defines. Never guesses a third value.
 */
function projectCurrencyLabel(p: { id: string; companyId?: string }): string {
  const reporting = reportingCurrencyOf(p.companyId ?? '');
  return contractCurrencyOf(p.id, reporting) || reporting;
}

// ── Project Image Upload ──────────────────────────────────────────────
function ImageUpload({
  value,
  onChange,
  lang,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  lang: 'en' | 'ar';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const processFile = (file: File) => {
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) return;
    const reader = new FileReader();
    reader.onload = (e) => onChange((e.target?.result as string) ?? '');
    reader.readAsDataURL(file);
  };

  const handleFiles = (files: FileList | null) => {
    if (files?.[0]) processFile(files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const isRtl = lang === 'ar';

  return (
    <div className="col-span-2 md:col-span-4">
      {/* Section label */}
      <div className="flex items-center gap-3 mb-3">
        <div className="h-px flex-1 bg-white/5" />
        <span className="text-(length:--t-label) uppercase tracking-[0.2em] text-primary/50 font-mono">
          {isRtl ? 'صورة المشروع' : 'Project Image'}
        </span>
        <div className="h-px flex-1 bg-white/5" />
      </div>

      {value ? (
        /* ── Preview ── */
        <div className="relative group h-44 overflow-hidden border border-white/10">
          <img
            src={value}
            alt="Project preview"
            className="w-full h-full object-cover"
          />
          {/* Overlay actions */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/90 text-black text-(length:--t-label) uppercase tracking-widest font-bold hover:bg-primary transition-colors"
            >
              <ImageIcon className="w-3 h-3" />
              {isRtl ? 'استبدال' : 'Replace'}
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 text-white text-(length:--t-label) uppercase tracking-widest border border-white/20 hover:bg-chart-3/20 hover:text-chart-3 hover:border-chart-3/40 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              {isRtl ? 'إزالة' : 'Remove'}
            </button>
          </div>
        </div>
      ) : (
        /* ── Drop zone placeholder ── */
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'h-44 border border-dashed flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors',
            dragging
              ? 'border-primary/60 bg-primary/5'
              : 'border-white/10 bg-black/20 hover:border-primary/30 hover:bg-black/30',
          )}
        >
          <UploadCloud
            className={cn('w-8 h-8 transition-colors', dragging ? 'text-primary' : 'text-white/20')}
          />
          <div className="text-center">
            <p className={cn('text-xs uppercase tracking-widest font-medium transition-colors', dragging ? 'text-primary' : 'text-white/40')}>
              {isRtl ? 'رفع صورة المشروع' : 'Upload Project Image'}
            </p>
            <p className="text-(length:--t-data) text-white/45 mt-1 font-mono">
              JPG · PNG · WEBP
            </p>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}

// ── Searchable country dropdown ───────────────────────────────────────
function CountrySelect({
  value,
  onChange,
  lang,
  required,
}: {
  value: string;
  onChange: (code: string) => void;
  lang: 'en' | 'ar';
  required?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const countries = useMemo(() => getCountries(lang), [lang]);

  const filtered = useMemo(() => {
    if (!query.trim()) return countries;
    const q = query.toLowerCase();
    return countries.filter(c => c.name.toLowerCase().includes(q));
  }, [countries, query]);

  const selected = useMemo(() => countries.find(c => c.code === value), [countries, value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const placeholder = lang === 'ar' ? 'بلد المشروع' : 'Project Country';
  const isRtl = lang === 'ar';

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        placeholder={placeholder}
        value={open ? query : (selected?.name ?? '')}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(''); }}
        dir={isRtl ? 'rtl' : 'ltr'}
        required={required && !value}
        readOnly={!open && !!value}
        className="w-full bg-black border border-white/10 px-3 py-2 text-sm cursor-pointer"
        autoComplete="off"
      />
      {/* Hidden input to enforce required validation */}
      {required && (
        <input
          tabIndex={-1}
          required
          value={value}
          onChange={() => {}}
          className="absolute inset-0 opacity-0 pointer-events-none"
          aria-hidden="true"
        />
      )}
      {open && filtered.length > 0 && (
        <ul
          className="absolute z-50 top-full left-0 right-0 bg-zinc-950 border border-white/20 max-h-48 overflow-y-auto shadow-2xl"
          role="listbox"
        >
          {filtered.map(c => (
            <li key={c.code} role="option" aria-selected={c.code === value}>
              <button
                type="button"
                dir={isRtl ? 'rtl' : 'ltr'}
                className={cn(
                  'w-full px-3 py-1.5 text-sm text-left hover:bg-white/10 transition-colors',
                  isRtl && 'text-right',
                  c.code === value && 'bg-primary/20 text-primary',
                )}
                onClick={() => { onChange(c.code); setQuery(''); setOpen(false); }}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PortalPage() {
  const { user, logout } = useAuth();
  const {
    projects, addProject, deleteProject: removeProject,
    archiveProject: doArchive, unarchiveProject: doUnarchive,
  } = useProjects();
  const { t, lang } = useTranslation();
  const [, setLocation] = useLocation();

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    nameEn: '', nameAr: '', code: '', country: '',
    cityEn: '', cityAr: '', contractValue: '', client: '', clientAr: '', image: '',
    // ── Phase 3G · mandatory master-data fields ──
    companyId: '', sectorId: '', contractCurrency: '',
    // ── SPRINT 2 · currency architecture + mandatory status ──
    reportingCurrency: '', workingCurrency: '', status: 'Active',
    commencementDate: '', contractualCompletion: '',
  });
  /** Field-level errors from `validateCreate`, so all are marked at once. */
  const [errors, setErrors] = useState<string[]>([]);
  const [formError, setFormError] = useState('');

  const isRtl = lang === 'ar';

  // Live master data. Archived companies cannot receive new projects.
  const companies = useMemo(
    () => fetchCompanies().filter(c => c.status !== 'Archived'), [showAdd]);

  /** Sectors of the chosen company only — the pair can never mismatch. */
  const sectorOptions = useMemo(
    () => (form.companyId ? findSectorsByCompany(form.companyId) : []),
    [form.companyId]);

  /** Inherited from the company, never entered. Read live. */
  const inheritedReporting = useMemo(
    () => (form.companyId ? reportingCurrencyOf(form.companyId) : ''),
    [form.companyId]);

  const activeCurrencies = useMemo(
    () => CURRENCY_SEED.filter(c => c.active), []);

  /**
   * PHASE 3F-UX · Task 1 — Active is the default view.
   *
   * A project with no `status` is Active: every project created before
   * archiving existed lacks the field, and treating absent as Archived
   * would hide the entire portfolio on first load.
   */
  const [showArchived, setShowArchived] = useState(false);

  const permitted = projects.filter(p => {
    if (user?.role === 'admin') return true;
    return getProjectPermission(user, p.id).canView;
  });

  const activeCount = permitted.filter(p => p.status !== 'Archived').length;
  const archivedCount = permitted.filter(p => p.status === 'Archived').length;

  const visibleProjects = permitted.filter(p =>
    showArchived ? p.status === 'Archived' : p.status !== 'Archived');

  const resetForm = () => setForm({
    nameEn: '', nameAr: '', code: '', country: '', cityEn: '', cityAr: '',
    contractValue: '', client: '', clientAr: '', image: '',
    companyId: '', sectorId: '', contractCurrency: '',
    reportingCurrency: '', workingCurrency: '', status: 'Active',
    commencementDate: '', contractualCompletion: '',
  });

  /** Human text for every refusal `createProject` can return. */
  const reasonText = (reason?: string): string => {
    const en: Record<string, string> = {
      'missing-name': 'Project name is required.',
      'missing-code': 'Project code is required.',
      'missing-company': 'Select a company.',
      'missing-sector': 'Select a sector.',
      'missing-currency': 'Select a base contract currency.',
      'missing-reporting-currency': 'Select a reporting currency.',
      'invalid-reporting-currency': 'Reporting currency is not a valid ISO code.',
      'invalid-working-currency': 'Working currency is not a valid ISO code.',
      'missing-status': 'Select a project status.',
      'invalid-status': 'That project status is not recognised.',
      'invalid-currency': 'Contract currency is not a valid ISO code.',
      'missing-start-date': 'Start date is required.',
      'missing-finish-date': 'Planned finish is required.',
      'invalid-date': 'Enter a real calendar date.',
      'finish-before-start': 'Planned finish cannot precede the start date.',
      'company-not-found': 'That company no longer exists.',
      'sector-not-found': 'That sector no longer exists.',
      'sector-company-mismatch': 'That sector belongs to a different company.',
      'duplicate-id': 'A project with that id already exists.',
      'duplicate-name': 'Another project in this sector already has that name.',
      'duplicate-code': 'That project code is already in use.',
    };
    const ar: Record<string, string> = {
      'missing-name': 'اسم المشروع مطلوب.',
      'missing-code': 'رمز المشروع مطلوب.',
      'missing-company': 'اختر الشركة.',
      'missing-sector': 'اختر القطاع.',
      'missing-currency': 'اختر عملة العقد الأساسية.',
      'missing-reporting-currency': 'اختر عملة التقرير.',
      'invalid-reporting-currency': 'رمز عملة التقرير غير صالح.',
      'invalid-working-currency': 'رمز عملة التشغيل غير صالح.',
      'missing-status': 'اختر حالة المشروع.',
      'invalid-status': 'حالة المشروع غير معروفة.',
      'invalid-currency': 'رمز العملة غير صالح.',
      'missing-start-date': 'تاريخ البدء مطلوب.',
      'missing-finish-date': 'تاريخ الانتهاء المخطط مطلوب.',
      'invalid-date': 'أدخل تاريخاً صحيحاً.',
      'finish-before-start': 'تاريخ الانتهاء لا يسبق تاريخ البدء.',
      'company-not-found': 'الشركة لم تعد موجودة.',
      'sector-not-found': 'القطاع لم يعد موجوداً.',
      'sector-company-mismatch': 'هذا القطاع يتبع شركة أخرى.',
      'duplicate-id': 'يوجد مشروع بنفس المعرّف.',
      'duplicate-name': 'يوجد مشروع بنفس الاسم في هذا القطاع.',
      'duplicate-code': 'رمز المشروع مستخدم بالفعل.',
    };
    const table = isRtl ? ar : en;
    return table[reason ?? ''] ?? (isRtl ? 'تعذّر إنشاء المشروع.' : 'Could not create the project.');
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    setFormError('');

    // Every rule lives in projectMaster. The page never re-implements one.
    const result = createProject({
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      code: form.code,
      companyId: form.companyId,
      sectorId: form.sectorId,
      contractCurrency: form.contractCurrency,
      reportingCurrency: form.reportingCurrency,
      workingCurrency: form.workingCurrency,
      status: form.status as any,
      commencementDate: form.commencementDate,
      contractualCompletion: form.contractualCompletion,
      country: form.country || undefined,
      cityEn: form.cityEn,
      cityAr: form.cityAr,
      contractValue: Number(form.contractValue) || 0,
      image: form.image || undefined,
      createdBy: user?.username ?? 'unknown',
    }, projects as any);

    if (!result.ok || !result.record) {
      setErrors(result.fields ?? []);
      setFormError(reasonText(result.reason));
      return;
    }

    addProject(result.record as any);
    resetForm();
    setShowAdd(false);
  };

  /** Red ring on any field the validator rejected. */
  const bad = (field: string) =>
    errors.includes(field) ? 'border-chart-3/60 ring-1 ring-chart-3/30' : 'border-white/10';

  /**
   * Task 1 + Task 3 — permanent delete, correctly worded.
   *
   * Only reachable for an ALREADY-ARCHIVED project. The copy states
   * exactly what is removed and, critically, what is NOT: the Timeline
   * and Baseline archives are retained by `disposeProjectStorage`, so the
   * dialog must not claim otherwise.
   */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [typedName, setTypedName] = useState('');

  const cashPosition = (p: any) => (p.totalCashReceived || 0) - (p.totalCashDisbursed || 0);
  const getStatus = (p: any) => {
    if (p.delayDays >= 30) return { label: 'Critical', cls: 'text-chart-3 bg-chart-3/10 border-chart-3/30' };
    if (p.delayDays > 0) return { label: 'Delayed', cls: 'text-chart-5 bg-chart-5/10 border-chart-5/30' };
    return { label: 'On Track', cls: 'text-chart-4 bg-chart-4/10 border-chart-4/30' };
  };

  return (
    <div className="pg pg-stack">

      {/* Header */}
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-[1px] w-8 bg-primary/40" />
            <span className="text-(length:--t-label) uppercase tracking-[0.25em] text-primary/60 font-mono">Project Portfolio</span>
          </div>
          <h1 className="font-serif text-3xl md:text-4xl text-white">
            {lang === 'ar' ? 'المشاريع' : 'Active Projects'}
          </h1>
        </div>
        {user?.role === 'admin' && (
          <button
            onClick={() => setShowAdd(s => !s)}
            className="flex items-center gap-2 bg-primary/10 text-primary border border-primary/30 px-4 py-2 text-xs uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {showAdd ? (lang === 'ar' ? 'إلغاء' : 'Cancel') : (lang === 'ar' ? 'مشروع جديد' : 'New Project')}
          </button>
        )}
      </div>

      {/* ── Task 1 · Active / Archived filter. Active is the default. ── */}
      <div className="flex items-center gap-2 mb-6">
        {([
          { key: false, en: 'Active Projects', ar: 'المشاريع النشطة', n: activeCount },
          { key: true,  en: 'Archived',        ar: 'المؤرشفة',        n: archivedCount },
        ] as const).map(t => (
          <button
            key={String(t.key)}
            onClick={() => setShowArchived(t.key)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 border rounded-md text-(length:--t-label) uppercase tracking-wider transition-colors',
              showArchived === t.key
                ? 'bg-primary/10 text-primary border-primary'
                : 'border-white/[0.06] text-muted-foreground hover:text-white',
            )}
          >
            {t.key ? <Archive className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
            {isRtl ? t.ar : t.en}
            <span className="font-mono number-ltr opacity-70">{t.n}</span>
          </button>
        ))}
      </div>

      {/* Add project form */}
      {showAdd && (
        <form onSubmit={handleAdd} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="mb-8 pactum-card bg-black/40 p-6 grid grid-cols-2 md:grid-cols-4 gap-4">

          {/* ── Ownership · mandatory ─────────────────────────────────── */}
          <div className="col-span-2 md:col-span-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-(length:--t-label) uppercase tracking-[0.2em] text-primary/50 font-mono">
                {isRtl ? 'التبعية' : 'Ownership'}
              </span>
              <div className="h-px flex-1 bg-white/5" />
            </div>
          </div>

          {/* Company — required */}
          <select
            value={form.companyId}
            onChange={e => setForm({ ...form, companyId: e.target.value, sectorId: '' })}
            required
            dir={isRtl ? 'rtl' : 'ltr'}
            className={cn('bg-black border px-3 py-2 text-sm', bad('companyId'))}
          >
            <option value="">{isRtl ? 'الشركة *' : 'Company *'}</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{isRtl && c.nameAr ? c.nameAr : c.name}</option>
            ))}
          </select>

          {/* Sector — required, scoped to the chosen company */}
          <select
            value={form.sectorId}
            onChange={e => {
              // Task 4 — pre-fill from the sector's default, falling back
              // to the company reporting currency. Only a PRE-FILL: the
              // user may override, and an existing project is unaffected.
              const sid = e.target.value;
              const suggested = sid ? defaultContractCurrencyFor(form.companyId, sid) : '';
              const compCcy = form.companyId ? reportingCurrencyOf(form.companyId) : '';
              setForm(f => ({
                ...f, sectorId: sid,
                contractCurrency: f.contractCurrency || suggested,
                // SPRINT 2 — the inheritance chain fills all three. Each
                // remains editable, and what the user leaves is STORED.
                reportingCurrency: f.reportingCurrency || compCcy,
                workingCurrency: f.workingCurrency || suggested,
              }));
            }}
            required
            disabled={!form.companyId}
            dir={isRtl ? 'rtl' : 'ltr'}
            className={cn('bg-black border px-3 py-2 text-sm disabled:opacity-40', bad('sectorId'))}
          >
            <option value="">
              {!form.companyId
                ? (isRtl ? 'اختر الشركة أولاً' : 'Select a company first')
                : sectorOptions.length === 0
                  ? (isRtl ? 'لا توجد قطاعات — أنشئ قطاعاً' : 'No sectors — create one first')
                  : (isRtl ? 'القطاع *' : 'Sector *')}
            </option>
            {sectorOptions.map(s => (
              <option key={s.id} value={s.id}>{isRtl && s.nameAr ? s.nameAr : s.name}</option>
            ))}
          </select>

          {/* Contract currency — required */}
          <select
            value={form.contractCurrency}
            onChange={e => setForm({ ...form, contractCurrency: e.target.value })}
            required
            dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('contractCurrency'))}
          >
            <option value="">{isRtl ? 'عملة العقد *' : 'Contract Currency *'}</option>
            {activeCurrencies.map(c => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>

          {/* SPRINT 2 — Reporting currency is now COLLECTED, not merely
              displayed. It defaults to the company's (shown as the hint
              below) but is STORED on the project, so a later change to the
              company cannot silently restate an existing project. */}
          <select
            value={form.reportingCurrency}
            onChange={e => setForm({ ...form, reportingCurrency: e.target.value })}
            required
            dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('reportingCurrency'))}
          >
            <option value="">{isRtl ? 'عملة التقرير *' : 'Reporting Currency *'}</option>
            {activeCurrencies.map(c => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>

          {/* Working currency — day-to-day site spend. Optional. */}
          <select
            value={form.workingCurrency}
            onChange={e => setForm({ ...form, workingCurrency: e.target.value })}
            dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('workingCurrency'))}
          >
            <option value="">{isRtl ? 'عملة التشغيل (اختياري)' : 'Working Currency (optional)'}</option>
            {activeCurrencies.map(c => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>

          {/* SPRINT 2 — Status is required at creation. */}
          <select
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value })}
            required
            dir={isRtl ? 'rtl' : 'ltr'}
            className={cn('bg-black border px-3 py-2 text-sm', bad('status'))}
          >
            {PROJECT_STATUSES.map(o => (
              <option key={o.value} value={o.value}>{isRtl ? o.ar : o.en}</option>
            ))}
          </select>

          {/* Rate warning — a cross-currency project needs a published rate */}
          {form.contractCurrency && inheritedReporting &&
           form.contractCurrency !== inheritedReporting && (
            <div className="col-span-2 md:col-span-4 flex items-start gap-2 border border-chart-5/30 bg-chart-5/[0.06] px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-chart-5 mt-0.5 flex-shrink-0" />
              <p className="text-(length:--t-second) text-chart-5">
                {isRtl
                  ? `عملة العقد ${form.contractCurrency} تختلف عن عملة تقارير الشركة ${inheritedReporting}. يجب نشر سعر صرف بينهما في إدارة العملات، وإلا لن تُحوَّل مبالغ هذا المشروع.`
                  : `Contract currency ${form.contractCurrency} differs from the company's reporting currency ${inheritedReporting}. Publish a rate between them in Currency Management, or this project's amounts cannot be converted.`}
              </p>
            </div>
          )}

          {/* ── Identity ──────────────────────────────────────────────── */}
          <div className="col-span-2 md:col-span-4">
            <div className="flex items-center gap-3 mb-3 mt-2">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-(length:--t-label) uppercase tracking-[0.2em] text-primary/50 font-mono">
                {isRtl ? 'بيانات المشروع' : 'Project Details'}
              </span>
              <div className="h-px flex-1 bg-white/5" />
            </div>
          </div>

          {/* Row 1: Project Name (EN), Project Name (AR), Project Code, Project Country */}
          <input
            placeholder={lang === 'ar' ? 'اسم المشروع (EN) *' : 'Project Name (EN) *'}
            value={form.nameEn}
            onChange={e => setForm({ ...form, nameEn: e.target.value })}
            required
            dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm', bad('nameEn'))}
          />
          <input
            placeholder={lang === 'ar' ? 'اسم المشروع (AR)' : 'Project Name (AR)'}
            value={form.nameAr}
            onChange={e => setForm({ ...form, nameAr: e.target.value })}
            dir="rtl"
            className="bg-black border border-white/10 px-3 py-2 text-sm"
          />
          <input
            placeholder={lang === 'ar' ? 'رمز المشروع *' : 'Project Code *'}
            value={form.code}
            onChange={e => setForm({ ...form, code: e.target.value })}
            required
            dir="ltr"
            className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('code'))}
          />
          <CountrySelect
            value={form.country}
            onChange={code => setForm({ ...form, country: code })}
            lang={lang}
            required
          />
          {/* Row 2: City (EN), City (AR), Client (EN), Contract Value */}
          <input
            placeholder={lang === 'ar' ? 'المدينة (EN)' : 'City (EN)'}
            value={form.cityEn}
            onChange={e => setForm({ ...form, cityEn: e.target.value })}
            dir="ltr"
            className="bg-black border border-white/10 px-3 py-2 text-sm"
          />
          <input
            placeholder={lang === 'ar' ? 'المدينة (AR)' : 'City (AR)'}
            value={form.cityAr}
            onChange={e => setForm({ ...form, cityAr: e.target.value })}
            dir="rtl"
            className="bg-black border border-white/10 px-3 py-2 text-sm"
          />
          <input
            placeholder={lang === 'ar' ? 'العميل (EN)' : 'Client (EN)'}
            value={form.client}
            onChange={e => setForm({ ...form, client: e.target.value })}
            dir="ltr"
            className="bg-black border border-white/10 px-3 py-2 text-sm"
          />
          {/* Contract value — labelled in the CHOSEN currency, not a
              hardcoded SAR (Phase 3E MED-3E-06). */}
          <input
            type="number"
            placeholder={
              (lang === 'ar' ? 'قيمة العقد' : 'Contract Value') +
              (form.contractCurrency ? ` (${form.contractCurrency})` : '')
            }
            value={form.contractValue}
            onChange={e => setForm({ ...form, contractValue: e.target.value })}
            required
            dir="ltr"
            className="bg-black border border-white/10 px-3 py-2 text-sm font-mono"
          />

          {/* ── Programme · mandatory dates ───────────────────────────── */}
          <div className="col-span-2 md:col-span-4">
            <div className="flex items-center gap-3 mb-3 mt-2">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-(length:--t-label) uppercase tracking-[0.2em] text-primary/50 font-mono">
                {isRtl ? 'البرنامج الزمني' : 'Programme'}
              </span>
              <div className="h-px flex-1 bg-white/5" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'تاريخ البدء *' : 'Start Date *'}
            </label>
            <input
              type="date"
              value={form.commencementDate}
              onChange={e => setForm({ ...form, commencementDate: e.target.value })}
              required
              dir="ltr"
              className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('commencementDate'))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'الانتهاء المخطط *' : 'Planned Finish *'}
            </label>
            <input
              type="date"
              value={form.contractualCompletion}
              onChange={e => setForm({ ...form, contractualCompletion: e.target.value })}
              required
              min={form.commencementDate || undefined}
              dir="ltr"
              className={cn('bg-black border px-3 py-2 text-sm font-mono', bad('contractualCompletion'))}
            />
          </div>

          {/* Derived duration — read-only confirmation of what was entered */}
          <div className="col-span-2 bg-black/40 border border-white/[0.06] px-3 py-2 flex flex-col justify-center">
            <span className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'المدة المخططة' : 'Planned Duration'}
            </span>
            <span className="text-sm font-mono text-white number-ltr">
              {form.commencementDate && form.contractualCompletion &&
               form.contractualCompletion >= form.commencementDate
                ? `${Math.round(
                    (new Date(`${form.contractualCompletion}T00:00:00Z`).getTime() -
                     new Date(`${form.commencementDate}T00:00:00Z`).getTime()) / 86400000)} ${isRtl ? 'يوم' : 'days'}`
                : '—'}
            </span>
          </div>

          {/* Row 3: Project Image */}
          <ImageUpload
            value={form.image}
            onChange={dataUrl => setForm(f => ({ ...f, image: dataUrl }))}
            lang={lang}
          />
          {/* Row 4: Error + Submit */}
          {formError && (
            <div className="col-span-2 md:col-span-4 flex items-start gap-2 border border-chart-3/40 bg-chart-3/[0.07] px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-chart-3 mt-0.5 flex-shrink-0" />
              <p className="text-(length:--t-second) text-chart-3">{formError}</p>
            </div>
          )}
          <div className="col-span-2 md:col-span-4 flex justify-end">
            <button type="submit" className="bg-primary text-primary-foreground px-8 py-2 text-xs uppercase tracking-widest">
              {lang === 'ar' ? 'إضافة المشروع' : 'Add Project'}
            </button>
          </div>
        </form>
      )}

      {/* Projects grid — shared card grid: three across on desktop. */}
      <div className="ds-grid">
        {visibleProjects.map(p => {
          const status = getStatus(p);
          const risk = getRiskLevel(p.id, p.contractValue);
          const openClaims = getOpenClaims(p.id);
          const voCount = getVOCount(p.id);
          const cash = cashPosition(p);
          // Phase 3E MED-3E-06 / Phase 3D MIN-01: the card printed a
          // hardcoded "SAR" under every figure regardless of the project's
          // actual currency. Resolved from the project's own record.
          const ccy = projectCurrencyLabel(p);
          const img = p.image || getProjectImage(p.id);
          const isArchived = p.status === 'Archived';

          return (
            <div key={p.id} className={cn(
              'pactum-card bg-black/20 overflow-hidden hover:bg-black/30 transition-colors group flex flex-col',
              // Archive state visible on the card itself, not only in the filter.
              isArchived && 'opacity-60 border-white/[0.04]',
            )}>
              {/* Image */}
              <div className="relative h-44 overflow-hidden flex-shrink-0">
                <img src={img} alt={p.nameEn} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 grayscale-[0.3] group-hover:grayscale-0" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0B] via-[#0A0A0B]/40 to-transparent" />
                {/* Badges on image */}
                <div className="absolute top-3 start-3 flex items-center gap-2">
                  <span className="font-mono text-(length:--t-micro) text-primary bg-black/80 border border-primary/40 px-2 py-0.5">{p.code}</span>
                  {isArchived ? (
                    <span className="inline-flex items-center gap-1 text-(length:--t-second) font-bold uppercase tracking-widest px-2 py-0.5 border text-muted-foreground bg-black/80 border-white/20">
                      <Archive className="w-3 h-3" />
                      {isRtl ? 'مؤرشف' : 'Archived'}
                    </span>
                  ) : (
                    <span className={cn('text-(length:--t-second) font-bold uppercase tracking-widest px-2 py-0.5 border', status.cls)}>{status.label}</span>
                  )}
                </div>
                {/*
                  Task 1 — ARCHIVE REPLACES HARD DELETE.

                  The X that destroyed a project and all 19 of its stores
                  is gone. An active project can only be archived; a
                  permanent delete is offered ONLY once it already is,
                  so destruction always takes two deliberate steps and
                  never happens on a single mis-click.
                */}
                {user?.role === 'admin' && (
                  <div className="absolute top-3 end-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isArchived ? (
                      <button
                        title={isRtl ? 'أرشفة' : 'Archive'}
                        onClick={(e) => { e.stopPropagation(); doArchive(p.id, user?.username ?? 'unknown'); }}
                        className="h-7 px-2 bg-black/80 border border-white/10 inline-flex items-center gap-1 text-(length:--t-micro) uppercase tracking-wider text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                      >
                        <Archive className="w-3 h-3" />
                        {isRtl ? 'أرشفة' : 'Archive'}
                      </button>
                    ) : (
                      <>
                        <button
                          title={isRtl ? 'استعادة' : 'Restore'}
                          onClick={(e) => { e.stopPropagation(); doUnarchive(p.id); }}
                          className="h-7 px-2 bg-black/80 border border-white/10 inline-flex items-center gap-1 text-(length:--t-micro) uppercase tracking-wider text-muted-foreground hover:text-chart-4 hover:border-chart-4/40 transition-colors"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {isRtl ? 'استعادة' : 'Restore'}
                        </button>
                        <button
                          title={isRtl ? 'حذف نهائي' : 'Delete permanently'}
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: p.id, name: p.nameEn }); }}
                          className="w-7 h-7 bg-black/80 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-chart-3 hover:border-chart-3/40 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
                {/* Project name overlay */}
                <div className="absolute bottom-3 start-4 end-4">
                  <h2 className="font-serif text-xl text-white leading-tight truncate">
                    {lang === 'ar' ? (p.nameAr || p.nameEn) : p.nameEn}
                  </h2>
                  <p className="text-(length:--t-body) text-primary/70 mt-0.5">{lang === 'ar' ? (p.cityAr || p.cityEn) : p.cityEn}</p>
                </div>
              </div>

              {/* Data section */}
              <div className="p-5 flex-1 flex flex-col gap-4">
                {/* Progress */}
                <div>
                  <div className="flex justify-between text-(length:--t-label) text-muted-foreground mb-1.5 uppercase tracking-wider">
                    <span>{lang === 'ar' ? 'نسبة الإنجاز' : 'Physical Progress'}</span>
                    <span className="font-mono text-white number-ltr">{formatPercent(p.progress)}</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-sm overflow-hidden">
                    <div
                      className={cn('h-full rounded-sm transition-all', p.delayDays > 30 ? 'bg-chart-3' : p.delayDays > 0 ? 'bg-chart-5' : 'bg-primary')}
                      style={{ width: `${p.progress * 100}%` }}
                    />
                  </div>
                </div>

                {/* KPI grid */}
                <div className="grid grid-cols-3 gap-3">
                  {/* Contract Value */}
                  <div className="bg-black/30 p-3 text-center border border-white/5">
                    <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">Contract Value</div>
                    <div className="text-sm font-mono text-white number-ltr">{formatCompactNumber(p.contractValue)}</div>
                    <div className="text-(length:--t-second) text-muted-foreground">{ccy}</div>
                  </div>

                  {/* Delay */}
                  <div className="bg-black/30 p-3 text-center border border-white/5">
                    <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">Delay</div>
                    <div className={cn('text-sm font-mono font-bold number-ltr', p.delayDays > 30 ? 'text-chart-3' : p.delayDays > 0 ? 'text-chart-5' : 'text-chart-4')}>
                      {p.delayDays > 0 ? `+${p.delayDays}d` : '✓'}
                    </div>
                    <div className="text-(length:--t-second) text-muted-foreground">{p.delayDays > 0 ? 'Behind' : 'On Track'}</div>
                  </div>

                  {/* Cash Position */}
                  <div className="bg-black/30 p-3 text-center border border-white/5">
                    <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">Cash Pos.</div>
                    <div className={cn('text-sm font-mono font-bold number-ltr', cash >= 0 ? 'text-chart-4' : 'text-chart-3')}>
                      {cash === 0 ? '—' : (cash > 0 ? '+' : '') + formatCompactNumber(Math.abs(cash))}
                    </div>
                    <div className="text-(length:--t-second) text-muted-foreground">{ccy}</div>
                  </div>
                </div>

                {/* Secondary row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-muted-foreground" />
                    <span className="text-(length:--t-body) text-muted-foreground">{openClaims} open claim{openClaims !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="w-px h-3 bg-white/10" />
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-muted-foreground" />
                    <span className="text-(length:--t-body) text-muted-foreground">{voCount} VO{voCount !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="w-px h-3 bg-white/10" />
                  <div className="flex items-center gap-1.5">
                    <ShieldAlert className="w-3 h-3 text-muted-foreground" />
                    <span className={cn('text-(length:--t-micro) font-bold uppercase px-1.5 py-0.5 border', risk.color)}>{risk.label} Risk</span>
                  </div>
                  <div className="ms-auto">
                    <span className="text-(length:--t-data) text-muted-foreground font-mono">{p.cityEn}</span>
                  </div>
                </div>

                {/* Open button */}
                <Link href={`/project/${p.id}`}>
                  <div className="mt-auto pt-1">
                    <div className="w-full text-center text-(length:--t-label) uppercase tracking-[0.2em] text-primary/60 border border-primary/20 py-2.5 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors cursor-pointer font-medium">
                      {lang === 'ar' ? 'فتح المشروع' : 'Open Project'}
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Permanent delete · archived projects only ── */}
      {deleteTarget && (
        <div className="ds-card ds-card-tight border-chart-3/30 mt-6" dir={isRtl ? 'rtl' : 'ltr'}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-chart-3" />
            <span className="text-chart-3 font-semibold">
              {isRtl ? 'حذف نهائي للمشروع' : 'Delete Project Permanently'}
            </span>
          </div>
          <p className="text-(length:--t-second) text-muted-foreground mb-1">
            {isRtl
              ? <>سيؤدي حذف <span className="text-white font-medium">{deleteTarget.name}</span> إلى إزالة سجلاته التشغيلية: الموازنة، أوامر التغيير، المطالبات، الشهادات، التدفق النقدي، التأخير، القيمة المكتسبة والمخاطر.</>
              : <>Deleting <span className="text-white font-medium">{deleteTarget.name}</span> removes its operational records: budget, change orders, claims, certificates, cash flow, delay, EVM and risk.</>}
          </p>
          <p className="text-(length:--t-second) text-chart-4 mb-3">
            {isRtl
              ? 'يُحتفَظ بأرشيف الخط الزمني وخطوط الأساس — فهما سجل تدقيق معتمد ولا يُحذفان.'
              : 'The Timeline and Baseline archives are RETAINED — they are an approved audit record and are not deleted.'}
          </p>
          <label className="block text-(length:--t-micro) uppercase tracking-wider text-muted-foreground mb-1">
            {isRtl ? 'اكتب اسم المشروع للتأكيد' : 'Type the project name to confirm'}
          </label>
          <input
            value={typedName}
            onChange={e => setTypedName(e.target.value)}
            dir="ltr"
            className="w-full bg-black border border-white/10 px-3 py-2 text-sm mb-3"
          />
          <div className="flex items-center gap-2">
            <button
              disabled={typedName !== deleteTarget.name}
              onClick={() => { removeProject(deleteTarget.id); setDeleteTarget(null); setTypedName(''); }}
              className="btn btn-sm bg-chart-3 text-black font-bold disabled:opacity-40 disabled:pointer-events-none"
            >
              {isRtl ? 'حذف نهائي' : 'Delete permanently'}
            </button>
            <button
              onClick={() => { setDeleteTarget(null); setTypedName(''); }}
              className="btn btn-secondary btn-sm"
            >
              {isRtl ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {visibleProjects.length === 0 && (
        <div className="text-center py-24">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <Clock className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <p className="font-serif text-xl text-muted-foreground mb-2">
            {showArchived
              ? (isRtl ? 'لا توجد مشاريع مؤرشفة' : 'No Archived Projects')
              : (isRtl ? 'لا توجد مشاريع نشطة' : 'No Active Projects')}
          </p>
          <p className="text-sm text-muted-foreground">
            {showArchived
              ? (isRtl ? 'المشاريع المؤرشفة تظهر هنا ويمكن استعادتها في أي وقت.'
                       : 'Archived projects appear here and can be restored at any time.')
              : archivedCount > 0
                ? (isRtl ? `يوجد ${archivedCount} مشروع مؤرشف — بدّل التبويب أعلاه لعرضها.`
                         : `${archivedCount} project(s) are archived — switch the filter above to see them.`)
                : (isRtl ? 'تواصل مع المدير لمنحك الصلاحيات.' : 'Contact an administrator to grant access.')}
          </p>
        </div>
      )}
    </div>
  );
}
