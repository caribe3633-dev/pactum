import React, { useState, useEffect, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useTranslation } from '../../lib/i18n';
import { formatMoney } from '../../lib/utils';
import { Plus, Trash2, Link2, ChevronDown, ChevronUp, Clock, Paperclip, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { kpiMoney, exactMoney } from '../../lib/moneyFormat';
import { EditableNumber, EditableText, EditableSelect } from '../EditableCell';
import ReportButton from '../reporting/ReportButton';
import { normaliseDocUrl } from '../../lib/subcontractCommercial';
import { formatDateOrDash } from '../../lib/dateFormat';
import { fetchSectors } from '../../mock/sectors';
import {
  moneyContext, resolveTxnDate,
  // Phase 3.2 — transaction layer. One rate across every amount on the row,
  // so gross - retention = net still holds after conversion.
  transactionContext, prepareTransactionGroup, transactionFields,
} from '../../lib/moneyEntry';
import { contractCurrencyOf } from '../../lib/projectCurrency';
import { CurrencyBadge, TransactionAmountInput } from '../CurrencyAmount';
// Task 5 — authoritative company link; the projectIds cache can be stale.
import { companyIdOfProject } from '../../lib/projectMaster';
/**
 * PHASE 4 · STEP 6 — claim cost assessment.
 *
 * REUSES the module written for change orders rather than copying it.
 * `changeCost.ts` was deliberately built against a STRUCTURAL shape
 * (`no` / `status` / `cost`) and not against the change-order row type,
 * so a claim satisfies it unchanged. Copying the rules here would create
 * a second definition of "baseline ready" that could drift out of step
 * with the first — the two registers must answer that question
 * identically, so they share one implementation.
 */
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


// ── Types ────────────────────────────────────────────────────────────

interface ClaimRow {
  no: string;
  type: string;
  claimed: number;
  settled: number;
  timeDays: number;
  status: string;
  /**
   * External document link (Drive / SharePoint / any https URL). Optional —
   * legacy rows have none. A URL only; PACTUM never stores the file itself.
   */
  documentUrl?: string;
  /** Claim date. NEW — a rate must be looked up against one. Optional. */
  date?: string;
  /**
   * STEP 12 — the date the TIME grant became effective, captured where
   * the decision is taken. Synced into the Delay Register and never
   * overwritten there afterwards.
   *
   * NOT `date` (the FX transaction date) and NOT `costApprovedAt`: Step 7
   * separated the cost axis from the time axis. Optional and never
   * back-filled, so a legacy approved claim correctly BLOCKS the
   * time-based Indirect EV rather than receiving an invented date.
   */
  eotApprovedAt?: string;
  /**
   * Currency metadata. `claimed` and `settled` above hold CONVERTED amounts,
   * so every existing reader is unaffected. One currency and one rate cover
   * both figures: they are two facets of the same claim.
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

interface DelayRow { id: string; description: string; delayDays: number; costImpact: number; status: string; linkedClaimNos?: string[]; }

const STATUS_OPTS = (t: any) => [
  { value: 'submitted', label: t.submitted   },
  { value: 'review',    label: t.underReview },
  { value: 'approved',  label: t.approved    },
  { value: 'rejected',  label: t.rejected    },
];

function getStatusColor(status: string) {
  switch ((status || '').toLowerCase()) {
    case 'approved': return 'bg-chart-4/10 text-chart-4 border-chart-4/30';
    case 'review':   return 'bg-chart-5/10 text-chart-5 border-chart-5/30';
    case 'rejected': return 'bg-chart-3/10 text-chart-3 border-chart-3/30';
    default:         return 'bg-white/5 text-muted-foreground border-white/10';
  }
}

function getDelayStatusColor(status: string) {
  switch ((status || '').toLowerCase()) {
    case 'approved': return 'text-chart-4';
    case 'review':   return 'text-chart-5';
    case 'rejected': return 'text-chart-3';
    default:         return 'text-muted-foreground';
  }
}

// ── Cross-module back-link panels ─────────────────────────────────────

function LinkedDelaysPanel({ claimNo, delays, ccy }: { claimNo: string; delays: DelayRow[]; ccy: string }) {
  const linked = delays.filter(d => (d.linkedClaimNos || []).includes(claimNo));
  if (linked.length === 0) {
    return (
      <div className="px-5 py-3 bg-black/20 border-t border-white/5">
        <p className="text-(length:--t-second) text-white/20 italic">No delay events have linked this claim. Open the Delay module to create a link.</p>
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

export default function ClaimsModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  const { t, lang } = useTranslation();
  const [data,   setData]   = useState<ClaimRow[]>([]);
  const [delays, setDelays] = useState<DelayRow[]>([]);

  const companyId = useMemo(
    () => companyIdOfProject(project as any, fetchSectors()),
    [project.id],
  );
  const money = useMemo(() => moneyContext(companyId, project.id), [companyId, project.id]);
  /** Project contract currency — the default for a new record. */
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
    const stored = localStorage.getItem(`pactum-claims-${project.id}`);
    if (stored) {
      setData(JSON.parse(stored).map((r: any) => ({ timeDays: 0, ...r })));
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

  const persist = (next: ClaimRow[]) => {
    setData(next);
    localStorage.setItem(`pactum-claims-${project.id}`, JSON.stringify(next));
  };

  const updateField = (index: number, field: keyof ClaimRow, value: any) => {
    persist(data.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  /**
   * ══════════════════════════════════════════════════════════════════
   * COST ACTIONS — identical semantics to the change-order register,
   * because they call the same functions. Each rewrites ONE row and only
   * its `cost` block; `status` (the COMMERCIAL field) is never among the
   * keys written, and no other row is re-saved.
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
    // Empty is not zero. A blank field means "not stated"; saving it as an
    // assessed 0 would be the software inventing a measurement.
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
    no: '', type: '', claimed: '', settled: '', timeDays: '', status: 'submitted',
    documentUrl: '', currency: contractCcy, date: new Date().toISOString().slice(0, 10),
  });
  const [saveErr, setSaveErr] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRow.no) return;
    setSaveErr('');
    // Claimed and settled share ONE rate — converting them separately could
    // break the relationship between them.
    const txn = resolveTxnDate({ date: newRow.date }, ['date']);
    const g = prepareTransactionGroup(txnCtx,
      { claimed: newRow.claimed, settled: newRow.settled }, newRow.currency, txn);
    if (!g.money.resolved) {
      setSaveErr(lang === 'ar'
        ? `لا يوجد سعر صرف من ${newRow.currency} إلى ${txnCtx.reportingCurrency} بتاريخ ${txn.date}. انشر السعر في إدارة العملات أولاً.`
        : `No rate from ${newRow.currency} to ${txnCtx.reportingCurrency} on ${txn.date}. Publish one in Currency Management first.`);
      return;
    }

    const base: ClaimRow = {
      no: newRow.no, type: newRow.type,
      claimed: g.values.claimed, settled: g.values.settled,
      timeDays: Number(newRow.timeDays) || 0, status: newRow.status,
      documentUrl: newRow.documentUrl.trim(),
      date: newRow.date,
    };
    // PHASE 4 · STEP 6 — a NEWLY created claim opens with an empty cost
    // block so it reads "cost assessment required" rather than "legacy".
    // Legacy means "written before this feature existed"; a claim raised
    // today is not that, and without this it would carry the legacy flag
    // forever and sit outside the assessment workflow. (Same defect was
    // found and fixed for change orders in Step 5.)
    persist([...data, beginAssessment({ ...base,
      ...transactionFields({ ...g.money, originalAmount: Number(newRow.claimed) || 0 }) }) as ClaimRow]);
    setNewRow({ no: '', type: '', claimed: '', settled: '', timeDays: '', status: 'submitted',
                documentUrl: '', currency: contractCcy, date: new Date().toISOString().slice(0, 10) });
    setIsAdding(false);
  };

  const handleDelete = (index: number) => persist(data.filter((_, i) => i !== index));

  const toggleRow = (i: number) => setExpandedRow(expandedRow === i ? null : i);

  // Count back-links per claim
  const delayCountFor = (no: string) => delays.filter(d => (d.linkedClaimNos || []).includes(no)).length;

  const totalClaimed = data.reduce((a, b) => a + b.claimed, 0);
  const totalSettled = data.reduce((a, b) => a + b.settled, 0);
  const totalEOT     = data.reduce((a, b) => a + (b.timeDays || 0), 0);

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      <SourceVersionsPanel projectId={project.id} only="claims" canEdit={canEdit} compact />


      {/* 2 · EXECUTIVE SUMMARY */}
      <div className="kpi-strip !grid-cols-2 md:!grid-cols-4">
        <div className="kpi">
          <div className="kpi-k">{t.totalClaimedValue}</div>
          <div className="kpi-v money" title={exactMoney(totalClaimed, money.base)}>{kpiMoney(totalClaimed, money.base)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t.totalSettledValue}</div>
          <div className="kpi-v kpi-v-ok money" title={exactMoney(totalSettled, money.base)}>{kpiMoney(totalSettled, money.base)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t.timeEOTShort}</div>
          <div className="kpi-v kpi-v-gold">{totalEOT}</div>
          <div className="kpi-sub">{t.days}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t.claimNo}</div>
          <div className="kpi-v">{data.length}</div>
        </div>
      </div>

      {/* ── Financial readiness ────────────────────────────────────────────
          Separate from the commercial tiles above, because they measure
          different things. `Total Settled` is commercial agreement; these
          are about whether the cost behind it has been measured and signed.
          A register can be fully settled and have nothing baseline-eligible. */}
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

      {/* Commercially approved but financially incomplete — the actionable
          gap, named. A STATEMENT, not the baseline gate: the blocking rule
          lives in baselineGate.ts and is not duplicated here. */}
      {costSummary.blockedRefs.length > 0 && (
        <div className="ds-card border-chart-3/30 bg-chart-3/[0.05] !py-3">
          <p className="text-(length:--t-second) text-chart-3">
            {isRtl
              ? `${costSummary.blockedRefs.length} مطالبة معتمدة تجارياً لكنها غير جاهزة لخط الأساس: ${costSummary.blockedRefs.join(' · ')}`
              : `${costSummary.blockedRefs.length} commercially approved claim(s) are NOT baseline ready: ${costSummary.blockedRefs.join(' · ')}`}
          </p>
        </div>
      )}

      {/* 5 · CLAIMS REGISTER */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="sec-head !mb-0 flex-1">{t.claimsRegister}</h3>
          <ReportButton reportId="claims" context={{ project, rows: data, reportCurrency: money.base }} />
          {canEdit && (
            <button onClick={() => setIsAdding(!isAdding)} className="btn btn-secondary btn-sm">
              <Plus className="w-3 h-3" /> {t.add}
            </button>
          )}
        </div>

        {/* Add form */}
        {isAdding && canEdit && (
          <form onSubmit={handleAdd} className="ds-card ds-card-tight mb-3">
            <div className="form-grid">
              <div className="field">
                <label className="field-label" data-required>{t.claimNo}</label>
                <input className="field-input font-mono" placeholder="CLM-00X" value={newRow.no} onChange={e => setNewRow({ ...newRow, no: e.target.value })} required dir="ltr" />
              </div>
              <div className="field xl:col-span-2">
                <label className="field-label" data-required>{t.claimType}</label>
                <input className="field-input" placeholder={t.claimType} value={newRow.type} onChange={e => setNewRow({ ...newRow, type: e.target.value })} required />
              </div>
              <TransactionAmountInput
                label={t.valueClaimed}
                amount={newRow.claimed}
                currency={newRow.currency}
                onAmount={v => setNewRow({ ...newRow, claimed: v })}
                onCurrency={v => setNewRow({ ...newRow, currency: v })}
                date={newRow.date}
                fx={money.fx}
                settings={money.settings}
                projectId={project.id}
                onDate={v => setNewRow({ ...newRow, date: v })}
                hideDate
              />
              <div className="field">
                <label className="field-label">
                  {t.valueSettled}
                  {newRow.currency !== money.base && (
                    <span className="text-muted-foreground ms-2 normal-case tracking-normal font-mono">
                      {newRow.currency}
                    </span>
                  )}
                </label>
                <input className="field-input font-mono number-ltr" type="number" placeholder="0" value={newRow.settled} onChange={e => setNewRow({ ...newRow, settled: e.target.value })} dir="ltr" />
              </div>
              {/* Claim date drives the rate lookup. */}
              <div className="field">
                <label className="field-label">
                  {lang === 'ar' ? 'تاريخ المطالبة' : 'Claim Date'}
                  <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                    {lang === 'ar' ? 'يحدد سعر الصرف' : 'sets the FX rate'}
                  </span>
                </label>
                <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                       style={{ colorScheme: 'dark' }} value={newRow.date}
                       onChange={e => setNewRow({ ...newRow, date: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">{t.timeEOTShort}</label>
                <input className="field-input font-mono number-ltr" type="number" placeholder="0" value={newRow.timeDays} onChange={e => setNewRow({ ...newRow, timeDays: e.target.value })} dir="ltr" min="0" />
              </div>
              <div className="field">
                <label className="field-label">{t.status}</label>
                <select className="field-input" value={newRow.status} onChange={e => setNewRow({ ...newRow, status: e.target.value })}>
                  {STATUS_OPTS(t).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {/* Document link. A URL only — the file itself stays where it lives. */}
              <div className="field xl:col-span-2">
                <label className="field-label">{lang === 'ar' ? 'رابط المستند' : 'Document Link'}</label>
                <input className="field-input" placeholder={lang === 'ar' ? 'اختياري' : 'optional'} value={newRow.documentUrl} onChange={e => setNewRow({ ...newRow, documentUrl: e.target.value })} dir="ltr" />
              </div>
            </div>
            {saveErr && <p className="field-error mt-2">{saveErr}</p>}
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
                <th>{t.claimNo}</th>
                <th>{t.claimType}</th>
                {/* Unit read from the project, not typed into i18n. */}
                <th className="money">{t.valueClaimed} ({money.base})</th>
                <th className="money">{t.valueSettled} ({money.base})</th>
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
                <tr><td colSpan={canEdit ? 10 : 9}><div className="ds-empty"><div className="ds-empty-title">{t.noData}</div></div></td></tr>
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
                      <td className="font-mono text-primary font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <EditableText value={row.no} onSave={v => updateField(i, 'no', v)} canEdit={canEdit} />
                          <CurrencyBadge code={row.currency ?? ''} base={money.base} />
                        </span>
                      </td>
                      <td className="text-white max-w-[240px]">
                        <EditableText value={row.type} onSave={v => updateField(i, 'type', v)} canEdit={canEdit} />
                      </td>
                      <td className="money">
                        <EditableNumber value={row.claimed} onSave={v => updateField(i, 'claimed', v)} canEdit={canEdit} display={formatMoney(row.claimed, { currency: money.base })} />
                        {row.currency && row.currency !== money.base && (
                          <span className="block text-(length:--t-micro) font-mono text-muted-foreground mt-0.5">
                            {row.currency} {(row.originalAmount ?? 0).toLocaleString('en-US')} @ {(row.exchangeRate ?? 0).toFixed(4)}
                          </span>
                        )}
                      </td>
                      <td className="money money-pos">
                        <EditableNumber value={row.settled} onSave={v => updateField(i, 'settled', v)} canEdit={canEdit} display={row.settled > 0 ? formatMoney(row.settled, { currency: money.base }) : '—'} />
                      </td>
                      <td className="money">
                        <span className={cn('badge', (row.timeDays || 0) > 0 ? 'badge-gold' : 'badge-neutral')}>
                          <EditableNumber value={row.timeDays || 0} onSave={v => updateField(i, 'timeDays', v)} canEdit={canEdit}
                            display={(row.timeDays || 0) > 0 ? `+${row.timeDays}` : '0'} suffix={` ${t.days}`} />
                        </span>
                        {/* STEP 12 — effective date under the days. No new
                            column; the table is already wide. */}
                        {(row.timeDays || 0) > 0 && (
                          <span className="block text-(length:--t-micro) font-mono text-muted-foreground mt-0.5">
                            {canEdit ? (
                              <input
                                type="date" dir="ltr"
                                value={row.eotApprovedAt || ''}
                                onChange={e => updateField(i, 'eotApprovedAt', e.target.value)}
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
                        <EditableSelect value={row.status} options={STATUS_OPTS(t)} onSave={v => updateField(i, 'status', v)} canEdit={canEdit}
                          className={cn('badge', getStatusColor(row.status))} />
                      </td>
                      {/* ── Cost assessment state ────────────────────────
                          A derived chip, not a second dropdown: the stage
                          follows from the assessment and can never be
                          picked. A selectable "cost approved" would let
                          someone mark a claim approved with no figure
                          behind it. */}
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
                          {stage === 'cost-approved' ? (isRtl ? 'معتمدة' : 'APPROVED')
                            : stage === 'cost-rejected' ? (isRtl ? 'مرفوضة' : 'REJECTED')
                            : stage === 'assessed' ? (isRtl ? 'قيد الاعتماد' : 'PENDING')
                            : stage === 'legacy' ? (isRtl ? 'قديم' : 'LEGACY')
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
                      {/* Document — link plus inline editor. Identical
                          treatment to the certificate and subcontract
                          registers, so a link behaves the same everywhere. */}
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
                            <ReportButton reportId="claim-detail" size="sm" label=""
                              context={{ project, item: row, reportCurrency: money.base }}
                            />
                            <button onClick={() => handleDelete(i)} aria-label={lang === 'ar' ? 'حذف' : 'Delete'} className="text-muted-foreground hover:text-destructive transition-colors p-1.5">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </span>
                        </td>
                      )}
                    </tr>
                    {/* Linked delays panel */}
                    {isExpandedDelays && (
                      <tr className="border-b border-chart-5/10">
                        <td colSpan={canEdit ? 10 : 9} className="p-0">
                          <LinkedDelaysPanel ccy={money.base} claimNo={row.no} delays={delays} />
                        </td>
                      </tr>
                    )}
                    {/* ── Cost assessment panel ─────────────────────────────
                        Emitted by the row it belongs to, so it always opens
                        directly beneath the claim being costed. */}
                    {costRow === i && (
                      <tr className="border-b border-primary/10">
                        <td colSpan={canEdit ? 10 : 9} className="p-0">
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
                                    ? 'مطالبة قديمة بلا تقييم تكلفة. سجلها التاريخي سليم ولم يُمس. لا يمكنها إحداث أثر جديد على خط الأساس حتى تُقيَّم تكلفتها وتُعتمد صراحةً — ولن يُفترض أي رقم نيابةً عنك.'
                                    : 'Legacy claim with no cost assessment. Its historical record is valid and untouched. It cannot create a new baseline cost impact until its cost is explicitly assessed and approved — no figure is assumed on your behalf.'}
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
                                      placeholder={isRtl ? 'غير مُقيَّم' : 'Not Assessed'}
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
                                      placeholder={isRtl ? 'غير مُقيَّم' : 'Not Assessed'}
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
                                    {/* "Not Assessed" rather than a confident 0 —
                                        absent and zero are different facts. */}
                                    <div className="font-mono text-(length:--t-body) text-white pt-1.5">
                                      {costDraft.direct.trim() === '' && costDraft.indirect.trim() === ''
                                        ? <span className="text-chart-3">{isRtl ? 'غير مُقيَّم' : 'Not Assessed'}</span>
                                        : formatMoney((Number(costDraft.direct) || 0) + (Number(costDraft.indirect) || 0),
                                                      { currency: money.base })}
                                    </div>
                                    <span className="text-(length:--t-micro) text-muted-foreground">
                                      {isRtl ? 'مباشرة + غير مباشرة' : 'DIRECT + INDIRECT'}
                                    </span>
                                  </div>
                                </div>

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
