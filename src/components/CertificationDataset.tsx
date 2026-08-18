import React, { useState } from 'react';
import { FlaskConical, Check, AlertTriangle, ShieldCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/store';
import {
  seedCertificationDataset, verifyCertificationDataset,
  isCertificationDatasetDeployed, countCertificationData,
  type SeedResult,
} from '../lib/certification/EngineeringCertificationSeed';
import { ECD_VERSION } from '../lib/certification/EngineeringCertificationDataset';

/**
 * Engineering Certification Dataset — deploy and verify.
 * Destination: src/components/CertificationDataset.tsx
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 0-B
 *
 * The dataset is reinstated after every major architectural change, so it
 * needs a control an engineer can reach without a console. It sits beside
 * Enterprise Reset because it belongs to the same class of operation.
 *
 * GUARDED LIKE THE RESET, FOR THE SAME REASON
 *
 *   Seeding with `purgeExisting` destroys real business data. So: admin
 *   only, a live preview of what is currently stored, and — for the
 *   destructive path — a typed confirmation phrase rather than a click.
 *
 *   The non-destructive path needs no phrase: it cannot overwrite,
 *   because deterministic ids make the application's own duplicate guards
 *   refuse a second copy.
 *
 * REPORTS WHAT HAPPENED, NOT WHAT WAS INTENDED
 *
 *   The panel prints storage counts read back AFTER the write, and the
 *   verification runs against storage rather than against the seed's
 *   return value. A seed that claimed success while writing nothing would
 *   fail here, which is the only reason the display is worth trusting.
 * ══════════════════════════════════════════════════════════════════════
 */

const PHRASE = 'REPLACE WITH CERTIFICATION DATASET';

export default function CertificationDataset({ className }: { className?: string }) {
  const { lang } = useTranslation();
  const { user } = useAuth();
  const isRtl = lang === 'ar';

  const [counts, setCounts] = useState(() => countCertificationData());
  const [deployed, setDeployed] = useState(() => isCertificationDatasetDeployed());
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [checks, setChecks] = useState<ReturnType<typeof verifyCertificationDataset> | null>(null);

  if (user?.role !== 'admin') return null;

  const refresh = () => {
    setCounts(countCertificationData());
    setDeployed(isCertificationDatasetDeployed());
  };

  const run = (purge: boolean) => {
    setBusy(true);
    try {
      const r = seedCertificationDataset({ by: user?.username ?? 'admin', purgeExisting: purge });
      setResult(r);
      setChecks(verifyCertificationDataset());
      refresh();
      setTyped('');
    } finally {
      setBusy(false);
    }
  };

  const verifyOnly = () => {
    setChecks(verifyCertificationDataset());
    refresh();
  };

  const row = (label: string, value: number) => (
    <div key={label} className="flex items-baseline justify-between gap-3">
      <span className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-(length:--t-second) font-mono">{value}</span>
    </div>
  );

  const failed = checks ? checks.checks.filter(c => !c.ok) : [];

  return (
    <div className={cn('ds-card', className)} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="w-4 h-4 text-primary" aria-hidden="true" />
        <h3 className="text-(length:--t-label) uppercase tracking-wider">
          {isRtl ? `مجموعة بيانات الاعتماد الهندسي v${ECD_VERSION}`
                 : `Engineering Certification Dataset v${ECD_VERSION}`}
        </h3>
        {deployed && (
          <span className="ms-auto inline-flex items-center gap-1 text-(length:--t-micro)
                           uppercase tracking-wider text-chart-4">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            {isRtl ? 'منشورة' : 'Deployed'}
          </span>
        )}
      </div>

      <p className="text-(length:--t-second) text-muted-foreground mb-4 leading-relaxed">
        {isRtl
          ? 'مجموعة بيانات ثابتة تُعاد بعد كل تغيير معماري كبير. المعرّفات ثابتة، فتشغيلها مرتين لا ينشئ نسخاً مكررة.'
          : 'A fixed dataset reinstated after every major architectural change. Identifiers are deterministic, so running it twice cannot create duplicates.'}
      </p>

      {/* Live storage counts — read back, never assumed. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 mb-4">
        {row(isRtl ? 'شركات' : 'Companies', counts.companies)}
        {row(isRtl ? 'قطاعات' : 'Sectors', counts.sectors)}
        {row(isRtl ? 'مشاريع' : 'Projects', counts.projects)}
        {row(isRtl ? 'أسعار صرف' : 'FX rates', counts.fxRates)}
        {row(isRtl ? 'لقطات' : 'Snapshots', counts.snapshots)}
        {row(isRtl ? 'شهادات' : 'Certificates', counts.certificates)}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => run(false)} disabled={busy}
                className="btn btn-secondary btn-sm">
          {isRtl ? 'نشر (غير مُتلِف)' : 'Deploy (non-destructive)'}
        </button>
        <button type="button" onClick={verifyOnly} disabled={busy}
                className="btn btn-secondary btn-sm">
          {isRtl ? 'تحقّق فقط' : 'Verify only'}
        </button>
      </div>

      {/* The destructive path. Typed phrase, no click-through. */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="flex items-start gap-2 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-chart-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-(length:--t-micro) text-chart-3 leading-relaxed">
            {isRtl
              ? 'الاستبدال يحذف كل بيانات الأعمال الحالية — لا تراجع ولا نسخة احتياطية.'
              : 'Replacing destroys all current business data. There is no undo and no backup.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={PHRASE}
            aria-label={isRtl ? 'عبارة التأكيد' : 'Confirmation phrase'}
            className="flex-1 min-w-[16rem] bg-black border border-white/10 px-3 py-1.5
                       text-(length:--t-second) font-mono"
          />
          <button
            type="button"
            disabled={busy || typed.trim() !== PHRASE}
            onClick={() => run(true)}
            className="btn btn-secondary btn-sm disabled:opacity-40"
          >
            {isRtl ? 'مسح واستبدال' : 'Purge & replace'}
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground mb-2">
            {isRtl ? 'نتيجة النشر' : 'Deployment result'}
          </div>
          {result.steps.map(s => (
            <div key={s.step} className="flex items-baseline justify-between gap-3">
              <span className="text-(length:--t-second)">{s.step}</span>
              <span className="text-(length:--t-second) font-mono text-muted-foreground">
                +{s.created}{s.skipped ? ` · ${s.skipped} skipped` : ''}{s.detail ? ` · ${s.detail}` : ''}
              </span>
            </div>
          ))}
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {result.errors.slice(0, 8).map((e, i) => (
                <li key={i} className="text-(length:--t-micro) text-chart-3">{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {checks && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center gap-2 mb-2">
            {checks.ok
              ? <Check className="w-3.5 h-3.5 text-chart-4" aria-hidden="true" />
              : <AlertTriangle className="w-3.5 h-3.5 text-chart-3" aria-hidden="true" />}
            <span className={cn('text-(length:--t-second) uppercase tracking-wider',
                                checks.ok ? 'text-chart-4' : 'text-chart-3')}>
              {checks.checks.filter(c => c.ok).length}/{checks.checks.length}{' '}
              {isRtl ? 'تحقق' : 'checks passed'}
            </span>
          </div>
          {failed.map(c => (
            <div key={c.id} className="text-(length:--t-micro) text-chart-3">
              {c.id} · {c.what} — expected {c.expected}, got {c.actual}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
