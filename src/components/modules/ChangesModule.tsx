import React, { useState, useEffect, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useTranslation } from '../../lib/i18n';
import { formatMoney } from '../../lib/utils';
import { Plus, Trash2, Clock, Paperclip, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { kpiMoney, exactMoney } from '../../lib/moneyFormat';
import { EditableNumber, EditableText, EditableSelect } from '../EditableCell';
import ReportButton from '../reporting/ReportButton';
import { normaliseDocUrl } from '../../lib/subcontractCommercial';
import { formatDateOrDash } from '../../lib/dateFormat';
import { fetchSectors } from '../../mock/sectors';
import {
  moneyContext, resolveTxnDate, readMoneyMeta,
  // Phase 3.2 — the transaction layer. Defaults to the project's contract
  // currency and can convert into a reporting currency the rates were not
  // published against.
  transactionContext, prepareTransaction, transactionFields,
} from '../../lib/moneyEntry';
import { contractCurrencyOf } from '../../lib/projectCurrency';
import { CurrencyAmountDisplay, CurrencyBadge, TransactionAmountInput } from '../CurrencyAmount';
// Task 5 — authoritative company link; the projectIds cache can be stale.
import { companyIdOfProject } from '../../lib/projectMaster';
// PHASE 4 · STEP 5 — cost assessment. The domain rules live in the lib so
// this screen only renders them; it never decides readiness itself.
import {
  costOf, costStage, costStageLabel, baselineReadiness, summariseCosts,
  assessCost, approveCost, rejectCost, beginAssessment,
  // PHASE 4 · STEP 7 — the two axes, reported separately.
  costState, assessmentStatusLabel, approvalStatusLabel, isBaselineEligible,
  type CostAssessment, type CostStage,
} from '../../lib/changeCost';
import { useAuth } from '../../lib/store';
/**
 * SOURCE VERSIONING. This register is one of the five a Baseline Package
 * is built from, so the version line belongs on the screen that owns the
 * data — not only on the Baseline screen. Capturing a version reads this
 * store; it never writes to it.
 */
import SourceVersionsPanel from '../SourceVersionsPanel';


interface CORow {
  no: string;
  desc: string;
  value: number;
  time: number;
  status: string;
  /**
   * External document link (Drive / SharePoint / any https URL). Optional —
   * legacy rows have none. A URL only; PACTUM never stores the file itself.
   */
  documentUrl?: string;
  /**
   * Transaction date. NEW: the change order had no date field, and a rate
   * must be looked up against one. Optional so every legacy row still loads.
   */
  date?: string;
  /**
   * ══════════════════════════════════════════════════════════════════════
   * STEP 12 — WHEN THE TIME GRANT BECAME EFFECTIVE.
   *
   * Captured here because this is where the decision is actually taken.
   * The Delay Register syncs it across and never overwrites it afterwards.
   *
   * NOT `date`, which is the transaction date used for the FX lookup and
   * is typically weeks earlier. NOT `costApprovedAt` either: Step 7
   * separated the cost axis from the time axis, and one may never be
   * inferred from the other.
   *
   * Optional, and never back-filled. A legacy approved CO with time but
   * no date leaves the register row undated, which correctly BLOCKS the
   * time-based Indirect EV (Q2=C) instead of inventing a date.
   * ══════════════════════════════════════════════════════════════════════
   */
  eotApprovedAt?: string;
  /**
   * Currency metadata. `value` above always holds the CONVERTED amount, so
   * every existing reader — EVM, Timeline, the reports — is unaffected.
   * Absent on a legacy row, which is correctly read as base currency.
   */
  currency?: string;
  originalAmount?: number;
  exchangeRate?: number;
  transactionDate?: string;
  rateEffectiveDate?: string;
  convertedAt?: string;
  dateSource?: string;
  // Delay back-links are NOT stored here — they are derived by scanning delays
}

interface DelayRow { id: string; description: string; delayDays: number; costImpact: number; status: string; linkedCoNos?: string[]; }

/**
 * PHASE 4 · STEP 5 — cost assessment lives in its own nested block so the
 * existing `status` field keeps its COMMERCIAL meaning untouched. Every
 * reader of `status` — computeBac, the contract rollups, the reports —
 * behaves exactly as before.
 */
type CORowWithCost = CORow & { cost?: CostAssessment };

const STATUS_OPTS = (t: any) => [
  { value: 'submitted', label: t.submitted },
  { value: 'review', label: t.underReview },
  { value: 'approved', label: t.approved },
  { value: 'rejected', label: t.rejected },
];

// Returns colour only. Shape and typography come from `.badge`.
const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved': return 'bg-chart-4/10 text-chart-4 border-chart-4/30';
    case 'review': return 'bg-chart-5/10 text-chart-5 border-chart-5/30';
    case 'rejected': return 'bg-chart-3/10 text-chart-3 border-chart-3/30';
    default: return 'bg-white/5 text-muted-foreground border-white/10';
  }
};

