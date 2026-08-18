/**
 * Shared utilities.
 * Destination: src/lib/utils.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * MONEY FORMATTING MIGRATION — presentation layer only.
 *
 *   Nothing in this file calculates anything. It turns numbers that other
 *   modules already computed into strings. No business rule, no formula and
 *   no stored value is touched by any change here.
 *
 * WHAT CHANGED AND WHY
 *
 *   1 · `formatMoney` hardcoded `currency: 'SAR'` with no way to override.
 *       Eight phases of multi-currency work sit above this function, and
 *       194 call sites printed SAR regardless of any of it — the number
 *       correct, the label wrong, which is the worst of the available
 *       failure modes because a reader cannot tell which to trust.
 *
 *   2 · `.replace('SAR', 'SAR ')` was a defect, not a style choice. Intl
 *       already emits `SAR\u00A01,234` with a non-breaking space, so the
 *       replace inserted a SECOND separator. Every money figure in the
 *       platform rendered as `SAR  40,600,000`. Invisible on screen where
 *       HTML collapses the ordinary space; visible in exports, print and
 *       copy-paste. Removed, with no manual spacing put in its place.
 *
 *   3 · `null` rendered as `SAR 0`. Absent and zero are different facts,
 *       and the platform is explicit about that everywhere else —
 *       `abbrevMoney` in moneyFormat.ts returns an em dash for exactly this
 *       reason. This file now agrees with it.
 *
 * BACKWARD COMPATIBILITY
 *
 *   `formatMoney(amount)` behaves as before in every respect except the two
 *   defects above. The second parameter is optional; all 194 existing call
 *   sites compile and run unchanged.
 * ══════════════════════════════════════════════════════════════════════
 */

// ── Money ──────────────────────────────────────────────────────────────

/**
 * Presentation options. Every field is optional, and the defaults reproduce
 * the platform's existing output — so adding a field here can never change
 * what an existing caller renders.
 */
export interface MoneyFormatOptions {
  /**
   * ISO 4217 code. Defaults to SAR for backward compatibility.
   *
   * The default is deliberately a fallback, not a statement: a caller that
   * knows its currency should pass it. Callers that do not are listed in
   * the migration report as remaining work.
   */
  currency?: string;
  /** BCP-47 tag. Defaults to en-US, matching every existing call. */
  locale?: string;
  /** `40.6M` instead of `40,600,000`. For dense tables. */
  compact?: boolean;
  /** Fixed decimal places. Omitted, uses 0–2 as the platform always has. */
  decimals?: number;
  /**
   * Parentheses for negatives — `(SAR 1,250)` rather than `-SAR 1,250`.
   * Accounting convention; off by default because changing it silently
   * would alter every negative figure on every screen.
   */
  accountingStyle?: boolean;
  /**
   * What to render for a missing value. Defaults to an em dash, matching
   * `abbrevMoney`. Pass `''` where a blank cell reads better than a dash.
   */
  fallback?: string;
}

/** The em dash the platform uses for "not recorded". */
const MISSING = '—';

/**
 * True for anything that cannot be rendered as an amount.
 *
 * `null` and `''` are included deliberately. Both previously produced
 * `SAR 0`, which presents an absent figure as a zero one — a distinction
 * this platform maintains everywhere else and should not abandon at its
 * most-used formatter.
 */
function isMissing(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  const n = Number(v);
  return !Number.isFinite(n);
}

/**
 * Money as a string.
 *
 *   formatMoney(40600000)                          -> "SAR 40,600,000"
 *   formatMoney(40600000, { currency: 'USD' })     -> "$40,600,000"
 *   formatMoney(40600000, { compact: true })       -> "SAR 40.6M"
 *   formatMoney(-1250, { accountingStyle: true })  -> "(SAR 1,250)"
 *   formatMoney(null)                              -> "—"
 *
 * The output comes from Intl.NumberFormat exactly as generated. No symbol
 * is appended by hand and no spacing is inserted: Intl already places a
 * non-breaking space where the locale requires one, and the previous
 * attempt to add another is what produced the double-space defect.
 */
