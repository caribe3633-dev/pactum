/**
 * Word writer — the report as an editable document.
 * Destination: src/lib/reporting/exportWord.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 4 · WHAT A WORD EXPORT IS FOR
 *
 * The PDF is final; the .docx is the draft somebody pastes into a letter,
 * a submission or a determination. So this writer keeps the STRUCTURE —
 * headings, tables, the identity block — and lets Word own the styling,
 * rather than trying to reproduce the printed page. A recipient who
 * receives a pixel-perfect but uneditable document has received a PDF
 * with the wrong extension.
 *
 * FIGURES STAY AS FORMATTED
 *
 *   The opposite decision from Excel, and deliberate. A Word table is
 *   read, not calculated; `1,387,394,938` is the correct content of a
 *   sentence, and the grouped form is what the PDF shows. Keeping the two
 *   identical is what lets a reader check one against the other.
 *
 * RTL
 *
 *   An Arabic report sets `bidi` on every paragraph and `rtl` on the
 *   table layout. Without the table-level flag Word renders the columns
 *   left-to-right with Arabic text inside them, which reverses the
 *   reading order of a totals row — the number lands under the wrong
 *   heading. That is a wrong document, not a cosmetic issue.
 *
 * CURRENCY
 *
 *   Declared once in the identity block, from `doc.meta.currency`. No
 *   fallback: a document that does not know its currency prints no
 *   currency row.
 * ══════════════════════════════════════════════════════════════════════
 */

import { ReportDocument, Section, Column } from './types';
import { x, zip, download, safeFileName, MIME, ZipEntry } from './ooxml';
import { cell, reportDateTime } from './format';

const GOLD = '8A6D1F';
const INK = '23262B';

interface Ctx { rtl: boolean }

function runProps(o: { b?: boolean; sz?: number; color?: string; caps?: boolean } = {}): string {
  return `<w:rPr>${o.b ? '<w:b/><w:bCs/>' : ''}`
    + `${o.color ? `<w:color w:val="${o.color}"/>` : ''}`
    + `${o.caps ? '<w:caps/>' : ''}`
    + `${o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ''}`
    + `<w:rtl w:val="0"/></w:rPr>`;
}

function para(text: string, o: {
  b?: boolean; sz?: number; color?: string; caps?: boolean;
  align?: 'left' | 'right' | 'center'; space?: number; ctx?: Ctx;
} = {}): string {
  const rtl = o.ctx?.rtl;
  const jc = o.align ? `<w:jc w:val="${o.align}"/>` : (rtl ? '<w:jc w:val="right"/>' : '');
  return `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}${jc}`
    + `<w:spacing w:before="${o.space ?? 40}" w:after="${o.space ?? 40}"/></w:pPr>`
    + `<w:r>${runProps(o)}<w:t xml:space="preserve">${x(text)}</w:t></w:r></w:p>`;
}

function heading(text: string, ctx: Ctx): string {
  return `<w:p><w:pPr>${ctx.rtl ? '<w:bidi/>' : ''}<w:pStyle w:val="Heading2"/>`
    + `<w:spacing w:before="260" w:after="100"/>`
    + `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${GOLD}"/></w:pBdr>`
    + `</w:pPr><w:r>${runProps({ b: true, sz: 26, color: GOLD, caps: true })}`
    + `<w:t xml:space="preserve">${x(text)}</w:t></w:r></w:p>`;
}

function tc(text: string, o: { head?: boolean; money?: boolean; w?: number; ctx: Ctx }): string {
  const align = o.money ? (o.ctx.rtl ? 'left' : 'right') : (o.ctx.rtl ? 'right' : 'left');
  return `<w:tc><w:tcPr>${o.w ? `<w:tcW w:w="${o.w}" w:type="pct"/>` : ''}`
    + `${o.head ? `<w:shd w:val="clear" w:color="auto" w:fill="${INK}"/>` : ''}`
    + `<w:vAlign w:val="center"/></w:tcPr>`
    + `<w:p><w:pPr>${o.ctx.rtl ? '<w:bidi/>' : ''}<w:jc w:val="${align}"/>`
    + `<w:spacing w:before="30" w:after="30"/></w:pPr>`
    + `<w:r>${runProps({ b: o.head, sz: 18, color: o.head ? 'FFFFFF' : undefined })}`
    + `<w:t xml:space="preserve">${x(text)}</w:t></w:r></w:p></w:tc>`;
}

