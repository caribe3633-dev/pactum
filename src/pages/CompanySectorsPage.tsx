import React, { useState, useCallback } from 'react';
import ContextBar from '../components/ContextBar';
import CompanyTabs from '../components/CompanyTabs';
import SectorCard from '../components/SectorCard';
import { findCompanyById } from '../mock/companies';
import { findSectorsByCompany } from '../mock/sectors';
import { useTranslation } from '../lib/i18n';
import { getCompanyMeta } from '../lib/entityMeta';
import { Clock, Plus, Pencil, Trash2, Archive, ArchiveRestore, ChevronUp, ChevronDown, Check, X, AlertTriangle } from 'lucide-react';
// PHASE 3G — Sector CRUD. Phase 3E CRIT-3E-04: sectors had no create,
// rename, delete or ordering anywhere in the product.
import {
  createSector, updateSector, deleteSector, reorderSector,
  archiveSector, restoreSector,
} from '../lib/masterData';
import { useCompany, useCompanySectors } from '../lib/useMasterData';
import { reportingCurrencyOfCompany } from '../lib/masterData';
import { CURRENCY_SEED } from '../lib/currency';
import { useAuth, useProjects } from '../lib/store';
import { toLinks } from '../lib/projectMaster';
import { cn } from '../lib/utils';

/**
 * Company Sectors — navigation-only page.
 *
 *   Enterprise Portfolio -> Company Sectors -> Sector Dashboard -> Project Dashboard
 *
 * Company KPIs live in Enterprise Portfolio and Company Analytics.
 * This page exists solely to navigate a company's sectors.
 */
