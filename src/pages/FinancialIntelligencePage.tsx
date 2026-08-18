import React, { useMemo, useState, useEffect } from 'react';
import { useProjects, useAuth } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';
import { formatDateOrDash } from '../lib/dateFormat';
import { abbrevMoney, exactMoney } from '../lib/moneyFormat';
import ContextBar from '../components/ContextBar';
// PHASE 3G: read LIVE companies, not the static seed array. Phase 3E
// CRIT-3E-02 — MOCK_COMPANIES never saw a rename.
import { fetchCompanies } from '../mock/companies';
import { fetchSectors } from '../mock/sectors';
import { reportablePeriods } from '../lib/reporting/timelineSource';
import { runReport } from '../lib/reporting/reportEngine';
import {
  financialIntelligence, historicalComparison,
  FiProject, ComparisonBasis, HealthScore,
} from '../lib/financialIntelligence';
import {
  TrendingUp, Info, AlertTriangle, Activity, Coins, Building2,
  ShieldCheck, GitCompare, LineChart, FileText,
} from 'lucide-react';

/**
 * Financial Intelligence.
 * Destination: src/pages/FinancialIntelligencePage.tsx
 *
 * PHASE 3.
 *
 * Five dashboards over one analysis, all of it read from approved Timeline
 * snapshots by `financialIntelligence.ts`. This page holds no financial
 * state, imports no engine and computes nothing — it selects a project and
 * a period, and renders what the analysis layer returns.
 *
 * Every derived or projected figure is rendered with its stated basis
 * attached. A score with no explanation is a number someone will act on
 * without being able to check it.
 */

type Tab = 'financial' | 'fx' | 'health' | 'portfolio' | 'commercial';

const TABS: { id: Tab; en: string; ar: string; icon: any }[] = [
  { id: 'financial', en: 'Financial Intelligence', ar: 'الذكاء المالي',      icon: LineChart },
  { id: 'fx',        en: 'FX',                     ar: 'العملات',            icon: Coins },
  { id: 'health',    en: 'Project Health',         ar: 'صحة المشروع',        icon: Activity },
  { id: 'portfolio', en: 'Portfolio Health',       ar: 'صحة المحفظة',        icon: Building2 },
  { id: 'commercial',en: 'Commercial',             ar: 'تجاري',              icon: ShieldCheck },
];

const COMPARISONS: { id: ComparisonBasis; en: string; ar: string }[] = [
  { id: 'last-month',        en: 'Last Month',        ar: 'الشهر الماضي' },
  { id: 'last-quarter',      en: 'Last Quarter',      ar: 'الربع الماضي' },
  { id: 'baseline',          en: 'Baseline',          ar: 'خط الأساس' },
  { id: 'original-contract', en: 'Contract Value', ar: 'قيمة العقد' },
  { id: 'current-forecast',  en: 'Current Forecast',  ar: 'التوقعات الحالية' },
];

