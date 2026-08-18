import React from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { useTranslation } from '../lib/i18n';

interface Props {
  title?: string;
  searchValue: string;
  onSearchChange: (v: string) => void;
  onManage?: () => void; // optional callback used by parent
  onNew?: () => void; // optional callback to create new company
}

export default function EnterpriseHeader({ title = 'Enterprise Portfolio', onManage, onNew }: Props) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';

  return (
    <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
      {/* Title block — identical to Project Portal */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-[1px] w-8 bg-primary/40" />
          <span className="text-[10px] uppercase tracking-[0.25em] text-primary/60 font-mono">PACTUM</span>
        </div>
        <h1 className="font-serif text-3xl md:text-4xl text-white">{title}</h1>
      </div>

      {/* Actions — search and notifications live in the global header */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Manage Companies */}
        <button
          onClick={() => onManage && onManage()}
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-primary/60 border border-primary/20 px-4 py-2.5 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors font-medium"
        >
          <Settings2 className="w-3.5 h-3.5" />
          {isRtl ? 'إدارة الشركات' : 'Manage'}
        </button>

        {/* New Company */}
        <button
          onClick={() => onNew && onNew()}
          className="flex items-center gap-2 bg-primary/10 text-primary border border-primary/30 px-4 py-2.5 text-[10px] uppercase tracking-[0.2em] hover:bg-primary hover:text-primary-foreground transition-colors font-medium"
        >
          <Plus className="w-3.5 h-3.5" />
          {isRtl ? 'شركة جديدة' : 'New Company'}
        </button>
      </div>
    </div>
  );
}
