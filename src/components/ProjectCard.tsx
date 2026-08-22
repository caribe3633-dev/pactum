import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'wouter';
import { useAuth } from '../lib/store';
import { useProjectCurrency } from '../lib/useProjectCurrency';
import { useTranslation } from '../lib/i18n';
import { formatCompactNumber, formatPercent, cn } from '../lib/utils';
// PROGRESS IS EARNED, NOT TYPED (owner rule): the card bar reads
// EV ÷ BAC from the EVM engine — same number as the Overview and the
// project header. The stored manual field no longer feeds any screen.
import { snapshot as evmSnapshot, readSyncedEvm } from '../lib/evm';
import {
  X, TrendingUp, AlertTriangle, ShieldAlert,
  Pencil, Check, ImageIcon, Trash2, UploadCloud, User,
} from 'lucide-react';

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

// â”€â”€ Editable metadata overlay (same localStorage pattern as risks/claims/COs) â”€â”€
export interface ProjectMeta {
  nameEn?: string;
  nameAr?: string;
  image?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  owner?: string;
}

const META_KEY = (id: string) => `pactum-project-meta-${id}`;

export function getProjectMeta(projectId: string): ProjectMeta {
  try {
    return JSON.parse(localStorage.getItem(META_KEY(projectId)) || '{}') as ProjectMeta;
  } catch {
    return {};
  }
}

export function saveProjectMeta(projectId: string, meta: ProjectMeta): void {
  try {
    localStorage.setItem(META_KEY(projectId), JSON.stringify(meta));
  } catch {
    /* quota exceeded — ignore */
  }
}

interface ProjectCardProps {
  project: any;
  onDelete?: (id: string) => void;
  editable?: boolean;
}

