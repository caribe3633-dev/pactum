import React, { useState, useEffect, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useTranslation } from '../../lib/i18n';
import { formatMoney } from '../../lib/utils';
import { Plus, Trash2, Paperclip, ArrowRightLeft, CheckCircle, Clock, RefreshCw, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { kpiMoney, exactMoney } from '../../lib/moneyFormat';
import { EditableNumber, EditableText, EditableDate, EditableSelect } from '../EditableCell';
import ReportButton from '../reporting/ReportButton';
import { normaliseDocUrl } from '../../lib/subcontractCommercial';
import { fetchSectors } from '../../mock/sectors';
import {
  moneyContext, resolveTxnDate,
  // Phase 3.2 — transaction layer. One rate across every amount on the row,
  // so gross - retention = net still holds after conversion.
  transactionContext, prepareTransactionGroup, transactionFields,
  // The unit a STORED row is actually in — see the note on the totals.
  storedUnitOf,
} from '../../lib/moneyEntry';
import { contractCurrencyOf } from '../../lib/projectCurrency';
// Phase 3.4 — CertsModule is the SECOND writer to pactum-cashflow-{p}.
// It must produce the same row shape as CashFlowModule or the two writers
// drift and a row's dates depend on which module created it.
import { CashFlowDates, CashFlowCurrency, datesFrom, normaliseIso, parseMonthLabel, windowOf } from '../../lib/cashFlowDates';
import { CurrencyBadge, TransactionAmountInput } from '../CurrencyAmount';
// Task 5 — authoritative company link; the projectIds cache can be stale.
import { companyIdOfProject } from '../../lib/projectMaster';

// ── Types ────────────────────────────────────────────────────────────

interface CertRow {
  no: string;
  period: string;
  gross: number;
  retention: number;
  net: number;
  approvalDate: string;
  paymentDate: string;
  status: string;
  docs: string[];
  /**
   * External document link (Drive / SharePoint / any https URL). Optional —
   * legacy rows have none. `docs` is untouched: it still counts attachments
   * and both are shown in the same cell.
   */
  documentUrl?: string;
  /**
   * Currency metadata. gross / retention / net hold CONVERTED amounts and
   * share ONE rate, so `gross − retention = net` still holds exactly.
   */
  currency?: string;
  /** Gross AS ENTERED, in `currency`. */
  originalAmount?: number;
  /**
   * SPRINT 3 — retention AS ENTERED, in `currency`.
   *
   * Previously only the gross original was kept, so an edited retention
   * on a foreign certificate had no original to re-derive from. Optional:
   * a legacy row recovers it as `retention / exchangeRate`.
   */
  retentionOriginal?: number;
  exchangeRate?: number;
  transactionDate?: string;
  rateEffectiveDate?: string;
  convertedAt?: string;
  dateSource?: string;
}

/**
 * Kept structurally identical to CashFlowModule's CashRow. `month` remains
 * the join key both writers match on; the dates are additive.
 */
interface CashRow extends CashFlowDates, CashFlowCurrency {
  month: string; in: number; out: number; net: number; cumNet: number;
}

interface SyncEntry { certNo: string; period: string; amount: number; syncedAt: string; }

const STATUS_OPTS = (t: any) => [
  { value: 'submitted', label: t.submitted   },
  { value: 'review',    label: t.underReview },
  { value: 'certified', label: t.certified   },
  { value: 'paid',      label: t.paid        },
];

const getStatusColor = (status: string) => {
  switch (status) {
    case 'paid':      return 'bg-chart-4/10 text-chart-4 border-chart-4/30';
    case 'certified': return 'bg-primary/10 text-primary border-primary/30';
    case 'review':    return 'bg-chart-5/10 text-chart-5 border-chart-5/30';
    default:          return 'bg-white/5 text-muted-foreground border-white/10';
  }
};

// ── Cash Flow sync helpers ────────────────────────────────────────────

function readCashFlow(projectId: string): CashRow[] {
  try {
    const raw = localStorage.getItem(`pactum-cashflow-${projectId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function recalcCum(rows: CashRow[]): CashRow[] {
  let cum = 0;
  return rows.map(r => { cum += r.net; return { ...r, cumNet: cum }; });
}

/**
 * SPRINT 1 · TASK 2 — the second writer.
 *
 * `cert.net` has ALREADY been converted into the reporting currency by
 * handleAdd (prepareTransactionGroup). Pushing it across therefore needs no
 * second conversion — converting again would apply the rate twice.
 *
 * What it DOES need is to say so. Before this change the pushed row carried
 * no currency field at all, so a reader could not tell whether the figure
 * was converted or raw. The row is now stamped with the reporting currency,
 * and when the certificate was foreign its provenance travels across intact:
 * the original currency, the original amount and the rate that was frozen on
 * the certificate. One ledger, one shape, whichever module wrote the row.
 */
function pushCertToCashFlow(
  projectId: string, cert: CertRow, reportingCurrency: string,
): void {
  const rows = readCashFlow(projectId);
  const label = cert.period || cert.no;

  /* THE LINK IS DERIVED FROM A REAL DATE, NEVER FROM FREE TEXT.
     A certificate's submission/payment date decides which monthly WINDOW
     (YYYY-MM) its cash lands in; a cash row joins that window whether it
     was created by the month picker, a full ISO date, or (legacy) a label
     that parses. Exact-label matching survives only as the last resort —
     that free-text join is what used to drop certificates on the floor. */
  const asWindow = (m: string): string => {
    if (/^\d{4}-\d{2}/.test(m)) return m.slice(0, 7);
    const d = normaliseIso(m);
    return d ? windowOf(d) : '';
  };
  /* OWNER'S RULE: the link is on the PAYMENT DATE, exclusively. Not the
     submission date, not the approval date — money lands in the ledger the
     month it was actually paid. A paid certificate with no payment date
     cannot be placed and is refused at the eligibility check instead. */
  const certIso = normaliseIso((cert as any).paymentDate);
  const win = certIso ? windowOf(certIso) : '';
  const idx = rows.findIndex(r => {
    if (win) {
      const rw = asWindow(r.month);
      if (rw) return rw === win;
    }
    return r.month === label;
  });
  if (idx >= 0) {
    const existing = rows[idx];
    rows[idx] = {
      ...existing,
      in: existing.in + cert.net,
      net: existing.in + cert.net - existing.out,
      // An existing row keeps its own dates. A certificate arriving into a
      // period that already has one does not get to restate when that
      // period happened.
    };
  } else {
    // A certificate carries its own dates. Payment date first — that is
    // when the money moved; approval date is when it was authorised.
    const paid = normaliseIso((cert as any).paymentDate);
    // Payment date only — the caller guarantees it exists (eligibility),
    // the label is a defensive last resort that should never fire.
    const iso = paid || parseMonthLabel(label, new Date().getFullYear()).date;
    const monthKeyForLedger = iso || label;

    // Currency provenance. `cert.net` is already in the reporting currency;
    // the fields below record that fact and, for a foreign certificate,
    // where the figure came from — so the cash ledger can be audited back to
    // the rate actually applied without opening the certificate register.
    const wasForeign = !!cert.currency && cert.currency !== reportingCurrency;
    const ccyFields: CashFlowCurrency = wasForeign
      ? {
          currency: cert.currency,
          reportingCurrency,
          // Net in the ORIGINAL currency, recovered from the frozen rate.
          originalIn: cert.exchangeRate ? cert.net / cert.exchangeRate : undefined,
          originalOut: 0,
          exchangeRate: cert.exchangeRate,
          rateEffectiveDate: cert.rateEffectiveDate,
          rateSource: 'derived-from-certificate',
          convertedAt: cert.convertedAt,
        }
      : { currency: reportingCurrency, reportingCurrency, exchangeRate: 1 };

    rows.push({
      month: monthKeyForLedger, in: cert.net, out: 0, net: cert.net, cumNet: 0,
      ...(iso
        ? datesFrom(iso, {
            effectiveDate: paid || undefined,
            source: paid ? 'derived' : 'inferred',
          })
        : {}),
      ...ccyFields,
    });
  }
  localStorage.setItem(`pactum-cashflow-${projectId}`, JSON.stringify(recalcCum(rows)));
}

function readSyncLog(projectId: string): SyncEntry[] {
  try {
    const raw = localStorage.getItem(`pactum-certs-sync-${projectId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE LOG IS THE DOUBLE-POST GUARD, SO IT MAY NOT BE TRUNCATED TO 30.
 *
 * `slice(0, 30)` kept a display list. But the same log is what tells the
 * screen a certificate has already been pushed. On a project past its
 * 30th sync the oldest entries fell off, the certificate stopped looking
 * synced, and pushing again added its net a SECOND time to Cash In.
 *
 * The cap is now 500 — large enough that a real project never reaches it,
 * while still bounded so localStorage cannot grow without limit. The
 * panel still shows only the most recent entries; that is a display
 * decision and is applied at render, not at write.
 * ══════════════════════════════════════════════════════════════════════
 */
const SYNC_LOG_CAP = 500;

function appendSyncLog(projectId: string, entry: SyncEntry): void {
  const log = readSyncLog(projectId);
  log.unshift(entry);
  localStorage.setItem(`pactum-certs-sync-${projectId}`, JSON.stringify(log.slice(0, SYNC_LOG_CAP)));
}

// ── Main Component ────────────────────────────────────────────────────

export default function CertsModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  const { t, lang } = useTranslation();
  const [data, setData]       = useState<CertRow[]>([]);
  const [syncLog, setSyncLog] = useState<SyncEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [synced,  setSynced]  = useState(false);

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
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(`pactum-certs-${project.id}`);
    if (stored) {
      setData(JSON.parse(stored).map((r: any) => ({ approvalDate: '', paymentDate: '', ...r })));
    } else {
      // PHASE 3G — no auto-seed. Opening a screen must never CREATE
      // data. An empty store stays empty until the user enters a row or
      // presses "Load Sample Data".
      setData([]);
    }
    setSyncLog(readSyncLog(project.id));
  }, [project.id]);

  const persist = (next: CertRow[]) => {
    setData(next);
    localStorage.setItem(`pactum-certs-${project.id}`, JSON.stringify(next));
  };

  /**
   * ══════════════════════════════════════════════════════════════════
   * SPRINT 3 · CERTIFICATES MUST PRESERVE HISTORICAL CURRENCY SNAPSHOTS
   *
   * THE DEFECT, MEASURED
   *
   *   A foreign certificate is saved with a frozen snapshot:
   *
   *     gross 7,512,000   currency AED
   *     originalAmount 30,000,000   exchangeRate 0.2504
   *
   *   Editing `gross` to 8,000,000 used to write that number straight
   *   into the converted field and leave the snapshot untouched. The row
   *   then CLAIMED, on screen at line ~566:
   *
   *     "AED 30,000,000 @ 0.2504"   -> which is 7,512,000, not 8,000,000
   *
   *   The audit trail contradicted the figure it described. Worse, the
   *   user typing "8,000,000" on an AED certificate almost certainly
   *   meant 8,000,000 AED, not EUR — so the number was wrong as well as
   *   unexplained.
   *
   * THE FIX
   *
   *   On a FOREIGN row, an edited amount is read in the ORIGINAL currency
   *   and re-converted at the rate ALREADY FROZEN on that row. The
   *   historical rate is never re-looked-up: the certificate was struck
   *   on its own date and must keep that date's rate, exactly as Phase 3K
   *   requires of every filed figure.
   *
   *   So the snapshot stays internally consistent — originalAmount,
   *   exchangeRate and the converted value continue to satisfy
   *   `original x rate = converted`, and `gross - retention = net` still
   *   holds because both legs share the one rate.
   *
   *   A domestic row (no currency metadata) behaves exactly as before.
   * ══════════════════════════════════════════════════════════════════
   */
  const updateField = (index: number, field: keyof CertRow, value: any) => {
    const updated = data.map((row, i) => {
      if (i !== index) return row;

      const isForeign = !!row.currency && row.currency !== money.base;
      const rate = Number(row.exchangeRate) || 0;

      // ── Foreign amount edit: input is in the ORIGINAL currency ──
      if (isForeign && rate > 0 && (field === 'gross' || field === 'retention')) {
        const enteredOriginal = Number(value) || 0;
        const converted = enteredOriginal * rate;

        // Recover the other leg in the original currency so both stay on
        // one rate and the subtraction survives conversion.
        const otherConverted = field === 'gross' ? row.retention : row.gross;
        const otherOriginal = otherConverted / rate;

        const grossOriginal = field === 'gross' ? enteredOriginal : otherOriginal;
        const retentionOriginal = field === 'retention' ? enteredOriginal : otherOriginal;

        return {
          ...row,
          gross: field === 'gross' ? converted : row.gross,
          retention: field === 'retention' ? converted : row.retention,
          // Derived from the CONVERTED figures, so gross - retention = net
          // exactly, with no rounding drift between the two legs.
          net: (field === 'gross' ? converted : row.gross)
             - (field === 'retention' ? converted : row.retention),
          // The snapshot is RE-DERIVED, never left stale. originalAmount
          // tracks the gross, which is what the audit line prints.
          originalAmount: grossOriginal,
          // exchangeRate / rateEffectiveDate / transactionDate are
          // deliberately NOT touched: this certificate's rate belongs to
          // its own date and re-reading today's would restate history.
          retentionOriginal,
        } as CertRow;
      }

      // ── Domestic row, or a non-amount field: unchanged behaviour ──
      const next = { ...row, [field]: value };
      if (field === 'gross')     next.net = Number(value) - row.retention;
      if (field === 'retention') next.net = row.gross - Number(value);
      return next;
    });
    persist(updated);
  };

  const [isAdding, setIsAdding] = useState(false);
  const [newRow, setNewRow] = useState({
    no: '', period: '', gross: '', retention: '', documentUrl: '',
    currency: contractCcy, date: new Date().toISOString().slice(0, 10),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRow.no) return;
    const gross     = Number(newRow.gross) || 0;
    const retention = Number(newRow.retention) || gross * 0.1;
    setSaveErr('');
    // One rate for the whole certificate, so the arithmetic survives.
    const txn = resolveTxnDate({ date: newRow.date }, ['date']);
    const g = prepareTransactionGroup(txnCtx, { gross, retention, net: gross - retention },
                                      newRow.currency, txn);
    if (!g.money.resolved) {
      setSaveErr(lang === 'ar'
        ? `لا يوجد سعر صرف من ${newRow.currency} إلى ${txnCtx.reportingCurrency} بتاريخ ${txn.date}. انشر السعر في إدارة العملات أولاً.`
        : `No rate from ${newRow.currency} to ${txnCtx.reportingCurrency} on ${txn.date}. Publish one in Currency Management first.`);
      return;
    }
    const baseRow: CertRow = {
      no: newRow.no, period: newRow.period,
      gross: g.values.gross, retention: g.values.retention, net: g.values.net,
      approvalDate: newRow.date, paymentDate: '', status: 'submitted', docs: [],
      documentUrl: newRow.documentUrl.trim(),
    };
    persist([...data, { ...baseRow,
      ...transactionFields({ ...g.money, originalAmount: gross }) } as CertRow]);
    setNewRow({ no: '', period: '', gross: '', retention: '', documentUrl: '',
                currency: contractCcy, date: new Date().toISOString().slice(0, 10) });
    setIsAdding(false);
  };

  const handleDelete = (index: number) => persist(data.filter((_, i) => i !== index));

  // ── Push a single cert to Cash Flow ──────────────────────────────────
  const handlePushCert = (cert: CertRow) => {
    // Enforced at the write, not only at the button. A disabled control is
    // a hint; this is the rule.
    if (!isSyncableCert(cert)) return;
    /**
     * ════════════════════════════════════════════════════════════════
     * A CERTIFICATE MAY POST TO CASH IN EXACTLY ONCE.
     *
     * MEASURED: seed one paid IPC of 1,000,000, press Sync, then press
     * it again — Cash In read 2,000,000. `pushCertToCashFlow` merges by
     * period label, so the second press did not create a duplicate row
     * a user could see and delete; it silently ADDED the net into the
     * existing row. The ledger looked tidy and was wrong.
     *
     * The audit log already names every certificate that posted. It is
     * now consulted before writing, so the money can only move once no
     * matter how many times the button is pressed.
     * ════════════════════════════════════════════════════════════════
     */
    if (readSyncLog(project.id).some(e => e.certNo === cert.no)) return;
    pushCertToCashFlow(project.id, cert, money.base);
    const entry: SyncEntry = {
      certNo: cert.no, period: cert.period,
      amount: cert.net, syncedAt: new Date().toLocaleString(),
    };
    appendSyncLog(project.id, entry);
    setSyncLog(readSyncLog(project.id));
    setSynced(true);
    setTimeout(() => setSynced(false), 2500);
  };

  /**
   * ══════════════════════════════════════════════════════════════════
   * WHAT MAY BE PUSHED INTO CASH IN — PAID ONLY.
   *
   * THE CONTRADICTION, MEASURED
   *
   *   CashFlowModule's own sync button filters `c.status === 'paid'`,
   *   with a comment stating why: Cash In is money that ARRIVED, and a
   *   certified IPC is a receivable, not a receipt.
   *
   *   This module's Sync All did NOT. It pushed `paid || certified`.
   *   So the SAME ledger received two different populations depending
   *   on which screen the user happened to press the button from —
   *   and pressing both pushed the paid certificates twice.
   *
   *   On a project with one paid and one certified-unpaid IPC, Cash In
   *   read the full approved value from this screen and the received
   *   value from the other. One ledger, two answers.
   *
   * A certificate stored in another unit is also refused. Pushing it
   * would add a foreign figure into a ledger totalled in the contract
   * currency — the exact defect the off-unit exclusion above prevents
   * in the tiles. It stays visible and stays out of the cash ledger.
   *
   * `isApprovedCert` is UNCHANGED and still governs the TILES: the
   * receivable is genuinely everything approved. Approved-and-owed and
   * approved-and-received are different facts and now read differently.
   * ══════════════════════════════════════════════════════════════════
   */
  const isSyncableCert = (d: CertRow) =>
    d.status === 'paid'
    && !!normaliseIso((d as any).paymentDate)
    && storedUnitOf(d, money.base) === money.base;

  // ── Push received (paid) certs to Cash Flow ───────────────────────────
  const handleSyncAll = () => {
    setSyncing(true);
    setTimeout(() => {
      // Same once-only rule as the per-row push. Read the log ONCE up
      // front and track within the loop, so two rows sharing a cert no.
      // cannot both post either.
      const posted = new Set(readSyncLog(project.id).map(e => e.certNo));
      const eligible = data.filter(c => isSyncableCert(c) && !posted.has(c.no));
      eligible.forEach(c => {
        if (posted.has(c.no)) return;
        posted.add(c.no);
        pushCertToCashFlow(project.id, c, money.base);
        appendSyncLog(project.id, {
          certNo: c.no, period: c.period, amount: c.net, syncedAt: new Date().toLocaleString(),
        });
      });
      setSyncLog(readSyncLog(project.id));
      setSyncing(false);
      setSynced(true);
      setTimeout(() => setSynced(false), 2500);
    }, 300);
  };

  /**
   * ══════════════════════════════════════════════════════════════════
   * SPRINT 3 · R7 — ONE FILTER RULE FOR THE WHOLE TILE ROW.
   *
   * THE DEFECT, MEASURED
   *
   *   certifiedTotal filtered to certified/paid rows.
   *   retentionTotal counted EVERY row, whatever its status.
   *
   *   The third tile subtracts one from the other, so it mixed two
   *   different populations. Phase 3J measured the result on a project
   *   whose four certificates were all still `submitted`:
   *
   *     Total Certified   EUR 0
   *     Retention Held    EUR 4,962,427
   *     Net Receivable   -EUR 4,962,427
   *
   *   A negative receivable is not a small rounding difference — it
   *   states that the contractor OWES the owner money because of
   *   retention withheld from certificates that were never approved.
   *   That cannot happen.
   *
   * THE FIX
   *
   *   Every figure in the row now reads the SAME population: approved
   *   certificates only (`certified` or `paid`). Retention on a
   *   submitted certificate is not held yet — nothing has been approved
   *   to withhold it from.
   *
   *   Submitted work is not hidden; it is reported separately below as
   *   a pending figure, so the user can still see what is in the
   *   pipeline without it corrupting the receivable.
   * ══════════════════════════════════════════════════════════════════
   */
  const isApprovedCert = (d: CertRow) => d.status === 'paid' || d.status === 'certified';

  /**
   * A TOTAL MAY ONLY SUM ONE CURRENCY.
   *
   * ══════════════════════════════════════════════════════════════════
   * Nearly every row is in `money.base` (the contract currency). A row
   * the storage-currency migration BLOCKED is not: it was left exactly
   * as filed, still denominated in the old company reporting currency,
   * because no historical rate existed to convert it honestly.
   *
   * Measured on a migrated project before this guard: one SAR
   * 4,000,000 certificate and one blocked AED 1,000,000 certificate
   * produced a headline of "SAR 5,000,000" — two units added together
   * and labelled with one of them. Exactly the class of defect
   * `commercialTotals` was written to end.
   *
   * Off-unit rows are therefore EXCLUDED from the totals and counted, so
   * the screen can say the figure is partial and name what is missing.
   * They remain fully visible in the table, each labelled in its own
   * currency.
   * ══════════════════════════════════════════════════════════════════
   */
  const inBaseUnit = (d: CertRow) => storedUnitOf(d, money.base) === money.base;
  const offUnitCerts = data.filter(d => !inBaseUnit(d));

  const approvedCerts   = data.filter(d => isApprovedCert(d) && inBaseUnit(d));
  const pendingCerts    = data.filter(d => !isApprovedCert(d) && inBaseUnit(d));

  const certifiedTotal  = approvedCerts.reduce((a, b) => a + b.gross, 0);
  // SAME population as certifiedTotal — this is the whole fix.
  const retentionTotal  = approvedCerts.reduce((a, b) => a + b.retention, 0);
  /** Gross value awaiting approval. Reported, never netted. */
  const pendingGross    = pendingCerts.reduce((a, b) => a + b.gross, 0);
  /**
   * The count on the button must be the count the button will push.
   * It read `paid || certified` while the push now sends paid-only, so
   * "Sync All (7)" would have moved four certificates and reported
   * nothing about the three it skipped.
   */
  const postedNos       = new Set(syncLog.map(e => e.certNo));
  const eligibleCount   = data.filter(d => isSyncableCert(d) && !postedNos.has(d.no)).length;
  /** Paid AND already in the cash ledger. Shown so the zero is explained. */
  const postedCount     = data.filter(d => isSyncableCert(d) && postedNos.has(d.no)).length;
  /** Approved but not yet received — a receivable, reported, never synced. */
  const receivableCount = data.filter(d => d.status === 'certified' && inBaseUnit(d)).length;

  return (
    <div className="pg-stack animate-in fade-in duration-500">

      {/* A total that excludes rows must say which ones, or the reader
          has no way to know the headline is partial. */}
      {offUnitCerts.length > 0 && (
        <div className="ds-card border-chart-3/30 bg-chart-3/[0.05] !py-3">
          <p className="text-(length:--t-second) text-chart-3">
            {lang === 'ar'
              ? `${offUnitCerts.length} مستخلص مخزَّن بعملة مختلفة عن ${money.base} ولم يُحوَّل لعدم وجود سعر صرف تاريخي — مستبعد من الإجماليات أعلاه: ${offUnitCerts.map(c => `${c.no} (${storedUnitOf(c, money.base)})`).join(' · ')}. شغّل ترحيل العملة من لوحة الإدارة بعد نشر السعر المطلوب.`
              : `${offUnitCerts.length} certificate(s) are stored in a currency other than ${money.base} and could not be converted for want of a historical rate — excluded from the totals above: ${offUnitCerts.map(c => `${c.no} (${storedUnitOf(c, money.base)})`).join(' · ')}. Publish the missing rate, then re-run the currency migration in the Admin Console.`}
          </p>
        </div>
      )}

      {/* 2 · EXECUTIVE SUMMARY */}
      <div className="kpi-strip !grid-cols-2 md:!grid-cols-4">
        <div className="kpi kpi-hero">
          <div className="kpi-k">{t.totalCertifiedValue}</div>
          <div className="kpi-v kpi-v-gold money" title={exactMoney(certifiedTotal, money.base)}>{kpiMoney(certifiedTotal, money.base)}</div>
          {/* SPRINT 3 · R7 — the population is now stated on the tile, so
              a reader never has to guess whether pending work is in it. */}
          <div className="kpi-sub">
            {lang === 'ar' ? `معتمدة (${approvedCerts.length})` : `Approved (${approvedCerts.length})`}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-k">{t.totalRetentionHeld}</div>
          <div className="kpi-v kpi-v-risk money" title={exactMoney(retentionTotal, money.base)}>{kpiMoney(retentionTotal, money.base)}</div>
          <div className="kpi-sub">
            {lang === 'ar' ? 'من المعتمدة فقط' : 'On approved only'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-k">Total Net Receivable</div>
          <div className="kpi-v kpi-v-ok money" title={exactMoney(certifiedTotal - retentionTotal, money.base)}>{kpiMoney(certifiedTotal - retentionTotal, money.base)}</div>
          {pendingGross > 0 && (
            <div className="kpi-sub">
              {lang === 'ar'
                ? `+ ${formatMoney(pendingGross, { currency: money.base })} قيد الاعتماد`
                : `+ ${formatMoney(pendingGross, { currency: money.base })} pending`}
            </div>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-k">Paid — Ready to Sync</div>
          <div className="kpi-v kpi-v-warn">{eligibleCount}</div>
          {/* The tile said "Eligible for Sync" over a count that included
              unpaid certificates. Naming the condition is what stops a
              reader treating an approved receivable as cash received. */}
          {/* Measured on screen: "CERTS · 1 ALREADY POSTED · 1 AWAITING
              PAYMENT" wrapped to two lines and left the word PAYMENT
              hanging alone under the tile. Short tokens, full wording in
              the tooltip — the tile stays one line at every density. */}
          <div
            className="kpi-sub"
            title={[
              `${eligibleCount} paid, not yet posted to cash flow`,
              postedCount > 0 ? `${postedCount} already posted` : '',
              receivableCount > 0 ? `${receivableCount} certified, awaiting payment` : '',
            ].filter(Boolean).join(' \u00b7 ')}
          >
            {[
              'CERTS',
              postedCount > 0 ? `${postedCount} POSTED` : '',
              receivableCount > 0 ? `${receivableCount} UNPAID` : '',
            ].filter(Boolean).join(' \u00b7 ')}
          </div>
        </div>
      </div>

      {/* ── Cash Flow Sync Panel ───────────────────────────────────────── */}
      <div className="ds-card ds-card-key">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-sm font-serif uppercase tracking-widest text-primary mb-1 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              Cash Flow Integration
            </h3>
            <p className="text-(length:--t-body) text-white/30 max-w-xl">
              Only PAID IPCs post to incoming cash flow — a certified IPC is
              a receivable, not a receipt, and is held back until payment.
              Click "Sync to Cash Flow" per cert, or push all paid certs at once.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {synced && (
              <span className="flex items-center gap-1 text-(length:--t-micro) text-chart-4 border border-chart-4/20 px-2 py-1">
                <CheckCircle className="w-3 h-3" /> Synced
              </span>
            )}
            <button
              onClick={() => setShowLog(v => !v)}
              className="text-(length:--t-label) text-white/45 hover:text-white/60 border border-white/10 px-3 py-1.5 transition-colors uppercase tracking-wider"
            >
              {showLog ? 'Hide' : 'Audit'} Log ({syncLog.length})
            </button>
            {canEdit && eligibleCount > 0 && (
              <button
                onClick={handleSyncAll}
                disabled={syncing}
                className="flex items-center gap-1.5 text-(length:--t-label) bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 px-4 py-1.5 transition-colors uppercase tracking-wider disabled:opacity-50"
              >
                <RefreshCw className={cn('w-3 h-3', syncing && 'animate-spin')} />
                Sync Paid ({eligibleCount})
              </button>
            )}
          </div>
        </div>

        {/* Audit log */}
        {showLog && (
          <div className="border border-white/5 bg-black/40 overflow-hidden">
            {syncLog.length === 0 ? (
              <p className="px-4 py-3 text-(length:--t-second) text-white/20 italic">No sync history yet.</p>
            ) : (
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Cert No.</th>
                    <th>Period</th>
                    <th className="money">Amount Pushed</th>
                    <th>Synced At</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLog.map((e, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2 font-mono text-primary">{e.certNo}</td>
                      <td className="px-4 py-2 text-white/60">{e.period}</td>
                      <td className="px-4 py-2 font-mono text-chart-4">{formatMoney(e.amount, { currency: money.base })}</td>
                      <td className="px-4 py-2 text-muted-foreground font-mono">{e.syncedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* IPC Table */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="sec-head !mb-0 flex-1">{t.ipcTitle}</h3>
          <ReportButton reportId="certificates" context={{ project, rows: data, certified: certifiedTotal, retention: retentionTotal, reportCurrency: money.base }} />
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
                <label className="field-label" data-required>{t.certNo}</label>
                <input className="field-input font-mono" placeholder="IPC-0X" value={newRow.no} onChange={e => setNewRow({ ...newRow, no: e.target.value })} required dir="ltr" />
              </div>
              <div className="field">
                <label className="field-label" data-required>{t.certSubmissionDate}</label>
                {/* Picked from a calendar, not typed — the ISO date stored
                    here is what the cash-flow link derives its month from. */}
                <input
                  className="field-input font-mono number-ltr"
                  type="date" dir="ltr" style={{ colorScheme: 'dark' }}
                  value={newRow.period || ''}
                  onChange={e => setNewRow({ ...newRow, period: e.target.value })}
                  required
                />
              </div>
              <TransactionAmountInput
                label={t.grossAmount}
                amount={newRow.gross}
                currency={newRow.currency}
                onAmount={v => setNewRow({ ...newRow, gross: v })}
                onCurrency={v => setNewRow({ ...newRow, currency: v })}
                date={newRow.date}
                fx={money.fx}
                settings={money.settings}
                projectId={project.id}
                onDate={v => setNewRow({ ...newRow, date: v })}
                hideDate
              />
              {/* Certificate date drives the rate lookup. */}
              <div className="field">
                <label className="field-label">
                  {lang === 'ar' ? 'تاريخ الشهادة' : 'Certificate Date'}
                  <span className="text-muted-foreground ms-2 normal-case tracking-normal">
                    {lang === 'ar' ? 'يحدد سعر الصرف' : 'sets the FX rate'}
                  </span>
                </label>
                <input className="field-input font-mono number-ltr" type="date" dir="ltr"
                       style={{ colorScheme: 'dark' }} value={newRow.date}
                       onChange={e => setNewRow({ ...newRow, date: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">{t.retention}</label>
                <input className="field-input font-mono number-ltr" type="number" placeholder="0" value={newRow.retention} onChange={e => setNewRow({ ...newRow, retention: e.target.value })} dir="ltr" />
              </div>
              {/* Document link. A URL only — the file itself stays where it lives. */}
              <div className="field">
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
                <th className="col-pin">{t.certNo}</th>
                <th>{t.certSubmissionDate}</th>
                {/* The unit is READ, never typed. These three headers used
                    to carry a literal "(SAR)" from i18n, so an AED or SAR
                    project announced the wrong currency above correct
                    figures. `money.base` is the project's contract
                    currency — the unit the column actually holds. */}
                <th className="money">{t.grossAmount} ({money.base})</th>
                <th className="money">{t.retention} ({money.base})</th>
                <th className="money">{t.netPayable} ({money.base})</th>
                <th>{t.approvalDate}</th>
                <th>{t.paymentDate}</th>
                <th>{t.status}</th>
                <th>{lang === 'ar' ? 'المستند' : 'Document'}</th>
                <th className="text-center">{lang === 'ar' ? 'التدفق النقدي' : 'Cash Flow'}</th>
                {canEdit && <th className="col-act" />}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={canEdit ? 11 : 10}><div className="ds-empty"><div className="ds-empty-title">{t.noData}</div></div></td></tr>
              )}
              {data.map((row, i) => {
                // Same rule as Sync All. The per-row button previously
                // offered a push for a certified-unpaid certificate that
                // the bulk button is now refusing — one screen, two rules.
                const isSyncable = isSyncableCert(row);
                // The unit THIS ROW is stored in. Equal to money.base for
                // every row the migration converted; still the old company
                // currency for one it had to block. Asking the row is the
                // only way the label cannot lie.
                const rowUnit = storedUnitOf(row, money.base);
                const offUnit = rowUnit !== money.base;
                const alreadySynced = syncLog.some(e => e.certNo === row.no);
                return (
                  <tr key={i}>
                    <td className="col-pin font-mono text-primary font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <EditableText value={row.no} onSave={v => updateField(i, 'no', v)} canEdit={canEdit} />
                        <CurrencyBadge code={row.currency ?? ''} base={money.base} />
                        {/* A row left in another unit is excluded from the
                            totals above. Saying so on the row is what stops
                            a reader adding it up by eye. */}
                        {offUnit && (
                          <span
                            className="text-(length:--t-micro) uppercase tracking-wider px-1.5 py-0.5 border border-chart-3/40 text-chart-3 bg-chart-3/10 rounded-full"
                            title={lang === 'ar'
                              ? `هذا الصف مخزَّن بعملة ${rowUnit} ولم يُحوَّل — غير مُدرَج في الإجماليات.`
                              : `Stored in ${rowUnit}, not converted — excluded from the totals above.`}
                          >
                            {rowUnit}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="text-white">
                      <EditableDate value={row.period} onSave={v => updateField(i, 'period', v)} canEdit={canEdit} className="font-mono number-ltr" />
                    </td>
                    <td className="money">
                      {/* SPRINT 3 — on a foreign row the EDITABLE value is
                          the ORIGINAL amount, because that is the currency
                          the certificate was written in and what the user
                          means when they type. The DISPLAY stays converted,
                          so the column keeps one unit down its length. */}
                      <EditableNumber
                        value={row.currency && row.currency !== money.base
                          ? (row.originalAmount ?? 0)
                          : row.gross}
                        onSave={v => updateField(i, 'gross', v)}
                        canEdit={canEdit}
                        display={formatMoney(row.gross, { currency: rowUnit })} />
                      {row.currency && row.currency !== money.base && (
                        <span className="block text-(length:--t-micro) font-mono text-muted-foreground mt-0.5">
                          {row.currency} {(row.originalAmount ?? 0).toLocaleString('en-US')} @ {(row.exchangeRate ?? 0).toFixed(4)}
                        </span>
                      )}
                    </td>
                    <td className="money money-neg">
                      {/* Legacy rows carry no retentionOriginal; recover it
                          from the frozen rate rather than showing a
                          converted figure in an original-currency field. */}
                      <EditableNumber
                        value={row.currency && row.currency !== money.base
                          ? (row.retentionOriginal
                             ?? (row.exchangeRate ? row.retention / row.exchangeRate : row.retention))
                          : row.retention}
                        onSave={v => updateField(i, 'retention', v)}
                        canEdit={canEdit}
                        display={formatMoney(row.retention, { currency: rowUnit })} />
                      {row.currency && row.currency !== money.base && (
                        <span className="block text-(length:--t-micro) font-mono text-muted-foreground mt-0.5">
                          {row.currency}{' '}
                          {(row.retentionOriginal
                            ?? (row.exchangeRate ? row.retention / row.exchangeRate : 0)
                           ).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </td>
                    <td className="money font-semibold">{formatMoney(row.net, { currency: rowUnit })}</td>
                    <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">
                      <EditableDate value={row.approvalDate || ''} onSave={v => updateField(i, 'approvalDate', v)} canEdit={canEdit} />
                    </td>
                    <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">
                      <EditableDate value={row.paymentDate || ''} onSave={v => updateField(i, 'paymentDate', v)} canEdit={canEdit} />
                    </td>
                    <td>
                      <EditableSelect value={row.status} options={STATUS_OPTS(t)} onSave={v => updateField(i, 'status', v)} canEdit={canEdit}
                        className={cn('px-2.5 py-1 text-(length:--t-second) uppercase font-bold tracking-widest border rounded-full', getStatusColor(row.status))} />
                    </td>
                    {/* Document — link plus the existing attachment count.
                        Identical treatment to the subcontract registers, so a
                        link behaves the same everywhere in the platform. */}
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
                        {row.docs && row.docs.length > 0 && (
                          <span className="text-(length:--t-second) text-primary/70">+{row.docs.length}</span>
                        )}
                      </div>
                    </td>
                    {/* Per-cert sync button */}
                    <td className="text-center">
                      {isSyncable && canEdit ? (
                        <button
                          onClick={() => handlePushCert(row)}
                          title="Push net amount to Cash Flow as Cash In"
                          className={cn(
                            'inline-flex items-center gap-1 text-(length:--t-second) px-2 py-1 border transition-colors uppercase tracking-wider whitespace-nowrap',
                            alreadySynced
                              ? 'border-chart-4/30 text-chart-4 bg-chart-4/5 cursor-default'
                              : 'border-primary/30 text-primary hover:bg-primary/10'
                          )}
                        >
                          {alreadySynced
                            ? <><CheckCircle className="w-3 h-3" /> Synced</>
                            : <><ArrowRightLeft className="w-3 h-3" /> Push</>}
                        </button>
                      ) : (
                        <span className="text-(length:--t-second) text-white/45">—</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="col-act">
                        <button onClick={() => handleDelete(i)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
