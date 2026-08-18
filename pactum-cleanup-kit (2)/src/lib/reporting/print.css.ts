/**
 * Report stylesheet.
 * Destination: src/lib/reporting/print.css.ts
 *
 * Exported as a string so the engine can inject it into a print window
 * without a build step or a network request. It reuses the platform's
 * palette and type scale verbatim — a report and its screen are the same
 * design language on two media.
 */

export const REPORT_CSS = String.raw`
:root{
  --r-bg:#121414; --r-surface:#1b1c1c; --r-surface-2:#2a2b2b; --r-well:#0d0e0f;
  --r-ink:#ECEAE5; --r-muted:#8b8a86; --r-gold:#d4af37;
  --r-ok:#6f9b78; --r-warn:#c08a3e; --r-risk:#a85450;
  --r-line:rgba(212,175,55,.16); --r-hair:rgba(212,175,55,.07);
  --r-serif:'IBM Plex Serif','Amiri',Georgia,serif;
  --r-sans:'Tajawal','Inter',-apple-system,'Segoe UI',sans-serif;
  --r-mono:'IBM Plex Mono',ui-monospace,monospace;
}

*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--r-bg);color:var(--r-ink);
  font-family:var(--r-sans);-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* ── Page ─────────────────────────────────────────────────────────────
   The sheet is a real element on screen and a real page in print, so the
   preview is honest about where content breaks. */
.r-page{
  position:relative;
  width:210mm; height:297mm;
  margin:0 auto 8mm; padding:18mm 16mm 22mm;
  background:var(--r-bg);
  box-shadow:0 8px 32px rgba(0,0,0,.6);
  page-break-after:always; break-after:page;
  overflow:hidden;
}
.r-page:last-child{page-break-after:auto; break-after:auto; margin-bottom:0}
.r-land .r-page{width:297mm; height:210mm; padding:14mm 16mm 20mm}

/* ── Paginated sheets ──────────────────────────────────────────
   Real sheets again, built by paginate.ts AFTER measuring. The height is
   fixed so one sheet is one page and the number is honest; nothing is
   lost to it, because the script never puts more on a page than fits.

   ".r-page-tall" is the escape hatch: a single block that cannot fit any
   page keeps its height and is allowed to spill. An awkward break is
   recoverable; a clipped section is not. */
#r-src{display:none}
.r-page-content{position:relative; z-index:1}
.r-page-tall{height:auto; min-height:297mm}
.r-land .r-page-tall{height:auto; min-height:210mm}
/* A grown page must keep its footer at the true bottom, not at 297mm. */
.r-page-tall .r-foot{position:static; margin-top:6mm}

/* A hard break requested by a definition. Consumed by paginate.ts. */
.r-break-marker{display:none}

/* ── Watermark — centred, behind everything, every page ─────────────── */
.r-wm{
  position:absolute; inset:0; z-index:0; pointer-events:none;
  display:flex; align-items:center; justify-content:center;
}
.r-wm span{
  width:118mm; aspect-ratio:1.1915/1;
  background-color:var(--r-gold);
  -webkit-mask-size:contain; mask-size:contain;
  -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
  -webkit-mask-position:center; mask-position:center;
  opacity:.040;
}

/* ── Header ───────────────────────────────────────────────────────────
   Identical on every report. The gold rule under it is the signature. */
.r-head{display:flex; align-items:flex-start; justify-content:space-between;
  gap:8mm; padding-bottom:4mm; border-bottom:1.5px solid var(--r-gold); margin-bottom:6mm}
.r-head-l{display:flex; align-items:flex-start; gap:5mm; min-width:0}
.r-logo{width:16mm; flex:0 0 auto; color:var(--r-gold)}
.r-logo svg{width:100%; height:auto; display:block}
.r-eyebrow{font-family:var(--r-mono); font-size:6.5pt; letter-spacing:.22em;
  text-transform:uppercase; color:var(--r-gold); margin-bottom:1.5mm}
.r-title{font-family:var(--r-serif); font-size:17pt; line-height:1.15; font-weight:600}
.r-sub{font-size:8pt; color:var(--r-muted); margin-top:1mm}
.r-head-r{text-align:end; flex:0 0 auto}
.r-meta{font-family:var(--r-mono); font-size:6.5pt; line-height:1.75; color:var(--r-muted)}
.r-meta b{color:var(--r-ink); font-weight:500}
.r-chip{display:inline-block; font-family:var(--r-mono); font-size:6.5pt;
  color:var(--r-gold); border:1px solid var(--r-line); background:rgba(212,175,55,.07);
  padding:.6mm 2mm; margin-top:1.5mm}

/* ── Footer — fixed to the sheet, repeats on every page ─────────────── */
/* PINNED TO THE SHEET, NOT FLOWING AFTER THE CONTENT.
   An earlier edit dropped position:absolute while the layout was
   table-based. With real sheets back it must be pinned again, otherwise
   it sits below the content: measured at 400mm on a 297mm sheet, so it
   printed off the page and only the first two sheets showed a number. */
.r-foot{
  position:absolute; left:16mm; right:16mm; bottom:10mm; z-index:2;
  display:flex; align-items:center; justify-content:space-between; gap:4mm;
  padding-top:2.5mm; border-top:1px solid var(--r-hair);
  font-family:var(--r-mono); font-size:6pt; color:var(--r-muted); letter-spacing:.08em}
.r-foot b{color:var(--r-gold); font-weight:600; letter-spacing:.18em}
.r-foot .r-pageno{white-space:nowrap}
/* The page number is written by paginate.ts once the sheets exist and
   have been counted. CSS counters were tried first: Chrome returns 0 for
   counter(pages), which is what produced "Page 0 of 0". */

/* ── Cover ────────────────────────────────────────────────────────────*/
/* THE COVER RESERVED MORE HEIGHT THAN A LANDSCAPE SHEET HAS.
   "min-height:225mm" was written for portrait, whose content box is
   257mm. A landscape sheet offers 176mm, so on every landscape report
   the cover alone overflowed by ~49mm and pushed its own footer onto a
   second sheet — which is exactly the "page 2 contains only a footer"
   symptom in the PDF.
   "height:100%" fills whichever sheet it is on and overflows neither. */
.r-cover{display:flex; flex-direction:column; align-items:center;
  justify-content:center; text-align:center; height:100%}
.r-cover-logo{width:46mm; color:var(--r-gold); margin-bottom:10mm}
.r-cover-logo svg{width:100%; height:auto; display:block}
.r-cover-title{font-family:var(--r-serif); font-size:30pt; line-height:1.1;
  letter-spacing:.02em; margin-bottom:3mm}
.r-cover-sub{font-size:10pt; color:var(--r-muted); letter-spacing:.16em;
  text-transform:uppercase; margin-bottom:12mm}
.r-cover-rule{width:60mm; height:1px; background:var(--r-gold); opacity:.5; margin-bottom:12mm}
.r-cover-grid{display:grid; grid-template-columns:auto auto; gap:2.5mm 10mm;
  font-size:8.5pt; text-align:start}
.r-cover-grid dt{font-family:var(--r-mono); font-size:6.5pt; letter-spacing:.16em;
  text-transform:uppercase; color:var(--r-muted); align-self:center}
.r-cover-grid dd{margin:0; color:var(--r-ink)}
.r-conf{margin-top:14mm; font-family:var(--r-mono); font-size:7pt; letter-spacing:.22em;
  text-transform:uppercase; color:var(--r-warn);
  border:1px solid rgba(192,138,62,.35); background:rgba(192,138,62,.08); padding:2mm 5mm}

/* ── Table of contents ───────────────────────────────────────────────*/
.r-toc{list-style:none; padding:0; margin:0}
.r-toc li{display:flex; align-items:baseline; gap:2mm; padding:2mm 0;
  border-bottom:1px solid var(--r-hair); font-size:9pt}
.r-toc .r-toc-dots{flex:1; border-bottom:1px dotted rgba(212,175,55,.28)}
.r-toc .r-toc-n{font-family:var(--r-mono); font-size:7pt; color:var(--r-gold); min-width:6mm}

/* ── Section shell ───────────────────────────────────────────────────*/
.r-sec{margin-bottom:6mm; break-inside:avoid}
.r-sec-h{display:flex; align-items:center; gap:3mm; margin-bottom:3mm;
  font-family:var(--r-serif); font-style:italic; font-size:10pt;
  letter-spacing:.14em; text-transform:uppercase; color:var(--r-gold)}
.r-sec-h::after{content:''; flex:1; height:1px; background:var(--r-hair)}

/* ── Executive summary ───────────────────────────────────────────────*/
.r-summary{background:var(--r-surface); border:1px solid var(--r-line);
  border-top:2px solid var(--r-gold); padding:5mm; font-size:9pt; line-height:1.75}

/* ── KPI grid ────────────────────────────────────────────────────────*/
.r-kpi{display:grid; gap:.6mm; background:var(--r-line); border:1px solid var(--r-line)}
.r-kpi-c{background:var(--r-surface); padding:3.5mm 4mm}
.r-kpi-k{font-size:6pt; letter-spacing:.14em; text-transform:uppercase;
  color:var(--r-muted); margin-bottom:1.5mm}
.r-kpi-v{font-family:var(--r-serif); font-variant-numeric:tabular-nums;
  font-size:14pt; line-height:1.1; direction:ltr; unicode-bidi:isolate}
.r-kpi-u{font-size:6pt; color:var(--r-muted); margin-top:.8mm; letter-spacing:.1em}

/* ── Info grid ───────────────────────────────────────────────────────*/
.r-info{display:grid; gap:.6mm; background:var(--r-line); border:1px solid var(--r-line)}
.r-info-c{background:var(--r-surface); padding:3mm 4mm}
.r-info-k{font-size:6pt; letter-spacing:.14em; text-transform:uppercase;
  color:var(--r-muted); margin-bottom:1mm}
.r-info-v{font-size:9pt}

/* ── Tables — the heart of every report ──────────────────────────────*/
.r-table{width:100%; border-collapse:collapse; font-size:7.5pt;
  border:1px solid var(--r-line)}
.r-table thead{display:table-header-group}      /* repeats on every page */
.r-table tfoot{display:table-footer-group}
.r-table tr{break-inside:avoid; page-break-inside:avoid}
.r-table th{background:var(--r-surface-2); color:var(--r-gold);
  font-size:6pt; letter-spacing:.13em; text-transform:uppercase; font-weight:600;
  padding:2.2mm 2.5mm; text-align:start; border-bottom:1px solid var(--r-line);
  white-space:nowrap}
.r-table td{padding:1.9mm 2.5mm; border-bottom:1px solid var(--r-hair);
  vertical-align:middle; line-height:1.45}
.r-table tbody tr:nth-child(even){background:rgba(255,255,255,.016)}
.r-table tfoot td{background:var(--r-surface-2); border-top:1px solid var(--r-line);
  font-size:6.5pt; text-transform:uppercase; letter-spacing:.1em; color:var(--r-muted);
  border-bottom:0}
.r-money{font-family:var(--r-serif); font-variant-numeric:tabular-nums;
  direction:ltr; unicode-bidi:isolate; text-align:right; white-space:nowrap}
th.r-money{text-align:right}
.r-note{font-size:6.5pt; color:var(--r-muted); margin-top:2mm; font-style:italic}

/* ── Status pill ─────────────────────────────────────────────────────*/
.r-pill{display:inline-block; font-size:5.8pt; font-weight:700; letter-spacing:.12em;
  text-transform:uppercase; padding:.5mm 1.8mm; border:1px solid; border-radius:6mm;
  white-space:nowrap}
.r-ok{color:var(--r-ok); background:rgba(111,155,120,.12); border-color:rgba(111,155,120,.32)}
.r-warn{color:var(--r-warn); background:rgba(192,138,62,.12); border-color:rgba(192,138,62,.32)}
.r-risk{color:var(--r-risk); background:rgba(168,84,80,.12); border-color:rgba(168,84,80,.32)}
.r-neutral{color:var(--r-muted); background:rgba(255,255,255,.04); border-color:rgba(255,255,255,.12)}
.r-gold{color:var(--r-gold); background:rgba(212,175,55,.1); border-color:rgba(212,175,55,.32)}
.t-gold{color:var(--r-gold)} .t-ok{color:var(--r-ok)}
.t-warn{color:var(--r-warn)} .t-risk{color:var(--r-risk)}

/* ── Timeline ────────────────────────────────────────────────────────*/
.r-tl{border-inline-start:1px solid var(--r-line); padding-inline-start:5mm; margin-inline-start:2mm}
.r-tl-i{position:relative; padding-bottom:4mm; break-inside:avoid}
.r-tl-i:last-child{padding-bottom:0}
.r-tl-i::before{content:''; position:absolute; inset-inline-start:-6.4mm; top:1.2mm;
  width:2.4mm; height:2.4mm; border-radius:50%; background:var(--r-gold)}
.r-tl-l{font-size:8.5pt; margin-bottom:.8mm}
.r-tl-m{font-family:var(--r-mono); font-size:6.5pt; color:var(--r-muted); letter-spacing:.08em}

/* ── Bars ────────────────────────────────────────────────────────────*/
.r-bar-row{margin-bottom:3.5mm; break-inside:avoid}
.r-bar-h{display:flex; justify-content:space-between; font-size:7pt;
  color:var(--r-muted); margin-bottom:1.2mm; letter-spacing:.06em}
.r-bar{height:2.4mm; background:var(--r-well); border:1px solid var(--r-hair); overflow:hidden}
.r-bar i{display:block; height:100%; background:var(--r-gold)}

/* ── Risk matrix ─────────────────────────────────────────────────────*/
.r-risk-m{border-collapse:collapse; width:100%; font-size:6.5pt}
.r-risk-m td,.r-risk-m th{border:1px solid var(--r-hair); padding:2mm; text-align:center;
  height:11mm; vertical-align:middle}
.r-risk-m th{background:var(--r-surface-2); color:var(--r-gold); font-size:5.8pt;
  letter-spacing:.1em; text-transform:uppercase; height:auto}
.r-rc-l{background:rgba(111,155,120,.14)}
.r-rc-m{background:rgba(192,138,62,.14)}
.r-rc-h{background:rgba(168,84,80,.16)}
.r-rc-tag{display:block; font-size:5.6pt; color:var(--r-ink); line-height:1.3}

/* ── Signatures ──────────────────────────────────────────────────────*/
.r-sign{display:grid; gap:8mm; margin-top:4mm; break-inside:avoid}
.r-sign-c{padding-top:14mm; border-top:1px solid var(--r-line)}
.r-sign-r{font-family:var(--r-mono); font-size:6.5pt; letter-spacing:.14em;
  text-transform:uppercase; color:var(--r-gold)}
.r-sign-n{font-size:8.5pt; margin-top:1.5mm}
.r-sign-d{font-family:var(--r-mono); font-size:6pt; color:var(--r-muted); margin-top:1mm}

/* ── Appendix ────────────────────────────────────────────────────────*/
.r-appendix{font-size:8pt; line-height:1.8; color:var(--r-muted);
  background:var(--r-surface); border:1px solid var(--r-hair); padding:4mm}

/* ── Break behaviour ────────────────────────────────────────
   A section is kept together when it fits; a heading never sits alone at
   the foot of a sheet; a table repeats its header across a break. */
.r-sec{break-inside:avoid; page-break-inside:avoid}
.r-sec-h{break-after:avoid; page-break-after:avoid}
.r-table thead{display:table-header-group}
.r-table tfoot{display:table-footer-group}
.r-table tr{break-inside:avoid; page-break-inside:avoid}
.r-kpi-c,.r-info-c{break-inside:avoid; page-break-inside:avoid}
/* The contents list is long by nature — let it flow rather than clip. */
.r-toc{break-inside:auto; page-break-inside:auto}
.r-toc li{break-inside:avoid; page-break-inside:avoid}

/* ── Print ───────────────────────────────────────────────────────────*/
@page{size:A4 portrait; margin:0}
@page:first{margin:0}
.r-land{}
/* Screen-only spacer that clears the fixed preview toolbar. */
.r-toolbar-gap{height:42px}
@media print{
  html,body{background:#fff}
  .r-page{margin:0; box-shadow:none; break-after:page}

  .r-page:last-child{break-after:auto}
  .r-toolbar{display:none !important}
  /* THE BLANK FIRST SHEET.
     The toolbar is hidden in print, but its 42px spacer was an inline
     style and stayed. 42px of leading content pushed page 1 down, so the
     first physical sheet came out empty and every later page shifted by
     one. Hiding the spacer with the toolbar it belongs to removes it. */
  .r-toolbar-gap{display:none !important}
}
`;

/** Landscape needs its own @page rule; the engine appends this when asked. */
export const REPORT_CSS_LANDSCAPE = String.raw`
@page{size:A4 landscape; margin:0}
/* Fixed, not a minimum — same reasoning as the portrait rule above. This
   is the block that governs Financial Intelligence and every other
   landscape report. */
.r-page{width:297mm; height:210mm; padding:14mm 16mm 20mm}
`;
