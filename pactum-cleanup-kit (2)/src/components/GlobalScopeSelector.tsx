import React, { useMemo } from 'react';
import { useLocation } from 'wouter';
import { Building2, HardHat, ChevronDown, Layers } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useProjects } from '../lib/store';
import { useActiveCompanies, useSectors } from '../lib/useMasterData';

/**
 * Global company + project selector.
 * Destination: src/components/GlobalScopeSelector.tsx
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3F-UX · Task 4.
 *
 * Phase 3E: "No global company/sector switcher. Navigation is URL /
 * card-click only." Changing context meant going back to the portfolio
 * grid and clicking down through the hierarchy again.
 *
 * ── Routing safety ────────────────────────────────────────────────────
 *
 *   The brief says this must not break routing, so the component NEVER
 *   invents a path. It navigates only to routes that already exist and
 *   are already reachable by clicking:
 *
 *       /company/:id      declared in App.tsx  (CompanySectorsPage)
 *       /project/:id      declared in App.tsx  (ProjectDashboardPage)
 *
 *   No new route is registered, no route order changes, and every
 *   destination is a plain `setLocation` to a literal the router already
 *   matches. The `key` on each option is the entity id, never an index.
 *
 * ── Why a native <select> ─────────────────────────────────────────────
 *
 *   A custom dropdown would be a new visual language. `<select>` inherits
 *   the same field styling the create-project form already uses, keeps
 *   keyboard and screen-reader behaviour for free, and cannot trap focus.
 *
 * ── Data is live ──────────────────────────────────────────────────────
 *
 *   Both lists come from the Task 2 subscription, so a company renamed on
 *   another screen updates inside this selector without a reload.
 * ══════════════════════════════════════════════════════════════════════
 */

interface Props {
  /** Highlighted as current, when the page knows its own scope. */
  companyId?: string;
  /** Highlighted as current. The middle rung of the hierarchy. */
  sectorId?: string;
  projectId?: string;
  className?: string;
}

export default function GlobalScopeSelector({ companyId, sectorId, projectId, className }: Props) {
  const [, setLocation] = useLocation();
  const { lang } = useTranslation();
  const { projects } = useProjects();
  const companies = useActiveCompanies();
  const sectors = useSectors();

  const isRtl = lang === 'ar';

  /**
   * Projects the selector may jump to.
   *
   * Archived projects are excluded: this is a navigation convenience for
   * live work, and an archived project is still reachable through the
   * Archived filter on the portal. Scoped to the current company when one
   * is known, so the list stays short and relevant.
   */
  /**
   * Sectors the selector may jump to, narrowed by the company in scope.
   *
   * Company > Sector > Project is the real hierarchy, and the bar now
   * shows all three rungs. Only ACTIVE sectors are offered: an archived
   * one is still reachable by URL and from the company page, but it is
   * not somewhere you navigate to by habit.
   */
  const scopedSectors = useMemo(() => {
    const live = sectors.filter(s => s.status !== 'Archived');
    return companyId ? live.filter(s => s.companyId === companyId) : live;
  }, [sectors, companyId]);

  /**
   * Projects the selector may jump to.
   *
   * Narrowed by SECTOR when one is chosen, otherwise by company. Picking
   * a sector and still being offered every project in the company would
   * make the middle rung decorative.
   */
  const scopedProjects = useMemo(() => {
    const live = projects.filter((p: any) => p.status !== 'Archived');
    if (sectorId) return live.filter((p: any) => p.sectorId === sectorId);
    if (!companyId) return live;
    const owned = new Set(sectors.filter(s => s.companyId === companyId).map(s => s.id));
    return live.filter((p: any) =>
      p.companyId === companyId || (p.sectorId && owned.has(p.sectorId)));
  }, [projects, sectors, companyId, sectorId]);

  const go = (path: string) => { if (path) setLocation(path); };

  const field =
    'appearance-none bg-black/40 border border-white/[0.06] ps-8 pe-7 py-1.5 ' +
    'text-(length:--t-second) text-white hover:border-primary/40 focus:border-primary ' +
    'focus:outline-none transition-colors cursor-pointer max-w-[200px] truncate';

  return (
    <div className={cn('flex items-center gap-2', className)} dir={isRtl ? 'rtl' : 'ltr'}>

      {/* ── Company ── */}
      <div className="relative">
        <Building2 className="w-3.5 h-3.5 text-primary/60 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <select
          aria-label={isRtl ? 'اختر شركة' : 'Select company'}
          value={companyId ?? ''}
          onChange={e => go(e.target.value ? `/company/${e.target.value}` : '')}
          className={field}
        >
          <option value="">{isRtl ? 'الشركة…' : 'Company…'}</option>
          {companies.map(c => (
            <option key={c.id} value={c.id}>
              {isRtl && c.nameAr ? c.nameAr : c.name}
            </option>
          ))}
        </select>
        <ChevronDown className="w-3 h-3 text-muted-foreground absolute end-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {/* ── Sector ── the middle rung, between company and project ── */}
      <div className="relative">
        <Layers className="w-3.5 h-3.5 text-primary/60 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <select
          aria-label={isRtl ? 'اختر قطاعاً' : 'Select sector'}
          value={sectorId ?? ''}
          onChange={e => go(e.target.value ? `/sector/${e.target.value}` : '')}
          disabled={scopedSectors.length === 0}
          className={cn(field, scopedSectors.length === 0 && 'opacity-40 cursor-not-allowed')}
        >
          <option value="">
            {scopedSectors.length === 0
              ? (isRtl ? 'لا قطاعات' : 'No sectors')
              : (isRtl ? 'القطاع…' : 'Sector…')}
          </option>
          {scopedSectors.map(s => (
            <option key={s.id} value={s.id}>
              {isRtl && s.nameAr ? s.nameAr : s.name}
            </option>
          ))}
        </select>
        <ChevronDown className="w-3 h-3 text-muted-foreground absolute end-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {/* ── Project ── */}
      <div className="relative">
        <HardHat className="w-3.5 h-3.5 text-primary/60 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <select
          aria-label={isRtl ? 'اختر مشروعاً' : 'Select project'}
          value={projectId ?? ''}
          onChange={e => go(e.target.value ? `/project/${e.target.value}` : '')}
          disabled={scopedProjects.length === 0}
          className={cn(field, scopedProjects.length === 0 && 'opacity-40 cursor-not-allowed')}
        >
          <option value="">
            {scopedProjects.length === 0
              ? (isRtl ? 'لا مشاريع' : 'No projects')
              : (isRtl ? 'المشروع…' : 'Project…')}
          </option>
          {scopedProjects.map((p: any) => (
            <option key={p.id} value={p.id}>
              {isRtl ? (p.nameAr || p.nameEn) : p.nameEn}
            </option>
          ))}
        </select>
        <ChevronDown className="w-3 h-3 text-muted-foreground absolute end-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </div>
  );
}
