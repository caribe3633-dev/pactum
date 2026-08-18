/**
 * Repair of cash ledgers written by the pre-fix certificate sync.
 * Destination: src/lib/cashSyncRepair.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 *   Two defects in CertsModule posted money into Cash In that never
 *   arrived. Both are now fixed at the write, but a fix at the write
 *   does nothing for a ledger that was already written:
 *
 *     A · CERTIFIED-BUT-UNPAID WAS POSTED
 *         "Sync All" filtered `paid || certified` while CashFlowModule
 *         filtered `paid`. A certified IPC is a receivable, not a
 *         receipt. Its value entered Cash In weeks or months before the
 *         money did — or before it ever did.
 *
 *     B · THE SAME CERTIFICATE POSTED MORE THAN ONCE
 *         `pushCertToCashFlow` merges by period label, so a second press
 *         did not create a duplicate row anyone could see and delete. It
 *         ADDED the net into the row already there. The ledger looked
 *         tidy and was overstated.
 *
 * WHAT MAKES THE REPAIR POSSIBLE
 *
 *   The sync audit log (`pactum-certs-sync-{projectId}`) records every
 *   push: certificate number, period, AMOUNT AS POSTED, and when. That
 *   log — not a re-derivation from today's certificate values — is the
 *   evidence. It says what actually entered the ledger, which is the
 *   only honest basis for taking it back out. A certificate edited since
 *   the sync would otherwise have the wrong figure removed.
 *
 *   The log was capped at 30 entries before the fix. Pushes older than
 *   that are GONE, so this tool can only repair what the log still
 *   remembers. It says so rather than implying completeness.
 *
 * WHAT IT REFUSES TO DO
 *
 *   Never guesses. A row it cannot reconcile is BLOCKED, named, and left
 *   exactly as filed:
 *     - the period row named by the log no longer exists
 *     - removing the amount would drive Cash In negative
 *     - the ledger row is denominated in another currency
 *     - the certificate itself is gone from the register
 *
 *   Blocked never means dropped, and it never means silently adjusted.
 *
 * IDEMPOTENT
 *
 *   Repaired entries are stamped in the log (`repairedAt`). A second run
 *   reports "already repaired" instead of removing the amount twice —
 *   which would be the very defect this file exists to undo.
 * ══════════════════════════════════════════════════════════════════════
 */

export const REPAIR_VERSION = 1;

/** One push, as the audit log recorded it. */
export interface SyncLogEntry {
  certNo: string;
  period: string;
  amount: number;
  syncedAt: string;
  /** Set by this tool once the amount has been taken back out. */
  repairedAt?: string;
  repairedBy?: string;
  repairReason?: string;
}

interface CertLike {
  no: string;
  period?: string;
  status?: string;
  currency?: string;
}

interface CashRowLike {
  month: string;
  in: number;
  out: number;
  net: number;
  cumNet: number;
  currency?: string;
  [k: string]: unknown;
}

export type RepairReason =
  | 'not-paid'          // posted while certified/submitted — never received
  | 'duplicate-post';   // the same certificate posted more than once

export type BlockReason =
  | 'row-missing'
  | 'would-go-negative'
  | 'currency-mismatch'
  | 'cert-missing';

export interface RepairItem {
  certNo: string;
  period: string;
  amount: number;
  syncedAt: string;
  reason: RepairReason;
  /** Certificate status as it stands today, for the operator's judgement. */
  statusNow: string;
}

export interface BlockedItem extends RepairItem {
  blocked: BlockReason;
  /** Plain-language statement of what was found, never a guess. */
  detail: string;
}

export interface RepairReport {
  projectId: string;
  contractCurrency: string;
  /** Entries the log still holds. */
  logEntries: number;
  /** True when the log is at the old 30-entry cap — history may be missing. */
  logMayBeTruncated: boolean;
  alreadyRepaired: number;
  removed: RepairItem[];
  blocked: BlockedItem[];
  cashInBefore: number;
  cashInAfter: number;
  /** True when nothing was left blocked. */
  clean: boolean;
}

const certsKey  = (p: string) => `pactum-certs-${p}`;
const cashKey   = (p: string) => `pactum-cashflow-${p}`;
const syncKey   = (p: string) => `pactum-certs-sync-${p}`;

/** The cap the buggy build wrote at. A log sitting exactly here lost history. */
const OLD_LOG_CAP = 30;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function recalcCum(rows: CashRowLike[]): CashRowLike[] {
  let cum = 0;
  return rows.map(r => {
    cum += r.net;
    return { ...r, cumNet: cum };
  });
}

/** Rounds away float dust so a genuine zero reads as zero. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Examines one project and, unless `dryRun`, removes the overstatement.
 *
 * The calculation is IDENTICAL in both modes — the report a dry run shows
 * is the report the write produces, so what is reviewed is what happens.
 */
