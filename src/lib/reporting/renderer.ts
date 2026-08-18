/**
 * PDF / print renderer.
 * Destination: src/lib/reporting/renderer.ts
 *
 * Turns a ReportDocument into HTML. It knows about pages, tables and pills —
 * nothing about delays, claims or cash flow. Swap this file for an Excel
 * writer and every existing report keeps working.
 */

import { ReportDocument, Section, Column } from './types';
import { REPORT_CSS, REPORT_CSS_LANDSCAPE } from './print.css';
import { PAGINATE_JS } from './paginate';
import { money, cell, reportDate, reportDateTime } from './format';

// ── The brand mark ────────────────────────────────────────────────────
//
// Imported, never re-drawn. This file used to carry its own hand-copied
// copy of the logo geometry; a duplicate that happens to match today is
// invisible until somebody redraws the brand and only the printed
// reports keep the old mark. `brandMark.ts` is now the single source and
// `PactumLogo.tsx` reads the same module.
import { markSvg, lockupSvg } from './brandMark';

const MARK = markSvg();
const LOCKUP = lockupSvg();

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const tone = (t?: string) =>
  t === 'gold' ? 't-gold' : t === 'ok' ? 't-ok' : t === 'warn' ? 't-warn' : t === 'risk' ? 't-risk' : '';

/** Maps a free-text status onto the platform's status palette. */
function pill(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '—';
  const k = s.toLowerCase();
  const cls =
    /approved|paid|complete|active|certified|on track|closed/.test(k) ? 'r-ok'
    : /rejected|critical|overdue|breach|high/.test(k) ? 'r-risk'
    : /review|pending|submitted|identified|paused|delayed|med/.test(k) ? 'r-warn'
    : /auto|generated/.test(k) ? 'r-gold'
    : 'r-neutral';
  return `<span class="r-pill ${cls}">${esc(s)}</span>`;
}

// ── Sections ───────────────────────────────────────────────────────────

function renderTable(s: Extract<Section, { kind: 'table' }>): string {
  const head = s.columns.map((c: Column) =>
    `<th class="${c.money ? 'r-money' : ''}"${c.width ? ` style="width:${c.width}%"` : ''}>${esc(c.label)}</th>`
  ).join('');

  const body = s.rows.length
    ? s.rows.map(row => '<tr>' + s.columns.map(c => {
        const raw = row[c.key];
        if (c.status) return `<td>${pill(raw)}</td>`;
        const cls = c.money ? 'r-money' : c.align === 'center' ? 'style="text-align:center"' : '';
        return `<td class="${c.money ? 'r-money' : ''}">${esc(cell(raw, { money: c.money }))}</td>`;
      }).join('') + '</tr>').join('')
    : `<tr><td colspan="${s.columns.length}" style="text-align:center;padding:8mm;color:var(--r-muted);font-style:italic">No records.</td></tr>`;

  const foot = s.total
    ? `<tfoot><tr><td colspan="${s.total.span ?? 1}">${esc(s.total.label)}</td>` +
      s.columns.slice(s.total.span ?? 1).map(c => {
        const v = s.total!.values[c.key];
        return `<td class="${c.money ? 'r-money' : ''}">${v === undefined ? '' : esc(cell(v, { money: c.money }))}</td>`;
      }).join('') + '</tr></tfoot>'
    : '';

  return `<table class="r-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`
    + (s.note ? `<p class="r-note">${esc(s.note)}</p>` : '');
}

