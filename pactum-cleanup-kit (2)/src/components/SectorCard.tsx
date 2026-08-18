import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import { readCurrencySettings } from '../lib/currency';
import { Sector } from '../mock/sectors';
import { useAuth, useProjects } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { formatCompactNumber, cn } from '../lib/utils';
import {
  getSectorMeta, saveSectorMeta, readImageFile,
  getAggregateRisk, riskLabel, RISK_STYLES, SectorMeta,
} from '../lib/entityMeta';
import { getSectorImage } from '../lib/sectorImage';
import {
  Briefcase, ShieldAlert, Pencil, Check, ImageIcon, Trash2, UploadCloud,
} from 'lucide-react';

interface Props {
  sector: Sector;
}

export default function SectorCard({ sector: s }: Props) {
  /**
   * VISUAL QA — the unit was the string "SAR", typed into the JSX.
   *
   * Sprint 2B swept every formatMoney() call, but this figure is rendered
   * by formatCompactNumber() with the currency as a separate label
   * underneath — so it was invisible to that sweep and kept printing SAR
   * on a EUR company. Measured on screen: "600M SAR" for an AED project
   * under a EUR company.
   */
  const sectorCcy = readCurrencySettings(s.companyId).baseCurrency;
  const { user } = useAuth();
  const { projects } = useProjects();
  const { lang } = useTranslation();
  const [, setLocation] = useLocation();

  const [meta, setMeta] = useState<SectorMeta>(() => getSectorMeta(s.id));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SectorMeta>(meta);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const m = getSectorMeta(s.id);
    setMeta(m);
    setDraft(m);
  }, [s.id]);

  const isRtl = lang === 'ar';
  const canEdit = user?.role === 'admin';

  const sectorProjects = projects.filter(p => s.projectIds.includes(p.id));
  const risk = getAggregateRisk(sectorProjects);
  const totalValue = sectorProjects.reduce((sum, p) => sum + (p.contractValue || 0), 0);

  const description = isRtl
    ? (meta.descriptionAr || meta.descriptionEn)
    : (meta.descriptionEn || meta.descriptionAr);

  // localStorage -> smart name match -> building
  const img = editing
    ? (draft.image || getSectorImage(s.id, s.name))
    : getSectorImage(s.id, s.name);

  const handleSave = () => { saveSectorMeta(s.id, draft); setMeta(draft); setEditing(false); };
  const handleCancel = () => { setDraft(meta); setEditing(false); };

  return (
    <div className="pactum-card bg-black/20 overflow-hidden hover:bg-black/30 transition-colors group flex flex-col">
      {/* Hero image — same treatment as ProjectCard */}
      <div className="relative h-44 overflow-hidden flex-shrink-0">
        <img
          src={img}
          alt={s.name}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 grayscale-[0.3] group-hover:grayscale-0"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0B] via-[#0A0A0B]/40 to-transparent" />

        {/* Badges */}
        <div className="absolute top-3 start-3 flex items-center gap-2">
          <span className="font-mono text-[10px] text-primary bg-black/80 border border-primary/40 px-2 py-0.5">
            {s.projectIds.length} {isRtl ? 'مشروع' : 'PRJ'}
          </span>
          <span className={cn('text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border', RISK_STYLES[risk])}>
            {riskLabel(risk, lang)}
          </span>
        </div>

        {/* Edit toggle */}
        {canEdit && !editing && (
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            aria-label={isRtl ? 'تعديل' : 'Edit'}
            className="absolute top-3 end-3 w-7 h-7 bg-black/80 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors opacity-0 group-hover:opacity-100"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Image edit controls */}
        {editing && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/90 text-black text-[10px] uppercase tracking-widest font-bold hover:bg-primary transition-colors"
            >
              {draft.image ? <ImageIcon className="w-3 h-3" /> : <UploadCloud className="w-3 h-3" />}
              {draft.image ? (isRtl ? 'استبدال' : 'Replace') : (isRtl ? 'رفع صورة' : 'Upload')}
            </button>
            {draft.image && (
              <button
                type="button"
                onClick={() => setDraft(d => ({ ...d, image: '' }))}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 text-white text-[10px] uppercase tracking-widest border border-white/20 hover:bg-chart-3/20 hover:text-chart-3 hover:border-chart-3/40 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                {isRtl ? 'استعادة' : 'Reset'}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => readImageFile(e.target.files?.[0], (url) => setDraft(d => ({ ...d, image: url })))}
            />
          </div>
        )}

        {/* Name overlay */}
        {!editing && (
          <div className="absolute bottom-3 start-4 end-4">
            <h2 className="font-serif text-xl text-white leading-tight truncate">{s.name}</h2>
            <p className="text-[11px] text-primary/70 mt-0.5">
              {s.projectIds.length} {isRtl ? 'مشروع' : `project${s.projectIds.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-5 flex-1 flex flex-col gap-4">
        {/* Edit form */}
        {editing && (
          <div dir={isRtl ? 'rtl' : 'ltr'} className="flex flex-col gap-2 pb-2 border-b border-white/5">
            <textarea
              placeholder={isRtl ? 'وصف القطاع' : 'Sector Description'}
              value={(isRtl ? draft.descriptionAr : draft.descriptionEn) ?? ''}
              onChange={e => setDraft(d => isRtl
                ? ({ ...d, descriptionAr: e.target.value })
                : ({ ...d, descriptionEn: e.target.value }))}
              rows={2}
              className="bg-black border border-white/10 px-3 py-2 text-sm resize-none"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={handleCancel} className="px-4 py-1.5 text-[10px] uppercase tracking-widest text-white/40 border border-white/10 hover:text-white hover:border-white/20 transition-colors">
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-[10px] uppercase tracking-widest font-bold hover:bg-primary/90 transition-colors">
                <Check className="w-3 h-3" />
                {isRtl ? 'حفظ' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Description */}
        {!editing && description && (
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{description}</p>
        )}

        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-black/30 p-3 text-center border border-white/5">
            <div className="text-[9px] uppercase text-muted-foreground mb-1">
              {isRtl ? 'المشاريع' : 'Projects'}
            </div>
            <div className="text-sm font-mono text-white number-ltr">{s.projectIds.length}</div>
            <div className="text-[9px] text-muted-foreground/60">{isRtl ? 'مشروع' : 'Total'}</div>
          </div>

          <div className="bg-black/30 p-3 text-center border border-white/5">
            <div className="text-[9px] uppercase text-muted-foreground mb-1">
              {isRtl ? 'قيمة العقود' : 'Contract Value'}
            </div>
            <div className="text-sm font-mono text-white number-ltr">
              {totalValue > 0 ? formatCompactNumber(totalValue) : '—'}
            </div>
            <div className="text-[9px] text-muted-foreground/60">{sectorCcy}</div>
          </div>
        </div>

        {/* Secondary row */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Briefcase className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              {sectorProjects.length} {isRtl ? 'نشط' : `active`}
            </span>
          </div>
          <div className="w-px h-3 bg-white/10" />
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3 h-3 text-muted-foreground" />
            <span className={cn('text-[10px] font-bold uppercase px-1.5 py-0.5 border', RISK_STYLES[risk])}>
              {riskLabel(risk, lang)} {isRtl ? '' : 'Risk'}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-auto pt-1 flex flex-col gap-2">
          {/* Primary — gold filled */}
          <button
            onClick={() => setLocation(`/sector/${s.id}/analytics`)}
            className="w-full text-center text-[10px] uppercase tracking-[0.2em] bg-primary text-primary-foreground border border-primary py-2.5 hover:bg-primary/90 transition-colors cursor-pointer font-bold"
          >
            {isRtl ? 'تحليلات القطاع' : 'Sector Analytics'}
          </button>

          {/* Secondary — gold outlined */}
          <button
            onClick={() => setLocation(`/sector/${s.id}`)}
            className="w-full text-center text-[10px] uppercase tracking-[0.2em] text-primary/60 border border-primary/20 py-2.5 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors cursor-pointer font-medium"
          >
            {isRtl ? 'فتح القطاع' : 'Open Sector'}
          </button>
        </div>
      </div>
    </div>
  );
}
