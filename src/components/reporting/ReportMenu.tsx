import React, { useState, useRef, useEffect } from 'react';
import { FileStack, ChevronDown, Table2, FileType2, Presentation } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/store';
import { useTranslation } from '../../lib/i18n';
import { generateReport, exportReport, listReports } from '../../lib/reporting';

/**
 * Every report available at one scope, in one menu.
 * Destination: src/components/reporting/ReportMenu.tsx
 *
 * Used on a dashboard where several reports apply. A newly registered
 * definition appears here automatically — this file never changes.
 */

interface Props {
  /** 'Project' | 'Company' | 'Portfolio' */
  scope: string;
  context: Record<string, unknown>;
  label?: string;
  className?: string;
}

export default function ReportMenu({ scope, context, label, className }: Props) {
  const { user } = useAuth();
  const { lang } = useTranslation();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const isRtl = lang === 'ar';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const reports = listReports(scope);
  if (!reports.length) return null;

  const opts = () => ({
    lang: (isRtl ? 'ar' : 'en') as 'en' | 'ar',
    generatedBy: user?.username ?? 'Unknown',
  });

  const run = (id: string) => {
    setOpen(false);
    const w = generateReport(id, context, { format: 'pdf', ...opts() });
    if (!w) {
      alert(isRtl
        ? 'يرجى السماح بالنوافذ المنبثقة لإنشاء التقرير.'
        : 'Please allow pop-ups to generate the report.');
    }
  };

  /**
   * SPRINT 4 — Office export from the scope menu.
   *
   * The format is chosen ONCE at the top and applies to whichever report
   * is then clicked. Repeating three format buttons beside every report
   * in a list of twelve would produce a thirty-six item menu.
   */
  const [fmt, setFmt] = useState<'pdf' | 'excel' | 'word' | 'pptx'>('pdf');

  const pick = (id: string) => {
    if (fmt === 'pdf') return run(id);
    setOpen(false);
    if (!exportReport(id, context, fmt, opts())) {
      alert(isRtl
        ? 'تعذّر إنشاء الملف. التفاصيل في سجل المتصفح.'
        : 'The file could not be generated. See the browser console for details.');
    }
  };

  const FORMATS: { id: 'pdf' | 'excel' | 'word' | 'pptx'; label: string; Icon: any }[] = [
    { id: 'pdf',   label: 'PDF',   Icon: FileStack },
    { id: 'excel', label: 'Excel', Icon: Table2 },
    { id: 'word',  label: 'Word',  Icon: FileType2 },
    { id: 'pptx',  label: 'PPT',   Icon: Presentation },
  ];

  return (
    <div ref={boxRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn btn-secondary btn-sm"
      >
        <FileStack className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{label ?? (isRtl ? 'التقارير' : 'Reports')}</span>
        <ChevronDown className="w-3 h-3 opacity-60" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full mt-1 end-0 z-50 min-w-[15rem] ds-card ds-card-raised !p-1"
          style={{ boxShadow: 'var(--e-modal)' }}
        >
          <div className="t-second px-3 py-2 uppercase tracking-widest opacity-50">
            {scope}
          </div>

          {/* Format selector — chosen once, applied to the report clicked. */}
          <div className="flex gap-1 px-2 pb-2" role="group"
               aria-label={isRtl ? 'صيغة التصدير' : 'Export format'}>
            {FORMATS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={fmt === id}
                onClick={() => setFmt(id)}
                title={label}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1 px-2 py-1',
                  't-second uppercase tracking-wider transition-colors',
                  fmt === id
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="w-3 h-3" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          {reports.map(r => (
            <button key={r.id} type="button" role="menuitem"
                    onClick={() => pick(r.id)} className="rpt-item">
              {isRtl && r.labelAr ? r.labelAr : r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
