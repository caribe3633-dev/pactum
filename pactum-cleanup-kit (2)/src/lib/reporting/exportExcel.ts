/**
 * Excel writer — one worksheet per report section.
 * Destination: src/lib/reporting/exportExcel.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 4 · WHAT AN EXCEL EXPORT IS FOR
 *
 * A PDF is a statement; a spreadsheet is a working file. Somebody opens
 * this to re-sort, filter and add a column — so the guiding rule is that
 * every figure must arrive as a NUMBER, not as the formatted string the
 * PDF prints. `1,387,394,938` in a cell is text: it cannot be summed,
 * and a recipient who tries gets zero.
 *
 * THE RECOVERY THAT MAKES THAT POSSIBLE
 *
 *   A ReportDocument has already been through the formatters — a money
 *   column holds `"1,387,394,938"` and a KPI holds `"162,409,440"`.
 *   `numeric()` reverses that: it strips grouping separators and any
 *   currency label and returns a real number, but ONLY when the whole
 *   string is a number once stripped. `"Not convertible to EUR"` and
 *   `"—"` stay text, because turning a refusal into 0 would be the worst
 *   possible outcome: a suppressed figure silently becoming a real one.
 *
 * CURRENCY
 *
 *   Stated once per sheet, in the header block, in the currency the
 *   document declares. Never repeated per cell and never assumed. A
 *   document with no declared currency prints no currency line rather
 *   than the word SAR.
 * ══════════════════════════════════════════════════════════════════════
 */

import { ReportDocument, Section } from './types';
import { x, zip, download, safeFileName, MIME, ZipEntry } from './ooxml';
import { reportDateTime } from './format';

type CellV = { t: 'n' | 's'; v: string };

const S_TITLE = 1, S_HEAD = 2, S_LABEL = 3, S_MONEY = 4, S_TEXT = 0, S_META = 5;

/** Text if it is text; a number only when the entire value is one. */
function numeric(raw: unknown): CellV {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { t: 'n', v: String(raw) };
  const s = String(raw ?? '').trim();
  if (!s || s === '—') return { t: 's', v: '' };
  // Strip grouping commas, a leading currency code, and a trailing % sign.
  const stripped = s.replace(/,/g, '').replace(/^[A-Z]{3}\s+/, '').replace(/%$/, '');
  if (/^-?\d+(\.\d+)?$/.test(stripped)) return { t: 'n', v: stripped };
  return { t: 's', v: s };
}

function cellXml(ref: string, c: CellV, style: number): string {
  const st = style ? ` s="${style}"` : '';
  if (c.t === 'n') return `<c r="${ref}"${st}><v>${x(c.v)}</v></c>`;
  if (!c.v) return `<c r="${ref}"${st}/>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${x(c.v)}</t></is></c>`;
}

function colRef(i: number): string {
  let s = '', n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/** Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 chars. */
function sheetName(title: string, index: number, used: Set<string>): string {
  let base = String(title || `Sheet${index}`).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 28) || `Sheet${index}`;
  let name = base, n = 2;
  while (used.has(name.toLowerCase())) { name = `${base.slice(0, 26)} ${n++}`; }
  used.add(name.toLowerCase());
  return name;
}

interface Row { cells: (CellV | null)[]; style: number }

