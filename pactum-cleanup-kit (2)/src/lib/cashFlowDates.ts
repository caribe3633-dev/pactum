/**
 * Cash Flow date engine.
 * Destination: src/lib/cashFlowDates.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 *   Cash Flow rows stored a month LABEL — `"Jan"`, `"M1"`, `"يناير 2024"`,
 *   and sometimes an IPC number when no period was set. A label is not a
 *   date, and `rateOn()` selects an exchange rate BY DATE. The module was
 *   therefore the only financial register that could not be converted at
 *   all: not merely unwired, but unwireable.
 *
 *   This file gives a row four dates without taking away its label.
 *
 * THE FOUR DATES, AND WHY FOUR
 *
 *   transactionDate   The day money actually moved. The primary fact.
 *   effectiveDate     The day it takes economic effect. Usually the same,
 *                     but a payment initiated on the 28th and valued on the
 *                     2nd has two different dates, and a cash flow that
 *                     cannot express that is describing a bank statement it
 *                     has never seen.
 *   reportingWindow   `YYYY-MM`. Which period the row rolls up into.
 *                     DERIVED, never entered — a window that disagrees with
 *                     its own date is a contradiction waiting to be found.
 *   fxSnapshotDate    The date the rate is looked up against. Defaults to
 *                     the transaction date and is stored separately so that
 *                     a deliberate exception is visible rather than hidden
 *                     inside a conversion.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 *   It performs no conversion, touches no total, and changes no stored
 *   amount. `net` and `cumNet` are the Cash Flow module's own arithmetic and
 *   are not referenced here. Nothing in this file writes to storage.
 *
 * THE JOIN KEY IS UNTOUCHED
 *
 *   `month` remains the key that CertsModule and both sync functions match
 *   on. Dates are ADDITIVE. A row with no dates behaves exactly as it did
 *   before, which is what makes this migration safe to apply to live data.
 * ══════════════════════════════════════════════════════════════════════
 */

/** The date fields a Cash Flow row may carry. All optional. */
export interface CashFlowDates {
  /** ISO yyyy-mm-dd. The day the money moved. */
  transactionDate?: string;
  /** ISO yyyy-mm-dd. The day it takes economic effect. */
  effectiveDate?: string;
  /** `YYYY-MM`. Derived from the effective date, never entered by hand. */
  reportingWindow?: string;
  /** ISO yyyy-mm-dd. The date the FX rate is looked up against. */
  fxSnapshotDate?: string;
  /**
   * Where the dates came from:
   *   'entered'  a person typed them
   *   'inferred' parsed from the legacy month label
   *   'derived'  taken from a source document (a certificate's own dates)
   *
   * Recorded because an inferred date is a reading of a label, not a
   * statement of fact, and a reader deciding whether to trust a converted
   * figure needs to know which they are looking at.
   */
  dateSource?: 'entered' | 'inferred' | 'derived';
}

/**
 * Currency metadata for one cash-flow row.
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 1 · TASK 2 — CASH FLOW CURRENCY METADATA
 *
 * THE DEFECT, MEASURED
 *
 *   A stored row carried these keys and no others:
 *
 *     month · in · out · net · cumNet · transactionDate ·
 *     effectiveDate · reportingWindow · fxSnapshotDate · dateSource
 *
 *   Not one of them says what currency `in` and `out` are counted in.
 *   The module then printed them with a bare formatMoney(), which
 *   defaults to SAR. An AED figure under a EUR-reporting company was
 *   displayed as SAR — overstated roughly fourfold.
 *
 *   The row already reserved `fxSnapshotDate`, so the design always
 *   INTENDED to convert. What was missing was the source currency to
 *   convert FROM.
 *
 * WHY THESE FIELD NAMES
 *
 *   `currency`, `originalAmount`, `exchangeRate`, `rateEffectiveDate`,
 *   `reportingCurrency`, `rateLegIds` are the names transactionFields()
 *   already writes on change orders, claims and certificates. Reusing
 *   them means readTransactionMoney() reads a cash row with no special
 *   case, and one reader serves every module.
 *
 *   `rateLegIds` is the exchange-snapshot identifier asked for: the ids
 *   of the FX register rows the conversion actually used, so the figure
 *   can be re-audited years later against the exact rates applied.
 *
 * BACKWARD COMPATIBILITY
 *
 *   Every field is optional. A legacy row has none, and
 *   readTransactionMoney() treats that as "captured in the project's
 *   contract currency at rate 1" — the platform's existing documented
 *   assumption. No stored row is rewritten and no figure changes.
 * ══════════════════════════════════════════════════════════════════════
 */
