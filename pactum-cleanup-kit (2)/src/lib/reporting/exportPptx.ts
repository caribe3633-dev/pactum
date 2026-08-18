/**
 * PowerPoint writer — the report as a review deck.
 * Destination: src/lib/reporting/exportPptx.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 4 · WHAT A DECK IS FOR, AND WHAT IT MUST NOT DO
 *
 * A deck is presented to a board, not read at a desk. So one section
 * becomes one slide, and a long table becomes SEVERAL slides rather than
 * one unreadable one — a 60-row register pasted onto a single slide is a
 * grey rectangle nobody can read from the far end of a room.
 *
 * THE CONTINUATION RULE
 *
 *   `ROWS_PER_SLIDE = 12` rows plus the header fits a 16:9 slide at a
 *   legible size. When a table overflows, each further slide repeats the
 *   column header and its title carries "(2 of 4)". The alternative —
 *   silently truncating at 12 — would hide records from the one audience
 *   least able to notice they are missing.
 *
 * WHY 16:9
 *
 *   The platform's reports are A4 portrait, but a deck is projected. The
 *   slide size is 12192000 × 6858000 EMU, which is exactly 13.333in ×
 *   7.5in — the current PowerPoint default. Choosing 4:3 would letterbox
 *   on every screen the deck is ever shown on.
 *
 * CURRENCY
 *
 *   Printed once on the title slide, from `doc.meta.currency`. Absent
 *   when undeclared. Never SAR by default.
 * ══════════════════════════════════════════════════════════════════════
 */

import { ReportDocument, Section } from './types';
import { x, zip, download, safeFileName, MIME, ZipEntry } from './ooxml';
import { cell, reportDateTime } from './format';

const W = 12192000, H = 6858000;      // 16:9 in EMU
const PX = 12700;                     // 1 pt
const GOLD = 'D4AF37', INK = '0D0E0F', PAPER = 'FFFFFF', MUTE = '8B8A86';
const ROWS_PER_SLIDE = 12;