export default function FinancialIntelligencePage() {
  const { projects } = useProjects();
  const { user } = useAuth();
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';

  const [tab, setTab] = useState<Tab>('financial');
  const [projectId, setProjectId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [cmpBasis, setCmpBasis] = useState<ComparisonBasis>('last-month');

  const enriched: FiProject[] = useMemo(() => {
    const sectors = fetchSectors();
    const companyList = fetchCompanies();
    return projects.map(p => {
      const sec = sectors.find(s => s.projectIds.includes(p.id));
      const co = sec ? companyList.find(c => c.id === sec.companyId) : undefined;
      return {
        id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr,
        companyId: sec?.companyId ?? '', companyName: co?.name ?? '',
      };
    });
  }, [projects]);

  useEffect(() => {
    if (!projectId && enriched.length) {
      const withHistory = enriched.find(p => reportablePeriods(p.id).length > 0);
      setProjectId(withHistory?.id ?? enriched[0].id);
    }
  }, [enriched, projectId]);

  const periods = useMemo(
    () => (projectId ? reportablePeriods(projectId) : []), [projectId]);

  useEffect(() => {
    setPeriodId(periods.length ? periods[0].periodId : '');
  }, [periods]);

  const selected = enriched.find(p => p.id === projectId) ?? null;

  const fi = useMemo(
    () => financialIntelligence(selected, enriched, periodId || undefined),
    [selected, enriched, periodId],
  );

  const cmp = useMemo(
    () => (selected ? historicalComparison(selected.id, cmpBasis, periodId || undefined) : null),
    [selected, cmpBasis, periodId],
  );

  const h = fi.project;
  const pf = fi.portfolio;
  const ccy = h?.reportingCurrency ?? '';

  const M = (v: number | null | undefined, tone?: string) => (
    <span className={cn(v === null || v === undefined ? 'text-muted-foreground' : tone)}
          title={v === null || v === undefined ? undefined : exactMoney(v, ccy)}>
      {v === null || v === undefined ? '—' : abbrevMoney(v)}
    </span>
  );
  const pct = (v: number | null | undefined, dp = 1) =>
    v === null || v === undefined ? '—' : `${(v * 100).toFixed(dp)}%`;
  const sc = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : v.toFixed(0);

  const bandTone = (b: string) =>
    b === 'strong' ? 'text-chart-4' : b === 'stable' ? 'text-primary'
    : b === 'watch' ? 'text-chart-5' : b === 'weak' ? 'text-chart-3' : 'text-muted-foreground';
  const scoreTone = (v: number | null | undefined) =>
    v === null || v === undefined ? 'text-muted-foreground'
    : v >= 75 ? 'text-chart-4' : v >= 55 ? 'text-primary'
    : v >= 35 ? 'text-chart-5' : 'text-chart-3';

  const Metric = ({ label, value, note, tone }: {
    label: string; value: React.ReactNode; note?: React.ReactNode; tone?: string;
  }) => (
    <div className="bg-black/30 px-4 py-3">
      <div className="lbl mb-1.5">{label}</div>
      <div className={cn('val', tone)}>{value}</div>
      {note && <div className="text-(length:--t-second) text-muted-foreground mt-1">{note}</div>}
    </div>
  );

  /** A score card with its signals exposed — never a bare number. */
  const ScoreCard = ({ title, s }: { title: string; s: HealthScore }) => (
    <div className="ds-card ds-card-tight">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="lbl">{title}</div>
        <span className={cn('badge',
          s.band === 'strong' ? 'badge-ok' : s.band === 'stable' ? 'badge-gold'
          : s.band === 'watch' ? 'badge-warn' : s.band === 'weak' ? 'badge-risk' : 'badge-neutral')}>
          {s.band}
        </span>
      </div>
      <div className={cn('val-hero', scoreTone(s.score))}>{sc(s.score)}</div>
      <div className="text-(length:--t-micro) text-muted-foreground mb-3">
        {isRtl ? '0 ضعيف · 100 قوي' : '0 weak · 100 strong'}
        {s.blind > 0 && ` · ${s.blind} ${isRtl ? 'إشارة بلا بيانات' : 'blind'}`}
      </div>
      <div className="space-y-1.5">
        {s.signals.map(sig => (
          <div key={sig.key} className="flex items-center justify-between gap-2 text-(length:--t-second)">
            <span className="text-muted-foreground truncate" title={sig.detail}>{sig.label}</span>
            <span className={cn('font-mono flex-shrink-0', scoreTone(sig.score))}>
              {sig.score === null ? '—' : sig.score.toFixed(0)}
            </span>
          </div>
        ))}
      </div>
      {s.basis && (
        <p className="text-(length:--t-micro) text-muted-foreground italic mt-3 leading-relaxed">
          {s.basis}
        </p>
      )}
    </div>
  );

  const runFiReport = () => {
    if (!selected) return;
    runReport({
      reportId: 'tl-financial-intelligence',
      project: { id: selected.id, code: selected.code,
                 nameEn: selected.nameEn, nameAr: selected.nameAr },
      projects: enriched.map(p => ({ id: p.id, code: p.code, nameEn: p.nameEn })),
      periodId: periodId || undefined,
      lang: isRtl ? 'ar' : 'en',
      generatedBy: user?.username ?? 'Unknown',
    }, 'preview');
  };

  return (
    <div className="min-h-full w-full bg-background">
      <ContextBar
        items={[{ label: 'Enterprise Portfolio', href: '/' },
                { label: isRtl ? 'الذكاء المالي' : 'Financial Intelligence' }]}
        backLabel="Enterprise Portfolio"
      />

      <div className="pg pg-stack">
        <div className="pg-head">
          <div className="min-w-0">
            <div className="pg-eyebrow mb-1.5">
              {isRtl ? 'الذكاء المالي المؤسسي' : 'Enterprise Financial Intelligence'}
            </div>
            <h1 className="pg-title">
              {isRtl ? 'التحليل المالي المتقدم' : 'Advanced Financial Analysis'}
            </h1>
          </div>
          <button onClick={runFiReport} className="btn btn-secondary btn-sm" disabled={!h?.ok}>
            <FileText className="w-3.5 h-3.5" />
            {isRtl ? 'تقرير' : 'Report'}
          </button>
        </div>

        <div className="ds-card ds-card-tight">
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 text-primary/60 mt-0.5 flex-shrink-0" />
            <p className="text-(length:--t-second) text-muted-foreground leading-relaxed">
              {isRtl
                ? 'كل رقم هنا مقروء من لقطات معتمدة في الخط الزمني. لا يُعاد حساب أي معادلة، ولا تُقرأ أي وحدة حية. الاتجاهات حركات بين أرقام مؤرشفة، والدرجات مركّبات مرجَّحة عليها، والإسقاطات امتدادات موسومة بدرجة ثقتها — والبيانات التاريخية لا تتغيّر بالنظر إليها.'
                : 'Every figure here is read from approved Timeline snapshots. No formula is recomputed and no live module is opened. Trends are movements between archived figures, scores are weighted composites over them, and projections are extrapolations labelled with their confidence — historical data is never altered by viewing it.'}
            </p>
          </div>
        </div>

        {/* ── Selectors ── */}
        <div className="ds-card ds-card-raised">
          <div className="form-grid">
            <div className="field xl:col-span-2">
              <label className="field-label">{isRtl ? 'المشروع' : 'Project'}</label>
              <select className="field-input" value={projectId}
                      onChange={e => setProjectId(e.target.value)}>
                {enriched.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {isRtl ? p.nameAr : p.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">{isRtl ? 'الفترة' : 'Period'}</label>
              <select className="field-input" value={periodId}
                      onChange={e => setPeriodId(e.target.value)}
                      disabled={!periods.length}>
                {periods.map(p => <option key={p.periodId} value={p.periodId}>{p.label}</option>)}
                {!periods.length && <option value="">—</option>}
              </select>
            </div>
            <div className="field">
              <label className="field-label">{isRtl ? 'الفترات المتاحة' : 'Periods Available'}</label>
              <input className="field-input font-mono" disabled
                     value={h?.periodsAvailable ?? 0} />
            </div>
          </div>

          {h && !h.ok && (
            <div className="mt-3 border border-chart-5/25 bg-chart-5/[0.04] px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-chart-5 mt-0.5 flex-shrink-0" />
                <p className="text-(length:--t-second) text-muted-foreground">{h.reason}</p>
              </div>
            </div>
          )}

          {h?.ok && h.periodsAvailable < 4 && (
            <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
              <AlertTriangle className="w-3 h-3 inline-block me-1.5 text-chart-5" />
              {isRtl
                ? `${h.periodsAvailable} فترة معتمدة فقط. الاتجاهات والإسقاطات مبنية على نقاط قليلة، ودرجة الثقة موسومة بذلك في كل مخرج.`
                : `Only ${h.periodsAvailable} approved period(s). Trends and projections rest on few points, and every output is labelled with that confidence.`}
            </p>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {TABS.map(t => (
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

        {/* ══ FINANCIAL INTELLIGENCE ══ */}
        {tab === 'financial' && h?.ok && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5">
              <Metric label={isRtl ? 'الدرجة الإجمالية' : 'Overall Score'}
                value={sc(h.overall)} tone={scoreTone(h.overall)}
                note={h.overallBand} />
              <Metric label={isRtl ? 'قيمة العقد' : 'Contract Value'}
                value={M(h.contractEvolution.currentContract)} tone="text-primary"
                note={pct(h.contractEvolution.totalGrowthPct)} />
              <Metric label={isRtl ? 'التكلفة عند الإنجاز' : 'EAC'}
                value={M(h.margin.points[h.margin.points.length - 1]?.eac)} />
              <Metric label={isRtl ? 'الهامش المتوقع' : 'Forecast Margin'}
                value={M(h.margin.points[h.margin.points.length - 1]?.forecastMargin,
                         (h.margin.currentForecastPct ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4')}
                note={pct(h.margin.currentForecastPct)} />
              <Metric label={isRtl ? 'انحراف التكلفة' : 'Cost Variance'}
                value={M(h.costVariance.currentCv,
                         (h.costVariance.currentCv ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4')}
                note={`CPI ${h.costVariance.currentCpi?.toFixed(3) ?? '—'}`} />
              <Metric label={isRtl ? 'انزياح التوقعات' : 'Forecast Drift'}
                value={pct(h.forecastAccuracy.meanAbsDriftPct)}
                tone={(h.forecastAccuracy.meanAbsDriftPct ?? 0) > 0.10 ? 'text-chart-5' : 'text-chart-4'}
                note={h.forecastAccuracy.bias} />
            </div>

            {/* Historical comparison */}
            <div className="sec-head">
              <GitCompare className="w-4 h-4 inline-block me-2 text-primary/70" />
              {isRtl ? 'المقارنة التاريخية' : 'Historical Comparison'}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {COMPARISONS.map(c => (
                <button key={c.id} onClick={() => setCmpBasis(c.id)}
                  className={cn('px-3 py-1.5 text-(length:--t-second) border rounded-md transition-colors',
                    cmpBasis === c.id ? 'bg-primary/10 text-primary border-primary/40'
                                      : 'border-white/[0.06] text-muted-foreground hover:text-white')}>
                  {isRtl ? c.ar : c.en}
                </button>
              ))}
            </div>

            {cmp && !cmp.ok && (
              <p className="text-(length:--t-second) text-muted-foreground italic">
                <AlertTriangle className="w-3 h-3 inline-block me-1.5 text-chart-5" />
                {cmp.reason}
              </p>
            )}

            {cmp?.ok && (
              <>
                {cmp.note && (
                  <div className="ds-card ds-card-tight !border-chart-5/25">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-chart-5 mt-0.5 flex-shrink-0" />
                      <p className="text-(length:--t-second) text-muted-foreground">{cmp.note}</p>
                    </div>
                  </div>
                )}
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th className="col-pin">{isRtl ? 'المؤشر' : 'Metric'}</th>
                        <th className="money">{cmp.fromLabel}</th>
                        <th className="money">{cmp.toLabel}</th>
                        <th className="money">{isRtl ? 'الفرق' : 'Delta'}</th>
                        <th className="money">%</th>
                        <th>{isRtl ? 'الاتجاه' : 'Direction'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cmp.metrics.map(mt => (
                        <tr key={mt.key} className={cn(mt.adverse && 'bg-chart-3/[0.04]')}>
                          <td className="col-pin">{isRtl ? mt.labelAr : mt.label}</td>
                          <td className="money text-muted-foreground">
                            {mt.kind === 'money' ? M(mt.from)
                              : mt.kind === 'days' ? (mt.from === null ? '—' : `${mt.from}d`)
                              : mt.from === null ? '—' : mt.from.toFixed(3)}
                          </td>
                          <td className="money text-white">
                            {mt.kind === 'money' ? M(mt.to)
                              : mt.kind === 'days' ? (mt.to === null ? '—' : `${mt.to}d`)
                              : mt.to === null ? '—' : mt.to.toFixed(3)}
                          </td>
                          <td className={cn('money font-mono',
                            mt.adverse ? 'text-chart-3'
                            : mt.delta === null || mt.delta === 0 ? 'text-muted-foreground'
                            : 'text-chart-4')}>
                            {mt.delta === null || mt.delta === 0 ? '—'
                              : `${mt.delta > 0 ? '+' : ''}${
                                  mt.kind === 'money' ? abbrevMoney(mt.delta)
                                  : mt.kind === 'days' ? `${mt.delta}d`
                                  : mt.delta.toFixed(3)}`}
                          </td>
                          <td className="money font-mono text-muted-foreground">
                            {mt.pctDelta === null ? '—'
                              : `${mt.pctDelta > 0 ? '+' : ''}${(mt.pctDelta * 100).toFixed(1)}%`}
                          </td>
                          <td>
                            {mt.delta === null || mt.delta === 0
                              ? <span className="text-muted-foreground">—</span>
                              : <span className={cn('badge', mt.adverse ? 'badge-risk' : 'badge-ok')}>
                                  {mt.adverse ? (isRtl ? 'سلبي' : 'Adverse')
                                              : (isRtl ? 'إيجابي' : 'Favourable')}
                                </span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Predictive */}
            <div className="sec-head">{isRtl ? 'التحليلات التنبؤية' : 'Predictive Analytics'}</div>
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'المؤشر' : 'Measure'}</th>
                    <th className="money">{isRtl ? 'الحالي' : 'Current'}</th>
                    <th className="money">{isRtl ? 'المتوقع' : 'Projected'}</th>
                    <th className="money">{isRtl ? 'الفرق' : 'Delta'}</th>
                    <th className="money">{isRtl ? 'الثقة' : 'Confidence'}</th>
                    <th>{isRtl ? 'الطريقة' : 'Method'}</th>
                  </tr>
                </thead>
                <tbody>
                  {h.predictive.projections.map(pr => (
                    <tr key={pr.key}>
                      <td className="col-pin">{isRtl ? pr.labelAr : pr.label}</td>
                      <td className="money">{M(pr.current)}</td>
                      <td className="money text-white">{M(pr.projected)}</td>
                      <td className={cn('money font-mono',
                        pr.delta === null || pr.delta === 0 ? 'text-muted-foreground'
                        : pr.delta > 0 ? 'text-chart-5' : 'text-chart-4')}>
                        {pr.delta === null || pr.delta === 0 ? '—'
                          : `${pr.delta > 0 ? '+' : ''}${abbrevMoney(pr.delta)}`}
                      </td>
                      <td className="money">
                        <span className={cn('badge',
                          pr.confidence === 'reasonable' ? 'badge-ok'
                          : pr.confidence === 'moderate' ? 'badge-gold'
                          : pr.confidence === 'low' ? 'badge-warn' : 'badge-neutral')}>
                          {pr.confidence}
                        </span>
                      </td>
                      <td className="text-muted-foreground text-(length:--t-second)">{pr.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-(length:--t-second) text-muted-foreground italic">
              {h.predictive.caution}
            </p>

            {/* Trends */}
            <div className="sec-head">{isRtl ? 'الاتجاه التاريخي' : 'Historical Trend'}</div>
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                    <th className="money">{isRtl ? 'العقد' : 'Contract'}</th>
                    <th className="money">{isRtl ? 'الفعلي' : 'Actual'}</th>
                    <th className="money">EAC</th>
                    <th className="money">CPI</th>
                    <th className="money">CV</th>
                    <th className="money">{isRtl ? 'الهامش' : 'Margin'}</th>
                    <th className="money">%</th>
                    <th className="money">{isRtl ? 'النقد التراكمي' : 'Cum. Cash'}</th>
                  </tr>
                </thead>
                <tbody>
                  {h.margin.points.map((mp, i) => {
                    const cvp = h.costVariance.points[i];
                    const cfp = h.cashVariance.points[i];
                    const bep = h.budgetEvolution.points[i];
                    return (
                      <tr key={mp.periodId}>
                        <td className="col-pin font-mono text-primary">{mp.period}</td>
                        <td className="money">{M(mp.currentContract)}</td>
                        <td className="money">{M(bep?.actual ?? mp.costIncurred)}</td>
                        <td className="money">{M(mp.eac)}</td>
                        <td className={cn('money font-mono',
                          (cvp?.cpi ?? 1) >= 1 ? 'text-chart-4' : 'text-chart-3')}>
                          {cvp?.cpi?.toFixed(3) ?? '—'}
                        </td>
                        <td className="money">{M(cvp?.cv, (cvp?.cv ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4')}</td>
                        <td className="money">{M(mp.forecastMargin,
                          (mp.forecastMargin ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4')}</td>
                        <td className="money font-mono text-muted-foreground">
                          {pct(mp.forecastMarginPct)}
                        </td>
                        <td className="money">{M(cfp?.cumulativeNet)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-(length:--t-second) text-muted-foreground italic">{h.margin.basis}</p>
          </>
        )}

        {/* ══ FX ══ */}
        {tab === 'fx' && h?.ok && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-px bg-white/5">
              <Metric label={isRtl ? 'درجة مخاطر العملة' : 'Currency Risk Score'}
                value={sc(h.currencyRisk.score)} tone={scoreTone(h.currencyRisk.score)}
                note={h.currencyRisk.band} />
              <Metric label={isRtl ? 'التعرض' : 'Exposure'}
                value={M(h.currencyImpact.totalExposure)} tone="text-primary" />
              <Metric label={isRtl ? 'من التكلفة المتوقعة' : 'Share of EAC'}
                value={pct(h.currencyImpact.exposureShareOfEac)} />
              <Metric label={isRtl ? 'عملة التقارير' : 'Reporting'}
                value={h.reportingCurrency || '—'} />
              <Metric label={isRtl ? 'عملة العقد' : 'Contract'}
                value={h.contractCurrency || '—'}
                tone={h.contractCurrency && h.contractCurrency !== h.reportingCurrency
                  ? 'text-chart-5' : undefined} />
            </div>

            <div className="sec-head">{isRtl ? 'أثر تحرّك العملة على التوقعات' : 'Forecast Currency Impact'}</div>
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'السيناريو' : 'Scenario'}</th>
                    <th className="money">{isRtl ? 'الأثر' : 'Impact'}</th>
                    <th className="money">{isRtl ? 'على EAC' : 'On EAC'}</th>
                    <th>{isRtl ? 'التفصيل' : 'Detail'}</th>
                  </tr>
                </thead>
                <tbody>
                  {h.currencyImpact.scenarios.map(s => (
                    <tr key={s.label}>
                      <td className="col-pin">{s.label}</td>
                      <td className={cn('money font-mono',
                        s.totalImpact > 0 ? 'text-chart-3' : s.totalImpact < 0 ? 'text-chart-4' : '')}>
                        {s.totalImpact === 0 ? '—'
                          : `${s.totalImpact > 0 ? '+' : ''}${abbrevMoney(s.totalImpact)}`}
                      </td>
                      <td className="money font-mono text-muted-foreground">
                        {pct(s.impactOnEac, 2)}
                      </td>
                      <td className="text-muted-foreground text-(length:--t-second)">
                        {s.rows.map(r =>
                          `${r.currency} ${r.currentRate.toFixed(4)}→${r.scenarioRate.toFixed(4)}`
                        ).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-(length:--t-second) text-muted-foreground italic">
              {h.currencyImpact.basis}
            </p>

            {h.fxMovement?.comparable && h.fxMovement.rows.length > 0 && (
              <>
                <div className="sec-head">
                  {isRtl ? 'حركة الترجمة عن الفترة السابقة' : 'Translation Movement vs Previous Period'}
                </div>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th className="col-pin">{isRtl ? 'العملة' : 'Currency'}</th>
                        <th className="money">{isRtl ? 'المحتفظ به' : 'Held'}</th>
                        <th className="money">{isRtl ? 'من سعر' : 'From'}</th>
                        <th className="money">{isRtl ? 'إلى سعر' : 'To'}</th>
                        <th className="money">{isRtl ? 'الحركة' : 'Movement'}</th>
                        <th className="money">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.fxMovement.rows.map(r => (
                        <tr key={r.currency}>
                          <td className="col-pin font-mono text-primary">{r.currency}</td>
                          <td className="money">{abbrevMoney(r.originalAmount)}</td>
                          <td className="money font-mono">{r.fromRate.toFixed(4)}</td>
                          <td className="money font-mono">{r.toRate.toFixed(4)}</td>
                          <td className={cn('money font-mono',
                            r.translationDelta > 0 ? 'text-chart-5' : 'text-chart-4')}>
                            {r.translationDelta > 0 ? '+' : ''}{abbrevMoney(r.translationDelta)}
                          </td>
                          <td className="money font-mono text-muted-foreground">{pct(r.pctDelta, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-(length:--t-second) text-muted-foreground italic">
                  {h.fxMovement.basis}
                </p>
              </>
            )}

            {h.fxMovement && !h.fxMovement.comparable && (
              <p className="text-(length:--t-second) text-muted-foreground italic">
                <AlertTriangle className="w-3 h-3 inline-block me-1.5 text-chart-5" />
                {h.fxMovement.reason}
              </p>
            )}

            <ScoreCard title={isRtl ? 'تفصيل درجة مخاطر العملة' : 'Currency Risk Signals'}
                       s={h.currencyRisk} />
          </>
        )}

        {/* ══ PROJECT HEALTH ══ */}
        {tab === 'health' && h?.ok && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-px bg-white/5">
              <Metric label={isRtl ? 'الإجمالي' : 'Overall'} value={sc(h.overall)}
                tone={scoreTone(h.overall)} note={h.overallBand} />
              <Metric label={isRtl ? 'مالي' : 'Financial'} value={sc(h.financial.score)}
                tone={scoreTone(h.financial.score)} note={h.financial.band} />
              <Metric label={isRtl ? 'تجاري' : 'Commercial'} value={sc(h.commercial.score)}
                tone={scoreTone(h.commercial.score)} note={h.commercial.band} />
              <Metric label={isRtl ? 'مخاطر العملة' : 'Currency Risk'} value={sc(h.currencyRisk.score)}
                tone={scoreTone(h.currencyRisk.score)} note={h.currencyRisk.band} />
              <Metric label={isRtl ? 'مؤشر الاستقرار' : 'Stability Index'} value={sc(h.stability.score)}
                tone={scoreTone(h.stability.score)} note={h.stability.band} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <ScoreCard title={isRtl ? 'الصحة المالية' : 'Financial Health'} s={h.financial} />
              <ScoreCard title={isRtl ? 'الصحة التجارية' : 'Commercial Health'} s={h.commercial} />
              <ScoreCard title={isRtl ? 'مخاطر العملة' : 'Currency Risk'} s={h.currencyRisk} />
              <ScoreCard title={isRtl ? 'الاستقرار' : 'Stability'} s={h.stability} />
            </div>

            <div className="sec-head">{isRtl ? 'دقة التوقعات' : 'Forecast Accuracy'}</div>
            <div className="ds-card ds-card-tight !border-chart-5/25">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-chart-5 mt-0.5 flex-shrink-0" />
                <p className="text-(length:--t-second) text-muted-foreground">
                  {h.forecastAccuracy.limitation}
                </p>
              </div>
            </div>
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'فترة التوقع' : 'Forecast Period'}</th>
                    <th className="money">{isRtl ? 'الأفق' : 'Horizon'}</th>
                    <th className="money">{isRtl ? 'EAC وقتها' : 'EAC Then'}</th>
                    <th className="money">{isRtl ? 'EAC الآن' : 'EAC Now'}</th>
                    <th className="money">{isRtl ? 'الانزياح' : 'Drift'}</th>
                    <th className="money">%</th>
                    <th>{isRtl ? 'تجاوز' : 'Breached'}</th>
                  </tr>
                </thead>
                <tbody>
                  {h.forecastAccuracy.rows.map(r => (
                    <tr key={r.forecastPeriodId}>
                      <td className="col-pin font-mono text-primary">{r.forecastPeriod}</td>
                      <td className="money">{r.horizon}</td>
                      <td className="money">{M(r.forecastEac)}</td>
                      <td className="money">{M(r.laterEac)}</td>
                      <td className={cn('money font-mono',
                        (r.drift ?? 0) > 0 ? 'text-chart-3' : (r.drift ?? 0) < 0 ? 'text-chart-4' : '')}>
                        {r.drift === null || r.drift === 0 ? '—'
                          : `${r.drift > 0 ? '+' : ''}${abbrevMoney(r.drift)}`}
                      </td>
                      <td className="money font-mono text-muted-foreground">{pct(r.driftPct, 2)}</td>
                      <td>
                        {r.breached
                          ? <span className="badge badge-risk">{isRtl ? 'نعم' : 'Yes'}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                  {h.forecastAccuracy.rows.length === 0 && (
                    <tr><td colSpan={7}><div className="ds-empty">
                      <div className="ds-empty-title">
                        {isRtl ? 'فترة واحدة فقط — لا يوجد انزياح لقياسه' : 'Only one period — no drift to measure'}
                      </div>
                    </div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ══ PORTFOLIO HEALTH ══ */}
        {tab === 'portfolio' && pf && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5">
              <Metric label={isRtl ? 'متوسط الصحة' : 'Mean Health'}
                value={sc(pf.meanOverall)} tone={scoreTone(pf.meanOverall)} />
              <Metric label={isRtl ? 'مالي' : 'Financial'}
                value={sc(pf.meanFinancial)} tone={scoreTone(pf.meanFinancial)} />
              <Metric label={isRtl ? 'تجاري' : 'Commercial'}
                value={sc(pf.meanCommercial)} tone={scoreTone(pf.meanCommercial)} />
              <Metric label={isRtl ? 'مخاطر العملة' : 'Currency Risk'}
                value={sc(pf.meanCurrencyRisk)} tone={scoreTone(pf.meanCurrencyRisk)} />
              <Metric label="SPI" value={pf.spi === null ? '—' : pf.spi.toFixed(3)}
                tone={(pf.spi ?? 1) >= 1 ? 'text-chart-4' : 'text-chart-3'} />
              <Metric label="CPI" value={pf.cpi === null ? '—' : pf.cpi.toFixed(3)}
                tone={(pf.cpi ?? 1) >= 1 ? 'text-chart-4' : 'text-chart-3'} />
            </div>

            {pf.mixedCurrency && (
              <p className="text-(length:--t-second) text-muted-foreground italic">
                <Coins className="w-3 h-3 inline-block me-1.5 text-chart-5" />
                {isRtl
                  ? 'المحفظة تشمل أكثر من عملة تقارير. الدرجات نسب فلا تتأثر، لكن أي مقارنة نقدية بين المشاريع تحتاج تحويلاً صريحاً.'
                  : 'This portfolio spans more than one reporting currency. Scores are ratios and are unaffected, but any monetary comparison between projects needs an explicit conversion.'}
              </p>
            )}

            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'المشروع' : 'Project'}</th>
                    <th>{isRtl ? 'الشركة' : 'Company'}</th>
                    <th>{isRtl ? 'الفترة' : 'Period'}</th>
                    <th>{isRtl ? 'العملة' : 'Ccy'}</th>
                    <th className="money">{isRtl ? 'الإجمالي' : 'Overall'}</th>
                    <th className="money">{isRtl ? 'مالي' : 'Fin.'}</th>
                    <th className="money">{isRtl ? 'تجاري' : 'Comm.'}</th>
                    <th className="money">{isRtl ? 'عملة' : 'Ccy Risk'}</th>
                    <th className="money">{isRtl ? 'استقرار' : 'Stab.'}</th>
                    <th>{isRtl ? 'الأضعف' : 'Weakest'}</th>
                    <th>{isRtl ? 'النطاق' : 'Band'}</th>
                  </tr>
                </thead>
                <tbody>
                  {pf.rows.map(r => (
                    <tr key={r.projectId} className={cn(r.projectId === projectId && 'bg-primary/[0.04]')}>
                      <td className="col-pin font-mono text-primary">{r.code}</td>
                      <td className="text-muted-foreground">{r.companyName || '—'}</td>
                      <td className="text-muted-foreground">{r.period}</td>
                      <td className="font-mono text-muted-foreground">{r.reportingCurrency || '—'}</td>
                      <td className={cn('money font-mono', scoreTone(r.overall))}>{sc(r.overall)}</td>
                      <td className={cn('money font-mono', scoreTone(r.financial))}>{sc(r.financial)}</td>
                      <td className={cn('money font-mono', scoreTone(r.commercial))}>{sc(r.commercial)}</td>
                      <td className={cn('money font-mono', scoreTone(r.currencyRisk))}>{sc(r.currencyRisk)}</td>
                      <td className={cn('money font-mono', scoreTone(r.stability))}>{sc(r.stability)}</td>
                      <td className="text-muted-foreground">{r.weakest}</td>
                      <td>
                        <span className={cn('badge',
                          r.band === 'strong' ? 'badge-ok' : r.band === 'stable' ? 'badge-gold'
                          : r.band === 'watch' ? 'badge-warn' : r.band === 'weak' ? 'badge-risk' : 'badge-neutral')}>
                          {r.band}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pf.noHistory.length > 0 && (
              <p className="text-(length:--t-second) text-muted-foreground italic">
                {isRtl ? 'مشاريع بلا فترة معتمدة، مستبعَدة ولم تُملأ بصفر' : 'Projects with no approved period — excluded, not zero-filled'}
                {': '}
                <span className="font-mono">{pf.noHistory.map(p => p.code || p.id).join(' · ')}</span>
              </p>
            )}
            <p className="text-(length:--t-second) text-muted-foreground italic">{pf.basis}</p>
          </>
        )}

        {/* ══ COMMERCIAL ══ */}
        {tab === 'commercial' && h?.ok && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-white/5">
              <Metric label={isRtl ? 'الصحة التجارية' : 'Commercial Health'}
                value={sc(h.commercial.score)} tone={scoreTone(h.commercial.score)}
                note={h.commercial.band} />
              <Metric label={isRtl ? 'العقد الأصلي' : 'Original'}
                value={M(h.contractEvolution.originalContract)} />
              <Metric label={isRtl ? 'العقد الحالي' : 'Current'}
                value={M(h.contractEvolution.currentContract)} tone="text-primary" />
              <Metric label={isRtl ? 'إجمالي النمو' : 'Total Growth'}
                value={M(h.contractEvolution.totalGrowth)}
                note={pct(h.contractEvolution.totalGrowthPct)} />
              <Metric label={isRtl ? 'فترات تحرّك فيها' : 'Periods Moved'}
                value={`${h.contractEvolution.movementCount} / ${h.contractEvolution.points.length}`} />
              <Metric label={isRtl ? 'أكبر حركة' : 'Largest Move'}
                value={M(h.contractEvolution.largestMovement?.movement)}
                note={h.contractEvolution.largestMovement?.period} />
            </div>

            {h.contractEvolution.rebaselinedDuring && (
              <p className="text-(length:--t-second) text-muted-foreground italic">
                <AlertTriangle className="w-3 h-3 inline-block me-1.5 text-chart-5" />
                {isRtl
                  ? 'تغيّر خط الأساس خلال هذه السلسلة. حركة في القيمة قد تكون إعادة ضبط للخطة لا تغييراً تجارياً — والرقمان لا يُفرَّق بينهما من القيم وحدها.'
                  : 'The baseline changed during this series. A movement may be a re-baseline rather than a commercial change, and the two are not distinguishable from the values alone.'}
              </p>
            )}

            <div className="sec-head">{isRtl ? 'تطوّر قيمة العقد' : 'Contract Value Evolution'}</div>
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                    <th className="money">{isRtl ? 'الأصلي' : 'Original'}</th>
                    <th className="money">{isRtl ? 'أوامر معتمدة' : 'Approved VOs'}</th>
                    <th className="money">{isRtl ? 'قيد الاعتماد' : 'Pending'}</th>
                    <th className="money">{isRtl ? 'مطالبات معتمدة' : 'Appr. Claims'}</th>
                    <th className="money">{isRtl ? 'الحالي' : 'Current'}</th>
                    <th className="money">{isRtl ? 'الحركة' : 'Movement'}</th>
                    <th className="money">{isRtl ? 'النمو' : 'Growth'}</th>
                    <th className="money">{isRtl ? 'خط الأساس' : 'Baseline'}</th>
                  </tr>
                </thead>
                <tbody>
                  {h.contractEvolution.points.map(p => (
                    <tr key={p.periodId} className={cn(p.rebaselined && 'bg-chart-5/[0.05]')}>
                      <td className="col-pin font-mono text-primary">{p.period}</td>
                      <td className="money text-muted-foreground">{M(p.originalContract)}</td>
                      <td className="money">{M(p.approvedCOs)}</td>
                      <td className="money text-chart-5">{M(p.pendingCOs)}</td>
                      <td className="money text-muted-foreground">{M(p.approvedClaims)}</td>
                      <td className="money text-white">{M(p.currentContract)}</td>
                      <td className={cn('money font-mono',
                        p.movement === null || p.movement === 0 ? 'text-muted-foreground'
                        : p.movement > 0 ? 'text-chart-4' : 'text-chart-3')}>
                        {p.movement === null || p.movement === 0 ? '—'
                          : `${p.movement > 0 ? '+' : ''}${abbrevMoney(p.movement)}`}
                      </td>
                      <td className="money font-mono text-muted-foreground">
                        {pct(p.growthFromOriginal, 2)}
                      </td>
                      <td className="money font-mono">
                        {p.baselineVersion === null ? '—' : `V${p.baselineVersion}`}
                        {p.rebaselined && (
                          <span className="badge badge-warn ms-1">
                            {isRtl ? 'جديد' : 'new'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-(length:--t-second) text-muted-foreground italic">
              {h.contractEvolution.basis}
            </p>

            <div className="sec-head">{isRtl ? 'تطوّر الموازنة' : 'Budget Evolution'}</div>
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
                    <th className="money">{isRtl ? 'المخطط' : 'Planned'}</th>
                    <th className="money">{isRtl ? 'الفعلي' : 'Actual'}</th>
                    <th className="money">{isRtl ? 'إنفاق الفترة' : 'Period Spend'}</th>
                    <th className="money">{isRtl ? 'المتوقع' : 'Forecast'}</th>
                    <th className="money">{isRtl ? 'حركة التوقع' : 'Fcst Move'}</th>
                    <th className="money">{isRtl ? 'الانحراف' : 'Variance'}</th>
                    <th className="money">{isRtl ? 'معدل الصرف' : 'Burn'}</th>
                  </tr>
                </thead>
                <tbody>
                  {h.budgetEvolution.points.map(p => (
                    <tr key={p.periodId}>
                      <td className="col-pin font-mono text-primary">{p.period}</td>
                      <td className="money text-muted-foreground">{M(p.planned)}</td>
                      <td className="money">{M(p.actual)}</td>
                      <td className="money font-mono">{M(p.periodSpend)}</td>
                      <td className="money">{M(p.forecast)}</td>
                      <td className={cn('money font-mono',
                        (p.forecastMovement ?? 0) > 0 ? 'text-chart-3'
                        : (p.forecastMovement ?? 0) < 0 ? 'text-chart-4' : 'text-muted-foreground')}>
                        {p.forecastMovement === null || p.forecastMovement === 0 ? '—'
                          : `${p.forecastMovement > 0 ? '+' : ''}${abbrevMoney(p.forecastMovement)}`}
                      </td>
                      <td className="money">{M(p.variance,
                        (p.variance ?? 0) < 0 ? 'text-chart-3' : 'text-chart-4')}</td>
                      <td className="money font-mono text-muted-foreground">{pct(p.burnRate, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-(length:--t-second) text-muted-foreground italic">
              {h.budgetEvolution.basis}
            </p>

            <ScoreCard title={isRtl ? 'تفصيل الصحة التجارية' : 'Commercial Health Signals'}
                       s={h.commercial} />
          </>
        )}

        {/* Provenance */}
        <div className="ds-card ds-card-tight">
          <p className="text-(length:--t-second) text-muted-foreground leading-relaxed">
            {fi.basis}
          </p>
        </div>
      </div>
    </div>
  );
}
