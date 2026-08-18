import React, { useState } from 'react';
import { AlertTriangle, Trash2, RotateCcw, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/store';
import {
  performReset, previewReset, summariseReset,
  type ResetScope, type ResetReport,
} from '../lib/enterpriseReset';

/**
 * Enterprise / Factory reset.
 * Destination: src/components/EnterpriseReset.tsx
 *
 * ══════════════════════════════════════════════════════════════════════
 * PHASE 3H
 *
 * The most destructive control in the product, so it is guarded harder
 * than anything else:
 *
 *   1 · admin only
 *   2 · a preview showing exactly what will be destroyed, counted live
 *   3 · the user must TYPE the confirmation phrase — no click-through
 *   4 · a report is produced and shown, listing what actually happened
 *
 * `localStorage` is the entire database. There is no undo and no backup,
 * so the copy says so plainly rather than softening it.
 *
 * SEEDS NOTHING — after a reset the first company must be created by a
 * human, which is the point.
 * ══════════════════════════════════════════════════════════════════════
 */

const PHRASE: Record<ResetScope, string> = {
  enterprise: 'RESET ENTERPRISE',
  factory: 'FACTORY RESET',
};

export default function EnterpriseReset({ className }: { className?: string }) {
  const { lang } = useTranslation();
  const { user } = useAuth();
  const isRtl = lang === 'ar';

  const [scope, setScope] = useState<ResetScope | null>(null);
  const [typed, setTyped] = useState('');
  const [report, setReport] = useState<ResetReport | null>(null);

  if (user?.role !== 'admin') return null;

  const preview = scope ? previewReset(scope) : null;
  const armed = scope !== null && typed.trim().toUpperCase() === PHRASE[scope];

  const run = () => {
    if (!scope || !armed) return;
    const r = performReset(scope, user?.username ?? 'unknown');
    setReport(r);
    setScope(null);
    setTyped('');
  };

  // ── Report ──
  if (report) {
    return (
      <div className={cn('ds-card ds-card-tight', report.ok ? 'border-chart-4/30' : 'border-chart-3/40', className)}
           dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2 mb-3">
          {report.ok
            ? <Check className="w-4 h-4 text-chart-4" />
            : <AlertTriangle className="w-4 h-4 text-chart-3" />}
          <span className={cn('font-semibold', report.ok ? 'text-chart-4' : 'text-chart-3')}>
            {isRtl ? 'تقرير إعادة الضبط' : 'Reset Report'}
          </span>
          <span className="ms-auto text-(length:--t-micro) font-mono text-muted-foreground number-ltr">
            {report.at.slice(0, 19).replace('T', ' ')} · {report.by}
          </span>
        </div>
        <ul className="space-y-1 mb-3">
          {summariseReset(report, isRtl ? 'ar' : 'en').map((line, i) => (
            <li key={i} className="text-(length:--t-second) text-muted-foreground">· {line}</li>
          ))}
        </ul>
        <p className="text-(length:--t-second) text-primary/80 mb-3">
          {isRtl
            ? 'لم تُزرع أي بيانات. أنشئ أول شركة لتبدأ.'
            : 'Nothing was seeded. Create your first company to begin.'}
        </p>
        <button onClick={() => { setReport(null); window.location.reload(); }}
                className="btn btn-primary btn-sm">
          <RotateCcw className="w-3 h-3" />
          {isRtl ? 'إعادة تحميل التطبيق' : 'Reload application'}
        </button>
      </div>
    );
  }

  // ── Confirmation ──
  if (scope && preview) {
    return (
      <div className={cn('ds-card ds-card-tight border-chart-3/40', className)}
           dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-chart-3" />
          <span className="text-chart-3 font-semibold">
            {scope === 'factory'
              ? (isRtl ? 'إعادة ضبط المصنع' : 'Factory Reset')
              : (isRtl ? 'إعادة ضبط المؤسسة' : 'Enterprise Reset')}
          </span>
        </div>

        <p className="text-(length:--t-second) text-muted-foreground mb-3">
          {isRtl
            ? 'هذا الإجراء نهائي ولا يمكن التراجع عنه. كل البيانات محفوظة في المتصفح فقط، ولا توجد نسخة احتياطية.'
            : 'This is permanent and cannot be undone. All data lives in this browser only — there is no backup.'}
        </p>

        {/* Exactly what will be destroyed, counted now */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {[
            { k: isRtl ? 'شركات' : 'Companies', v: preview.companies },
            { k: isRtl ? 'قطاعات' : 'Sectors', v: preview.sectors },
            { k: isRtl ? 'مشاريع' : 'Projects', v: preview.projects },
            { k: isRtl ? 'مخازن بيانات' : 'Data stores', v: preview.businessKeys },
          ].map(x => (
            <div key={x.k} className="bg-black/30 border border-white/5 px-3 py-2 text-center">
              <div className="text-(length:--t-micro) uppercase text-muted-foreground">{x.k}</div>
              <div className="text-sm font-mono text-chart-3 number-ltr">{x.v}</div>
            </div>
          ))}
        </div>

        <p className="text-(length:--t-second) mb-3">
          {scope === 'factory' ? (
            <span className="text-chart-3">
              {isRtl
                ? `سيحذف أيضاً المستخدمين (${preview.identityKeys}) والتفضيلات (${preview.preferenceKeys}) وسيخرجك من النظام.`
                : `Also deletes users (${preview.identityKeys}) and preferences (${preview.preferenceKeys}), and signs you out.`}
            </span>
          ) : (
            <span className="text-chart-4">
              {isRtl
                ? 'المستخدمون وجلستك وتفضيلات العرض ستبقى كما هي.'
                : 'Users, your session and display preferences are preserved.'}
            </span>
          )}
        </p>

        <label className="block text-(length:--t-micro) uppercase tracking-wider text-muted-foreground mb-1">
          {isRtl ? `اكتب «${PHRASE[scope]}» للتأكيد` : `Type "${PHRASE[scope]}" to confirm`}
        </label>
        <input
          value={typed}
          onChange={e => setTyped(e.target.value)}
          dir="ltr"
          autoFocus
          className="w-full bg-black border border-white/10 px-3 py-2 text-sm font-mono mb-3"
        />

        <div className="flex items-center gap-2">
          <button onClick={() => { setScope(null); setTyped(''); }} className="btn btn-secondary btn-sm">
            {isRtl ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            onClick={run}
            disabled={!armed}
            className="btn btn-sm bg-chart-3 text-black font-bold disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 className="w-3 h-3" />
            {isRtl ? 'تنفيذ إعادة الضبط' : 'Perform reset'}
          </button>
        </div>
      </div>
    );
  }

  // ── Entry ──
  return (
    <div className={cn('ds-card ds-card-tight', className)} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-3 mb-2">
        <h3 className="font-serif text-lg text-white">
          {isRtl ? 'منطقة الخطر' : 'Danger Zone'}
        </h3>
        <div className="h-px flex-1 bg-chart-3/20" />
      </div>
      <p className="text-(length:--t-second) text-muted-foreground mb-3">
        {isRtl
          ? 'إجراءات مدمِّرة لا رجعة فيها. لا تُزرع أي بيانات بعدها.'
          : 'Destructive, irreversible actions. Nothing is seeded afterwards.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { setScope('enterprise'); setTyped(''); }}
                className="btn btn-secondary btn-sm hover:text-chart-3 hover:border-chart-3/40">
          <Trash2 className="w-3 h-3" />
          {isRtl ? 'إعادة ضبط المؤسسة' : 'Enterprise Reset'}
        </button>
        <button onClick={() => { setScope('factory'); setTyped(''); }}
                className="btn btn-secondary btn-sm hover:text-chart-3 hover:border-chart-3/40">
          <AlertTriangle className="w-3 h-3" />
          {isRtl ? 'إعادة ضبط المصنع' : 'Factory Reset'}
        </button>
      </div>
    </div>
  );
}