function box(id: number, name: string, xEmu: number, y: number, cx: number, cy: number, body: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${x(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${xEmu}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/>`
    + `<a:lstStyle/>${body}</p:txBody></p:sp>`;
}

function line(text: string, o: {
  sz?: number; b?: boolean; color?: string; align?: 'l' | 'r' | 'ctr'; rtl?: boolean; space?: number;
} = {}): string {
  const algn = o.align ?? (o.rtl ? 'r' : 'l');
  return `<a:p><a:pPr algn="${algn}"${o.rtl ? ' rtl="1"' : ''}`
    + `${o.space ? `><a:spcBef><a:spcPts val="${o.space}"/></a:spcBef></a:pPr>` : '/>'}`
    + `<a:r><a:rPr lang="en-US" sz="${(o.sz ?? 14) * 100}"${o.b ? ' b="1"' : ''} dirty="0">`
    + `<a:solidFill><a:srgbClr val="${o.color ?? '23262B'}"/></a:solidFill>`
    + `<a:latin typeface="Calibri"/><a:cs typeface="Arial"/></a:rPr>`
    + `<a:t>${x(text)}</a:t></a:r></a:p>`;
}

function rect(id: number, xEmu: number, y: number, cx: number, cy: number, fill: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Bar${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${xEmu}" y="${y}"/><a:ext cx="${Math.max(cx, 1)}" cy="${cy}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`
    + `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>`
    + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function slideXml(shapes: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>
<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"
 accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5"
 accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`;
}

/** The gold rule + section title every content slide carries. */
function chrome(title: string, sub: string, rtl: boolean): string {
  return rect(2, 640000, 620000, 700000, 34000, GOLD)
    + box(3, 'Title', 640000, 760000, W - 1280000, 560000,
        line(title, { sz: 24, b: true, color: INK, rtl }))
    + (sub ? box(4, 'Sub', 640000, 1290000, W - 1280000, 300000,
        line(sub, { sz: 11, color: MUTE, rtl })) : '')
    + rect(5, 0, H - 190000, W, 4000, 'E4E2DD')
    + box(6, 'Foot', 640000, H - 150000, W - 1280000, 200000,
        line('PACTUM · CONTRACT INTELLIGENCE', { sz: 8, color: MUTE, rtl }));
}

const TOP = 1700000;

function kpiSlide(items: { label: string; value: string | number; unit?: string; note?: string }[],
                  title: string, rtl: boolean): string {
  const per = Math.min(4, Math.max(1, Math.ceil(items.length / Math.ceil(items.length / 4))));
  const cw = (W - 1280000) / per;
  let id = 20;
  const cells = items.slice(0, 12).map((k, i) => {
    const col = i % per, row = Math.floor(i / per);
    const xo = 640000 + col * cw, yo = TOP + row * 1180000;
    return box(id++, `K${i}`, xo, yo, cw - 120000, 1050000,
      line(k.label, { sz: 10, color: MUTE, rtl })
      + line(String(k.value), { sz: 26, b: true, color: INK, rtl, space: 300 })
      + (k.unit || k.note ? line(String(k.unit ?? k.note), { sz: 9, color: MUTE, rtl }) : ''));
  }).join('');
  return slideXml(chrome(title, '', rtl) + cells);
}

function tableSlide(head: string[], rows: string[][], moneyCols: boolean[],
                    title: string, sub: string, rtl: boolean): string {
  const n = Math.max(head.length, 1);
  const cw = (W - 1280000) / n;
  let id = 20;
  const shapes: string[] = [rect(id++, 640000, TOP, W - 1280000, 300000, '23262B')];

  head.forEach((h, c) => {
    shapes.push(box(id++, `H${c}`, 640000 + c * cw + 60000, TOP + 70000, cw - 120000, 220000,
      line(h, { sz: 10, b: true, color: PAPER, align: moneyCols[c] ? (rtl ? 'l' : 'r') : (rtl ? 'r' : 'l'), rtl })));
  });

  rows.forEach((r, ri) => {
    const y = TOP + 340000 + ri * 300000;
    if (ri % 2 === 1) shapes.push(rect(id++, 640000, y - 20000, W - 1280000, 290000, 'F4F3F0'));
    r.forEach((v, c) => {
      shapes.push(box(id++, `C${ri}_${c}`, 640000 + c * cw + 60000, y + 40000, cw - 120000, 240000,
        line(v, { sz: 10, color: '23262B', align: moneyCols[c] ? (rtl ? 'l' : 'r') : (rtl ? 'r' : 'l'), rtl })));
    });
  });

  return slideXml(chrome(title, sub, rtl) + shapes.join(''));
}

/** One section → one or more slides. */
function sectionSlides(s: Section, rtl: boolean): string[] {
  switch (s.kind) {
    case 'kpi':
      return [kpiSlide(s.items, s.title ?? 'Key Indicators', rtl)];

    case 'info':
      return [kpiSlide(s.items.map(i => ({ label: i.label, value: i.value })),
                       s.title ?? 'Details', rtl)];

    case 'summary':
    case 'appendix': {
      // Long body text is chunked on sentence boundaries — a slide that
      // runs off the bottom edge simply loses its ending with no warning.
      //
      // NOTE: the word "pr" + "ose" is deliberately not written here.
      // Tailwind's content scanner reads THIS FILE, and that bare word
      // matches the typography plugin's class name, which pulled 12.6 KB
      // of unused CSS into the bundle and changed the stylesheet hash.
      // Measured: 165,361 -> 177,952 bytes, from a comment.
      const words = s.text.split(/(?<=\.)\s+/);
      const chunks: string[] = [];
      let cur = '';
      for (const w of words) {
        if ((cur + w).length > 620) { chunks.push(cur.trim()); cur = ''; }
        cur += w + ' ';
      }
      if (cur.trim()) chunks.push(cur.trim());
      const base = s.title ?? (s.kind === 'summary' ? 'Summary' : 'Appendix');
      return (chunks.length ? chunks : ['—']).map((c, i) => slideXml(
        chrome(chunks.length > 1 ? `${base} (${i + 1} of ${chunks.length})` : base, '', rtl)
        + box(20, 'Body', 640000, TOP, W - 1280000, H - TOP - 500000,
            line(c, { sz: 13, color: '23262B', rtl }))));
    }

    case 'table': {
      const head = s.columns.map(c => c.label);
      const moneyCols = s.columns.map(c => !!c.money);
      const all = s.rows.map(r => s.columns.map(c => cell(r[c.key], { money: c.money })));
      if (s.total) {
        const span = s.total.span ?? 1;
        all.push(s.columns.map((c, i) => i < span
          ? (i === 0 ? s.total!.label : '')
          : cell(s.total!.values[c.key], { money: c.money })));
      }
      const pages = Math.max(1, Math.ceil(all.length / ROWS_PER_SLIDE));
      const base = s.title ?? 'Table';
      return Array.from({ length: pages }, (_, p) => tableSlide(
        head,
        all.slice(p * ROWS_PER_SLIDE, (p + 1) * ROWS_PER_SLIDE),
        moneyCols,
        pages > 1 ? `${base} (${p + 1} of ${pages})` : base,
        s.note && p === pages - 1 ? s.note : '',
        rtl));
    }

    case 'timeline':
      return sectionSlides({ kind: 'table', title: s.title ?? 'Timeline',
        columns: [{ key: 'label', label: 'Event' }, { key: 'date', label: 'Date' },
                  { key: 'value', label: 'Value', money: true }, { key: 'note', label: 'Note' }],
        rows: s.items as any }, rtl);

    case 'bars':
      return sectionSlides({ kind: 'table', title: s.title ?? 'Distribution',
        columns: [{ key: 'label', label: 'Item' }, { key: 'pct', label: 'Share', money: true },
                  { key: 'value', label: 'Value', money: true }],
        rows: s.items.map(b => ({ label: b.label,
          pct: `${(Number(b.ratio) * 100).toFixed(1)}%`, value: b.value ?? '—' })) }, rtl);

    case 'risk':
      return sectionSlides({ kind: 'table', title: s.title ?? 'Risk Matrix',
        columns: [{ key: 'label', label: 'Risk' }, { key: 'p', label: 'Probability', money: true },
                  { key: 'i', label: 'Impact', money: true }, { key: 'sc', label: 'Score', money: true }],
        rows: s.cells.map(c => ({ label: c.label, p: c.probability, i: c.impact,
          sc: c.probability * c.impact })) }, rtl);

    case 'signature':
      return sectionSlides({ kind: 'table', title: s.title ?? 'Approvals',
        columns: [{ key: 'role', label: 'Role' }, { key: 'name', label: 'Name' },
                  { key: 'date', label: 'Signature / Date' }],
        rows: s.signatories.map(g => ({ role: g.role, name: g.name ?? '', date: g.date ?? '' })) }, rtl);

    // A slide IS a page break.
    case 'pagebreak':
      return [];
  }
}

function titleSlide(doc: ReportDocument, lang: 'en' | 'ar'): string {
  const m = doc.meta;
  const rtl = lang === 'ar';
  const facts = ([
    ['Company', m.company], ['Sector', m.sector], ['Project', m.project],
    ['Reference', m.reference],
    ['Reporting Currency', m.currency],
    ['Generated by', m.generatedBy],
    ['Generated at', reportDateTime(m.generatedAt, lang)],
  ] as [string, string | undefined][]).filter(([, v]) => v);

  let id = 20;
  const rows = facts.map(([k, v], i) =>
    box(id++, `F${i}`, 900000, 3900000 + i * 300000, W - 1800000, 280000,
      line(`${k}   ${v}`, { sz: 10, color: '9A9791', rtl }))).join('');

  return slideXml(
      rect(2, 0, 0, W, H, INK)
    + rect(3, 900000, 1500000, 700000, 40000, GOLD)
    + box(4, 'Eyebrow', 900000, 1700000, W - 1800000, 300000,
        line('PACTUM · CONTRACT INTELLIGENCE', { sz: 11, b: true, color: GOLD, rtl }))
    + box(5, 'Title', 900000, 2150000, W - 1800000, 900000,
        line(m.title, { sz: 40, b: true, color: 'ECEAE5', rtl }))
    + (m.subtitle ? box(6, 'Sub', 900000, 3150000, W - 1800000, 400000,
        line(m.subtitle, { sz: 15, color: MUTE, rtl })) : '')
    + rect(7, 900000, 3700000, W - 1800000, 4000, '3A3833')
    + rows
    + (m.confidentiality ? box(90, 'Conf', 900000, H - 900000, W - 1800000, 300000,
        line(m.confidentiality.toUpperCase(), { sz: 10, b: true, color: GOLD, rtl })) : ''));
}

export function buildPptx(doc: ReportDocument, lang: 'en' | 'ar' = 'en'): Uint8Array {
  const rtl = lang === 'ar';
  const slides = [titleSlide(doc, lang), ...doc.sections.flatMap(s => sectionSlides(s, rtl))];

  const files: ZipEntry[] = [
    { path: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>` },
    { path: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>` },
    { path: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${x(doc.meta.title)}</dc:title><dc:creator>${x(doc.meta.generatedBy)}</dc:creator>
<cp:lastModifiedBy>PACTUM</cp:lastModifiedBy></cp:coreProperties>` },
    { path: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${slides.map((_, i) =>
  `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="${H}" cy="${W}"/>
</p:presentation>` },
    { path: 'ppt/_rels/presentation.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${slides.map((_, i) =>
  `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${slides.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>` },
    { path: 'ppt/slideMasters/slideMaster1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"
 accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>` },
    { path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>` },
    { path: 'ppt/slideLayouts/slideLayout1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>` },
    { path: 'ppt/theme/theme1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PACTUM">
<a:themeElements><a:clrScheme name="PACTUM">
<a:dk1><a:srgbClr val="0D0E0F"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="23262B"/></a:dk2><a:lt2><a:srgbClr val="ECEAE5"/></a:lt2>
<a:accent1><a:srgbClr val="D4AF37"/></a:accent1><a:accent2><a:srgbClr val="8A6D1F"/></a:accent2>
<a:accent3><a:srgbClr val="6E7B6B"/></a:accent3><a:accent4><a:srgbClr val="9A5B4C"/></a:accent4>
<a:accent5><a:srgbClr val="4C6B7A"/></a:accent5><a:accent6><a:srgbClr val="8B8A86"/></a:accent6>
<a:hlink><a:srgbClr val="D4AF37"/></a:hlink><a:folHlink><a:srgbClr val="8A6D1F"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="PACTUM">
<a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Arial"/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Arial"/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="PACTUM">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst>
<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>` },
    ...slides.map((s, i) => ({ path: `ppt/slides/slide${i + 1}.xml`, data: s })),
    ...slides.map((_, i) => ({ path: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>` })),
  ];

  return zip(files);
}

export function exportPptx(doc: ReportDocument, lang: 'en' | 'ar' = 'en'): boolean {
  return download(buildPptx(doc, lang), safeFileName(doc.meta.title, 'pptx'), MIME.pptx);
}
