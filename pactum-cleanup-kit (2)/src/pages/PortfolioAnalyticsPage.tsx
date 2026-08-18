import React, { useMemo, useState, useEffect } from 'react';
import { useProjects, useAuth } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';
import { formatDateOrDash } from '../lib/dateFormat';
import { abbrevMoney, exactMoney } from '../lib/moneyFormat';
import ContextBar from '../components/ContextBar';
import ReportButton from '../components/reporting/ReportButton';
// Phase 2 — the unified engine. Portfolio and FX reports run through it so
// they get the same currency handling as every project report.
import { runReport, currencyOptions } from '../lib/reporting/reportEngine';
// PHASE 3G: read LIVE companies, not the static seed array. Phase 3E
// CRIT-3E-02 — MOCK_COMPANIES never saw a rename.
import { fetchCompanies } from '../mock/companies';
import { fetchSectors } from '../mock/sectors';
import {
  analyse, compare, portfolioTrend, commonPeriods,
  AnalyticsProject, Dimension, AlignMode,
} from '../lib/portfolioAnalytics';
import {
  BarChart3, Info, AlertTriangle, Layers, TrendingUp, Globe, Coins,
  Building2, CalendarClock,
} from 'lucide-react';

/**
 * Enterprise Portfolio Analytics.
 * Destination: src/pages/PortfolioAnalyticsPage.tsx
 *
 * PHASE 7.
 *
 * Ten portfolio metrics and six comparison dimensions, every one of them
 * computed from approved Timeline snapshots by `portfolioAnalytics.ts`.
 * This page holds no financial state and imports no engine: it resolves the
 * project list with its company / sector / country dimensions, hands that
 * to the analytics layer, and renders what comes back.
 *
 * The two controls at the top are the substance of the screen. Alignment
 * decides whether you are looking at "where is everything now" (mixed data
 * dates, maximum coverage) or "where was everything at March" (comparable
 * dates, fewer projects). Neither is more correct; conflating them is.
 */

type Tab = 'overview' | 'compare' | 'trend' | 'risk';

const DIMENSIONS: { id: Dimension; en: string; ar: string; icon: any }[] = [
  { id: 'project',  en: 'Project',  ar: 'المشروع', icon: Layers },
  { id: 'company',  en: 'Company',  ar: 'الشركة',  icon: Building2 },
  { id: 'sector',   en: 'Sector',   ar: 'القطاع',  icon: BarChart3 },
  { id: 'country',  en: 'Country',  ar: 'الدولة',  icon: Globe },
  { id: 'currency', en: 'Currency', ar: 'العملة',  icon: Coins },
];

