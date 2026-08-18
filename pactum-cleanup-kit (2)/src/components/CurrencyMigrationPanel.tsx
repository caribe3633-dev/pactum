import React, { useState } from 'react';
import { Coins, Check, AlertTriangle, Ban } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useAuth, useProjects } from '../lib/store';
import { fetchSectors } from '../mock/sectors';
import { companyIdOfProject } from '../lib/projectMaster';
import {
  migrateProject, MIGRATION_VERSION,
  type MigrationReport,
} from '../lib/currencyMigration';

/**
 * Storage-currency migration — the operator's control.
 * Destination: src/components/CurrencyMigrationPanel.tsx
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY IT SHOWS THE REPORT BEFORE IT WILL WRITE
 *
 *   This moves money between units across every register a project owns.
 *   A button that silently rewrites financial history is not acceptable,
 *   so the panel is two-stage:
 *
 *     DRY RUN   performs every calculation, writes nothing, and prints
 *               rows discovered / migrated / skipped / blocked with
 *               before-and-after totals per store.
 *     APPLY     enabled only after a dry run, and only for what the dry
 *               run actually reported.
 *
 *   A blocked row is named with its store, its reference and the exact
 *   reason. It is never converted on a guess and never dropped.
 *
 * IDEMPOTENT BY CONSTRUCTION
 *
 *   Each project carries a migration version. Re-running reports
 *   "skipped" rather than converting a second time, so pressing Apply
 *   twice cannot double-convert.
 * ══════════════════════════════════════════════════════════════════════
 */

