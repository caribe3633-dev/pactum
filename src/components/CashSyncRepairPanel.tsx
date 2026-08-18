import React, { useState } from 'react';
import { Wallet, Check, AlertTriangle, Ban } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useAuth, useProjects } from '../lib/store';
import { fetchSectors } from '../mock/sectors';
import { companyIdOfProject } from '../lib/projectMaster';
import { companyReportingCurrency } from '../lib/currencyArchitecture';
import { contractCurrencyOf } from '../lib/projectCurrency';
import { exactMoney } from '../lib/moneyFormat';
import {
  repairProjectCashSync, REPAIR_VERSION,
  type RepairReport,
} from '../lib/cashSyncRepair';

/**
 * Cash-sync repair — the operator's control.
 * Destination: src/components/CashSyncRepairPanel.tsx
 *
 * ══════════════════════════════════════════════════════════════════════
 * Deliberately built to the same two-stage shape as the currency
 * migration panel it sits beside: DRY RUN prints the full report and
 * writes nothing; APPLY is enabled only after a dry run. This screen
 * takes money OUT of a filed ledger, so it must never act on a press
 * whose consequences were not shown first.
 *
 * The figures it removes come from the sync AUDIT LOG — what was
 * actually posted — not from re-reading today's certificate values. A
 * certificate edited since the sync would otherwise have the wrong
 * amount taken back out.
 * ══════════════════════════════════════════════════════════════════════
 */
