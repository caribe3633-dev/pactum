import React from 'react';
import { useLocation, useRoute } from 'wouter';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';
import GlobalScopeSelector from './GlobalScopeSelector';

/**
 * Context Navigation Bar — one strip, every page.
 *
 * Merges the old <BackButton /> and <Breadcrumb /> into a single full-bleed
 * bar that sits directly under the header. The routing rules below are copied
 * verbatim from BackButton; no destination has changed.
 *
 *   /enterprise-portfolio  ->  /company/:id  ->  /sector/:id  ->  /project/:id
 *
 * Analytics levels step back to their own dashboard:
 *   /company/:id/analytics  ->  /company/:id
 *   /sector/:id/analytics   ->  /sector/:id
 *
 * Company subcontractor levels:
 *   /company/:id/subcontractors/:internalId  ->  /company/:id/subcontractors
 *   /company/:id/subcontractors              ->  /company/:id
 *
 * Back renders nothing at the top level or on an unknown route, exactly as
 * before. window.history.back() is never used.
 */

export interface ContextCrumb {
  label: string;
  href?: string;
}

interface ContextBarProps {
  /** Task 4 — show the global company/project selector. Default true. */
  showScope?: boolean;
  /** Current company, highlighted in the selector. */
  scopeCompanyId?: string;
  /** Current sector, highlighted in the selector. */
  scopeSectorId?: string;
  /** Current project, highlighted in the selector. */
  scopeProjectId?: string;
  /** Trail from the root to the current page. Last item is the current page. */
  items?: ContextCrumb[];
  /** Parent entity id, passed by the page from its own loaded data. */
  parentId?: string | number;
  /** Fully explicit parent path. Overrides route detection. */
  to?: string;
  /** Override the Back label. */
  backLabel?: string;
  /** Reference code pinned to the trailing edge, e.g. a project code. */
  code?: string;
  className?: string;
}

const ENTERPRISE = '/enterprise-portfolio';

export default function ContextBar({
  items = [], parentId, to, backLabel, code, className,
  showScope = true, scopeCompanyId, scopeSectorId, scopeProjectId,
}: ContextBarProps) {
  const [location, setLocation] = useLocation();
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';

  // Route matchers — most specific first. Unchanged from BackButton.
  const [isProject] = useRoute('/project/:id');
  const [isAnalytics, analyticsParams] = useRoute('/company/:id/analytics');
  const [isSubDash, subDashParams] = useRoute('/company/:companyId/subcontractors/:internalId');
  const [isSubs, subsParams] = useRoute('/company/:id/subcontractors');
  const [isSectorAnalytics, sectorAnalyticsParams] = useRoute('/sector/:id/analytics');
  const [isSector] = useRoute('/sector/:id');
  const [isSectorIndex] = useRoute('/sector');
  const [isCompany] = useRoute('/company/:id');
  const [isCompanyIndex] = useRoute('/company');

  const t = (ar: string, en: string) => (isRtl ? ar : en);

  const query = (key: string): string | null => {
    const qs = location.includes('?') ? location.split('?')[1] : window.location.search;
    return new URLSearchParams(qs).get(key);
  };

  const id = parentId != null ? String(parentId) : null;

  let parent: string | null = null;
  let parentLabel = '';

  if (to) {
    parent = to;
    parentLabel = backLabel ?? t('رجوع', 'Back');
  } else if (isAnalytics) {
    const cid = id ?? (analyticsParams as { id?: string } | null)?.id ?? null;
    parent = cid ? `/company/${cid}` : '/company';
    parentLabel = backLabel ?? t('لوحة الشركة', 'Company Dashboard');
  } else if (isSubDash) {
    const cid = (subDashParams as { companyId?: string } | null)?.companyId ?? null;
    parent = cid ? `/company/${cid}/subcontractors` : ENTERPRISE;
    parentLabel = backLabel ?? t('مقاولو الباطن', 'Subcontractors');
  } else if (isSubs) {
    const cid = id ?? (subsParams as { id?: string } | null)?.id ?? null;
    parent = cid ? `/company/${cid}` : '/company';
    parentLabel = backLabel ?? t('القطاعات', 'Sectors');
  } else if (isSectorAnalytics) {
    const sid = (sectorAnalyticsParams as { id?: string } | null)?.id ?? null;
    parent = sid ? `/sector/${sid}` : '/sector';
    parentLabel = backLabel ?? t('القطاع', 'Sector');
  } else if (isProject) {
    const sectorId = id ?? query('sector');
    parent = sectorId ? `/sector/${sectorId}` : '/sector';
    parentLabel = backLabel ?? t('القطاع', 'Sector');
  } else if (isSector || isSectorIndex) {
    const companyId = id ?? query('company');
    parent = companyId ? `/company/${companyId}` : '/company';
    parentLabel = backLabel ?? t('الشركة', 'Company');
  } else if (isCompany || isCompanyIndex) {
    parent = ENTERPRISE;
    parentLabel = backLabel ?? t('المحفظة', 'Enterprise Portfolio');
  }

  const showBack = Boolean(parent) && location !== ENTERPRISE;
  if (!showBack && items.length === 0 && !code) return null;

  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const Sep = isRtl ? ChevronLeft : ChevronRight;

  return (
    <nav aria-label={t('مسار التنقل', 'Context navigation')} className={cn('ctx', className)}>
      {showBack && (
        <button
          type="button"
          onClick={() => setLocation(parent!)}
          aria-label={t(`رجوع إلى ${parentLabel}`, `Back to ${parentLabel}`)}
          className="ctx-back"
        >
          <BackIcon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{parentLabel}</span>
        </button>
      )}

      <ol className="flex flex-wrap items-center gap-2 min-w-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2 min-w-0">
              {index > 0 && <Sep className="w-3 h-3 flex-shrink-0 ctx-sep" aria-hidden="true" />}
              {isLast || !item.href ? (
                <span className={cn('truncate', isLast ? 'ctx-here' : 'ctx-crumb')}
                      aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              ) : (
                // setLocation keeps navigation identical to the old <Link>.
                <button type="button" onClick={() => setLocation(item.href!)} className="ctx-crumb truncate">
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {code && <span className="ctx-code">{code}</span>}

      {/*
        PHASE 3F-UX Task 4 — global scope selector.

        Mounted here so it is present on every page that already renders a
        ContextBar, rather than added page by page. It navigates only to
        /company/:id and /project/:id, both already declared in App.tsx —
        no route is added and no route order changes.
      */}
      {showScope && (
        <div className="ms-auto flex-shrink-0">
          <GlobalScopeSelector
            companyId={scopeCompanyId}
            sectorId={scopeSectorId ?? (isSector || isSectorAnalytics ? String(parentId ?? sectorAnalyticsParams?.id ?? '') || undefined : undefined)}
            projectId={scopeProjectId}
          />
        </div>
      )}
    </nav>
  );
}
