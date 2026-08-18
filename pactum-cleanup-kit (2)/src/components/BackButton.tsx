import { useLocation, useRoute } from 'wouter';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';

/**
 * Contextual Back button — navigates ONE level up using explicit parent routes.
 *
 * Hierarchy (projects live INSIDE the sector page; there is no projects list):
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
 * Renders nothing at the top level (/enterprise-portfolio) or on unknown routes.
 * Never uses window.history.back().
 *
 * Parent id resolution order:
 *   1. `parentId` prop passed by the page (preferred — the page already has it)
 *   2. route params
 *   3. fallback to the level's index route
 */

interface BackButtonProps {
  /** Parent entity id. Pass this from the page's already-loaded data. */
  parentId?: string | number;
  /** Fully explicit parent path. Overrides everything. */
  to?: string;
  /** Override the button label. */
  label?: string;
  className?: string;
}

const ENTERPRISE = '/enterprise-portfolio';

export default function BackButton({ parentId, to, label, className }: BackButtonProps) {
  const [location, setLocation] = useLocation();
  const { lang } = useTranslation();

  // Existing route params — most specific first
  const [isProject] = useRoute('/project/:id');
  const [isAnalytics, analyticsParams] = useRoute('/company/:id/analytics');
  const [isSubDash, subDashParams] = useRoute('/company/:companyId/subcontractors/:internalId');
  const [isSubs, subsParams] = useRoute('/company/:id/subcontractors');
  const [isSectorAnalytics, sectorAnalyticsParams] = useRoute('/sector/:id/analytics');
  const [isSector] = useRoute('/sector/:id');
  const [isSectorIndex] = useRoute('/sector');
  const [isCompany] = useRoute('/company/:id');
  const [isCompanyIndex] = useRoute('/company');

  const t = (ar: string, en: string) => (lang === 'ar' ? ar : en);

  const query = (key: string): string | null => {
    const qs = location.includes('?') ? location.split('?')[1] : window.location.search;
    return new URLSearchParams(qs).get(key);
  };

  const id = parentId != null ? String(parentId) : null;

  let parent: string | null = null;
  let parentLabel = '';

  if (to) {
    parent = to;
    parentLabel = label ?? t('رجوع', 'Back');
  } else if (isAnalytics) {
    // Company Analytics -> Company Dashboard
    const cid = id ?? (analyticsParams as { id?: string } | null)?.id ?? null;
    parent = cid ? `/company/${cid}` : '/company';
    parentLabel = label ?? t('لوحة الشركة', 'Company Dashboard');
  } else if (isSubDash) {
    // Subcontractor Dashboard -> Company Subcontractors
    const cid = (subDashParams as { companyId?: string } | null)?.companyId ?? null;
    parent = cid ? `/company/${cid}/subcontractors` : ENTERPRISE;
    parentLabel = label ?? t('مقاولو الباطن', 'Subcontractors');
  } else if (isSubs) {
    // Company Subcontractors -> Company Sectors
    const cid = id ?? (subsParams as { id?: string } | null)?.id ?? null;
    parent = cid ? `/company/${cid}` : '/company';
    parentLabel = label ?? t('القطاعات', 'Sectors');
  } else if (isSectorAnalytics) {
    // Sector Analytics -> Sector Dashboard
    const sid = (sectorAnalyticsParams as { id?: string } | null)?.id ?? null;
    parent = sid ? `/sector/${sid}` : '/sector';
    parentLabel = label ?? t('القطاع', 'Sector');
  } else if (isProject) {
    // Project Dashboard -> Sector Page
    const sectorId = id ?? query('sector');
    parent = sectorId ? `/sector/${sectorId}` : '/sector';
    parentLabel = label ?? t('القطاع', 'Sector');
  } else if (isSector || isSectorIndex) {
    // Sector Page -> Company Dashboard
    const companyId = id ?? query('company');
    parent = companyId ? `/company/${companyId}` : '/company';
    parentLabel = label ?? t('الشركة', 'Company');
  } else if (isCompany || isCompanyIndex) {
    // Company Dashboard -> Enterprise Portfolio
    parent = ENTERPRISE;
    parentLabel = label ?? t('المحفظة', 'Enterprise Portfolio');
  }

  // Top level or unknown route -> render nothing
  if (!parent || location === ENTERPRISE) return null;

  const Icon = lang === 'ar' ? ArrowRight : ArrowLeft;

  return (
    <button
      type="button"
      onClick={() => setLocation(parent!)}
      aria-label={t(`رجوع إلى ${parentLabel}`, `Back to ${parentLabel}`)}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium',
        'text-white/50 hover:text-primary',
        'border border-white/10 hover:border-primary/30',
        'bg-white/[0.02] hover:bg-primary/[0.06]',
        'transition-all rounded-sm',
        className
      )}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      <span>{parentLabel}</span>
    </button>
  );
}