function table(rows: string[], ctx: Ctx): string {
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>`
    + `${ctx.rtl ? '<w:bidiVisual/>' : ''}`
    + `<w:tblBorders>`
    + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>`).join('')
    + `</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>${rows.join('')}</w:tbl>`;
}

function kv(pairs: [string, string][], ctx: Ctx): string {
  if (!pairs.length) return '';
  return table(pairs.map(([k, v]) =>
    `<w:tr>${tc(k, { head: false, w: 32, ctx })}${tc(v, { w: 68, ctx })}</w:tr>`), ctx);
}

function section(s: Section, ctx: Ctx): string {
  const h = (t?: string) => (t ? heading(t, ctx) : '');

  switch (s.kind) {
    case 'summary':
      return h(s.title ?? 'Summary') + para(s.text, { ctx, sz: 20 });

    case 'appendix':
      return h(s.title ?? 'Appendix') + para(s.text, { ctx, sz: 18 });

    case 'kpi':
      return h(s.title) + kv(s.items.map(k =>
        [k.label, `${k.value}${k.unit ? ` ${k.unit}` : ''}`] as [string, string]), ctx);

    case 'info':
      return h(s.title) + kv(s.items.map(i => [i.label, i.value] as [string, string]), ctx);

    case 'table': {
      const cols: Column[] = s.columns;
      const w = Math.floor(100 / Math.max(cols.length, 1));
      const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>`
        + cols.map(c => tc(c.label, { head: true, money: c.money, w: c.width ?? w, ctx })).join('')
        + `</w:tr>`;
      const body = s.rows.length
        ? s.rows.map(r => `<w:tr>`
            + cols.map(c => tc(cell(r[c.key], { money: c.money }), { money: c.money, ctx })).join('')
            + `</w:tr>`).join('')
        : `<w:tr>${tc('No records.', { ctx })}${cols.slice(1).map(() => tc('', { ctx })).join('')}</w:tr>`;
      const foot = s.total
        ? `<w:tr>` + cols.map((c, i) => {
            const span = s.total!.span ?? 1;
            if (i < span) return tc(i === 0 ? s.total!.label : '', { head: true, ctx });
            const v = s.total!.values[c.key];
            return tc(v === undefined ? '' : cell(v, { money: c.money }), { head: true, money: c.money, ctx });
          }).join('') + `</w:tr>`
        : '';
      return h(s.title) + table([head, body, foot].filter(Boolean), ctx)
        + (s.note ? para(s.note, { ctx, sz: 16, color: '707070' }) : '');
    }

    case 'timeline':
      return h(s.title) + table([
        `<w:tr>${tc('Event', { head: true, w: 40, ctx })}${tc('Date', { head: true, w: 20, ctx })}`
        + `${tc('Value', { head: true, w: 20, ctx })}${tc('Note', { head: true, w: 20, ctx })}</w:tr>`,
        ...s.items.map(i => `<w:tr>${tc(i.label, { ctx })}${tc(i.date ?? '—', { ctx })}`
          + `${tc(i.value ?? '—', { ctx })}${tc(i.note ?? '', { ctx })}</w:tr>`),
      ], ctx);

    case 'bars':
      return h(s.title) + table([
        `<w:tr>${tc('Item', { head: true, w: 50, ctx })}${tc('Share', { head: true, w: 25, ctx })}`
        + `${tc('Value', { head: true, w: 25, ctx })}</w:tr>`,
        ...s.items.map(b => `<w:tr>${tc(b.label, { ctx })}`
          + `${tc(`${(Number(b.ratio) * 100).toFixed(1)}%`, { money: true, ctx })}`
          + `${tc(b.value ?? '—', { money: true, ctx })}</w:tr>`),
      ], ctx);

    case 'risk':
      return h(s.title) + table([
        `<w:tr>${tc('Risk', { head: true, w: 55, ctx })}${tc('Probability', { head: true, w: 15, ctx })}`
        + `${tc('Impact', { head: true, w: 15, ctx })}${tc('Score', { head: true, w: 15, ctx })}</w:tr>`,
        ...s.cells.map(c => `<w:tr>${tc(c.label, { ctx })}${tc(String(c.probability), { money: true, ctx })}`
          + `${tc(String(c.impact), { money: true, ctx })}`
          + `${tc(String(c.probability * c.impact), { money: true, ctx })}</w:tr>`),
      ], ctx);

    case 'signature':
      // Blank cells are intentional: this is signed by hand after printing.
      return h(s.title ?? 'Approvals') + table([
        `<w:tr>${tc('Role', { head: true, w: 34, ctx })}${tc('Name', { head: true, w: 33, ctx })}`
        + `${tc('Signature / Date', { head: true, w: 33, ctx })}</w:tr>`,
        ...s.signatories.map(g => `<w:tr>${tc(g.role, { ctx })}${tc(g.name ?? '', { ctx })}`
          + `${tc(g.date ?? '', { ctx })}</w:tr>`),
      ], ctx);

    case 'pagebreak':
      return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }
}

export function buildDocx(doc: ReportDocument, lang: 'en' | 'ar' = 'en'): Uint8Array {
  const ctx: Ctx = { rtl: lang === 'ar' };
  const m = doc.meta;
  const trail = [m.company, m.sector, m.project].filter(Boolean).join(' › ');

  const identity: [string, string][] = ([
    ['Company', m.company], ['Sector', m.sector], ['Project', m.project],
    ['Reference', m.reference],
    ['Reporting Currency', m.currency],
    ['Generated by', m.generatedBy],
    ['Generated at', reportDateTime(m.generatedAt, lang)],
    ['Report version', m.version], ['System version', m.systemVersion],
    ['Confidentiality', m.confidentiality],
  ] as [string, string | undefined][])
    .filter(([, v]) => v).map(([k, v]) => [k, String(v)]);

  const body =
      para('PACTUM · CONTRACT INTELLIGENCE', { ctx, b: true, sz: 15, color: GOLD, caps: true })
    + para(m.title, { ctx, b: true, sz: 40, color: INK })
    + (m.subtitle ? para(m.subtitle, { ctx, sz: 22, color: '707070' }) : '')
    + (trail ? para(trail, { ctx, sz: 18, color: '707070' }) : '')
    + kv(identity, ctx)
    + doc.sections.map(s => section(s, ctx)).join('')
    + para('PACTUM · © Mohamed Mohsen', { ctx, sz: 14, color: '909090', space: 240 });

  const land = doc.page.orientation === 'landscape';
  const pg = land
    ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/>';

  const files: ZipEntry[] = [
    { path: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>` },
    { path: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>` },
    { path: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { path: 'word/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/>
<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
<w:pPr><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="${GOLD}"/></w:rPr></w:style>
</w:styles>` },
    { path: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${x(m.title)}</dc:title><dc:creator>${x(m.generatedBy)}</dc:creator>
<cp:lastModifiedBy>PACTUM</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${x(m.generatedAt)}</dcterms:created>
</cp:coreProperties>` },
    { path: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr>${pg}
<w:pgMar w:top="1000" w:right="900" w:bottom="1100" w:left="900" w:header="500" w:footer="500" w:gutter="0"/>
${ctx.rtl ? '<w:bidi/>' : ''}</w:sectPr></w:body></w:document>` },
  ];

  return zip(files);
}

export function exportWord(doc: ReportDocument, lang: 'en' | 'ar' = 'en'): boolean {
  return download(buildDocx(doc, lang), safeFileName(doc.meta.title, 'docx'), MIME.docx);
}
