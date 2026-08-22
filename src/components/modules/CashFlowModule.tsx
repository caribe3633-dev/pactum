import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useTranslation } from '../../lib/i18n';
import { formatMoney } from '../../lib/utils';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Brush, ReferenceLine,
} from 'recharts';
import { Plus, Trash2, RefreshCw, ArrowRightLeft, CheckCircle, ChevronDown, ChevronUp, AlertTriangle, CalendarRange, TrendingUp } from 'lucide-react';
// The platform's single date renderer — `30 June 2025` everywhere.
import { formatDate } from '../../lib/dateFormat';
import { EditableNumber, EditableText } from '../EditableCell';
import { cn } from '../../lib/utils';
import { kpiMoney, exactMoney } from '../../lib/moneyFormat';
import ReportButton from '../reporting/ReportButton';
// Phase 3.4 — real dates alongside the month label. The label remains the
// join key that CertsModule and both sync functions match on; dates are
// additive, so a row without them behaves exactly as it did before.
import { monthLabel, windowOf,
  CashFlowDates, datesFrom, planMigration, applyMigration,
  parseMonthLabel, fxDateOf, hasDates, groupByWindow,
  normaliseIso, lastDayOfMonth,
  CashFlowCurrency,
} from '../../lib/cashFlowDates';
// SPRINT 1 · TASK 2 — a cash row must say what currency it is counted in.
// Shared with CertsModule (the second writer) so both produce one shape.
import { convertCashRow, noRateMessage, cashVariance, cashVarianceTotals, cashSeries, cashCumulativeTable, cashNetTable } from '../../lib/cashFlowMoney';
import { moneyContext, resolveTxnDate, transactionContext, readTransactionMoney } from '../../lib/moneyEntry';
import { contractCurrencyOf } from '../../lib/projectCurrency';
import { companyIdOfProject } from '../../lib/projectMaster';
import { fetchSectors } from '../../mock/sectors';
import { CurrencyBadge } from '../CurrencyAmount';
/**
 * SOURCE VERSIONING. This register is one of the five a Baseline Package
 * is built from, so the version line belongs on the screen that owns the
 * data — not only on the Baseline screen. Capturing a version reads this
 * store; it never writes to it.
 */
import SourceVersionsPanel from '../SourceVersionsPanel';


/** `2025-06-30` -> `2025-06`. The reporting window is an identifier,
 *  not a date, so it is never run through `formatDate`. */
function parseMonthWindow(iso: string): string {
  return /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : '';
}

// ── Types ────────────────────────────────────────────────────────────

interface CashRow extends CashFlowDates, CashFlowCurrency {
  /**
   * The period label. STILL THE JOIN KEY — CertsModule and both sync
   * functions match rows on `r.month === cert.period`. Changing it would
   * break that join across two writers, so dates were added beside it
   * rather than in place of it.
   */
  month: string;
  /**
   * ACTUAL cash movement. The field names stay `in`/`out` — unchanged —
   * because `baselines.ts`, `portfolio.ts` and `timeline.ts` all read
   * them, and renaming a persisted key would orphan every filed record.
   */
  in: number;
  out: number;
  net: number;
  cumNet: number;

  /**
   * PLANNED cash movement for the same period.
   *
   * ══════════════════════════════════════════════════════════════════
   * WHY THESE ARE OPTIONAL, AND WHY `in`/`out` DID NOT CHANGE MEANING
   *
   * Every existing row was captured as an ACTUAL movement, so treating
   * the stored `in`/`out` as anything else would silently restate
   * history. The plan arrives as new, optional fields: a legacy row
   * simply has no plan, which is the truth about it.
   *
   * A row with no plan reports no variance at all rather than a
   * variance against zero — "we did not forecast this" and "we
   * forecast nothing" are different statements, and only the second
   * would justify showing the whole actual as an overrun.
   * ══════════════════════════════════════════════════════════════════
   */
  plannedIn?: number;
  plannedOut?: number;
}

interface CertRow { no: string; period: string; gross: number; retention: number; net: number; status: string; }
interface SyncEntry { source: string; label: string; amount: number; syncedAt: string; direction: 'in' | 'out'; }

// ── Helpers ───────────────────────────────────────────────────────────

