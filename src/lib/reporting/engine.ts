/**
 * Report engine — the single entry point.
 * Destination: src/lib/reporting/engine.ts
 *
 * Modules call generateReport(); nothing else. Output format is a parameter,
 * so adding Excel later means adding a branch here, not touching a module.
 */

import { ReportDocument, ReportDefinition, BuildMeta, OutputFormat, PageSetup } from './types';
import { getReport } from './registry';
import { renderReport, RenderOptions } from './renderer';
import { exportExcel } from './exportExcel';
import { exportWord } from './exportWord';
import { exportPptx } from './exportPptx';

export const SYSTEM_VERSION = '1.0';

const DEFAULT_PAGE: PageSetup = {
  size: 'A4',
  orientation: 'portrait',
  margin: { top: 18, right: 16, bottom: 22, left: 16 },
};

/** Reads the watermark artwork already defined in the design system. */
function watermarkArt(): string {
  if (typeof document === 'undefined') return '';
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--pactum-watermark-art').trim();
  const m = v.match(/url\(["']?(.+?)["']?\)/);
  return m ? m[1] : '';
}

export interface GenerateOptions {
  format?: OutputFormat;
  lang?: 'en' | 'ar';
  generatedBy: string;
  /** Overrides the document's own page setup. */
  page?: Partial<PageSetup>;
}

/** Builds a document from a registered definition and the caller's context. */
export function buildDocument<T>(
  def: ReportDefinition<T>, ctx: T, opts: GenerateOptions,
): ReportDocument {
  const meta: BuildMeta = {
    generatedBy: opts.generatedBy,
    generatedAt: new Date().toISOString(),
    systemVersion: SYSTEM_VERSION,
    lang: opts.lang ?? 'en',
  };
  const doc = def.build(ctx, meta);
  doc.page = { ...DEFAULT_PAGE, ...def.page, ...doc.page, ...opts.page };
  return doc;
}

/** Renders to a standalone HTML string. Used by every output path. */
export function toHtml(doc: ReportDocument, opts: RenderOptions = {}): string {
  return renderReport(doc, { watermarkArt: watermarkArt(), ...opts });
}

/**
 * Opens the report in a new window.
 *
 * `pdf` and `print` both hand off to the browser's print dialogue, which is
 * where "Save as PDF" lives — no 300 KB PDF library, and the output matches
 * the preview exactly. `preview` opens without the dialogue.
 */
export function openReport(doc: ReportDocument, format: OutputFormat = 'preview',
                           lang: 'en' | 'ar' = 'en'): Window | null {
  const html = toHtml(doc, { lang, toolbar: true });
  const w = window.open('', '_blank');
  if (!w) return null;                     // pop-up blocked; caller decides
  w.document.open();
  w.document.write(html);
  w.document.close();
  if (format === 'pdf' || format === 'print') {
    /**
     * WAIT FOR PAGINATION, NOT JUST FOR FONTS.
     *
     * The document now measures itself and builds its own sheets, so
     * printing on the old font-ready timer would fire while `#r-pages`
     * was still empty — an entirely blank print job.
     *
     * `paginate.ts` sets `window.__paginated` when the sheets exist and
     * the numbers are stamped. This polls for that flag and gives up
     * after 8 seconds, printing anyway rather than leaving the user with
     * a window that never responds.
     */
    const ready = () => (w as unknown as { __paginated?: boolean }).__paginated === true;
    const deadline = Date.now() + 8000;
    const go = () => {
      if (ready() || Date.now() > deadline) {
        setTimeout(() => { w.focus(); w.print(); }, 120);
      } else {
        setTimeout(go, 100);
      }
    };
    // Fonts still matter: they determine line heights, and pagination measures
    // against them. Start polling once they have settled.
    if ((w.document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready) {
      (w.document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready
        .then(go).catch(go);
    } else {
      w.addEventListener('load', go);
    }
  }
  return w;
}

/** Registry lookup + build + open, in one call. */
export function generateReport<T>(
  reportId: string, ctx: T, opts: GenerateOptions,
): Window | null {
  const def = getReport(reportId);
  if (!def) {
    console.warn(`[PACTUM] Unknown report: ${reportId}`);
    return null;
  }
  const doc = buildDocument(def, ctx, opts);
  return openReport(doc, opts.format ?? 'preview', opts.lang ?? 'en');
}

/**
 * Office export — Excel, Word, PowerPoint.
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 4 · THIS WAS A STUB THAT RETURNED FALSE
 *
 * The previous body was `console.warn(...)` + `return false`. It had no
 * callers, which is the only reason it was harmless: the menu offered
 * PDF, Print and Preview and nothing else. Sprint 4 both implements the
 * three writers AND exposes them, in that order — an export item in a
 * menu that silently does nothing is worse than no item.
 *
 * WHY ONE ReportDocument FEEDS ALL FOUR OUTPUTS
 *
 *   The document is already format-neutral: plain data with no HTML in
 *   it. That is what makes Excel a new WRITER rather than a new report.
 *   No definition changed to gain a spreadsheet, and none can drift,
 *   because all four outputs read the same object.
 *
 * WHAT EACH ONE IS
 *
 *   excel  numbers as NUMBERS, one sheet per section — a working file
 *   word   structure preserved, styling handed to Word — an editable draft
 *   pptx   one section per slide, long tables split — a review deck
 *
 * The writers are imported statically. A dynamic `import()` would keep
 * ~14 KB out of the initial chunk but makes the function async, which
 * would change every caller's signature for a saving of under one
 * percent of a 1.88 MB bundle.
 * ══════════════════════════════════════════════════════════════════════
 */
export function exportAs(doc: ReportDocument, format: 'excel' | 'word' | 'pptx',
                         lang: 'en' | 'ar' = 'en'): boolean {
  try {
    switch (format) {
      case 'excel': return exportExcel(doc);
      case 'word':  return exportWord(doc, lang);
      case 'pptx':  return exportPptx(doc, lang);
      default:
        console.warn(`[PACTUM] Unknown export format: ${format}`);
        return false;
    }
  } catch (err) {
    // A malformed section must not take the tab down with it. The caller
    // gets `false` and surfaces it; the reason lands in the console with
    // the format named, so the failure is diagnosable rather than silent.
    console.error(`[PACTUM] ${format} export failed:`, err);
    return false;
  }
}

/** Registry lookup + build + export, in one call. Mirrors generateReport. */
export function exportReport<T>(
  reportId: string, ctx: T, format: 'excel' | 'word' | 'pptx', opts: GenerateOptions,
): boolean {
  const def = getReport(reportId);
  if (!def) {
    console.warn(`[PACTUM] Unknown report: ${reportId}`);
    return false;
  }
  return exportAs(buildDocument(def, ctx, opts), format, opts.lang ?? 'en');
}
