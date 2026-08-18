import React, { useState, useEffect, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useTranslation } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { formatDateOrDash } from '../../lib/dateFormat';
import { useAuth } from '../../lib/store';
import {
  runReport, buildReport, availablePeriods, currencyOptions,
  reportsForScope, ReportSpec,
} from '../../lib/reporting/reportEngine';
import {
  FileText, Printer, Eye, Archive, Info, AlertTriangle, Lock,
  CalendarClock, Coins,
} from 'lucide-react';

/**
 * Reports.
 * Destination: src/components/modules/ReportsModule.tsx
 *
 * PHASE 2 · ONE ENGINE
 *
 * Every button on this screen calls `runReport()`. The screen holds no
 * financial state, imports no engine and performs no conversion — it
 * assembles a request (which report, which period, which currency) and
 * hands it over.
 *
 * Two selectors govern everything below them:
 *
 *   PERIOD    which approved snapshot the figures come from.
 *   CURRENCY  which currency they are expressed in, converted at THAT
 *             PERIOD'S frozen rate — never today's.
 *
 * A currency the period holds no rate for is not offered. Offering it would
 * mean accepting a selection the engine would then have to refuse.
 */

const GROUPS: { id: ReportSpec['group']; en: string; ar: string }[] = [
  { id: 'executive',  en: 'Executive',  ar: 'تنفيذي' },
  { id: 'commercial', en: 'Commercial', ar: 'تجاري' },
  { id: 'delivery',   en: 'Delivery',   ar: 'التنفيذ' },
];