export function formatMoney(
  amount: number | null | undefined,
  options: MoneyFormatOptions = {},
): string {
  if (isMissing(amount)) return options.fallback ?? MISSING;

  const {
    /**
     * ════════════════════════════════════════════════════════════════
     * SPRINT 3 · R5 — WHY THIS DEFAULT STILL EXISTS
     *
     * The roadmap proposed deleting it and making `currency` mandatory,
     * letting the compiler find all 137 silent call sites.
     *
     * Measured before doing so: of the seven files holding 127 of those
     * calls, NOT ONE had a currency in scope. A mandatory parameter
     * would have produced 137 errors with nothing local to satisfy
     * them — and the quickest way to silence a compiler is to pass
     * whatever is nearest, turning a silent wrong currency into a
     * hardcoded one.
     *
     * So the plumbing was done first. Every call site now passes an
     * explicit currency: 190 of 197, the remaining 7 being comments and
     * the doc examples above.
     *
     * The default is KEPT deliberately, for two reasons:
     *
     *   1. `formatMoney` is also called from report definitions and
     *      other non-component code where no project is in scope.
     *      Breaking those to prove a point would be a regression.
     *   2. R1 changed what the fallback MEANS. A company's currency now
     *      resolves from its registry entry, so the paths that used to
     *      land here no longer do. This is a last resort, not a routine
     *      outcome.
     *
     * Making it mandatory is now a genuinely one-line change with seven
     * sites to fix rather than 137 — worth doing, but as its own task
     * with its own verification, not smuggled into this one.
     * ════════════════════════════════════════════════════════════════
     */
    currency = 'SAR',
    locale = 'en-US',
    compact = false,
    decimals,
    accountingStyle = false,
  } = options;

  const n = Number(amount);

  const config: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    // Accounting sign display is requested through Intl rather than by
    // wrapping the string, so the parentheses land in the right place for
    // the locale instead of always at the outside.
    ...(accountingStyle ? { currencySign: 'accounting' } : {}),
    ...(compact ? { notation: 'compact', compactDisplay: 'short' } : {}),
    ...(decimals === undefined
      // The platform's long-standing default: no forced decimals, up to two
      // shown when present. Preserved exactly.
      ? (compact
          ? { maximumFractionDigits: 1 }
          : { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  };

  try {
    return new Intl.NumberFormat(locale, config).format(n);
  } catch {
    // An unrecognised currency code makes Intl throw. Falling back to a
    // plain grouped number with the code in front keeps the figure legible
    // and keeps the currency visible, rather than losing one or both to an
    // exception on a screen that was only trying to print a number.
    const grouped = n.toLocaleString(locale, {
      minimumFractionDigits: decimals ?? 0,
      maximumFractionDigits: decimals ?? 2,
    });
    return `${currency} ${grouped}`;
  }
}

/**
 * A plain compact number — no currency at all.
 * `40600000` -> `40.6M`. Unchanged; the design is already correct.
 */
export function formatCompactNumber(amount: number | null | undefined): string {
  if (isMissing(amount)) return MISSING;
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(Number(amount));
}

/**
 * A percentage.
 *
 * EXPECTS A FRACTION: `0.68` renders `68%`. Passing `68` renders `6,800%`.
 * The behaviour is unchanged — this note exists because two call sites pass
 * fields named `pct` and `prob` whose scale was not verified during the
 * audit, and they are flagged in the migration report rather than altered.
 */
export function formatPercent(value: number | null | undefined): string {
  if (isMissing(value)) return MISSING;
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(Number(value));
}

// ── Class names ────────────────────────────────────────────────────────

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

// ── Dates ──────────────────────────────────────────────────────────────
//
// PRESERVED, NOT ENDORSED. No file in the live tree imports either of these
// from here — every consumer uses `lib/dateFormat`, which renders the
// platform's locked `1 August 2026` format. These render DD/MM/YYYY, which
// contradicts that rule.
//
// They are kept because removing an export is a breaking change and was not
// part of this task. Retiring them is recommended separately.

/** Format any date string (YYYY-MM-DD or ISO) as DD/MM/YYYY */
export function formatDate(dateStr: string): string {
  if (!dateStr) return MISSING;
  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Parse DD/MM/YYYY or YYYY-MM-DD into YYYY-MM-DD for <input type="date"> */
export function toInputDate(dateStr: string): string {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [dd, mm, yyyy] = dateStr.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  return dateStr;
}
