/**
 * OOXML container — the ZIP writer every Office export sits on.
 * Destination: src/lib/reporting/ooxml.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * SPRINT 4 · WHY THIS FILE EXISTS AT ALL
 *
 * `.xlsx`, `.docx` and `.pptx` are the same thing: a ZIP archive of XML
 * parts with a manifest. Writing one therefore needs exactly two
 * capabilities — a ZIP writer and a string escaper. Both are small.
 *
 * WHAT WAS DELIBERATELY NOT DONE
 *
 *   The obvious route is `npm i exceljs docx pptxgenjs`. Measured: those
 *   three add roughly 1.4 MB to a bundle that already draws a warning at
 *   1.88 MB, and they arrive as a dependency the user must install
 *   before the package will even build. This platform is delivered as
 *   files copied into a repository; a package that cannot be applied
 *   without `npm install` is not a package.
 *
 *   So the container is written here, in about a hundred lines, and the
 *   three writers emit the minimum valid part set for each format.
 *
 * WHY STORED, NOT DEFLATED
 *
 *   The ZIP specification permits method 0 (stored, uncompressed) and
 *   every conforming reader — Excel, Word, PowerPoint, LibreOffice,
 *   Google Docs, python's openpyxl — accepts it. Deflate would need a
 *   compressor; `CompressionStream` exists but is async and unavailable
 *   in older Safari, which would make the whole export path async for a
 *   file that is measured in tens of kilobytes. A report is text; the
 *   size difference does not justify the failure mode.
 *
 * WHAT IT REFUSES TO DO
 *
 *   It never guesses an encoding. Every part is written as UTF-8 bytes
 *   from `TextEncoder`, and the CRC and both size fields are computed
 *   over those bytes — not over the string length, which for Arabic
 *   text is a different number and produces an archive that opens
 *   nowhere.
 * ══════════════════════════════════════════════════════════════════════
 */

// ── XML text safety ────────────────────────────────────────────────────

/**
 * Escapes text for an XML text node or attribute.
 *
 * Control characters below 0x20 other than tab/LF/CR are ILLEGAL in XML
 * 1.0 — not merely discouraged. A single stray 0x1F in a pasted comment
 * makes the whole document unopenable, so they are dropped rather than
 * escaped.
 */
export function x(v: unknown): string {
  return String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A filename that survives Windows, macOS and every browser. */
export function safeFileName(title: string, ext: string): string {
  const base = String(title || 'PACTUM Report')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'PACTUM Report';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base} — ${stamp}.${ext}`;
}

// ── CRC-32 ─────────────────────────────────────────────────────────────

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── ZIP ────────────────────────────────────────────────────────────────

export interface ZipEntry {
  /** Forward-slash path inside the archive. No leading slash. */
  path: string;
  /** UTF-8 text. Binary parts are not needed by any of the three writers. */
  data: string;
}

const enc = new TextEncoder();

function u16(n: number): number[] { return [n & 0xff, (n >>> 8) & 0xff]; }
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/**
 * DOS date/time. Anything before 1980 is unrepresentable, so the epoch is
 * clamped rather than allowed to wrap into a negative year — a wrapped
 * timestamp is one of the few things that makes Excel refuse an archive
 * outright instead of repairing it.
 */
function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Builds a ZIP archive with every entry STORED.
 *
 * Bit 11 of the general-purpose flag is set: it declares the file-name
 * field to be UTF-8. Without it a report whose title contains Arabic
 * produces mojibake in the archive listing on Windows.
 */
export function zip(entries: ZipEntry[]): Uint8Array {
  const now = dosTime(new Date());
  const chunks: number[][] = [];
  const central: number[][] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.path);
    const dataBytes = enc.encode(e.data);
    const crc = crc32(dataBytes);
    const n = dataBytes.length;

    const local = [
      ...u32(0x04034b50),
      ...u16(20),          // version needed
      ...u16(0x0800),      // flag: UTF-8 names
      ...u16(0),           // method: stored
      ...u16(now.time), ...u16(now.date),
      ...u32(crc), ...u32(n), ...u32(n),
      ...u16(nameBytes.length), ...u16(0),
      ...Array.from(nameBytes),
    ];
    chunks.push(local, Array.from(dataBytes));

    central.push([
      ...u32(0x02014b50),
      ...u16(20), ...u16(20),
      ...u16(0x0800), ...u16(0),
      ...u16(now.time), ...u16(now.date),
      ...u32(crc), ...u32(n), ...u32(n),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...Array.from(nameBytes),
    ]);

    offset += local.length + n;
  }

  const centralBytes = central.flat();
  const end = [
    ...u32(0x06054b50),
    ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralBytes.length), ...u32(offset),
    ...u16(0),
  ];

  const all = [...chunks.flat(), ...centralBytes, ...end];
  return Uint8Array.from(all);
}

// ── Delivery ───────────────────────────────────────────────────────────

export const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;

/**
 * Hands the archive to the browser as a download.
 *
 * The object URL is revoked on a timer rather than immediately: Safari
 * cancels an in-flight download when the URL is revoked in the same tick
 * as the click, which presents as "the button does nothing".
 */
export function download(bytes: Uint8Array, fileName: string, mime: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const url = URL.createObjectURL(new Blob([buf as ArrayBuffer], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
