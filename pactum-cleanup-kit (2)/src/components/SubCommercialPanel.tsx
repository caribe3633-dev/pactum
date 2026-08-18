import React, { useEffect, useMemo, useState } from 'react';
import { cn, formatMoney } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useProjectCurrency } from '../lib/useProjectCurrency';
// Phase 3.2 transaction layer — the same one Budget / COs / Claims /
// Certificates already use. A subcontract row is a transaction like any
// other and must be converted at ITS OWN date and frozen there.
import {
  moneyContext, transactionContext, prepareTransaction,
  transactionFields, resolveTxnDate,
} from '../lib/moneyEntry';
import { TransactionAmountInput } from './CurrencyAmount';
import { useLocation } from 'wouter';
import { Link2 } from 'lucide-react';
import { companyIdOfProject } from '../lib/projectMaster';
import { fetchSectors } from '../mock/sectors';
import { formatDateOrDash, formatDate, parseAnyDate } from '../lib/dateFormat';
import {
  backfillSubWindows, readSubWindows, windowLabel, isWindowClosed,
  SubWindow, ProjectSnapshot,
} from '../lib/delayWindows';
import { EditableText, EditableNumber, EditableSelect } from './EditableCell';
import { Plus, Trash2, FileSignature, Gavel, CalendarClock, Clock, Scale, AlertTriangle, LayoutGrid, ChevronDown, ChevronUp, Paperclip, ExternalLink } from 'lucide-react';
import SubContractSummary from './SubContractSummary';
import {
  SubCommercial, SubChangeOrder, SubClaim, SubDelayRow, CommercialStatus,
  readCommercial, writeCommercial, newCommercialId,
  rollupCommercial, currentContractValue,
  computeSubLd, computeSubSchedule, writeSubSchedule,
  syncSubDelayRegister, readSyncedCommercial, MANUAL_DELAY_CATEGORIES,
  normaliseDocUrl,
} from '../lib/subcontractCommercial';

/**
 * Subcontract Commercial Management — PROJECT SCOPE ONLY.
 *
 * Lives inside the project's Subcontracts tab, under one subcontract.
 * This is the SINGLE SOURCE OF TRUTH for change orders, claims and EOT.
 *
 * The Subcontractor Dashboard reads these numbers and never writes them.
 * Nothing here touches the Company Registry.
 */