function getDelayStatusColor(status: string) {
  switch ((status || '').toLowerCase()) {
    case 'approved': return 'text-chart-4';
    case 'review':   return 'text-chart-5';
    case 'rejected': return 'text-chart-3';
    default:         return 'text-muted-foreground';
  }
}

// ── Cross-module back-link panel ──────────────────────────────────────

function LinkedDelaysPanel({ coNo, delays, ccy }: { coNo: string; delays: DelayRow[]; ccy: string }) {
  const linked = delays.filter(d => (d.linkedCoNos || []).includes(coNo));
  if (linked.length === 0) {
    return (
      <div className="px-5 py-3 bg-black/20 border-t border-white/5">
        <p className="text-(length:--t-second) text-white/20 italic">No delay events have linked this change order. Open the Delay module to create a link.</p>
      </div>
    );
  }
  return (
    <div className="px-5 pb-4 pt-2 bg-black/20 border-t border-white/5">
      <p className="text-(length:--t-label) uppercase tracking-widest text-chart-5/60 font-mono mb-2">Linked Delay Events — {linked.length}</p>
      <div className="space-y-1.5">
        {linked.map(d => (
          <div key={d.id} className="flex items-center gap-3 bg-black/30 border border-chart-5/10 px-3 py-2 text-xs">
            <span className="font-mono text-chart-5 w-20 flex-shrink-0">{d.id}</span>
            <span className="text-white/70 flex-1 truncate">{d.description}</span>
            <span className="font-mono text-chart-3 flex-shrink-0">{formatMoney(d.costImpact, { currency: ccy })}</span>
            <span className={cn('text-(length:--t-second) w-20 text-right flex-shrink-0', getDelayStatusColor(d.status))}>{d.status}</span>
            <span className="font-mono text-muted-foreground flex-shrink-0">{d.delayDays}d</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export default function ChangesModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  const { t, lang } = useTranslation();
  const [data, setData] = useState<CORow[]>([]);
  const [delays, setDelays] = useState<DelayRow[]>([]);

  // FX book is company-scoped; same derivation SubsModule uses.
  const companyId = useMemo(
    () => companyIdOfProject(project as any, fetchSectors()),
    [project.id],
  );
  const money = useMemo(() => moneyContext(companyId, project.id), [companyId, project.id]);
  /**
   * The project's CONTRACT currency — what a new record defaults to.
   * Falls back to the company reporting currency when none is set, which is
   * what these records already were before project currency existed.
   */
  const contractCcy = useMemo(
    () => contractCurrencyOf(project.id, money.base), [project.id, money.base]);
  const txnCtx = useMemo(
    () => transactionContext(companyId, project.id, contractCcy),
    [companyId, project.id, contractCcy]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  /** Which row's cost panel is open. Independent of the delays panel. */
  const [costRow, setCostRow] = useState<number | null>(null);
  const [costDraft, setCostDraft] = useState({ direct: '', indirect: '', note: '', budgetLineRef: '' });
  const { user } = useAuth();
  const isRtl = lang === 'ar';

  useEffect(() => {
    const stored = localStorage.getItem(`pactum-co-${project.id}`);
    if (stored) {
      setData(JSON.parse(stored));
    } else {
      // PHASE 3G — no auto-seed. Opening a screen must never CREATE
      // data. An empty store stays empty until the user enters a row or
      // presses "Load Sample Data".
      setData([]);
    }
  }, [project.id]);

  // Load cross-module data for back-links
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`pactum-delays-${project.id}`);
      if (raw) setDelays(JSON.parse(raw));
    } catch { /* noop */ }
  }, [project.id]);

  const persist = (next: CORow[]) => {
    setData(next);
    localStorage.setItem(`pactum-co-${project.id}`, JSON.stringify(next));
  };

  const updateField = (index: number, field: keyof CORow, value: any) => {
    persist(data.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  /**
   * ══════════════════════════════════════════════════════════════════
   * COST ACTIONS — each rewrites ONE row and only its `cost` block.
   *
   * Every helper below comes from `changeCost.ts` and returns a NEW row
   * with all existing keys spread through. No other row is re-saved, so
   * a bulk rewrite of the register cannot happen here by accident, and
   * `status` — the commercial field — is never among the keys written.
   * ══════════════════════════════════════════════════════════════════
   */
  const applyToRow = (index: number, fn: (r: any) => any) => {
    persist(data.map((row, i) => (i === index ? fn(row) : row)));
  };

  const openCostPanel = (i: number) => {
    if (costRow === i) { setCostRow(null); return; }
    const c = costOf(data[i] as any);
    setCostDraft({
      direct: c && c.assessed ? String(c.directImpact) : '',
      indirect: c && c.assessed ? String(c.indirectImpact) : '',
      note: '',
      budgetLineRef: c ? (c.budgetLineRef || '') : '',
    });
    setCostRow(i);
  };

  const saveAssessment = (i: number) => {
    // Empty is not zero. A blank field means "not stated", and saving it
    // as an assessed 0 would be the software inventing a measurement.
    if (costDraft.direct.trim() === '' && costDraft.indirect.trim() === '') return;
    applyToRow(i, r => assessCost(r,
      Number(costDraft.direct) || 0,
      Number(costDraft.indirect) || 0,
      user?.username || 'unknown', undefined, costDraft.budgetLineRef));
  };

  const doApproveCost = (i: number) => applyToRow(i, r => approveCost(r, user?.username || 'unknown'));
  const doRejectCost  = (i: number) => {
    if (!costDraft.note.trim()) return;   // a refusal must state why
    applyToRow(i, r => rejectCost(r, user?.username || 'unknown', costDraft.note.trim()));
  };
  const doBeginAssessment = (i: number) => applyToRow(i, r => beginAssessment(r));

  /** Portfolio view of the register's financial readiness. */
  const costSummary = useMemo(() => summariseCosts(data as any[]), [data]);

  /**
   * Budget line names, for the Q1=C link.
   *
   * Read live from the register the Budget screen owns — this module does
   * not keep its own copy, so a line renamed there cannot leave a stale
   * option here. Category name is the key because a budget row has no id,
   * and inventing one would mean rewriting every stored budget record.
   */
  const budgetCategories = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(`pactum-budget-${project.id}`) || '[]');
      if (!Array.isArray(raw)) return [] as string[];
      const seen = new Set<string>();
      raw.forEach((r: any) => {
        const c = typeof r?.category === 'string' ? r.category.trim() : '';
        if (c) seen.add(c);
      });
      return [...seen];
    } catch { return [] as string[]; }
  }, [project.id, costRow]);

  const [isAdding, setIsAdding] = useState(false);
  const [newRow, setNewRow] = useState({
    no: '', desc: '', value: '', time: '', status: 'submitted', documentUrl: '',
    currency: contractCcy, date: new Date().toISOString().slice(0, 10),
  });
  const [saveErr, setSaveErr] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRow.no) return;
    setSaveErr('');

    // Convert ONCE, at the transaction date, and freeze the result.
    const txn = resolveTxnDate({ date: newRow.date }, ['date']);
    const m = prepareTransaction(txnCtx, newRow.value, newRow.currency, txn);
    if (!m.money.resolved) {
      // Saving an unconverted foreign amount would put a USD figure into a
      // SAR total. Refuse rather than corrupt the arithmetic silently.
      setSaveErr(lang === 'ar'
        ? `لا يوجد سعر صرف من ${newRow.currency} إلى ${txnCtx.reportingCurrency} بتاريخ ${txn.date}. انشر السعر في إدارة العملات أولاً.`
        : `No rate from ${newRow.currency} to ${txnCtx.reportingCurrency} on ${txn.date}. Publish one in Currency Management first.`);
      return;
    }

    const base: CORow = {
      no: newRow.no, desc: newRow.desc,
      // The CONVERTED figure — what every existing calculation consumes.
      value: m.value,
      time: Number(newRow.time) || 0,
      status: newRow.status,
      documentUrl: newRow.documentUrl.trim(),
      date: newRow.date,
    };
    // transactionFields() returns {} for a reporting-currency row, so a
    // domestic record stays byte-identical to what it was before.
    //
    // PHASE 4 · STEP 5 — a NEWLY created order opens with an empty cost
    // block, so it reads "cost assessment required" rather than "legacy".
    // Legacy means "written before this feature existed", and a change
    // order created today is not that. Without this it would carry the
    // legacy flag forever and quietly sit outside the assessment workflow.
    persist([...data, beginAssessment({ ...base, ...transactionFields(m.money) }) as CORow]);
    setNewRow({ no: '', desc: '', value: '', time: '', status: 'submitted', documentUrl: '',
                currency: contractCcy, date: new Date().toISOString().slice(0, 10) });
    setIsAdding(false);
  };

  const handleDelete = (index: number) => persist(data.filter((_, i) => i !== index));

  const toggleRow = (i: number) => setExpandedRow(expandedRow === i ? null : i);

  // Count back-links per change order
  const delayCountFor = (no: string) => delays.filter(d => (d.linkedCoNos || []).includes(no)).length;

  const approvedValue = data.filter((d) => d.status === 'approved').reduce((a, b) => a + b.value, 0);
  const reviewValue = data.filter((d) => d.status === 'review').reduce((a, b) => a + b.value, 0);
  // Only APPROVED time extends the contract. A submitted or rejected change
  // order carries no entitlement, so counting its days would overstate the EOT.
  const approvedEOT = data
    .filter((d) => d.status === 'approved')
    .reduce((a, b) => a + (Number(b.time) || 0), 0);

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      <SourceVersionsPanel projectId={project.id} only="change-orders" canEdit={canEdit} compact />

      {/* 2 · EXECUTIVE SUMMARY */}
      <div className="kpi-strip !grid-cols-2 md:!grid-cols-4">
        <div className="kpi">
          <div className="kpi-k">{t.totalApprovedCOsValue}</div>
          <div className="kpi-v kpi-v-gold money" title={exactMoney(approvedValue, money.base)}>{kpiMoney(approvedValue, money.base)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t.underReviewValue}</div>
          <div className="kpi-v money" title={exactMoney(reviewValue, money.base)}>{kpiMoney(reviewValue, money.base)}</div>
        </div>
        {/* Approved time extension — same tile the Claims register carries. */}
        <div className="kpi">
          <div className="kpi-k">{t.timeEOTShort}</div>
          <div className="kpi-v kpi-v-gold">{approvedEOT}</div>
          <div className="kpi-sub">{t.days}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t.coNo}</div>
          <div className="kpi-v">{data.length}</div>
        </div>
      </div>

      {/* ── Financial readiness ────────────────────────────────────────────
          Separate from the commercial tiles above, because they measure
          different things. `Approved COs Value` is commercial; these are
          about whether the cost behind them has been measured and signed.
          A register can be fully approved commercially and have nothing
          eligible for a baseline. */}
      {data.length > 0 && (
        <div className="kpi-strip !grid-cols-2 md:!grid-cols-3">
          <div className="kpi">
            <div className="kpi-k">{isRtl ? 'أثر الموازنة المعتمد' : 'Approved Budget Impact'}</div>
            <div className="kpi-v money" title={exactMoney(costSummary.approvedTotal, money.base)}>
              {kpiMoney(costSummary.approvedTotal, money.base)}
            </div>
            <div className="kpi-sub">{isRtl ? 'مباشرة + غير مباشرة' : 'DIRECT + INDIRECT'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-k">{isRtl ? 'أثر BAC المعتمد' : 'Approved BAC Impact'}</div>
            <div className="kpi-v kpi-v-gold money" title={exactMoney(costSummary.approvedDirect, money.base)}>
              {kpiMoney(costSummary.approvedDirect, money.base)}
            </div>
            {/* Naming the excluded indirect is what stops a reader
                assuming the two tiles should agree. */}
            <div className="kpi-sub">
              {isRtl
                ? `مباشرة فقط · ${formatMoney(costSummary.approvedIndirect, { currency: money.base })} غير مباشرة مستبعدة`
                : `DIRECT ONLY · ${formatMoney(costSummary.approvedIndirect, { currency: money.base })} INDIRECT EXCLUDED`}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-k">{isRtl ? 'جاهز لخط الأساس' : 'Baseline Ready'}</div>
            <div className="kpi-v kpi-v-ok">{costSummary.baselineReady}</div>
            <div className="kpi-sub">
              {[
                `${isRtl ? 'من' : 'OF'} ${costSummary.total}`,
                costSummary.legacy > 0 ? `${costSummary.legacy} ${isRtl ? 'قديم' : 'LEGACY'}` : '',
                costSummary.assessmentRequired > 0
                  ? `${costSummary.assessmentRequired} ${isRtl ? 'بانتظار تقييم' : 'UNASSESSED'}` : '',
                costSummary.assessed > 0
                  ? `${costSummary.assessed} ${isRtl ? 'بانتظار اعتماد' : 'PENDING'}` : '',
              ].filter(Boolean).join(' \u00b7 ')}
            </div>
          </div>
        </div>
      )}

      {/* Commercially agreed but financially incomplete — the actionable
          gap, named. This is a STATEMENT, not the baseline gate: the
          blocking rule lives in baselineGate.ts and is not duplicated. */}
      {costSummary.blockedRefs.length > 0 && (
        <div className="ds-card border-chart-3/30 bg-chart-3/[0.05] !py-3">
          <p className="text-(length:--t-second) text-chart-3">
            {isRtl
              ? `${costSummary.blockedRefs.length} أمر تغيير معتمد تجارياً لكنه غير جاهز لخط الأساس: ${costSummary.blockedRefs.join(' · ')}`
              : `${costSummary.blockedRefs.length} commercially approved change order(s) are NOT baseline ready: ${costSummary.blockedRefs.join(' · ')}`}
          </p>
        </div>
      )}

      {/* 5 · CHANGE ORDER LOG */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="sec-head !mb-0 flex-1">{t.changeOrderLog}</h3>
          <ReportButton reportId="change-orders" context={{ project, rows: data, reportCurrency: money.base }} />
          {canEdit && (
            <button onClick={() => setIsAdding(!isAdding)} className="btn btn-secondary btn-sm">
              <Plus className="w-3 h-3" /> {t.add}
            </button>
          )}
        </div>

        {isAdding && canEdit && (
          <form onSubmit={handleAdd} className="ds-card ds-card-tight mb-3">
            <div className="form-grid">
              <div className="field">
                <label className="field-label" data-required>{t.coNo}</label>
                <input className="field-input font-mono" placeholder="CO-00X" value={newRow.no} onChange={(e) => setNewRow({ ...newRow, no: e.target.value })} required dir="ltr" />
              </div>
              <div className="field xl:col-span-2">
                <label className="field-label" data-required>{t.description}</label>
                <input className="field-input" placeholder={t.description} value={newRow.desc} onChange={(e) => setNewRow({ ...newRow, desc: e.target.value })} required />
              </div>
              {/* Currency + amount. The converted figure appears beneath. */}
              <TransactionAmountInput
                label={t.value}
                amount={newRow.value}
                currency={newRow.currency}
                date={newRow.date}
                onAmount={v => setNewRow({ ...newRow, value: v })}
                onCurrency={v => setNewRow({ ...newRow, currency: v })}
                onDate={v => setNewRow({ ...newRow, date: v })}
                fx={money.fx}
                settings={money.settings}
                projectId={project.id}
                hideDate
              />
              {/* Transaction date drives the rate lookup, so it is explicit. */}
              <div className="field">
                <label className="field-label">
                  {lang === 'ar' ? 'تاريخ الأمر' : 'Order Date'}
                  <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                    {lang === 'ar' ? 'يحدد سعر الصرف' : 'sets the FX rate'}
                  </span>
                </label>
                <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                       style={{ colorScheme: 'dark' }}
                       value={newRow.date}
                       onChange={e => setNewRow({ ...newRow, date: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">{t.timeImpactDays}</label>
                <input className="field-input font-mono number-ltr" type="number" placeholder="0" value={newRow.time} onChange={(e) => setNewRow({ ...newRow, time: e.target.value })} dir="ltr" />
              </div>
              <div className="field">
                <label className="field-label">{t.status}</label>
                <select className="field-input" value={newRow.status} onChange={(e) => setNewRow({ ...newRow, status: e.target.value })}>
                  {STATUS_OPTS(t).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {/* Document link. A URL only — the file itself stays where it lives. */}
              <div className="field xl:col-span-2">
                <label className="field-label">{lang === 'ar' ? 'رابط المستند' : 'Document Link'}</label>
                <input className="field-input" placeholder={lang === 'ar' ? 'اختياري' : 'optional'} value={newRow.documentUrl} onChange={(e) => setNewRow({ ...newRow, documentUrl: e.target.value })} dir="ltr" />
              </div>
            </div>
            {saveErr && <p className="field-error mt-2">{saveErr}</p>}
            {/* Primary action always last, always right. */}
            <div className="form-actions">
              <button type="button" onClick={() => setIsAdding(false)} className="btn btn-ghost">{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
              <button type="submit" className="btn btn-primary">{t.save}</button>
            </div>
          </form>
        )}

        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>{t.coNo}</th>
                <th>{t.description}</th>
                <th className="money">{t.value}</th>
                <th className="money">{t.timeEOTShort}</th>
                <th>{lang === 'ar' ? 'الحالة التجارية' : 'Commercial'}</th>
                <th>{lang === 'ar' ? 'التكلفة' : 'Cost'}</th>
                <th>{lang === 'ar' ? 'التأخيرات' : 'Delays'}</th>
                <th>{lang === 'ar' ? 'المستند' : 'Document'}</th>
                {canEdit && <th className="col-act" />}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={canEdit ? 9 : 8}><div className="ds-empty"><div className="ds-empty-title">{t.noData}</div></div></td></tr>
              )}
              {data.map((row, i) => {
                const dCount = delayCountFor(row.no);
                const isExpandedDelays = expandedRow === i;
                const stage: CostStage = costStage(row as any);
                const rdy = baselineReadiness(row as any);
                const c = costOf(row as any);
                // Step 7 — the separated axes and the single eligibility rule.
                const cstate = costState(row as any);
                const eligible = isBaselineEligible(row as any);
                return (
                <React.Fragment key={i}>
                <tr>
                  <td className="font-mono text-primary">
                    <span className="inline-flex items-center gap-1.5">
                      <EditableText value={row.no} onSave={(v) => updateField(i, 'no', v)} canEdit={canEdit} />
                      <CurrencyBadge code={row.currency ?? ''} base={money.base} />
                    </span>
                  </td>
                  <td className="text-white max-w-[280px]">
                    <EditableText value={row.desc} onSave={(v) => updateField(i, 'desc', v)} canEdit={canEdit} />
                  </td>
                  {/* Converted value stays editable exactly as before. The
                      original is shown beneath when the row was foreign. */}
                  <td className="money">
                    <EditableNumber value={row.value} onSave={(v) => updateField(i, 'value', v)} canEdit={canEdit} display={formatMoney(row.value, { currency: money.base })} />
                    {row.currency && row.currency !== money.base && (
                      <span className="block text-(length:--t-micro) font-mono text-muted-foreground mt-0.5">
                        {row.currency} {(row.originalAmount ?? 0).toLocaleString('en-US')} @ {(row.exchangeRate ?? 0).toFixed(4)}
                      </span>
                    )}
                  </td>
                  <td className="money">
                    <span className={cn('badge', (row.time || 0) > 0 ? 'badge-gold' : 'badge-neutral')}>
                      <EditableNumber value={row.time || 0} onSave={(v) => updateField(i, 'time', v)} canEdit={canEdit}
                        display={(row.time || 0) > 0 ? `+${row.time}` : '0'} suffix={` ${t.days}`} />
                    </span>
                    {/*
                      STEP 12 — the effective date sits UNDER the days, in the
                      existing cell. No new column: the table is already wide
                      and a fourteenth one would break the layout rule.
                      Shown only when there IS time to date. An undated grant
                      says so out loud, because that is what blocks Indirect EV.
                    */}
                    {(row.time || 0) > 0 && (
                      <span className="block text-(length:--t-micro) font-mono text-muted-foreground mt-0.5">
                        {canEdit ? (
                          <input
                            type="date" dir="ltr"
                            value={row.eotApprovedAt || ''}
                            onChange={(e) => updateField(i, 'eotApprovedAt', e.target.value)}
                            className="bg-transparent border border-white/10 px-1 py-0.5 font-mono text-(length:--t-micro) text-muted-foreground focus:outline-none focus:border-primary/40"
                            title={isRtl ? 'تاريخ سريان التمديد' : 'EOT effective date'}
                          />
                        ) : (
                          row.eotApprovedAt
                            ? formatDateOrDash(row.eotApprovedAt, isRtl ? 'ar' : 'en')
                            : (isRtl ? 'بلا تاريخ' : 'no date')
                        )}
                        {!row.eotApprovedAt && (
                          <span className="block text-chart-3/80">
                            {isRtl ? 'يحجب القيمة المكتسبة غير المباشرة' : 'blocks Indirect EV'}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td>
                    <EditableSelect
                      value={row.status}
                      options={STATUS_OPTS(t)}
                      onSave={(v) => updateField(i, 'status', v)}
                      canEdit={canEdit}
                      className={cn('badge', getStatusColor(row.status))}
                    />
                  </td>
                  {/* ── Cost assessment state ──────────────────────────
                      A chip, not a second status dropdown: the stage is
                      DERIVED from the assessment, never picked. Making it
                      selectable would let someone mark a change
                      "cost approved" without a figure behind it. */}
                  <td>
                    <button
                      onClick={() => openCostPanel(i)}
                      aria-expanded={costRow === i}
                      title={costStageLabel(stage, isRtl ? 'ar' : 'en')}
                      className={cn('badge cursor-pointer whitespace-nowrap',
                        stage === 'cost-approved' ? 'badge-ok'
                        : stage === 'cost-rejected' ? 'badge-risk'
                        : stage === 'assessed' ? 'badge-warn'
                        : stage === 'legacy' ? 'badge-neutral'
                        : 'text-chart-3 border-chart-3/30 bg-chart-3/10')}
                    >
                      {stage === 'cost-approved'
                        ? (isRtl ? 'معتمدة' : 'APPROVED')
                        : stage === 'cost-rejected'
                        ? (isRtl ? 'مرفوضة' : 'REJECTED')
                        : stage === 'assessed'
                        ? (isRtl ? 'قيد الاعتماد' : 'PENDING')
                        : stage === 'legacy'
                        ? (isRtl ? 'قديم' : 'LEGACY')
                        : (isRtl ? 'مطلوب تقييم' : 'REQUIRED')}
                    </button>
                    {rdy.ready && (
                      <span className="block text-(length:--t-micro) text-chart-4 mt-0.5">
                        {isRtl ? 'جاهز لخط الأساس' : 'Baseline ready'}
                      </span>
                    )}
                  </td>
                  {/* Delay back-link chip */}
                  <td>
                    <button
                      onClick={() => toggleRow(i)}
                      aria-expanded={isExpandedDelays}
                      aria-label={lang === 'ar' ? `التأخيرات المرتبطة (${dCount})` : `Linked delays (${dCount})`}
                      className={cn('badge cursor-pointer', dCount > 0 ? 'badge-warn' : 'badge-neutral')}
                    >
                      <Clock className="w-3 h-3" />
                      {dCount}
                    </button>
                  </td>
                  {/* Document — link plus inline editor. Identical treatment to
                      the claims and certificate registers. */}
                  <td className="text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      {normaliseDocUrl(row.documentUrl) ? (
                        <a
                          href={normaliseDocUrl(row.documentUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={row.documentUrl}
                          onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1 text-primary/80 hover:text-primary transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span className="text-(length:--t-label) uppercase tracking-wider">{lang === 'ar' ? 'فتح' : 'Open'}</span>
                        </a>
                      ) : (
                        <Paperclip className="w-3 h-3 text-white/15" />
                      )}
                      {canEdit && (
                        <EditableText
                          value={row.documentUrl || ''}
                          onSave={v => updateField(i, 'documentUrl', v)}
                          canEdit={canEdit}
                          placeholder={lang === 'ar' ? 'رابط' : 'link'}
                          className="text-(length:--t-second) text-muted-foreground max-w-[90px] truncate"
                        />
                      )}
                    </div>
                  </td>
                  {canEdit && (
                    <td className="col-act">
                      <span className="inline-flex items-center gap-0.5">
                        <ReportButton reportId="co-detail" size="sm" label=""
                          context={{ project, item: row, reportCurrency: money.base }}
                        />
                        <button onClick={() => handleDelete(i)} aria-label={lang === 'ar' ? 'حذف' : 'Delete'} className="text-muted-foreground hover:text-destructive transition-colors p-1.5"><Trash2 className="w-4 h-4" /></button>
                      </span>
                    </td>
                  )}
                </tr>
                {/* Linked delays panel */}
                {isExpandedDelays && (
                  <tr className="border-b border-chart-5/10">
                    <td colSpan={canEdit ? 9 : 8} className="p-0">
                      <LinkedDelaysPanel ccy={money.base} coNo={row.no} delays={delays} />
                    </td>
                  </tr>
                )}
                {/* ── Cost assessment panel ───────────────────────────────
                    Emitted by the row it belongs to, so the panel always
                    opens directly beneath the change order being costed. */}
                {costRow === i && (
                  <tr className="border-b border-primary/10">
                    <td colSpan={canEdit ? 9 : 8} className="p-0">
                      <div className="bg-black/40 border-s-2 border-primary/40 px-4 py-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                          <h4 className="text-(length:--t-label) uppercase tracking-wider text-primary">
                            {isRtl ? `تقييم تكلفة ${row.no}` : `Cost assessment — ${row.no}`}
                          </h4>
                          <span className="text-(length:--t-second) text-muted-foreground">
                            {/* PHASE 4 · STEP 7 — the two axes shown SEPARATELY.
                                  One merged label could not express
                                  "assessment complete, approval rejected"
                                  without the reader inferring it. */}
                              <span className="inline-flex items-center gap-3 flex-wrap">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
                                    {isRtl ? 'تقييم التكلفة' : 'Cost Assessment'}
                                  </span>
                                  <span className={cn('badge',
                                    cstate.assessment === 'complete' ? 'badge-ok'
                                      : 'text-chart-3 border-chart-3/30 bg-chart-3/10')}>
                                    {assessmentStatusLabel(cstate.assessment, isRtl ? 'ar' : 'en')}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
                                    {isRtl ? 'اعتماد التكلفة' : 'Cost Approval'}
                                  </span>
                                  <span className={cn('badge',
                                    cstate.approval === 'approved' ? 'badge-ok'
                                      : cstate.approval === 'rejected' ? 'badge-risk'
                                      : 'badge-warn')}>
                                    {approvalStatusLabel(cstate.approval, isRtl ? 'ar' : 'en')}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="text-(length:--t-micro) uppercase tracking-wider text-muted-foreground">
                                    {isRtl ? 'مؤهل لخط الأساس' : 'Baseline Eligible'}
                                  </span>
                                  <span className={cn('badge', eligible ? 'badge-ok' : 'badge-neutral')}>
                                    {eligible ? (isRtl ? 'نعم' : 'YES') : (isRtl ? 'لا' : 'NO')}
                                  </span>
                                </span>
                              </span>
                          </span>
                        </div>

                        {/* The sequence, stated. A reader should never have to
                            infer why a commercially approved change is not
                            baseline ready. */}
                        {!rdy.ready && (
                          <p className="text-(length:--t-second) text-chart-3 mb-3">
                            {isRtl ? 'غير جاهز لخط الأساس: ' : 'Not baseline ready: '}
                            {(isRtl ? rdy.reasonsAr : rdy.reasons).join(' · ')}
                          </p>
                        )}

                        {stage === 'legacy' ? (
                          <div>
                            <p className="text-(length:--t-second) text-muted-foreground mb-3 max-w-[80ch]">
                              {isRtl
                                ? 'أمر تغيير قديم بلا تقييم تكلفة. سجله التاريخي سليم ولم يُمس. لا يمكنه إحداث أثر جديد على خط الأساس حتى تُقيَّم تكلفته وتُعتمد صراحةً — ولن يُفترض أي رقم نيابةً عنك.'
                                : 'Legacy change order with no cost assessment. Its historical record is valid and untouched. It cannot create a new baseline cost impact until its cost is explicitly assessed and approved — no figure is assumed on your behalf.'}
                            </p>
                            {canEdit && (
                              <button onClick={() => doBeginAssessment(i)} className="btn btn-secondary btn-sm">
                                {isRtl ? 'بدء تقييم التكلفة' : 'Begin cost assessment'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="form-grid">
                              <div className="field">
                                <label className="field-label">
                                  {isRtl ? 'أثر التكلفة المباشرة' : 'Direct Cost Impact'}
                                </label>
                                <input className="field-input font-mono number-ltr" type="number" dir="ltr"
                                  placeholder={isRtl ? 'غير مُقيَّم' : 'not assessed'}
                                  value={costDraft.direct} disabled={!canEdit}
                                  onChange={e => setCostDraft({ ...costDraft, direct: e.target.value })} />
                                <span className="text-(length:--t-micro) text-muted-foreground">
                                  {isRtl ? 'يدخل الموازنة و BAC' : 'Enters Budget AND BAC'}
                                </span>
                              </div>
                              <div className="field">
                                <label className="field-label">
                                  {isRtl ? 'أثر التكلفة غير المباشرة' : 'Indirect Cost Impact'}
                                </label>
                                <input className="field-input font-mono number-ltr" type="number" dir="ltr"
                                  placeholder={isRtl ? 'غير مُقيَّم' : 'not assessed'}
                                  value={costDraft.indirect} disabled={!canEdit}
                                  onChange={e => setCostDraft({ ...costDraft, indirect: e.target.value })} />
                                <span className="text-(length:--t-micro) text-muted-foreground">
                                  {isRtl ? 'يدخل الموازنة فقط — لا يدخل BAC' : 'Enters Budget only — NOT BAC'}
                                </span>
                              </div>
                              {/* ── Q1=C · WHICH BUDGET LINE ALREADY CARRIES THIS? ──
                                  The one question that decides whether a
                                  baseline adds this money or not. Left
                                  unlinked, the cost is outside the register
                                  and the next baseline adds it on top;
                                  linked, the register already holds it and
                                  the baseline adds nothing. Nothing is
                                  inferred — the assessor states it. */}
                              <div className="field">
                                <label className="field-label">
                                  {isRtl ? 'بند الموازنة' : 'Budget Line'}
                                </label>
                                <select
                                  className="field-input"
                                  value={costDraft.budgetLineRef}
                                  disabled={!canEdit}
                                  onChange={e => setCostDraft({ ...costDraft, budgetLineRef: e.target.value })}
                                >
                                  <option value="">
                                    {isRtl ? 'غير مرتبط — يُضاف فوق الموازنة' : 'Not linked — adds on top of Budget'}
                                  </option>
                                  {budgetCategories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                  ))}
                                </select>
                                <span className="text-(length:--t-micro) text-muted-foreground">
                                  {costDraft.budgetLineRef
                                    ? (isRtl ? 'الموازنة تحمل هذه التكلفة — لن تُضاف مرة أخرى'
                                             : 'Budget already carries this — will NOT be added again')
                                    : (isRtl ? 'سيُضاف إلى الموازنة عند اعتماد خط الأساس التالي'
                                             : 'Will be ADDED to Budget by the next baseline')}
                                </span>
                              </div>
                              <div className="field">
                                <label className="field-label">
                                  {isRtl ? 'إجمالي أثر التكلفة' : 'Total Cost Impact'}
                                </label>
                                <div className="font-mono text-(length:--t-body) text-white pt-1.5">
                                  {formatMoney((Number(costDraft.direct) || 0) + (Number(costDraft.indirect) || 0),
                                    { currency: money.base })}
                                </div>
                                <span className="text-(length:--t-micro) text-muted-foreground">
                                  {isRtl ? 'مباشرة + غير مباشرة' : 'DIRECT + INDIRECT'}
                                </span>
                              </div>
                            </div>

                            {/* What was actually filed, versus what is typed above. */}
                            {c && c.assessed && (
                              <p className="text-(length:--t-second) text-muted-foreground mt-2">
                                {isRtl ? 'المُسجَّل: ' : 'On record: '}
                                <span className="font-mono text-white">
                                  {formatMoney(c.directImpact, { currency: money.base })}
                                </span>
                                {isRtl ? ' مباشرة · ' : ' direct · '}
                                <span className="font-mono text-white">
                                  {formatMoney(c.indirectImpact, { currency: money.base })}
                                </span>
                                {isRtl ? ' غير مباشرة · إجمالي ' : ' indirect · total '}
                                <span className="font-mono text-white">
                                  {formatMoney(c.directImpact + c.indirectImpact, { currency: money.base })}
                                </span>
                                {c.assessedBy ? ` · ${isRtl ? 'قيَّمها' : 'by'} ${c.assessedBy}` : ''}
                                {' · '}
                                <span className="text-primary">
                                  {isRtl ? 'أثر BAC: ' : 'BAC impact: '}
                                  {formatMoney(rdy.ready ? c.directImpact : 0, { currency: money.base })}
                                </span>
                              </p>
                            )}
                            {c && c.costApproval === 'rejected' && c.costNote && (
                              <p className="text-(length:--t-second) text-chart-3 mt-1">
                                {isRtl ? 'سبب الرفض: ' : 'Rejection reason: '}{c.costNote}
                              </p>
                            )}

                            {canEdit && (
                              <div className="flex items-center gap-2 flex-wrap mt-3">
                                <button onClick={() => saveAssessment(i)} className="btn btn-secondary btn-sm">
                                  {isRtl ? 'حفظ التقييم' : 'Save assessment'}
                                </button>
                                <button
                                  onClick={() => doApproveCost(i)}
                                  disabled={!c || !c.assessed || c.costApproval === 'approved'}
                                  className="btn btn-primary btn-sm disabled:opacity-40"
                                  title={!c || !c.assessed
                                    ? (isRtl ? 'يجب تقييم التكلفة أولاً' : 'Cost must be assessed first')
                                    : undefined}
                                >
                                  {isRtl ? 'اعتماد التكلفة' : 'Approve cost'}
                                </button>
                                <input className="field-input flex-1 min-w-[160px]"
                                  placeholder={isRtl ? 'سبب الرفض' : 'reason for rejection'}
                                  value={costDraft.note}
                                  onChange={e => setCostDraft({ ...costDraft, note: e.target.value })} />
                                <button
                                  onClick={() => doRejectCost(i)}
                                  disabled={!c || !c.assessed || !costDraft.note.trim()}
                                  className="btn btn-ghost btn-sm disabled:opacity-40"
                                >
                                  {isRtl ? 'رفض التكلفة' : 'Reject cost'}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
