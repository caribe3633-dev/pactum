import React from 'react';
import { useLocation } from 'wouter';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';

/**
 * Company-level tab strip.
 * Destination: src/components/CompanyTabs.tsx
 *
 * Uses the exact tab pattern already in ProjectDashboardPage:
 *   inline-flex · gap-2 · px-4 py-2 · border border-white/[0.06] · rounded-md
 *   active -> bg-primary/10 text-primary border-primary
 *
 * No new visual language introduced.
 */

export default function CompanyTabs({
  companyId,
  active,
}: {
  companyId: string;
  // 'currency' added for Finance -> Currency Management. Existing callers
  // pass 'sectors' or 'subcontractors' and are unaffected.
  active: 'sectors' | 'subcontractors' | 'currency';
}) {
  const [, setLocation] = useLocation();
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';

  const tabs = [
    {
      id: 'sectors' as const,
      label: isRtl ? 'القطاعات' : 'Sectors',
      href: `/company/${companyId}`,
    },
    {
      id: 'subcontractors' as const,
      label: isRtl ? 'مقاولو الباطن' : 'Subcontractors',
      href: `/company/${companyId}/subcontractors`,
    },
    {
      id: 'currency' as const,
      label: isRtl ? 'العملات' : 'Currency',
      href: `/company/${companyId}/currency`,
    },
  ];

  return (
    <div className="mb-6 overflow-x-auto">
      <nav className="inline-flex gap-2 pb-2">
        {tabs.map(tab => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setLocation(tab.href)}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 text-sm transition-all whitespace-nowrap border border-white/[0.06] rounded-md',
                isActive
                  ? 'bg-primary/10 text-primary border-primary'
                  : 'text-white/60 hover:text-white hover:border-white/20 hover:bg-white/5'
              )}
            >
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