export default function ProjectCard({ project: p, onDelete, editable }: ProjectCardProps) {
  /** PROGRESS = EV ÷ BAC from the EVM engine (owner rule) — the same
   *  number the Overview card and the project header print. Null when
   *  there is no budget to measure against: the bar states nothing
   *  rather than a confident 0%. */
  const evmPct = useMemo(() => {
    try {
      const snap = evmSnapshot(p as any, readSyncedEvm(p as any));
      return snap.bac > 0 ? snap.m.ev / snap.bac : null;
    } catch {
      return null;
    }
  }, [p]);
  /**
   * VISUAL QA — same defect as SectorCard: the unit was a literal "SAR"
   * beside a formatCompactNumber() figure, so the Sprint 2B sweep of
   * formatMoney() call sites never saw it.
   *
   * Uses the PROJECT's own reporting currency (Sprint 2 architecture),
   * not the company's, because the card shows that project's figures.
   */
  // PROJECT SCREENS ARE DENOMINATED IN THE CONTRACT CURRENCY.
  // `.reporting` is the AGGREGATION currency, used when this project is
  // rolled up into a company or portfolio figure. Reading it here is what
  // printed the company's unit on a project's own numbers.
  const cardCcy = useProjectCurrency(p as any).base;
  const { user } = useAuth();
  const { lang } = useTranslation();

  const [meta, setMeta] = useState<ProjectMeta>(() => getProjectMeta(p.id));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectMeta>(meta);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const m = getProjectMeta(p.id);
    setMeta(m);
    setDraft(m);
  }, [p.id]);

  const isRtl = lang === 'ar';
  const canEdit = editable !== false && user?.role === 'admin';

  // Meta overrides base project data
  const name = isRtl
    ? (meta.nameAr || p.nameAr || meta.nameEn || p.nameEn)
    : (meta.nameEn || p.nameEn);
  const description = isRtl
    ? (meta.descriptionAr || meta.descriptionEn)
    : (meta.descriptionEn || meta.descriptionAr);
  const owner = meta.owner;
  const img = meta.image || p.image || getProjectImage(p.id);

  const status = (() => {
    if (p.delayDays >= 30) return { label: 'Critical', cls: 'text-chart-3 bg-chart-3/10 border-chart-3/30' };
    if (p.delayDays > 0) return { label: 'Delayed', cls: 'text-chart-5 bg-chart-5/10 border-chart-5/30' };
    return { label: 'On Track', cls: 'text-chart-4 bg-chart-4/10 border-chart-4/30' };
  })();

  const risk = getRiskLevel(p.id, p.contractValue);
  const openClaims = getOpenClaims(p.id);
  const voCount = getVOCount(p.id);
  const cash = (p.totalCashReceived || 0) - (p.totalCashDisbursed || 0);

  const handleSave = () => {
    saveProjectMeta(p.id, draft);
    setMeta(draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(meta);
    setEditing(false);
  };

  const handleImageFile = (file?: File) => {
    if (!file || !file.type.match(/^image\/(jpeg|png|webp)$/)) return;
    const reader = new FileReader();
    reader.onload = (e) => setDraft(d => ({ ...d, image: (e.target?.result as string) ?? '' }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="pactum-card bg-black/20 overflow-hidden hover:bg-black/30 transition-colors group flex flex-col">
      {/* Image */}
      <div className="relative h-44 overflow-hidden flex-shrink-0">
        <img
          src={editing ? (draft.image || img) : img}
          alt={p.nameEn}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 grayscale-[0.3] group-hover:grayscale-0"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0B] via-[#0A0A0B]/40 to-transparent" />

        {/* Badges on image */}
        <div className="absolute top-3 start-3 flex items-center gap-2">
          <span className="font-mono text-[10px] text-primary bg-black/80 border border-primary/40 px-2 py-0.5">{p.code}</span>
          <span className={cn('text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border', status.cls)}>{status.label}</span>
        </div>

        {/* Actions */}
        <div className="absolute top-3 end-3 flex items-center gap-2">
          {canEdit && !editing && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              aria-label={isRtl ? 'تعديل' : 'Edit'}
              className="w-7 h-7 bg-black/80 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && user?.role === 'admin' && !editing && (
            <button
              onClick={(e) => { e.stopPropagation(); if (window.confirm('Remove project?')) onDelete(p.id); }}
              aria-label={isRtl ? 'حذف' : 'Remove'}
              className="w-7 h-7 bg-black/80 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors opacity-0 group-hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

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
                {isRtl ? 'إزالة' : 'Remove'}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => handleImageFile(e.target.files?.[0])}
            />
          </div>
        )}

        {/* Project name overlay */}
        {!editing && (
          <div className="absolute bottom-3 start-4 end-4">
            <h2 className="font-serif text-xl text-white leading-tight truncate">{name}</h2>
            <p className="text-[11px] text-primary/70 mt-0.5">{isRtl ? (p.cityAr || p.cityEn) : p.cityEn}</p>
          </div>
        )}
      </div>

      {/* Data section */}
      <div className="p-5 flex-1 flex flex-col gap-4">
        {/* â”€â”€ Edit form â”€â”€ */}
        {editing && (
          <div dir={isRtl ? 'rtl' : 'ltr'} className="flex flex-col gap-2 pb-2 border-b border-white/5">
            <input
              placeholder={isRtl ? 'اسم المشروع (EN)' : 'Project Name (EN)'}
              value={draft.nameEn ?? p.nameEn ?? ''}
              onChange={e => setDraft(d => ({ ...d, nameEn: e.target.value }))}
              dir="ltr"
              className="bg-black border border-white/10 px-3 py-2 text-sm"
            />
            <input
              placeholder={isRtl ? 'اسم المشروع (AR)' : 'Project Name (AR)'}
              value={draft.nameAr ?? p.nameAr ?? ''}
              onChange={e => setDraft(d => ({ ...d, nameAr: e.target.value }))}
              dir="rtl"
              className="bg-black border border-white/10 px-3 py-2 text-sm"
            />
            <textarea
              placeholder={isRtl ? 'وصف المشروع' : 'Project Description'}
              value={(isRtl ? draft.descriptionAr : draft.descriptionEn) ?? ''}
              onChange={e => setDraft(d => isRtl
                ? ({ ...d, descriptionAr: e.target.value })
                : ({ ...d, descriptionEn: e.target.value }))}
              rows={2}
              className="bg-black border border-white/10 px-3 py-2 text-sm resize-none"
            />
            <input
              placeholder={isRtl ? 'مالك المشروع' : 'Project Owner'}
              value={draft.owner ?? ''}
              onChange={e => setDraft(d => ({ ...d, owner: e.target.value }))}
              className="bg-black border border-white/10 px-3 py-2 text-sm"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 text-[10px] uppercase tracking-widest text-white/40 border border-white/10 hover:text-white hover:border-white/20 transition-colors"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-[10px] uppercase tracking-widest font-bold hover:bg-primary/90 transition-colors"
              >
                <Check className="w-3 h-3" />
                {isRtl ? 'حفظ' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Description + Owner */}
        {!editing && (description || owner) && (
          <div className="flex flex-col gap-2">
            {description && (
              <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{description}</p>
            )}
            {owner && (
              <div className="flex items-center gap-1.5">
                <User className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <span className="text-[11px] text-muted-foreground truncate">{owner}</span>
              </div>
            )}
          </div>
        )}

        {/* Progress — EARNED (EV ÷ BAC), never the dead manual field. */}
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">
            <span>{isRtl ? 'نسبة الإنجاز' : 'Earned Progress'}</span>
            <span className="font-mono text-white number-ltr">
              {evmPct === null ? '—' : formatPercent(evmPct)}
            </span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-sm overflow-hidden">
            <div
              className={cn('h-full rounded-sm transition-all', p.delayDays > 30 ? 'bg-chart-3' : p.delayDays > 0 ? 'bg-chart-5' : 'bg-primary')}
              style={{ width: `${(evmPct ?? 0) * 100}%` }}
            />
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-3 gap-3">
          {/* Contract Value */}
          <div className="bg-black/30 p-3 text-center border border-white/5">
            <div className="text-[9px] uppercase text-muted-foreground mb-1">Contract Value</div>
            <div className="text-sm font-mono text-white number-ltr">{formatCompactNumber(p.contractValue)}</div>
            <div className="text-[9px] text-muted-foreground/60">{cardCcy}</div>
          </div>

          {/* Delay */}
          <div className="bg-black/30 p-3 text-center border border-white/5">
            <div className="text-[9px] uppercase text-muted-foreground mb-1">Delay</div>
            <div className={cn('text-sm font-mono font-bold number-ltr', p.delayDays > 30 ? 'text-chart-3' : p.delayDays > 0 ? 'text-chart-5' : 'text-chart-4')}>
              {/* VISUAL QA — was the mojibake literal 'âœ“', a UTF-8 check
                  mark that had been decoded as Latin-1 at some point and
                  saved back. It rendered as garbage on every on-track
                  project card. Pre-existing, unrelated to the currency
                  work, but this file is being shipped anyway so it is
                  corrected rather than left visible. */}
              {p.delayDays > 0 ? `+${p.delayDays}d` : '\u2713'}
            </div>
            <div className="text-[9px] text-muted-foreground/60">{p.delayDays > 0 ? 'Behind' : 'On Track'}</div>
          </div>

          {/* Cash Position */}
          <div className="bg-black/30 p-3 text-center border border-white/5">
            <div className="text-[9px] uppercase text-muted-foreground mb-1">Cash Pos.</div>
            <div className={cn('text-sm font-mono font-bold number-ltr', cash >= 0 ? 'text-chart-4' : 'text-chart-3')}>
              {cash === 0 ? '—' : (cash > 0 ? '+' : '') + formatCompactNumber(Math.abs(cash))}
            </div>
            <div className="text-[9px] text-muted-foreground/60">{cardCcy}</div>
          </div>
        </div>

        {/* Secondary row */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">{openClaims} open claim{openClaims !== 1 ? 's' : ''}</span>
          </div>
          <div className="w-px h-3 bg-white/10" />
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">{voCount} VO{voCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="w-px h-3 bg-white/10" />
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3 h-3 text-muted-foreground" />
            <span className={cn('text-[10px] font-bold uppercase px-1.5 py-0.5 border', risk.color)}>{risk.label} Risk</span>
          </div>
          <div className="ms-auto">
            <span className="text-[10px] text-muted-foreground/50 font-mono">{p.cityEn}</span>
          </div>
        </div>

        {/* Open button */}
        <Link href={`/project/${p.id}`}>
          <div className="mt-auto pt-1">
            <div className="w-full text-center text-[10px] uppercase tracking-[0.2em] text-primary/60 border border-primary/20 py-2.5 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors cursor-pointer font-medium">
              {isRtl ? 'فتح المشروع' : 'Open Project'}
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
