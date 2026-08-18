import React, { useMemo, useState } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { cn, formatMoney } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { formatDateOrDash } from '../lib/dateFormat';
import {
  AssignmentRef, CompanyPerformance, CategoryKey, ManualKey,
  CATEGORY_META, CATEGORY_ORDER,
  evaluateCompany, saveManualCategory, readPerf, scoreColor,
} from '../lib/subPerformance';
import { Gauge, Pencil, X, Check, Info } from 'lucide-react';

/**
 * Subcontractor Performance dashboard.
 * Destination: src/components/SubPerformancePanel.tsx
 *
 * Presentation only. Every number comes from lib/subPerformance, which in turn
 * reads the existing commercial / delay data. Nothing here calculates and
 * nothing here touches another module's storage.
 *
 * The five manual categories are the only editable surface. Time Performance
 * is rendered read-only with its inputs exposed, so a reviewer can see exactly
 * why the automatic score is what it is.
 */

const GOLD = '#D4AF5A';
const AXIS_PROPS = { tick: { fill: 'rgba(255,255,255,0.3)', fontSize: 10 }, axisLine: false, tickLine: false };
const GRID_PROPS = { stroke: 'rgba(255,255,255,0.04)', strokeDasharray: '3 3' };
const TT_STYLE = {
  background: '#161514', border: '1px solid rgba(179,138,61,0.3)',
  borderRadius: 0, color: 'rgba(255,255,255,0.8)', fontSize: 11,
};

function toneClass(tone: string) {
  switch (tone) {
    case 'ok': return 'text-chart-4 border-chart-4/40 bg-chart-4/10';
    case 'gold': return 'text-primary border-primary/40 bg-primary/10';
    case 'warn': return 'text-chart-5 border-chart-5/40 bg-chart-5/10';
    default: return 'text-chart-3 border-chart-3/40 bg-chart-3/10';
  }
}

interface Props {
  /**
   * SPRINT 3 · R5 — presentation only; the panel scores companies and
   * holds no project, so the currency arrives as a prop. The default
   * preserves the previous behaviour for any caller not yet updated.
   */
  ccy?: string;
  /** One entry per subcontract assignment held by this subcontractor. */
  refs: AssignmentRef[];
  canEdit?: boolean;
  /** Pre-fills the reviewer field. */
  reviewerName?: string;
  /** Bump to force a re-read after an external change. */
  version?: number;
  onChange?: () => void;
}