const STATUS_OPTS = [
  { value: 'pending',  label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function statusStyle(s: string) {
  switch (s) {
    case 'approved': return 'bg-chart-4/10 !text-chart-4 border-chart-4/30';
    case 'rejected': return 'bg-chart-3/10 !text-chart-3 border-chart-3/30';
    default:         return 'bg-white/5 !text-muted-foreground border-white/10';
  }
}

type Section = 'co' | 'claims' | 'delay';

/** Sub-tabs inside Commercial. Same shape as the Certificates/Commercial switcher. */
type CommercialTab = 'changes' | 'delay' | 'ld';

const COMMERCIAL_VIEWS: { id: CommercialTab; icon: any; en: string; ar: string }[] = [
  { id: 'changes', icon: FileSignature, en: 'Change Orders & Claims', ar: 'أوامر التغيير والمطالبات' },
  { id: 'delay',   icon: Clock,         en: 'Delay & Schedule Impact', ar: 'التأخير وأثر البرنامج' },
  { id: 'ld',      icon: Scale,         en: 'Liquidated Damages',      ar: 'غرامات التأخير' },
];

/** Provenance badge. Generated rows are not hand-created. */
const ORIGIN_LABEL: Record<string, { en: string; ar: string; c: string }> = {
  'manual':         { en: 'Manual',        ar: 'يدوي',          c: 'text-muted-foreground border-white/10' },
  'project-delay':  { en: 'Project Delay', ar: 'تأخير المشروع', c: 'text-primary/70 border-primary/20' },
  'approved-co':    { en: 'Approved CO',   ar: 'أمر تغيير',     c: 'text-chart-4 border-chart-4/30' },
  'approved-claim': { en: 'Approved Claim',ar: 'مطالبة',        c: 'text-chart-5 border-chart-5/30' },
  'imported':       { en: 'Imported',      ar: 'مستورد',        c: 'text-muted-foreground border-white/10' },
};

const PARTY_OPTS = [
  { value: 'contractor',    label: 'Contractor' },
  { value: 'owner',         label: 'Owner' },
  { value: 'force_majeure', label: 'Force Majeure' },
  { value: 'third_party',   label: 'Third Party' },
];

// Only genuine site events. Change orders and claims generate their own
// rows automatically and are never added by hand.
const CATEGORY_OPTS = MANUAL_DELAY_CATEGORIES;

/** Categories owned by the generator — shown read-only on generated rows. */
const GENERATED_CATEGORY: Record<string, string> = {
  scope_change: 'Scope Change',
  claim: 'Claim',
};

interface Props {
  projectId: string;
  subId: string;
  /** Contract Value — owned by pactum-subs-*, passed in, never copied. */
  originalValue: number;
  /** Writes the Contract Value back to its owner. Omit for read-only views. */
  onEditContractValue?: (v: number) => void;
  /** Contract retention % or amount — owned by pactum-subs-*. Display only. */
  retention: number;
  /** Certificate-derived figures — owned by pactum-sub-certs-*. Display only. */
  certified: number;
  paid: number;
  outstanding: number;
  retentionHeld: number;
  canEdit: boolean;
  /** Notifies the parent card so its summary re-reads. */
  onChange?: () => void;
  /**
   * Project Delay Register rows, for REFERENCE linking only. Selecting one
   * stores its id — project data is never copied and never modified.
   */
  projectDelays?: { id: string; description?: string }[];
  /**
   * The parent card already renders SubContractSummary above the view
   * switcher. Set false there to avoid printing the identical figures twice.
   * Defaults true so any other caller still gets a self-contained panel.
   */
  showSummary?: boolean;
  /** Live project position, snapshotted alongside this subcontract monthly. */
  projectSnapshot?: ProjectSnapshot;
  /** Identifies the subcontract's own window store. */
  subMeta?: { code: string; company: string; trade: string };
  /**
   * The SUBCONTRACT's contract currency — not the project's.
   *
   * A subcontract is its own agreement and is frequently signed in a
   * different currency from the main contract: a EUR specialist working
   * under an AED civil package. Its change orders, claims, delay costs
   * and certificates therefore default to ITS currency, not the
   * project's, and each row may still override.
   */
  subCurrency?: string;
}

/**
 * The project-currency equivalent of an LD figure, with a link to the
 * rate that produced it.
 *
 * ══════════════════════════════════════════════════════════════════════
 * DIRECTION MATTERS, AND IT WAS THE WRONG WAY ROUND.
 *
 * The tile above now leads with the SUBCONTRACT's currency, because that
 * is what the LD clause is written in and what Contract Value and the
 * certificates on the same card already show. Leading with the project
 * currency made the unit change halfway down one card.
 *
 * This states the converted figure underneath — present, never implied,
 * and never replacing the agreed one. `show` is false on a subcontract
 * already in the project currency, where a second identical line would
 * be noise.
 * ══════════════════════════════════════════════════════════════════════
 */
function LdConverted({
  amount, ccy, ld, show, companyId, isRtl, setLocation,
}: {
  amount: number;
  ccy: string;
  ld: { ldExchangeRate: number; ldRateEffectiveDate: string;
        ldRateLegIds: string[]; ldRateFrozen: boolean };
  show: boolean;
  companyId: string;
  isRtl: boolean;
  setLocation: (to: string) => void;
}) {
  if (!show) return null;

  // No rate saved yet. Inventing a converted figure would be a guess, so
  // the tile says what is missing instead of printing a number.
  if (!ld.ldRateFrozen) {
    return (
      <div className="mt-0.5 text-(length:--t-micro) font-mono text-muted-foreground">
        {isRtl
          ? `يُحوَّل إلى ${ccy} عند الحفظ`
          : `Converted to ${ccy} on save`}
      </div>
    );
  }

  const rateId = ld.ldRateLegIds[0] || '';
  return (
    <div className="mt-0.5 leading-tight">
      <div className="text-(length:--t-data) font-mono text-primary number-ltr">
        = {ccy} {amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
      </div>
      <button
        type="button"
        disabled={!companyId}
        onClick={() => companyId && setLocation(
          `/company/${companyId}/currency${rateId ? `?rate=${encodeURIComponent(rateId)}` : ''}`)}
        title={isRtl
          ? 'اعرض سعر الصرف المنشور المستخدم في هذا التحويل'
          : 'Open the published exchange rate used for this conversion'}
        className="inline-flex items-center gap-1 text-(length:--t-micro) font-mono
                   text-muted-foreground hover:text-primary underline decoration-dotted
                   underline-offset-2 disabled:opacity-40 disabled:no-underline"
      >
        <Link2 className="w-2.5 h-2.5" aria-hidden="true" />
        @ {ld.ldExchangeRate.toFixed(6)}
        {ld.ldRateEffectiveDate &&
          ` · ${formatDateOrDash(ld.ldRateEffectiveDate, isRtl ? 'ar' : 'en')}`}
      </button>
    </div>
  );
}

export default function SubCommercialPanel({
  projectId, subId, originalValue, retention,
  certified, paid, outstanding, retentionHeld, canEdit, onChange,
  showSummary = true, projectDelays = [], projectSnapshot, subMeta,
  onEditContractValue, subCurrency,
}: Props) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  // SPRINT 3 · R5 — the panel knows its project, so it resolves its own
  // reporting currency rather than inheriting the 'SAR' default.
  // PROJECT SCREENS ARE DENOMINATED IN THE CONTRACT CURRENCY.
  // `.reporting` is the AGGREGATION currency, used when this project is
  // rolled up into a company or portfolio figure. Reading it here is what
  // printed the company's unit on a project's own numbers.
  const ccy = useProjectCurrency({ id: projectId }).base;

  /**
   * THE DEFECT THIS CLOSES.
   *
   * Every amount on this panel was stored with `Number(draft.amount)` and
   * printed with `formatMoney(..., { currency: ccy })` — raw in, labelled
   * as the reporting currency out. On a EUR subcontract under an AED
   * project that printed euro figures under an AED label: a wrong number
   * wearing a confident unit, the exact class of defect Sprint 1 closed
   * for the project registers and never reached here.
   *
   * Rows now go through the same transaction layer as Budget, Change
   * Orders, Claims and Certificates: converted at the row's OWN date and
   * the applied rate frozen onto it, so a later rate movement cannot
   * restate a filed record.
   */
  const companyId = useMemo(
    () => companyIdOfProject({ id: projectId } as never, fetchSectors()) || '',
    [projectId]);
  const [, setLocation] = useLocation();
  const money = useMemo(() => moneyContext(companyId, projectId), [companyId, projectId]);
  // Defaults to the SUBCONTRACT's currency, falling back to the reporting
  // currency only when the subcontract does not state one (legacy rows).
  const rowCcy = (subCurrency || ccy || '').toUpperCase();
  const txnCtx = useMemo(
    () => transactionContext(companyId, projectId, rowCcy),
    [companyId, projectId, rowCcy]);
  const [saveErr, setSaveErr] = useState('');

  // The delay register is an event log: approved CO / Claim time impacts are
  // materialised as delay events on read, before anything is displayed.
  const [data, setData] = useState<SubCommercial>(() => readSyncedCommercial(projectId, subId));
  const [openForm, setOpenForm] = useState<Section | null>(null);
  const [subTab, setSubTab] = useState<CommercialTab>('changes');
  const [draft, setDraft] = useState({
    ref: '', description: '', amount: '', days: '', date: '', timeImpactDays: '',
    documentUrl: '', currency: '',
  });
  const [windows, setWindows] = useState<SubWindow[]>([]);
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);
  const [showWindows, setShowWindows] = useState(false);
  const [delayDraft, setDelayDraft] = useState({
    delayId: '', description: '', startDate: '', endDate: '', delayDays: '',
    responsibleParty: 'contractor', category: 'design', costImpact: '', projectDelayRef: '',
  });

  // Every figure below is derived from `data` on each render, so any edit to
  // a change order, claim, EOT, delay row, rate or cap recalculates the whole
  // chain immediately — no refresh, no stored duplicates.
  const roll = useMemo(() => rollupCommercial(data), [data]);
  // `rowCcy` is the SUBCONTRACT's currency — the unit an LD figure will
  // be entered in, and therefore the unit an empty LD block must show.
  const ld = useMemo(() => computeSubLd(data, roll, rowCcy), [data, roll, rowCcy]);
  /**
   * The unit the LD tiles are LABELLED in.
   *
   * The subcontract's own currency, exactly like Contract Value and the
   * certificates on the same card. Where a rate has been frozen the
   * converted project-currency figure is stated underneath, so both
   * numbers are present and neither is implied.
   */
  const ldCcy = ld.ldCurrency || rowCcy || ccy;
  /** True when the LD figures are in a currency other than the project's. */
  const ldIsForeign = Boolean(ldCcy) && ldCcy !== ccy;
  const sched = useMemo(() => computeSubSchedule(data, ld), [data, ld]);
  const current = currentContractValue(originalValue, roll);
  // Outstanding = Current Contract − Certified.
  const outstandingDerived = current - certified;

  // ── Windows: one snapshot per month, same rule as the project ──
  const startId = useMemo(() => {
    const dates: string[] = [];
    (data.changeOrders || []).forEach(r => { if (r.date) dates.push(r.date); });
    (data.claims || []).forEach(r => { if (r.date) dates.push(r.date); });
    (data.delays || []).forEach(r => { if (r.startDate) dates.push(r.startDate); });
    const ids = dates
      .map(d => parseAnyDate(d))
      .filter(Boolean)
      .map(p => `${p!.y}-${String(p!.m).padStart(2, '0')}`)
      .sort();
    const now = new Date();
    return ids[0] || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, [data]);

  useEffect(() => { setWindows(readSubWindows(projectId, subId)); }, [projectId, subId]);

  useEffect(() => {
    const upTo = (d?: string, closesOn?: string) => {
      if (!d || !closesOn) return true;
      const p = parseAnyDate(d);
      if (!p) return true;
      return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` <= closesOn;
    };

    const rows = backfillSubWindows(projectId, subId, startId, (closesOn) => {
      // Position AS AT the month end, not today's figures repeated.
      const cut: SubCommercial = {
        ...data,
        changeOrders: (data.changeOrders || []).filter(r => upTo(r.date, closesOn)),
        claims: (data.claims || []).filter(r => upTo(r.date, closesOn)),
        eots: [],
        delays: (data.delays || []).filter(r => upTo(r.startDate, closesOn)),
      };
      const rl = rollupCommercial(cut);
      const l = computeSubLd(cut, rl);
      const sc = computeSubSchedule(cut, l);
      const cur = currentContractValue(originalValue, rl);
      return {
        subcontract: {
          subId,
          code: subMeta?.code || '',
          company: subMeta?.company || '',
          trade: subMeta?.trade || '',
          originalContract: originalValue,
          currentContract: cur,
          forecastFinish: sc.forecastFinish,
          approvedFinish: sc.approvedFinish,
          currentVariance: sc.currentVariance,
          totalDelay: l.totalDelay,
          approvedExtension: l.approvedExtension,
          delayDays: (cut.delays || []).reduce((a, r) => a + (Number(r.delayDays) || 0), 0),
          costImpact: rl.grossDelayCost,
          ldExposure: l.ldExposure,
          outstanding: cur - certified,
          certified,
          paid,
        },
        project: projectSnapshot ?? {
          plannedFinish: '', forecastFinish: '', approvedFinish: '',
          currentVariance: 0, totalDelay: 0, approvedEot: 0, unmitigatedDelay: 0,
          recoveryRequired: 0, ldExposure: 0, costImpact: 0, delayEventCount: 0,
        },
        delayEventCount: (cut.delays || []).length,
      };
    });
    setWindows(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, subId, startId, data, originalValue, certified, paid, projectSnapshot]);

  const persist = (next: SubCommercial) => {
    // Approving a change order or claim must materialise its delay event in
    // the same write — the register can never lag the commercial records.
    const synced = syncSubDelayRegister(next).data;
    setData(synced);
    writeCommercial(projectId, subId, synced);
    onChange?.();
  };

  const resetDraft = () => {
    setDraft({ ref: '', description: '', amount: '', days: '', date: '', timeImpactDays: '', documentUrl: '', currency: rowCcy });
    setSaveErr('');
    setDelayDraft({
      delayId: '', description: '', startDate: '', endDate: '', delayDays: '',
      responsibleParty: 'contractor', category: 'design', costImpact: '', projectDelayRef: '',
    });
    setOpenForm(null);
  };

  /** Schedule / LD fields live on data.schedule, not on the registers. */
  const DATE_FIELDS = ['baselineFinish', 'commencementDate'];
  /** Money fields on the schedule — entered in the SUBCONTRACT's currency. */
  const LD_MONEY_FIELDS = ['ldRatePerDay', 'ldCapAmount'];

  const patchSchedule = (
    field: 'commencementDate' | 'baselineDuration' | 'baselineFinish' | 'totalDelay' | 'ldRatePerDay' | 'ldCapAmount',
    v: any,
  ) => {
    /**
     * AN LD FIGURE IS A TRANSACTION LIKE ANY OTHER.
     *
     * The rate and the cap are terms of the SUBCONTRACT, so they are
     * entered in the subcontract's currency and converted once, at the
     * subcontract's commencement date, with the rate frozen onto the
     * record. Previously they were written raw and displayed against the
     * project currency, which relabelled a USD clause as AED.
     *
     * Both fields share ONE rate, resolved on the same date, so
     * `exposure` and `cap` stay comparable — converting them
     * independently could let the cap bind at a different point than the
     * contract says.
     */
    if (LD_MONEY_FIELDS.includes(field)) {
      const sch = data.schedule || {};
      const txn = resolveTxnDate({ date: sch.commencementDate || '' }, ['date']);
      const m = prepareTransaction(txnCtx, Number(v) || 0, rowCcy, txn);
      if (!m.conversion.resolved) {
        setSaveErr(isRtl
          ? `لا يوجد سعر صرف من ${rowCcy} إلى ${txnCtx.reportingCurrency} بتاريخ ${txn.date}. انشر السعر في إدارة العملات أولاً.`
          : `No rate from ${rowCcy} to ${txnCtx.reportingCurrency} on ${txn.date}. Publish one in Currency Management first.`);
        return;
      }
      setSaveErr('');
      const next = writeSubSchedule(projectId, subId, {
        // Stored AS ENTERED. The conversion rides alongside.
        [field]: Number(v) || 0,
        ldCurrency: rowCcy,
        ldExchangeRate: m.money.exchangeRateSnapshot || 1,
        ldRateEffectiveDate: m.money.exchangeRateEffectiveDate || '',
        ldRateLegIds: m.money.rateLegIds || [],
      });
      setData(next);
      onChange?.();
      return;
    }

    const next = writeSubSchedule(projectId, subId, {
      [field]: DATE_FIELDS.includes(field) ? String(v || '') : (Number(v) || 0),
    });
    setData(next);
    onChange?.();
  };

  const submit = (e: React.FormEvent, section: Section) => {
    e.preventDefault();
    if (!draft.ref.trim()) return;
    const base = {
      id: newCommercialId(section),
      ref: draft.ref.trim(),
      description: draft.description.trim(),
      status: 'pending' as CommercialStatus,
      date: draft.date || new Date().toISOString().slice(0, 10),
      // Stored exactly as typed; normalised only when opened.
      documentUrl: draft.documentUrl.trim(),
    };
    // Convert at THIS row's date and freeze the rate onto it.
    const txn = resolveTxnDate({ date: base.date }, ['date']);
    const m = prepareTransaction(txnCtx, draft.amount, draft.currency || rowCcy, txn);
    if (!m.conversion.resolved) {
      // No published rate on that date. Saving would store a figure that
      // LOOKS converted and is not, so the row is refused and the reason
      // named — never silently treated as 1:1.
      setSaveErr(isRtl
        ? `لا يوجد سعر صرف من ${(draft.currency || rowCcy)} إلى ${txnCtx.reportingCurrency} بتاريخ ${txn.date}. انشر السعر في إدارة العملات أولاً.`
        : `No rate from ${(draft.currency || rowCcy)} to ${txnCtx.reportingCurrency} on ${txn.date}. Publish one in Currency Management first.`);
      return;
    }
    const priced = { amount: m.value, ...transactionFields(m.money) };

    if (section === 'co') {
      persist({ ...data, changeOrders: [...data.changeOrders, {
        ...base, ...priced,
        timeImpactDays: Number(draft.timeImpactDays) || 0,
      }] });
    } else if (section === 'claims') {
      persist({ ...data, claims: [...data.claims, {
        ...base, ...priced,
        timeImpactDays: Number(draft.timeImpactDays) || 0,
      }] });
    }
    resetDraft();
  };

  /** Subcontract delay row. Independent of the project register. */
  const submitDelay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!delayDraft.delayId.trim()) return;
    const row: SubDelayRow = {
      id: newCommercialId('sdly'),
      delayId: delayDraft.delayId.trim(),
      description: delayDraft.description.trim(),
      startDate: delayDraft.startDate,
      endDate: delayDraft.endDate,
      delayDays: Number(delayDraft.delayDays) || 0,
      responsibleParty: delayDraft.responsibleParty,
      category: delayDraft.category,
      status: 'pending',
      // A delay cost is money and follows the same rule as every other
      // amount on this panel: converted at its own date, rate frozen.
      costImpact: (() => {
        const t = resolveTxnDate({ date: delayDraft.startDate }, ['date']);
        const c = prepareTransaction(txnCtx, delayDraft.costImpact, rowCcy, t);
        return c.conversion.resolved ? c.value : (Number(delayDraft.costImpact) || 0);
      })(),
      // Reference only. Project data is never copied in.
      projectDelayRef: delayDraft.projectDelayRef || undefined,
    };
    persist({ ...data, delays: [...(data.delays || []), row] });
    resetDraft();
  };

  const updateDelay = (id: string, field: keyof SubDelayRow, v: any) =>
    persist({ ...data, delays: (data.delays || []).map(r => r.id === id ? { ...r, [field]: v } : r) });
  const removeDelay = (id: string) =>
    persist({ ...data, delays: (data.delays || []).filter(r => r.id !== id) });

  const updateCO = (id: string, field: keyof SubChangeOrder, v: any) =>
    persist({ ...data, changeOrders: data.changeOrders.map(r => r.id === id ? { ...r, [field]: v } : r) });
  const updateClaim = (id: string, field: keyof SubClaim, v: any) =>
    persist({ ...data, claims: data.claims.map(r => r.id === id ? { ...r, [field]: v } : r) });

  const removeCO = (id: string) =>
    persist({ ...data, changeOrders: data.changeOrders.filter(r => r.id !== id) });
  const removeClaim = (id: string) =>
    persist({ ...data, claims: data.claims.filter(r => r.id !== id) });

  const th = 'px-3 py-2 text-start';
  const headCls = 'text-(length:--t-second) uppercase bg-black/60 text-muted-foreground border-b border-white/10';
  const rowCls = 'border-b border-white/5 hover:bg-white/[0.03] last:border-0 transition-colors';

  const addBtn = (section: Section, label: string) => canEdit && (
    <button
      onClick={() => { resetDraft(); setOpenForm(openForm === section ? null : section); }}
      className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary transition-colors border border-primary/20 hover:border-primary/50 px-2 py-1 uppercase tracking-wider"
    >
      <Plus className="w-3 h-3" /> {label}
    </button>
  );

  /** Count badge. Hidden at zero — an empty register says nothing useful. */
  const countBadge = (n: number) => n > 0 && (
    <span className="text-muted-foreground font-sans normal-case tracking-normal">({n})</span>
  );

  const formFor = (section: Section) => canEdit && openForm === section && (
    <form onSubmit={e => submit(e, section)} className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3 p-3 bg-black/60 border border-white/5">
      {saveErr && (
        <p className="col-span-2 md:col-span-3 text-(length:--t-second) text-chart-3">{saveErr}</p>
      )}
      <input
        placeholder={isRtl ? 'المرجع *' : 'Ref *'} value={draft.ref} required
        onChange={e => setDraft({ ...draft, ref: e.target.value })}
        className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
      />
      <input
        placeholder={isRtl ? 'الوصف' : 'Description'} value={draft.description}
        onChange={e => setDraft({ ...draft, description: e.target.value })}
        className="bg-black border border-white/10 px-2 py-1.5 text-sm"
      />
      {/* The placeholder used to read "Amount (SAR)" — a hardcoded unit on
          a panel that can hold any currency. It is now the real currency
          selector, defaulting to the SUBCONTRACT's own currency. */}
      <div className="col-span-2 md:col-span-1">
        <TransactionAmountInput
          amount={draft.amount}
          currency={draft.currency || rowCcy}
          date={draft.date || new Date().toISOString().slice(0, 10)}
          onAmount={v => setDraft({ ...draft, amount: v })}
          onCurrency={v => setDraft({ ...draft, currency: v })}
          onDate={v => setDraft({ ...draft, date: v })}
          fx={money.fx}
          settings={money.settings}
          projectId={projectId}
          disabled={!canEdit}
          hideDate
        />
      </div>
      {/* Approved time impact. Once the row is approved this feeds Approved
          Extension AND generates a delay event automatically. */}
      <input
        type="number"
        placeholder={isRtl ? 'التأثير الزمني (أيام)' : 'Time Impact (days)'}
        value={draft.timeImpactDays}
        onChange={e => setDraft({ ...draft, timeImpactDays: e.target.value })}
        className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
      />
      <input
        type="date" value={draft.date}
        onChange={e => setDraft({ ...draft, date: e.target.value })}
        className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
        style={{ colorScheme: 'dark' }}
      />
      {/* Document link. A URL only — the file itself stays where it lives. */}
      <div className="md:col-span-2 flex items-center gap-2 bg-black border border-white/10 px-2">
        <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder={isRtl ? 'رابط المستند (اختياري)' : 'Document link (optional)'}
          value={draft.documentUrl}
          onChange={e => setDraft({ ...draft, documentUrl: e.target.value })}
          className="flex-1 bg-transparent py-1.5 text-sm focus:outline-none"
          dir="ltr"
        />
      </div>
      {/* Add and Cancel sit together: the form opens on demand and must be
          dismissable without hunting for the button that opened it. */}
      <div className="flex items-center gap-2">
        <button type="submit" className="bg-primary text-primary-foreground px-3 py-1.5 text-xs uppercase">
          {isRtl ? 'إضافة' : 'Add'}
        </button>
        <button
          type="button"
          onClick={resetDraft}
          className="border border-white/10 text-muted-foreground hover:text-white px-3 py-1.5 text-xs uppercase transition-colors"
        >
          {isRtl ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );

  /**
   * Document cell. Shows an open-in-new-tab link when a URL is on record and
   * an inline editor either way, so a link can be added after the fact.
   */
  const docCell = (url: string | undefined, onSave: (v: string) => void) => {
    const href = normaliseDocUrl(url);
    return (
      <div className="flex items-center gap-1.5">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={url}
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 text-primary/80 hover:text-primary transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            <span className="text-(length:--t-label) uppercase tracking-wider">{isRtl ? 'فتح' : 'Open'}</span>
          </a>
        ) : (
          <Paperclip className="w-3 h-3 text-white/15" />
        )}
        {canEdit && (
          <EditableText
            value={url || ''}
            onSave={onSave}
            canEdit={canEdit}
            placeholder={isRtl ? 'رابط' : 'link'}
            className="text-(length:--t-second) text-muted-foreground max-w-[90px] truncate"
          />
        )}
      </div>
    );
  };

  const emptyRow = (cols: number, text: string) => (
    <tr><td colSpan={cols} className="px-3 py-4 text-center text-muted-foreground italic">{text}</td></tr>
  );

  return (
    <div className="border-t border-white/5 bg-black/20">

      {/* ── Commercial summary — shared component ──
          Rendered only when the caller has not already shown it. The project
          card prints the same strip above the view switcher; printing it twice
          put identical figures on screen back to back. */}
      {showSummary && (
        <SubContractSummary ccy={ccy}
          originalContract={originalValue}
          approvedChangeOrders={roll.approvedChangeOrders}
          pendingChangeOrders={roll.pendingChangeOrders}
          currentContract={current}
          approvedClaims={roll.approvedClaims}
          approvedEotDays={roll.approvedEotDays}
          certified={certified}
          paid={paid}
          outstanding={outstandingDerived}
          retentionHeld={retentionHeld}
          retentionContract={retention}
          ldExposure={ld.ldExposure}
          approvedFinish={sched.approvedFinish}
          commencementDate={sched.commencementDate}
          onEditContractValue={onEditContractValue}
          canEdit={canEdit}
          variant="full"
          className="border-b border-white/5"
        />
      )}

      {/* The "Latest activity" strip used to sit here. It repeated the first
          row of the table directly beneath it, so it was removed. The
          component itself is untouched and still used by the Subcontractor
          Dashboard, where it summarises across projects and duplicates
          nothing. */}

      {/* ══ SUB-TABS ══
          The Commercial view carried six stacked sections. Same content,
          same order, now grouped into three. Markup copied from the
          Certificates / Commercial switcher so nothing new appears. */}
      <div className="flex items-center gap-2 flex-wrap px-4 pt-4">
        {COMMERCIAL_VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setSubTab(v.id)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 text-xs border rounded-md transition-colors uppercase tracking-wider',
              subTab === v.id
                ? 'bg-primary/10 text-primary border-primary'
                : 'border-white/[0.06] text-muted-foreground hover:text-white',
            )}
          >
            <v.icon className="w-3.5 h-3.5" />
            {isRtl ? v.ar : v.en}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-6">

        {subTab === 'changes' && (<>

          {/* ══ CHANGE ORDERS ══ */}
          <section>
            <div className="flex justify-between items-center mb-3">
              <h5 className="text-xs font-serif uppercase tracking-widest text-primary flex items-center gap-2">
                <FileSignature className="w-3.5 h-3.5" />
                {isRtl ? 'أوامر التغيير' : 'Change Orders'}
                {countBadge(roll.changeOrdersCount)}
              </h5>
              {addBtn('co', isRtl ? 'إضافة أمر تغيير' : 'Add Change Order')}
            </div>
            {formFor('co')}
            <div className="ds-table-wrap">
              <table className="ds-table min-w-[760px]">
                <thead className={headCls}>
                  <tr>
                    <th className={th}>{isRtl ? 'المرجع' : 'Ref'}</th>
                    <th className={th}>{isRtl ? 'الوصف' : 'Description'}</th>
                    <th className={th}>{isRtl ? 'المبلغ' : 'Amount'}</th>
                    <th className={th}>{isRtl ? 'التأثير الزمني' : 'Time Impact'}</th>
                    <th className={th}>{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className={th}>{isRtl ? 'المستند' : 'Document'}</th>
                    <th className={th}>{isRtl ? 'الحالة' : 'Status'}</th>
                    {canEdit && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {data.changeOrders.length === 0 && emptyRow(canEdit ? 8 : 7, isRtl ? 'لا توجد أوامر تغيير.' : 'No change orders yet.')}
                  {data.changeOrders.map(r => (
                    <tr key={r.id} className={rowCls}>
                      <td className="font-mono text-primary">
                        <EditableText value={r.ref} onSave={v => updateCO(r.id, 'ref', v)} canEdit={canEdit} />
                      </td>
                      <td className="text-white">
                        <EditableText value={r.description} onSave={v => updateCO(r.id, 'description', v)} canEdit={canEdit} placeholder="—" />
                      </td>
                      <td className={cn('font-mono number-ltr', r.amount < 0 ? 'text-chart-3' : 'text-white')}>
                        <EditableNumber value={r.amount} onSave={v => updateCO(r.id, 'amount', v)} canEdit={canEdit} display={formatMoney(r.amount, { currency: ccy })} />
                      </td>
                      <td className={cn('font-mono number-ltr',
                        (r.timeImpactDays || 0) > 0 && r.status === 'approved' ? 'text-chart-5' : 'text-muted-foreground')}>
                        <EditableNumber
                          value={r.timeImpactDays || 0}
                          onSave={v => updateCO(r.id, 'timeImpactDays', v)}
                          canEdit={canEdit}
                          display={(r.timeImpactDays || 0) > 0 ? `+${r.timeImpactDays}d` : '—'}
                        />
                      </td>
                      <td className="money">{formatDateOrDash(r.date, isRtl ? 'ar' : 'en')}</td>
                      <td>
                        {docCell(r.documentUrl, v => updateCO(r.id, 'documentUrl', v))}
                      </td>
                      <td>
                        <EditableSelect
                          value={r.status} options={STATUS_OPTS} onSave={v => updateCO(r.id, 'status', v)} canEdit={canEdit}
                          className={cn('badge', statusStyle(r.status))}
                        />
                      </td>
                      {canEdit && (
                        <td>
                          <button onClick={() => removeCO(r.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {roll.pendingChangeOrders !== 0 && (
              <p className="text-(length:--t-second) text-muted-foreground mt-2">
                {isRtl ? 'قيد الاعتماد: ' : 'Pending approval: '}
                <span className="font-mono text-chart-5">{formatMoney(roll.pendingChangeOrders, { currency: ccy })}</span>
                {isRtl ? ' — غير مضافة للعقد الحالي' : ' — not included in Current Contract'}
              </p>
            )}
          </section>

          {/* ══ CLAIMS ══ */}
          <section>
            <div className="flex justify-between items-center mb-3">
              <h5 className="text-xs font-serif uppercase tracking-widest text-primary flex items-center gap-2">
                <Gavel className="w-3.5 h-3.5" />
                {isRtl ? 'المطالبات' : 'Claims'}
                {countBadge(roll.claimsCount)}
              </h5>
              {addBtn('claims', isRtl ? 'إضافة مطالبة' : 'Add Claim')}
            </div>
            {formFor('claims')}
            <div className="ds-table-wrap">
              <table className="ds-table min-w-[760px]">
                <thead className={headCls}>
                  <tr>
                    <th className={th}>{isRtl ? 'المرجع' : 'Ref'}</th>
                    <th className={th}>{isRtl ? 'الوصف' : 'Description'}</th>
                    <th className={th}>{isRtl ? 'المبلغ' : 'Amount'}</th>
                    <th className={th}>{isRtl ? 'التأثير الزمني' : 'Time Impact'}</th>
                    <th className={th}>{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className={th}>{isRtl ? 'المستند' : 'Document'}</th>
                    <th className={th}>{isRtl ? 'الحالة' : 'Status'}</th>
                    {canEdit && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {data.claims.length === 0 && emptyRow(canEdit ? 8 : 7, isRtl ? 'لا توجد مطالبات.' : 'No claims yet.')}
                  {data.claims.map(r => (
                    <tr key={r.id} className={rowCls}>
                      <td className="font-mono text-primary">
                        <EditableText value={r.ref} onSave={v => updateClaim(r.id, 'ref', v)} canEdit={canEdit} />
                      </td>
                      <td className="text-white">
                        <EditableText value={r.description} onSave={v => updateClaim(r.id, 'description', v)} canEdit={canEdit} placeholder="—" />
                      </td>
                      <td className="money">
                        <EditableNumber value={r.amount} onSave={v => updateClaim(r.id, 'amount', v)} canEdit={canEdit} display={formatMoney(r.amount, { currency: ccy })} />
                      </td>
                      <td className={cn('font-mono number-ltr',
                        (r.timeImpactDays || 0) > 0 && r.status === 'approved' ? 'text-chart-5' : 'text-muted-foreground')}>
                        <EditableNumber
                          value={r.timeImpactDays || 0}
                          onSave={v => updateClaim(r.id, 'timeImpactDays', v)}
                          canEdit={canEdit}
                          display={(r.timeImpactDays || 0) > 0 ? `+${r.timeImpactDays}d` : '—'}
                        />
                      </td>
                      <td className="money">{formatDateOrDash(r.date, isRtl ? 'ar' : 'en')}</td>
                      <td>
                        {docCell(r.documentUrl, v => updateClaim(r.id, 'documentUrl', v))}
                      </td>
                      <td>
                        <EditableSelect
                          value={r.status} options={STATUS_OPTS} onSave={v => updateClaim(r.id, 'status', v)} canEdit={canEdit}
                          className={cn('badge', statusStyle(r.status))}
                        />
                      </td>
                      {canEdit && (
                        <td>
                          <button onClick={() => removeClaim(r.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Rule note is only relevant once a claim exists. */}
            {roll.claimsCount > 0 && (
              <p className="text-(length:--t-second) text-muted-foreground mt-2">
                {isRtl
                  ? 'المطالبات لا تُضاف لقيمة العقد الحالي إلا بعد تحويلها إلى أمر تغيير معتمد.'
                  : 'Claims do not change the Current Contract until converted into an approved change order.'}
              </p>
            )}
          </section>

        </>)}

        {subTab === 'delay' && (<>

          {/* ══ SUBCONTRACT DELAY REGISTER ══
              Independent of the project register. A project delay may be
              referenced, but its data is never copied and never modified. */}
          <section>
            <div className="flex justify-between items-center mb-3">
              <h5 className="text-xs font-serif uppercase tracking-widest text-primary flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                {isRtl ? 'سجل تأخير المقاول' : 'Delay Register'}
                {countBadge(roll.delayCount)}
              </h5>
              {addBtn('delay', isRtl ? 'إضافة تأخير' : 'Add Delay')}
            </div>

            {canEdit && openForm === 'delay' && (
              <form onSubmit={submitDelay} className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 p-3 bg-black/60 border border-white/5">
                <input
                  placeholder={isRtl ? 'رقم التأخير *' : 'Delay ID *'} value={delayDraft.delayId} required
                  onChange={e => setDelayDraft({ ...delayDraft, delayId: e.target.value })}
                  className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
                />
                <input
                  placeholder={isRtl ? 'الوصف' : 'Description'} value={delayDraft.description}
                  onChange={e => setDelayDraft({ ...delayDraft, description: e.target.value })}
                  className="col-span-2 bg-black border border-white/10 px-2 py-1.5 text-sm"
                />
                <input
                  type="number" placeholder={isRtl ? 'أيام التأخير' : 'Delay Days'} value={delayDraft.delayDays}
                  onChange={e => setDelayDraft({ ...delayDraft, delayDays: e.target.value })}
                  className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
                />
                <input
                  type="date" value={delayDraft.startDate}
                  onChange={e => setDelayDraft({ ...delayDraft, startDate: e.target.value })}
                  className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
                  style={{ colorScheme: 'dark' }}
                />
                <input
                  type="date" value={delayDraft.endDate}
                  onChange={e => setDelayDraft({ ...delayDraft, endDate: e.target.value })}
                  className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
                  style={{ colorScheme: 'dark' }}
                />
                <select
                  value={delayDraft.responsibleParty}
                  onChange={e => setDelayDraft({ ...delayDraft, responsibleParty: e.target.value })}
                  className="bg-black border border-white/10 px-2 py-1.5 text-sm text-white"
                >
                  {PARTY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={delayDraft.category}
                  onChange={e => setDelayDraft({ ...delayDraft, category: e.target.value })}
                  className="bg-black border border-white/10 px-2 py-1.5 text-sm text-white"
                >
                  {CATEGORY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  type="number" placeholder={isRtl ? `التكلفة (${rowCcy})` : `Cost Impact (${rowCcy})`} value={delayDraft.costImpact}
                  onChange={e => setDelayDraft({ ...delayDraft, costImpact: e.target.value })}
                  className="bg-black border border-white/10 px-2 py-1.5 text-sm font-mono"
                />
                <div className="col-span-2 flex gap-2 justify-end">
                  <button type="button" onClick={resetDraft} className="px-3 py-1.5 text-xs border border-white/10 text-muted-foreground hover:text-white">
                    {isRtl ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button type="submit" className="bg-primary text-primary-foreground px-3 py-1.5 text-xs uppercase">
                    {isRtl ? 'إضافة' : 'Add'}
                  </button>
                </div>
              </form>
            )}

            <div className="ds-table-wrap">
              <table className="ds-table min-w-[1020px]">
                <thead className={headCls}>
                  <tr>
                    <th className={th}>{isRtl ? 'رقم التأخير' : 'Delay ID'}</th>
                    <th className={th}>{isRtl ? 'الوصف' : 'Description'}</th>
                    <th className={th}>{isRtl ? 'من' : 'Start'}</th>
                    <th className={th}>{isRtl ? 'إلى' : 'End'}</th>
                    <th className={th}>{isRtl ? 'الأيام' : 'Days'}</th>
                    <th className={th}>{isRtl ? 'المسؤول' : 'Responsible'}</th>
                    <th className={th}>{isRtl ? 'التصنيف' : 'Category'}</th>
                    <th className={th}>{isRtl ? 'التكلفة' : 'Cost Impact'}</th>
                    <th className={th}>{isRtl ? 'المصدر' : 'Created From'}</th>
                    <th className={th}>{isRtl ? 'المستند' : 'Document'}</th>
                    <th className={th}>{isRtl ? 'الحالة' : 'Status'}</th>
                    {canEdit && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {(data.delays || []).length === 0 && emptyRow(canEdit ? 12 : 11, isRtl ? 'لا توجد تأخيرات.' : 'No delay events yet.')}
                  {(data.delays || []).map(r => {
                    // Generated rows are owned by their source record. Their id,
                    // days, category and status are refreshed on every sync, so
                    // editing them here would be silently overwritten.
                    const origin = r.createdFrom ?? 'manual';
                    const isGenerated = origin === 'approved-co' || origin === 'approved-claim';
                    const rowEdit = canEdit && !isGenerated;
                    return (
                    <tr key={r.id} className={cn(rowCls, isGenerated && 'bg-white/[0.015]')}>
                      <td className="font-mono text-primary">
                        <EditableText value={r.delayId} onSave={v => updateDelay(r.id, 'delayId', v)} canEdit={rowEdit} />
                      </td>
                      <td className="text-white">
                        <EditableText value={r.description} onSave={v => updateDelay(r.id, 'description', v)} canEdit={rowEdit} placeholder="—" />
                      </td>
                      <td className="money">{formatDateOrDash(r.startDate, isRtl ? 'ar' : 'en')}</td>
                      <td className="money">{formatDateOrDash(r.endDate, isRtl ? 'ar' : 'en')}</td>
                      <td className="money">
                        <EditableNumber value={r.delayDays} onSave={v => updateDelay(r.id, 'delayDays', v)} canEdit={rowEdit} suffix="d" />
                      </td>
                      <td className="text-xs text-muted-foreground">
                        <EditableSelect value={r.responsibleParty} options={PARTY_OPTS} onSave={v => updateDelay(r.id, 'responsibleParty', v)} canEdit={canEdit} className="text-xs" />
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {isGenerated ? (
                          <span>{GENERATED_CATEGORY[r.category] ?? r.category}</span>
                        ) : (
                          <EditableSelect value={r.category} options={CATEGORY_OPTS} onSave={v => updateDelay(r.id, 'category', v)} canEdit={canEdit} className="text-xs" />
                        )}
                      </td>
                      {/* Cost stays editable even on generated rows — the real
                          cost of a delay is rarely the change order's value. */}
                      <td className="money">
                        <EditableNumber value={r.costImpact} onSave={v => updateDelay(r.id, 'costImpact', v)} canEdit={canEdit} display={formatMoney(r.costImpact, { currency: ccy })} />
                      </td>
                      <td>
                        <span className={cn('inline-block text-(length:--t-second) uppercase tracking-wider border px-1.5 py-0.5',
                          ORIGIN_LABEL[origin]?.c ?? 'text-muted-foreground border-white/10')}>
                          {isRtl ? ORIGIN_LABEL[origin]?.ar : ORIGIN_LABEL[origin]?.en}
                          {r.sourceRef ? ` · ${r.sourceRef}` : ''}
                        </span>
                      </td>
                      {/* Generated rows mirror their source link and cannot be
                          re-pointed here; manual rows own their own. */}
                      <td>
                        {docCell(r.documentUrl, v => updateDelay(r.id, 'documentUrl', v))}
                      </td>
                      <td>
                        <EditableSelect
                          value={r.status} options={STATUS_OPTS} onSave={v => updateDelay(r.id, 'status', v)} canEdit={rowEdit}
                          className={cn('badge', statusStyle(r.status))}
                        />
                      </td>
                      {canEdit && (
                        <td>
                          {isGenerated ? (
                            <span
                              className="text-white/15"
                              title={isRtl
                                ? 'يُولَّد تلقائياً — يُحذف بإلغاء اعتماد المصدر'
                                : 'Auto-generated — withdraw by un-approving the source'}
                            >
                              <Trash2 className="w-3 h-3" />
                            </span>
                          ) : (
                            <button onClick={() => removeDelay(r.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {roll.delayCount > 0 && (
              <p className="text-(length:--t-second) text-muted-foreground mt-2">
                {isRtl ? 'إجمالي تكلفة التأخير: ' : 'Gross delay cost: '}
                <span className="font-mono text-chart-3">{formatMoney(roll.grossDelayCost, { currency: ccy })}</span>
                {isRtl
                  ? ' — سجل مستقل عن المشروع؛ المرجع للربط فقط.'
                  : ' — independent of the project register; the reference is a link only.'}
              </p>
            )}
            <p className="text-(length:--t-second) text-muted-foreground mt-1">
              {isRtl
                ? 'أوامر التغيير والمطالبات المعتمدة تُولِّد أحداثها تلقائياً — تُضاف يدوياً الأحداث الميدانية فقط.'
                : 'Approved change orders and claims generate their own events — add site events only.'}
            </p>
          </section>

          {/* ══ SCHEDULE IMPACT ANALYSIS — subcontract scope ══ */}
          <section>
            <h5 className="text-xs font-serif uppercase tracking-widest text-primary flex items-center gap-2 mb-3">
              <CalendarClock className="w-3.5 h-3.5" />
              {isRtl ? 'تحليل أثر البرنامج الزمني' : 'Schedule Impact Analysis'}
            </h5>

            {/* Commencement Date is day zero of the subcontract programme.
                Baseline Finish  = Commencement + Baseline Duration
                Approved Finish  = Baseline Finish + Approved Extension
                Estimated Finish = Approved Finish + Total Delay */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5 mb-px">
              <div className="bg-black/40 p-3 border border-primary/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                    {isRtl ? 'تاريخ المباشرة' : 'Commencement Date'}
                  </span>
                  {canEdit && <span className="text-(length:--t-label) text-muted-foreground uppercase">{isRtl ? 'تعديل' : 'Edit'}</span>}
                </div>
                {canEdit ? (
                  <input
                    type="date"
                    value={sched.commencementDate}
                    onChange={e => patchSchedule('commencementDate', e.target.value)}
                    className="bg-black border border-white/10 px-2 py-1 text-sm font-mono w-full"
                    style={{ colorScheme: 'dark' }}
                  />
                ) : (
                  <div className="text-sm font-mono number-ltr text-primary">{formatDateOrDash(sched.commencementDate, isRtl ? 'ar' : 'en')}</div>
                )}
              </div>

              <div className="bg-black/40 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                    {isRtl ? 'المدة الأساسية' : 'Baseline Duration'}
                  </span>
                  {canEdit && <span className="text-(length:--t-label) text-muted-foreground uppercase">{isRtl ? 'تعديل' : 'Edit'}</span>}
                </div>
                <div className="text-sm font-mono number-ltr font-semibold text-white">
                  <EditableNumber
                    value={sched.baselineDuration}
                    onSave={v => patchSchedule('baselineDuration', v)}
                    canEdit={canEdit}
                    display={`${sched.baselineDuration}`}
                    className="text-sm font-mono number-ltr font-semibold text-white"
                  />
                  <span className="text-xs font-sans text-muted-foreground ms-1">{isRtl ? 'يوم' : 'days'}</span>
                </div>
              </div>

              <div className="bg-black/40 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                    {isRtl ? 'تاريخ الانتهاء الأساسي' : 'Baseline Finish'}
                  </span>
                  {sched.derived
                    ? <span className="text-(length:--t-label) text-primary/50 uppercase">{isRtl ? 'محسوب' : 'Derived'}</span>
                    : canEdit && <span className="text-(length:--t-label) text-muted-foreground uppercase">{isRtl ? 'تعديل' : 'Edit'}</span>}
                </div>
                {/* Once a commencement date and a duration exist the date is
                    computed, so it stops being a second place to type it. */}
                {sched.derived ? (
                  <div className="text-sm font-mono number-ltr text-white">{formatDateOrDash(sched.baselineFinish, isRtl ? 'ar' : 'en')}</div>
                ) : canEdit ? (
                  <input
                    type="date"
                    value={sched.baselineFinish}
                    onChange={e => patchSchedule('baselineFinish', e.target.value)}
                    className="bg-black border border-white/10 px-2 py-1 text-sm font-mono w-full"
                    style={{ colorScheme: 'dark' }}
                  />
                ) : (
                  <div className="text-sm font-mono number-ltr text-white">{formatDateOrDash(sched.baselineFinish, isRtl ? 'ar' : 'en')}</div>
                )}
                {sched.derived && (
                  <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                    {isRtl ? 'المباشرة + المدة' : 'Commencement + Duration'}
                  </div>
                )}
              </div>

              <div className="bg-black/40 p-3">
                <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
                  {isRtl ? 'التوقع الحالي' : 'Current Forecast'}
                </div>
                <div className="text-sm font-mono number-ltr font-semibold text-chart-5">
                  {sched.currentForecast} <span className="text-xs font-sans text-muted-foreground">{isRtl ? 'يوم' : 'days'}</span>
                </div>
                <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                  {isRtl ? 'الأساسي + إجمالي التأخير' : 'Baseline + Total Delay'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5">
              <div className="bg-black/40 p-3">
                <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
                  {isRtl ? 'الانتهاء المعتمد' : 'Approved Finish'}
                </div>
                <div className="text-sm font-mono number-ltr font-semibold text-primary">{formatDateOrDash(sched.approvedFinish, isRtl ? 'ar' : 'en')}</div>
                <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                  {isRtl ? `الأساسي + ${ld.approvedExtension} يوم` : `Baseline + ${ld.approvedExtension}d`}
                </div>
              </div>

              {/* Estimated Finish = Approved Finish + Total Delay.
                  The expected date on site, not a contractual entitlement. */}
              <div className="bg-black/40 p-3">
                <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
                  {isRtl ? 'الانتهاء المتوقع' : 'Estimated Finish'}
                </div>
                <div className="text-sm font-mono number-ltr font-semibold text-chart-5">{formatDateOrDash(sched.estimatedFinish, isRtl ? 'ar' : 'en')}</div>
                <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                  {isRtl ? `المعتمد + ${ld.totalDelay} يوم` : `Approved + ${ld.totalDelay}d delay`}
                </div>
              </div>

              <div className="bg-black/40 p-3">
                <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
                  {isRtl ? 'الفرق الحالي' : 'Current Variance'}
                </div>
                <div className={cn('text-sm font-mono number-ltr font-semibold',
                  sched.currentVariance > 0 ? 'text-chart-3' : 'text-chart-4')}>
                  {sched.currentVariance > 0 ? `-${sched.currentVariance}` : `${Math.abs(sched.currentVariance)}`}
                  <span className="text-xs font-sans text-muted-foreground ms-1">{isRtl ? 'يوم' : 'days'}</span>
                </div>
              </div>

              <div className="bg-black/40 p-3">
                <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
                  {isRtl ? 'التعويض المطلوب' : 'Recovery Required'}
                </div>
                <div className={cn('text-sm font-mono number-ltr font-semibold',
                  sched.recoveryRequired > 0 ? 'text-chart-5' : 'text-chart-4')}>
                  {sched.recoveryRequired} <span className="text-xs font-sans text-muted-foreground">{isRtl ? 'يوم' : 'days'}</span>
                </div>
              </div>
            </div>

            {!sched.commencementDate && (
              <p className="text-(length:--t-second) text-white/45 italic mt-2">
                {isRtl
                  ? 'أدخل تاريخ المباشرة والمدة الأساسية ليُحسب الانتهاء الأساسي والمعتمد والمتوقع تلقائياً.'
                  : 'Enter a Commencement Date and Baseline Duration to derive Baseline, Approved and Estimated Finish automatically.'}
              </p>
            )}
          </section>

        </>)}

        {subTab === 'ld' && (<>

          {/* ══ LIQUIDATED DAMAGES — subcontract scope ══
              Same engine as the project, applied to this contract only. */}
          <section>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h5 className="text-xs font-serif uppercase tracking-widest text-primary flex items-center gap-2">
                <Scale className="w-3.5 h-3.5" />
                {isRtl ? 'غرامات التأخير' : 'Liquidated Damages'}
              </h5>
              <div className="flex items-center gap-2">
                {ld.capReached && (
                  <span className="flex items-center gap-1.5 text-(length:--t-micro) uppercase tracking-wider px-2.5 py-1 border border-chart-3/40 text-chart-3 bg-chart-3/10 rounded-full">
                    <AlertTriangle className="w-3 h-3" />
                    {isRtl ? 'تم بلوغ الحد الأقصى' : 'Cap Reached'}
                  </span>
                )}
                {ld.uncapped && (
                  <span className="flex items-center gap-1.5 text-(length:--t-micro) uppercase tracking-wider px-2.5 py-1 border border-chart-5/40 text-chart-5 bg-chart-5/10 rounded-full">
                    <AlertTriangle className="w-3 h-3" />
                    {isRtl ? 'بدون حد أقصى' : 'No Cap Set'}
                  </span>
                )}
              </div>
            </div>

            {/* Delay chain — Total Delay is the one manual input. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 mb-px">
              <div className="bg-black/40 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                    {isRtl ? 'إجمالي التأخير' : 'Total Delay'}
                  </span>
                  {canEdit && <span className="text-(length:--t-label) text-muted-foreground uppercase">{isRtl ? 'تعديل' : 'Edit'}</span>}
                </div>
                <div className="text-xl font-mono number-ltr font-semibold text-white">
                  <EditableNumber
                    value={ld.totalDelay}
                    onSave={v => patchSchedule('totalDelay', v)}
                    canEdit={canEdit}
                    display={`${ld.totalDelay}`}
                    className="text-xl font-mono number-ltr font-semibold text-white"
                  />
                  <span className="text-xs font-sans text-muted-foreground ms-1">{isRtl ? 'يوم' : 'days'}</span>
                </div>
                <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                  {isRtl ? 'تأخير المقاول الفعلي — يدوي' : 'Actual subcontractor delay — manual'}
                </div>
              </div>

              <div className="bg-black/40 p-3">
                <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
                  {isRtl ? 'التمديد المعتمد' : 'Approved Extension'}
                </div>
                <div className="text-xl font-mono number-ltr font-semibold text-primary">
                  {ld.approvedExtension} <span className="text-xs font-sans text-muted-foreground">{isRtl ? 'يوم' : 'days'}</span>
                </div>
                <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                  CO {roll.approvedCoEotDays}d + {isRtl ? 'مطالبات' : 'Claims'} {roll.approvedClaimEotDays}d
                </div>
              </div>

              <div className="bg-black/40 p-3">
                <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
                  {isRtl ? 'التأخير الموجب للغرامة' : 'Culpable Delay'}
                </div>
                <div className={cn('text-xl font-mono number-ltr font-semibold',
                  ld.culpableDelay > 0 ? 'text-chart-3' : 'text-chart-4')}>
                  {ld.culpableDelay} <span className="text-xs font-sans text-muted-foreground">{isRtl ? 'يوم' : 'days'}</span>
                </div>
                <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                  {isRtl ? 'الإجمالي − التمديد' : 'Total − Approved'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-px bg-white/5">
              <div className="bg-black/40 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                    {isRtl ? 'قيمة الغرامة اليومية' : 'LD Rate / Day'}
                  </span>
                  {canEdit && <span className="text-(length:--t-label) text-muted-foreground uppercase">{isRtl ? 'تعديل' : 'Edit'}</span>}
                </div>
                <div className="text-sm font-mono number-ltr text-white">
                  {/* The EDITED value is the native one — that is the
                      currency the clause is written in and what the user
                      means when they type. The DISPLAY is converted, so
                      the column keeps the project's unit. */}
                  {/* PRIMARY FIGURE = THE SUBCONTRACT'S OWN CURRENCY,
                      matching Contract Value and the certificates above.
                      The project-currency equivalent is stated beneath,
                      never in place of it. */}
                  <EditableNumber
                    value={ld.nativeRatePerDay}
                    onSave={v => patchSchedule('ldRatePerDay', v)}
                    canEdit={canEdit}
                    display={formatMoney(ld.nativeRatePerDay, { currency: ldCcy })}
                    className="text-sm font-mono number-ltr text-white"
                  />
                </div>
                <LdConverted
                  amount={ld.ldRatePerDay}
                  ccy={ccy}
                  ld={ld}
                  show={ldIsForeign}
                  companyId={companyId}
                  isRtl={isRtl}
                  setLocation={setLocation}
                />
              </div>

              <div className="bg-black/40 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                    {isRtl ? 'الحد الأقصى للغرامة' : 'LD Cap'}
                  </span>
                  {canEdit && <span className="text-(length:--t-label) text-muted-foreground uppercase">{isRtl ? 'تعديل' : 'Edit'}</span>}
                </div>
                <div className="text-sm font-mono number-ltr text-white">
                  <EditableNumber
                    value={ld.nativeCapAmount}
                    onSave={v => patchSchedule('ldCapAmount', v)}
                    canEdit={canEdit}
                    display={ld.nativeCapAmount > 0
                      ? formatMoney(ld.nativeCapAmount, { currency: ldCcy }) : '—'}
                    className="text-sm font-mono number-ltr text-white"
                  />
                </div>
                {ld.nativeCapAmount > 0 && (
                  <LdConverted
                    amount={ld.ldCapAmount}
                    ccy={ccy}
                    ld={ld}
                    show={ldIsForeign}
                    companyId={companyId}
                    isRtl={isRtl}
                    setLocation={setLocation}
                  />
                )}
                <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                  {isRtl ? 'مبلغ مطلق حسب بند العقد' : 'Absolute amount per contract clause'}
                </div>
              </div>

              <div className={cn('p-3', ld.capReached ? 'bg-chart-3/[0.07]' : 'bg-black/40')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                    {isRtl ? 'الغرامة المستحقة' : 'LD Exposure'}
                  </span>
                  <span className="flex items-center gap-1 text-(length:--t-label) uppercase tracking-wider text-emerald-400/70">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 inline-block" />
                    {isRtl ? 'تلقائي' : 'Auto'}
                  </span>
                </div>
                <div className={cn('text-sm font-mono number-ltr font-semibold',
                  ld.capReached ? 'text-chart-3' : ld.ldExposure > 0 ? 'text-chart-5' : 'text-muted-foreground')}>
                  {formatMoney(ld.nativeExposure, { currency: ldCcy })}
                </div>
                {ldIsForeign && ld.nativeExposure > 0 && (
                  <LdConverted
                    amount={ld.ldExposure}
                    ccy={ccy}
                    ld={ld}
                    show
                    companyId={companyId}
                    isRtl={isRtl}
                    setLocation={setLocation}
                  />
                )}
                <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                  {ld.culpableDelay} × {formatMoney(ld.nativeRatePerDay, { currency: ldCcy })}
                  {ld.cappedAmount > 0 && (
                    <span className="text-chart-3/70"> · {isRtl ? 'مستبعد' : 'capped'} {formatMoney(ld.cappedAmount / (ld.ldExchangeRate || 1), { currency: ldCcy })}</span>
                  )}
                </div>
              </div>

              <div className={cn('p-3', ld.netCostImpact < 0 ? 'bg-chart-3/[0.07]' : 'bg-black/40')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                    {isRtl ? 'صافي التكلفة (بعد الغرامة)' : 'Net Cost Impact (after LD)'}
                  </span>
                  <span className="flex items-center gap-1 text-(length:--t-label) uppercase tracking-wider text-emerald-400/70">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 inline-block" />
                    {isRtl ? 'تلقائي' : 'Auto'}
                  </span>
                </div>
                <div className={cn('text-sm font-mono number-ltr font-semibold',
                  ld.netCostImpact < 0 ? 'text-chart-3' : 'text-white')}>
                  {formatMoney(ld.netCostImpact, { currency: ccy })}
                </div>
                <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
                  {isRtl ? 'إجمالي تكلفة التأخير − الغرامة' : 'Gross Delay Cost − LD Exposure'}
                  {' '}({formatMoney(ld.grossDelayCost, { currency: ccy })})
                </div>
              </div>
            </div>

            {/* Cap utilisation */}
            {ld.ldCapAmount > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                  <span className="uppercase tracking-widest">{isRtl ? 'استهلاك الحد الأقصى' : 'Cap Utilisation'}</span>
                  <span className="font-mono">
                    {formatMoney(ld.ldExposure, { currency: ccy })} / {formatMoney(ld.ldCapAmount, { currency: ccy })}
                    {' '}({Math.min(100, (ld.ldExposure / ld.ldCapAmount) * 100).toFixed(1)}%)
                  </span>
                </div>
                <div className="h-3 bg-white/5 rounded-sm overflow-hidden">
                  <div
                    className={cn('h-full transition-all', ld.capReached ? 'bg-chart-3' : 'bg-chart-5/60')}
                    style={{ width: `${Math.min(100, (ld.ldExposure / ld.ldCapAmount) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {ld.culpableDelay === 0 && ld.totalDelay > 0 && (
              <p className="text-(length:--t-second) text-white/25 italic mt-3">
                {isRtl
                  ? 'التمديد المعتمد يغطي كامل التأخير — لا توجد غرامة مستحقة حالياً.'
                  : 'Approved extension covers the full delay — no LD currently due.'}
              </p>
            )}
          </section>

          {/* ══ WINDOWS — monthly history for THIS subcontract ══
              Independent of the project's own windows, but each entry keeps the
              project position for the same month so the two can be compared. */}
          {windows.length > 0 && (
            <section>
              <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                <h5 className="text-xs font-serif uppercase tracking-widest text-primary flex items-center gap-2">
                  <LayoutGrid className="w-3.5 h-3.5" />
                  {isRtl ? 'تحليل النوافذ' : 'Windows'}
                  <span className="text-muted-foreground font-sans normal-case tracking-normal">({windows.length})</span>
                </h5>
                <button
                  onClick={() => setShowWindows(v => !v)}
                  className="flex items-center gap-2 text-(length:--t-label) uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
                >
                  {showWindows ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {showWindows ? (isRtl ? 'إخفاء' : 'Hide') : (isRtl ? 'عرض' : 'Show')}
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {windows.map(w => {
                  const closed = isWindowClosed(w.id);
                  const active = selectedWindow === w.id;
                  return (
                    <button
                      key={w.id}
                      onClick={() => { setSelectedWindow(active ? null : w.id); setShowWindows(true); }}
                      className={cn(
                        'inline-flex items-center gap-2 px-3 py-1.5 text-(length:--t-body) border rounded-md transition-colors uppercase tracking-wider',
                        active ? 'bg-primary/10 text-primary border-primary'
                               : 'border-white/[0.06] text-muted-foreground hover:text-white',
                      )}
                    >
                      {windowLabel(w.id, isRtl ? 'ar' : 'en')}
                      <span className={cn('w-1.5 h-1.5 rounded-full', closed ? 'bg-white/20' : 'bg-emerald-400/70')} />
                    </button>
                  );
                })}
              </div>

              {showWindows && selectedWindow && (() => {
                const w = windows.find(x => x.id === selectedWindow);
                if (!w) return null;
                const closed = isWindowClosed(w.id);
                const sc = w.subcontract;
                const cell = (label: string, val: string, c = 'text-white') => (
                  <div className="bg-black/40 p-3">
                    <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{label}</div>
                    <div className={cn('text-sm font-mono number-ltr font-semibold', c)}>{val}</div>
                  </div>
                );
                return (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <span className="text-(length:--t-label) font-serif uppercase tracking-widest text-primary">
                        {windowLabel(w.id, isRtl ? 'ar' : 'en')} — {isRtl ? 'يُغلق في' : 'closes'} {formatDate(w.closesOn, isRtl ? 'ar' : 'en')}
                      </span>
                      <span className={cn('text-(length:--t-second) uppercase tracking-wider px-2 py-1 border rounded-full',
                        closed ? 'border-white/10 text-white/30' : 'border-emerald-500/30 text-emerald-400/80')}>
                        {closed ? (isRtl ? 'للقراءة فقط' : 'Read-only') : (isRtl ? 'مفتوح' : 'Open')}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-px bg-white/5">
                      {/* Contract Value leads; Contract Amount = Value + approved COs.
                          LD and Approved Finish Date sit on the headline run.
                          Approved EOT is deliberately absent — Approved Finish
                          Date already carries the approved extension. */}
                      {cell(isRtl ? 'قيمة العقد' : 'Contract Value', formatMoney(sc.originalContract, { currency: ccy }))}
                      {cell(isRtl ? 'مبلغ العقد' : 'Contract Amount', formatMoney(sc.currentContract, { currency: ccy }), 'text-primary')}
                      {cell(isRtl ? 'الغرامة' : 'LD Exposure', formatMoney(sc.ldExposure, { currency: ccy }), sc.ldExposure > 0 ? 'text-chart-3' : 'text-muted-foreground')}
                      {cell(isRtl ? 'تاريخ الانتهاء المعتمد' : 'Approved Finish Date', formatDateOrDash(sc.approvedFinish, isRtl ? 'ar' : 'en'), 'text-primary')}
                      {cell(isRtl ? 'المعتمد' : 'Certified', formatMoney(sc.certified, { currency: ccy }), 'text-primary')}
                      {cell(isRtl ? 'المدفوع' : 'Paid', formatMoney(sc.paid, { currency: ccy }), 'text-chart-4')}
                      {cell(isRtl ? 'المستحق' : 'Outstanding', formatMoney(sc.outstanding, { currency: ccy }), 'text-chart-3')}
                      {cell(isRtl ? 'إجمالي التأخير' : 'Total Delay', `${sc.totalDelay}d`)}
                      {cell(isRtl ? 'أيام التأخير' : 'Delay Days', `${sc.delayDays}d`, 'text-chart-5')}
                      {cell(isRtl ? 'الانتهاء المتوقع' : 'Forecast Finish', formatDateOrDash(sc.forecastFinish, isRtl ? 'ar' : 'en'), 'text-chart-5')}
                      {cell(isRtl ? 'الفرق' : 'Current Variance', `${sc.currentVariance}d`, 'text-chart-5')}
                      {cell(isRtl ? 'التعويض المطلوب' : 'Recovery Required', `${Math.max(0, sc.currentVariance)}d`, 'text-chart-5')}
                      {cell(isRtl ? 'تكلفة التأخير' : 'Cost Impact', formatMoney(sc.costImpact, { currency: ccy }), 'text-chart-3')}
                      {cell(isRtl ? 'عدد الأحداث' : 'Delay Events', `${w.delayEventCount}`)}
                    </div>

                    {/* Project position in the same month, for comparison. */}
                    <p className="text-(length:--t-label) uppercase tracking-widest text-primary/60 font-mono mt-3 mb-1">
                      {isRtl ? 'موقف المشروع في نفس الشهر' : 'Project position — same month'}
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5">
                      {cell(isRtl ? 'تأخير المشروع' : 'Project Total Delay', `${w.project.totalDelay}d`, 'text-muted-foreground')}
                      {cell(isRtl ? 'تمديد المشروع' : 'Project Approved EOT', `${w.project.approvedEot}d`, 'text-muted-foreground')}
                      {cell(isRtl ? 'غير المعوّض' : 'Project Unmitigated', `${w.project.unmitigatedDelay}d`, 'text-muted-foreground')}
                      {cell(isRtl ? 'غرامة المشروع' : 'Project LD', formatMoney(w.project.ldExposure, { currency: ccy }), 'text-muted-foreground')}
                    </div>

                    <p className="text-(length:--t-second) text-white/45 italic mt-2">
                      {isRtl
                        ? 'لقطة تاريخية — لا يُعاد حسابها عند فتح نافذة قديمة.'
                        : 'Historical snapshot — never recalculated when an old window is opened.'}
                    </p>
                  </div>
                );
              })()}
            </section>
          )}

        </>)}

      </div>
    </div>
  );
}