export default function CompanySectors({ params }: any) {
  const id = params?.id || 'unknown';
  const { lang } = useTranslation();
  const { user } = useAuth();
  const { projects } = useProjects();

  /**
   * PHASE 3F-UX · Task 2 — the local `tick` counter is gone.
   *
   * It only refreshed THIS page; a rename made anywhere else stayed
   * invisible here until remount. These hooks subscribe to the registry,
   * so any write from any screen re-renders this one immediately.
   *
   * `refresh` is retained as a no-op alias so the mutation handlers below
   * read unchanged — the subscription now does the work.
   */
  const company = useCompany(id);
  /** Task 4 — what a sector inherits when it sets no default of its own. */
  const inheritedCcy = reportingCurrencyOfCompany(id);
  const sectors = useCompanySectors(id);
  const refresh = useCallback(() => { /* subscription handles it */ }, []);

  const isRtl = lang === 'ar';
  const canEdit = user?.role === 'admin';

  // ── Local editor state ──
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftNameAr, setDraftNameAr] = useState('');
  /** Task 4 — optional sector default contract currency. */
  const [draftCcy, setDraftCcy] = useState('');
  /**
   * The sector's REPORTING currency — mandatory.
   *
   * Distinct from the contract-currency default above: that one only
   * pre-fills the create-project form, while this is the unit every
   * figure on the sector's analytics is converted into and labelled
   * with. Pre-selected to the company's currency as the common case,
   * but the user must be able to see and change it before saving.
   */
  const [draftRepCcy, setDraftRepCcy] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editName, setEditName] = useState('');
  const [error, setError] = useState('');

  const reasonText = (reason?: string): string => {
    const en: Record<string, string> = {
      'missing-name': 'Sector name is required.',
      'duplicate-name': 'This company already has a sector with that name.',
      'company-not-found': 'That company no longer exists.',
      // Task 3 — rule + remedy, and no claim about archives.
      'has-dependents': 'This sector cannot be deleted while projects belong to it. Move or archive them first.',
      'not-found': 'That sector no longer exists.',
    };
    const ar: Record<string, string> = {
      'missing-name': 'اسم القطاع مطلوب.',
      'duplicate-name': 'يوجد قطاع بنفس الاسم في هذه الشركة.',
      'company-not-found': 'الشركة لم تعد موجودة.',
      'has-dependents': 'لا يمكن حذف هذا القطاع ما دامت توجد مشاريع تتبعه. انقلها أو أرشفها أولاً.',
      'not-found': 'القطاع لم يعد موجوداً.',
    };
    return (isRtl ? ar : en)[reason ?? ''] ?? (isRtl ? 'تعذّر تنفيذ العملية.' : 'Operation failed.');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const r = createSector({
      name: draftName, nameAr: draftNameAr || undefined,
      // Task 4 — optional. Empty inherits the company reporting currency.
      defaultContractCurrency: draftCcy || undefined,
      // Mandatory. `createSector` refuses without it.
      reportingCurrency: draftRepCcy || inheritedCcy,
      companyId: id, createdBy: user?.username ?? 'unknown',
    });
    if (!r.ok) { setError(reasonText(r.reason)); return; }
    setDraftName(''); setDraftNameAr(''); setDraftCcy(''); setDraftRepCcy(''); setAdding(false); refresh();
  };

  const handleRename = (sectorId: string) => {
    setError('');
    const r = updateSector(sectorId, { name: editName });
    if (!r.ok) { setError(reasonText(r.reason)); return; }
    setEditingId(''); setEditName(''); refresh();
  };

  /**
   * Delete is REFUSED while any project still belongs to the sector.
   * The check runs in `masterData` against the LIVE projects array, not
   * the derived `projectIds` cache, so a stale cache cannot let a
   * populated sector through.
   */
  const handleDelete = (sectorId: string, name: string) => {
    setError('');
    const links = toLinks(projects as any);
    const owned = links.filter(p => p.sectorId === sectorId).length;
    if (owned > 0) {
      setError(isRtl
        ? `لا يمكن حذف «${name}» ما دامت توجد سجلات تابعة (${owned} مشروع). استخدم الأرشفة أو انقل المشاريع أولاً.`
        : `"${name}" cannot be deleted while dependent records exist (${owned} project(s)). Archive or move them instead.`);
      return;
    }
    if (!window.confirm(isRtl ? `حذف القطاع «${name}»؟` : `Delete sector "${name}"?`)) return;
    const r = deleteSector(sectorId, links);
    if (!r.ok) {
      setError(r.blockers?.length
        ? `${reasonText(r.reason)} (${r.blockers.join(' · ')})`
        : reasonText(r.reason));
      return;
    }
    refresh();
  };

  /**
   * SPRINT 2 — archive a sector.
   *
   * The remedy the delete refusal already recommends ("Archive or move
   * them instead") but which had no control behind it. Guarded in
   * `archiveSector`: refused while ACTIVE projects remain, because hiding
   * the parent would strand them in the project picker.
   */
  const handleArchive = (sectorId: string, name: string) => {
    setError('');
    const r = archiveSector(sectorId, toLinks(projects as any));
    if (!r.ok) {
      setError(r.blockers?.length
        ? `${reasonText(r.reason)} (${r.blockers.join(' · ')})`
        : reasonText(r.reason));
      return;
    }
    refresh();
  };

  /** SPRINT 2 — bring an archived sector back. */
  const handleRestore = (sectorId: string) => {
    setError('');
    const r = restoreSector(sectorId);
    if (!r.ok) {
      setError(r.blockers?.length
        ? `${reasonText(r.reason)} (${r.blockers.join(' · ')})`
        : reasonText(r.reason));
      return;
    }
    refresh();
  };

  const handleMove = (sectorId: string, dir: 'up' | 'down') => {
    setError('');
    reorderSector(sectorId, dir);
    refresh();
  };

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

  // Meta overrides mock — same source as the Enterprise Portfolio card
  const meta = getCompanyMeta(id);
  const city = meta.city || company.city;
  const country = meta.country || company.country;
  const location = [city, country].filter(Boolean).join(' • ');

  return (
    <div className="min-h-full w-full bg-background">

      <ContextBar
        items={[
          { label: 'Enterprise Portfolio', href: '/enterprise-portfolio' },
          { label: company.name },
        ]}
      />

      <div className="pg pg-stack">

      {/* ── Lightweight page header ── */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-[1px] w-8 bg-primary/40" />
          <span className="text-(length:--t-label) uppercase tracking-[0.25em] text-primary/60 font-mono">
            {isRtl ? 'القطاعات' : 'Sectors'}
          </span>
        </div>
        <h1 className="font-serif text-3xl md:text-4xl text-white leading-tight">
          {company.name}
        </h1>
        {location && (
          <p className="text-(length:--t-body) text-primary/70 mt-1">{location}</p>
        )}
      </div>

      {/* ── Company tabs ── */}
      <CompanyTabs companyId={id} active="sectors" />

      {/* ── Section divider ── */}
      <div className="flex items-center gap-3 mb-6">
        <h2 className="font-serif text-xl text-white whitespace-nowrap">
          {isRtl ? 'القطاعات' : 'Sectors'}
        </h2>
        <div className="h-px flex-1 bg-white/[0.04]" aria-hidden="true" />
        <span className="text-(length:--t-data) text-muted-foreground font-mono number-ltr">{sectors.length}</span>
        {canEdit && (
          <button
            onClick={() => { setAdding(v => !v); setError(''); }}
            className="btn btn-primary btn-sm"
          >
            <Plus className="w-3 h-3" />
            {adding ? (isRtl ? 'إلغاء' : 'Cancel') : (isRtl ? 'قطاع جديد' : 'New Sector')}
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-start gap-2 border border-chart-3/40 bg-chart-3/[0.07] px-3 py-2 mb-4">
          <AlertTriangle className="w-3.5 h-3.5 text-chart-3 mt-0.5 flex-shrink-0" />
          <p className="text-(length:--t-second) text-chart-3">{error}</p>
        </div>
      )}

      {/* ── Create form ── */}
      {canEdit && adding && (
        <form
          onSubmit={handleCreate}
          dir={isRtl ? 'rtl' : 'ltr'}
          className="ds-card ds-card-tight mb-6 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
        >
          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'اسم القطاع *' : 'Sector Name *'}
            </label>
            <input
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              required
              autoFocus
              dir="ltr"
              className="bg-black border border-white/10 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'الاسم بالعربية' : 'Name (AR)'}
            </label>
            <input
              value={draftNameAr}
              onChange={e => setDraftNameAr(e.target.value)}
              dir="rtl"
              className="bg-black border border-white/10 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'عملة العقد الافتراضية' : 'Default Contract Currency'}
            </label>
            <select
              value={draftCcy}
              onChange={e => setDraftCcy(e.target.value)}
              dir="ltr"
              className="bg-black border border-white/10 px-3 py-2 text-sm font-mono"
            >
              <option value="">
                {isRtl
                  ? `يرث من الشركة (${inheritedCcy || '—'})`
                  : `Inherit from company (${inheritedCcy || '—'})`}
              </option>
              {CURRENCY_SEED.filter(c => c.active).map(c => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>

          {/* MANDATORY — the unit this sector's own analytics are stated
              in. Every project under it is converted into this currency
              before anything is summed. */}
          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-label) uppercase tracking-wider text-muted-foreground">
              {isRtl ? 'عملة تقارير القطاع' : 'Sector Reporting Currency'}
              <span className="text-chart-3 ms-1">*</span>
            </label>
            <select
              value={draftRepCcy || inheritedCcy}
              onChange={e => setDraftRepCcy(e.target.value)}
              dir="ltr"
              required
              className="bg-black border border-white/10 px-3 py-2 text-sm font-mono"
            >
              {CURRENCY_SEED.filter(c => c.active).map(c => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
            <span className="text-(length:--t-micro) text-white/45">
              {isRtl
                ? 'كل مشاريع القطاع تُحوَّل إلى هذه العملة قبل التجميع.'
                : 'Every project in this sector is converted into this currency before totalling.'}
            </span>
          </div>

          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary btn-sm">
              <Check className="w-3 h-3" />
              {isRtl ? 'إضافة' : 'Add Sector'}
            </button>
          </div>
        </form>
      )}

      {/* ── Sector cards ── */}
      <div className="ds-grid">
        {sectors.map((s, i) => (
          <div key={s.id} className="flex flex-col">
            {/* Inline rename replaces the card while editing. */}
            {editingId === s.id ? (
              <div className="ds-card ds-card-tight flex flex-col gap-2">
                <label className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
                  {isRtl ? 'إعادة تسمية القطاع' : 'Rename Sector'}
                </label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(s.id);
                    if (e.key === 'Escape') { setEditingId(''); setError(''); }
                  }}
                  autoFocus
                  dir="ltr"
                  className="bg-black border border-white/10 px-3 py-2 text-sm"
                />
                <div className="flex items-center gap-2 justify-end">
                  <button onClick={() => { setEditingId(''); setError(''); }} className="btn btn-secondary btn-sm">
                    <X className="w-3 h-3" />
                    {isRtl ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button onClick={() => handleRename(s.id)} className="btn btn-primary btn-sm">
                    <Check className="w-3 h-3" />
                    {isRtl ? 'حفظ' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <SectorCard sector={s} />
            )}

            {/* Admin controls — never alter the card's own visual language. */}
            {canEdit && editingId !== s.id && (
              <div className="flex items-center gap-1 mt-2">
                <button
                  onClick={() => handleMove(s.id, 'up')}
                  disabled={i === 0}
                  title={isRtl ? 'تحريك لأعلى' : 'Move up'}
                  className={cn('btn btn-secondary btn-sm', i === 0 && 'opacity-30 pointer-events-none')}
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleMove(s.id, 'down')}
                  disabled={i === sectors.length - 1}
                  title={isRtl ? 'تحريك لأسفل' : 'Move down'}
                  className={cn('btn btn-secondary btn-sm', i === sectors.length - 1 && 'opacity-30 pointer-events-none')}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
                <button
                  onClick={() => { setEditingId(s.id); setEditName(s.name); setError(''); }}
                  title={isRtl ? 'إعادة تسمية' : 'Rename'}
                  className="btn btn-secondary btn-sm"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <span className="ms-auto text-(length:--t-micro) text-muted-foreground font-mono number-ltr">
                  {s.projectIds.length} {isRtl ? 'مشروع' : 'proj'}
                </span>
                {/* SPRINT 2 — archive / restore. One control, two states. */}
                {s.status === 'Archived' ? (
                  <button
                    onClick={() => handleRestore(s.id)}
                    title={isRtl ? 'استعادة' : 'Restore'}
                    className="btn btn-secondary btn-sm hover:text-chart-4 hover:border-chart-4/40"
                  >
                    <ArchiveRestore className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleArchive(s.id, s.name)}
                    title={isRtl ? 'أرشفة' : 'Archive'}
                    className="btn btn-secondary btn-sm hover:text-chart-5 hover:border-chart-5/40"
                  >
                    <Archive className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => handleDelete(s.id, s.name)}
                  title={isRtl ? 'حذف' : 'Delete'}
                  className="btn btn-secondary btn-sm hover:text-chart-3 hover:border-chart-3/40"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {sectors.length === 0 && (
        <div className="text-center py-24">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <Clock className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <p className="font-serif text-xl text-muted-foreground mb-2">
            {isRtl ? 'لا توجد قطاعات' : 'No Sectors Defined'}
          </p>
          <p className="text-sm text-muted-foreground">
            {isRtl ? 'أضف قطاعات لهذه الشركة لعرضها هنا.' : 'Add sectors to this company to see them here.'}
          </p>
        </div>
      )}
    </div>
    </div>
  );
}
