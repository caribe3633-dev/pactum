import React, { useState, useRef, useEffect } from 'react';
import { FileText, Printer, Eye, ChevronDown, Table2, FileType2, Presentation } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/store';
import { useTranslation } from '../../lib/i18n';
import { generateReport, exportReport, getReport } from '../../lib/reporting';

/**
 * The one control that produces a report.
 * Destination: src/components/reporting/ReportButton.tsx
 *
 * A module drops this in and passes the data it already holds. The button
 * never fetches, never calculates and never knows which report it triggers
 * beyond the id — everything else lives in the definition.
 *
 *   <ReportButton reportId="delay-analysis" context={{ project, rows: data, ld }} />
 */

interface Props {
  /** Registered report id. */
  reportId: string;
  /** Whatever the module already has in state. Passed through untouched. */
  context: Record<string, unknown>;
  /** Overrides the definition's label. */
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  className?: string;
}

export default function ReportButton({
  reportId, context, label, variant = 'secondary', size = 'sm', className,
}: Props) {
  const { user } = useAuth();
  const { lang } = useTranslation();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const def = getReport(reportId);
  const isRtl = lang === 'ar';

  // Close on outside click or Escape — standard menu behaviour.
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

  if (!def) return null;   // unregistered id renders nothing rather than breaking

  const opts = () => ({
    lang: (isRtl ? 'ar' : 'en') as 'en' | 'ar',
    generatedBy: user?.username ?? 'Unknown',
  });

  const run = (format: 'pdf' | 'print' | 'preview') => {
    setOpen(false);
    const w = generateReport(reportId, context, { format, ...opts() });
    if (!w) {
      // The only failure mode worth surfacing: the browser blocked the tab.
      alert(isRtl
        ? 'يرجى السماح بالنوافذ المنبثقة لإنشاء التقرير.'
        : 'Please allow pop-ups to generate the report.');
    }
  };

  /**
   * SPRINT 4 — Office export.
   *
   * A file download, not a new window, so the pop-up blocker is not
   * involved and the pop-up warning above would be the wrong message.
   * `exportReport` returns false only when the document could not be
   * built or written; that IS worth telling the user about, because
   * nothing visible happens either way and silence reads as a dead
   * button.
   */
  const save = (format: 'excel' | 'word' | 'pptx') => {
    setOpen(false);
    if (!exportReport(reportId, context, format, opts())) {
      alert(isRtl
        ? 'تعذّر إنشاء الملف. التفاصيل في سجل المتصفح.'
        : 'The file could not be generated. See the browser console for details.');
    }
  };

  // The trigger is a verb, not a document name: every module shows the same
  // control, so "Export" reads the same everywhere. The report's own name is
  // still what lands on the cover page.
  const text = label ?? (isRtl ? 'تصدير' : 'Export');

  return (
    <div ref={boxRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm')}
      >
        <FileText className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{text}</span>
        <ChevronDown className="w-3 h-3 opacity-60" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full mt-1 end-0 z-50 min-w-[13rem] ds-card ds-card-raised !p-1"
          style={{ boxShadow: 'var(--e-modal)' }}
        >
          <button type="button" role="menuitem" onClick={() => run('pdf')} className="rpt-item">
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            {isRtl ? 'حفظ كـ PDF' : 'Save as PDF'}
          </button>
          <button type="button" role="menuitem" onClick={() => run('print')} className="rpt-item">
            <Printer className="w-3.5 h-3.5" aria-hidden="true" />
            {isRtl ? 'طباعة التقرير' : 'Print Report'}
          </button>
          <button type="button" role="menuitem" onClick={() => run('preview')} className="rpt-item">
            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
            {isRtl ? 'معاينة' : 'Preview'}
          </button>

          {/* SPRINT 4 — the three Office formats. Separated by a rule
              because they DOWNLOAD rather than open a window: a different
              outcome deserves a different group, not a longer list. */}
          <div className="my-1 h-px bg-white/10" role="separator" />

          <button type="button" role="menuitem" onClick={() => save('excel')} className="rpt-item">
            <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
            {isRtl ? 'تصدير Excel' : 'Export to Excel'}
          </button>
          <button type="button" role="menuitem" onClick={() => save('word')} className="rpt-item">
            <FileType2 className="w-3.5 h-3.5" aria-hidden="true" />
            {isRtl ? 'تصدير Word' : 'Export to Word'}
          </button>
          <button type="button" role="menuitem" onClick={() => save('pptx')} className="rpt-item">
            <Presentation className="w-3.5 h-3.5" aria-hidden="true" />
            {isRtl ? 'تصدير PowerPoint' : 'Export to PowerPoint'}
          </button>
        </div>
      )}
    </div>
  );
}
