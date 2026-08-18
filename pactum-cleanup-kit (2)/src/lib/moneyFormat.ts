/**
 * Compact money for dense tables.
 * Destination: src/lib/moneyFormat.ts
 *
 * WHY THIS EXISTS
 *   The delay register carries 14 columns. On a 1568px screen that leaves
 *   roughly 88px per column, while "SAR 40,600,000" needs about 133px at
 *   12px type — so the table already scrolled sideways before any of the
 *   type was enlarged. Growing the font without shortening the number
 *   would have made that worse.
 *
 *   Abbreviating reclaims ~45% of the column, which buys the larger,
 *   readable type. The exact figure is never lost: callers put the full
 *   string in a `title` attribute, so hovering a cell still shows every
 *   digit, and reports print the full value.
 *
 * SCOPE
 *   Tables only. KPI tiles, cards and the executive ribbon keep the full
 *   number — there is room there, and rounding a headline figure would be
 *   hiding information rather than compressing it.
 *
 * This module adds a formatter. It does not modify `formatMoney`, which
 * every other surface still uses unchanged.
 */

/** Thousands separators, no decimals. Matches the platform's own style. */
function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * `40,600,000` -> `40.6M` · `3,000,000,000,000` -> `3T` · `786,828` -> `787K`
 *
 * Two significant decimals below 10 units, one above, none over 100 — the
 * precision a reader can actually use at a glance. Zero stays "0" rather
 * than "0.0M", and a value under 1000 is shown in full.
 */
export function abbrevMoney(value: unknown): string {
  // Number(null) is 0, which would print a confident "0" for a missing
  // figure. Absent and zero are different facts and must look different.
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';

  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);

  const scale = (div: number, suffix: string) => {
    const v = a / div;
    const dp = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    // Trim a trailing ".0" / ".00" so the column stays tidy.
    return sign + v.toFixed(dp).replace(/\.0+$/, '') + suffix;
  };

  // A group portfolio genuinely reaches trillions; without this tier a
  // trillion rendered as "3000B", which is harder to read than the raw
  // number it was meant to simplify.
  if (a >= 1e12) return scale(1e12, 'T');
  if (a >= 1e9) return scale(1e9, 'B');
  if (a >= 1e6) return scale(1e6, 'M');
  if (a >= 1e3) return scale(1e3, 'K');
  return sign + grouped(a);
}

/**
 * A KPI-sized amount: `SAR 3.0T` · `AED 40.6M` · `EUR 787K`.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY A HEADLINE FIGURE MUST BE ABBREVIATED
 *
 * `formatMoney` prints every digit, which is right in a ledger row where
 * the exact number is the point. In a KPI tile it is not: measured on a
 * real project, `SAR 3,000,000,000,000` ran the width of the card, forced
 * the label away from its value, and still could not be read at a glance
 * — thirteen digits with no visual grouping a person can hold.
 *
 * The exact figure is never lost. Every caller pairs this with
 * `exactMoney` in a `title`, so hovering gives the full number.
 * ══════════════════════════════════════════════════════════════════════
 */
export function kpiMoney(value: unknown, currency: string): string {
  const short = abbrevMoney(value);
  if (short === '\u2014') return short;
  const c = String(currency ?? '').trim();
  return c ? `${c} ${short}` : short;
}

/**
 * The full, unabbreviated string — for `title` attributes and exports.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CURRENCY IS REQUIRED, AND MAY BE EMPTY.
 *
 * This read `currency = 'SAR'`. Twenty call sites passed nothing, so the
 * tooltip behind an abbreviated figure — the very place a reader goes to
 * check the exact amount — printed a confident "SAR" over euros,
 * dirhams and dollars alike.
 *
 * Making the parameter REQUIRED lets the compiler find every site, which
 * is how the remaining ones were located rather than guessed at. Passing
 * '' is still allowed and emits the bare number: unlabelled is honest,
 * mislabelled is not. It never invents SAR again.
 * ══════════════════════════════════════════════════════════════════════
 */
export function exactMoney(value: unknown, currency: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const c = String(currency ?? '').trim();
  return c ? `${c} ${grouped(n)}` : grouped(n);
}

/**
 * Everything a dense money cell needs:
 *   <td className="money" title={cell.title}>{cell.text}</td>
 */
export function moneyCell(value: unknown, currency = 'SAR'): { text: string; title: string } {
  return { text: abbrevMoney(value), title: exactMoney(value, currency) };
}
