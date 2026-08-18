import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRoute } from 'wouter';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell,
  ComposedChart, Area,
} from 'recharts';
import {
  RefreshCw, Pencil, RotateCcw, TrendingUp, TrendingDown,
  CheckCircle2, AlertTriangle, Clock, Minus, ChevronUp,
  ChevronDown, AlertCircle, BarChart2, Layers, DollarSign,
  Activity, FileText, Users, Zap, Shield,
} from 'lucide-react';
import { useProjects } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';
import ContextBar from '../components/ContextBar';
import { findCompanyById } from '../mock/companies';
import { findSectorById } from '../mock/sectors';
import {
  computePortfolioMetrics,
  readOverrides,
  saveOverride,
  clearOverride,
  clearAllOverrides,
  PortfolioMetrics,
  OverrideMap,
} from '../lib/portfolio';
// PHASE 3F-UX Task 2 — live master data: re-renders on any registry write.
import { useSector, useCompany } from '../lib/useMasterData';
// The unit this tier reports in — one rate book, per-tier display target.
import { scopeCurrency } from '../lib/currencyArchitecture';

// ── Palette ────────────────────────────────────────────────────────────
const GOLD    = '#D4AF5A';
/** STEP 13 — the colour of "not measurable". No verdict, no alarm. */
const WHITE_DIM = 'rgba(255,255,255,0.4)';
const GOLD2   = '#D4A853';
const GREEN   = '#7EA486';
const RED     = '#B25450';
const BLUE    = '#60a5fa';
const PURPLE  = '#a78bfa';
const PIE_COLORS = [GOLD, GREEN, RED, BLUE, PURPLE, '#C98A3D', '#38bdf8'];

// ── Chart defaults ─────────────────────────────────────────────────────
const CHART_STYLE = { background: 'transparent' };
const AXIS_PROPS  = { tick: { fill: 'rgba(255,255,255,0.3)', fontSize: 10 }, axisLine: false, tickLine: false };
const GRID_PROPS  = { stroke: 'rgba(255,255,255,0.04)', strokeDasharray: '3 3' };
const TT_STYLE    = {
  background: '#161514', border: '1px solid rgba(179,138,61,0.3)',
  borderRadius: 0, color: 'rgba(255,255,255,0.8)', fontSize: 11,
};

