import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Company } from '../mock/companies';
import { findSectorsByCompany } from '../mock/sectors';
import { readCurrencySettings } from '../lib/currency';
// SPRINT 3 · R9 — derived portfolio value, in the company's own currency.
import { companyPortfolioValue } from '../lib/companyPortfolio';
import { useAuth, useProjects } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { formatCompactNumber, cn } from '../lib/utils';
import {
  getCompanyMeta, saveCompanyMeta, readImageFile, CompanyMeta,
} from '../lib/entityMeta';
import {
  Building2, MapPin,
  Pencil, Check, ImageIcon, Trash2, UploadCloud, User,
} from 'lucide-react';
// PHASE 3F-UX Task 2 — live master data: re-renders on any registry write.
import { useCompanySectors } from '../lib/useMasterData';

interface Props {
  company: Company;
  /**
   * Optional notification hook. Navigation is owned by this card and always
   * targets /company/:id — this callback never decides the destination.
   */
  onEnter?: (c: Company) => void;
}

// Colour only — shape and typography come from `.badge`.
const STATUS_STYLES: Record<string, string> = {
  Active: 'badge-ok',
  Paused: 'badge-warn',
  Archived: 'badge-neutral',
};

export default function CompanyCard({ company: c, onEnter }: Props) {
  const { user } = useAuth();
  /** The company's own reporting currency, not an assumed one. */
  const reportingCcy = readCurrencySettings(c.id).baseCurrency;
  const { projects } = useProjects();
  /**
   * SPRINT 3 · R9 — portfolio value is DERIVED from the projects, not
   * read from `c.portfolioValue`.
   *
   * The stored field is written as 0 at creation and never updated by
   * anything, so every card showed "0 SAR" regardless of what the
   * company actually carried. Deriving it also fixes the unit: the
   * literal " SAR" that used to sit beside the number is replaced by the
   * company's real reporting currency.
   */
  const portfolio = useMemo(
    () => companyPortfolioValue(c.id, projects as any),
    [c.id, projects],
  );
  const { lang } = useTranslation();
  const [, setLocation] = useLocation();

  const [meta, setMeta] = useState<CompanyMeta>(() => getCompanyMeta(c.id));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CompanyMeta>(meta);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const m = getCompanyMeta(c.id);
    setMeta(m);
    setDraft(m);
  }, [c.id]);

  const isRtl = lang === 'ar';
  const canEdit = user?.role === 'admin';

  const sectors = useCompanySectors(c.id);
  const companyProjects = projects.filter(p => sectors.some(s => s.projectIds.includes(p.id)));

  const sectorCount = sectors.length || c.sectors;
  const projectCount = companyProjects.length || c.projects;

  // Meta overrides mock — editable exactly like the logo
  const country = meta.country || c.country;
  const city = meta.city || c.city;

  // "City, Country" — falls back gracefully when either is missing
  const locationLabel = (city || country)
    ? [city || (isRtl ? 'مدينة غير معروفة' : 'Unknown City'),
       country || (isRtl ? 'دولة غير معروفة' : 'Unknown Country')].join(', ')
    : (isRtl ? 'موقع غير معروف' : 'Unknown Location');

  const description = isRtl
    ? (meta.descriptionAr || meta.descriptionEn)
    : (meta.descriptionEn || meta.descriptionAr);

  // Logo priority: localStorage -> mock logoUrl -> initial -> Building2
  const logo = (editing ? draft.logo : meta.logo) || c.logoUrl;
  const initial = c.name?.trim()?.[0]?.toUpperCase();

  const handleSave = () => { saveCompanyMeta(c.id, draft); setMeta(draft); setEditing(false); };
  const handleCancel = () => { setDraft(meta); setEditing(false); };

  // Primary — executive analytics for THIS company
  const openAnalytics = () => {
    onEnter?.(c);
    setLocation(`/company/${c.id}/analytics`);
  };

  // Secondary — operational dashboard, scrolled to the sectors section
  const openSectors = () => {
    setLocation(`/company/${c.id}?scroll=sectors`);
  };

  return (
    <div className="ds-card ds-card-key !p-0 overflow-hidden hover:bg-black/30 transition-colors group">
      {/* Header band */}
      <div className="relative p-6 pb-5 flex-shrink-0 border-b border-white/[0.04]">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] via-transparent to-transparent pointer-events-none" />

        {canEdit && !editing && (
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            aria-label={isRtl ? 'تعديل' : 'Edit'}
            className="absolute top-4 end-4 w-7 h-7 bg-black/80 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors opacity-0 group-hover:opacity-100 z-10"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}

        <div className="relative flex items-start gap-4">
          {/* Logo */}
          <div className="co-logo flex-shrink-0 border border-primary/20 bg-primary/[0.06] flex items-center justify-center overflow-hidden transition-colors group-hover:border-primary/40">
            {logo ? (
              <img src={logo} alt={`${c.name} logo`} className="w-full h-full object-contain p-1.5" />
            ) : initial ? (
              <span className="font-serif text-3xl text-primary leading-none">{initial}</span>
            ) : (
              <Building2 className="w-7 h-7 text-primary/60" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={cn('badge', STATUS_STYLES[c.status] ?? STATUS_STYLES.Archived)}>
                {c.status}
              </span>
            </div>
            <h3 className="co-name text-white truncate">{c.name}</h3>
            <p className="money text-primary/80 !text-left mt-1 text-(length:--t-body)">
              {formatCompactNumber(portfolio.value)} {portfolio.currency}
            </p>
          </div>
        </div>

        {/* Logo edit controls */}
        {editing && (
          <div className="relative mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/90 text-black text-(length:--t-label) uppercase tracking-widest font-bold hover:bg-primary transition-colors"
            >
              {draft.logo ? <ImageIcon className="w-3 h-3" /> : <UploadCloud className="w-3 h-3" />}
              {draft.logo ? (isRtl ? 'استبدال الشعار' : 'Replace Logo') : (isRtl ? 'رفع شعار' : 'Upload Logo')}
            </button>
            {draft.logo && (
              <button
                type="button"
                onClick={() => setDraft(d => ({ ...d, logo: '' }))}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 text-white text-(length:--t-label) uppercase tracking-widest border border-white/20 hover:bg-chart-3/20 hover:text-chart-3 hover:border-chart-3/40 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                {isRtl ? 'إزالة' : 'Remove'}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => readImageFile(e.target.files?.[0], (url) => setDraft(d => ({ ...d, logo: url })))}
            />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-6 flex-1 flex flex-col gap-5">
        {/* Edit form */}
        {editing && (
          <div dir={isRtl ? 'rtl' : 'ltr'} className="flex flex-col gap-2 pb-4 border-b border-white/5">
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder={isRtl ? 'الدولة' : 'Country'}
                value={draft.country ?? c.country ?? ''}
                onChange={e => setDraft(d => ({ ...d, country: e.target.value }))}
                className="bg-black border border-white/10 px-3 py-2 text-sm"
              />
              <input
                placeholder={isRtl ? 'المدينة' : 'City'}
                value={draft.city ?? c.city ?? ''}
                onChange={e => setDraft(d => ({ ...d, city: e.target.value }))}
                className="bg-black border border-white/10 px-3 py-2 text-sm"
              />
            </div>
            <textarea
              placeholder={isRtl ? 'وصف الشركة' : 'Company Description'}
              value={(isRtl ? draft.descriptionAr : draft.descriptionEn) ?? ''}
              onChange={e => setDraft(d => isRtl
                ? ({ ...d, descriptionAr: e.target.value })
                : ({ ...d, descriptionEn: e.target.value }))}
              rows={2}
              className="bg-black border border-white/10 px-3 py-2 text-sm resize-none"
            />
            <input
              placeholder={isRtl ? 'مالك الشركة' : 'Company Owner'}
              value={draft.owner ?? ''}
              onChange={e => setDraft(d => ({ ...d, owner: e.target.value }))}
              className="bg-black border border-white/10 px-3 py-2 text-sm"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={handleCancel} className="px-4 py-1.5 text-(length:--t-label) uppercase tracking-widest text-white/45 border border-white/10 hover:text-white hover:border-white/20 transition-colors">
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-(length:--t-label) uppercase tracking-widest font-bold hover:bg-primary/90 transition-colors">
                <Check className="w-3 h-3" />
                {isRtl ? 'حفظ' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Description + Owner */}
        {!editing && (description || meta.owner) && (
          <div className="flex flex-col gap-2">
            {description && (
              <p className="text-(length:--t-body) text-muted-foreground leading-relaxed line-clamp-2">{description}</p>
            )}
            {meta.owner && (
              <div className="flex items-center gap-1.5">
                <User className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <span className="text-(length:--t-body) text-muted-foreground truncate">{meta.owner}</span>
              </div>
            )}
          </div>
        )}

        {/* KPI grid */}
        <div className="kpi-strip co-kpi !grid-cols-3">
          <div className="kpi !min-h-0 !p-3 text-center">
            <div className="kpi-k">{isRtl ? 'المحفظة' : 'Portfolio'}</div>
            <div className="kpi-v kpi-v-gold">{formatCompactNumber(portfolio.value)}</div>
            <div className="kpi-sub">{reportingCcy}</div>
          </div>

          <div className="kpi !min-h-0 !p-3 text-center">
            <div className="kpi-k">{isRtl ? 'القطاعات' : 'Sectors'}</div>
            <div className="kpi-v">{sectorCount}</div>
            <div className="kpi-sub">{isRtl ? 'قطاع' : 'Total'}</div>
          </div>

          <div className="kpi !min-h-0 !p-3 text-center">
            <div className="kpi-k">{isRtl ? 'المشاريع' : 'Projects'}</div>
            <div className="kpi-v">{projectCount}</div>
            <div className="kpi-sub">{isRtl ? 'مشروع' : 'Total'}</div>
          </div>
        </div>

        {/* Secondary row — location */}
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <span className="text-(length:--t-body) text-muted-foreground truncate">{locationLabel}</span>
        </div>

        {/* Actions */}
        <div className="mt-auto pt-1 flex flex-col gap-2">
          {/* Primary — gold filled */}
          <button
            onClick={openAnalytics}
            className="btn btn-primary w-full"
          >
            {isRtl ? 'تحليلات الشركة' : 'Company Analytics'}
          </button>

          {/* Secondary — gold outlined */}
          <button
            onClick={openSectors}
            className="btn btn-secondary w-full"
          >
            {isRtl ? 'فتح الشركة' : 'Open Company'}
          </button>
        </div>
      </div>
    </div>
  );
}