function readOwnerCerts(projectId: string): CertRow[] {
  try {
    const raw = localStorage.getItem(`pactum-certs-${projectId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function readCashflowSyncLog(projectId: string): SyncEntry[] {
  try {
    const raw = localStorage.getItem(`pactum-cashflow-sync-${projectId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function appendCashflowSyncLog(projectId: string, entries: SyncEntry[]): void {
  const log = readCashflowSyncLog(projectId);
  const next = [...entries, ...log].slice(0, 50);
  localStorage.setItem(`pactum-cashflow-sync-${projectId}`, JSON.stringify(next));
}

// ── Main Component ────────────────────────────────────────────────────

// ── Internal tabs — the EVM pattern, two views of one truth ───────────
//
// PERIODS    : entry, exactly as it has always been — one row per period,
//              typed inline. Nothing about the way data goes in changes.
// CUMULATIVE : a derived, READ-ONLY view of the same rows — running sums
//              and S-curves. Nothing cumulative is ever typed anywhere.
type CashTab = 'periods' | 'cumulative' | 'net';
const CASH_TABS: { id: CashTab; icon: any; en: string; ar: string }[] = [
  { id: 'periods',    icon: CalendarRange, en: 'Periods',    ar: 'الفترات' },
  { id: 'cumulative', icon: TrendingUp,    en: 'Cumulative', ar: 'التراكمي' },
  { id: 'net',        icon: ArrowRightLeft, en: 'Net',       ar: 'الصافي' },
];

// ACTUAL cash colours, tuned for the dark card background. The old
// #2f6b45 / #a02c26 were DARKER than the plan colours beside them and
// close to the background itself — the lines were drawn (verified by an
// off-screen render) and still invisible. Bright beats muted for the
// actuals; the PLAN keeps the pale, dashed, half-opacity treatment so
// what happened reads before what was intended.
const CASH_IN  = '#52c98b';
const CASH_OUT = '#ff7a6e';

/** Above this many periods the dots come off and the Brush does the
 *  focusing — a 5-year monthly project draws 60 dots per series. */
const DOT_LIMIT = 24;

export default function CashFlowModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  const { t, lang } = useTranslation();
  const [data,    setData]    = useState<CashRow[]>([]);
  // Which internal view is open. Entry lives on PERIODS; the default is
  // the entry view so the screen opens exactly where the work happens.
  const [tab, setTab] = useState<CashTab>('periods');
  const [syncLog, setSyncLog] = useState<SyncEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showSync, setShowSync] = useState(true);
  const [syncDone, setSyncDone] = useState(false);
  /** Result of the legacy-label migration, for the banner. */
  const [migration, setMigration] = useState<ReturnType<typeof planMigration> | null>(null);
  /** Why a row could not be saved — shown instead of saving a wrong figure. */
  const [saveErr, setSaveErr] = useState('');

  // ── Currency frame ──────────────────────────────────────────────────
  // Identical wiring to CertsModule and ChangesModule, deliberately: the
  // three modules write to the same ledger and must agree on what a
  // currency means.
  const companyId = useMemo(
    () => companyIdOfProject(project as any, fetchSectors()),
    [project.id],
  );
  const money = useMemo(() => moneyContext(companyId, project.id), [companyId, project.id]);
  /** Project contract currency — what a new row pre-selects. */
  /**
   * CASH FLOW IS ENTERED IN THE CONTRACT CURRENCY. Confirmed rule.
   *
   * Unlike Change Orders, Claims, Certificates and Subcontracts, this
   * module offers NO per-row currency selector: a cash movement on this
   * project is a movement under this contract, so the unit is fixed.
   *
   * The row still travels through the transaction layer — it is
   * converted into the reporting currency at its own date and the rate
   * is frozen on it — because the reporting currency may differ from the
   * contract currency even when the entry unit never varies. That is why
   * `totalIn` / `totalOut` below read `reportingCurrencyValue` rather
   * than the raw field.
   */
  const contractCcy = useMemo(
    () => contractCurrencyOf(project.id, money.base), [project.id, money.base]);
  const txnCtx = useMemo(
    () => transactionContext(companyId, project.id, contractCcy),
    [companyId, project.id, contractCcy]);

  useEffect(() => {
    const stored = localStorage.getItem(`pactum-cashflow-${project.id}`);
    if (stored) {
      const rows: CashRow[] = JSON.parse(stored);
      // Legacy rows carry a label and no dates. Infer a month-end date where
      // the label is legible; leave the rest exactly as they are. A row that
      // cannot be read keeps working and is listed for manual entry —
      // guessing would produce a real rate against a fabricated date.
      const undated = rows.filter(r => !hasDates(r));
      if (undated.length > 0) {
        const plan = planMigration(rows, new Date().getFullYear());
        setMigration(plan);
        if (plan.migrated > 0) {
          const next = applyMigration(rows, plan);
          setData(next);
          localStorage.setItem(`pactum-cashflow-${project.id}`, JSON.stringify(next));
        } else {
          setData(rows);
        }
      } else {
        setData(rows);
      }
    } else {
      // PHASE 3G — no auto-seed. Opening a screen must never CREATE
      // data. An empty store stays empty until the user enters a row or
      // presses "Load Sample Data".
      setData([]);
    }
    setSyncLog(readCashflowSyncLog(project.id));
  }, [project.id]);

  /**
   * Does ANY row carry a plan?
   *
   * ══════════════════════════════════════════════════════════════════
   * A DEADLOCK I BUILT, AND THE FIX.
   *
   * The first version showed the plan columns ONLY when some row already
   * had a plan. But a plan can only be entered THROUGH those columns (or
   * on a brand-new row), so a project whose rows all pre-date the feature
   * could never enter one: the columns hid because there was no plan, and
   * there could be no plan because the columns were hidden.
   *
   * Measured on a real ledger: six rows, none with a plan, and no way in.
   *
   * The columns are now shown whenever the user CAN edit — an editor
   * needs the cells to type into. They stay hidden for a read-only
   * viewer on a project that never forecast, which was the only case the
   * hiding was ever meant to serve.
   * ══════════════════════════════════════════════════════════════════
   */
  const hasAnyPlan = useMemo(
    () => data.some(r => r.plannedIn !== undefined || r.plannedOut !== undefined),
    [data],
  );
  /** Show the plan columns to anyone who could enter a plan. */
  const anyPlanned = canEdit || hasAnyPlan;
  /** Plan-versus-actual across every row that has a plan. */
  const varianceTotals = useMemo(() => cashVarianceTotals(data), [data]);
  /**
   * Chart + table series, carrying BOTH running totals.
   *
   * Derived rather than stored: the planned curve is a pure function of
   * the planned figures, so it cannot fall out of step with them after
   * an edit the way a second persisted field would.
   */
  /**
   * ══════════════════════════════════════════════════════════════════
   * CHRONOLOGICAL ORDER FOR THE MATHS, NEWEST-FIRST FOR THE EYE.
   *
   * The stored rows were in entry order, not date order — 2024-02,
   * 2024-04, 2024-07, 2026-10, 2025-02, 2024-03 — and the cumulative
   * column simply added them in that sequence. It therefore climbed to
   * 327,635, then to 340,400, then FELL to 320,400. A running total that
   * goes down is not a running total.
   *
   * So the order is computed ONCE, chronologically, and only the
   * PRESENTATION is reversed. `chrono` is what every sum walks;
   * `display` is what the table renders.
   *
   * NOTHING IS RESTATED. No stored value changes, no PV/EV/AC is
   * touched, and a row with an unparseable month keeps its original
   * position rather than being silently dropped to the end.
   * ══════════════════════════════════════════════════════════════════
   */
  const monthKey = (m: string): string => {
    const t = String(m || '').trim();
    // yyyy-mm sorts correctly as a plain string. Anything else keeps its
    // entry order via the stable index tiebreak below.
    return /^\d{4}-\d{2}$/.test(t) ? t : '';
  };

  const chrono = useMemo(() => {
    return data
      .map((row, originalIndex) => ({ row, originalIndex, key: monthKey(row.month) }))
      .sort((a, b) => {
        if (a.key && b.key) return a.key < b.key ? -1 : a.key > b.key ? 1 : a.originalIndex - b.originalIndex;
        if (a.key) return -1;          // dated rows before undated ones
        if (b.key) return 1;
        return a.originalIndex - b.originalIndex;
      });
  }, [data]);

  /** Oldest → newest. Every cumulative figure is computed on this. */
  const chronoRows = useMemo(() => chrono.map(x => x.row), [chrono]);

  /**
   * Cumulative ACTUAL — now derived whole by `cashCumulativeTable`
   * (fed the same chrono rows), which the Cumulative tab renders. The
   * old per-row helper is gone; the stored `cumNet` field is still left
   * untouched — nothing on disk is ever restated to fix a view.
   */

  const series = useMemo(() => cashSeries(chronoRows), [chronoRows]);

  /** The cumulative table's rows — derived from the same chrono rows,
   *  read-only, never stored. Same order: oldest → newest. */
  const cumRows = useMemo(() => cashCumulativeTable(chronoRows), [chronoRows]);

  /** The Net view's rows — planned balance vs actual balance per period. */
  const netRows = useMemo(() => cashNetTable(chronoRows), [chronoRows]);

  /** Long horizons lose the dots and gain the zoom brush. */
  const manyPeriods = chronoRows.length > DOT_LIMIT;

  /** Newest → oldest, for the table only. */
  const display = useMemo(() => chrono.slice().reverse(), [chrono]);

  const persist = (next: CashRow[]) => {
    setData(next);
    localStorage.setItem(`pactum-cashflow-${project.id}`, JSON.stringify(next));
  };

  const recalcCum = (rows: Omit<CashRow, 'cumNet'>[]): CashRow[] => {
    let cum = 0;
    return rows.map(r => { cum += r.net; return { ...r, cumNet: cum }; });
  };

  const updateField = (
    index: number,
    field: 'month' | 'in' | 'out' | 'plannedIn' | 'plannedOut',
    value: any,
  ) => {
    const updated = data.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, [field]: field === 'month' ? value : Number(value) };
      next.net = next.in - next.out;
      return next;
    });
    persist(recalcCum(updated));
  };

  const [isAdding, setIsAdding] = useState(false);
  const [newRow, setNewRow] = useState({
    month: '', in: '', out: '', plannedIn: '', plannedOut: '',
    transactionDate: new Date().toISOString().slice(0, 10),
    effectiveDate: '',
    currency: contractCcy,
  });

  // The currency select defaults to the project's contract currency. It is
  // resolved asynchronously on first render, so the default is applied once
  // it is known rather than freezing an empty string into the form.
  useEffect(() => {
    setNewRow(r => (r.currency ? r : { ...r, currency: contractCcy }));
  }, [contractCcy]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRow.month || !newRow.in || !newRow.out) return;
    setSaveErr('');

    /**
     * THE DATE IS VALIDATED BEFORE IT IS TRUSTED.
     *
     * ══════════════════════════════════════════════════════════════════
     * `<input type="date">` normally yields ISO, but not always: with
     * the field cleared it yields '', and a browser mid-edit can report
     * a partial value. Passing either into `datesFrom` produced a row
     * with no usable FX date, which then silently could not convert —
     * the same class of defect `planMigration` exists to flag on legacy
     * rows, reintroduced through the front door.
     *
     * Refusing here means a stored row ALWAYS has a well-formed ISO
     * date, so every reader downstream can rely on that without
     * re-checking.
     * ══════════════════════════════════════════════════════════════════
     */
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    if (!ISO.test(newRow.transactionDate)) {
      setSaveErr(lang === 'ar'
        ? 'تاريخ المعاملة غير صالح. اختر تاريخاً من التقويم.'
        : 'Transaction date is not a valid date. Pick one from the calendar.');
      return;
    }
    if (newRow.effectiveDate && !ISO.test(newRow.effectiveDate)) {
      setSaveErr(lang === 'ar'
        ? 'تاريخ السريان غير صالح. اتركه فارغاً أو اختر تاريخاً من التقويم.'
        : 'Effective date is not a valid date. Leave it empty or pick one.');
      return;
    }
    // An effective date BEFORE the money moved is almost always a typo,
    // and it silently changes which FX rate applies.
    if (newRow.effectiveDate && newRow.effectiveDate < newRow.transactionDate) {
      setSaveErr(lang === 'ar'
        ? 'تاريخ السريان أسبق من تاريخ المعاملة — راجعه، فهو يحدد سعر الصرف.'
        : 'The effective date precedes the transaction date — check it, as it selects the FX rate.');
      return;
    }

    // The four dates are derived once, here, from what was entered.
    const dates = datesFrom(newRow.transactionDate, {
      effectiveDate: newRow.effectiveDate || undefined,
      source: 'entered',
    });

    // Conversion runs against the row's own FX snapshot date — the date the
    // money moved — never today. One rate covers both amounts so that
    // `net = in - out` still holds exactly after conversion.
    const txn = resolveTxnDate(
      { date: dates.fxSnapshotDate || newRow.transactionDate }, ['date']);
    // The plan is only sent when the user actually entered one, so a row
    // left blank stores no plan rather than a plan of zero.
    const hasPlan = newRow.plannedIn !== '' || newRow.plannedOut !== '';
    const conv = convertCashRow(
      txnCtx,
      { in: newRow.in, out: newRow.out,
        ...(hasPlan ? { plannedIn: newRow.plannedIn || 0,
                        plannedOut: newRow.plannedOut || 0 } : {}) },
      newRow.currency, txn);

    if (!conv.resolved) {
      // No rate on that date. Saving would store a figure that looks
      // converted and is not, so the row is refused and the reason stated.
      setSaveErr(noRateMessage(conv.from, conv.to, txn.date, lang === 'ar'));
      return;
    }

    persist(recalcCum([...data, {
      month: newRow.month,
      in: conv.in, out: conv.out, net: conv.net, cumNet: 0,
      ...(hasPlan
        ? { plannedIn: conv.plannedIn ?? 0, plannedOut: conv.plannedOut ?? 0 }
        : {}),
      ...dates,
      ...conv.fields,
    }]));
    setNewRow({ month: '', in: '', out: '', plannedIn: '', plannedOut: '',
                transactionDate: new Date().toISOString().slice(0, 10),
                effectiveDate: '', currency: contractCcy });
    setIsAdding(false);
  };

  const handleDelete = (index: number) => persist(recalcCum(data.filter((_, i) => i !== index)));

  // ── IPC Sync — Owner Certs → Cash In ─────────────────────────────────
  const handleSyncOwnerIPCs = useCallback(() => {
    setSyncing(true);
    setTimeout(() => {
      const certs     = readOwnerCerts(project.id);
      /**
       * PAID ONLY — not merely certified.
       *
       * ════════════════════════════════════════════════════════════════
       * Cash In is money that ARRIVED. A certified IPC is an approved
       * claim on the owner; it is a receivable, not a receipt, and the
       * two are weeks or months apart on a real project.
       *
       * Counting `certified` here inflated Cash In by everything approved
       * but unpaid, so a project awaiting payment showed a healthy cash
       * position it did not have — the single most misleading number a
       * cash flow can carry.
       * ════════════════════════════════════════════════════════════════
       */
      /* PAID ONLY, and the link month is the PAYMENT DATE — exclusively.
         A paid certificate without a payment date cannot be placed in a
         month and is skipped rather than guessed into the wrong one. */
      const eligible  = certs.filter(c =>
        c.status === 'paid' && !!normaliseIso((c as any).paymentDate));
      const newEntries: SyncEntry[] = [];

      const currentRows = [...data];
      for (const cert of eligible) {
        const label = cert.period || cert.no;
        /* Same date-derived join as CertsModule: the certificate's real
           date decides the monthly window; free-text labels are the last
           resort only. */
        const asWindow = (m: string): string => {
          if (/^\d{4}-\d{2}/.test(m)) return m.slice(0, 7);
          const d = normaliseIso(m);
          return d ? windowOf(d) : '';
        };
        const certIsoW = normaliseIso((cert as any).paymentDate);
        const win = certIsoW ? windowOf(certIsoW) : '';
        const idx = currentRows.findIndex(r => {
          if (win) {
            const rw = asWindow(r.month);
            if (rw) return rw === win;
          }
          return r.month === label;
        });
        if (idx >= 0) {
          currentRows[idx] = {
            ...currentRows[idx],
            in: currentRows[idx].in + cert.net,
            net: currentRows[idx].in + cert.net - currentRows[idx].out,
          };
        } else {
          // A certificate knows its own dates. Taking them is derivation,
          // not inference: the date comes from the source document rather
          // than from reading a label.
          const certDate = normaliseIso((cert as any).paymentDate);
          const parsed = certDate ? '' : parseMonthLabel(label, new Date().getFullYear()).date;
          const iso = certDate || parsed;
          currentRows.push({
            month: iso || label, in: cert.net, out: 0, net: cert.net, cumNet: 0,
            ...(iso ? datesFrom(iso, { source: certDate ? 'derived' : 'inferred' }) : {}),
          });
        }
        newEntries.push({ source: 'Owner IPC', label: cert.no, amount: cert.net, syncedAt: new Date().toLocaleString(), direction: 'in' });
      }

      persist(recalcCum(currentRows));
      if (newEntries.length > 0) {
        appendCashflowSyncLog(project.id, newEntries);
        setSyncLog(readCashflowSyncLog(project.id));
      }
      setSyncing(false);
      setSyncDone(true);
      setTimeout(() => setSyncDone(false), 2500);
    }, 300);
  }, [project.id, data]);

  // ── Sub IPC Sync — Paid Sub Certs → Cash Out ──────────────────────────
  /**
   * SUBCONTRACTOR SYNC — REMOVED.
   *
   * ══════════════════════════════════════════════════════════════════════
   * It pushed paid subcontractor certificates into this project's Cash Out,
   * which double-counts. A subcontractor is paid OUT OF money the project
   * already records leaving it: the payment appears once as a real
   * disbursement and again as a synced certificate, and the ledger
   * overstates spending by the whole subcontract value.
   *
   * The two registers also answer different questions. Cash Out is the
   * project's treasury position; subcontract certification is a commercial
   * position against a counterparty, which the Subcontractors module already
   * tracks with its own retention, LD and certification rules. Wiring one
   * into the other made an edit in a commercial register silently move a
   * treasury figure.
   *
   * Subcontractor payments still belong in Cash Out — entered as the
   * disbursements they are, once, by whoever owns the ledger.
   * ══════════════════════════════════════════════════════════════════════
   */

  // ── Derived summary ───────────────────────────────────────────────────
  // Rows store CONVERTED amounts, so these are already in one currency.
  // Read through the transaction layer anyway: a legacy row with no
  // currency metadata is then treated by the same documented rule as
  // everywhere else, rather than by an assumption local to this file.
  const totalIn  = data.reduce((a, r) =>
    a + readTransactionMoney(r, 'in',  contractCcy, money.base).reportingCurrencyValue, 0);
  const totalOut = data.reduce((a, r) =>
    a + readTransactionMoney(r, 'out', contractCcy, money.base).reportingCurrencyValue, 0);
  const netFlow  = totalIn - totalOut;
  const ownerCerts  = readOwnerCerts(project.id);
  const eligibleIPCs = ownerCerts.filter(c => c.status === 'paid').length;

  const tooltipStyle = {
    contentStyle: { backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--primary)/0.35)', borderRadius: 4, padding: '8px 12px', fontSize: '12px', color: '#ffffff' },
    /** Tooltip readability (owner report): gold period label, white mono
     *  figures, soft gold cursor — hover was grey-on-dark everywhere. */
    labelStyle: { color: 'hsl(var(--primary))', fontWeight: 600, marginBottom: 4 },
    itemStyle: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#ffffff' },
    cursor: { fill: 'rgba(212,175,55,0.10)', stroke: 'rgba(212,175,55,0.35)' },
  };

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      <SourceVersionsPanel projectId={project.id} only="cashflow" canEdit={canEdit} compact />


      {/* ── IPC Sync Panel ───────────────────────────────────────────── */}
      <div className="ds-card ds-card-key !p-0 overflow-hidden">
        <button
          onClick={() => setShowSync(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 bg-black/40 hover:bg-black/60 transition-colors"
        >
          <div className="flex items-center gap-3">
            <ArrowRightLeft className="w-4 h-4 text-primary/60" />
            <span className="text-sm font-serif uppercase tracking-widest text-primary">IPC / Cash Flow Integration</span>
            {eligibleIPCs > 0 && (
              <span className="text-(length:--t-micro) px-2 py-0.5 bg-primary/15 text-primary border border-primary/20 uppercase tracking-wider">
                {eligibleIPCs} certs eligible
              </span>
            )}
          </div>
          {showSync ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {showSync && (
          <div className="p-5">
            <p className="text-(length:--t-body) text-white/30 mb-5 max-w-2xl">
              PAID Owner IPCs update Cash In — money that has arrived, not
              merely been approved. Syncing creates or updates monthly rows
              using each IPC's period label. Cash Out is entered directly:
              it is the project's own treasury position, not a mirror of a
              counterparty's certification.
            </p>

            <div className="mb-5">
              {/* Owner IPC block */}
              <div className="bg-black/30 border border-white/5 p-4">
                <div className="text-(length:--t-label) uppercase tracking-widest text-chart-4/60 mb-2 font-mono">Paid Owner IPCs → Cash In</div>
                <div className="text-xs text-white/40 mb-3">
                  {eligibleIPCs} paid IPC{eligibleIPCs !== 1 ? 's' : ''} available for sync.
                  Total received: {formatMoney(ownerCerts.filter(c => c.status === 'paid').reduce((a, c) => a + c.net, 0), { currency: money.base })}
                </div>
                {canEdit && (
                  <button
                    onClick={handleSyncOwnerIPCs}
                    disabled={syncing || eligibleIPCs === 0}
                    className="flex items-center gap-2 text-(length:--t-label) bg-chart-4/10 text-chart-4 border border-chart-4/25 hover:bg-chart-4/20 px-4 py-2 transition-colors uppercase tracking-wider disabled:opacity-40"
                  >
                    <RefreshCw className={cn('w-3 h-3', syncing && 'animate-spin')} />
                    Auto-Sync Owner IPCs
                  </button>
                )}
              </div>

            </div>

            {/* Status + log toggle */}
            <div className="flex items-center gap-4">
              {syncDone && (
                <span className="flex items-center gap-1.5 text-(length:--t-micro) text-chart-4 border border-chart-4/20 px-2 py-1">
                  <CheckCircle className="w-3 h-3" /> Sync complete — Cash Flow updated
                </span>
              )}
              <button
                onClick={() => setShowLog(v => !v)}
                className="text-(length:--t-label) text-white/45 hover:text-white/60 border border-white/10 px-3 py-1 transition-colors uppercase tracking-wider"
              >
                {showLog ? 'Hide' : 'Show'} Sync Log ({syncLog.length})
              </button>
            </div>

            {showLog && syncLog.length > 0 && (
              <div className="mt-4 border border-white/5 bg-black/40 overflow-hidden">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Reference</th>
                      <th className="money">Amount</th>
                      <th>Direction</th>
                      <th>Synced At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncLog.slice(0, 15).map((e, i) => (
                      <tr key={i} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-2 text-white/60 truncate max-w-[160px]">{e.source}</td>
                        <td className="px-4 py-2 font-mono text-primary">{e.label}</td>
                        <td className={cn('px-4 py-2 font-mono', e.direction === 'in' ? 'text-chart-4' : 'text-chart-3')}>{formatMoney(e.amount, { currency: money.base })}</td>
                        <td className="px-4 py-2">
                          <span className={cn('text-(length:--t-micro) uppercase border px-1.5 py-0.5',
                            e.direction === 'in' ? 'border-chart-4/20 text-chart-4' : 'border-chart-3/20 text-chart-3')}>
                            {e.direction === 'in' ? 'Cash In' : 'Cash Out'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground font-mono">{e.syncedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2 · EXECUTIVE SUMMARY
          Actuals on top, plan directly beneath, column for column:
          Cash In over Planned In, Cash Out over Planned Out, Net Cash
          over Planned Net. Two strips of three rather than six in one —
          the platform's card grid is three per row, and stacking keeps
          that rule while making the comparison vertical. */}
      <div className={cn('kpi-strip !grid-cols-3', hasAnyPlan && '!mb-0')}>
        <div className="kpi">
          <div className="kpi-k">{t.cashIn}</div>
          <div className="kpi-v kpi-v-ok money" title={exactMoney(totalIn, money.base)}>{kpiMoney(totalIn, money.base)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t.cashOut}</div>
          <div className="kpi-v kpi-v-risk money" title={exactMoney(totalOut, money.base)}>{kpiMoney(totalOut, money.base)}</div>
        </div>
        <div className="kpi kpi-hero">
          <div className="kpi-k">{lang === 'ar' ? 'الصافي الفعلي' : 'Net Cash'}</div>
          <div className={cn('kpi-v money', netFlow >= 0 ? 'kpi-v-gold' : 'kpi-v-risk')} title={exactMoney(netFlow, money.base)}>{kpiMoney(netFlow, money.base)}</div>
        </div>
      </div>

      {/* PLAN VERSUS ACTUAL — only when a plan exists.
          The population is stated on the tile: a variance computed over
          three of twelve months is a real number about a partial set, and
          a reader who is not told that will read it as the whole year. */}
      {hasAnyPlan && (
        <div className="kpi-strip !grid-cols-3 !border-t-0">
          <div className="kpi">
            <div className="kpi-k">{lang === 'ar' ? 'وارد مخطط' : 'Planned In'}</div>
            {/* Same tone as Cash In directly above it — the two strips
                line up column for column, so plan and actual read as a
                pair rather than as unrelated rows of numbers. */}
            <div className="kpi-v kpi-v-ok money">
              {formatMoney(varianceTotals.plannedIn, { currency: money.base })}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-k">{lang === 'ar' ? 'صادر مخطط' : 'Planned Out'}</div>
            <div className="kpi-v kpi-v-risk money">
              {formatMoney(varianceTotals.plannedOut, { currency: money.base })}
            </div>
          </div>
          {/*
            PLANNED NET — the figure that was computed but never shown.
            Planned In and Planned Out both sat on this strip while the
            number they imply did not, so the only "net" on screen was the
            VARIANCE — and a reader seeing -110,400 beside a plan that
            collects more than it spends reasonably concluded the maths
            was broken. It was not; the reassuring number was missing.

            NET VARIANCE HAS BEEN REMOVED FROM THIS STRIP.

            It was mathematically correct and practically misleading. On
            a project where nothing has been received or paid yet, Net
            Cash is 0, so Net Variance is simply Planned Net with the
            sign flipped: a red −160,400 sitting beside a green +160,400
            that says the exact same thing twice. Every reader asked the
            same question — "why is it negative when we collect more
            than we spend?" — and the honest answer was that the tile
            was not telling them anything the two beside it did not.

            The variance has NOT been deleted from the system. It is
            still computed by `cashVarianceTotals` and still shown PER
            PERIOD in the table below, where it answers a real question:
            which month drifted. Aggregated to a single headline it
            answered none.

            What remains:
              Planned Net  = Planned In − Planned Out
              Net Cash     = Cash In − Cash Out   (on the strip above)
          */}
          <div className="kpi">
            <div className="kpi-k">{lang === 'ar' ? 'الصافي المخطط' : 'Planned Net'}</div>
            <div className={cn('kpi-v money',
              (varianceTotals.plannedIn - varianceTotals.plannedOut) >= 0 ? 'kpi-v-gold' : 'kpi-v-risk')}
              title={exactMoney(varianceTotals.plannedIn - varianceTotals.plannedOut, money.base)}>
              {formatMoney(varianceTotals.plannedIn - varianceTotals.plannedOut, { currency: money.base })}
            </div>
            {/* The population stays stated. A plan total over 9 of 12
                months is a real number about a partial set, and a reader
                who is not told that will read it as the whole year. */}
            <div className="text-(length:--t-micro) text-muted-foreground mt-1">
              {lang === 'ar' ? 'وارد مخطط − صادر مخطط' : 'Planned In − Planned Out'}
              {' · '}
              {lang === 'ar'
                ? `على ${varianceTotals.rowsWithPlan} فترة مخططة`
                : `over ${varianceTotals.rowsWithPlan} planned period(s)`}
              {varianceTotals.rowsWithoutPlan > 0 && (lang === 'ar'
                ? ` · ${varianceTotals.rowsWithoutPlan} بلا خطة، مستبعدة`
                : ` · ${varianceTotals.rowsWithoutPlan} without a plan, excluded`)}
            </div>
          </div>
        </div>
      )}

      {/*
        ══════════════════════════════════════════════════════════════════
        TWO CHARTS, STACKED. PERIOD FLOW ABOVE, CUMULATIVE BELOW.

        All six series shared one Y axis before. Period movements run in
        the tens of thousands while the cumulative curve runs into the
        hundreds of thousands, so the axis was scaled for the largest and
        the four flow lines were pressed flat against the floor —
        technically drawn, practically unreadable.

        Splitting them gives each pair the axis it needs. The colours,
        dashes, widths and dots are UNCHANGED from the single chart, so
        no new visual language enters: pale + dashed is the plan, deep +
        solid is what happened.
        ══════════════════════════════════════════════════════════════════ */}

      {/* ONE MODULE, TWO INTERNAL TABS — the EVM pattern. Entry stays
          period by period on the first tab; the cumulative tab is a
          derived, read-only view of the very same rows. */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {CASH_TABS.map(x => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 text-xs border rounded-md transition-colors uppercase tracking-wider',
              tab === x.id
                ? 'bg-primary/10 text-primary border-primary'
                : 'border-white/[0.06] text-muted-foreground hover:text-white',
            )}
          >
            <x.icon className="w-3.5 h-3.5" />
            {lang === 'ar' ? x.ar : x.en}
          </button>
        ))}
      </div>

      {tab === 'periods' && (
      <>

      {/* Chart 1 — period flow: planned vs actual, in and out */}
      <div className="ds-card ds-card-raised" style={{ height: 380 }}>
        <h3 className="text-sm font-serif uppercase tracking-widest text-primary mb-4">
          {lang === 'ar' ? 'الحركة الشهرية — مخطط مقابل فعلي' : 'Period Flow — Planned vs Actual'}
        </h3>
        <ResponsiveContainer width="100%" height="86%">
          <ComposedChart data={series} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.08)" vertical={false} />
            <XAxis dataKey="month" stroke="#a5a49f" interval="preserveStartEnd"
                   tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
            <YAxis stroke="#a5a49f" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                   tickFormatter={v => kpiMoney(v, money.base)} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => formatMoney(v, { currency: money.base })} />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />

            {hasAnyPlan && (
              <Line type="monotone" dataKey="plannedIn"
                    name={lang === 'ar' ? 'وارد مخطط' : 'Planned In'}
                    stroke="#7fcf95" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.55}
                    dot={false}
                    connectNulls={false} />
            )}
            <Line type="monotone" dataKey="in" name={t.cashIn}
                  stroke={CASH_IN} strokeWidth={2.5}
                  dot={manyPeriods ? false : { r: 3, fill: CASH_IN, strokeWidth: 0 }} />
            {hasAnyPlan && (
              <Line type="monotone" dataKey="plannedOut"
                    name={lang === 'ar' ? 'صادر مخطط' : 'Planned Out'}
                    stroke="#e8736d" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.55}
                    dot={false}
                    connectNulls={false} />
            )}
            <Line type="monotone" dataKey="out" name={t.cashOut}
                  stroke={CASH_OUT} strokeWidth={2.5}
                  dot={manyPeriods ? false : { r: 3, fill: CASH_OUT, strokeWidth: 0 }} />
            {/* Brush = zoom. On a 5-year monthly ledger this chart carries
                60 points per series; the brush is how the reader focuses. */}
            <Brush dataKey="month" height={22} stroke="rgba(212,175,55,0.4)"
                   fill="rgba(0,0,0,0.3)" travellerWidth={8} />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
          {lang === 'ar'
            ? 'اسحب المقبضين أسفل الرسم للتكبير على نافذة زمنية. الباهت المتقطع = الخطة، والفاتح المتصل = الفعلي.'
            : 'Drag the handles below the chart to zoom a time window. Pale dashed = planned; bright solid = actual.'}
        </p>
      </div>

      </>
      )}

      {tab === 'cumulative' && (
      <>

      {/* Chart 2 — cumulative: the full S-curve family, in / out / net,
          planned (pale + dashed) against actual (deep + solid). Same
          magnitude on every series, so one axis serves them all. */}
      <div className="ds-card ds-card-raised" style={{ height: 380 }}>
        <h3 className="text-sm font-serif uppercase tracking-widest text-primary mb-4">
          {lang === 'ar' ? 'التراكمي — مخطط مقابل فعلي' : 'Cumulative — Planned vs Actual'}
        </h3>
        <ResponsiveContainer width="100%" height="86%">
          <ComposedChart data={series} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.08)" vertical={false} />
            <XAxis dataKey="month" stroke="#a5a49f" interval="preserveStartEnd"
                   tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
            <YAxis stroke="#a5a49f" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                   tickFormatter={v => kpiMoney(v, money.base)} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => formatMoney(v, { currency: money.base })} />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />

            {/* Four curves, nothing else: planned vs actual, in and out.
                The NET and the VARIANCE are deliberately NOT drawn — four
                lines is what the eye holds; their numbers live in the
                Cumulative Position table right below this chart. */}
            {hasAnyPlan && (
              <Line type="monotone" dataKey="cumPlannedIn"
                    name={lang === 'ar' ? 'تراكمي وارد مخطط' : 'Cum. Planned In'}
                    stroke="#7fcf95" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.55}
                    dot={false} connectNulls={false} />
            )}
            <Line type="monotone" dataKey="cumIn"
                  name={lang === 'ar' ? 'تراكمي وارد فعلي' : 'Cum. Cash In'}
                  stroke={CASH_IN} strokeWidth={2.5} dot={false} />
            {hasAnyPlan && (
              <Line type="monotone" dataKey="cumPlannedOut"
                    name={lang === 'ar' ? 'تراكمي صادر مخطط' : 'Cum. Planned Out'}
                    stroke="#e8736d" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.55}
                    dot={false} connectNulls={false} />
            )}
            <Line type="monotone" dataKey="cumOut"
                  name={lang === 'ar' ? 'تراكمي صادر فعلي' : 'Cum. Cash Out'}
                  stroke={CASH_OUT} strokeWidth={2.5} dot={false} />
            <Brush dataKey="month" height={22} stroke="rgba(212,175,55,0.4)"
                   fill="rgba(0,0,0,0.3)" travellerWidth={8} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

        {/* CUMULATIVE POSITION — read-only, derived from the periods.
            Nothing here is typed; it is the same rows, summed in order.
            Oldest → newest so the running total reads naturally top-down. */}
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h3 className="sec-head !mb-0 flex-1">
              {lang === 'ar' ? 'الموقف التراكمي' : 'Cumulative Position'}
            </h3>
            <span className="text-(length:--t-micro) uppercase tracking-widest text-muted-foreground border border-white/[0.06] px-2 py-0.5">
              {lang === 'ar' ? 'قراءة فقط · مشتق من الفترات' : 'READ-ONLY · DERIVED FROM PERIODS'}
            </span>
          </div>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{t.month}</th>
                  {anyPlanned && (
                    <>
                      <th className="money">{lang === 'ar' ? 'تراكمي وارد مخطط' : 'Cum. Planned In'}</th>
                      <th className="money">{lang === 'ar' ? 'تراكمي صادر مخطط' : 'Cum. Planned Out'}</th>
                    </>
                  )}
                  <th className="money">{lang === 'ar' ? 'تراكمي وارد فعلي' : 'Cum. Cash In'}</th>
                  <th className="money">{lang === 'ar' ? 'تراكمي صادر فعلي' : 'Cum. Cash Out'}</th>
                  <th className="money">{lang === 'ar' ? 'تراكمي الصافي' : 'Cumulative Net'}</th>
                  {anyPlanned && (
                    <th className="money">
                      {lang === 'ar' ? 'الانحراف التراكمي' : 'Cumulative Variance'}
                      <span className="block text-(length:--t-micro) font-normal normal-case tracking-normal text-muted-foreground">
                        {lang === 'ar' ? 'فعلي − مخطط' : 'actual − planned'}
                      </span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {cumRows.length === 0 && (
                  <tr><td colSpan={7}><div className="ds-empty"><div className="ds-empty-title">{t.noData}</div></div></td></tr>
                )}
                {cumRows.map((r, i) => {
                  // Muted planned cells on a period that stated no plan:
                  // the figure is CARRIED, not newly stated — printing it
                  // full-strength would claim a plan nobody made.
                  const carried = !r.planned;
                  return (
                    <tr key={i}>
                      <td className="col-pin font-mono">
                        {(() => {
                          const d = normaliseIso(r.month);
                          const w = d ? windowOf(d) : (/^\d{4}-\d{2}/.test(r.month) ? r.month.slice(0, 7) : '');
                          return w ? monthLabel(w) : r.month;
                        })()}
                      </td>
                      {anyPlanned && (
                        <>
                          <td className={cn('money', carried ? 'text-muted-foreground/60' : 'money-pos')}
                              title={carried ? (lang === 'ar' ? 'الفترة بلا خطة — قيمة محمولة' : 'No plan stated this period — carried forward') : undefined}>
                            {formatMoney(r.cumPlannedIn, { currency: money.base })}
                          </td>
                          <td className={cn('money', carried ? 'text-muted-foreground/60' : 'money-neg')}
                              title={carried ? (lang === 'ar' ? 'الفترة بلا خطة — قيمة محمولة' : 'No plan stated this period — carried forward') : undefined}>
                            {formatMoney(r.cumPlannedOut, { currency: money.base })}
                          </td>
                        </>
                      )}
                      <td className="money money-pos">{formatMoney(r.cumIn, { currency: money.base })}</td>
                      <td className="money money-neg">{formatMoney(r.cumOut, { currency: money.base })}</td>
                      <td className={cn('money font-semibold', r.cumNet >= 0 ? 'money-pos' : 'money-neg')}>
                        {formatMoney(r.cumNet, { currency: money.base })}
                      </td>
                      {anyPlanned && (
                        <td className={cn('money font-semibold',
                          r.variance > 0 ? 'money-pos' : r.variance < 0 ? 'money-neg' : 'text-muted-foreground')}>
                          {r.variance > 0 ? '+' : ''}{formatMoney(r.variance, { currency: money.base })}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {/* Closing row — the last period's cumulatives, stated once
                    more so the reader does not hunt for them in the tail. */}
                {cumRows.length > 0 && (() => {
                  const last = cumRows[cumRows.length - 1];
                  return (
                    <tr className="border-t-2 border-primary/30 font-semibold">
                      <td className="col-pin text-primary uppercase tracking-wider">
                        {lang === 'ar' ? 'المقفل' : 'Closing'}
                      </td>
                      {anyPlanned && (
                        <>
                          <td className="money money-pos">{formatMoney(last.cumPlannedIn, { currency: money.base })}</td>
                          <td className="money money-neg">{formatMoney(last.cumPlannedOut, { currency: money.base })}</td>
                        </>
                      )}
                      <td className="money money-pos">{formatMoney(last.cumIn, { currency: money.base })}</td>
                      <td className="money money-neg">{formatMoney(last.cumOut, { currency: money.base })}</td>
                      <td className={cn('money', last.cumNet >= 0 ? 'money-pos' : 'money-neg')}>
                        {formatMoney(last.cumNet, { currency: money.base })}
                      </td>
                      {anyPlanned && (
                        <td className={cn('money', last.variance > 0 ? 'money-pos' : last.variance < 0 ? 'money-neg' : 'text-muted-foreground')}>
                          {last.variance > 0 ? '+' : ''}{formatMoney(last.variance, { currency: money.base })}
                        </td>
                      )}
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
          <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
            {lang === 'ar'
              ? 'قراءة فقط — يُشتق تلقائيًا من جدول الفترات بالترتيب الزمني، ولا يُدخَل يدويًا. الفترات بلا خطة تحمل آخر تراكمي مخطط (باهت).'
              : 'Read-only — derived automatically from the period ledger in date order; nothing here is entered by hand. Periods without a plan carry the last stated cumulative (muted).'}
          </p>
        </div>

      </>
      )}

      {/* ══════════════════ NET — the balance story ══════════════════ */}
      {tab === 'net' && (
        <>
        {/* Actual net as signed bars (green collects, red burns), the
            planned balance as a quiet dashed line. One question: does
            the month land where it was planned to land. */}
        <div className="ds-card ds-card-raised" style={{ height: 380 }}>
          <h3 className="text-sm font-serif uppercase tracking-widest text-primary mb-4">
            {lang === 'ar' ? 'الصافي — مخطط مقابل فعلي' : 'Net — Planned vs Actual'}
          </h3>
          <ResponsiveContainer width="100%" height="86%">
            <ComposedChart data={netRows} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.08)" vertical={false} />
              <XAxis dataKey="month" stroke="#a5a49f" interval="preserveStartEnd"
                     tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              <YAxis stroke="#a5a49f" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                     tickFormatter={v => kpiMoney(v, money.base)} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => formatMoney(v, { currency: money.base })} />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
              <ReferenceLine y={0} stroke="rgba(212,175,55,0.4)" strokeDasharray="4 4" />
              {/* Owner rule: the balance story in ONE colour — the actual
                  net SOLID gold, the planned net DASHED gold. */}
              <Line type="monotone" dataKey="net"
                    name={lang === 'ar' ? 'الصافي الفعلي' : 'Actual Net'}
                    stroke="#d4af37" strokeWidth={2.5}
                    dot={manyPeriods ? false : { r: 3, fill: '#d4af37', strokeWidth: 0 }}
                    connectNulls={false} />
              {hasAnyPlan && (
                <Line type="monotone" dataKey="plannedNet"
                      name={lang === 'ar' ? 'الصافي المخطط' : 'Planned Net'}
                      stroke="#d4af37" strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.75}
                      dot={false} connectNulls={false} />
              )}
              <Brush dataKey="month" height={22} stroke="rgba(212,175,55,0.4)"
                     fill="rgba(0,0,0,0.3)" travellerWidth={8} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* The table the chart answers to — read-only, derived. */}
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h3 className="sec-head !mb-0 flex-1">
              {lang === 'ar' ? 'صافي الفترة' : 'Net by Period'}
            </h3>
            <span className="text-(length:--t-micro) uppercase tracking-widest text-muted-foreground border border-white/[0.06] px-2 py-0.5">
              {lang === 'ar' ? 'قراءة فقط · مشتق من الفترات' : 'READ-ONLY · DERIVED FROM PERIODS'}
            </span>
          </div>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{t.month}</th>
                  <th className="money">{lang === 'ar' ? 'الصافي المخطط' : 'Planned Net'}</th>
                  <th className="money">{lang === 'ar' ? 'الصافي الفعلي' : 'Actual Net'}</th>
                  <th className="money">
                    {lang === 'ar' ? 'الانحراف' : 'Variance'}
                    <span className="block text-(length:--t-micro) font-normal normal-case tracking-normal text-muted-foreground">
                      {lang === 'ar' ? 'فعلي − مخطط' : 'actual − planned'}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {netRows.length === 0 && (
                  <tr><td colSpan={4}><div className="ds-empty"><div className="ds-empty-title">{t.noData}</div></div></td></tr>
                )}
                {netRows.map((r, i) => (
                  <tr key={i}>
                    <td className="col-pin font-mono">
                      {(() => {
                        const d = normaliseIso(r.month);
                        const w = d ? windowOf(d) : (/^\d{4}-\d{2}/.test(r.month) ? r.month.slice(0, 7) : '');
                        return w ? monthLabel(w) : r.month;
                      })()}
                    </td>
                    <td className={cn('money', r.plannedNet === null ? 'text-muted-foreground' : (r.plannedNet >= 0 ? 'money-pos' : 'money-neg'))}>
                      {r.plannedNet === null ? '—' : formatMoney(r.plannedNet, { currency: money.base })}
                    </td>
                    <td className={cn('money font-semibold', r.net >= 0 ? 'money-pos' : 'money-neg')}>
                      {formatMoney(r.net, { currency: money.base })}
                    </td>
                    <td className={cn('money',
                      r.variance === null ? 'text-muted-foreground'
                      : r.variance > 0 ? 'money-pos'
                      : r.variance < 0 ? 'money-neg' : 'text-muted-foreground')}>
                      {r.variance === null ? '—' : `${r.variance > 0 ? '+' : ''}${formatMoney(r.variance, { currency: money.base })}`}
                    </td>
                  </tr>
                ))}
                {/* Closing row: the whole-story balances. */}
                {netRows.length > 0 && (
                  <tr className="border-t-2 border-primary/30 font-semibold">
                    <td className="col-pin text-primary uppercase tracking-wider">
                      {lang === 'ar' ? 'الإجمالي' : 'Total'}
                    </td>
                    <td className={cn('money', hasAnyPlan ? (varianceTotals.plannedNet >= 0 ? 'money-pos' : 'money-neg') : 'text-muted-foreground')}>
                      {hasAnyPlan ? formatMoney(varianceTotals.plannedNet, { currency: money.base }) : '—'}
                    </td>
                    <td className={cn('money', netFlow >= 0 ? 'money-pos' : 'money-neg')}>
                      {formatMoney(netFlow, { currency: money.base })}
                    </td>
                    <td className={cn('money',
                      !hasAnyPlan ? 'text-muted-foreground'
                      : netFlow - varianceTotals.plannedNet > 0 ? 'money-pos'
                      : netFlow - varianceTotals.plannedNet < 0 ? 'money-neg' : 'text-muted-foreground')}>
                      {!hasAnyPlan ? '—' : `${netFlow - varianceTotals.plannedNet > 0 ? '+' : ''}${formatMoney(netFlow - varianceTotals.plannedNet, { currency: money.base })}`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-(length:--t-second) text-muted-foreground italic mt-2">
            {lang === 'ar'
              ? 'قراءة فقط — مشتق تلقائيًا من الفترات؛ الفترات بلا خطة تقول «—» ولا يُخترع لها رقم.'
              : 'Read-only — derived automatically from the periods; periods without a plan state no figure rather than an invented one.'}
          </p>
        </div>
        </>
      )}

      {tab === 'periods' && (
      <>

      {/* Ledger table */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="sec-head !mb-0 flex-1">{t.monthlyLedger}</h3>
          <ReportButton reportId="cash-flow" context={{ project, rows: data, totalIn, totalOut, netFlow, reportCurrency: money.base }} />
          {canEdit && (
            <button onClick={() => setIsAdding(!isAdding)} className="btn btn-secondary btn-sm">
              <Plus className="w-3 h-3" /> {t.add}
            </button>
          )}
        </div>

        {/* Legacy labels that could not be read into a date. Stated rather
            than guessed: a fabricated date selects a real exchange rate and
            produces a converted figure indistinguishable from a correct one. */}
        {migration && migration.flagged > 0 && (
          <div className="ds-card ds-card-tight mb-3 !border-chart-5/30">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-chart-5 mt-0.5 flex-shrink-0" />
              <div className="text-(length:--t-second) text-muted-foreground">
                <p className="text-white mb-1">
                  {lang === 'ar'
                    ? `${migration.flagged} من ${migration.total} صفوف بلا تاريخ`
                    : `${migration.flagged} of ${migration.total} rows have no date`}
                  {migration.migrated > 0 && (lang === 'ar'
                    ? ` · تم استنتاج ${migration.migrated}`
                    : ` · ${migration.migrated} inferred from their labels`)}
                </p>
                <p>
                  {lang === 'ar'
                    ? 'هذه التسميات لا تحمل معلومة تقويمية، فلم يُخمَّن لها تاريخ. تعمل كما هي، لكنها لا تدخل تحويل العملات حتى يُدخَل تاريخها يدوياً.'
                    : 'These labels carry no calendar information, so no date was guessed. They keep working, but cannot take part in currency conversion until a date is entered by hand.'}
                </p>
                <p className="font-mono text-white mt-1">
                  {migration.unresolved.slice(0, 8).map(u => u.label || '(blank)').join(' · ')}
                  {migration.unresolved.length > 8 && ` … +${migration.unresolved.length - 8}`}
                </p>
              </div>
            </div>
          </div>
        )}

        {isAdding && canEdit && (
          <form onSubmit={handleAdd} className="ds-card ds-card-tight mb-3">
            <div className="form-grid">
              {/*
                THE PERIOD IS PICKED, NOT TYPED.

                ────────────────────────────────────────────────────────
                This was a free-text box holding things like "M6" — a
                label carrying no calendar information, which is exactly
                why `planMigration` exists to flag rows it cannot read.

                A month input yields `YYYY-MM`, so the label IS the
                window and the transaction date can be derived from it
                instead of being asked for separately.

                THE STORED VALUE IS STILL A PLAIN STRING. `month` remains
                the join key that CertsModule matches certificates on
                (`r.month === cert.period`), so the field keeps its type
                and every existing row — "M6", "Jan 2025", anything —
                still matches exactly as before. Only the way a NEW value
                is chosen has changed.
                ──────────────────────────────────────────────────────── */}
              <div className="field">
                <label className="field-label" data-required>{t.month}</label>
                <input
                  className="field-input font-mono number-ltr"
                  type="month" dir="ltr" style={{ colorScheme: 'dark' }}
                  value={newRow.month}
                  onChange={e => {
                    const m = e.target.value;               // YYYY-MM
                    // The transaction date follows the month unless the
                    // user has already overridden it: a period and its FX
                    // date should not have to be entered twice.
                    const [y, mo] = m.split('-').map(Number);
                    const derived = m && y && mo ? lastDayOfMonth(y, mo) : '';
                    setNewRow(r => ({
                      ...r,
                      month: m,
                      transactionDate: derived || r.transactionDate,
                    }));
                  }}
                  required />
              </div>
              {/* Currency of the amounts AS ENTERED. Defaults to the project
                  contract currency; both amounts convert at one rate. */}
              <div className="field">
                <label className="field-label" data-required>
                  {lang === 'ar' ? 'العملة' : 'Currency'}
                  <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                    {lang === 'ar' ? 'كما أُدخلت' : 'as entered'}
                  </span>
                </label>
                <select
                  className="field-input font-mono"
                  value={newRow.currency}
                  onChange={e => setNewRow({ ...newRow, currency: e.target.value })}
                  dir="ltr"
                  required
                >
                  {money.settings.currencies
                    .filter((c: any) => c.active)
                    .map((c: any) => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))}
                </select>
              </div>
              {/* THE PLAN COMES FIRST.
                  You forecast a period before you live it, so the form
                  now asks in that order. The word "optional" is gone: a
                  field the user is meant to fill should not invite them
                  to skip it. Leaving both blank still stores no plan —
                  that behaviour is unchanged, it is simply no longer
                  advertised. */}
              <div className="field">
                <label className="field-label">
                  {lang === 'ar' ? 'وارد مخطط' : 'Planned In'}
                </label>
                <input className="field-input font-mono number-ltr" type="number" placeholder="0"
                       value={newRow.plannedIn} dir="ltr"
                       onChange={e => setNewRow({ ...newRow, plannedIn: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">
                  {lang === 'ar' ? 'صادر مخطط' : 'Planned Out'}
                </label>
                <input className="field-input font-mono number-ltr" type="number" placeholder="0"
                       value={newRow.plannedOut} dir="ltr"
                       onChange={e => setNewRow({ ...newRow, plannedOut: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" data-required>{t.cashIn}</label>
                <input className="field-input font-mono number-ltr" type="number" placeholder="0" value={newRow.in} onChange={e => setNewRow({ ...newRow, in: e.target.value })} dir="ltr" required />
              </div>
              <div className="field">
                <label className="field-label" data-required>{t.cashOut}</label>
                <input className="field-input font-mono number-ltr" type="number" placeholder="0" value={newRow.out} onChange={e => setNewRow({ ...newRow, out: e.target.value })} dir="ltr" required />
              </div>
              <div className="field">
                <label className="field-label" data-required>
                  {lang === 'ar' ? 'تاريخ المعاملة' : 'Transaction Date'}
                  <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                    {lang === 'ar' ? 'يُحدَّد به سعر الصرف' : 'selects the FX rate'}
                  </span>
                </label>
                <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                       style={{ colorScheme: 'dark' }}
                       value={newRow.transactionDate}
                       onChange={e => setNewRow({ ...newRow, transactionDate: e.target.value })} required />
              </div>
              <div className="field">
                <label className="field-label">
                  {lang === 'ar' ? 'تاريخ السريان' : 'Effective Date'}
                  <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                    {lang === 'ar' ? 'اختياري' : 'optional'}
                  </span>
                </label>
                <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                       style={{ colorScheme: 'dark' }}
                       value={newRow.effectiveDate}
                       onChange={e => setNewRow({ ...newRow, effectiveDate: e.target.value })}
                       placeholder={newRow.transactionDate} />
              </div>
            </div>
            {newRow.transactionDate && (() => {
              /**
               * ONE DATE FORMAT ON SCREEN — `30 June 2025`.
               *
               * ════════════════════════════════════════════════════════
               * Storage is, and stays, ISO `YYYY-MM-DD`: it sorts
               * correctly, it is what `<input type="date">` speaks, and
               * it is what every FX lookup compares against. None of
               * that changes.
               *
               * What was inconsistent is the DISPLAY. This preview
               * printed the raw ISO string while the ledger beside it,
               * and every other screen in the platform, renders through
               * `formatDate` as `30 June 2025`. The same date appeared
               * in two notations on one page, which is exactly how a
               * reader starts wondering whether they are two dates.
               *
               * The window keeps its `YYYY-MM` form deliberately — it is
               * an identifier that must match the stored key, not a date
               * being read.
               * ════════════════════════════════════════════════════════
               */
              const fx = newRow.effectiveDate || newRow.transactionDate;
              const win = parseMonthWindow(fx);
              return (
                <p className="text-(length:--t-second) text-muted-foreground">
                  {lang === 'ar' ? 'نافذة التقرير' : 'Reporting window'}
                  {': '}
                  <span className="text-primary font-mono">{win}</span>
                  {' · '}
                  {lang === 'ar' ? 'تاريخ سعر الصرف' : 'FX snapshot date'}
                  {': '}
                  <span className="text-primary">
                    {formatDate(fx, lang === 'ar' ? 'ar' : 'en')}
                  </span>
                </p>
              );
            })()}
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
                <th className="col-pin">{t.month}</th>
                {/* TXN DATE and WINDOW removed from the table.
                    Both are now derived from the month the user picks —
                    the window IS the month, and the transaction date is
                    its last day — so printing all three said one fact
                    three times and pushed the money columns off screen.
                    Neither is lost: both are still stored on the row and
                    still drive FX, and the date remains editable in the
                    add form. */}
                {/* PLAN BEFORE ACTUAL — the order the work happens in.
                    The plan columns carry the same green/red the actuals
                    do, so a reader compares like against like down the
                    row rather than re-learning the palette halfway. */}
                {anyPlanned && (
                  <>
                    <th className="money">{lang === 'ar' ? 'وارد مخطط' : 'Planned In'}</th>
                    <th className="money">{lang === 'ar' ? 'صادر مخطط' : 'Planned Out'}</th>
                  </>
                )}
                <th className="money">{t.cashIn}</th>
                <th className="money">{t.cashOut}</th>
                {anyPlanned && (
                  <th className="money">{lang === 'ar' ? 'الانحراف' : 'Variance'}</th>
                )}
                <th className="money">{t.net}</th>
                {/* CUMULATIVE COLUMNS REMOVED FROM THE ENTRY TABLE.
                    They now live whole on the Cumulative tab — one table
                    per idea: this one is what happened each period and is
                    editable; that one is the running position and is
                    read-only. Keeping both here made the widest table in
                    the platform wider to say something twice. */}
                {canEdit && <th className="col-act" />}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={8}><div className="ds-empty"><div className="ds-empty-title">{t.noData}</div></div></td></tr>
              )}
              {/*
                NEWEST FIRST. `i` is the ORIGINAL index into `data`, so
                every editField/delete call still targets the right stored
                row — reordering the view must not reorder the writes.
                `pos` is the chronological position, used for cumulative
                lookups.
              */}
              {display.map(({ row, originalIndex: i, }) => {
                return (
                <tr key={i}>
                  <td className="col-pin text-white">
                    <span className="inline-flex items-center gap-1.5">
                      {/* DISPLAY: month + year only (from the calendar);
                          the raw stored value rides along in the tooltip. */}
                      <span title={row.month} className="font-mono">
                        {(() => {
                          const d = normaliseIso(row.month);
                          const w = d ? windowOf(d) : (/^\d{4}-\d{2}/.test(row.month) ? row.month.slice(0, 7) : '');
                          return w ? monthLabel(w) : row.month;
                        })()}
                      </span>
                      <CurrencyBadge code={row.currency ?? ''} base={money.base} />
                      {!row.transactionDate && (
                        <span className="badge badge-warn"
                              title={lang === 'ar'
                                ? 'بلا تاريخ — لا يدخل تحويل العملات'
                                : 'No date — cannot take part in currency conversion'}>
                          {lang === 'ar' ? 'بلا تاريخ' : 'No date'}
                        </span>
                      )}
                    </span>
                  </td>
                  {/* A row that still has NO date cannot take part in
                      currency conversion, so that one fact is kept — as a
                      marker beside the period rather than a whole column
                      of dates that merely repeat it. */}
                  {anyPlanned && (() => {
                    const v = cashVariance(row);
                    return (
                      <>
                        {/* Same green/red as the actuals beside them. A
                            planned inflow is money coming in whether it has
                            arrived yet or not; giving the plan a grey
                            palette made the eye read it as metadata rather
                            than as the figure being compared. */}
                        <td className={cn('money', v.planned ? 'money-pos' : 'text-muted-foreground')}>
                          <EditableNumber value={row.plannedIn ?? 0}
                            onSave={x => updateField(i, 'plannedIn', x)} canEdit={canEdit}
                            display={v.planned ? formatMoney(v.plannedIn, { currency: money.base }) : '—'} />
                        </td>
                        <td className={cn('money', v.planned ? 'money-neg' : 'text-muted-foreground')}>
                          <EditableNumber value={row.plannedOut ?? 0}
                            onSave={x => updateField(i, 'plannedOut', x)} canEdit={canEdit}
                            display={v.planned ? formatMoney(v.plannedOut, { currency: money.base }) : '—'} />
                        </td>
                      </>
                    );
                  })()}
                  <td className="money money-pos">
                    <EditableNumber value={row.in} onSave={v => updateField(i, 'in', v)} canEdit={canEdit} display={formatMoney(row.in, { currency: money.base })} />
                    {row.currency && row.currency !== money.base && (
                      <span className="block text-(length:--t-micro) font-mono text-muted-foreground mt-0.5">
                        {row.currency} {(row.originalIn ?? 0).toLocaleString('en-US')} @ {(row.exchangeRate ?? 0).toFixed(4)}
                      </span>
                    )}
                  </td>
                  <td className="money money-neg">
                    <EditableNumber value={row.out} onSave={v => updateField(i, 'out', v)} canEdit={canEdit} display={formatMoney(row.out, { currency: money.base })} />
                    {row.currency && row.currency !== money.base && (
                      <span className="block text-(length:--t-micro) font-mono text-muted-foreground mt-0.5">
                        {row.currency} {(row.originalOut ?? 0).toLocaleString('en-US')} @ {(row.exchangeRate ?? 0).toFixed(4)}
                      </span>
                    )}
                  </td>
                  {anyPlanned && (() => {
                    const v = cashVariance(row);
                    return (
                        <td className={cn('money font-semibold',
                          !v.planned ? 'text-muted-foreground'
                            : v.netVariance > 0 ? 'money-pos'
                            : v.netVariance < 0 ? 'money-neg' : 'text-muted-foreground')}>
                          {v.planned
                            ? `${v.netVariance > 0 ? '+' : ''}${formatMoney(v.netVariance, { currency: money.base })}`
                            : '—'}
                          {v.planned && (
                            <span className="block text-(length:--t-micro) font-mono text-muted-foreground mt-0.5">
                              {lang === 'ar' ? 'وارد' : 'in'} {v.inVariance > 0 ? '+' : ''}{Math.round(v.inVariance).toLocaleString('en-US')}
                              {' · '}
                              {lang === 'ar' ? 'صادر' : 'out'} {v.outVariance > 0 ? '+' : ''}{Math.round(v.outVariance).toLocaleString('en-US')}
                            </span>
                          )}
                        </td>
                    );
                  })()}
                  <td className={cn('money', row.net >= 0 ? 'money-pos' : 'money-neg')}>
                    {formatMoney(row.net, { currency: money.base })}
                  </td>
                  {/* Cumulative cells moved to the Cumulative tab's table,
                      derived through `cashCumulativeTable`. */}
                  {canEdit && (
                    <td className="col-act">
                      <button onClick={() => handleDelete(i)} aria-label={lang === 'ar' ? 'حذف' : 'Delete'} className="text-muted-foreground hover:text-destructive transition-colors p-1.5">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