/** Flattens one report section into spreadsheet rows. */
function sectionRows(s: Section): { title: string; rows: Row[] } | null {
  const R = (vals: (string | number | CellV | null)[], style = S_TEXT): Row => ({
    style,
    cells: vals.map(v =>
      v === null ? null
      : typeof v === 'object' ? v
      : { t: 's', v: String(v) } as CellV),
  });

  switch (s.kind) {
    case 'kpi':
      return { title: s.title ?? 'Indicators', rows: [
        R(['Indicator', 'Value', 'Unit'], S_HEAD),
        ...s.items.map(k => ({
          style: S_TEXT,
          cells: [{ t: 's', v: k.label } as CellV, numeric(k.value),
                  { t: 's', v: k.unit ?? k.note ?? '' } as CellV],
        })),
      ]};

    case 'info':
      return { title: s.title ?? 'Details', rows: [
        R(['Field', 'Value'], S_HEAD),
        ...s.items.map(i => R([i.label, i.value])),
      ]};

    case 'table': {
      const head = R(s.columns.map(c => c.label), S_HEAD);
      const body = s.rows.map(r => ({
        style: S_TEXT,
        cells: s.columns.map(c => c.money ? numeric(r[c.key]) : ({
          t: 's', v: r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key]),
        } as CellV)),
      }));
      const rows: Row[] = [head, ...body];
      if (s.total) {
        const span = s.total.span ?? 1;
        rows.push({
          style: S_LABEL,
          cells: s.columns.map((c, i) =>
            i < span ? ({ t: 's', v: i === 0 ? s.total!.label : '' } as CellV)
                     : numeric(s.total!.values[c.key])),
        });
      }
      if (s.note) rows.push(R([]), R([s.note]));
      return { title: s.title ?? 'Table', rows };
    }

    case 'timeline':
      return { title: s.title ?? 'Timeline', rows: [
        R(['Event', 'Date', 'Value', 'Note'], S_HEAD),
        ...s.items.map(i => ({
          style: S_TEXT,
          cells: [{ t: 's', v: i.label } as CellV, { t: 's', v: i.date ?? '' } as CellV,
                  numeric(i.value), { t: 's', v: i.note ?? '' } as CellV],
        })),
      ]};

    case 'bars':
      return { title: s.title ?? 'Distribution', rows: [
        R(['Item', 'Ratio', 'Value'], S_HEAD),
        ...s.items.map(b => ({
          style: S_TEXT,
          cells: [{ t: 's', v: b.label } as CellV,
                  { t: 'n', v: String(Number(b.ratio) || 0) } as CellV,
                  numeric(b.value)],
        })),
      ]};

    case 'risk':
      return { title: s.title ?? 'Risk Matrix', rows: [
        R(['Risk', 'Probability', 'Impact', 'Score'], S_HEAD),
        ...s.cells.map(c => ({
          style: S_TEXT,
          cells: [{ t: 's', v: c.label } as CellV,
                  { t: 'n', v: String(c.probability) } as CellV,
                  { t: 'n', v: String(c.impact) } as CellV,
                  { t: 'n', v: String(c.probability * c.impact) } as CellV],
        })),
      ]};

    case 'signature':
      return { title: s.title ?? 'Approvals', rows: [
        R(['Role', 'Name', 'Date'], S_HEAD),
        ...s.signatories.map(g => R([g.role, g.name ?? '', g.date ?? ''])),
      ]};

    case 'summary':
    case 'appendix':
      return { title: s.title ?? (s.kind === 'summary' ? 'Summary' : 'Appendix'),
               rows: [R([s.text])] };

    // A page break has no spreadsheet meaning — sheets ARE the pagination.
    case 'pagebreak':
      return null;
  }
}

function sheetXml(rows: Row[], widths: number[]): string {
  const cols = widths.length
    ? `<cols>${widths.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const body = rows.map((r, ri) =>
    `<row r="${ri + 1}">${r.cells.map((c, ci) =>
      c === null ? '' : cellXml(`${colRef(ci)}${ri + 1}`, c, r.style)).join('')}</row>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><color rgb="FF8A6D1F"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><sz val="9"/><color rgb="FF808080"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF23262B"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * Builds the .xlsx byte stream.
 *
 * Sheet 1 is always the identity block, so a recipient who opens the file
 * cold learns who produced it, when, from what and IN WHICH CURRENCY
 * before seeing a single figure.
 */
export function buildXlsx(doc: ReportDocument): Uint8Array {
  const m = doc.meta;
  const used = new Set<string>();
  const sheets: { name: string; xml: string }[] = [];

  const info: Row[] = [
    { style: S_TITLE, cells: [{ t: 's', v: m.title }] },
    ...(m.subtitle ? [{ style: S_TEXT, cells: [{ t: 's', v: m.subtitle } as CellV] }] : []),
    { style: S_TEXT, cells: [] },
    ...([
      ['Company', m.company], ['Sector', m.sector], ['Project', m.project],
      ['Reference', m.reference],
      // Stated, never assumed. Omitted entirely when the document
      // declares none — a blank is honest, "SAR" would not be.
      ['Reporting Currency', m.currency],
      ['Generated by', m.generatedBy],
      ['Generated at', reportDateTime(m.generatedAt, 'en')],
      ['Report version', m.version], ['System version', m.systemVersion],
      ['Confidentiality', m.confidentiality],
    ] as [string, string | undefined][])
      .filter(([, v]) => v)
      .map(([k, v]) => ({ style: S_TEXT, cells: [{ t: 's', v: k } as CellV, { t: 's', v: String(v) } as CellV] })),
    { style: S_TEXT, cells: [] },
    { style: S_META, cells: [{ t: 's', v: 'PACTUM · Contract Intelligence — figures exported as numbers, not text.' }] },
  ];
  sheets.push({ name: sheetName('Report Info', 0, used), xml: sheetXml(info, [26, 52]) });

  doc.sections.forEach((s, i) => {
    const out = sectionRows(s);
    if (!out) return;
    const widest = out.rows.reduce((a, r) => Math.max(a, r.cells.length), 0);
    const widths = Array.from({ length: widest }, (_, c) => (c === 0 ? 34 : 18));
    sheets.push({ name: sheetName(out.title, i + 1, used), xml: sheetXml(out.rows, widths) });
  });

  const files: ZipEntry[] = [
    { path: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>` },
    { path: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { path: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) =>
  `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>` },
    { path: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) =>
  `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { path: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
  ];

  return zip(files);
}

export function exportExcel(doc: ReportDocument): boolean {
  return download(buildXlsx(doc), safeFileName(doc.meta.title, 'xlsx'), MIME.xlsx);
}