export default function ReportsModule({ project }: { project: Project; canEdit?: boolean }) {
  const { lang } = useTranslation();
  const { user } = useAuth();
  const isRtl = lang === 'ar';

  const identity = useMemo(() => ({
    id: project.id, code: project.code,
    nameEn: project.nameEn, nameAr: project.nameAr,
  }), [project.id, project.code, project.nameEn, project.nameAr]);

  const specs = useMemo(() => reportsForScope('project'), []);

  const [periodId, setPeriodId] = useState('');
  const [currency, setCurrency] = useState('');

  const periods = useMemo(
    () => availablePeriods({ reportId: 'tl-monthly', project: identity, generatedBy: '' }),
    [identity],
  );

  useEffect(() => {
    setPeriodId(periods.length ? periods[0].periodId : '');
  }, [periods]);

  const currencies = useMemo(
    () => currencyOptions({
      reportId: 'tl-monthly', project: identity, periodId: periodId || undefined,
      generatedBy: '',
    }),
    [identity, periodId],
  );

  // Default to the currency the period was archived in — no conversion until
  // someone asks for one.
  useEffect(() => {
    if (!currencies.length) { setCurrency(''); return; }
    if (!currencies.includes(currency)) setCurrency(currencies[0]);
  }, [currencies, currency]);

  const period = periods.find(p => p.periodId === periodId) ?? null;
  const isLatest = periods.length > 0 && periods[0].periodId === periodId;

  /** A dry build, so the screen can warn before anything opens in a tab. */
  const probe = useMemo(() => {
    if (!periodId) return null;
    const r = buildReport({
      reportId: 'tl-monthly', project: identity, periodId,
      currency: currency || undefined, lang: isRtl ? 'ar' : 'en',
      generatedBy: user?.username ?? 'Unknown',
    });
    return r.presentation ?? null;
  }, [identity, periodId, currency, isRtl, user]);

  const go = (spec: ReportSpec, format: 'pdf' | 'print' | 'preview') => {
    const r = runReport({
      reportId: spec.id,
      project: identity,
      periodId: periodId || undefined,
      currency: currency || undefined,
      lang: isRtl ? 'ar' : 'en',
      generatedBy: user?.username ?? 'Unknown',
    }, format);
    if (!r.ok) {
      alert(isRtl
        ? 'يرجى السماح بالنوافذ المنبثقة لإنشاء التقرير.'
        : 'Please allow pop-ups to generate the report.');
    }
  };

  const label = (s: ReportSpec) => (isRtl ? s.ar : s.en);

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      <div className="ds-card ds-card-tight">
        <div className="flex items-start gap-2.5">
          <Info className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" />
          <p className="text-(length:--t-second) text-muted-foreground leading-relaxed">
            {isRtl
              ? 'كل التقارير تُنتَج من محرّك واحد يقرأ لقطات الخط الزمني المعتمدة. اختر فترة سابقة وستحصل عليها كما اعتُمدت، واختر عملة أخرى فيُحوَّل بسعر تلك الفترة المُجمَّد لا بسعر اليوم — إعادة الإصدار بعد شهور تُخرج نفس الأرقام.'
              : 'Every report is produced by one engine reading approved Timeline snapshots. Choose a past period and you get it as it was signed off; choose another currency and it converts at that period’s frozen rate, never today’s — so reissuing months later produces identical figures.'}
          </p>
        </div>
      </div>

      {periods.length === 0 ? (
        <div className="ds-card">
          <div className="ds-empty">
            <Archive className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <div className="ds-empty-title">
              {isRtl ? 'لا توجد فترة معتمدة بعد' : 'No approved period yet'}
            </div>
            <p className="text-(length:--t-second) text-muted-foreground mt-2 max-w-xl mx-auto">
              {isRtl
                ? 'التقارير تُنتَج من لقطات الخط الزمني المعتمدة. اعتمد فترة من تبويب «الخط الزمني» أولاً.'
                : 'Reports are produced from approved Timeline snapshots. Approve a period on the Timeline tab first.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ── The two selectors that govern every report below ── */}
          <div className="ds-card ds-card-raised">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="sec-head !mb-1">
                  <CalendarClock className="w-4 h-4 inline-block me-2 text-primary/70" />
                  {isRtl ? 'الفترة والعملة' : 'Period & Currency'}
                </h3>
                <p className="text-(length:--t-second) text-muted-foreground">
                  {isRtl
                    ? 'كل التقارير أدناه ستُنتَج بهذين الاختيارين'
                    : 'Every report below is produced with these two selections'}
                </p>
              </div>
              <span className={cn('badge', isLatest ? 'badge-ok' : 'badge-warn')}>
                <Lock className="w-3 h-3" />
                {isLatest
                  ? (isRtl ? 'أحدث فترة معتمدة' : 'Latest approved')
                  : (isRtl ? 'إعادة إصدار تاريخية' : 'Historical reissue')}
              </span>
            </div>

            <div className="form-grid mt-4">
              <div className="field xl:col-span-2">
                <label className="field-label">{isRtl ? 'الفترة' : 'Period'}</label>
                <select className="field-input" value={periodId}
                        onChange={e => setPeriodId(e.target.value)}>
                  {periods.map(p => (
                    <option key={p.periodId} value={p.periodId}>
                      {p.label}
                      {p.coverage.complete ? '' : ` — ${p.coverage.missing.length} ${isRtl ? 'قسم ناقص' : 'missing'}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">
                  <Coins className="w-3 h-3 inline-block me-1.5" />
                  {isRtl ? 'عملة العرض' : 'Reporting Currency'}
                </label>
                <select className="field-input font-mono" value={currency}
                        onChange={e => setCurrency(e.target.value)}
                        disabled={currencies.length <= 1}>
                  {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                  {currencies.length === 0 && <option value="">—</option>}
                </select>
              </div>
              <div className="field">
                <label className="field-label">{isRtl ? 'تاريخ البيانات' : 'Data Date'}</label>
                <input className="field-input font-mono" disabled
                       value={period ? formatDateOrDash(period.dataDate, isRtl ? 'ar' : 'en') : '—'} />
              </div>
            </div>

            {/* What the currency selection will actually do. */}
            {probe && (
              <div className={cn('mt-3 px-4 py-2.5 border',
                probe.converting ? 'border-primary/25 bg-primary/[0.04]'
                : probe.resolved ? 'border-white/[0.06] bg-black/20'
                : 'border-chart-3/30 bg-chart-3/[0.04]')}>
                <p className="text-(length:--t-second) text-muted-foreground">
                  {probe.converting ? (
                    <>
                      <span className="text-white font-mono">
                        {probe.archived} → {probe.target}
                      </span>
                      {' '}{isRtl ? 'بسعر' : 'at'}{' '}
                      <span className="text-primary font-mono">{probe.rate.toFixed(6)}</span>
                      {probe.source === 'cross' && (
                        <span className="ms-1">
                          ({isRtl ? 'مشتق عبر' : 'crossed via'} {probe.pivot})
                        </span>
                      )}
                      {' · '}
                      {isRtl
                        ? 'السعر المُجمَّد مع هذه الفترة — السجلات الأصلية لم تتغيّر'
                        : 'the rate frozen with this period — the archived records are unchanged'}
                    </>
                  ) : probe.resolved ? (
                    isRtl
                      ? `العرض بعملة الأرشفة ${probe.archived} — بلا تحويل`
                      : `Presented in ${probe.archived}, the currency archived. No conversion.`
                  ) : (
                    <span className="text-chart-3">
                      <AlertTriangle className="w-3 h-3 inline-block me-1.5" />
                      {isRtl
                        ? `هذه الفترة لا تحمل سعراً إلى ${probe.target}. ستُعرض المبالغ بعملة الأرشفة ${probe.archived} — ولن يُستبدل بسعر اليوم.`
                        : `This period holds no rate to ${probe.target}. Amounts will be shown in ${probe.archived} — today’s rate will not be substituted.`}
                    </span>
                  )}
                </p>
              </div>
            )}

            {period && !period.coverage.complete && (
              <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
                <AlertTriangle className="w-3 h-3 inline-block me-1.5 text-chart-5" />
                {isRtl
                  ? 'أقسام لم تُسجَّل في هذه الفترة، وستظهر «غير مُسجَّل» لا صفراً ولا بقيمة حالية'
                  : 'Sections not recorded in this period. They print as not recorded — never as zero, never filled from a current value'}
                {': '}
                <span className="font-mono">{period.coverage.missing.join(' · ')}</span>
              </p>
            )}
          </div>

          {/* ── The catalogue ── */}
          {GROUPS.map(g => {
            const list = specs.filter(x => x.group === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id}>
                <div className="sec-head">{isRtl ? g.ar : g.en}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {list.map(spec => (
                    <div key={spec.id} className="ds-card ds-card-tight">
                      <div className="flex items-start gap-2.5 mb-3">
                        <FileText className="w-4 h-4 text-primary/70 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-(length:--t-card) text-white leading-tight">
                            {label(spec)}
                          </div>
                          <div className="text-(length:--t-micro) text-muted-foreground font-mono mt-1">
                            {period?.label ?? '—'}
                            {currency && ` · ${currency}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => go(spec, 'preview')} className="btn btn-secondary btn-sm">
                          <Eye className="w-3 h-3" />
                          {isRtl ? 'معاينة' : 'Preview'}
                        </button>
                        <button onClick={() => go(spec, 'pdf')} className="btn btn-ghost btn-sm">
                          <FileText className="w-3 h-3" />
                          PDF
                        </button>
                        <button onClick={() => go(spec, 'print')} className="btn btn-ghost btn-sm">
                          <Printer className="w-3 h-3" />
                          {isRtl ? 'طباعة' : 'Print'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* ── Available history ── */}
          <div className="sec-head">{isRtl ? 'الفترات المتاحة للإصدار' : 'Periods Available for Reissue'}</div>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                  <th>{isRtl ? 'تاريخ البيانات' : 'Data Date'}</th>
                  <th>{isRtl ? 'تاريخ الاعتماد' : 'Approved On'}</th>
                  <th>{isRtl ? 'اعتمدها' : 'Approved By'}</th>
                  <th className="money">{isRtl ? 'الأقسام' : 'Sections'}</th>
                  <th>{isRtl ? 'الاكتمال' : 'Completeness'}</th>
                  <th className="col-act" />
                </tr>
              </thead>
              <tbody>
                {periods.map(p => (
                  <tr key={p.periodId} className={cn(p.periodId === periodId && 'bg-primary/[0.04]')}>
                    <td className="col-pin font-mono text-primary">{p.label}</td>
                    <td className="text-muted-foreground font-mono whitespace-nowrap">
                      {formatDateOrDash(p.dataDate, isRtl ? 'ar' : 'en')}
                    </td>
                    <td className="text-muted-foreground font-mono whitespace-nowrap">
                      {formatDateOrDash(p.approvedAt.slice(0, 10), isRtl ? 'ar' : 'en')}
                    </td>
                    <td className="text-muted-foreground">{p.approvedBy || '—'}</td>
                    <td className="money font-mono">{p.coverage.present.length} / 12</td>
                    <td>
                      <span className={cn('badge', p.coverage.complete ? 'badge-ok' : 'badge-warn')}>
                        {p.coverage.complete
                          ? (isRtl ? 'كامل' : 'Complete')
                          : `${p.coverage.missing.length} ${isRtl ? 'ناقص' : 'missing'}`}
                      </span>
                    </td>
                    <td className="col-act">
                      <button onClick={() => setPeriodId(p.periodId)}
                        className="text-(length:--t-second) uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors px-2 py-1">
                        {isRtl ? 'اختيار' : 'Select'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-(length:--t-second) text-muted-foreground italic">
            {isRtl
              ? 'إعادة إصدار تقرير عن فترة سابقة تُنتج نفس الأرقام الأصلية بالضبط، بأي عملة. التحويل يحدث وقت التوليد فقط ويستخدم سعر تلك الفترة المُجمَّد — السجلات الأصلية لا تتغيّر أبداً.'
              : 'Reissuing a report for a past period reproduces the original figures exactly, in any currency. Conversion happens only at generation time and uses that period’s frozen rate — the original records never change.'}
          </p>
        </>
      )}
    </div>
  );
}
