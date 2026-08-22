import React, { useState, useEffect, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useProjectCurrency } from '../../lib/useProjectCurrency';
import { useTranslation } from '../../lib/i18n';
import { formatMoney, formatPercent, cn } from '../../lib/utils';
import ReportButton from '../reporting/ReportButton';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Brush,
} from 'recharts';
import { Scale, TrendingUp, AlertTriangle, Download } from 'lucide-react';
import { readSyncedEvm, snapshot, computeBac, computeBacSplit, STATUS_META } from '../../lib/evm';

/**
 * CVR — COST VALUE RECONCILIATION · the owner's margin view.
 * Destination: src/components/modules/CVRModule.tsx
 *
 * Lives BETWEEN Earned Value and Delay Analysis in the project tabs —
 * a project-level screen of its own, not a corner of EVM (owner rule).
 *
 *   %Progress Planned = PV ÷ BAC                %Progress = EV ÷ BAC
 *   Planned CVR = %Progress Planned × (CA − BAC)
 *   CVR         = %Progress          × (CA − BAC)
 *   Planned profit  = CA − BAC   (the target — frozen, moves only with the baseline)
 *   Expected profit = CA − EAC   (the outlook — breathes every period, official method)
 *
 * CA (Contract Amount) is the SAME contract basis `computeBac` derives BAC's
 * fallback from — contract value + APPROVED change orders + settled claims —
 * so both sides of the margin move together and an unapproved order is
 * excluded until the day its status flips to approved (auto-linked, no wiring).
 *
 * The module renders and exports; it never computes a metric of its own —
 * every figure comes from lib/evm.ts, so the screen and the report agree.
 */

// Muted palette — existing design tokens only, no new colours (EVM's set).
const C_PV   = '#a5a49f';   // the plan, deliberately quiet
const C_EV   = '#d4af37';   // the headline
const C_GRID = 'rgba(212,175,55,0.08)';

const AXIS = { stroke: '#a5a49f', tick: { fontSize: 10, fill: '#a5a49f' } };

const TT_STYLE: React.CSSProperties = {
  background: '#1b1c1c',
  border: '1px solid rgba(212,175,55,0.35)',
  borderRadius: 4,
  fontSize: 12,
  padding: '8px 12px',
  color: '#ffffff',
};
const TT_LABEL: React.CSSProperties = { color: '#d4af37', fontWeight: 600, marginBottom: 4 };
const TT_ITEM: React.CSSProperties = { color: '#ffffff', fontFamily: 'var(--font-mono)' };
const TT_CURSOR = { fill: 'rgba(212,175,55,0.10)', stroke: 'rgba(212,175,55,0.35)' };