// ── Utility helpers ────────────────────────────────────────────────────
function fmtN(n: number, compact = true): string {
  if (!isFinite(n) || isNaN(n)) return '—';
  if (compact) {
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return n.toFixed(0);
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
/**
 * A labelled, abbreviated amount.
 *
 * The currency is a parameter rather than a literal. This function sits at
 * module scope, outside the component, so it cannot read the company's
 * reporting currency itself — the caller must pass it. The default keeps
 * every existing call rendering exactly as before, and the call sites that
 * still need a real currency are listed in the cleanup report.
 */
function fmtSAR(n: number, currency = 'SAR'): string {
  if (!isFinite(n) || isNaN(n)) return '—';
  return currency + ' ' + fmtN(n, true);
}
function fmtPct(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '—';
  return n.toFixed(1) + '%';
}
/**
 * STEP 13 — null means the index could not be computed (no approved
 * baseline, no EVM entered). It renders as a dash, never as 1.00.
 */
function fmtIdx(n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (!isFinite(n) || isNaN(n)) return '—';
  return n.toFixed(3);
}

// ── Source badge ───────────────────────────────────────────────────────
function SourceBadge({ source }: { source: 'auto' | 'override' | 'pending' }) {
  if (source === 'auto')
    return (
      <span className="flex items-center gap-1 text-(length:--t-label) uppercase tracking-wider text-emerald-400/70">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 inline-block" />
        Auto
      </span>
    );
  if (source === 'override')
    return (
      <span className="flex items-center gap-1 text-(length:--t-label) uppercase tracking-wider text-amber-400/80">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80 inline-block" />
        Manual Override Active
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-(length:--t-label) uppercase tracking-wider text-white/45">
      <span className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block" />
      Pending Sync
    </span>
  );
}

// ── Overridable metric card ────────────────────────────────────────────
interface MetricCardProps {
  label: string; labelAr?: string;
  value: string; rawValue: number;
  metricKey: string;
  icon?: React.ElementType;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
  highlight?: 'gold' | 'green' | 'red' | 'neutral';
  overrides: OverrideMap;
  lang: string;
  onSaveOverride: (key: string, val: number) => void;
  onClearOverride: (key: string) => void;
}

function MetricCard({
  label, labelAr, value, rawValue, metricKey, icon: Icon,
  sub, trend, trendLabel, highlight = 'neutral',
  overrides, lang, onSaveOverride, onClearOverride,
}: MetricCardProps) {
  const [editing, setEditing]   = useState(false);
  const [draft,   setDraft]     = useState('');
  const isOverride = metricKey in overrides;
  const displayVal = isOverride ? fmtN(overrides[metricKey]) : value;
  const source: 'auto' | 'override' = isOverride ? 'override' : 'auto';

  const startEdit = () => { setDraft(String(isOverride ? overrides[metricKey] : rawValue)); setEditing(true); };
  const saveEdit  = () => {
    const n = parseFloat(draft);
    if (!isNaN(n)) onSaveOverride(metricKey, n);
    setEditing(false);
  };
  const restore = () => { onClearOverride(metricKey); setEditing(false); };

  const borderCls = highlight === 'gold'    ? 'border-primary/20 hover:border-primary/40'
                  : highlight === 'green'   ? 'border-emerald-500/20 hover:border-emerald-500/40'
                  : highlight === 'red'     ? 'border-red-500/20 hover:border-red-500/40'
                  :                          'border-white/[0.06] hover:border-white/[0.12]';

  const valueCls = highlight === 'gold'  ? 'text-primary'
                 : highlight === 'green' ? 'text-emerald-400'
                 : highlight === 'red'   ? 'text-red-400'
                 :                        'text-white';

  return (
    <div className={cn('relative border bg-black/15 p-4 transition-colors group', borderCls, isOverride && 'ring-1 ring-amber-400/20')}>
      {/* Top row */}
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" aria-hidden="true" />}
          <span className="text-(length:--t-label) uppercase tracking-wider text-white/45 leading-tight">
            {lang === 'ar' && labelAr ? labelAr : label}
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isOverride && (
            <button onClick={restore} title="Restore automatic" className="p-0.5 text-white/30 hover:text-amber-400 transition-colors" aria-label="Restore automatic">
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
          <button onClick={startEdit} title="Manual override" className="p-0.5 text-white/30 hover:text-primary transition-colors" aria-label="Manual override">
            <Pencil className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Value */}
      {editing ? (
        <div className="flex items-center gap-2 mb-2">
          <input
            autoFocus
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
            className="flex-1 bg-black/40 border border-primary/40 px-2 py-1 text-sm text-white font-mono focus:outline-none min-w-0"
          />
          <button onClick={saveEdit} className="text-(length:--t-micro) px-2 py-1 bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors whitespace-nowrap">
            Save
          </button>
          <button onClick={() => setEditing(false)} className="text-(length:--t-micro) px-2 py-1 text-white/45 border border-white/10 hover:text-white hover:border-white/20 transition-colors">
            ✕
          </button>
        </div>
      ) : (
        <p className={cn('text-2xl font-serif font-bold leading-none mb-2', valueCls)}>
          {displayVal}
        </p>
      )}

      {/* Sub / trend */}
      {sub && !editing && (
        <p className="text-(length:--t-body) text-white/30 leading-tight mb-2">{sub}</p>
      )}
      {trend && trendLabel && (
        <div className={cn('flex items-center gap-1 text-(length:--t-second)',
          trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-white/30')}>
          {trend === 'up'   ? <ChevronUp   className="w-3 h-3" /> :
           trend === 'down' ? <ChevronDown className="w-3 h-3" /> :
                              <Minus       className="w-3 h-3" />}
          {trendLabel}
        </div>
      )}

      {/* Source badge */}
      <div className="mt-2">
        <SourceBadge source={source} />
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────
function SH({ en, ar, lang, icon: Icon }: { en: string; ar: string; lang: string; icon?: React.ElementType }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      {Icon && <Icon className="w-4 h-4 text-primary/60" aria-hidden="true" />}
      <div className="h-px w-6 bg-primary/60" aria-hidden="true" />
      <h2 className="font-serif text-xl text-white whitespace-nowrap">{lang === 'ar' ? ar : en}</h2>
      <div className="h-px flex-1 bg-white/[0.04]" aria-hidden="true" />
    </div>
  );
}

// ── Gold divider ────────────────────────────────────────────────────────
function GD() {
  return (
    <div className="flex items-center gap-3 my-10" aria-hidden="true">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-primary/20" />
      <div className="w-1.5 h-1.5 bg-primary/50 rotate-45" />
      <div className="w-1 h-1 bg-primary/30 rotate-45" />
      <div className="w-1.5 h-1.5 bg-primary/50 rotate-45" />
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-primary/20" />
    </div>
  );
}

// ── Risk rating badge ───────────────────────────────────────────────────
function RiskRating({ rating }: { rating: string }) {
  const cfg = {
    Low:      { cls: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10', icon: CheckCircle2 },
    Medium:   { cls: 'border-amber-500/40 text-amber-400 bg-amber-500/10',       icon: AlertTriangle },
    High:     { cls: 'border-orange-500/40 text-orange-400 bg-orange-500/10',    icon: AlertCircle },
    Critical: { cls: 'border-red-500/40 text-red-400 bg-red-500/10',             icon: AlertCircle },
  }[rating] ?? { cls: 'border-white/10 text-white/40 bg-white/5', icon: Minus };
  const Icon = cfg.icon;
  return (
    <span className={cn('flex items-center gap-1.5 text-xs px-3 py-1 border font-medium', cfg.cls)}>
      <Icon className="w-3.5 h-3.5" />
      {rating}
    </span>
  );
}

// ── Health score arc ────────────────────────────────────────────────────
function HealthArc({ score }: { score: number }) {
  const r = 38, cx = 50, cy = 54;
  const circ = Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? '#4ade80' : score >= 60 ? GOLD : score >= 40 ? '#fb923c' : '#f87171';
  return (
    <svg viewBox="0 0 100 60" className="w-full max-w-[140px]" aria-label={`Sector health score: ${score}`}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="butt" />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="20" fontWeight="700" fontFamily="serif">{score}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="7" letterSpacing="1">/ 100</text>
    </svg>
  );
}

// ── Custom tooltip ──────────────────────────────────────────────────────
/**
 * `ccy` — the tier's currency, passed in by the chart that renders this.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE LAST HARDCODED UNIT ON THIS PAGE.
 *
 * The KPI tiles were corrected to read the tier currency, but this
 * tooltip sits OUTSIDE the component and so could not see the hook. It
 * kept calling `fmtSAR(value)` with no argument, meaning every figure a
 * user hovered on a chart was labelled "SAR" — on the very page whose
 * headline figures now correctly read EUR or AED.
 *
 * It is a prop rather than a module-level variable because this function
 * is shared by three charts and must state the unit of whichever page
 * mounted it, never a remembered one.
 * ══════════════════════════════════════════════════════════════════════
 */
function ChartTooltip({ active, payload, label, ccy }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TT_STYLE} className="px-3 py-2 shadow-xl">
      <p className="text-(length:--t-label) uppercase tracking-wider text-white/50 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? fmtSAR(p.value, ccy) : p.value}
        </p>
      ))}
    </div>
  );
}

function IndexTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TT_STYLE} className="px-3 py-2 shadow-xl">
      <p className="text-(length:--t-label) uppercase tracking-wider text-white/50 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(3) : p.value}
        </p>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Sector Analytics — executive analytics for a SINGLE sector
