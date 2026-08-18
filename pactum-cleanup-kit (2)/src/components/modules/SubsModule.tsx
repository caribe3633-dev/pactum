import React, { useState, useEffect, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useProjectCurrency } from '../../lib/useProjectCurrency';
import { useTranslation } from '../../lib/i18n';
import { formatMoney, formatPercent } from '../../lib/utils';
import { ChevronDown, ChevronUp, HardHat, Plus, Trash2, Star, Building2, Link2, Receipt, Briefcase, ExternalLink } from 'lucide-react';
import { useLocation } from 'wouter';
import { cn } from '../../lib/utils';
import { EditableNumber, EditableText, EditableSelect, EditableDate } from '../EditableCell';
import { formatDateOrDash } from '../../lib/dateFormat';
import { fetchSectors } from '../../mock/sectors';
import { readRegistry } from '../../lib/subcontractors';
import { deleteCommercial } from '../../lib/subcontractCommercial';
import SubCommercialPanel from '../SubCommercialPanel';
import SubContractSummary from '../SubContractSummary';
import { readCommercial, rollupCommercial, currentContractValue } from '../../lib/subcontractCommercial';
import {
  evaluateAssignment, deletePerf, CATEGORY_META,
} from '../../lib/subPerformance';
import {
  computeSubLd, computeSubSchedule, readSyncedCommercial,
} from '../../lib/subcontractCommercial';
import ReportButton from '../reporting/ReportButton';
import {
  moneyContext, resolveTxnDate,
  // Phase 3.2 — transaction layer.
  transactionContext, prepareTransaction, prepareTransactionGroup, transactionFields,
} from '../../lib/moneyEntry';
import { contractCurrencyOf } from '../../lib/projectCurrency';
import { CurrencyBadge, TransactionAmountInput, NativeAmount } from '../CurrencyAmount';
// Task 5 — authoritative company link; the projectIds cache can be stale.
import { companyIdOfProject } from '../../lib/projectMaster';

interface SubcontractorRecord {
  id: string;
  /**
   * Immutable link to the Company Subcontractor Registry.
   * Written by every NEW assignment. Absent on legacy rows, which
   * continue resolving by `code`. Never migrated automatically.
   */
  registryInternalId?: string;
  company: string;
  code: string;
  trade: string;
  contactName: string;
  contractValue: number;
  retention: number;
  progressPct: number;
  delayDays: number;
  status: string;
  performanceScore: number;
  /**
   * Currency metadata. `contractValue` holds the CONVERTED figure, so the
   * commercial engine, the KPI engine and every rollup are unaffected.
   */
  currency?: string;
  originalAmount?: number;
  exchangeRate?: number;
  transactionDate?: string;
  rateEffectiveDate?: string;
  convertedAt?: string;
  dateSource?: string;
}

interface SubCertRow {
  id: string;
  certNo: string;
  period: string;
  /**
   * Currency metadata, mirroring the owner-certificate contract.
   * `grossAmount` / `retentionHeld` hold the CONVERTED figures and share
   * one rate, so gross - retention = net survives conversion exactly.
   */
  currency?: string;
  originalAmount?: number;
  retentionOriginal?: number;
  exchangeRate?: number;
  transactionDate?: string;
  rateEffectiveDate?: string;
  grossAmount: number;
  retentionHeld: number;
  netPayable: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  /** Date the certificate was submitted. Optional — legacy rows have none. */
  submissionDate?: string;
  /** Date payment was actually made. Optional. */
  paymentDate?: string;
  /**
   * External document link (Google Drive / Mega / SharePoint / any https URL).
   * Local file paths are NOT supported: browsers block file:/// navigation
   * from a web page, so such a link would silently do nothing.
   */
  documentUrl?: string;
}

const STATUS_OPTS = [
  { value: 'active', label: 'Active' },
  { value: 'mobilizing', label: 'Mobilizing' },
  { value: 'demobilized', label: 'Demobilized' },
  { value: 'completed', label: 'Completed' },
];
const CERT_STATUS_OPTS = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'certified', label: 'Certified' },
  { value: 'paid', label: 'Paid' },
];

function getCertStatusStyle(s: string) {
  switch (s) {
    case 'paid': return 'bg-chart-4/10 text-chart-4 border-chart-4/30';
    case 'certified': return 'bg-primary/10 text-primary border-primary/30';
    default: return 'bg-white/5 text-muted-foreground border-white/10';
  }
}

function getPerformanceColor(score: number) {
  if (score >= 80) return 'text-chart-4';
  if (score >= 60) return 'text-chart-5';
  return 'text-chart-3';
}

/**
 * Only http/https links are turned into hyperlinks.
 * A local path (file:///, C:\...) is stored but never linked — the browser
 * refuses to open it from a web page, so a dead link would be misleading.
 */
function isExternalUrl(v?: string): boolean {
  if (!v) return false;
  return /^https?:\/\//i.test(v.trim());
}

/** Short label for a long URL: the host, or the last path segment. */
function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (/drive\.google/i.test(host)) return 'Google Drive';
    if (/mega\./i.test(host)) return 'Mega';
    if (/sharepoint|onedrive/i.test(host)) return 'SharePoint';
    if (/dropbox/i.test(host)) return 'Dropbox';
    return host;
  } catch {
    return 'Document';
  }
}

