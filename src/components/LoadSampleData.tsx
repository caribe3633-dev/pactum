import React, { useState } from 'react';
import { FlaskConical, Check, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/store';
import {
  loadSampleFor, isProjectEmpty, SAMPLE_LABELS,
  type SampleKind, type SampleProject,
} from '../lib/sampleData';

/**
 * "Load Sample Data" — the ONLY way demo records enter a project.
 * Destination: src/components/LoadSampleData.tsx
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3G · DEMO DATA ELIMINATION
 *
 * Before this, fabricated records appeared on their own: 4 subcontractors
 * and 12 certificates at project creation, plus a seed row the first time
 * Cash Flow, Certificates, Risk, Claims, Change Orders, Budget or the
 * Delay Register was opened. Nothing asked the user.
 *
 * Every one of those paths is now inert. This control is the sole
 * replacement, and it is deliberately awkward to trigger by accident:
 *
 *   · admin only
 *   · shown ONLY while the project is completely empty
 *   · requires a second, explicit confirmation click
 *   · never overwrites — a store holding anything is skipped
 *
 * Once a project holds any data the button disappears entirely, so it
 * cannot contaminate real work.
 * ══════════════════════════════════════════════════════════════════════
 */

interface Props {
  project: SampleProject;
  /** Load only these datasets. Defaults to all. */
  kinds?: SampleKind[];
  /** Called after a successful load so the caller can re-read. */
  onLoaded?: () => void;
  className?: string;
}

export default function LoadSampleData({ project, kinds, onLoaded, className }: Props) {
  const { lang } = useTranslation();
  const { user } = useAuth();
  const isRtl = lang === 'ar';

  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState('');

  // Admin only, and only while there is genuinely nothing to lose.
  if (user?.role !== 'admin') return null;
  if (!isProjectEmpty(project.id)) return null;

  const run = () => {
    const r = loadSampleFor(project, kinds);
    const names = r.loaded
      .map(k => {
        const m = SAMPLE_LABELS.find(x => x.kind === k);
        return m ? (isRtl ? m.ar : m.en) : k;
      })
      .join(' · ');
    setDone(names || (isRtl ? 'لا شيء لتحميله' : 'Nothing to load'));
    setConfirming(false);
    onLoaded?.();
  };

  if (done) {
    return (
      <div className={cn('flex items-start gap-2 border border-chart-4/30 bg-chart-4/[0.06] px-3 py-2', className)}>
        <Check className="w-3.5 h-3.5 text-chart-4 mt-0.5 flex-shrink-0" />
        <p className="text-(length:--t-second) text-chart-4">
          {isRtl ? `تم تحميل بيانات تجريبية: ${done}` : `Sample data loaded: ${done}`}
        </p>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className={cn('flex flex-col gap-2 border border-chart-5/30 bg-chart-5/[0.06] px-3 py-2', className)}
           dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-chart-5 mt-0.5 flex-shrink-0" />
          <p className="text-(length:--t-second) text-chart-5">
            {isRtl
              ? 'سيضيف هذا سجلات تجريبية مُختلقة لهذا المشروع لأغراض العرض فقط. لن يُستبدل أي سجل قائم. ليست بيانات حقيقية.'
              : 'This adds fabricated demonstration records to this project. Nothing existing is overwritten. These are not real records.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setConfirming(false)} className="btn btn-secondary btn-sm">
            {isRtl ? 'إلغاء' : 'Cancel'}
          </button>
          <button onClick={run} className="btn btn-primary btn-sm">
            <FlaskConical className="w-3 h-3" />
            {isRtl ? 'نعم، حمِّل البيانات التجريبية' : 'Yes, load sample data'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title={isRtl ? 'يظهر فقط بينما المشروع فارغ' : 'Shown only while the project is empty'}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-2 border border-white/[0.06]',
        'text-(length:--t-label) uppercase tracking-wider text-muted-foreground',
        'hover:text-primary hover:border-primary/40 transition-colors',
        className,
      )}
    >
      <FlaskConical className="w-3.5 h-3.5" />
      {isRtl ? 'تحميل بيانات تجريبية' : 'Load Sample Data'}
    </button>
  );
}
