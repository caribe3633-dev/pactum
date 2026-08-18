import React, { useState, useEffect, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useProjectCurrency } from '../../lib/useProjectCurrency';
// A risk impact is money and follows the platform rule: entered in any
// currency, converted at its own date, rate frozen on the row.
import {
  moneyContext, transactionContext, prepareTransaction,
  transactionFields, resolveTxnDate,
} from '../../lib/moneyEntry';
import { TransactionAmountInput } from '../CurrencyAmount';
import { contractCurrencyOf } from '../../lib/projectCurrency';
import { companyIdOfProject } from '../../lib/projectMaster';
import { fetchSectors } from '../../mock/sectors';
import { useTranslation } from '../../lib/i18n';
import { formatMoney, formatPercent } from '../../lib/utils';
import { Plus, Trash2, ShieldAlert, Link2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { kpiMoney, exactMoney } from '../../lib/moneyFormat';
import ReportButton from '../reporting/ReportButton';

// ── Types ────────────────────────────────────────────────────────────

interface RiskRow {
  id: string;
  cause: string;
  event: string;
  effect: string;
  prob: number;
  impact: number;
  status: string;
  category: string;
  owner: string;
  linkedClaimNos?: string[];  // Cross-reference to Claims
  /**
   * Currency metadata for `impact`.
   *
   * `impact` holds the CONVERTED figure so every rollup and the exposure
   * calculation are unaffected; the original and its frozen rate sit
   * beside it, exactly as on a change order or a certificate.
   */
  currency?: string;
  originalAmount?: number;
  exchangeRate?: number;
  transactionDate?: string;
  rateEffectiveDate?: string;
}

interface ClaimRow { no: string; type: string; claimed: number; settled: number; timeDays: number; status: string; }

function getClaimStatusStyle(status: string) {
  switch ((status || '').toLowerCase()) {
    case 'approved': return 'text-chart-4';
    case 'review':   return 'text-chart-5';
    case 'rejected': return 'text-chart-3';
    default:         return 'text-muted-foreground';
  }
}

// ── Linked Claims Panel ───────────────────────────────────────────────

interface LinkedClaimsPanelProps {
  /** SPRINT 3 · R5 — passed down; the panel has no project of its own. */
  ccy: string;
  risk: RiskRow;
  allClaims: ClaimRow[];
  canEdit: boolean;
  onLink: (riskId: string, claimNo: string) => void;
  onUnlink: (riskId: string, claimNo: string) => void;
}

function LinkedClaimsPanel({ risk, allClaims, canEdit, onLink, onUnlink, ccy }: LinkedClaimsPanelProps) {
  const linked       = risk.linkedClaimNos || [];
  const linkedClaims = allClaims.filter(c => linked.includes(c.no));
  const available    = allClaims.filter(c => !linked.includes(c.no));
  const [showSelector, setShowSelector] = useState(false);

  return (
    <div className="px-6 pb-4 pt-2 bg-black/30 border-t border-primary/10">
      <div className="flex items-center justify-between mb-3">
        <span className="text-(length:--t-label) uppercase tracking-widest text-primary/60 font-mono">
          Linked Claims — {linkedClaims.length} linked
        </span>
        {canEdit && available.length > 0 && (
          <button
            onClick={() => setShowSelector(v => !v)}
            className="flex items-center gap-1 text-(length:--t-micro) text-primary/70 hover:text-primary transition-colors border border-primary/20 hover:border-primary/40 px-2 py-1 uppercase tracking-wider"
          >
            <Link2 className="w-3 h-3" />
            {showSelector ? 'Cancel' : 'Link Claim'}
          </button>
        )}
      </div>

      {showSelector && (
        <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {available.map(c => (
            <button
              key={c.no}
              onClick={() => { onLink(risk.id, c.no); setShowSelector(false); }}
              className="flex items-center justify-between text-xs bg-black/40 border border-white/10 hover:border-primary/40 px-3 py-2 text-start transition-colors"
            >
              <span>
                <span className="font-mono text-primary mr-2">{c.no}</span>
                <span className="text-white/60">{c.type}</span>
              </span>
              <span className={cn('text-(length:--t-second) ml-2', getClaimStatusStyle(c.status))}>{c.status}</span>
            </button>
          ))}
        </div>
      )}

      {linkedClaims.length === 0 ? (
        <p className="text-(length:--t-second) text-white/20 italic">No claims linked to this risk.</p>
      ) : (
        <div className="space-y-1.5">
          {linkedClaims.map(c => (
            <div key={c.no} className="flex items-center gap-3 bg-black/20 border border-primary/10 px-3 py-2 text-xs">
              <span className="font-mono text-primary w-20 flex-shrink-0">{c.no}</span>
              <span className="text-white/70 flex-1">{c.type}</span>
              <span className="font-mono text-white/50">{formatMoney(c.claimed, { currency: ccy })}</span>
              <span className={cn('text-(length:--t-second) w-20 text-right', getClaimStatusStyle(c.status))}>{c.status}</span>
              {canEdit && (
                <button onClick={() => onUnlink(risk.id, c.no)} className="text-white/20 hover:text-chart-3 transition-colors ml-1 flex-shrink-0" title="Remove link">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Commercial impact summary */}
      {linkedClaims.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-3 gap-3">
          <div>
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">Claims Value</div>
            <div className="text-xs font-mono text-chart-3">{formatMoney(linkedClaims.reduce((a, c) => a + c.claimed, 0), { currency: ccy })}</div>
          </div>
          <div>
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">Settled</div>
            <div className="text-xs font-mono text-chart-4">{formatMoney(linkedClaims.reduce((a, c) => a + c.settled, 0), { currency: ccy })}</div>
          </div>
          <div>
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">Risk Expected Value</div>
            <div className="text-xs font-mono text-primary">{formatMoney(risk.prob * risk.impact, { currency: ccy })}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

/**
 * Risk categories.
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 3 · R8 — THE FIELD EXISTED, THE CONTROL DID NOT.
 *
 * `RiskRow.category` was declared, stored, and shown in the table — but
 * the add form never collected it, so `newRow` hardcoded 'Technical' and
 * every risk ever entered was filed under it.
 *
 * Phase 3J measured four risks on one project:
 *
 *   Steel price escalation      -> Technical   (it is COMMERCIAL)
 *   Owner-driven scope growth   -> Technical   (it is COMMERCIAL)
 *   Skilled labour shortage     -> Technical   (it is RESOURCE)
 *   Currency exposure           -> Technical   (it is FINANCIAL)
 *
 * A column with one value in every row cannot sort, filter or inform —
 * it is noise occupying screen space. These six are the standard
 * construction-risk families; 'Technical' remains the default because it
 * was the previous behaviour and changing the default would silently
 * re-categorise nothing but confuse a user who expects it.
 * ══════════════════════════════════════════════════════════════════════
 */
const RISK_CATEGORIES: { value: string; en: string; ar: string }[] = [
  { value: 'Technical',   en: 'Technical',   ar: 'فني' },
  { value: 'Commercial',  en: 'Commercial',  ar: 'تجاري' },
  { value: 'Financial',   en: 'Financial',   ar: 'مالي' },
  { value: 'Resource',    en: 'Resource',    ar: 'موارد' },
  { value: 'External',    en: 'External',    ar: 'خارجي' },
  { value: 'Regulatory',  en: 'Regulatory',  ar: 'تنظيمي' },
];

export default function RiskModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  // SPRINT 3 · R5 — the currency this screen's figures are expressed in.
  // Without it every formatMoney(, { currency: ccy }) below fell through to the 'SAR' default.
  // PROJECT SCREENS ARE DENOMINATED IN THE CONTRACT CURRENCY.
  // `.reporting` is the AGGREGATION currency, used when this project is
  // rolled up into a company or portfolio figure. Reading it here is what
  // printed the company's unit on a project's own numbers.
  const ccy = useProjectCurrency(project).base;
  const { t, lang } = useTranslation();
  // Declared AFTER useTranslation: `lang` is read inside the save handler
  // below, and hoisting these above it would be a temporal dead zone.
  const companyId = useMemo(
    () => companyIdOfProject(project as never, fetchSectors()) || '', [project.id]);
  const money = useMemo(() => moneyContext(companyId, project.id), [companyId, project.id]);
  const contractCcy = useMemo(
    () => contractCurrencyOf(project.id, ccy), [project.id, ccy]);
  const txnCtx = useMemo(
    () => transactionContext(companyId, project.id, contractCcy),
    [companyId, project.id, contractCcy]);
  const [saveErr, setSaveErr] = useState('');
  const [data, setData]     = useState<RiskRow[]>([]);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [isAdding, setIsAdding]       = useState(false);
  const [expandedLinks, setExpandedLinks] = useState<string | null>(null);
  const [newRow, setNewRow] = useState({ id: '', event: '', prob: '', impact: '', category: 'Technical', currency: '', date: '' });

  useEffect(() => {
    const stored = localStorage.getItem(`pactum-risk-${project.id}`);
    if (stored) {
      setData(JSON.parse(stored));
    } else {
      // PHASE 3G — no auto-seed. Opening a screen must never CREATE
      // data. An empty store stays empty until the user enters a row or
      // presses "Load Sample Data".
      setData([]);
    }
  }, [project.id]);

  useEffect(() => {
    const raw = localStorage.getItem(`pactum-claims-${project.id}`);
    if (raw) setClaims(JSON.parse(raw));
  }, [project.id]);

  const persist = (next: RiskRow[]) => {
    setData(next);
    localStorage.setItem(`pactum-risk-${project.id}`, JSON.stringify(next));
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRow.id) return;
    /**
     * `impact` is MONEY, and until now it was stored raw and printed
     * against the reporting currency — the same unconverted-figure
     * defect the project registers closed in Sprint 1. It is converted
     * here at its own date with the rate frozen onto the row.
     *
     * `prob` is a PERCENTAGE (0-100), divided by 100 on the way in. The
     * exposure `prob x impact` is therefore a real monetary expectation,
     * not a 1-25 matrix score.
     */
    const txn = resolveTxnDate({ date: newRow.date }, ['date']);
    const m = prepareTransaction(txnCtx, newRow.impact, newRow.currency || contractCcy, txn);
    if (!m.conversion.resolved) {
      setSaveErr(lang === 'ar'
        ? `لا يوجد سعر صرف من ${(newRow.currency || contractCcy)} إلى ${txnCtx.reportingCurrency} بتاريخ ${txn.date}.`
        : `No rate from ${(newRow.currency || contractCcy)} to ${txnCtx.reportingCurrency} on ${txn.date}.`);
      return;
    }
    persist([...data, {
      id: newRow.id, cause: '-', event: newRow.event, effect: '-',
      prob: Number(newRow.prob) / 100 || 0,
      impact: m.value,
      status: 'active', category: newRow.category, owner: 'TBD', linkedClaimNos: [],
      ...transactionFields(m.money),
    }]);
    setSaveErr('');
    setNewRow({ id: '', event: '', prob: '', impact: '', category: 'Technical', currency: '', date: '' });
    setIsAdding(false);
  };

  const handleDelete = (index: number) => persist(data.filter((_, i) => i !== index));

  const handleLinkClaim = (riskId: string, claimNo: string) => {
    persist(data.map(r => {
      if (r.id !== riskId) return r;
      const existing = r.linkedClaimNos || [];
      if (existing.includes(claimNo)) return r;
      return { ...r, linkedClaimNos: [...existing, claimNo] };
    }));
  };

  const handleUnlinkClaim = (riskId: string, claimNo: string) => {
    persist(data.map(r => {
      if (r.id !== riskId) return r;
      return { ...r, linkedClaimNos: (r.linkedClaimNos || []).filter(no => no !== claimNo) };
    }));
  };

  const getSeverity = (prob: number, impact: number) => {
    const expected   = prob * impact;
    const threshold  = project.contractValue * 0.01;
    // Muted severity, matching the shared status palette. Thresholds unchanged.
    if (expected > threshold)       return { label: 'HIGH',   color: 'badge-risk' };
    if (expected > threshold * 0.2) return { label: 'MED',    color: 'badge-warn' };
    return                                 { label: 'LOW',    color: 'badge-ok' };
  };

  const totalExposure = data.reduce((a, b) => a + (b.prob * b.impact), 0);

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      {/* Executive summary — the one figure the board asks for. */}
      <div className="ds-card ds-card-exec !flex-row items-center gap-6">
        <ShieldAlert className="text-chart-3 opacity-80 w-10 h-10 shrink-0 !mt-0" />
        <div className="!mt-0">
          <p className="kpi-k">Total Expected Risk Exposure</p>
          <p className="t-metric money kpi-v-risk" title={exactMoney(totalExposure, ccy)}>{kpiMoney(totalExposure, ccy)}</p>
        </div>
        <div className="!mt-0 ms-auto text-end">
          <p className="kpi-k">Registered Risks</p>
          <p className="t-metric">{data.length}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="sec-head !mb-0 flex-1">Risk Register</h3>
          <ReportButton reportId="risk-register" context={{ project, rows: data, exposure: totalExposure, reportCurrency: ccy }} />
          {canEdit && (
            <button onClick={() => setIsAdding(!isAdding)} className="btn btn-secondary btn-sm">
              <Plus className="w-3 h-3" /> {t.add}
            </button>
          )}
        </div>

        {isAdding && (
          <form onSubmit={handleAdd} className="ds-card ds-card-tight mb-3">
            <div className="form-grid">
              <div className="field">
                <label className="field-label" data-required>Risk ID</label>
                <input className="field-input font-mono" value={newRow.id} onChange={e => setNewRow({ ...newRow, id: e.target.value })} required />
              </div>
              <div className="field xl:col-span-2">
                <label className="field-label" data-required>Risk Event</label>
                <input className="field-input" value={newRow.event} onChange={e => setNewRow({ ...newRow, event: e.target.value })} required />
              </div>
              <div className="field">
                <label className="field-label">Probability %</label>
                <input className="field-input font-mono number-ltr" type="number" value={newRow.prob} onChange={e => setNewRow({ ...newRow, prob: e.target.value })} dir="ltr" />
              </div>
              <div className="field">
                {/* Was the literal "Impact (SAR)" on a screen that can hold
                    any currency. The unit now comes from the selector. */}
                <label className="field-label">{lang === 'ar' ? 'الأثر المالي' : 'Financial Impact'}</label>
                <TransactionAmountInput
                  amount={newRow.impact}
                  currency={newRow.currency || contractCcy}
                  date={newRow.date || new Date().toISOString().slice(0, 10)}
                  onAmount={v => setNewRow({ ...newRow, impact: v })}
                  onCurrency={v => setNewRow({ ...newRow, currency: v })}
                  onDate={v => setNewRow({ ...newRow, date: v })}
                  fx={money.fx}
                  settings={money.settings}
                  projectId={project.id}
                  disabled={!canEdit}
                  hideDate
                />
              </div>
              {/* SPRINT 3 · R8 — the control the stored field never had. */}
              <div className="field">
                <label className="field-label">{lang === 'ar' ? 'التصنيف' : 'Category'}</label>
                <select
                  className="field-input"
                  value={newRow.category}
                  onChange={e => setNewRow({ ...newRow, category: e.target.value })}
                  dir={lang === 'ar' ? 'rtl' : 'ltr'}
                >
                  {RISK_CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{lang === 'ar' ? c.ar : c.en}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setIsAdding(false)} className="btn btn-ghost">Cancel</button>
              <button type="submit" className="btn btn-primary">{t.save}</button>
            </div>
          </form>
        )}

        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th className="w-8" />
                <th>ID</th>
                <th>Event</th>
                <th>Category</th>
                <th className="money">Prob</th>
                <th className="money">Impact</th>
                <th className="money">Expected Value</th>
                <th>Severity</th>
                <th>Claims</th>
                {canEdit && <th className="col-act" />}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => {
                const sev        = getSeverity(row.prob, row.impact);
                const linkedCount = (row.linkedClaimNos || []).length;
                const isExpanded  = expandedLinks === row.id;
                return (
                  <React.Fragment key={i}>
                    <tr>
                      <td className="text-center">
                        <button
                          onClick={() => setExpandedLinks(isExpanded ? null : row.id)}
                          className="text-muted-foreground hover:text-primary transition-colors"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td className="font-mono text-primary">{row.id}</td>
                      <td className="text-white max-w-[240px] truncate" title={row.event}>{row.event}</td>
                      {/* Read-only: this module has no inline-edit
                          infrastructure (no EditableSelect anywhere in it),
                          and introducing one here would be a new pattern
                          rather than a fix. Recorded as a follow-up. */}
                      <td className="text-muted-foreground">{row.category}</td>
                      <td className="money">{formatPercent(row.prob)}</td>
                      <td className="money">{formatMoney(row.impact, { currency: ccy })}</td>
                      <td className="money">{formatMoney(row.prob * row.impact, { currency: ccy })}</td>
                      <td>
                        <span className={cn('badge', sev.color)}>{sev.label}</span>
                      </td>
                      {/* Claims chip */}
                      <td>
                        <button
                          onClick={() => setExpandedLinks(isExpanded ? null : row.id)}
                          aria-expanded={isExpanded}
                          aria-label={`Linked claims (${linkedCount})`}
                          className={cn('badge cursor-pointer', linkedCount > 0 ? 'badge-gold' : 'badge-neutral')}
                        >
                          <Link2 className="w-3 h-3" />
                          {linkedCount}
                        </button>
                      </td>
                      {canEdit && (
                        <td className="col-act">
                          <button onClick={() => handleDelete(i)} aria-label="Delete" className="text-muted-foreground hover:text-destructive transition-colors p-1.5">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-primary/10">
                        <td colSpan={canEdit ? 10 : 9} className="p-0">
                          <LinkedClaimsPanel ccy={ccy}
                            risk={row}
                            allClaims={claims}
                            canEdit={canEdit}
                            onLink={handleLinkClaim}
                            onUnlink={handleUnlinkClaim}
                          />
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