function renderSection(s: Section, lang: 'en' | 'ar'): string {
  const h = (t?: string) => (t ? `<div class="r-sec-h">${esc(t)}</div>` : '');

  switch (s.kind) {
    case 'summary':
      return `<div class="r-sec">${h(s.title)}<div class="r-summary">${esc(s.text)}</div></div>`;

    case 'kpi': {
      const n = s.columns ?? Math.min(s.items.length, 4);
      const cells = s.items.map(k =>
        `<div class="r-kpi-c"><div class="r-kpi-k">${esc(k.label)}</div>
         <div class="r-kpi-v ${tone(k.tone)}">${esc(k.value)}</div>
         ${k.unit || k.note ? `<div class="r-kpi-u">${esc(k.unit ?? k.note)}</div>` : ''}</div>`).join('');
      return `<div class="r-sec">${h(s.title)}
        <div class="r-kpi" style="grid-template-columns:repeat(${n},1fr)">${cells}</div></div>`;
    }

    case 'info': {
      const n = s.columns ?? 3;
      const cells = s.items.map(i =>
        `<div class="r-info-c"><div class="r-info-k">${esc(i.label)}</div>
         <div class="r-info-v ${tone(i.tone)}">${esc(i.value)}</div></div>`).join('');
      return `<div class="r-sec">${h(s.title)}
        <div class="r-info" style="grid-template-columns:repeat(${n},1fr)">${cells}</div></div>`;
    }

    case 'table':
      return `<div class="r-sec">${h(s.title)}${renderTable(s)}</div>`;

    case 'timeline': {
      const items = s.items.map(i =>
        `<div class="r-tl-i"><div class="r-tl-l ${tone(i.tone)}">${esc(i.label)}</div>
         <div class="r-tl-m">${[i.date ? reportDate(i.date, lang) : '', i.value ?? '', i.note ?? '']
           .filter(Boolean).map(esc).join(' · ')}</div></div>`).join('');
      return `<div class="r-sec">${h(s.title)}<div class="r-tl">${items}</div></div>`;
    }

    case 'bars': {
      const rows = s.items.map(b =>
        `<div class="r-bar-row"><div class="r-bar-h"><span>${esc(b.label)}</span>
         <span class="${tone(b.tone)}">${esc(b.value ?? '')}</span></div>
         <div class="r-bar"><i style="width:${Math.max(0, Math.min(1, b.ratio)) * 100}%"></i></div></div>`).join('');
      return `<div class="r-sec">${h(s.title)}${rows}</div>`;
    }

    case 'risk': {
      const at = (p: number, i: number) => s.cells.filter(c => c.probability === p && c.impact === i);
      let grid = '<tr><th></th>' + [1, 2, 3, 4, 5].map(i => `<th>Impact ${i}</th>`).join('') + '</tr>';
      for (let p = 5; p >= 1; p--) {
        grid += `<tr><th>Prob ${p}</th>` + [1, 2, 3, 4, 5].map(i => {
          const score = p * i;
          const cls = score >= 15 ? 'r-rc-h' : score >= 6 ? 'r-rc-m' : 'r-rc-l';
          const tags = at(p, i).map(c => `<span class="r-rc-tag">${esc(c.label)}</span>`).join('');
          return `<td class="${cls}">${tags}</td>`;
        }).join('') + '</tr>';
      }
      return `<div class="r-sec">${h(s.title)}<table class="r-risk-m">${grid}</table></div>`;
    }

    case 'signature': {
      const cols = s.signatories.map(g =>
        `<div class="r-sign-c"><div class="r-sign-r">${esc(g.role)}</div>
         <div class="r-sign-n">${esc(g.name ?? '')}</div>
         <div class="r-sign-d">${g.date ? reportDate(g.date, lang) : 'Date: ____________'}</div></div>`).join('');
      return `<div class="r-sec">${h(s.title)}
        <div class="r-sign" style="grid-template-columns:repeat(${Math.min(s.signatories.length, 3)},1fr)">${cols}</div></div>`;
    }

    case 'appendix':
      return `<div class="r-sec">${h(s.title)}<div class="r-appendix">${esc(s.text)}</div></div>`;

    case 'pagebreak':
      return '<!--PAGEBREAK-->';
  }
}

// ── Chrome ─────────────────────────────────────────────────────────────

function header(doc: ReportDocument, lang: 'en' | 'ar'): string {
  const m = doc.meta;
  const trail = [m.company, m.sector, m.project].filter(Boolean).map(esc).join(' › ');
  return `<div class="r-head">
    <div class="r-head-l">
      <div class="r-logo">${MARK}</div>
      <div style="min-width:0">
        <div class="r-eyebrow">PACTUM · CONTRACT INTELLIGENCE</div>
        <div class="r-title">${esc(m.title)}</div>
        ${m.subtitle ? `<div class="r-sub">${esc(m.subtitle)}</div>` : ''}
        ${trail ? `<div class="r-sub">${trail}</div>` : ''}
      </div>
    </div>
    <div class="r-head-r">
      <div class="r-meta">
        <div>Generated by <b>${esc(m.generatedBy)}</b></div>
        <div>${esc(reportDateTime(m.generatedAt, lang))}</div>
        ${/* SPRINT 4 — the unit, stated once per page, in the report's OWN
             currency. Omitted when the document declares none: an absent
             line is honest, a defaulted "SAR" is a false assertion. */ ''}
        ${m.currency ? `<div>Currency <b>${esc(m.currency)}</b></div>` : ''}
        <div>Report v${esc(m.version)} · System v${esc(m.systemVersion)}</div>
      </div>
      ${m.reference ? `<div class="r-chip">${esc(m.reference)}</div>` : ''}
    </div>
  </div>`;
}