export default function SubsModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  const { t, lang } = useTranslation();
  // SPRINT 3 · R5 — passed to SubContractSummary, which is pure
  // presentation and cannot resolve a currency itself.
  // PROJECT SCREENS ARE DENOMINATED IN THE CONTRACT CURRENCY.
  // `.reporting` is the AGGREGATION currency, used when this project is
  // rolled up into a company or portfolio figure. Reading it here is what
  // printed the company's unit on a project's own numbers.
  const ccy = useProjectCurrency(project).base;
  const [subs, setSubs] = useState<SubcontractorRecord[]>([]);
  const [certs, setCerts] = useState<Record<string, SubCertRow[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [, setLocation] = useLocation();
  // Owning company — same derivation ProjectDashboardPage uses for breadcrumbs.
  // Declared BEFORE any state that reads from it: a const in a component body
  // is in its temporal dead zone until this line executes, so a useState
  // initialiser placed above would throw on first render.
  const companyId = useMemo(
    // Task 5 — project.companyId is authoritative; the projectIds cache
    // can be stale and silently resolved to '' -> SAR.
    () => companyIdOfProject(project as any, fetchSectors()),
    [project.id, (project as any).companyId, (project as any).sectorId],
  );

  const money = useMemo(() => moneyContext(companyId ?? '', project.id), [companyId, project.id]);
  /** Project contract currency — the default for a new subcontract. */
  const contractCcy = useMemo(
    () => contractCurrencyOf(project.id, money.base), [project.id, money.base]);
  const txnCtx = useMemo(
    () => transactionContext(companyId ?? '', project.id, contractCcy),
    [companyId, project.id, contractCcy]);
  const [saveErr, setSaveErr] = useState('');

  const [newSub, setNewSub] = useState({
    registryInternalId: '', trade: '', contractValue: '', status: 'active',
    currency: contractCcy,
    // Rate date only. Not shown as a field — see the note on the form.
    date: new Date().toISOString().slice(0, 10),
  });

  const registry = useMemo(
    () => (companyId ? readRegistry(companyId) : []),
    [companyId, isAdding],
  );

  // Which inner view is open per subcontract: certificates | commercial
  const [subView, setSubView] = useState<Record<string, 'certs' | 'commercial'>>({});
  // Bumped whenever the commercial panel writes, so card summaries re-read.
  const [commercialVersion, setCommercialVersion] = useState(0);

  /**
   * Project Delay Register rows, offered as REFERENCE options inside each
   * subcontract's own delay register. Read-only — the project register is
   * never modified from here.
   */
  const projectDelays = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(`pactum-delays-${project.id}`) || '[]');
      return Array.isArray(raw)
        ? raw.map((r: any) => ({ id: String(r.id || ''), description: String(r.description || '') }))
             .filter((r: any) => r.id)
        : [];
    } catch {
      return [];
    }
  }, [project.id, expanded]);

  /**
   * Live project position, handed to every subcontract panel so its monthly
   * windows can record the project's figures for the same month. Read-only.
   */
  const projectSnapshot = useMemo(() => {
    try {
      const rows = JSON.parse(localStorage.getItem(`pactum-delays-${project.id}`) || '[]');
      const list: any[] = Array.isArray(rows) ? rows : [];
      const totalDelay = list.reduce((a, r) => a + (Number(r.delayDays) || 0), 0);
      const approvedEot = list.filter(r => r.status === 'approved')
        .reduce((a, r) => a + (Number(r.eotDays) || 0), 0);
      return {
        plannedFinish: project.contractualCompletion || '',
        forecastFinish: project.approvedCompletion || '',
        approvedFinish: project.approvedCompletion || '',
        currentVariance: totalDelay - approvedEot,
        totalDelay: Number(project.delayDays) || 0,
        approvedEot,
        unmitigatedDelay: totalDelay - approvedEot,
        recoveryRequired: Math.max(0, totalDelay - approvedEot),
        ldExposure: 0,
        costImpact: list.reduce((a, r) => a + (Number(r.costImpact) || 0), 0),
        delayEventCount: list.length,
      };
    } catch {
      return undefined;
    }
  }, [project.id, project.delayDays, project.contractualCompletion, project.approvedCompletion, expanded]);

  const [addingCertFor, setAddingCertFor] = useState<string | null>(null);
  const [newCert, setNewCert] = useState({
    certNo: '', period: '', grossAmount: '', retentionHeld: '', currency: '',
    submissionDate: '', paymentDate: '', documentUrl: '',
  });

  // READ ONLY. Storage is created by the project lifecycle
  // (lib/projectLifecycle.ts), never by opening this tab.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`pactum-subs-${project.id}`);
      setSubs(stored ? JSON.parse(stored) : []);

      const certStored = localStorage.getItem(`pactum-sub-certs-${project.id}`);
      setCerts(certStored ? JSON.parse(certStored) : {});
    } catch {
      setSubs([]);
      setCerts({});
    }
  }, [project.id]);

  /**
   * Deep link from the Subcontractor Dashboard.
   * The dashboard dispatches `pactum-navigate` with { projectId, tab:'subs', subId }.
   * ProjectDashboard switches the tab; this module opens and scrolls to the row.
   * Read-only navigation — no data is created or changed.
   */
  useEffect(() => {
    const handleNav = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.projectId !== project.id || !d.subId) return;
      setExpanded(d.subId);
      if (d.view === 'commercial' || d.view === 'certs') {
        setSubView(prev => ({ ...prev, [d.subId]: d.view }));
      }
      // The tab may still be mounting — retry briefly, then give up.
      let tries = 0;
      const tick = () => {
        const el = document.getElementById(`sub-${d.subId}`);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        if (++tries < 20) setTimeout(tick, 50);
      };
      tick();
    };
    window.addEventListener('pactum-navigate', handleNav);
    return () => window.removeEventListener('pactum-navigate', handleNav);
  }, [project.id]);

  const persistSubs = (next: SubcontractorRecord[]) => {
    setSubs(next);
    localStorage.setItem(`pactum-subs-${project.id}`, JSON.stringify(next));
  };
  const persistCerts = (next: Record<string, SubCertRow[]>) => {
    setCerts(next);
    localStorage.setItem(`pactum-sub-certs-${project.id}`, JSON.stringify(next));
  };

  const updateSubField = (id: string, field: keyof SubcontractorRecord, value: any) => {
    persistSubs(subs.map(s => s.id === id ? { ...s, [field]: value } : s));
  };
  const updateCertField = (subId: string, idx: number, field: keyof SubCertRow, value: any) => {
    const updated = { ...certs, [subId]: (certs[subId] || []).map((c, i) => i === idx ? { ...c, [field]: value } : c) };
    persistCerts(updated);
  };

  /**
   * Assigns an EXISTING registry subcontractor to this project.
   * Never creates master data — company name and code are copied from the
   * registry as display values only.
   */
  const handleAssignSub = (e: React.FormEvent) => {
    e.preventDefault();
    const record = registry.find(r => r.internalId === newSub.registryInternalId);
    if (!record) return;

    setSaveErr('');
    /**
     * THE RATE DATE IS THE COMMENCEMENT DATE, WHERE ONE EXISTS.
     *
     * The form no longer asks for a separate assignment date: the
     * subcontract's commencement date is the same fact, entered once on
     * its schedule. A brand-new assignment usually has no schedule yet,
     * and `resolveTxnDate` falls back to today with `dateSource: 'today'`
     * recorded on the row — so the provenance says which was used
     * instead of implying a date that was never given.
     */
    const txn = resolveTxnDate({ date: newSub.date }, ['date']);
    const m = prepareTransaction(txnCtx, newSub.contractValue, newSub.currency, txn);
    if (!m.money.resolved) {
      setSaveErr(lang === 'ar'
        ? `لا يوجد سعر صرف من ${newSub.currency} إلى ${txnCtx.reportingCurrency} بتاريخ ${txn.date}.`
        : `No rate from ${newSub.currency} to ${txnCtx.reportingCurrency} on ${txn.date}.`);
      return;
    }

    const sub: SubcontractorRecord = {
      id: `sub-${Date.now()}`,
      registryInternalId: record.internalId,   // immutable link
      company: record.companyName,             // display only — registry owns it
      code: record.subcontractorId,            // display only — registry owns it
      trade: newSub.trade,
      contactName: '',
      contractValue: m.value,
      retention: m.value * 0.1,
      progressPct: 0,
      delayDays: 0,
      status: newSub.status,
      /**
       * NOT COLLECTED, DERIVED.
       *
       * The stored field is kept because `subcontractors.ts` and the
       * reports read it, but it is no longer a number someone typed. A
       * newly assigned subcontract has, by definition, not been
       * evaluated: it scores 0 until the KPI engine has something to
       * measure. Writing 80 here — the old default — asserted a passing
       * grade for work that had not started.
       */
      performanceScore: 0,
    };
    const nextSubs = [...subs, { ...sub, ...transactionFields(m.money) } as SubcontractorRecord];
    persistSubs(nextSubs);
    persistCerts({ ...certs, [sub.id]: [] });
    setNewSub({ registryInternalId: '', trade: '', contractValue: '', status: 'active',
                currency: contractCcy,
                date: new Date().toISOString().slice(0, 10) });
    setIsAdding(false);
  };

  const handleDeleteSub = (id: string) => {
    persistSubs(subs.filter(s => s.id !== id));
    const { [id]: _, ...rest } = certs;
    persistCerts(rest);
    // Commercial records are scoped to this subcontract — remove with it.
    deleteCommercial(project.id, id);
    // Same for the performance evaluation: it belongs to this subcontract.
    deletePerf(project.id, id);
  };

  const handleAddCert = (e: React.FormEvent, subId: string) => {
    e.preventDefault();
    /**
     * A SUBCONTRACT CERTIFICATE IS A TRANSACTION.
     *
     * Gross and retention were stored with a bare `Number(...)` and shown
     * against the reporting currency, so a certificate raised in the
     * subcontract's own currency printed under the wrong unit.
     *
     * Both legs are converted through ONE call and therefore share ONE
     * rate, which is what keeps `gross - retention = net` exact after
     * conversion instead of drifting by a rounding step.
     */
    const sub = (subs as SubcontractorRecord[]).find(x => x.id === subId);
    const certCcy = (newCert.currency || sub?.currency || contractCcy || '').toUpperCase();
    const txn = resolveTxnDate({ date: newCert.submissionDate }, ['date']);
    const rawGross = Number(newCert.grossAmount) || 0;
    const rawRet = Number(newCert.retentionHeld) || rawGross * 0.1;
    const g = prepareTransactionGroup(txnCtx, { gross: rawGross, retention: rawRet }, certCcy, txn);
    if (!g.money.resolved) {
      setSaveErr(lang === 'ar'
        ? `لا يوجد سعر صرف من ${certCcy} إلى ${txnCtx.reportingCurrency} بتاريخ ${txn.date}.`
        : `No rate from ${certCcy} to ${txnCtx.reportingCurrency} on ${txn.date}.`);
      return;
    }
    const gross = g.values.gross;
    const ret = g.values.retention;
    const net = gross - ret;
    const cert: SubCertRow = {
      id: `cert-${subId}-${Date.now()}`, certNo: newCert.certNo, period: newCert.period,
      grossAmount: gross, retentionHeld: ret, netPayable: net, paidAmount: 0, remainingAmount: net, status: 'submitted',
      submissionDate: newCert.submissionDate,
      paymentDate: newCert.paymentDate,
      documentUrl: newCert.documentUrl.trim(),
      ...transactionFields({ ...g.money, originalAmount: rawGross }),
      retentionOriginal: rawRet,
    } as SubCertRow;
    persistCerts({ ...certs, [subId]: [...(certs[subId] || []), cert] });
    setNewCert({ certNo: '', period: '', grossAmount: '', retentionHeld: '', submissionDate: '', paymentDate: '', documentUrl: '', currency: '' });
    setSaveErr('');
    setAddingCertFor(null);
  };

  const handleDeleteCert = (subId: string, idx: number) => {
    persistCerts({ ...certs, [subId]: (certs[subId] || []).filter((_, i) => i !== idx) });
  };

  // Portfolio summary
  const totalContractValue = subs.reduce((a, b) => a + b.contractValue, 0);
  const totalCertifiedValue = Object.values(certs).flat().filter((c: any) => c.status === 'paid' || c.status === 'certified').reduce((a: number, c: any) => a + c.grossAmount, 0);
  const totalOutstanding = Object.values(certs).flat().reduce((a: number, c: any) => a + (c.remainingAmount || 0), 0);

  return (
    <div className="pg-stack ds-page">

      {/* Header stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="ds-card ds-card-raised bg-black/30 p-5 border-t-primary border-t-2">
          <div className="text-(length:--t-label) uppercase text-muted-foreground mb-1">Total Sub Contract Value</div>
          <div className="text-xl font-mono text-primary number-ltr">{formatMoney(totalContractValue, { currency: money.base })}</div>
        </div>
        <div className="ds-card ds-card-raised bg-black/30 p-5 border-t-chart-4 border-t-2">
          <div className="text-(length:--t-label) uppercase text-muted-foreground mb-1">Total Certified to Date</div>
          <div className="text-xl font-mono text-chart-4 number-ltr">{formatMoney(totalCertifiedValue, { currency: money.base })}</div>
        </div>
        <div className="ds-card ds-card-raised bg-black/30 p-5 border-t-chart-3 border-t-2">
          <div className="text-(length:--t-label) uppercase text-muted-foreground mb-1">Outstanding Balance</div>
          <div className="text-xl font-mono text-chart-3 number-ltr">{formatMoney(totalOutstanding, { currency: money.base })}</div>
        </div>
      </div>

      {/* Title + Add */}
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-serif uppercase tracking-widest text-primary">
          {lang === 'ar' ? 'إدارة مقاولي الباطن' : 'Subcontractor Management'}
        </h3>
        {canEdit && (
          <button onClick={() => setIsAdding(!isAdding)} className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 text-xs hover:bg-primary hover:text-primary-foreground transition-colors uppercase tracking-wider">
            <Link2 className="w-3 h-3" /> {lang === 'ar' ? 'إسناد مقاول باطن' : 'Assign Existing Subcontractor'}
          </button>
        )}
      </div>

            {isAdding && (
        registry.length === 0 ? (
          /* No registry records — creation belongs to the Company Registry only. */
          <div className="ds-card ds-card-raised bg-black/60 p-6 text-center">
            <Building2 className="w-8 h-8 text-primary/40 mx-auto mb-3" />
            <p className="text-sm text-white mb-1">
              {lang === 'ar' ? 'لا يوجد مقاولو باطن في سجل الشركة' : 'No subcontractors in the company registry'}
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              {lang === 'ar'
                ? 'يتم إنشاء مقاولي الباطن من سجل الشركة فقط.'
                : 'Subcontractors are created in the Company Registry only.'}
            </p>
            <button
              type="button"
              disabled={!companyId}
              onClick={() => companyId && setLocation(`/company/${companyId}/subcontractors`)}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-xs uppercase tracking-wider disabled:opacity-40"
            >
              <Building2 className="w-3 h-3" />
              {lang === 'ar' ? 'إنشاء في سجل الشركة' : 'Create in Company Registry'}
            </button>
          </div>
        ) : (
        <form onSubmit={handleAssignSub} className="ds-card ds-card-raised bg-black/60 p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          <select
            value={newSub.registryInternalId}
            onChange={e => setNewSub({ ...newSub, registryInternalId: e.target.value })}
            className="col-span-2 bg-black border border-white/10 px-3 py-1.5 text-sm text-white"
            required
          >
            <option value="">{lang === 'ar' ? '— اختر من سجل الشركة —' : '— Select from Company Registry —'}</option>
            {registry.map(r => (
              <option key={r.internalId} value={r.internalId}>
                {r.subcontractorId} — {r.companyName}
              </option>
            ))}
          </select>
          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-label) uppercase tracking-wider text-muted-foreground">
              {lang === 'ar' ? 'التخصص' : 'Trade Specialty'}
            </label>
            <input value={newSub.trade} onChange={e => setNewSub({ ...newSub, trade: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm" />
          </div>
          <div className="col-span-2">
            <TransactionAmountInput
              label={lang === 'ar' ? 'قيمة العقد' : 'Contract Value'}
              amount={newSub.contractValue}
              currency={newSub.currency}
              date={newSub.date}
              onAmount={v => setNewSub({ ...newSub, contractValue: v })}
              onCurrency={v => setNewSub({ ...newSub, currency: v })}
              onDate={v => setNewSub({ ...newSub, date: v })}
              fx={money.fx}
              settings={money.settings}
              projectId={project.id}
              hideDate
            />
            {/* The date is not asked for twice. Saying which one the rate
                comes from is the part the user actually needs. */}
            <p className="text-(length:--t-micro) text-white/45 mt-1">
              {lang === 'ar'
                ? 'سعر الصرف يُقرأ بتاريخ مباشرة العقد من الجدول الزمني للباطن — أو بتاريخ اليوم إن لم يُدخل بعد.'
                : "The rate is read on the subcontract's commencement date from its schedule — or today's date if none is entered yet."}
            </p>
          </div>
          {/*
            TWO FIELDS DELETED, NOT HIDDEN.

            ────────────────────────────────────────────────────────────
            PERFORMANCE SCORE was a manual entry defaulting to 80. The
            platform already OWNS a KPI engine (`evaluateAssignment`),
            and the card badge has always read it. So the form was
            collecting a second, competing score: a subcontractor nobody
            had evaluated still shipped a confident 80 into the company
            ranking, and a real evaluation entered later never displaced
            it. A figure the system derives is not a question to ask the
            user. The field is gone and the engine is the only source.

            ASSIGNMENT DATE duplicated the Commencement Date, which is
            entered on the subcontract's own schedule. Two inputs for one
            fact is two chances to disagree. The FX rate now resolves
            from the subcontract's commencement date when one exists,
            and from today only when it does not — stated in the note
            under Contract Value rather than asked for again here.
            ────────────────────────────────────────────────────────────
          */}
          <div className="flex flex-col gap-1">
            <label className="text-(length:--t-label) uppercase tracking-wider text-muted-foreground">
              {lang === 'ar' ? 'الحالة' : 'Status'}
            </label>
            <select value={newSub.status} onChange={e => setNewSub({ ...newSub, status: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm text-white">
              {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {saveErr && (
            <p className="col-span-2 md:col-span-3 field-error">{saveErr}</p>
          )}
          <div className="col-span-2 md:col-span-3 flex items-center gap-2 justify-end">
            <button
              type="button"
              disabled={!companyId}
              onClick={() => companyId && setLocation(`/company/${companyId}/subcontractors`)}
              className="me-auto text-(length:--t-body) text-primary/60 hover:text-primary underline disabled:opacity-40"
            >
              {lang === 'ar' ? 'إنشاء في سجل الشركة' : 'Create in Company Registry'}
            </button>
            <button type="button" onClick={() => setIsAdding(false)} className="px-3 py-1.5 text-xs border border-white/10 text-muted-foreground hover:text-white">Cancel</button>
            <button type="submit" className="bg-primary text-primary-foreground px-4 py-1.5 text-xs uppercase tracking-wider">
              {lang === 'ar' ? 'إسناد' : 'Assign'}
            </button>
          </div>
        </form>
        )
      )}

      {/* Sub cards */}
      {subs.map((sub) => {
        const subCerts = certs[sub.id] || [];
        const paidTotal = subCerts.filter(c => c.status === 'paid').reduce((a, c) => a + c.paidAmount, 0);
        const certified = subCerts.filter(c => c.status === 'certified').reduce((a, c) => a + c.netPayable, 0);
        const outstanding = subCerts.reduce((a, c) => a + (c.remainingAmount || 0), 0);
        // Cumulative certified — matches the header card and the dashboard rollup.
        const certifiedToDate = subCerts
          .filter(c => c.status === 'certified' || c.status === 'paid')
          .reduce((a, c) => a + (c.grossAmount || 0), 0);
        const retentionHeldTotal = subCerts.reduce((a, c) => a + (c.retentionHeld || 0), 0);
        const isExpanded = expanded === sub.id;
        const view = subView[sub.id] || 'certs';
        // Project-scoped commercial rollup for THIS subcontract.
        // `commercialVersion` is read so edits in the panel refresh this card.
        void commercialVersion;
        const commercial = readSyncedCommercial(project.id, sub.id);
        const roll = rollupCommercial(commercial);
        const currentContract = currentContractValue(sub.contractValue, roll);
        // KPI badge value comes from the Performance KPI Engine.
        const perf = evaluateAssignment(project.id, sub.id, sub.contractValue);
        const perfScore = perf.scored ? perf.score : null;
        // Read once here so the summary strip and the report agree exactly.
        const subLd = computeSubLd(commercial, roll);
        const subSched = computeSubSchedule(commercial, subLd);

        return (
          <div
            key={sub.id}
            id={`sub-${sub.id}`}
            className="ds-card ds-card-raised overflow-hidden transition-all duration-300 scroll-mt-24"
          >
            {/* Header */}
            <div className="p-4 md:p-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between cursor-pointer hover:bg-black/40" onClick={() => setExpanded(isExpanded ? null : sub.id)}>
              <div className="flex items-center gap-4 flex-1">
                <div className="w-10 h-10 bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  <HardHat className="w-5 h-5 text-primary/70" />
                </div>
                                <div>
                  <h4 className="text-base font-serif text-white leading-tight flex items-center gap-2">
                    {sub.trade}
                    <CurrencyBadge code={sub.currency ?? ''} base={money.base} />
                  </h4>
                  <div className="flex items-center gap-1 text-(length:--t-label) uppercase tracking-widest text-primary/70 mt-0.5">
                    <span>{lang === 'ar' ? 'مقاول الباطن المسؤول:' : 'Responsible Subcontractor:'}</span>
                    <span className="inline-block px-1" title={lang === 'ar' ? 'يُدار من سجل الشركة' : 'Managed in Company Registry'}>{sub.company}</span>
                    <span>—</span>
                    <span>{lang === 'ar' ? 'الكود:' : 'Code:'}</span>
                    <span className="inline-block px-1 font-mono" title={lang === 'ar' ? 'يُدار من سجل الشركة' : 'Managed in Company Registry'}>{sub.code}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 w-full md:w-auto">
                {/* Progress */}
                <div className="flex-1 md:w-40">
                  <div className="flex justify-between text-(length:--t-second) text-muted-foreground mb-1">
                    <span>Progress</span>
                    <span className="money">{formatPercent(sub.progressPct)}</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-sm overflow-hidden">
                    <div className={cn('h-full', sub.delayDays > 0 ? 'bg-chart-5' : 'bg-chart-4')} style={{ width: `${sub.progressPct * 100}%` }} />
                  </div>
                </div>

                {/* Performance score — same badge, value from the KPI Engine */}
                <div className="text-center hidden md:block" title={perf.scored ? `Grade ${perf.grade.grade}` : 'Not evaluated'}>
                  <Star className={cn('w-4 h-4 mx-auto mb-0.5', getPerformanceColor(perfScore ?? 0))} />
                  <div className={cn('text-sm font-mono font-bold number-ltr', getPerformanceColor(perfScore ?? 0))}>
                    {perfScore === null ? '—' : perfScore}
                  </div>
                  <div className="text-(length:--t-label) text-muted-foreground uppercase">KPI</div>
                </div>

                {/* Delay */}
                <div className="text-center hidden md:block">
                  <div className={cn('text-sm font-mono font-bold number-ltr', sub.delayDays > 0 ? 'text-chart-5' : 'text-chart-4')}>
                    {sub.delayDays > 0 ? `+${sub.delayDays}d` : '✓'}
                  </div>
                  <div className="text-(length:--t-label) text-muted-foreground uppercase">Delay</div>
                </div>

                {/* Status badge */}
                <span className={cn('text-(length:--t-second) uppercase font-bold tracking-widest px-2 py-1 border',
                  sub.status === 'active' ? 'border-chart-4/40 text-chart-4 bg-chart-4/10' :
                  sub.status === 'completed' ? 'border-primary/40 text-primary bg-primary/10' :
                  'border-white/10 text-muted-foreground bg-white/5'
                )}>{sub.status}</span>

                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              </div>
            </div>

            {/* Expanded Detail */}
            {isExpanded && (
              <div className="border-t border-white/5 bg-black/40">
                {/* Contract summary — same component the dashboard uses */}
                <SubContractSummary ccy={ccy}
                  originalContract={sub.contractValue}
                  /* The value as SIGNED. A subcontract agreed in USD is
                     certified and paid in USD; showing only the converted
                     project-currency figure discards the number both
                     parties contracted on. */
                  contractNative={
                    <NativeAmount
                      row={sub}
                      field="contractValue"
                      displayCurrency={ccy}
                      companyId={companyId ?? ''}
                    />
                  }
                  approvedChangeOrders={roll.approvedChangeOrders}
                  pendingChangeOrders={roll.pendingChangeOrders}
                  currentContract={currentContract}
                  approvedClaims={roll.approvedClaims}
                  approvedEotDays={roll.approvedEotDays}
                  certified={certifiedToDate}
                  paid={paidTotal}
                  outstanding={outstanding}
                  retentionHeld={retentionHeldTotal}
                  retentionContract={sub.retention}
                  ldExposure={subLd.ldExposure}
                  approvedFinish={subSched.approvedFinish}
                  commencementDate={subSched.commencementDate}
                  /* Contract Value is owned here — this is the only place it
                     can be typed. Every other view receives it read-only. */
                  onEditContractValue={v => updateSubField(sub.id, 'contractValue', v)}
                  canEdit={canEdit}
                  variant="full"
                  className="border-b border-white/5"
                />

                {/* One row: the view switcher on the leading edge, Export on
                    the trailing edge. They used to occupy two stacked rows,
                    which is what opened the gap between the summary strip and
                    the tabs. Both edges now line up with the p-4 content. */}
                <div className="flex items-center justify-between gap-2 flex-wrap px-4 pt-4">
                  <div className="flex items-center gap-2">
                    {([
                      { id: 'certs' as const, icon: Receipt, en: 'Certificates', ar: 'الشهادات' },
                      { id: 'commercial' as const, icon: Briefcase, en: 'Commercial', ar: 'الإدارة التجارية' },
                    ]).map(v => (
                      <button
                        key={v.id}
                        onClick={() => setSubView({ ...subView, [sub.id]: v.id })}
                        className={cn(
                          'inline-flex items-center gap-2 px-4 py-2 text-xs border rounded-md transition-colors uppercase tracking-wider',
                          view === v.id
                            ? 'bg-primary/10 text-primary border-primary'
                            : 'border-white/[0.06] text-muted-foreground hover:text-white',
                        )}
                      >
                        <v.icon className="w-3.5 h-3.5" />
                        {lang === 'ar' ? v.ar : v.en}
                      </button>
                    ))}
                  </div>
                  <ReportButton
                    reportId="subcontractor-file"
                    context={{
                      project,
                      reportCurrency: money.base,
                      sub,
                      roll,
                      ld: subLd,
                      programme: subSched,
                      currentContract,
                      certified: certifiedToDate,
                      paid: paidTotal,
                      outstanding,
                      retentionHeld: retentionHeldTotal,
                      changeOrders: commercial.changeOrders,
                      claims: commercial.claims,
                      delays: commercial.delays ?? [],
                      certificates: subCerts,
                      perf: {
                        ...perf,
                        categories: perf.categories.map(c => ({
                          ...c,
                          label: lang === 'ar' ? CATEGORY_META[c.key].ar : CATEGORY_META[c.key].en,
                        })),
                      },
                    }}
                  />
                </div>

                {/* Commercial management — change orders, claims, EOT */}
                {view === 'commercial' && (
                  <SubCommercialPanel
                    projectId={project.id}
                    subId={sub.id}
                    originalValue={sub.contractValue}
                    retention={sub.retention}
                    certified={certifiedToDate}
                    paid={paidTotal}
                    outstanding={outstanding}
                    retentionHeld={retentionHeldTotal}
                    canEdit={canEdit}
                    onChange={() => setCommercialVersion(v => v + 1)}
                    onEditContractValue={v => updateSubField(sub.id, 'contractValue', v)}
                    showSummary={false}
                    projectDelays={projectDelays}
                    projectSnapshot={projectSnapshot}
                    subMeta={{ code: sub.code, company: sub.company, trade: sub.trade }}
                    // The subcontract's OWN currency. A EUR specialist under
                    // an AED package prices its variations in EUR.
                    subCurrency={sub.currency || contractCcy}
                  />
                )}

                {/* Sub-cert table */}
                {view === 'certs' && (
                <div className="p-4">
                  <div className="flex justify-between items-center mb-3">
                    <h5 className="text-xs font-serif uppercase tracking-widest text-primary">Monthly Certificates</h5>
                    <div className="flex items-center gap-2">
                      {canEdit && (
                        <button onClick={() => setAddingCertFor(addingCertFor === sub.id ? null : sub.id)} className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary transition-colors border border-primary/20 hover:border-primary/50 px-2 py-1 uppercase tracking-wider">
                          <Plus className="w-3 h-3" /> Add Certificate
                        </button>
                      )}
                      {canEdit && <button onClick={() => handleDeleteSub(sub.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </div>

                  {addingCertFor === sub.id && (
                    <form onSubmit={e => handleAddCert(e, sub.id)} className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 p-3 bg-black/60 border border-white/5">
                      <input placeholder="Cert No." value={newCert.certNo} onChange={e => setNewCert({ ...newCert, certNo: e.target.value })} className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono" required />
                      <input placeholder="Period (e.g. Jan 2024)" value={newCert.period} onChange={e => setNewCert({ ...newCert, period: e.target.value })} className="bg-black border border-white/10 px-2 py-1.5 text-sm" />
                      <TransactionAmountInput
                        amount={newCert.grossAmount}
                        currency={newCert.currency || contractCcy}
                        date={newCert.submissionDate || new Date().toISOString().slice(0, 10)}
                        onAmount={v => setNewCert({ ...newCert, grossAmount: v })}
                        onCurrency={v => setNewCert({ ...newCert, currency: v })}
                        onDate={v => setNewCert({ ...newCert, submissionDate: v })}
                        fx={money.fx} settings={money.settings} projectId={project.id}
                        disabled={!canEdit} hideDate
                      />
                      <input type="number" placeholder="Retention" value={newCert.retentionHeld} onChange={e => setNewCert({ ...newCert, retentionHeld: e.target.value })} className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono" />

                      {/* Submission / payment dates */}
                      <div>
                        <label className="text-(length:--t-label) text-muted-foreground uppercase block mb-1">
                          {lang === 'ar' ? 'تاريخ التقديم' : 'Submission Date'}
                        </label>
                        <input
                          type="date"
                          value={newCert.submissionDate}
                          onChange={e => setNewCert({ ...newCert, submissionDate: e.target.value })}
                          className="w-full bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
                          style={{ colorScheme: 'dark' }}
                        />
                      </div>
                      <div>
                        <label className="text-(length:--t-label) text-muted-foreground uppercase block mb-1">
                          {lang === 'ar' ? 'تاريخ السداد' : 'Payment Date'}
                        </label>
                        <input
                          type="date"
                          value={newCert.paymentDate}
                          onChange={e => setNewCert({ ...newCert, paymentDate: e.target.value })}
                          className="w-full bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
                          style={{ colorScheme: 'dark' }}
                        />
                      </div>

                      {/* External document link only. Browsers block file:/// from a
                          web page, so a local path would never open. */}
                      <div className="col-span-2 md:col-span-2">
                        <label className="text-(length:--t-label) text-muted-foreground uppercase block mb-1">
                          {lang === 'ar' ? 'رابط المستند (درايف / ميجا)' : 'Document Link (Drive / Mega)'}
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="url"
                            placeholder="https://drive.google.com/..."
                            value={newCert.documentUrl}
                            onChange={e => setNewCert({ ...newCert, documentUrl: e.target.value })}
                            className="flex-1 bg-black border border-white/10 px-2 py-1.5 text-sm"
                            dir="ltr"
                          />
                          <button type="submit" className="bg-primary text-primary-foreground px-3 py-1.5 text-xs uppercase whitespace-nowrap">Add</button>
                        </div>
                      </div>
                    </form>
                  )}

                  <div className="ds-table-wrap">
                    <table className="ds-table min-w-[1000px]">
                      <thead>
                        <tr>
                          <th className="text-start">Cert No.</th>
                          <th className="text-start">Period</th>
                          <th className="text-start">{lang === 'ar' ? 'تاريخ التقديم' : 'Submitted'}</th>
                          <th className="text-start">Gross</th>
                          <th className="text-start">Retention</th>
                          <th className="text-start">Net Payable</th>
                          <th className="text-start">Paid</th>
                          <th className="text-start">{lang === 'ar' ? 'تاريخ السداد' : 'Payment Date'}</th>
                          <th className="text-start">Remaining</th>
                          <th className="text-start">{lang === 'ar' ? 'المستند' : 'Document'}</th>
                          <th className="text-start">Status</th>
                          {canEdit && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody>
                        {subCerts.length === 0 && (
                          <tr><td colSpan={canEdit ? 12 : 11} className="px-3 py-4 text-center text-muted-foreground italic">No certificates yet.</td></tr>
                        )}
                        {subCerts.map((cert, idx) => (
                          <tr key={cert.id} className="border-b border-white/5 hover:bg-white/[0.03] last:border-0 transition-colors">
                            <td className="font-mono text-primary">
                              <EditableText value={cert.certNo} onSave={v => updateCertField(sub.id, idx, 'certNo', v)} canEdit={canEdit} />
                            </td>
                            <td className="text-white">
                              <EditableText value={cert.period} onSave={v => updateCertField(sub.id, idx, 'period', v)} canEdit={canEdit} />
                            </td>
                            <td className="money" title={formatDateOrDash(cert.submissionDate, lang === 'ar' ? 'ar' : 'en')}>
                              <EditableDate value={cert.submissionDate || ''} onSave={v => updateCertField(sub.id, idx, 'submissionDate', v)} canEdit={canEdit} />
                            </td>
                            <td className="money">
                              <EditableNumber value={cert.grossAmount} onSave={v => updateCertField(sub.id, idx, 'grossAmount', v)} canEdit={canEdit} display={formatMoney(cert.grossAmount, { currency: money.base })} />
                              {/* A subcontract certificate raised in a
                                  foreign currency is VALUED and PAID in
                                  that currency. The converted figure runs
                                  the project's arithmetic; this is the
                                  amount the subcontractor invoices. */}
                              <NativeAmount
                                row={cert}
                                field="grossAmount"
                                displayCurrency={money.base}
                                companyId={companyId ?? ''}
                              />
                            </td>
                            <td className="money">
                              <EditableNumber value={cert.retentionHeld} onSave={v => updateCertField(sub.id, idx, 'retentionHeld', v)} canEdit={canEdit} display={formatMoney(cert.retentionHeld, { currency: money.base })} />
                              <NativeAmount
                                row={cert}
                                field="retentionHeld"
                                displayCurrency={money.base}
                                companyId={companyId ?? ''}
                                originalField="retentionOriginal"
                              />
                            </td>
                            <td className="money">{formatMoney(cert.netPayable, { currency: money.base })}</td>
                            <td className="money">
                              <EditableNumber value={cert.paidAmount} onSave={v => updateCertField(sub.id, idx, 'paidAmount', v)} canEdit={canEdit} display={formatMoney(cert.paidAmount, { currency: money.base })} />
                            </td>
                            <td className="money">
                              <EditableDate value={cert.paymentDate || ''} onSave={v => updateCertField(sub.id, idx, 'paymentDate', v)} canEdit={canEdit} />
                            </td>
                            <td className="money">{formatMoney(cert.remainingAmount, { currency: money.base })}</td>

                            {/* Document — external link only */}
                            <td>
                              {isExternalUrl(cert.documentUrl) ? (
                                <a
                                  href={cert.documentUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={cert.documentUrl}
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  {linkLabel(cert.documentUrl!)}
                                </a>
                              ) : canEdit ? (
                                <EditableText
                                  value={cert.documentUrl || ''}
                                  onSave={v => updateCertField(sub.id, idx, 'documentUrl', v)}
                                  canEdit={canEdit}
                                  placeholder={lang === 'ar' ? 'أضف رابطاً' : 'Add link'}
                                  className="text-muted-foreground"
                                />
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>

                            <td>
                              <EditableSelect value={cert.status} options={CERT_STATUS_OPTS} onSave={v => updateCertField(sub.id, idx, 'status', v)} canEdit={canEdit}
                                className={cn('badge', getCertStatusStyle(cert.status))} />
                            </td>
                            {canEdit && (
                              <td>
                                <button onClick={() => handleDeleteCert(sub.id, idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* A stored link that is not http/https is kept but never linked. */}
                  {subCerts.some(c => c.documentUrl && !isExternalUrl(c.documentUrl)) && (
                    <p className="text-(length:--t-second) text-chart-5/70 italic mt-2">
                      {lang === 'ar'
                        ? 'بعض الروابط ليست https — المتصفح لا يفتح مسارات محلية. استخدم رابط درايف أو ميجا.'
                        : 'Some links are not https — browsers cannot open local file paths. Use a Drive or Mega link.'}
                    </p>
                  )}
                </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