export function repairProjectCashSync(
  projectId: string,
  contractCurrency: string,
  opts: { dryRun?: boolean; by?: string } = {},
): RepairReport {
  const dryRun = opts.dryRun !== false;
  const by = opts.by || 'unknown';

  const certs = readJson<CertLike[]>(certsKey(projectId), []);
  const log   = readJson<SyncLogEntry[]>(syncKey(projectId), []);
  const rows  = readJson<CashRowLike[]>(cashKey(projectId), []);

  const report: RepairReport = {
    projectId,
    contractCurrency,
    logEntries: log.length,
    logMayBeTruncated: log.length >= OLD_LOG_CAP,
    alreadyRepaired: 0,
    removed: [],
    blocked: [],
    cashInBefore: r2(rows.reduce((a, r) => a + (Number(r.in) || 0), 0)),
    cashInAfter: 0,
    clean: true,
  };

  const certByNo = new Map(certs.map(c => [c.no, c]));

  /**
   * The log is newest-first. Walking OLDEST-first means the first push of
   * a certificate is the one kept and the later ones are the duplicates —
   * which matches what actually happened in the ledger.
   */
  const chronological = [...log].reverse();
  const seen = new Set<string>();

  // Work on a copy; nothing is committed unless every decision is made.
  const working = rows.map(r => ({ ...r }));
  const rowByMonth = new Map<string, CashRowLike>();
  working.forEach(r => { if (!rowByMonth.has(r.month)) rowByMonth.set(r.month, r); });

  const stamped: SyncLogEntry[] = [];

  for (const entry of chronological) {
    if (entry.repairedAt) {
      report.alreadyRepaired++;
      stamped.push(entry);
      continue;
    }

    const cert = certByNo.get(entry.certNo);
    const statusNow = cert?.status ?? 'MISSING';
    const isDuplicate = seen.has(entry.certNo);
    seen.add(entry.certNo);

    // Is this push one that should never have happened?
    let reason: RepairReason | null = null;
    if (isDuplicate) reason = 'duplicate-post';
    else if (cert && cert.status !== 'paid') reason = 'not-paid';

    if (!reason) {
      // A legitimate, single push of a paid certificate. Left alone.
      stamped.push(entry);
      continue;
    }

    const base: RepairItem = {
      certNo: entry.certNo,
      period: entry.period,
      amount: r2(Number(entry.amount) || 0),
      syncedAt: entry.syncedAt,
      reason,
      statusNow,
    };

    const block = (blocked: BlockReason, detail: string) => {
      report.blocked.push({ ...base, blocked, detail });
      report.clean = false;
      stamped.push(entry); // NOT stamped repaired — it was not repaired.
    };

    if (!cert) {
      block('cert-missing',
        `Certificate ${entry.certNo} is no longer in the register, so the ` +
        `posting cannot be matched to a status. Amount left in the ledger.`);
      continue;
    }

    const row = rowByMonth.get(entry.period) || rowByMonth.get(entry.certNo);
    if (!row) {
      block('row-missing',
        `No cash flow row for period "${entry.period}". The row may have ` +
        `been renamed or deleted since the sync.`);
      continue;
    }

    const rowCcy = (row.currency as string) || contractCurrency;
    if (rowCcy !== contractCurrency) {
      block('currency-mismatch',
        `Row is denominated in ${rowCcy}, the posting in ${contractCurrency}. ` +
        `Subtracting across units would corrupt the row.`);
      continue;
    }

    const currentIn = Number(row.in) || 0;
    if (r2(currentIn - base.amount) < 0) {
      // Grouped, with the unit. The raw numbers read "Row holds 100000 but
      // the posting was 750000" on screen — six unseparated digits in a
      // sentence the operator has to compare by eye.
      const g = (n: number) => `${contractCurrency} ${Math.round(n).toLocaleString('en-US')}`;
      block('would-go-negative',
        `Row holds ${g(currentIn)} but the posting was ${g(base.amount)}. ` +
        `The row has been edited since the sync; removing the full amount ` +
        `would invent a negative receipt.`);
      continue;
    }

    // Commit to the working copy.
    row.in  = r2(currentIn - base.amount);
    row.out = Number(row.out) || 0;
    row.net = r2(row.in - row.out);
    report.removed.push(base);

    stamped.push({
      ...entry,
      repairedAt: new Date().toISOString(),
      repairedBy: by,
      repairReason: reason === 'not-paid'
        ? `Removed: certificate was "${statusNow}", not paid, when it was posted.`
        : `Removed: duplicate posting of ${entry.certNo}.`,
    });
  }

  const finalRows = recalcCum(working);
  report.cashInAfter = r2(finalRows.reduce((a, r) => a + (Number(r.in) || 0), 0));

  if (!dryRun && report.removed.length > 0) {
    localStorage.setItem(cashKey(projectId), JSON.stringify(finalRows));
    // The log is rewritten newest-first, as it is stored and displayed.
    localStorage.setItem(syncKey(projectId), JSON.stringify([...stamped].reverse()));
  }

  return report;
}