export default function PortfolioAnalyticsPage() {
  const { projects } = useProjects();
  const { user } = useAuth();
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';

  const [tab, setTab] = useState<Tab>('overview');
  const [align, setAlign] = useState<AlignMode>('latest');
  const [periodId, setPeriodId] = useState('');
  const [dimension, setDimension] = useState<Dimension>('company');

  /**
   * Dimensions are resolved HERE and passed in.
   *
   * The analytics layer must not import the company or sector registries —
   * that would give it a second data source and break the single-source
   * property. This page already holds both, so it does the join.
   */
  const enriched: AnalyticsProject[] = useMemo(() => {
    const sectors = fetchSectors();
    const companyList = fetchCompanies();
    return projects.map(p => {
      const sec = sectors.find(s => s.projectIds.includes(p.id));
      const co = sec ? companyList.find(c => c.id === sec.companyId) : undefined;
      return {
        id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr,
        companyId: sec?.companyId ?? '',
        companyName: co?.name ?? '',
        sectorId: sec?.id ?? '',
        sectorName: sec?.name ?? '',
        country: p.country ?? p.cityEn ?? '',
      };
    });
  }, [projects]);

  const periods = useMemo(() => commonPeriods(enriched), [enriched]);

  useEffect(() => {
    if (!periodId && periods.length) setPeriodId(periods[0].periodId);
  }, [periods, periodId]);

  const opts = useMemo(
    () => ({ align, periodId: align === 'asOf' ? periodId : undefined }),
    [align, periodId],
  );

  const a = useMemo(() => analyse(enriched, opts), [enriched, opts]);
  const cmp = useMemo(() => compare(enriched, dimension, opts), [enriched, dimension, opts]);
  const trend = useMemo(() => portfolioTrend(enriched), [enriched]);

  const pop = a.population;
  const ccy = pop.currencies[0] ?? '';

  /** Money cell: suppressed values say why rather than printing a number. */
  const M = ({ v, tone }: { v: number | null; tone?: string }) => (
    <span className={cn(v === null && 'text-muted-foreground', tone)}
          title={v === null ? undefined : exactMoney(v, ccy)}>
      {v === null ? (pop.mixedCurrency ? (isRtl ? 'عملات مختلطة' : 'Mixed ccy') : '—') : abbrevMoney(v)}
    </span>
  );

  const num3 = (v: number | null) => (v === null ? '—' : v.toFixed(3));
  const pct = (v: number | null, dp = 1) => (v === null ? '—' : `${(v * 100).toFixed(dp)}%`);

  const Metric = ({ label, value, note, tone }: {
    label: string; value: React.ReactNode; note?: React.ReactNode; tone?: string;
  }) => (
    <div className="bg-black/30 px-4 py-3">
      <div className="lbl mb-1.5">{label}</div>
      <div className={cn('val', tone)}>{value}</div>
      {note && <div className="text-(length:--t-second) text-muted-foreground mt-1">{note}</div>}
    </div>
  );

  const reportCtx = {
    company: isRtl ? 'المحفظة المؤسسية' : 'Enterprise Portfolio',
    analytics: a, comparison: cmp, trend, dimension,
    align, periodId: align === 'asOf' ? periodId : '',
  };

  // Phase 2 — portfolio reports, currency-aware, through the one engine.
  const [reportCcy, setReportCcy] = useState('');
  const portfolioRefs = useMemo(
    () => enriched.map(p => ({
      id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr,
      companyId: p.companyId, companyName: p.companyName,
    })),
    [enriched],
  );
  const reportCurrencies = useMemo(
    () => currencyOptions({
      reportId: 'tl-portfolio', projects: portfolioRefs,
      periodId: align === 'asOf' ? periodId : undefined, generatedBy: '',
    }),
    [portfolioRefs, align, periodId],
  );
  useEffect(() => {
    if (reportCurrencies.length && !reportCurrencies.includes(reportCcy)) {
      setReportCcy(reportCurrencies[0]);
    }
  }, [reportCurrencies, reportCcy]);

  const runPortfolio = (reportId: string) => {
    const r = runReport({
      reportId, projects: portfolioRefs,
      periodId: align === 'asOf' ? periodId : undefined,
      currency: reportCcy || undefined,
      lang: isRtl ? 'ar' : 'en',
      generatedBy: user?.username ?? 'Unknown',
      company: isRtl ? 'المحفظة المؤسسية' : 'Enterprise Portfolio',
    }, 'preview');
    if (!r.ok) {
      alert(isRtl ? 'يرجى السماح بالنوافذ المنبثقة.' : 'Please allow pop-ups.');
    }
  };

  return (
    <div className="min-h-full w-full bg-background">
      <ContextBar
        items={[{ label: 'Enterprise Portfolio', href: '/' },
                { label: isRtl ? 'التحليلات' : 'Analytics' }]}
        backLabel="Enterprise Portfolio"
      />

      <div className="pg pg-stack">
        <div className="pg-head">
          <div className="min-w-0">
            <div className="pg-eyebrow mb-1.5">
              {isRtl ? 'تحليلات المحفظة' : 'Portfolio Analytics'}
            </div>
            <h1 className="pg-title">
              {isRtl ? 'التحليلات المؤسسية' : 'Enterprise Analytics'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {reportCurrencies.length > 1 && (
              <select
                className="field-input !py-1.5 !w-24 font-mono"
                value={reportCcy}
                onChange={e => setReportCcy(e.target.value)}
                title={isRtl ? 'عملة التقرير — يُحوَّل بسعر الفترة المُجمَّد'
                             : 'Report currency — converted at the period’s frozen rate'}
              >
                {reportCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <button onClick={() => runPortfolio('tl-portfolio')} className="btn btn-secondary btn-sm">
              <BarChart3 className="w-3.5 h-3.5" />
              {isRtl ? 'تقرير المحفظة' : 'Portfolio'}
            </button>
            <button onClick={() => runPortfolio('tl-fx-exposure')} className="btn btn-secondary btn-sm">
              <Coins className="w-3.5 h-3.5" />
              {isRtl ? 'تقرير العملات' : 'FX Exposure'}
            </button>
            <ReportButton reportId="tl-analytics" context={reportCtx} />
          </div>
        </div>

        {/* ── What this reads ── */}
        <div className="ds-card ds-card-tight">
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" />
            <p className="text-(length:--t-second) text-muted-foreground leading-relaxed">
              {isRtl
                ? 'كل رقم هنا مجمَّع من لقطات معتمدة في الخط الزمني. لا تُقرأ أي وحدة حية، ولا يُعاد حساب أي معادلة. المؤشرات المجمَّعة تُحسب من مجاميع مكوّناتها (مجموع EV ÷ مجموع PV) لا كمتوسط بسيط، لأن متوسط المشاريع يساوي بين مشروع بأربعة مليارات وآخر بأربعة ملايين.'
                : 'Every figure here is aggregated from approved Timeline snapshots. No live module is read and no formula is recomputed. Portfolio indices are computed from summed components (Σ EV / Σ PV) rather than as a simple mean, because averaging project indices weighs a four-billion project the same as a four-million one.'}
            </p>
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="ds-card ds-card-raised">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">
                <CalendarClock className="w-3 h-3 inline-block me-1.5" />
                {isRtl ? 'محاذاة الفترات' : 'Period Alignment'}
              </label>
              <select className="field-input" value={align}
                      onChange={e => setAlign(e.target.value as AlignMode)}>
                <option value="latest">{isRtl ? 'أحدث فترة لكل مشروع' : 'Latest per project'}</option>
                <option value="asOf">{isRtl ? 'فترة موحّدة' : 'One common period'}</option>
              </select>
            </div>
            {align === 'asOf' && (
              <div className="field">
                <label className="field-label">{isRtl ? 'الفترة' : 'Period'}</label>
                <select className="field-input" value={periodId}
                        onChange={e => setPeriodId(e.target.value)}>
                  {periods.map(p => (
                    <option key={p.periodId} value={p.periodId}>
                      {p.label} — {p.projectCount} {isRtl ? 'مشروع' : 'projects'}
                      {p.complete ? '' : ' *'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label className="field-label">{isRtl ? 'المشاريع المُحلَّلة' : 'Projects Analysed'}</label>
              <input className="field-input font-mono" disabled
                     value={`${pop.positions.length} / ${enriched.length}`} />
            </div>
            <div className="field">
              <label className="field-label">{isRtl ? 'عملة التقارير' : 'Reporting Currency'}</label>
              <input className="field-input font-mono" disabled
                     value={pop.currencies.join(', ') || '—'} />
            </div>
          </div>

          <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
            {align === 'latest'
              ? (isRtl
                ? 'كل مشروع بأحدث فترة معتمدة له. تغطية قصوى، لكن تواريخ البيانات مختلفة — مناسب لسؤال «أين نحن الآن».'
                : 'Each project at its own most recent approved period. Maximum coverage, mixed data dates — right for “where are we now”.')
              : (isRtl
                ? 'كل المشاريع عند نفس الفترة. تواريخ قابلة للمقارنة، ومشاريع أقل — مناسب لملف مجلس الإدارة. المشاريع التي لم تعتمد هذه الفترة تُستبعَد وتُذكَر، ولا تُملأ بصفر.'
                : 'Every project at one period. Comparable dates, fewer projects — right for a board pack. Projects that never approved it are excluded and listed, never zero-filled.')}
          </p>

          {(pop.noHistory.length > 0 || pop.notInPeriod.length > 0) && (
            <div className="mt-3 border border-chart-5/25 bg-chart-5/[0.04] px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-chart-5 mt-0.5 flex-shrink-0" />
                <div className="text-(length:--t-second) text-muted-foreground space-y-1">
                  {pop.noHistory.length > 0 && (
                    <p>
                      {isRtl ? 'بلا فترة معتمدة إطلاقاً' : 'No approved period at all'}
                      {': '}
                      <span className="font-mono text-white">
                        {pop.noHistory.map(p => p.code || p.id).join(' · ')}
                      </span>
                    </p>
                  )}
                  {pop.notInPeriod.length > 0 && (
                    <p>
                      {isRtl ? 'لم تعتمد هذه الفترة تحديداً' : 'Did not approve this period'}
                      {': '}
                      <span className="font-mono text-white">
                        {pop.notInPeriod.map(p => p.code || p.id).join(' · ')}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {pop.mixedCurrency && (
            <div className="mt-3 border border-chart-3/25 bg-chart-3/[0.04] px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Coins className="w-4 h-4 text-chart-3 mt-0.5 flex-shrink-0" />
                <p className="text-(length:--t-second) text-muted-foreground">
                  {isRtl
                    ? `المحفظة تشمل أكثر من عملة تقارير (${pop.currencies.join(' · ')}). المجاميع المالية محجوبة — جمع عملتين يُنتج رقماً بلا وحدة يبدو تماماً كرقم له وحدة. النسب وعدد الأيام تبقى صالحة.`
                    : `This selection spans more than one reporting currency (${pop.currencies.join(' · ')}). Monetary aggregates are suppressed — adding two currencies produces a figure with no unit that looks exactly like one that has. Ratios and day counts remain valid.`}
                </p>
              </div>
            </div>
          )}
        </div>

        {pop.positions.length === 0 ? (
          <div className="ds-card">
            <div className="ds-empty">
              <BarChart3 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <div className="ds-empty-title">
                {isRtl ? 'لا توجد بيانات معتمدة' : 'No approved data'}
              </div>
              <p className="text-(length:--t-second) text-muted-foreground mt-2 max-w-xl mx-auto">
                {isRtl
                  ? 'التحليلات تُبنى من لقطات الخط الزمني المعتمدة. اعتمد فترة واحدة على الأقل في مشروع واحد على الأقل.'
                  : 'Analytics are built from approved Timeline snapshots. Approve at least one period on at least one project.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* ── Tabs ── */}
            <div className="flex items-center gap-2 flex-wrap">
              {([
                { id: 'overview' as const, icon: BarChart3,  en: 'Portfolio Metrics', ar: 'مؤشرات المحفظة' },
                { id: 'compare'  as const, icon: Layers,     en: 'Comparison',        ar: 'المقارنة' },
                { id: 'trend'    as const, icon: TrendingUp, en: 'Trend Analysis',    ar: 'تحليل الاتجاه' },
                { id: 'risk'     as const, icon: AlertTriangle, en: 'Risk',           ar: 'المخاطر' },
              ]).map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 text-(length:--t-second) border rounded-md transition-colors uppercase tracking-wider',
                    tab === t.id ? 'bg-primary/10 text-primary border-primary'
                                 : 'border-white/[0.06] text-muted-foreground hover:text-white')}>
                  <t.icon className="w-3.5 h-3.5" />
                  {isRtl ? t.ar : t.en}
                </button>
              ))}
            </div>

            {/* ══ PORTFOLIO METRICS ══ */}
            {tab === 'overview' && (
              <>
                <div className="sec-head">{isRtl ? 'الأداء' : 'Performance'}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5">
                  <Metric label={isRtl ? 'مؤشر الجدول (مرجَّح)' : 'Portfolio SPI (weighted)'}
                    value={num3(a.spi.weighted)}
                    tone={a.spi.weighted === null ? '' : a.spi.weighted >= 1 ? 'text-chart-4' : 'text-chart-3'}
                    note={`Σ EV / Σ PV · ${isRtl ? 'متوسط بسيط' : 'mean'} ${num3(a.spi.simpleMean)}`} />
                  <Metric label={isRtl ? 'مؤشر التكلفة (مرجَّح)' : 'Portfolio CPI (weighted)'}
                    value={num3(a.cpi.weighted)}
                    tone={a.cpi.weighted === null ? '' : a.cpi.weighted >= 1 ? 'text-chart-4' : 'text-chart-3'}
                    note={`Σ EV / Σ AC · ${isRtl ? 'متوسط بسيط' : 'mean'} ${num3(a.cpi.simpleMean)}`} />
                  <Metric label={isRtl ? 'متأخرة عن الجدول' : 'Behind Schedule'}
                    value={`${a.spi.behind} / ${a.spi.behind + a.spi.ahead}`}
                    tone={a.spi.behind > 0 ? 'text-chart-3' : 'text-chart-4'} />
                  <Metric label={isRtl ? 'تجاوزت الموازنة' : 'Over Budget'}
                    value={`${a.cpi.overBudget} / ${a.cpi.overBudget + a.cpi.underBudget}`}
                    tone={a.cpi.overBudget > 0 ? 'text-chart-3' : 'text-chart-4'} />
                  <Metric label={isRtl ? 'انحراف الجدول' : 'Schedule Variance'}
                    value={<M v={pop.mixedCurrency ? null : a.spi.sv} />} />
                  <Metric label={isRtl ? 'انحراف التكلفة' : 'Cost Variance'}
                    value={<M v={pop.mixedCurrency ? null : a.cpi.cv} />} />
                </div>

                {(a.spi.divergent || a.cpi.divergent) && (
                  <p className="text-(length:--t-second) text-muted-foreground italic">
                    <AlertTriangle className="w-3 h-3 inline-block me-1.5 text-chart-5" />
                    {isRtl
                      ? 'المؤشر المرجَّح يختلف عن المتوسط البسيط بأكثر من 5 نقاط — أي أن الأداء الضعيف مركَّز في المشاريع الكبيرة (أو العكس). الفجوة نفسها نتيجة.'
                      : 'The weighted index differs from the simple mean by more than five points — poor performance is concentrated in the larger projects, or the reverse. The gap is itself a finding.'}
                  </p>
                )}

                <div className="sec-head">{isRtl ? 'التأخير والتوقعات' : 'Delay & Forecast'}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5">
                  <Metric label={isRtl ? 'إجمالي التأخير' : 'Total Delay'}
                    value={a.delay.totalDelay === null ? '—' : `${a.delay.totalDelay}d`} />
                  <Metric label={isRtl ? 'التمديد المعتمد' : 'Approved EOT'}
                    value={a.delay.approvedEOT === null ? '—' : `${a.delay.approvedEOT}d`}
                    tone="text-primary" />
                  <Metric label={isRtl ? 'غير المعوَّض' : 'Unmitigated'}
                    value={a.delay.unmitigated === null ? '—' : `${a.delay.unmitigated}d`}
                    tone={(a.delay.unmitigated ?? 0) > 0 ? 'text-chart-3' : 'text-chart-4'}
                    note={`${a.delay.exposed} ${isRtl ? 'مشروع معرَّض' : 'projects exposed'}`} />
                  <Metric label={isRtl ? 'الغرامات' : 'LD Exposure'}
                    value={<M v={a.delay.ldExposure} />}
                    note={a.delay.atCap > 0 ? `${a.delay.atCap} ${isRtl ? 'بلغت السقف' : 'at cap'}` : undefined} />
                  <Metric label={isRtl ? 'التجاوز المتوقع' : 'Forecast Overrun'}
                    value={<M v={a.forecast.overrun} tone={(a.forecast.overrun ?? 0) > 0 ? 'text-chart-3' : ''} />}
                    note={a.forecast.overrunPct === null ? undefined : pct(a.forecast.overrunPct)} />
                  <Metric label={isRtl ? 'إجمالي الانزلاق' : 'Total Slip'}
                    value={a.forecast.totalSlipDays === null ? '—' : `${a.forecast.totalSlipDays}d`}
                    tone={(a.forecast.totalSlipDays ?? 0) > 0 ? 'text-chart-5' : ''} />
                </div>

                {a.forecast.mixedMethods && (
                  <p className="text-(length:--t-second) text-muted-foreground italic">
                    {isRtl
                      ? `المحفظة تستخدم أكثر من طريقة لاحتساب EAC (${a.forecast.methods.join(' · ')}). التوقعات الناتجة عن طرق مختلفة ليست قابلة للجمع بدقة.`
                      : `More than one EAC method is in use (${a.forecast.methods.join(' · ')}). Forecasts produced by different methods are not strictly additive.`}
                  </p>
                )}

                <div className="sec-head">{isRtl ? 'النقد والربحية' : 'Cash & Profitability'}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5">
                  <Metric label={isRtl ? 'صافي التدفق' : 'Net Cash Flow'}
                    value={<M v={a.cash.netFlow} tone={(a.cash.netFlow ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4'} />}
                    note={`${a.cash.negativeCashProjects} ${isRtl ? 'بصافي سالب' : 'cash-negative'}`} />
                  <Metric label={isRtl ? 'المعتمد' : 'Certified'}
                    value={<M v={a.cash.certified} tone="text-primary" />} />
                  <Metric label={isRtl ? 'غير المحصَّل' : 'Uncollected'}
                    value={<M v={a.cash.outstanding} tone={(a.cash.outstanding ?? 0) > 0 ? 'text-chart-5' : ''} />}
                    note={a.cash.collectionGap === null ? undefined
                      : `${pct(a.cash.collectionGap, 0)} ${isRtl ? 'من المعتمد' : 'of certified'}`} />
                  <Metric label={isRtl ? 'الهامش المحقَّق' : 'Earned Margin'}
                    value={<M v={a.profitability.earnedMargin}
                              tone={(a.profitability.earnedMargin ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4'} />}
                    note={pct(a.profitability.earnedMarginPct)} />
                  <Metric label={isRtl ? 'الهامش المتوقع' : 'Forecast Margin'}
                    value={<M v={a.profitability.forecastMargin}
                              tone={(a.profitability.forecastMargin ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4'} />}
                    note={pct(a.profitability.forecastMarginPct)} />
                  <Metric label={isRtl ? 'مشاريع خاسرة' : 'Loss-Making'}
                    value={String(a.profitability.lossMaking)}
                    tone={a.profitability.lossMaking > 0 ? 'text-chart-3' : 'text-chart-4'}
                    note={`${a.profitability.eroding} ${isRtl ? 'هامشها يتآكل' : 'eroding'}`} />
                </div>

                <p className="text-(length:--t-second) text-muted-foreground italic">
                  {isRtl
                    ? 'الهوامش أعلاه مُشتقّة لا مؤرشفة: لا وحدة تحسب هامشاً ولا الخط الزمني يخزّنه. الهامش المحقَّق = المعتمد − التكلفة الفعلية، والمتوقع = العقد الحالي − EAC. مؤشرات إرشادية لا أرقام مدقَّقة.'
                    : 'The margins above are derived, not archived: no module computes a margin and Timeline stores none. Earned margin is certified less actual cost; forecast margin is current contract less EAC. Indicative, not audited.'}
                </p>

                <div className="sec-head">{isRtl ? 'المطالبات وأوامر التغيير' : 'Claims & Change Orders'}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5">
                  <Metric label={isRtl ? 'عدد المطالبات' : 'Claims'}
                    value={a.claims.count === null ? '—' : String(a.claims.count)}
                    note={`${a.claims.projectsWithClaims} ${isRtl ? 'مشروع' : 'projects'}`} />
                  <Metric label={isRtl ? 'المُطالَب به' : 'Claimed'}
                    value={<M v={a.claims.claimed} />}
                    note={a.claims.claimIntensity === null ? undefined
                      : `${pct(a.claims.claimIntensity)} ${isRtl ? 'من العقد' : 'of contract'}`} />
                  <Metric label={isRtl ? 'معدل التسوية' : 'Settlement Rate'}
                    value={pct(a.claims.settlementRate, 0)}
                    tone={(a.claims.settlementRate ?? 1) < 0.5 ? 'text-chart-5' : 'text-chart-4'} />
                  <Metric label={isRtl ? 'أوامر التغيير المعتمدة' : 'Approved COs'}
                    value={<M v={a.changeOrders.approved} tone="text-primary" />} />
                  <Metric label={isRtl ? 'نمو العقد' : 'Contract Growth'}
                    value={pct(a.changeOrders.growthRate)}
                    tone={(a.changeOrders.growthRate ?? 0) > 0.1 ? 'text-chart-5' : ''} />
                  <Metric label={isRtl ? 'قيد الاعتماد' : 'Pending COs'}
                    value={<M v={a.changeOrders.pending} tone="text-chart-5" />}
                    note={pct(a.changeOrders.pendingRate)} />
                </div>

                <div className="sec-head">{isRtl ? 'التعرض للعملات' : 'FX Exposure'}</div>
                {a.fx.rows.length === 0 ? (
                  <p className="text-(length:--t-second) text-muted-foreground italic">
                    {isRtl
                      ? 'لم تُطبَّق أي أسعار صرف أجنبية في الفترات المؤرشفة — كل المبالغ سُجّلت بعملة التقارير.'
                      : 'No foreign exchange rate was applied in the archived periods — every amount was captured in the reporting currency.'}
                  </p>
                ) : (
                  <>
                    <div className="ds-table-wrap">
                      <table className="ds-table">
                        <thead>
                          <tr>
                            <th className="col-pin">{isRtl ? 'العملة' : 'Currency'}</th>
                            <th className="money">{isRtl ? 'المبلغ الأصلي' : 'Original'}</th>
                            <th className="money">{isRtl ? 'المحوَّل' : 'Converted'}</th>
                            <th className="money">{isRtl ? 'السعر المُرجَّح' : 'Blended Rate'}</th>
                            <th className="money">{isRtl ? 'المدى' : 'Range'}</th>
                            <th className="money">{isRtl ? 'السجلات' : 'Records'}</th>
                            <th className="money">{isRtl ? 'المشاريع' : 'Projects'}</th>
                            <th className="money">{isRtl ? 'الحصة' : 'Share'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a.fx.rows.map(r => (
                            <tr key={r.currency}>
                              <td className="col-pin font-mono text-primary">{r.currency}</td>
                              <td className="money" title={exactMoney(r.originalTotal, r.currency)}>
                                {abbrevMoney(r.originalTotal)}
                              </td>
                              <td className="money" title={exactMoney(r.convertedTotal, ccy)}>
                                {abbrevMoney(r.convertedTotal)}
                              </td>
                              <td className="money font-mono">
                                {r.blendedRate === null ? '—' : r.blendedRate.toFixed(4)}
                              </td>
                              <td className="money font-mono text-muted-foreground">
                                {r.minRate === r.maxRate
                                  ? r.minRate.toFixed(4)
                                  : `${r.minRate.toFixed(4)} – ${r.maxRate.toFixed(4)}`}
                              </td>
                              <td className="money">{r.recordCount}</td>
                              <td className="money">{r.projectCount}</td>
                              <td className="money">{r.share === null ? '—' : pct(r.share, 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-(length:--t-second) text-muted-foreground italic">
                      {isRtl
                        ? 'الأسعار أعلاه هي التي طُبِّقت فعلاً على معاملات، مأخوذة من اللقطات المجمَّدة — لا من سجل الأسعار الحي ولا بسعر اليوم.'
                        : 'These are the rates that actually touched transactions, taken from frozen snapshots — not from the live rate register, and not at today’s rate.'}
                    </p>
                  </>
                )}
              </>
            )}

            {/* ══ COMPARISON ══ */}
            {tab === 'compare' && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  {DIMENSIONS.map(d => (
                    <button key={d.id} onClick={() => setDimension(d.id)}
                      className={cn(
                        'inline-flex items-center gap-2 px-3 py-1.5 text-(length:--t-second) border rounded-md transition-colors',
                        dimension === d.id ? 'bg-primary/10 text-primary border-primary/40'
                                           : 'border-white/[0.06] text-muted-foreground hover:text-white')}>
                      <d.icon className="w-3 h-3" />
                      {isRtl ? d.ar : d.en}
                    </button>
                  ))}
                </div>

                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th className="col-pin">{isRtl ? 'المجموعة' : 'Group'}</th>
                        <th className="money">{isRtl ? 'مشاريع' : 'Projects'}</th>
                        <th className="money">SPI</th>
                        <th className="money">CPI</th>
                        <th className="money">{isRtl ? 'قيمة العقد' : 'Contract'}</th>
                        <th className="money">{isRtl ? 'الوزن' : 'Weight'}</th>
                        <th className="money">EAC</th>
                        <th className="money">{isRtl ? 'الهامش المتوقع' : 'Fcst Margin'}</th>
                        <th className="money">{isRtl ? 'غير معوَّض' : 'Unmit.'}</th>
                        <th className="money">{isRtl ? 'الغرامات' : 'LD'}</th>
                        <th className="money">{isRtl ? 'نمو العقد' : 'CO Growth'}</th>
                        <th className="money">{isRtl ? 'المخاطر' : 'Risk'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cmp.groups.map(g => (
                        <tr key={g.key}>
                          <td className="col-pin">
                            {g.label}
                            {g.mixedCurrency && (
                              <span className="badge badge-warn ms-2">
                                {g.currencies.join('/')}
                              </span>
                            )}
                          </td>
                          <td className="money">{g.projectCount}</td>
                          <td className={cn('money font-mono',
                            g.spi === null ? '' : g.spi >= 1 ? 'text-chart-4' : 'text-chart-3')}>
                            {num3(g.spi)}
                          </td>
                          <td className={cn('money font-mono',
                            g.cpi === null ? '' : g.cpi >= 1 ? 'text-chart-4' : 'text-chart-3')}>
                            {num3(g.cpi)}
                          </td>
                          <td className="money"><M v={g.contractValue} /></td>
                          <td className="money">{g.weight === null ? '—' : pct(g.weight, 0)}</td>
                          <td className="money"><M v={g.eac} /></td>
                          <td className="money">
                            <M v={g.forecastMargin}
                               tone={(g.forecastMargin ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4'} />
                            {g.forecastMarginPct !== null && (
                              <span className="text-muted-foreground ms-1 text-(length:--t-micro)">
                                {pct(g.forecastMarginPct, 0)}
                              </span>
                            )}
                          </td>
                          <td className={cn('money', (g.unmitigated ?? 0) > 0 && 'text-chart-3')}>
                            {g.unmitigated === null ? '—' : `${g.unmitigated}d`}
                          </td>
                          <td className="money"><M v={g.ldExposure} /></td>
                          <td className="money">{g.coGrowth === null ? '—' : pct(g.coGrowth)}</td>
                          <td className={cn('money font-mono',
                            g.riskScore === null ? '' : g.riskScore >= 45 ? 'text-chart-3'
                            : g.riskScore >= 20 ? 'text-chart-5' : 'text-chart-4')}>
                            {g.riskScore === null ? '—' : g.riskScore.toFixed(0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {cmp.suppressedGroups.length > 0 && (
                  <p className="text-(length:--t-second) text-muted-foreground italic">
                    <AlertTriangle className="w-3 h-3 inline-block me-1.5 text-chart-5" />
                    {isRtl
                      ? 'مجموعات تضم أكثر من عملة تقارير حُجبت أرقامها المالية وحدها — بقية الجدول سليم. حجب الجدول كله بسبب مجموعة واحدة يُهدر معلومات صحيحة.'
                      : 'Groups spanning more than one reporting currency have their own monetary columns suppressed — the rest of the table stands. Suppressing everything because one group is mixed would discard good information.'}
                  </p>
                )}
              </>
            )}

            {/* ══ TREND ══ */}
            {tab === 'trend' && (
              <>
                {trend.coverageVaries && (
                  <div className="ds-card ds-card-tight !border-chart-5/25">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-chart-5 mt-0.5 flex-shrink-0" />
                      <p className="text-(length:--t-second) text-muted-foreground">
                        {isRtl
                          ? `عدد المشاريع المُبلِّغة يتغيّر بين الفترات (من ${trend.minProjects} إلى ${trend.maxProjects}). ارتفاع الإجمالي قد يكون انضمام مشروع جديد لا تدهور أداء — عمود «مشاريع» يفصل بين الأمرين.`
                          : `The number of reporting projects changes between periods (${trend.minProjects} to ${trend.maxProjects}). A rise in a total may be a project joining rather than performance moving — the Projects column is what tells the two apart.`}
                      </p>
                    </div>
                  </div>
                )}

                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                        <th className="money">{isRtl ? 'مشاريع' : 'Projects'}</th>
                        <th className="money">SPI</th>
                        <th className="money">Δ</th>
                        <th className="money">CPI</th>
                        <th className="money">Δ</th>
                        <th className="money">EAC</th>
                        <th className="money">Δ</th>
                        <th className="money">{isRtl ? 'غير معوَّض' : 'Unmit.'}</th>
                        <th className="money">{isRtl ? 'الغرامات' : 'LD'}</th>
                        <th className="money">{isRtl ? 'المعتمد' : 'Certified'}</th>
                        <th className="money">{isRtl ? 'الهامش' : 'Margin'}</th>
                        <th className="money">{isRtl ? 'المخاطر' : 'Risk'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trend.points.map(p => (
                        <tr key={p.periodId}>
                          <td className="col-pin font-mono text-primary">{p.label}</td>
                          <td className="money">{p.projectCount}</td>
                          <td className={cn('money font-mono',
                            p.spi === null ? '' : p.spi >= 1 ? 'text-chart-4' : 'text-chart-3')}>
                            {num3(p.spi)}
                          </td>
                          <td className={cn('money font-mono text-(length:--t-second)',
                            (p.spiDelta ?? 0) > 0 ? 'text-chart-4' : (p.spiDelta ?? 0) < 0 ? 'text-chart-3' : 'text-muted-foreground')}>
                            {p.spiDelta === null || p.spiDelta === 0 ? '—'
                              : `${p.spiDelta > 0 ? '+' : ''}${p.spiDelta.toFixed(3)}`}
                          </td>
                          <td className={cn('money font-mono',
                            p.cpi === null ? '' : p.cpi >= 1 ? 'text-chart-4' : 'text-chart-3')}>
                            {num3(p.cpi)}
                          </td>
                          <td className={cn('money font-mono text-(length:--t-second)',
                            (p.cpiDelta ?? 0) > 0 ? 'text-chart-4' : (p.cpiDelta ?? 0) < 0 ? 'text-chart-3' : 'text-muted-foreground')}>
                            {p.cpiDelta === null || p.cpiDelta === 0 ? '—'
                              : `${p.cpiDelta > 0 ? '+' : ''}${p.cpiDelta.toFixed(3)}`}
                          </td>
                          <td className="money"><M v={p.eac} /></td>
                          <td className={cn('money font-mono text-(length:--t-second)',
                            (p.eacDelta ?? 0) > 0 ? 'text-chart-3' : (p.eacDelta ?? 0) < 0 ? 'text-chart-4' : 'text-muted-foreground')}>
                            {p.eacDelta === null || p.eacDelta === 0 ? '—'
                              : `${p.eacDelta > 0 ? '+' : ''}${abbrevMoney(p.eacDelta)}`}
                          </td>
                          <td className={cn('money', (p.unmitigated ?? 0) > 0 && 'text-chart-3')}>
                            {p.unmitigated === null ? '—' : `${p.unmitigated}d`}
                          </td>
                          <td className="money"><M v={p.ldExposure} /></td>
                          <td className="money"><M v={p.certified} /></td>
                          <td className="money">
                            <M v={p.forecastMargin}
                               tone={(p.forecastMargin ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4'} />
                          </td>
                          <td className={cn('money font-mono',
                            p.riskScore === null ? '' : p.riskScore >= 45 ? 'text-chart-3'
                            : p.riskScore >= 20 ? 'text-chart-5' : 'text-chart-4')}>
                            {p.riskScore === null ? '—' : p.riskScore.toFixed(0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-(length:--t-second) text-muted-foreground italic">
                  {isRtl
                    ? 'كل نقطة تجمع المشاريع التي اعتمدت تلك الفترة فقط. هذا هو البناء الأمين — والبديل، وهو حمل آخر رقم معروف للمشاريع الغائبة، يخلط بيانات فترتين تحت عنوان فترة واحدة.'
                    : 'Each point aggregates only the projects that approved that period. That is the honest construction — the alternative, carrying a project’s last known figure forward, mixes two periods under one heading.'}
                </p>
              </>
            )}

            {/* ══ RISK ══ */}
            {tab === 'risk' && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5">
                  <Metric label={isRtl ? 'مؤشر المحفظة' : 'Portfolio Index'}
                    value={a.risk.portfolioScore === null ? '—' : a.risk.portfolioScore.toFixed(0)}
                    tone={a.risk.portfolioScore === null ? ''
                      : a.risk.portfolioScore >= 45 ? 'text-chart-3'
                      : a.risk.portfolioScore >= 20 ? 'text-chart-5' : 'text-chart-4'}
                    note={isRtl ? '0 منخفض · 100 حرج' : '0 low · 100 severe'} />
                  {(['severe', 'high', 'moderate', 'low', 'unknown'] as const).map(b => (
                    <Metric key={b}
                      label={b === 'severe' ? (isRtl ? 'حرج' : 'Severe')
                        : b === 'high' ? (isRtl ? 'مرتفع' : 'High')
                        : b === 'moderate' ? (isRtl ? 'متوسط' : 'Moderate')
                        : b === 'low' ? (isRtl ? 'منخفض' : 'Low')
                        : (isRtl ? 'غير معروف' : 'Unknown')}
                      value={String(a.risk.bands[b] ?? 0)}
                      tone={b === 'severe' ? 'text-chart-3' : b === 'high' ? 'text-chart-5'
                        : b === 'low' ? 'text-chart-4' : 'text-muted-foreground'} />
                  ))}
                </div>

                <div className="sec-head">{isRtl ? 'متوسط الإشارات' : 'Signal Averages'}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-px bg-white/5">
                  {Object.entries(a.risk.signalAverages).map(([k, v]) => (
                    <Metric key={k}
                      label={k === 'schedule' ? (isRtl ? 'الجدول' : 'Schedule')
                        : k === 'cost' ? (isRtl ? 'التكلفة' : 'Cost')
                        : k === 'delay' ? (isRtl ? 'التأخير' : 'Delay')
                        : k === 'liquidity' ? (isRtl ? 'السيولة' : 'Liquidity')
                        : (isRtl ? 'التوقعات' : 'Forecast')}
                      value={v === null ? '—' : v.toFixed(0)}
                      tone={v === null ? '' : v >= 45 ? 'text-chart-3' : v >= 20 ? 'text-chart-5' : 'text-chart-4'} />
                  ))}
                </div>

                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th className="col-pin">{isRtl ? 'المشروع' : 'Project'}</th>
                        <th className="money">{isRtl ? 'المؤشر' : 'Index'}</th>
                        <th>{isRtl ? 'النطاق' : 'Band'}</th>
                        <th>{isRtl ? 'الجدول' : 'Schedule'}</th>
                        <th>{isRtl ? 'التكلفة' : 'Cost'}</th>
                        <th>{isRtl ? 'التأخير' : 'Delay'}</th>
                        <th>{isRtl ? 'السيولة' : 'Liquidity'}</th>
                        <th>{isRtl ? 'التوقعات' : 'Forecast'}</th>
                        <th className="money">{isRtl ? 'إشارات ناقصة' : 'Blind'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.risk.projects
                        .slice()
                        .sort((x, y) => (y.score ?? -1) - (x.score ?? -1))
                        .map(p => (
                        <tr key={p.projectId}>
                          <td className="col-pin font-mono text-primary">{p.code || p.projectId}</td>
                          <td className={cn('money font-mono',
                            p.score === null ? '' : p.score >= 45 ? 'text-chart-3'
                            : p.score >= 20 ? 'text-chart-5' : 'text-chart-4')}>
                            {p.score === null ? '—' : p.score.toFixed(0)}
                          </td>
                          <td>
                            <span className={cn('badge',
                              p.band === 'severe' ? 'badge-risk' : p.band === 'high' ? 'badge-warn'
                              : p.band === 'low' ? 'badge-ok' : 'badge-neutral')}>
                              {p.band}
                            </span>
                          </td>
                          {(['schedule', 'cost', 'delay', 'liquidity', 'forecast'] as const).map(k => {
                            const s = p.signals.find(x => x.key === k);
                            return (
                              <td key={k} className="text-muted-foreground text-(length:--t-second)"
                                  title={s?.detail}>
                                {s?.score === null || s?.score === undefined
                                  ? <span className="text-muted-foreground">—</span>
                                  : <span className={cn('font-mono',
                                      s.score >= 45 ? 'text-chart-3' : s.score >= 20 ? 'text-chart-5' : 'text-chart-4')}>
                                      {s.score.toFixed(0)}
                                    </span>}
                              </td>
                            );
                          })}
                          <td className={cn('money', p.blind > 2 && 'text-chart-5')}>{p.blind}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-(length:--t-second) text-muted-foreground italic">
                  {isRtl
                    ? 'هذا مؤشر مركَّب على إشارات مؤرشفة، لا تجميع لسجل المخاطر: السجل مخزن حيّ وهذه الطبقة تقرأ الخط الزمني وحده. الإشارة بلا بيانات تُستبعَد من متوسط المشروع ولا تُحتسب صفراً، حتى لا يُجمَّل مشروع بسبب نقص بياناته.'
                    : 'A composite index over archived signals, not a roll-up of the risk register: the register is a live store and this layer reads only Timeline. A signal with no data is excluded from that project’s average rather than scored zero, so a sparse project is not flattered by its own gaps.'}
                </p>
              </>
            )}

            {/* ── Provenance ── */}
            <div className="ds-card ds-card-tight">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-(length:--t-second)">
                <div>
                  <div className="lbl mb-1">{isRtl ? 'المصدر' : 'Source'}</div>
                  <div className="text-white">{isRtl ? 'لقطات معتمدة فقط' : 'Approved snapshots only'}</div>
                </div>
                <div>
                  <div className="lbl mb-1">{isRtl ? 'المحاذاة' : 'Alignment'}</div>
                  <div className="text-white">
                    {align === 'latest' ? (isRtl ? 'أحدث لكل مشروع' : 'Latest per project') : periodId}
                  </div>
                </div>
                <div>
                  <div className="lbl mb-1">{isRtl ? 'تواريخ البيانات' : 'Data Dates'}</div>
                  <div className="text-white font-mono">
                    {pop.dataDates.length === 1
                      ? formatDateOrDash(pop.dataDates[0], isRtl ? 'ar' : 'en')
                      : `${pop.dataDates.length} ${isRtl ? 'تاريخ مختلف' : 'distinct'}`}
                  </div>
                </div>
                <div>
                  <div className="lbl mb-1">{isRtl ? 'التغطية' : 'Coverage'}</div>
                  <div className="text-white font-mono">
                    {pop.positions.length} / {enriched.length}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