export default function CashSyncRepairPanel({ className }: { className?: string }) {
  const { lang } = useTranslation();
  const { user } = useAuth();
  const projects = useProjects().projects;
  const isRtl = lang === 'ar';

  const [reports, setReports] = useState<RepairReport[] | null>(null);
  const [wasDryRun, setWasDryRun] = useState(true);
  const [busy, setBusy] = useState(false);

  if (user?.role !== 'admin') return null;

  const run = (dryRun: boolean) => {
    setBusy(true);
    try {
      const sectors = fetchSectors();
      const out = projects.map(p => {
        const companyId = companyIdOfProject(p as never, sectors) || '';
        const ccy = contractCurrencyOf(p.id, companyReportingCurrency(companyId));
        return repairProjectCashSync(p.id, ccy, { dryRun, by: user?.username || 'admin' });
      });
      setReports(out);
      setWasDryRun(dryRun);
    } finally {
      setBusy(false);
    }
  };

  const totals = (reports ?? []).reduce(
    (a, r) => ({
      removed: a.removed + r.removed.length,
      notPaid: a.notPaid + r.removed.filter(x => x.reason === 'not-paid').length,
      dupes: a.dupes + r.removed.filter(x => x.reason === 'duplicate-post').length,
      blocked: a.blocked + r.blocked.length,
      already: a.already + r.alreadyRepaired,
      truncated: a.truncated + (r.logMayBeTruncated ? 1 : 0),
    }),
    { removed: 0, notPaid: 0, dupes: 0, blocked: 0, already: 0, truncated: 0 },
  );

  /** Only projects where something actually changed, or is stuck. */
  const affected = (reports ?? []).filter(
    r => r.removed.length > 0 || r.blocked.length > 0);
  const allBlocked = (reports ?? []).flatMap(r =>
    r.blocked.map(b => ({ projectId: r.projectId, ccy: r.contractCurrency, ...b })));

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
        <Wallet className="w-4 h-4 text-primary" aria-hidden="true" />
        <h3 className="text-(length:--t-label) uppercase tracking-wider">
          {isRtl
            ? `تصحيح مزامنة المستخلصات مع التدفق النقدي v${REPAIR_VERSION}`
            : `Certificate Cash-Sync Repair v${REPAIR_VERSION}`}
        </h3>
      </div>

      <p className="text-(length:--t-second) text-muted-foreground mb-4 leading-relaxed">
        {isRtl
          ? 'قبل الإصلاح كانت شاشة المستخلصات ترحّل المستخلص المعتمد غير المدفوع إلى التدفق النقدي الداخل، وكانت الضغطة المكررة تضيف نفس المبلغ مرة أخرى داخل الصف القائم بلا صف مكرر ظاهر. هذه الأداة تسحب هذه المبالغ فقط، اعتماداً على سجل المزامنة الذي يسجّل ما رُحِّل فعلاً — لا على قيمة المستخلص اليوم. أي صف لا يمكن مطابقته يُحجب ويُسمّى ويُترك كما هو.'
          : 'Before the fix, the certificates screen posted certified-but-unpaid IPCs into incoming cash flow, and a repeated press added the same amount again inside the existing row with no visible duplicate. This tool withdraws only those amounts, using the sync audit log — what was actually posted — not the certificate value as it stands today. Any entry that cannot be reconciled is blocked, named and left untouched.'}
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {/* NOT "Dry run". The currency migration panel directly above this
            one carries a button with that exact label, so the Admin page
            showed two identical controls doing different things to
            different records — and the wrong one is one click away from
            rewriting financial history. The verb here names what is
            scanned. */}
        <button type="button" disabled={busy} onClick={() => run(true)} className="btn btn-ghost">
          {isRtl ? 'فحص الدفاتر (بدون كتابة)' : 'Scan ledgers (writes nothing)'}
        </button>
        <button
          type="button"
          disabled={busy || !reports || !wasDryRun || totals.removed === 0}
          onClick={() => run(false)}
          className="btn btn-primary"
        >
          {isRtl ? 'تطبيق التصحيح' : 'Apply repair'}
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
            {/* Order matters: the grid flows row-wise across three columns,
                so the two "of which" lines must sit on the SAME row as the
                total they break down. Listed in source order they landed on
                separate rows, split from their parent figure and reading as
                four unrelated counts. */}
            {stat(isRtl ? 'مشاريع مفحوصة' : 'Projects examined', reports.length)}
            {stat(isRtl ? 'مُصحَّح سابقاً' : 'Already repaired', totals.already)}
            {stat(isRtl ? 'محجوب' : 'Blocked', totals.blocked,
                  totals.blocked > 0 ? 'text-chart-3' : undefined)}
            {stat(isRtl ? 'ترحيلات مسحوبة' : 'Postings withdrawn', totals.removed,
                  totals.removed > 0 ? 'text-chart-4' : undefined)}
            {stat(isRtl ? 'منها: معتمد غير مدفوع' : 'of which: not paid', totals.notPaid)}
            {stat(isRtl ? 'منها: مكرر' : 'of which: duplicates', totals.dupes)}
          </div>

          {/* A ledger whose log hit the old 30-entry cap lost history. Saying
              so is the difference between "clean" and "clean as far as the
              evidence goes" — and only one of those is true. */}
          {totals.truncated > 0 && (
            <div className="ds-card border-chart-3/30 bg-chart-3/[0.05] !py-3 mb-4">
              <p className="text-(length:--t-second) text-chart-3">
                {isRtl
                  ? `${totals.truncated} مشروع سجلّ المزامنة فيه بلغ الحد القديم (30 إدخالاً)، وما قبل ذلك مفقود. ما لا يذكره السجل لا يمكن لهذه الأداة تصحيحه — راجع هذه المشاريع يدوياً.`
                  : `${totals.truncated} project(s) have a sync log at the old 30-entry cap; anything older is gone. What the log does not remember, this tool cannot repair — review those ledgers by hand.`}
              </p>
            </div>
          )}

          {affected.length === 0 ? (
            <p className="text-(length:--t-second) text-muted-foreground italic">
              {isRtl
                ? 'لا توجد ترحيلات خاطئة في أي مشروع. الدفاتر سليمة بحسب ما يذكره سجل المزامنة.'
                : 'No bad postings found in any project. The ledgers are sound as far as the sync log records.'}
            </p>
          ) : (
            <div className="ds-table-wrap mb-4">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th className="text-start">{isRtl ? 'العملة' : 'Ccy'}</th>
                    <th className="money">{isRtl ? 'الداخل قبل' : 'Cash In before'}</th>
                    <th className="money">{isRtl ? 'الداخل بعد' : 'Cash In after'}</th>
                    <th className="money">{isRtl ? 'الفرق' : 'Removed'}</th>
                    <th className="money">{isRtl ? 'محجوب' : 'Blocked'}</th>
                  </tr>
                </thead>
                <tbody>
                  {affected.map(r => {
                    const delta = Math.round((r.cashInBefore - r.cashInAfter) * 100) / 100;
                    return (
                      <tr key={r.projectId}>
                        <td className="font-mono text-primary">{r.projectId}</td>
                        <td className="font-mono">{r.contractCurrency}</td>
                        <td className="money" title={exactMoney(r.cashInBefore, r.contractCurrency)}>
                          {exactMoney(r.cashInBefore, r.contractCurrency)}
                        </td>
                        <td className="money" title={exactMoney(r.cashInAfter, r.contractCurrency)}>
                          {exactMoney(r.cashInAfter, r.contractCurrency)}
                        </td>
                        <td className={cn('money', delta > 0 && 'text-chart-3')}>
                          {delta > 0 ? `-${exactMoney(delta, r.contractCurrency)}` : '—'}
                        </td>
                        <td className={cn('money', r.blocked.length > 0 && 'text-chart-3')}>
                          {r.blocked.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Every withdrawal, named. An operator must be able to check a
              specific certificate rather than trust a total. */}
          {totals.removed > 0 && (
            <div className="mb-4">
              <div className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground mb-2">
                {isRtl ? 'الترحيلات المسحوبة' : 'Postings withdrawn'}
              </div>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                      <th className="text-start">{isRtl ? 'المستخلص' : 'Cert'}</th>
                      <th className="text-start">{isRtl ? 'الفترة' : 'Period'}</th>
                      <th className="money">{isRtl ? 'المبلغ' : 'Amount'}</th>
                      <th className="text-start">{isRtl ? 'السبب' : 'Reason'}</th>
                      <th className="text-start">{isRtl ? 'الحالة الآن' : 'Status now'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reports ?? []).flatMap(r =>
                      r.removed.map((x, i) => (
                        <tr key={r.projectId + x.certNo + i}>
                          <td className="font-mono text-primary">{r.projectId}</td>
                          <td className="font-mono">{x.certNo}</td>
                          <td>{x.period}</td>
                          <td className="money">{exactMoney(x.amount, r.contractCurrency)}</td>
                          <td className="text-muted-foreground">
                            {x.reason === 'not-paid'
                              ? (isRtl ? 'رُحِّل وهو غير مدفوع' : 'posted while unpaid')
                              : (isRtl ? 'ترحيل مكرر' : 'duplicate posting')}
                          </td>
                          <td className="font-mono text-muted-foreground">{x.statusNow}</td>
                        </tr>
                      )))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {allBlocked.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Ban className="w-3.5 h-3.5 text-chart-3" />
                <span className="text-(length:--t-micro) uppercase tracking-wider text-chart-3">
                  {isRtl ? 'محجوب — لم يُسحب ولم يُمس' : 'Blocked — not withdrawn, not touched'}
                </span>
              </div>
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="text-start">{isRtl ? 'المشروع' : 'Project'}</th>
                      <th className="text-start">{isRtl ? 'المستخلص' : 'Cert'}</th>
                      <th className="money">{isRtl ? 'المبلغ' : 'Amount'}</th>
                      <th className="text-start">{isRtl ? 'التفصيل' : 'Detail'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allBlocked.map((b, i) => (
                      <tr key={i}>
                        <td className="font-mono text-primary">{b.projectId}</td>
                        <td className="font-mono">{b.certNo}</td>
                        <td className="money">{exactMoney(b.amount, b.ccy)}</td>
                        <td className="text-muted-foreground">{b.detail}</td>
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
