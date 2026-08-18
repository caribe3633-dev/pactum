/**
 * Global date presentation.
 * Destination: src/lib/dateFormat.ts
 *
 * ONE format everywhere: `1 August 2026`.
 *
 * Numeric orders are ambiguous across regions — 01/08/2026 is 1 August to a
 * British reader and 8 January to an American one. Spelling the month out
 * removes the ambiguity entirely, which matters on contract dates.
 *
 * Storage is untouched: values stay ISO (`2026-08-01`) or legacy DD/MM/YYYY.
 * This module only changes what the user sees.
 */

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** Parses ISO `YYYY-MM-DD` or legacy `DD/MM/YYYY`. Returns null when unusable. */
export function parseAnyDate(value?: string | null): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  // ISO first — this is what everything new writes.
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d };
    return null;
  }

  // Legacy DD/MM/YYYY, written by the older EditableDate.
  match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const d = Number(match[1]), m = Number(match[2]), y = Number(match[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d };
    return null;
  }

  return null;
}

/**
 * `1 August 2026`. Unparseable input is returned untouched rather than
 * replaced with a dash — a hand-typed note is better shown than swallowed.
 */
export function formatDate(value?: string | null, lang: 'en' | 'ar' = 'en'): string {
  const p = parseAnyDate(value);
  if (!p) return value ? String(value) : '';
  const months = lang === 'ar' ? MONTHS_AR : MONTHS_EN;
  return `${p.d} ${months[p.m - 1]} ${p.y}`;
}

/** Same, but an empty or unparseable value shows an em dash. For table cells. */
export function formatDateOrDash(value?: string | null, lang: 'en' | 'ar' = 'en'): string {
  const out = formatDate(value, lang);
  return out || '—';
}

/** `August 2026` — month and year only, for window labels. */
export function formatMonthYear(year: number, month: number, lang: 'en' | 'ar' = 'en'): string {
  const months = lang === 'ar' ? MONTHS_AR : MONTHS_EN;
  return `${months[month - 1]} ${year}`;
}

/** ISO `YYYY-MM-DD` for `<input type="date">`. Accepts either stored format. */
export function toInputDate(value?: string | null): string {
  const p = parseAnyDate(value);
  if (!p) return '';
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Timestamp for logs: `1 August 2026, 14:32`. */
export function formatDateTime(iso?: string | null, lang: 'en' | 'ar' = 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const date = formatDate(d.toISOString().slice(0, 10), lang);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date}, ${hh}:${mm}`;
}
