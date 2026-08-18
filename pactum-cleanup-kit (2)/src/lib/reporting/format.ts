/**
 * Report formatting.
 * Destination: src/lib/reporting/format.ts
 *
 * Thin wrappers over the platform's own helpers so a report can never drift
 * from the screen it mirrors. No new number or date rules are invented here.
 */

import { formatDate } from '../dateFormat';

/**
 * Grouped, no decimals — the platform convention.
 *
 * Deliberately UNLABELLED. A report states its currency once, in the
 * section header or the unit field, rather than repeating a code on every
 * figure in a column. That is also why this function takes no currency: it
 * has no label to get wrong.
 */
export function money(v: unknown): string {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * A labelled amount, for the rare place a figure stands alone.
 *
 * ── SPRINT 4 · THE DEFAULT IS GONE ────────────────────────────────────
 *
 * This used to read `currency = 'SAR'`. A caller that forgot the argument
 * therefore printed a confident, wrong unit — the exact failure Sprint 2B
 * spent 133 call sites eliminating on screen, still latent here.
 *
 * The parameter is now REQUIRED and may be empty. An empty currency emits
 * the bare number, which is honest: the figure is unlabelled because
 * nobody said what it was. It never invents SAR.
 */
export function moneyWithCurrency(v: unknown, currency: string): string {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  const c = String(currency ?? '').trim();
  return c ? `${c} ${money(n)}` : money(n);
}

/**
 * @deprecated Use `moneyWithCurrency(value, currency)`.
 *
 * SPRINT 4: the name is a lie in a multi-currency platform, and the
 * SAR default has been removed with it. Retained only so no import
 * breaks; it has no callers in the live tree.
 */
export function moneySar(v: unknown, currency: string): string {
  return moneyWithCurrency(v, currency);
}

export function percent(v: unknown, alreadyScaled = false): string {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return `${(alreadyScaled ? n : n * 100).toFixed(1)}%`;
}

export function days(v: unknown): string {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return `${n}d`;
}

/** 1 August 2026 — the one global format. */
export function reportDate(v?: string | null, lang: 'en' | 'ar' = 'en'): string {
  const out = formatDate(v ?? '', lang);
  return out || '—';
}

export function reportDateTime(iso: string, lang: 'en' | 'ar' = 'en'): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${reportDate(d.toISOString().slice(0, 10), lang)} · ${time}`;
}

/** Cell value for a table column, honouring its declared type. */
export function cell(value: unknown, opts: { money?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  if (opts.money) return money(value);
  return String(value);
}