//
//   Projects  ->  Sector Analytics
//
// Route: /sector/:id/analytics
// ══════════════════════════════════════════════════════════════════════
export default function SectorAnalytics() {
  const { projects }         = useProjects();
  const { lang }             = useTranslation();
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [metrics,   setMetrics]   = useState<PortfolioMetrics | null>(null);
  const [lastSync,  setLastSync]  = useState<Date | null>(null);
  const [syncing,   setSyncing]   = useState(false);
  const [pending,   setPending]   = useState(false);
  const [sortCol,   setSortCol]   = useState<string>('contractValue');
  const [sortAsc,   setSortAsc]   = useState(false);

  // ── Sector scoping ───────────────────────────────────────────────────
  const [, params] = useRoute('/sector/:id/analytics');
  const sectorId = params?.id;
  const sector = useSector(sectorId);
  const company = useCompany(sector?.companyId);

  /**
   * THE UNIT THIS PAGE REPORTS IN — the SECTOR's own currency.
   *
   * ══════════════════════════════════════════════════════════════════
   * Measured before this change: 22 of the 23 `fmtSAR()` calls on this
   * page passed no currency and fell through to the literal 'SAR'
   * default, printing "SAR" over figures that were neither riyals nor
   * any single currency — `computePortfolioMetrics` was summing each
   * project's raw contract value without converting.
   *
   * `scopeCurrency` answers what the tier reports in and, crucially,
   * says whether that was a STATED decision (`set`) or an inherited
   * provisional value on a sector created before the field existed.
   * ══════════════════════════════════════════════════════════════════
   */
  const scopeCcy = useMemo(
    () => scopeCurrency('sector', sectorId ?? '', { companyId: sector?.companyId }),
    [sectorId, sector?.companyId],
  );
  const pageCcy = scopeCcy.currency;
  /** Every money label on this page, in the sector's unit. */
  const money = useCallback((n: number) => fmtSAR(n, pageCcy), [pageCcy]);

  // Roll up from this sector's projects only
  const scopedProjects = React.useMemo(() => {
    if (!sector) return [];
    return projects.filter(p => sector.projectIds.includes(p.id));
  }, [projects, sector]);

  // Load overrides from localStorage
  useEffect(() => { setOverrides(readOverrides()); }, []);

  // Compute metrics
  const calculate = useCallback(() => {
    setSyncing(true);
    setTimeout(() => {
      const ov = readOverrides();
      setOverrides(ov);
      const computed = computePortfolioMetrics(
        scopedProjects,
        ov['wacc'] ? ov['wacc'] / 100 : undefined,
        // Convert every project into the SECTOR's currency before summing.
        { targetCurrency: pageCcy, companyId: sector?.companyId },
      );
      // Apply any numeric overrides to the metrics object
      const patched: any = { ...computed };
      for (const [k, v] of Object.entries(ov)) {
        if (k in patched && typeof patched[k] === 'number') patched[k] = v;
      }
      setMetrics(patched as PortfolioMetrics);
      setLastSync(new Date());
      setSyncing(false);
      setPending(false);
    }, 300);
  }, [scopedProjects, pageCcy, sector?.companyId]);

  // Initial calculation
  useEffect(() => { calculate(); }, [calculate]);

  // Mark pending when projects change after initial load
  useEffect(() => {
    if (lastSync) setPending(true);
  }, [scopedProjects.length]); // eslint-disable-line

  const handleSaveOverride = (key: string, val: number) => {
    saveOverride(key, val);
    setOverrides(readOverrides());
    setPending(true);
  };

  const handleClearOverride = (key: string) => {
    clearOverride(key);
    setOverrides(readOverrides());
    setPending(true);
  };

  const handleClearAll = () => {
    clearAllOverrides();
    setOverrides({});
    setPending(true);
  };

  const overrideCount = Object.keys(overrides).length;

  // Sort project performance table
  const sortedProjects = metrics
    ? [...metrics.projectPerformance].sort((a: any, b: any) => {
        const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
        return sortAsc ? av - bv : bv - av;
      })
    : [];

  if (sectorId && !sector) {
    return (
      <div className="pg pg-stack">
        <div className="ds-empty">
          <div className="w-16 h-16 border border-white/10 rotate-45 mx-auto mb-6 flex items-center justify-center">
            <Clock className="w-8 h-8 text-muted-foreground -rotate-45" />
          </div>
          <p className="font-serif text-xl text-muted-foreground mb-2">
            {lang === 'ar' ? 'القطاع غير موجود' : 'Sector Not Found'}
          </p>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-full min-h-64">
        <div className="text-white/30 text-sm font-mono animate-pulse">
          {lang === 'ar' ? 'جاري التحليل...' : 'Computing sector metrics…'}
        </div>
      </div>
    );
  }

  const m = metrics;

  // KPI card props helper
  const mk = (
    label: string, labelAr: string,
    value: string, rawValue: number,
    metricKey: string,
    opts: Partial<Omit<MetricCardProps, 'label' | 'labelAr' | 'value' | 'rawValue' | 'metricKey' | 'overrides' | 'lang' | 'onSaveOverride' | 'onClearOverride'>> = {}
  ): MetricCardProps => ({
    label, labelAr, value, rawValue, metricKey,
    overrides, lang, onSaveOverride: handleSaveOverride, onClearOverride: handleClearOverride,
    ...opts,
  });

  return (
    <div className="min-h-full w-full" dir={lang === 'ar' ? 'rtl' : 'ltr'}>

      {/* ── CONTEXT NAVIGATION BAR ────────────────────────────── */}
      {sector && (
        <ContextBar
          items={[
            { label: 'Enterprise Portfolio', href: '/enterprise-portfolio' },
            ...(company ? [{ label: company.name, href: `/company/${company.id}` }] : []),
            { label: sector.name, href: `/sector/${sector.id}` },
            { label: lang === 'ar' ? 'التحليلات' : 'Analytics' },
          ]}
        />
      )}


      {/* ── CURRENCY DISCLOSURE ──────────────────────────────────
          A total that silently omits projects is worse than no total:
          the reader has no way to know it is partial. Both facts are
          stated — the unit, and anything excluded from it. */}
      {metrics && (metrics.unconvertible?.length > 0 || !scopeCcy.set) && (
        <div className="px-6 md:px-12 pt-4 space-y-2">
          {!scopeCcy.set && (
            <div className="ds-card border-chart-5/30 bg-chart-5/[0.05] !py-3">
              <p className="text-(length:--t-second) text-chart-5">
                {lang === 'ar'
                  ? `لم تُحدَّد عملة تقارير لهذا القطاع — يُعرض مؤقتاً بعملة الشركة (${pageCcy}). حدّدها من إعدادات القطاع.`
                  : `No reporting currency is set for this sector. Showing the company's (${pageCcy}) provisionally — set it explicitly to make this a stated decision.`}
              </p>
            </div>
          )}
          {metrics.unconvertible?.length > 0 && (
            <div className="ds-card border-chart-3/30 bg-chart-3/[0.05] !py-3">
              <p className="text-(length:--t-second) text-chart-3">
                {lang === 'ar'
                  ? `${metrics.unconvertible.length} مشروع مستبعد من كل الإجماليات أدناه لعدم وجود سعر صرف منشور إلى ${pageCcy}: ${metrics.unconvertible.map((u: any) => `${u.name} (${u.currency})`).join(' · ')}. الأرقام أدناه جزئية.`
                  : `${metrics.unconvertible.length} project(s) are EXCLUDED from every total below — no published rate to ${pageCcy}: ${metrics.unconvertible.map((u: any) => `${u.name} (${u.currency})`).join(' · ')}. The figures below are partial.`}
              </p>
            </div>
          )}
        </div>
      )}
      {/* ── Page hero ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-black/20 border-b border-white/5 px-6 md:px-12 py-8">
        <div className="absolute inset-0 opacity-[0.025] pointer-events-none"
          style={{ backgroundImage: 'linear-gradient(rgba(179,138,61,1) 1px,transparent 1px),linear-gradient(90deg,rgba(179,138,61,1) 1px,transparent 1px)', backgroundSize: '32px 32px' }}
          aria-hidden="true" />
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" aria-hidden="true" />
        <div className="relative z-10 w-full flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-px w-8 bg-primary/60" aria-hidden="true" />
              <span className="text-(length:--t-label) uppercase tracking-[0.3em] text-primary/60 font-mono">
                {company ? company.name : (lang === 'ar' ? 'تحليلات القطاع' : 'Sector Analytics')}
              </span>
            </div>
            <h1 className="font-serif text-3xl md:text-4xl text-white mb-1">
              {sector ? sector.name : (lang === 'ar' ? 'تحليلات القطاع' : 'Sector Analytics')}
            </h1>
            <p className="text-sm text-white/35">
              {lang === 'ar'
                ? `تحليلات تنفيذية — ${m.totalProjects} مشروع`
                : `Executive analytics — ${m.totalProjects} project${m.totalProjects !== 1 ? 's' : ''}`}
            </p>
          </div>

          {/* Sync bar */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Status pill */}
            <div className={cn(
              'flex items-center gap-2 text-(length:--t-label) uppercase tracking-wider px-3 py-1.5 border',
              pending ? 'border-white/10 text-white/30' : 'border-emerald-500/30 text-emerald-400/80'
            )}>
              {pending
                ? <><span className="w-1.5 h-1.5 rounded-full bg-white/30" /> {lang === 'ar' ? 'بانتظار المزامنة' : 'Pending Sync'}</>
                : <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" /> {lang === 'ar' ? 'محدّث' : 'Synced'}</>}
            </div>
            {lastSync && (
              <span className="text-(length:--t-data) text-white/45 font-mono">
                {lang === 'ar' ? 'آخر تحديث' : 'Last sync'}: {lastSync.toLocaleTimeString()}
              </span>
            )}
            {overrideCount > 0 && (
              <button onClick={handleClearAll}
                className="text-(length:--t-label) uppercase tracking-wider text-amber-400/60 border border-amber-400/20 px-3 py-1.5 hover:bg-amber-400/5 transition-colors">
                {lang === 'ar' ? `مسح ${overrideCount} تجاوز` : `Clear ${overrideCount} Override${overrideCount !== 1 ? 's' : ''}`}
              </button>
            )}
            <button
              onClick={calculate}
              disabled={syncing}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-black text-xs font-bold uppercase tracking-widest hover:bg-primary/90 active:scale-[0.97] transition-all disabled:opacity-60"
              aria-label={lang === 'ar' ? 'حساب تلقائي' : 'Auto Calculate'}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} aria-hidden="true" />
              {lang === 'ar' ? 'حساب تلقائي' : 'Auto Calculate'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="w-full px-6 xl:px-8 2xl:px-10 pb-24 pt-10 space-y-14">

        {/* ════ Executive KPIs ═════════════════════════════════ */}
        <section aria-label={lang === 'ar' ? 'مؤشرات الأداء التنفيذية' : 'Executive KPIs'}>
          <SH en="Executive KPIs" ar="مؤشرات الأداء التنفيذية" lang={lang} icon={Activity} />

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-white/[0.04] mb-4">
            {[
              mk('Total Sector Value',       'إجمالي قيمة القطاع',     money(m.totalRevisedContractValue), m.totalRevisedContractValue, 'totalRevisedContractValue', { icon: DollarSign, highlight: 'gold', sub: money(m.totalContractValue) + ' original' }),
              mk('Total Projects',           'إجمالي المشاريع',        String(m.totalProjects),              m.totalProjects,              'totalProjects',              { icon: Layers }),
              mk('Active Projects',          'المشاريع النشطة',         String(m.activeProjects),             m.activeProjects,             'activeProjects',             { highlight: m.activeProjects > 0 ? 'gold' : 'neutral' }),
              mk('Completed Projects',       'المشاريع المكتملة',       String(m.completedProjects),          m.completedProjects,          'completedProjects',          { highlight: m.completedProjects > 0 ? 'green' : 'neutral' }),
              mk('Delayed Projects',         'المشاريع المتأخرة',       String(m.delayedProjects),            m.delayedProjects,            'delayedProjects',            { highlight: m.delayedProjects > 0 ? 'red' : 'neutral' }),
              mk('Sector Progress',          'تقدم القطاع',             fmtPct(m.portfolioProgress),          m.portfolioProgress,          'portfolioProgress',          { icon: TrendingUp }),
              mk('Average Delay',            'متوسط التأخير',           `${m.averageDelay.toFixed(1)} days`,  m.averageDelay,               'averageDelay',               { highlight: m.averageDelay > 30 ? 'red' : m.averageDelay > 0 ? 'gold' : 'green' }),
              mk('Claims Success Rate',      'معدل نجاح المطالبات',     fmtPct(m.claimsSuccessRate),          m.claimsSuccessRate,          'claimsSuccessRate',          { highlight: m.claimsSuccessRate >= 70 ? 'green' : 'gold' }),
              mk('Total Cash In',            'إجمالي الإيرادات',        money(m.totalCashIn),               m.totalCashIn,                'totalCashIn',                { highlight: 'green' }),
              mk('Total Cash Out',           'إجمالي المصروفات',        money(m.totalCashOut),              m.totalCashOut,               'totalCashOut',               { highlight: 'red' }),
              mk('Net Cash Flow',            'صافي التدفق النقدي',      money(m.totalNetCashFlow),          m.totalNetCashFlow,           'totalNetCashFlow',           { highlight: m.totalNetCashFlow >= 0 ? 'gold' : 'red' }),
              mk('Owner Receivables',        'مستحقات الملاك',          money(m.totalContractValue - m.totalCashIn), m.totalContractValue - m.totalCashIn, 'ownerReceivables', {}),
              mk('Subcontractor Liabilities','التزامات مقاولي الباطن', money(m.totalSubValue - m.totalSubPaid), m.totalSubValue - m.totalSubPaid, 'subLiabilities', { highlight: 'gold' }),
              mk('Average Margin',           'متوسط الهامش',            fmtPct(m.averageMargin),              m.averageMargin,              'averageMargin',              { highlight: m.averageMargin >= 15 ? 'green' : m.averageMargin >= 5 ? 'gold' : 'red' }),
              mk('Risk Exposure Index',      'مؤشر تعرض المخاطر',       fmtN(m.riskExposureIndex),            m.riskExposureIndex,          'riskExposureIndex',          { highlight: m.highRisks > 0 ? 'red' : 'neutral', sub: `${m.highRisks} high/critical risks` }),
              mk('Total Approved VOs',       'أوامر التغيير المعتمدة',  money(m.totalApprovedVOs),          m.totalApprovedVOs,           'totalApprovedVOs',           { icon: FileText }),
              mk('Approved Claims',          'المطالبات المعتمدة',       String(m.totalClaimsApprovedCount),  m.totalClaimsApprovedCount,   'totalClaimsApprovedCount',   { highlight: m.totalClaimsApprovedCount > 0 ? 'green' : 'neutral', icon: CheckCircle2, sub: money(m.totalClaimsSettled) + ' settled' }),
              mk('Pending Claims',           'المطالبات المعلقة',        String(m.pendingClaimsCount),        m.pendingClaimsCount,         'pendingClaimsCount',         { highlight: m.pendingClaimsCount > 0 ? 'gold' : 'neutral', icon: Clock }),
              mk('Approved Variations',      'التغييرات المعتمدة',       String(m.approvedVariationsCount),   m.approvedVariationsCount,    'approvedVariationsCount',    { icon: FileText, sub: money(m.approvedVariationsValue), highlight: 'gold' }),
              mk('Critical Risks',           'المخاطر الحرجة',           String(m.criticalRisks),             m.criticalRisks,              'criticalRisks',              { highlight: m.criticalRisks > 0 ? 'red' : 'green', icon: AlertCircle, sub: `${m.highRisks} high/critical total` }),
            ].map((props, i) => <MetricCard key={i} {...props} />)}
          </div>
        </section>

        <GD />

        {/* ════ EVM Dashboard ══════════════════════════════════ */}
        <section aria-label={lang === 'ar' ? 'تحليل القيمة المكتسبة' : 'EVM Dashboard'}>
          <SH en="Sector EVM" ar="القيمة المكتسبة للقطاع" lang={lang} icon={BarChart2} />

          {/* Index cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-white/[0.04] mb-6">
            {[
              mk('SPI', 'مؤشر الأداء الزمني', fmtIdx(m.portfolioSPI), m.portfolioSPI ?? 0, 'portfolioSPI', m.portfolioSPI === null ? {} : { highlight: m.portfolioSPI >= 0.95 ? 'green' : m.portfolioSPI >= 0.85 ? 'gold' : 'red', trend: m.portfolioSPI >= 1 ? 'up' : 'down', trendLabel: m.portfolioSPI >= 1 ? 'Ahead of schedule' : 'Behind schedule' }),
              mk('CPI', 'مؤشر الأداء التكليفي', fmtIdx(m.portfolioCPI), m.portfolioCPI ?? 0, 'portfolioCPI', m.portfolioCPI === null ? {} : { highlight: m.portfolioCPI >= 1 ? 'green' : m.portfolioCPI >= 0.9 ? 'gold' : 'red', trend: m.portfolioCPI >= 1 ? 'up' : 'down', trendLabel: m.portfolioCPI >= 1 ? 'Under budget' : 'Over budget' }),
              mk('BAC', 'الميزانية عند الإتمام', money(m.portfolioBAC), m.portfolioBAC, 'portfolioBAC', { highlight: 'gold' }),
              mk('EAC', 'التقدير عند الإتمام', money(m.portfolioEAC), m.portfolioEAC, 'portfolioEAC', { highlight: m.portfolioEAC <= m.portfolioBAC ? 'green' : 'red' }),
              mk('VAC', 'تباين الإتمام', money(m.portfolioVAC), m.portfolioVAC, 'portfolioVAC', { highlight: m.portfolioVAC >= 0 ? 'green' : 'red', trend: m.portfolioVAC >= 0 ? 'up' : 'down' }),
            ].map((props, i) => <MetricCard key={i} {...props} />)}
          </div>

          {/* EV / PV / AC values */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/[0.04] mb-6">
            {[
              mk('Earned Value (EV)', 'القيمة المكتسبة', money(m.portfolioEV), m.portfolioEV, 'portfolioEV', { highlight: 'gold' }),
              mk('Planned Value (PV)', 'القيمة المخططة', money(m.portfolioPV), m.portfolioPV, 'portfolioPV', {}),
              mk('Actual Cost (AC)', 'التكلفة الفعلية', money(m.portfolioAC), m.portfolioAC, 'portfolioAC', { highlight: m.portfolioAC <= m.portfolioEV ? 'green' : 'red' }),
            ].map((props, i) => <MetricCard key={i} {...props} />)}
          </div>

          {/* S-Curve */}
          <div className="border border-white/[0.06] bg-black/10 p-5">
            <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
              {lang === 'ar' ? 'منحنى S للقطاع' : 'Sector S-Curve (PV / EV / AC)'}
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={m.sCurve} style={CHART_STYLE}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis tickFormatter={v => fmtN(v)} {...AXIS_PROPS} />
                <Tooltip content={<ChartTooltip ccy={pageCcy} />} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }} />
                <Area type="monotone" dataKey="pv" name="PV" fill="#D4AF5A14" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} />
                <Line type="monotone" dataKey="ev" name="EV" stroke="#7EA486"  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ac" name="AC" stroke="#B25450"   strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <GD />

        {/* ════ EVA ════════════════════════════════════════════ */}
        <section aria-label={lang === 'ar' ? 'القيمة الاقتصادية المضافة' : 'Economic Value Added'}>
          <SH en="Economic Value Added (EVA)" ar="القيمة الاقتصادية المضافة (EVA)" lang={lang} icon={TrendingUp} />
          <p className="text-xs text-white/30 mb-5 max-w-2xl" style={{ fontFamily: lang === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : undefined }}>
            {lang === 'ar'
              ? 'تقيس القيمة الاقتصادية المضافة الربحية الحقيقية بعد خصم تكلفة رأس المال.'
              : 'EVA measures true profitability after deducting the cost of capital employed. Positive EVA indicates value creation above the cost of financing.'}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-white/[0.04]">
            {[
              mk('Net Operating Profit', 'صافي الربح التشغيلي', money(m.netOperatingProfit), m.netOperatingProfit, 'netOperatingProfit', { highlight: m.netOperatingProfit >= 0 ? 'green' : 'red', icon: TrendingUp }),
              mk('Capital Employed', 'رأس المال المستخدم', money(m.capitalEmployed), m.capitalEmployed, 'capitalEmployed', { highlight: 'gold', icon: DollarSign }),
              mk('WACC (%)', 'تكلفة رأس المال (%)', fmtPct(m.wacc * 100), m.wacc * 100, 'wacc', { sub: 'Weighted Avg Cost of Capital' }),
              mk('Cost of Capital', 'تكلفة رأس المال', money(m.costOfCapital), m.costOfCapital, 'costOfCapital', { highlight: 'red' }),
              mk('Economic Value Added', 'القيمة الاقتصادية المضافة', money(m.economicValueAdded), m.economicValueAdded, 'economicValueAdded',
                { highlight: m.economicValueAdded >= 0 ? 'green' : 'red', icon: Zap,
                  trend: m.economicValueAdded >= 0 ? 'up' : 'down',
                  trendLabel: m.economicValueAdded >= 0 ? 'Value creating' : 'Value destroying' }),
            ].map((props, i) => <MetricCard key={i} {...props} />)}
          </div>
        </section>

        <GD />

        {/* ════ Company Health ══════════════════════════════════ */}
        <section aria-label={lang === 'ar' ? 'صحة القطاع' : 'Sector Health'}>
          <SH en="Sector Health" ar="صحة القطاع" lang={lang} icon={Shield} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Health arc */}
            <div className="border border-white/[0.06] bg-black/10 p-6 flex items-center gap-8">
              <HealthArc score={Math.round(m.portfolioHealthScore)} />
              <div>
                <p className="text-(length:--t-label) uppercase tracking-widest text-white/45 mb-2">
                  {lang === 'ar' ? 'مؤشر صحة القطاع' : 'Sector Health Score'}
                </p>
                <p className="font-serif text-4xl text-white mb-3">{Math.round(m.portfolioHealthScore)}<span className="text-lg text-white/30"> / 100</span></p>
                <RiskRating rating={m.executiveRiskRating} />
              </div>
            </div>
            {/* Summary metrics */}
            <div className="grid grid-cols-2 gap-px bg-white/[0.04]">
              {[
                { label: lang === 'ar' ? 'متوسط SPI' : 'Avg SPI', val: fmtIdx(m.portfolioSPI),       color: m.portfolioSPI === null ? WHITE_DIM : m.portfolioSPI >= 1 ? GREEN : m.portfolioSPI >= 0.9 ? GOLD : RED },
                { label: lang === 'ar' ? 'متوسط CPI' : 'Avg CPI', val: fmtIdx(m.portfolioCPI),       color: m.portfolioCPI === null ? WHITE_DIM : m.portfolioCPI >= 1 ? GREEN : m.portfolioCPI >= 0.9 ? GOLD : RED },
                { label: lang === 'ar' ? 'متوسط التقدم' : 'Avg Progress', val: fmtPct(m.portfolioProgress), color: GOLD },
                { label: lang === 'ar' ? 'نجاح المطالبات' : 'Claims Rate',  val: fmtPct(m.claimsSuccessRate), color: m.claimsSuccessRate >= 70 ? GREEN : GOLD },
              ].map((item, i) => (
                <div key={i} className="bg-black/15 p-4 flex flex-col gap-1">
                  <p className="text-(length:--t-label) uppercase tracking-wider text-white/45">{item.label}</p>
                  <p className="text-xl font-serif font-bold" style={{ color: item.color }}>{item.val}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <GD />

        {/* ════ Charts ═════════════════════════════════════════ */}
        <section aria-label={lang === 'ar' ? 'الرسوم البيانية' : 'Sector Charts'}>
          <SH en="Executive Charts" ar="الرسوم البيانية التنفيذية" lang={lang} icon={BarChart2} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Company Cash Flow */}
            <div className="border border-white/[0.06] bg-black/10 p-5">
              <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                {lang === 'ar' ? 'التدفق النقدي للقطاع' : 'Sector Cash Flow'}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={m.cashFlowByMonth} style={CHART_STYLE}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis tickFormatter={v => fmtN(v)} {...AXIS_PROPS} />
                  <Tooltip content={<ChartTooltip ccy={pageCcy} />} />
                  <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }} />
                  <Bar dataKey="in"  name={lang === 'ar' ? 'واردات' : 'Cash In'}  fill={GOLD}  radius={[2,2,0,0]} />
                  <Bar dataKey="out" name={lang === 'ar' ? 'صادرات' : 'Cash Out'} fill={RED}   radius={[2,2,0,0]} />
                  <Bar dataKey="net" name={lang === 'ar' ? 'صافي' : 'Net'}        fill={BLUE}  radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Project Status */}
            <div className="border border-white/[0.06] bg-black/10 p-5">
              <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                {lang === 'ar' ? 'توزيع حالة المشاريع' : 'Project Status Distribution'}
              </p>
              {m.projectsByStatus.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart style={CHART_STYLE}>
                    <Pie data={m.projectsByStatus} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" outerRadius={75} innerRadius={35}
                      paddingAngle={2} label={({ name, value }) => `${name}: ${value}`}
                      labelLine={{ stroke: 'rgba(255,255,255,0.2)' }}>
                      {m.projectsByStatus.map((e, i) => (
                        <Cell key={i} fill={e.color ?? PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TT_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-white/20 text-sm">
                  {lang === 'ar' ? 'لا توجد بيانات' : 'No project data'}
                </div>
              )}
            </div>

            {/* Budget by Category */}
            <div className="border border-white/[0.06] bg-black/10 p-5">
              <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                {lang === 'ar' ? 'الميزانية حسب الفئة' : 'Budget by Category'}
              </p>
              {m.budgetByCategory.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={m.budgetByCategory} layout="vertical" style={CHART_STYLE}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis type="number" tickFormatter={v => fmtN(v)} {...AXIS_PROPS} />
                    <YAxis type="category" dataKey="category" width={90} {...AXIS_PROPS} tick={{ ...AXIS_PROPS.tick, fontSize: 9 }} />
                    <Tooltip content={<ChartTooltip ccy={pageCcy} />} />
                    <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }} />
                    <Bar dataKey="planned" name="Planned" fill="#D4AF5A80" radius={[0,2,2,0]} />
                    <Bar dataKey="actual"  name="Actual"  fill="#7EA486"   radius={[0,2,2,0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-white/20 text-sm">
                  {lang === 'ar' ? 'أدخل بيانات الميزانية في المشاريع' : 'Add budget data in project modules'}
                </div>
              )}
            </div>

            {/* Claims Distribution */}
            <div className="border border-white/[0.06] bg-black/10 p-5">
              <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                {lang === 'ar' ? 'توزيع المطالبات' : 'Claims Distribution by Status'}
              </p>
              {m.claimsByStatus.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart style={CHART_STYLE}>
                    <Pie data={m.claimsByStatus} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" outerRadius={75} innerRadius={35}
                      paddingAngle={2} label={({ name, value }) => `${name}: ${value}`}
                      labelLine={{ stroke: 'rgba(255,255,255,0.2)' }}>
                      {m.claimsByStatus.map((e, i) => (
                        <Cell key={i} fill={e.color ?? PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TT_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-white/20 text-sm">
                  {lang === 'ar' ? 'أدخل بيانات المطالبات في المشاريع' : 'Add claims data in project modules'}
                </div>
              )}
            </div>

            {/* Risk by Category */}
            <div className="border border-white/[0.06] bg-black/10 p-5">
              <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                {lang === 'ar' ? 'تعرض المخاطر حسب الفئة' : 'Risk Exposure by Category'}
              </p>
              {m.riskByCategory.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={m.riskByCategory} style={CHART_STYLE}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="category" {...AXIS_PROPS} tick={{ ...AXIS_PROPS.tick, fontSize: 9 }} />
                    <YAxis {...AXIS_PROPS} />
                    <Tooltip content={<IndexTooltip />} />
                    <Bar dataKey="exposure" name="Exposure Score" fill={RED}    radius={[2,2,0,0]} />
                    <Bar dataKey="count"    name="Count"          fill={PURPLE} radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-white/20 text-sm">
                  {lang === 'ar' ? 'أدخل بيانات المخاطر في المشاريع' : 'Add risk data in project modules'}
                </div>
              )}
            </div>

            {/* EVM Performance Index */}
            <div className="border border-white/[0.06] bg-black/10 p-5">
              <p className="text-(length:--t-label) uppercase tracking-wider text-white/45 mb-4">
                {lang === 'ar' ? 'أداء المشاريع — SPI مقابل CPI' : 'Project Performance — SPI vs CPI'}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={m.projectPerformance.slice(0, 8)} style={CHART_STYLE}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="code" {...AXIS_PROPS} />
                  <YAxis domain={[0, 1.5]} tickFormatter={v => v.toFixed(1)} {...AXIS_PROPS} />
                  <Tooltip content={<IndexTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }} />
                  <Bar dataKey="spi" name="SPI" fill={GOLD}  radius={[2,2,0,0]} />
                  <Bar dataKey="cpi" name="CPI" fill={BLUE}  radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <GD />

        {/* ════ Project Performance Table ══════════════════════ */}
        <section aria-label={lang === 'ar' ? 'أداء المشاريع' : 'Project Performance'}>
          <SH en="Project Performance Ranking" ar="ترتيب أداء المشاريع" lang={lang} icon={Layers} />

          <div className="border border-white/[0.06] bg-black/10 overflow-x-auto">
            <table className="w-full text-xs" role="grid">
              <thead>
                <tr className="border-b border-white/[0.06] bg-black/20">
                  {[
                    { key: 'code',          en: 'Code',       ar: 'الكود' },
                    { key: 'contractValue', en: 'Value',      ar: 'القيمة' },
                    { key: 'progress',      en: 'Progress',   ar: 'التقدم' },
                    { key: 'spi',           en: 'SPI',        ar: 'SPI' },
                    { key: 'cpi',           en: 'CPI',        ar: 'CPI' },
                    { key: 'delayDays',     en: 'Delay (d)',  ar: 'تأخير' },
                    { key: 'claimsCount',   en: 'Claims',     ar: 'مطالبات' },
                    { key: 'status',        en: 'Status',     ar: 'الحالة' },
                  ].map(col => (
                    <th key={col.key}
                      className="px-4 py-3 text-left text-(length:--t-label) uppercase tracking-wider text-white/45 cursor-pointer hover:text-primary/60 transition-colors select-none"
                      onClick={() => { if (sortCol === col.key) setSortAsc(!sortAsc); else { setSortCol(col.key); setSortAsc(false); } }}
                      aria-sort={sortCol === col.key ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                    >
                      {lang === 'ar' ? col.ar : col.en}
                      {sortCol === col.key && <span className="ms-1">{sortAsc ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedProjects.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-white/20">
                      {lang === 'ar' ? 'لا توجد مشاريع' : 'No projects found'}
                    </td>
                  </tr>
                ) : sortedProjects.map((p, i) => {
                  // STEP 13 — no measurable index gets no verdict colour.
                  const spiColor = p.spi === null ? undefined : p.spi >= 1 ? GREEN : p.spi >= 0.9 ? GOLD : RED;
                  const cpiColor = p.cpi === null ? undefined : p.cpi >= 1 ? GREEN : p.cpi >= 0.9 ? GOLD : RED;
                  const statusCls = p.status === 'Completed' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                                  : p.status === 'Delayed'   ? 'text-red-400 border-red-500/30 bg-red-500/10'
                                  :                            'text-primary/80 border-primary/20 bg-primary/5';
                  return (
                    <tr key={p.id} className={cn('border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors', i % 2 === 0 ? 'bg-transparent' : 'bg-black/[0.08]')}>
                      <td className="px-4 py-2.5 font-mono text-white/60">{p.code}</td>
                      <td className="px-4 py-2.5 text-white/70">{money(p.contractValue)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1 bg-white/10 overflow-hidden">
                            <div className="h-full bg-primary/70" style={{ width: `${p.progress}%` }} />
                          </div>
                          <span className="text-white/50">{p.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-bold" style={{ color: spiColor }}>{fmtIdx(p.spi)}</td>
                      <td className="px-4 py-2.5 font-mono font-bold" style={{ color: cpiColor }}>{fmtIdx(p.cpi)}</td>
                      <td className="px-4 py-2.5 text-white/50">{p.delayDays > 0 ? <span className="text-red-400">{p.delayDays}</span> : '—'}</td>
                      <td className="px-4 py-2.5 text-white/50">{p.claimsCount || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-(length:--t-second) px-2 py-0.5 border', statusCls)}>
                          {lang === 'ar' ? (p.status === 'Completed' ? 'مكتمل' : p.status === 'Delayed' ? 'متأخر' : 'نشط') : p.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {sortedProjects.length > 0 && (
                <tfoot>
                  <tr className="border-t border-primary/20 bg-primary/[0.03]">
                    <td className="px-4 py-2.5 text-(length:--t-label) uppercase tracking-wider text-primary/60 font-bold">
                      {lang === 'ar' ? 'الإجمالي' : 'Sector Total'}
                    </td>
                    <td className="px-4 py-2.5 text-primary/80 font-bold">{money(m.totalContractValue)}</td>
                    <td className="px-4 py-2.5 text-white/50">{fmtPct(m.portfolioProgress)}</td>
                    <td className="px-4 py-2.5 font-mono font-bold" style={{ color: m.portfolioSPI === null ? WHITE_DIM : m.portfolioSPI >= 1 ? GREEN : GOLD }}>{fmtIdx(m.portfolioSPI)}</td>
                    <td className="px-4 py-2.5 font-mono font-bold" style={{ color: m.portfolioCPI === null ? WHITE_DIM : m.portfolioCPI >= 1 ? GREEN : GOLD }}>{fmtIdx(m.portfolioCPI)}</td>
                    <td className="px-4 py-2.5 text-white/40">{m.averageDelay.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-white/40">{m.totalClaimsCount}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        <GD />

        {/* ════ Sync legend ════════════════════════════════════ */}
        <div className="flex flex-wrap items-center gap-6 text-(length:--t-body) text-white/30 border border-white/[0.05] p-4 bg-black/10">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400/70" />
            {lang === 'ar' ? 'حساب تلقائي — مشتق من بيانات المشاريع' : 'Auto — derived from live project data'}
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400/80" />
            {lang === 'ar' ? 'تجاوز يدوي — قيمة محررة يدوياً' : 'Manual Override — manually entered value'}
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white/30" />
            {lang === 'ar' ? 'بانتظار المزامنة — انقر "حساب تلقائي" للتحديث' : 'Pending Sync — click Auto Calculate to refresh'}
          </span>
          <span className="ms-auto flex items-center gap-2">
            <Pencil className="w-3 h-3" />
            {lang === 'ar' ? 'مرر فوق البطاقة للتحرير' : 'Hover any card to override'}
          </span>
        </div>

      </div>
    </div>
  );
}