/** Compact money for axes: 145M, 8.5M, 900K. */
function shortMoney(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

/** Short money inside a note line. */
function fmtShort(v: number): string { return shortMoney(v); }

/** Delta colour: over/under against zero, muted when nothing to say. */
function varianceTone(v: number): string {
  if (Math.abs(v) < 0.005) return 'text-muted-foreground';
  return v > 0 ? 'text-chart-4' : 'text-chart-3';
}

export default function CVRModule({ project }: { project: Project; canEdit?: boolean }) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const ccy = useProjectCurrency(project).base;

  const [store, setStore] = useState(() => readSyncedEvm(project));
  useEffect(() => { setStore(readSyncedEvm(project)); }, [project.id]);

  const snap = useMemo(() => snapshot(project, store), [project, store]);
  const { bac, m, period, points, baseline } = snap;

  const cvr = useMemo(() => {
    const ca = computeBac(project, store.settings);
    const contractAmount = ca.bac;
    const plannedProfit = contractAmount - bac;
    const expectedProfit = contractAmount - m.eac;
    const plannedMarginPct = contractAmount > 0 ? plannedProfit / contractAmount : 0;
    const expectedMarginPct = contractAmount > 0 ? expectedProfit / contractAmount : 0;
    /* Unapproved change orders: money on the table, NOT in the margin. */
    let pendingCos = 0;
    try {
      const co: unknown = JSON.parse(localStorage.getItem(`pactum-co-${project.id}`) || '[]');
      if (Array.isArray(co)) {
        pendingCos = co
          .filter((r: any) => r?.status && r.status !== 'approved')
          .reduce((a: number, r: any) => a + (Number(r.value) || 0), 0);
      }
    } catch { /* register absent — nothing pending */ }
    /* ── THE DIRECT BASIS (owner rule) ─────────────────────────────
     * %Progress        = EV(t) DIRECT ÷ BAC DIRECT
     * %Progress Planned = PV(t) DIRECT ÷ BAC DIRECT
     * EVM is measured on direct cost — so is the CVR progress. The direct
     * half of a period is (total − indirect) where the split was recorded;
     * BAC direct comes from the approved Baseline Package. When either is
     * missing the tab does NOT fake the direct basis: it falls back to
     * totals and says so, because a wrong denominator is worse than a
     * stated approximation. */
    const split = computeBacSplit(project, store.settings);
    const bD = split.available ? split.directBac : null;
    const periods = store.periods;
    const aligned = periods.length === points.length;
    const directOf = (idx: number, total: number | null, field: 'indirectPv' | 'indirectEv'): number | null => {
      if (!aligned) return null;
      const per = periods[idx];
      const ind = per ? per[field] : undefined;
      if (ind === undefined || total === null) return null;
      return total - ind;
    };
    const preRows = points.map((p, idx) => {
      /* series() nulls EV on periods with no actuals — they stay '—' here. */
      const ev = p.ev as number | null;
      const pvD = directOf(idx, p.pv, 'indirectPv');
      const evD = ev === null ? null : directOf(idx, ev, 'indirectEv');
      return { p, ev, pvD, evD };
    });
    /* One basis for the whole curve, never a mix. Direct is used only when
     * BAC direct exists AND every plotted period carries the split. */
    const useDirect = bD !== null && bD > 0
      && preRows.every(r => r.pvD !== null)
      && preRows.filter(r => r.ev !== null).every(r => r.evD !== null);
    const denom = useDirect ? (bD as number) : bac;
    const rows = preRows.map(({ p, ev, pvD, evD }) => {
      const pvShown = useDirect ? (pvD as number) : p.pv;
      const evShown = useDirect && evD !== null ? evD : ev;
      const pctPlanned = denom > 0 ? pvShown / denom : null;
      const pctProgress = evShown === null || denom <= 0 ? null : evShown / denom;
      return {
        label: p.label, seq: p.seq, status: p.status, approved: p.approved,
        pv: pvShown, ev: evShown,
        pctPlanned,
        pctProgress,
        plannedCvr: pctPlanned === null ? null : pctPlanned * plannedProfit,
        cvr: pctProgress === null ? null : pctProgress * plannedProfit,
      };
    });
    const basisNote = useDirect
      ? (isRtl
          ? `الأساس: مباشر — EV المباشر ÷ BAC المباشر (${fmtShort(denom)})`
          : `Basis: DIRECT — direct EV ÷ direct BAC (${fmtShort(denom)})`)
      : (isRtl
          ? 'الأساس: إجمالي مؤقتًا — يتطلب موازنة معتمدة (باك بفصل الفئات) وفترات مفصولة مباشر/غير مباشر'
          : 'Basis: TOTAL for now — needs an approved package (split BAC) and periods carrying the direct/indirect split');
    return {
      contractAmount, approvedCos: ca.cos, settledClaims: ca.claims, pendingCos,
      plannedProfit, expectedProfit, plannedMarginPct, expectedMarginPct,
      /* expected − planned = BAC − EAC = VAC, to the riyal. */
      profitDelta: expectedProfit - plannedProfit,
      marginUndefined: !baseline && Math.abs(bac - contractAmount) < 0.5,
      useDirect, basisNote,
      rows,
    };
  }, [project, store, store.settings, bac, m.eac, points, baseline]);

  return (
    <div className="space-y-4">
      {/* Header + the export the owner asked for */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Scale className="w-5 h-5 text-primary" />
          <div>
            <h2 className="sec-head !mb-0">CVR</h2>
            <p className="text-(length:--t-second) text-muted-foreground">
              {isRtl ? 'تسوية القيمة والتكلفة — منظور الهامش' : 'Cost Value Reconciliation — the margin view'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn('badge whitespace-nowrap', cvr.useDirect ? 'badge-ok' : 'badge-warn')}>
            {cvr.basisNote}
          </span>
          <ReportButton
            reportId="cvr"
            context={{ project, cvr, reportCurrency: ccy }}
            label={isRtl ? 'تصدير' : 'Export'}
            variant="primary"
          />
        </div>
      </div>

      {/* Four cards: two frozen with the baseline, two breathing with the EAC */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="ds-card ds-card-raised">
          <div className="flex items-center justify-between mb-2">
            <h3 className="sec-head !mb-0">{isRtl ? 'نسبة هامش الربح المخطط' : 'Planned Profit Margin'}</h3>
            <Scale className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="font-mono text-2xl font-semibold number-ltr text-primary">
            {formatPercent(cvr.plannedMarginPct)}
          </div>
          <p className="text-(length:--t-second) text-muted-foreground mt-2">
            {isRtl ? 'ثابتة — لا تتغير إلا مع الـ Baseline' : 'Fixed — changes only with the baseline'}
          </p>
        </div>
        <div className="ds-card ds-card-raised">
          <div className="flex items-center justify-between mb-2">
            <h3 className="sec-head !mb-0">{isRtl ? 'قيمة الربح المخططة' : 'Planned Profit Value'}</h3>
            <Scale className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="font-mono text-2xl font-semibold number-ltr text-primary">
            {formatMoney(cvr.plannedProfit, { currency: ccy })}
          </div>
          <p className="font-mono text-(length:--t-second) text-muted-foreground mt-2 number-ltr">CA − BAC</p>
        </div>
        <div className="ds-card ds-card-raised">
          <div className="flex items-center justify-between mb-2">
            <h3 className="sec-head !mb-0">{isRtl ? 'هامش الربح المتوقع' : 'Expected Profit Margin'}</h3>
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className={cn('font-mono text-2xl font-semibold number-ltr',
                             cvr.expectedProfit >= 0 ? 'text-chart-4' : 'text-chart-3')}>
            {formatPercent(cvr.expectedMarginPct)}
          </div>
          <p className="text-(length:--t-second) text-muted-foreground mt-2">
            {isRtl ? 'CA − EAC · يتحرك مع كل مدة معتمدة' : 'CA − EAC · moves with every approved period'}
          </p>
        </div>
        <div className="ds-card ds-card-raised">
          <div className="flex items-center justify-between mb-2">
            <h3 className="sec-head !mb-0">{isRtl ? 'قيمة الربح المتوقعة' : 'Expected Profit Value'}</h3>
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className={cn('font-mono text-2xl font-semibold number-ltr',
                             cvr.expectedProfit >= 0 ? 'text-chart-4' : 'text-chart-3')}>
            {formatMoney(cvr.expectedProfit, { currency: ccy })}
          </div>
          <p className="text-(length:--t-second) text-muted-foreground mt-2 number-ltr">
            <span className={cn('font-mono', varianceTone(cvr.profitDelta))}>
              Δ {formatMoney(cvr.profitDelta, { currency: ccy })}
            </span>
            {' '}= VAC
          </p>
        </div>
      </div>

      {/* CA anatomy + the approval rule, stated in the open */}
      <div className="ds-card ds-card-raised">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="sec-head !mb-0">{isRtl ? 'مكونات قيمة العقد (CA)' : 'Contract Amount (CA) Anatomy'}</h3>
          <span className="font-mono text-lg text-primary number-ltr">
            {formatMoney(cvr.contractAmount, { currency: ccy })}
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          {[
            { k: isRtl ? 'قيمة العقد' : 'Contract Value', v: cvr.contractAmount - cvr.approvedCos - cvr.settledClaims, c: 'text-white' },
            { k: isRtl ? 'أوامل معتمدة' : 'Approved COs', v: cvr.approvedCos, c: 'text-chart-4' },
            { k: isRtl ? 'مطالبات مسوّاة' : 'Settled Claims', v: cvr.settledClaims, c: 'text-chart-4' },
            { k: isRtl ? 'أوامل غير معتمدة (مستبعدة)' : 'Unapproved COs (excluded)', v: cvr.pendingCos, c: 'text-muted-foreground' },
          ].map(x => (
            <div key={x.k}>
              <div className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">{x.k}</div>
              <div className={cn('font-mono text-sm font-semibold number-ltr mt-1', x.c)}>
                {formatMoney(x.v, { currency: ccy })}
              </div>
            </div>
          ))}
        </div>
        <p className="text-(length:--t-second) text-muted-foreground italic mt-3">
          {isRtl
            ? 'المعتمد فقط يدخل الهامش — أول ما يُعتمد أمر يدخل تلقائيًا، من غير أي ربط يدوي. BAC يتحرك بنفس القيمة فيبقى الهامش المخطط ثابتًا معه.'
            : 'Only approved value enters the margin — the moment an order is approved it links itself, no manual wiring. BAC moves by the same amount, keeping the planned margin frozen.'}
        </p>
        {cvr.marginUndefined && (
          <p className="text-(length:--t-body) text-chart-5 mt-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {isRtl
              ? 'لا توجد موازنة معتمدة ولا Baseline — BAC ساقط على قيمة العقد، فالهامش المخطط صفر. سجّل Baseline (تبويب خطوط الأساس) ليصبح للهامش معنى.'
              : 'No approved budget and no baseline — BAC fell back to the contract value, so the planned margin is zero. Register a baseline (Baselines tab) for the margin to mean anything.'}
          </p>
        )}
      </div>

      {/* The two curves — planned margin vs earned margin, converging on CA − BAC */}
      <div className="ds-card ds-card-raised">
        <h3 className="sec-head">{isRtl ? 'منحنى الهامش — مخطط مقابل مكتسب' : 'Margin Curve — Planned vs Earned CVR'}</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={cvr.rows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis {...AXIS} tickFormatter={shortMoney} />
            <Tooltip contentStyle={TT_STYLE} labelStyle={TT_LABEL} itemStyle={TT_ITEM} cursor={TT_CURSOR}
                     formatter={(v: any) => v === null ? '—' : formatMoney(Number(v), { currency: ccy })} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="rgba(212,175,55,0.4)" strokeDasharray="4 4" />
            {cvr.plannedProfit !== 0 && (
              <ReferenceLine y={cvr.plannedProfit} stroke={C_EV} strokeDasharray="4 4"
                             label={{ value: 'CA − BAC', fill: C_EV, fontSize: 10, position: 'insideTopRight' }} />
            )}
            <Line type="monotone" dataKey="plannedCvr" name={isRtl ? 'CVR مخطط' : 'Planned CVR'}
                  stroke={C_PV} strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="cvr" name="CVR"
                  stroke={C_EV} strokeWidth={2} dot={false} connectNulls={false} />
            {period && (
              <ReferenceLine x={period.label} stroke="rgba(212,175,55,0.5)" strokeDasharray="3 3"
                             label={{ value: isRtl ? 'الآن' : 'NOW', fill: '#d4af37', fontSize: 9, position: 'top' }} />
            )}
            <Brush dataKey="label" height={22} stroke="rgba(212,175,55,0.4)"
                   fill="rgba(0,0,0,0.3)" travellerWidth={8} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* The monthly reconciliation table — same equations, every period */}
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead>
            <tr>
              <th className="col-pin">{isRtl ? 'الفترة' : 'Period'}</th>
              <th className="money">{cvr.useDirect ? (isRtl ? 'PV مباشر' : 'PV direct') : 'PV'}</th>
              <th className="money">{isRtl ? '% مخطط' : '% Planned'}</th>
              <th className="money">{isRtl ? 'CVR مخطط' : 'Planned CVR'}</th>
              <th className="money">{cvr.useDirect ? (isRtl ? 'EV مباشر' : 'EV direct') : 'EV'}</th>
              <th className="money">{isRtl ? '% منجز' : '% Earned'}</th>
              <th className="money">CVR</th>
              <th className="money">Δ</th>
              <th>{isRtl ? 'الحالة' : 'Status'}</th>
            </tr>
          </thead>
          <tbody>
            {cvr.rows.map(r => {
              const delta = r.cvr !== null ? r.cvr - (r.plannedCvr ?? 0) : null;
              return (
                <tr key={r.seq} className={cn(!r.approved && 'opacity-60')}>
                  <td className="col-pin font-mono text-primary">{r.label}</td>
                  <td className="money">{formatMoney(r.pv, { currency: ccy })}</td>
                  <td className="money">{formatPercent(r.pctPlanned)}</td>
                  <td className="money">{r.plannedCvr === null ? '—' : formatMoney(r.plannedCvr, { currency: ccy })}</td>
                  <td className="money">{r.ev === null ? '—' : formatMoney(r.ev, { currency: ccy })}</td>
                  <td className="money">{formatPercent(r.pctProgress)}</td>
                  <td className={cn('money', r.cvr !== null && r.cvr < 0 && 'text-chart-3')}>
                    {r.cvr === null ? '—' : formatMoney(r.cvr, { currency: ccy })}
                  </td>
                  <td className={cn('money', delta !== null ? varianceTone(delta) : '')}>
                    {delta === null ? '—' : formatMoney(delta, { currency: ccy })}
                  </td>
                  <td>
                    <span className={cn('badge', STATUS_META[r.status].tone)}>
                      {isRtl ? STATUS_META[r.status].ar : STATUS_META[r.status].en}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The equations, in the open, exactly as agreed */}
      <p className="text-(length:--t-second) text-muted-foreground italic">
        {isRtl
          ? 'Planned CVR = (%مخطط) × (CA − BAC) · CVR = (%منجز) × (CA − BAC) · %مخطط = PV المباشر ÷ BAC المباشر · %منجز = EV المباشر ÷ BAC المباشر · الربح المتوقع = CA − EAC · عند 100% يُقفل المنحنيان على CA − BAC'
          : 'Planned CVR = (%planned) × (CA − BAC) · CVR = (%earned) × (CA − BAC) · %planned = direct PV ÷ direct BAC · %earned = direct EV ÷ direct BAC · Expected profit = CA − EAC · At 100% both curves close on CA − BAC'}
      </p>
    </div>
  );
}
