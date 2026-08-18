import React from 'react';
import { Company } from '../mock/companies';
import CompanyCard from './CompanyCard';
import { useTranslation } from '../lib/i18n';
import { Clock } from 'lucide-react';

interface Props {
  companies: Company[];
  onEnter?: (c: Company) => void;
}

export default function CompanyGrid({ companies, onEnter }: Props) {
  const { lang } = useTranslation();

  if (!companies || companies.length === 0) {
    return (
      <div className="ds-empty">
        <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
          <Clock className="w-8 h-8 text-muted-foreground -rotate-45" />
        </div>
        <p className="ds-empty-title">
          {lang === 'ar' ? 'لا توجد شركات' : 'No Companies Found'}
        </p>
        <p className="ds-empty-sub">
          {lang === 'ar' ? 'جرّب تعديل البحث أو أضف شركة جديدة.' : 'Try adjusting your search or add a new company.'}
        </p>
      </div>
    );
  }

  return (
    <div className="ds-grid">
      {companies.map(c => (
        <CompanyCard key={c.id} company={c} onEnter={onEnter} />
      ))}
    </div>
  );
}