/**
 * The running footer.
 *
 * `page` / `total` arguments are gone: with a flowing document the engine
 * decides how many sheets there are, so the numbers are printed by CSS
 * counters (`counter(page)` / `counter(pages)`) instead of being guessed
 * here. Passing a number this file cannot know would be a fabrication.
 */
function footer(doc: ReportDocument, lang: 'en' | 'ar'): string {
  return `<div class="r-foot">
    <span><b>PACTUM</b> · © Mohamed Mohsen</span>
    <span>${esc(reportDateTime(doc.meta.generatedAt, lang))} · v${esc(doc.meta.systemVersion)}</span>
    <span class="r-pageno"></span>
  </div>`;
}

function watermark(art: string): string {
  return art
    ? `<div class="r-wm" aria-hidden="true"><span style="-webkit-mask-image:url('${art}');mask-image:url('${art}')"></span></div>`
    : '';
}

function cover(doc: ReportDocument, lang: 'en' | 'ar'): string {
  const m = doc.meta;
  const row = (k: string, v?: string) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '');
  return `<div class="r-cover">
    <div class="r-cover-logo" style="color:var(--r-gold)">${LOCKUP}</div>
    <div class="r-cover-title">${esc(m.title)}</div>
    <div class="r-cover-sub">${esc(m.subtitle ?? 'Enterprise Report')}</div>
    <div class="r-cover-rule"></div>
    <dl class="r-cover-grid">
      ${row('Company', m.company)}
      ${row('Sector', m.sector)}
      ${row('Project', m.project)}
      ${row('Reference', m.reference)}
      ${row('Reporting currency', m.currency)}
      ${row('Generated by', m.generatedBy)}
      ${row('Date', reportDateTime(m.generatedAt, lang))}
      ${row('Report version', m.version)}
    </dl>
    ${m.confidentiality ? `<div class="r-conf">${esc(m.confidentiality)}</div>` : ''}
  </div>`;
}

function toc(doc: ReportDocument): string {
  const titled = doc.sections
    .map(s => ('title' in s ? s.title : undefined))
    .filter((t): t is string => Boolean(t));
  if (!titled.length) return '';
  const items = titled.map((t, i) =>
    `<li><span class="r-toc-n">${String(i + 1).padStart(2, '0')}</span>
     <span>${esc(t)}</span><span class="r-toc-dots"></span></li>`).join('');
  return `<div class="r-sec"><div class="r-sec-h">Contents</div><ol class="r-toc">${items}</ol></div>`;
}

// ── Public API ─────────────────────────────────────────────────────────

export interface RenderOptions {
  lang?: 'en' | 'ar';
  /** data: URI of the approved watermark artwork. */
  watermarkArt?: string;
  /** Adds a screen-only toolbar. Suppressed in print. */
  toolbar?: boolean;
}

/**
 * A complete, self-contained HTML document. No external assets.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PAGINATION — FLOWING, NOT FIXED
 *
 * THE DEFECT THIS REPLACES
 *
 *   Every section became one `.r-page` of a fixed sheet height, split
 *   only on an explicit `<!--PAGEBREAK-->`. Nothing measured how tall a
 *   section actually was, and the old comment claimed "the sheet handles
 *   natural overflow" — which it never did.
 *
 *   Measured on a real Financial Intelligence report: a 23-item table of
 *   contents is roughly 250mm tall and a landscape sheet offers 176mm.
 *   With `min-height` the box simply grew and the surplus spilled onto a
 *   second physical sheet, producing pages holding nothing but a footer.
 *   Forcing a fixed height stopped the spill but CLIPPED the surplus —
 *   silently losing content, which is worse than an ugly break.
 *
 * WHAT IT DOES NOW
 *
 *   The document is one continuous flow. The browser paginates it, and
 *   the running header and footer are drawn by `@page` margin boxes, so
 *   they repeat on every sheet without being part of the flow.
 *
 *   Nothing can be clipped, because nothing is height-constrained: a
 *   section longer than a sheet simply continues onto the next.
 *
 * WHAT IS GIVEN UP, STATED PLAINLY
 *
 *   The on-screen preview no longer shows one bordered sheet per printed
 *   page — it shows a continuous document, and the true page count is
 *   known only to the print engine. `Page N of M` is therefore rendered
 *   by CSS counters rather than computed here. That is the trade the
 *   flowing model requires; the alternative is measuring every section
 *   in a live browser before choosing breaks.
 *
 *   `<!--PAGEBREAK-->` is still honoured: a definition that wants a hard
 *   break still gets one.
 * ══════════════════════════════════════════════════════════════════════
 */