export interface CashFlowCurrency {
  /** ISO 4217 of the amounts AS ENTERED. */
  currency?: string;
  /** The reporting currency `in` / `out` were converted INTO. */
  reportingCurrency?: string;
  /** `in` as entered, before conversion. */
  originalIn?: number;
  /** `out` as entered, before conversion. */
  originalOut?: number;
  /** The rate applied, frozen at save time. 1 when no conversion ran. */
  exchangeRate?: number;
  /** Effective date of the FX row used — not the transaction date. */
  rateEffectiveDate?: string;
  /**
   * Ids of the FX register rows used. THE EXCHANGE SNAPSHOT ID.
   * Empty when the row needed no conversion.
   */
  rateLegIds?: string[];
  /** How the rate was found: identity, direct, inverse or cross. */
  rateSource?: string;
  /** ISO timestamp of the conversion. Never revisited. */
  convertedAt?: string;
}

// ── Month label parsing ────────────────────────────────────────────────

const EN_MONTHS = [
  ['jan', 'january'], ['feb', 'february'], ['mar', 'march'], ['apr', 'april'],
  ['may'], ['jun', 'june'], ['jul', 'july'], ['aug', 'august'],
  ['sep', 'sept', 'september'], ['oct', 'october'], ['nov', 'november'],
  ['dec', 'december'],
];

const AR_MONTHS = [
  ['يناير', 'كانون الثاني'], ['فبراير', 'شباط'], ['مارس', 'آذار'],
  ['أبريل', 'ابريل', 'نيسان'], ['مايو', 'أيار'], ['يونيو', 'يونيه', 'حزيران'],
  ['يوليو', 'يوليه', 'تموز'], ['أغسطس', 'اغسطس', 'آب'],
  ['سبتمبر', 'أيلول'], ['أكتوبر', 'اكتوبر', 'تشرين الأول'],
  ['نوفمبر', 'تشرين الثاني'], ['ديسمبر', 'كانون الأول'],
];

/** Last calendar day of a month — the correct date for a month-end position. */
export function lastDayOfMonth(year: number, month1to12: number): string {
  const d = new Date(Date.UTC(year, month1to12, 0));
  return d.toISOString().slice(0, 10);
}

/** `2026-03-17` -> `2026-03`. */
export function windowOf(isoDate: string): string {
  return /^\d{4}-\d{2}/.test(isoDate) ? isoDate.slice(0, 7) : '';
}

export interface ParsedLabel {
  /** ISO date the label resolves to, or '' when it cannot be read. */
  date: string;
  /** `YYYY-MM`, or ''. */
  window: string;
  /** True when the label was legible as a period. */
  parsed: boolean;
  /** What was recognised, for the migration report. */
  detail: string;
}

/**
 * Reads a legacy month label into a date, or refuses.
 *
 * Recognised:
 *   `Jan 2024` · `January 2024` · `يناير 2024` · `2024-01` · `01/2024`
 *   `Jan` (bare month — resolved against `fallbackYear`)
 *
 * NOT recognised, deliberately:
 *   `M1` · `IPC-03` · `Q1` · anything without a month
 *
 * A sequence label like `M1` carries no calendar information whatsoever.
 * Guessing that M1 means January would fabricate a date, and a fabricated
 * date selects a real exchange rate — producing a converted figure that
 * looks exactly as authoritative as a correct one. Refusing is the only
 * honest outcome.
 */