export default function CurrencyMigrationPanel({ className }: { className?: string }) {
  const { lang } = useTranslation();
  const { user } = useAuth();
  const projects = useProjects().projects;
  const isRtl = lang === 'ar';

  const [reports, setReports] = useState<MigrationReport[] | null>(null);
  const [wasDryRun, setWasDryRun] = useState(true);
  const [busy, setBusy] = useState(false);

  if (user?.role !== 'admin') return null;

  const run = (dryRun: boolean) => {
    setBusy(true);
    try {
      const sectors = fetchSectors();
      const out = projects.map(p =>
        migrateProject(p.id, companyIdOfProject(p as never, sectors) || '', { dryRun }));
      setReports(out);
      setWasDryRun(dryRun);
    } finally {
      setBusy(false);
    }
  };

  const totals = (reports ?? []).reduce(
    (a, r) => ({
      discovered: a.discovered + r.discovered,
      migrated: a.migrated + r.migrated,
      correct: a.correct + r.alreadyCorrect,
      blocked: a.blocked + r.blocked.length,
      skipped: a.skipped + (r.skipped ? 1 : 0),
    }),
    { discovered: 0, migrated: 0, correct: 0, blocked: 0, skipped: 0 },
  );

  const allBlocked = (reports ?? []).flatMap(r =>
    r.blocked.map(b => ({ projectId: r.projectId, ...b })));

  const stat = (label: string, value: number, tone?: string) => (
    <div key={label} className="flex items-baseline justify-between gap-3">
      <span className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn('text-(length:--t-second) font-mono', tone)}>{value}</span>
    </div>
  );

  return (
    <div className={cn('ds-card', className)} dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-2 mb-3">
        <Coins className="w-4 h-4 text-primary" aria-hidden="true" />
        <h3 className="text-(length:--t-label) uppercase tracking-wider">
          {isRtl
            ? `ترحيل عملة التخزين إلى عملة العقد v${MIGRATION_VERSION}`
            : `Storage Currency Migration v${MIGRATION_VERSION}`}
        </h3>
      </div>

      <p className="text-(length:--t-second) text-muted-foreground mb-4 leading-relaxed">
        {isRtl
          ? 'السجلات المالية للمشروع كانت تُخزَّن محوَّلة إلى عملة تقارير الشركة. القاعدة المعتمدة أن تُخزَّن بعملة عقد المشروع. هذا الترحيل يعيد تسعير الصفوف القديمة من مبلغها الأصلي وبسعر الصرف المجمَّد على الصف نفسه — لا يُستخدم سعر اليوم، ولا يُخمَّن أي صف.'
          : 'Project financial records were stored converted into the company reporting currency. The authoritative rule is that they are stored in the project contract currency. This migration re-denominates legacy rows from their own original amount at the rate frozen on the row itself — never a live rate, and never a guess.'}
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(true)}
          className="btn btn-ghost"
        >
          {isRtl ? 'تشغيل تجريبي (بدون كتابة)' : 'Dry run (writes nothing)'}
        </button>
        <button
          type="button"
          disabled={busy || !reports || !wasDryRun}
          onClick={() => run(false)}
          className="btn btn-primary"
        >
          {isRtl ? 'تطبيق الترحيل' : 'Apply migration'}
        </button>
      </div>

      {reports && (
        <div className="border-t border-white/5 pt-4">
          <div className="flex items-center gap-2 mb-3">
            {wasDryRun ? (
              <span className="inline-flex items-center gap-1 text-(length:--t-micro) uppercase tracking-wider text-primary">
                <AlertTriangle className="w-3 h-3" />
                {isRtl ? 'تشغيل تجريبي — لم يُكتب شيء' : 'Dry run — nothing written'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-(length:--t-micro) uppercase tracking-wider text-chart-4">
                <Check className="w-3 h-3" />
                {isRtl ? 'تم التطبيق' : 'Applied'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-1.5 mb-4">
            {stat(isRtl ? 'مشاريع' : 'Projects', reports.length)}
            {stat(isRtl ? 'صفوف مفحوصة' : 'Rows discovered', totals.discovered)}
            {stat(isRtl ? 'صفوف محوَّلة' : 'Rows migrated', totals.migrated, 'text-chart-4')}
            {stat(isRtl ? 'صفوف سليمة' : 'Already correct', totals.correct)}
            {stat(isRtl ? 'مشاريع متخطاة' : 'Projects skipped', totals.skipped)}
            {stat(isRtl ? 'صفوف محجوبة' : 'Rows blocked', totals.blocked,
                  totals.blocked > 0 ? 'text-chart-3' : undefined)}
          </div>

          {/* Per project, so a reader can see which contract currency each
              landed in rather than a single aggregate that hides a mix. */}
          <div className="ds-table-wrap mb-4">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                  <th className="text-start">{isRtl ? 'عملة العقد' : 'Contract Ccy'}</th>
                  <th className="text-start">{isRtl ? 'عملة الشركة' : 'Company Ccy'}</th>
                  <th className="money">{isRtl ? 'مفحوص' : 'Found'}</th>
                  <th className="money">{isRtl ? 'محوَّل' : 'Migrated'}</th>
                  <th className="money">{isRtl ? 'محجوب' : 'Blocked'}</th>
                  <th className="text-start">{isRtl ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(r => (
                  <tr key={r.projectId}>
                    <td className="font-mono text-primary">{r.projectId}</td>
                    <td className="font-mono">{r.contractCurrency}</td>
                    <td className="font-mono text-muted-foreground">
                      {r.companyReportingCurrency}
                    </td>
                    <td className="money">{r.discovered}</td>
                    <td className="money">{r.migrated}</td>
                    <td className={cn('money', r.blocked.length > 0 && 'text-chart-3')}>
                      {r.blocked.length}
                    </td>
                    <td className="text-muted-foreground">
                      {r.skipped
                        ? (isRtl ? `متخطى — إصدار ${r.versionBefore}` : `skipped — v${r.versionBefore}`)
                        : r.clean
                          ? (isRtl ? 'نظيف' : 'clean')
                          : (isRtl ? 'به صفوف محجوبة' : 'has blocked rows')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Every blocked row, named exactly. Nothing is summarised away:
              a row that could not be converted is the one thing the
              operator must be able to act on. */}
          {allBlocked.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Ban className="w-3.5 h-3.5 text-chart-3" />
                <span className="text-(length:--t-micro) uppercase tracking-wider text-chart-3">
                  {isRtl ? 'صفوف محجوبة — لم تُحوَّل ولم تُمس' : 'Blocked rows — not converted, not touched'}
                </span>
              </div>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                      <th className="text-start">{isRtl ? 'السجل' : 'Register'}</th>
                      <th className="text-start">{isRtl ? 'المرجع' : 'Ref'}</th>
                      <th className="text-start">{isRtl ? 'السبب' : 'Reason'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allBlocked.map((b, i) => (
                      <tr key={i}>
                        <td className="font-mono text-primary">{b.projectId}</td>
                        <td>{b.family}</td>
                        <td className="font-mono">{b.ref}</td>
                        <td className="text-muted-foreground">{b.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