export function renderReport(doc: ReportDocument, opts: RenderOptions = {}): string {
  const lang = opts.lang ?? 'en';
  const land = doc.page.orientation === 'landscape';

  /**
   * Each SECTION is its own block, and a hard break is a marker between
   * them rather than a wrapper around them.
   *
   * The first attempt wrapped everything between two `<!--PAGEBREAK-->`
   * markers in a single `.r-flow-break` div. Measured: that produced one
   * indivisible 342mm block on a 297mm sheet, so the packer could not
   * place it anywhere and the surplus was clipped. Emitting sections
   * separately gives the packer real units to work with; the marker only
   * says "start a new page here".
   */
  const sections = doc.sections.map(s => {
    if (s.kind === 'pagebreak') return '<div class="r-break-marker"></div>';
    return renderSection(s, lang);
  }).join('\n');

  const wm = watermark(opts.watermarkArt ?? '');

  // The cover keeps its own sheet — it is the one page whose height is a
  // design statement rather than a consequence of its content.
  const coverPage = doc.cover
    // The cover carries the footer too, so "Page 1 of 7" is stamped on it
    // like every other sheet. Without it the count started at 2 and the
    // first page appeared unnumbered.
    ? `<section class="r-page r-page-cover">${wm}${cover(doc, lang)}${footer(doc, lang)}</section>`
    : '';

  const tocBlock = doc.toc ? toc(doc) : '';

  /**
   * The document is emitted UNPAGINATED and a script in the page works
   * out the breaks after it renders.
   *
   * Three mechanisms were tried and measured in the target engine
   * (Chrome 131, print media) before settling here:
   *
   *   fixed sheets      exact page numbers, but CLIPPED any section
   *                     taller than a sheet — content silently lost
   *   position:fixed    repeats, but leaves the flow, so the body ran
   *                     underneath and the chrome printed at the bottom
   *   thead / tfoot     repeats correctly, but `counter(pages)` returns
   *                     0 in Chrome, so the footer read "Page 0 of 0"
   *
   * None of them gives both "nothing clipped" and a true page count,
   * because the count cannot be known without measuring rendered
   * heights — and that can only happen in a live browser.
   *
   * So the sections ship inside `#r-src`, the chrome ships as templates,
   * and `paginate.ts` packs them into real `.r-page` sheets, splitting
   * long tables and contents lists across pages with their headings
   * repeated. Numbers are stamped last, from the page count itself.
   */
  const body = `${coverPage}
    <template id="r-tpl-head">${header(doc, lang)}</template>
    <template id="r-tpl-foot">${footer(doc, lang)}</template>
    <template id="r-tpl-wm">${wm}</template>
    <div id="r-src" hidden>
      ${/* Not wrapped: the contents list is the longest block in most
            reports and MUST be splittable. Wrapping it made it one
            indivisible unit, which is what clipped it. */ ''}
      ${tocBlock}
      ${sections}
    </div>
    <div id="r-pages"></div>`;

  const bar = opts.toolbar
    ? `<div class="r-toolbar" style="position:fixed;top:0;left:0;right:0;z-index:99;
        background:#0d0e0f;border-bottom:1px solid rgba(212,175,55,.3);padding:8px 16px;
        display:flex;gap:10px;align-items:center;font:11px ui-monospace,monospace;color:#8b8a86">
        <b style="color:#d4af37;letter-spacing:.16em">PACTUM REPORT</b>
        <span>${esc(doc.meta.title)}</span>
        <button onclick="window.print()" style="margin-inline-start:auto;background:#d4af37;
          color:#000;border:0;padding:6px 16px;cursor:pointer;font:700 10px ui-monospace,monospace;
          letter-spacing:.14em">PRINT REPORT</button>
      </div><div class="r-toolbar-gap"></div>`
    : '';

  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8">
<title>${esc(doc.meta.title)} — PACTUM</title>
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Tajawal:wght@300;400;500;700&family=IBM+Plex+Serif:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${REPORT_CSS}${land ? REPORT_CSS_LANDSCAPE : ''}</style>
</head><body class="${land ? 'r-land' : ''}">${bar}${body}
<script>${PAGINATE_JS}<\/script></body></html>`;
}