export function parseMonthLabel(label: string, fallbackYear?: number): ParsedLabel {
  const none = (detail: string): ParsedLabel =>
    ({ date: '', window: '', parsed: false, detail });

  const raw = String(label ?? '').trim();
  if (!raw) return none('empty label');

  // ISO-ish: 2024-01 or 2024-01-15
  const iso = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (iso) {
    const y = Number(iso[1]), m = Number(iso[2]);
    if (m >= 1 && m <= 12) {
      const date = iso[3]
        ? `${y}-${String(m).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`
        : lastDayOfMonth(y, m);
      return { date, window: windowOf(date), parsed: true, detail: 'ISO period' };
    }
  }

  // Numeric: 01/2024 or 1-2024
  const numeric = raw.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (numeric) {
    const m = Number(numeric[1]), y = Number(numeric[2]);
    if (m >= 1 && m <= 12) {
      const date = lastDayOfMonth(y, m);
      return { date, window: windowOf(date), parsed: true, detail: 'numeric month/year' };
    }
  }

  const lower = raw.toLowerCase();
  const yearMatch = raw.match(/(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : fallbackYear;

  const findMonth = (names: string[][], hay: string): number => {
    for (let i = 0; i < names.length; i++) {
      // Longest alias first, so "sept" is not shadowed by "sep".
      const aliases = [...names[i]].sort((a, b) => b.length - a.length);
      for (const a of aliases) if (hay.includes(a)) return i + 1;
    }
    return 0;
  };

  let month = findMonth(EN_MONTHS, lower);
  let lang = 'English';
  if (!month) { month = findMonth(AR_MONTHS, raw); lang = 'Arabic'; }

  if (!month) {
    return none(
      /^[a-zA-Z]?\d+$/.test(raw)
        ? 'sequence label — carries no calendar information'
        : 'no recognisable month');
  }
  if (!year) return none(`${lang} month recognised but no year available`);

  const date = lastDayOfMonth(year, month);
  return { date, window: windowOf(date), parsed: true, detail: `${lang} month name` };
}

// ── Derivation ─────────────────────────────────────────────────────────

/**
 * Builds the four dates from a transaction date.
 *
 * `effectiveDate` defaults to the transaction date, and `fxSnapshotDate` to
 * the effective date. Both can be overridden; the defaults describe the
 * ordinary case, where all three are the same day.
 */
export function datesFrom(
  transactionDate: string,
  opts: { effectiveDate?: string; fxSnapshotDate?: string;
          source?: CashFlowDates['dateSource'] } = {},
): CashFlowDates {
  const txn = normaliseIso(transactionDate);
  if (!txn) return {};
  const eff = normaliseIso(opts.effectiveDate) || txn;
  return {
    transactionDate: txn,
    effectiveDate: eff,
    reportingWindow: windowOf(eff),
    fxSnapshotDate: normaliseIso(opts.fxSnapshotDate) || eff,
    dateSource: opts.source ?? 'entered',
  };
}

/** Accepts ISO or DD/MM/YYYY. Returns '' when unusable. */
export function normaliseIso(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
}

// ── Migration ──────────────────────────────────────────────────────────

export interface MigrationRow {
  index: number;
  label: string;
  dates: CashFlowDates;
  /** True when the label could be read. */
  migrated: boolean;
  reason: string;
}

export interface MigrationResult {
  rows: MigrationRow[];
  migrated: number;
  flagged: number;
  total: number;
  /** Labels that could not be read, for the report and the UI banner. */
  unresolved: { index: number; label: string; reason: string }[];
}

/**
 * Reads dates out of a set of legacy rows WITHOUT writing anything.
 *
 * Pure inspection. The caller decides whether to persist the result, and a
 * row whose label could not be read receives no dates at all rather than a
 * plausible-looking guess.
 */
export function planMigration(
  rows: { month?: string }[], fallbackYear?: number,
): MigrationResult {
  const out: MigrationRow[] = (rows ?? []).map((r, i) => {
    const label = String(r?.month ?? '');
    const p = parseMonthLabel(label, fallbackYear);
    return {
      index: i,
      label,
      dates: p.parsed
        // A month label denotes a month-END position, so the last day of
        // the month is the date it describes.
        ? { ...datesFrom(p.date, { source: 'inferred' }) }
        : {},
      migrated: p.parsed,
      reason: p.detail,
    };
  });

  return {
    rows: out,
    migrated: out.filter(r => r.migrated).length,
    flagged: out.filter(r => !r.migrated).length,
    total: out.length,
    unresolved: out.filter(r => !r.migrated)
      .map(r => ({ index: r.index, label: r.label, reason: r.reason })),
  };
}

/**
 * Applies a migration plan to rows, leaving unresolved rows untouched.
 *
 * Returns NEW objects; nothing is mutated. Amounts are copied verbatim —
 * this function does not know what `in`, `out`, `net` or `cumNet` mean and
 * must never learn.
 */
export function applyMigration<T extends { month?: string }>(
  rows: T[], plan: MigrationResult,
): T[] {
  return (rows ?? []).map((r, i) => {
    const p = plan.rows[i];
    if (!p || !p.migrated) return r;
    return { ...r, ...p.dates };
  });
}

/** True when a row already carries a usable transaction date. */
export function hasDates(row: any): boolean {
  return Boolean(normaliseIso(row?.transactionDate));
}

/**
 * The date a row should be converted at.
 *
 * Order: explicit FX snapshot date, then effective, then transaction.
 * Returns '' when the row has none — and a caller that receives '' must
 * refuse to convert rather than substitute today.
 */
export function fxDateOf(row: any): string {
  return normaliseIso(row?.fxSnapshotDate)
    || normaliseIso(row?.effectiveDate)
    || normaliseIso(row?.transactionDate)
    || '';
}

/** The window a row rolls up into: stored, else derived, else its label. */
export function windowLabelOf(row: any): string {
  const w = String(row?.reportingWindow ?? '');
  if (/^\d{4}-\d{2}$/.test(w)) return w;
  const eff = normaliseIso(row?.effectiveDate) || normaliseIso(row?.transactionDate);
  return eff ? windowOf(eff) : String(row?.month ?? '');
}

// ── Rollup ─────────────────────────────────────────────────────────────

export interface WindowGroup {
  window: string;
  label: string;
  rowIndexes: number[];
  rowCount: number;
  /** True when every row in the group carries dates. */
  fullyDated: boolean;
}

/**
 * Groups rows by reporting window, for a dated ledger displayed monthly.
 *
 * Sums nothing. The caller adds up whichever fields it owns; grouping and
 * arithmetic are kept apart so that this file cannot drift from the Cash
 * Flow module's own totals.
 */
export function groupByWindow(rows: any[]): WindowGroup[] {
  const map = new Map<string, WindowGroup>();
  (rows ?? []).forEach((r, i) => {
    const w = windowLabelOf(r) || '—';
    const g = map.get(w);
    if (g) {
      g.rowIndexes.push(i);
      g.rowCount += 1;
      g.fullyDated = g.fullyDated && hasDates(r);
    } else {
      map.set(w, {
        window: w,
        label: /^\d{4}-\d{2}$/.test(w) ? monthLabel(w) : w,
        rowIndexes: [i],
        rowCount: 1,
        fullyDated: hasDates(r),
      });
    }
  });
  // Dated windows sort chronologically; undated labels keep insertion order
  // at the end, because there is no defensible position for them.
  return Array.from(map.values()).sort((a, b) => {
    const ad = /^\d{4}-\d{2}$/.test(a.window), bd = /^\d{4}-\d{2}$/.test(b.window);
    if (ad && bd) return a.window < b.window ? -1 : 1;
    if (ad) return -1;
    if (bd) return 1;
    return 0;
  });
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-03` -> `March 2026`. */
export function monthLabel(window: string): string {
  const m = window.match(/^(\d{4})-(\d{2})$/);
  if (!m) return window;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS_EN[idx]} ${m[1]}` : window;
}