export default function SubPerformancePanel({
  refs, canEdit = false, reviewerName = '', version = 0, onChange, ccy = 'SAR',
}: Props) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const [rev, setRev] = useState(0);

  const perf: CompanyPerformance = useMemo(
    () => evaluateCompany(refs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refs, rev, version],
  );

  const [editing, setEditing] = useState<{ projectId: string; subId: string; key: ManualKey } | null>(null);
  const [draft, setDraft] = useState({ score: '', comment: '', reviewer: '', reviewDate: '' });

  const label = (k: CategoryKey) => (isRtl ? CATEGORY_META[k].ar : CATEGORY_META[k].en);
  const shortLabel = (k: CategoryKey) => (isRtl ? CATEGORY_META[k].shortAr : CATEGORY_META[k].shortEn);
  const hint = (k: CategoryKey) => (isRtl ? CATEGORY_META[k].hintAr : CATEGORY_META[k].hintEn);

  const radarData = perf.breakdown.map(b => ({
    axis: shortLabel(b.key),
    score: b.score ?? 0,
  }));

  const trendData = perf.trend.map(t => ({
    date: formatDateOrDash(t.date, lang as 'en' | 'ar'),
    score: t.score,
  }));

  const startEdit = (projectId: string, subId: string, key: ManualKey) => {
    const rec = readPerf(projectId, subId)[key];
    setEditing({ projectId, subId, key });
    setDraft({
      score: rec.score === null ? '' : String(rec.score),
      comment: rec.comment,
      reviewer: rec.reviewer || reviewerName,
      reviewDate: rec.reviewDate || new Date().toISOString().slice(0, 10),
    });
  };

  const cancel = () => { setEditing(null); setDraft({ score: '', comment: '', reviewer: '', reviewDate: '' }); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const ref = refs.find(r => r.projectId === editing.projectId && r.subId === editing.subId);
    saveManualCategory(
      editing.projectId, editing.subId, editing.key,
      {
        score: draft.score === '' ? null : Math.max(0, Math.min(100, Number(draft.score) || 0)),
        comment: draft.comment,
        reviewer: draft.reviewer,
        reviewDate: draft.reviewDate,
      },
      ref?.contractValue ?? 0,
    );
    cancel();
    setRev(v => v + 1);
    onChange?.();
  };

  if (refs.length === 0) {
    return (
      <div className="ds-empty">
        <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
          <Gauge className="w-8 h-8 text-muted-foreground -rotate-45" />
        </div>
        <p className="font-serif text-xl text-muted-foreground">
          {isRtl ? 'لا توجد عقود لتقييمها.' : 'No contracts to evaluate.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ══ OVERALL ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-white/[0.04]">
        <div className="bg-black/20 p-6 flex items-center gap-5">
          <Gauge className={cn('w-10 h-10 flex-shrink-0', scoreColor(perf.scored ? perf.score : null))} />
          <div className="min-w-0">
            <div className="text-(length:--t-label) uppercase tracking-widest text-white/45 mb-1">
              {isRtl ? 'الأداء الإجمالي' : 'Overall Performance'}
            </div>
            <div className="flex items-baseline gap-1">
              <span className={cn('font-mono text-4xl font-bold number-ltr', scoreColor(perf.scored ? perf.score : null))}>
                {perf.scored ? perf.score : '—'}
              </span>
              <span className="font-mono text-sm text-white/30 number-ltr">/100</span>
            </div>
          </div>
        </div>

        <div className="bg-black/20 p-6">
          <div className="text-(length:--t-label) uppercase tracking-widest text-white/45 mb-2">
            {isRtl ? 'التقدير' : 'Grade'}
          </div>
          <span className={cn('inline-block px-4 py-1.5 border font-mono text-2xl font-bold', toneClass(perf.grade.tone))}>
            {perf.scored ? perf.grade.grade : '—'}
          </span>
        </div>

        <div className="bg-black/20 p-6">
          <div className="text-(length:--t-label) uppercase tracking-widest text-white/45 mb-2">
            {isRtl ? 'الحالة' : 'Status'}
          </div>
          <div className={cn('text-lg font-serif', scoreColor(perf.scored ? perf.score : null))}>
            {perf.scored
              ? (isRtl ? perf.grade.ar : perf.grade.en)
              : (isRtl ? 'لم يتم التقييم بعد' : 'Not Evaluated')}
          </div>
          {perf.lastReview && (
            <div className="text-(length:--t-second) text-muted-foreground mt-2">
              {isRtl ? 'آخر مراجعة' : 'Last Review'}
              {' · '}
              {formatDateOrDash(perf.lastReview.date, lang as 'en' | 'ar')}
              {perf.lastReview.reviewer ? ` · ${perf.lastReview.reviewer}` : ''}
            </div>
          )}
        </div>
      </div>

      <p className="text-(length:--t-second) text-muted-foreground italic flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        {isRtl
          ? 'النتيجة الإجمالية مرجّحة بقيمة العقد الحالية لكل مشروع — العقود الأكبر تؤثر أكثر. أداء الوقت تلقائي بالكامل ويُقاس مقابل مدة العقد المعتمدة الحالية، فلا يُحاسب المقاول على التمديدات المعتمدة.'
          : 'The overall score is weighted by each project’s current contract amount — larger contracts carry more influence. Time Performance is fully automatic and measured against the current approved contract duration, so approved extensions never penalise the subcontractor.'}
      </p>

      {/* ══ BREAKDOWN + RADAR ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-white/[0.06] bg-black/10 p-5">
          <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
            {isRtl ? 'تفصيل الأداء' : 'Performance Breakdown'}
          </p>
          <div className="space-y-3">
            {perf.breakdown.map(b => (
              <div key={b.key}>
                <div className="flex items-center justify-between text-(length:--t-body) mb-1">
                  <span className="text-white/70">
                    {label(b.key)}
                    <span className="text-white/25 font-mono ms-2 number-ltr">{b.weight}%</span>
                    {b.automatic && (
                      <span className="ms-2 text-(length:--t-micro) uppercase tracking-widest text-primary/60 border border-primary/20 px-1 py-0.5">
                        {isRtl ? 'تلقائي' : 'Auto'}
                      </span>
                    )}
                  </span>
                  <span className={cn('font-mono number-ltr font-bold', scoreColor(b.score))}>
                    {b.score === null ? '—' : b.score}
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-sm overflow-hidden">
                  <div
                    className={cn('h-full',
                      b.score === null ? 'bg-white/10'
                        : b.score >= 85 ? 'bg-chart-4'
                        : b.score >= 75 ? 'bg-primary'
                        : b.score >= 60 ? 'bg-chart-5' : 'bg-chart-3')}
                    style={{ width: `${b.score ?? 0}%` }}
                  />
                </div>
                <div className="text-(length:--t-second) text-muted-foreground mt-1">{hint(b.key)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-white/[0.06] bg-black/10 p-5">
          <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
            {isRtl ? 'خريطة الأداء' : 'Performance Radar'}
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid stroke="rgba(255,255,255,0.08)" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 9 }} axisLine={false} />
              <Radar name="Score" dataKey="score" stroke={GOLD} fill={GOLD} fillOpacity={0.25} />
              <Tooltip contentStyle={TT_STYLE} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ══ TREND ══ */}
      <div className="border border-white/[0.06] bg-black/10 p-5">
        <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
          {isRtl ? 'تطور الأداء عبر الزمن' : 'Performance Trend'}
        </p>
        {trendData.length > 1 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" {...AXIS_PROPS} />
              <YAxis domain={[0, 100]} {...AXIS_PROPS} />
              <Tooltip contentStyle={TT_STYLE} />
              <Line type="monotone" dataKey="score" stroke={GOLD} strokeWidth={2} dot={{ r: 3, fill: GOLD }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[120px] flex items-center justify-center text-white/25 text-xs italic">
            {isRtl
              ? 'يظهر الاتجاه بعد حفظ مراجعتين في تاريخين مختلفين.'
              : 'The trend appears once two reviews exist on different dates.'}
          </div>
        )}
      </div>

      {/* ══ PER-ASSIGNMENT EVALUATION ══ */}
      {perf.assignments.map(a => (
        <div key={`${a.projectId}-${a.subId}`} className="border border-white/[0.06] bg-black/10">
          <div className="p-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-serif text-base text-white leading-tight">
                {a.projectName || a.projectCode || a.projectId}
              </h4>
              <div className="text-(length:--t-label) uppercase tracking-widest text-primary/60 mt-0.5">
                {a.trade || '—'}
                {' · '}
                {isRtl ? 'العقد الحالي' : 'Current Contract'}{' '}
                <span className="font-mono number-ltr">{formatMoney(a.contractAmount, { currency: ccy })}</span>
                {' · '}
                {isRtl ? 'الوزن' : 'Weight'}{' '}
                <span className="font-mono number-ltr">{a.weightPct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-end">
                <div className="text-(length:--t-label) uppercase text-white/45">{isRtl ? 'النتيجة' : 'Score'}</div>
                <div className={cn('font-mono text-xl font-bold number-ltr', scoreColor(a.scored ? a.score : null))}>
                  {a.scored ? a.score : '—'}
                </div>
              </div>
              <span className={cn('px-3 py-1 border font-mono text-sm font-bold', toneClass(a.grade.tone))}>
                {a.scored ? a.grade.grade : '—'}
              </span>
            </div>
          </div>

          {!a.time.available && (
            <div className="px-4 py-2 border-b border-white/5 bg-chart-5/[0.06] text-(length:--t-second) text-chart-5 flex items-start gap-1.5">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
              {isRtl
                ? 'أداء الوقت غير محسوب: لا يوجد برنامج زمني لهذا العقد. أدخل تاريخ البدء والمدة الأساسية من تبويب Commercial ← Programme، وسيُحسب تلقائياً. وزن الـ 25% مُعاد توزيعه حالياً على باقي الفئات.'
                : 'Time Performance is not scored: this subcontract has no programme. Enter a Commencement Date and Baseline Duration in Commercial → Programme and it will compute automatically. Its 25% weight is currently redistributed across the other categories.'}
            </div>
          )}

          {/* Automatic time inputs — shown so the score is auditable */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-px bg-white/[0.04] border-b border-white/5">
            {[
              { l: isRtl ? 'المدة الأساسية' : 'Baseline Duration', v: `${a.time.baselineDuration}d` },
              { l: isRtl ? 'تمديد أوامر التغيير' : 'CO Extension', v: `${a.time.approvedCoDays}d` },
              { l: isRtl ? 'تمديد المطالبات' : 'Claim Extension', v: `${a.time.approvedClaimDays}d` },
              { l: isRtl ? 'المدة المعتمدة الحالية' : 'Current Approved Duration', v: `${a.time.currentApprovedDuration}d` },
              { l: isRtl ? 'إجمالي التأخير' : 'Total Delay', v: `${a.time.totalDelay}d` },
              { l: isRtl ? 'التأخير المستوجب' : 'Culpable Delay', v: `${a.time.culpableDelay}d` },
              { l: isRtl ? 'الإنجاز المعتمد' : 'Approved Completion', v: formatDateOrDash(a.time.currentCompletion, lang as 'en' | 'ar') },
            ].map((k, i) => (
              <div key={i} className="bg-black/20 p-3">
                <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{k.l}</div>
                <div className="text-xs font-mono number-ltr text-white">{k.v}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead className="text-(length:--t-label) uppercase bg-black/60 text-muted-foreground border-b border-white/10">
                <tr>
                  <th className="px-3 py-2 text-start">{isRtl ? 'الفئة' : 'Category'}</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'الوزن' : 'Weight'}</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'النتيجة' : 'Score'}</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'التعليق' : 'Comment'}</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'المراجع' : 'Reviewer'}</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'تاريخ المراجعة' : 'Review Date'}</th>
                  <th className="px-3 py-2 text-end" />
                </tr>
              </thead>
              <tbody>
                {CATEGORY_ORDER.map(key => {
                  const c = a.categories.find(x => x.key === key)!;
                  const isEditing = editing
                    && editing.projectId === a.projectId
                    && editing.subId === a.subId
                    && editing.key === key;

                  if (isEditing) {
                    return (
                      <tr key={key} className="border-b border-white/5 bg-black/40">
                        <td colSpan={7} className="px-3 py-3">
                          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                            <div>
                              <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{label(key)}</div>
                              <input
                                type="number" min="0" max="100" autoFocus
                                placeholder={isRtl ? 'النتيجة 0-100' : 'Score 0-100'}
                                value={draft.score}
                                onChange={e => setDraft({ ...draft, score: e.target.value })}
                                className="w-full bg-black border border-white/10 px-3 py-1.5 text-sm font-mono number-ltr"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{isRtl ? 'التعليق' : 'Comment'}</div>
                              <input
                                type="text"
                                value={draft.comment}
                                onChange={e => setDraft({ ...draft, comment: e.target.value })}
                                className="w-full bg-black border border-white/10 px-3 py-1.5 text-sm"
                              />
                            </div>
                            <div>
                              <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{isRtl ? 'المراجع' : 'Reviewer'}</div>
                              <input
                                type="text"
                                value={draft.reviewer}
                                onChange={e => setDraft({ ...draft, reviewer: e.target.value })}
                                className="w-full bg-black border border-white/10 px-3 py-1.5 text-sm"
                              />
                            </div>
                            <div>
                              <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{isRtl ? 'التاريخ' : 'Date'}</div>
                              <input
                                type="date"
                                value={draft.reviewDate}
                                onChange={e => setDraft({ ...draft, reviewDate: e.target.value })}
                                className="w-full bg-black border border-white/10 px-3 py-1.5 text-sm font-mono number-ltr"
                              />
                            </div>
                            <div className="md:col-span-5 flex gap-2 justify-end">
                              <button type="button" onClick={cancel}
                                      className="inline-flex items-center gap-1 text-(length:--t-label) uppercase tracking-widest text-muted-foreground border border-white/10 px-3 py-1.5 hover:text-white">
                                <X className="w-3 h-3" />{isRtl ? 'إلغاء' : 'Cancel'}
                              </button>
                              <button type="submit"
                                      className="inline-flex items-center gap-1 text-(length:--t-label) uppercase tracking-widest text-primary border border-primary/40 px-3 py-1.5 hover:bg-primary hover:text-primary-foreground transition-colors">
                                <Check className="w-3 h-3" />{isRtl ? 'حفظ' : 'Save'}
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={key} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                      <td className="px-3 py-2 text-white">
                        {label(key)}
                        {c.automatic && (
                          <span className="ms-2 text-(length:--t-micro) uppercase tracking-widest text-primary/60 border border-primary/20 px-1 py-0.5">
                            {isRtl ? 'تلقائي' : 'Auto'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground number-ltr">{c.weight}%</td>
                      <td className={cn('px-3 py-2 font-mono font-bold number-ltr', scoreColor(c.score))}>
                        {c.score === null ? '—' : c.score}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[18rem] truncate" title={c.comment}>
                        {c.automatic
                          ? (a.time.available
                              ? (isRtl ? 'محسوب من محرك التأخير' : 'Derived from the delay engine')
                              : (isRtl
                                  ? 'أدخل تاريخ البدء والمدة الأساسية في تبويب Commercial ← Programme'
                                  : 'Enter Commencement Date + Baseline Duration in Commercial → Programme'))
                          : (c.comment || '—')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.automatic ? (isRtl ? 'النظام' : 'System') : (c.reviewer || '—')}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground number-ltr">
                        {c.automatic ? '—' : formatDateOrDash(c.reviewDate, lang as 'en' | 'ar')}
                      </td>
                      <td className="px-3 py-2 text-end">
                        {canEdit && !c.automatic && (
                          <button
                            onClick={() => startEdit(a.projectId, a.subId, key as ManualKey)}
                            className="text-muted-foreground hover:text-primary transition-colors p-1"
                            title={isRtl ? 'تقييم' : 'Evaluate'}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* ══ COMMENTS ══ */}
      {perf.comments.length > 0 && (
        <div className="border border-white/[0.06] bg-black/10 p-5">
          <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
            {isRtl ? 'ملاحظات المراجعين' : 'Reviewer Comments'}
          </p>
          <div className="space-y-3">
            {perf.comments.map((c, i) => (
              <div key={i} className="border-s-2 border-primary/30 ps-3">
                <div className="text-(length:--t-label) uppercase tracking-widest text-primary/60">
                  {c.project} · {label(c.category)}
                </div>
                <p className="text-xs text-white/80 mt-1">{c.comment}</p>
                <div className="text-(length:--t-second) text-muted-foreground mt-1">
                  {c.reviewer || '—'} · {formatDateOrDash(c.date, lang as 'en' | 'ar')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!canEdit && (
        <p className="text-(length:--t-second) text-muted-foreground italic">
          {isRtl
            ? 'التقييم اليدوي متاح لمستخدمي الإدارة فقط.'
            : 'Manual evaluation is available to admin users only.'}
        </p>
      )}
    </div>
  );
}

/** Re-exported so callers don't import two modules for one panel. */
export type { AssignmentRef, ManualKey };
