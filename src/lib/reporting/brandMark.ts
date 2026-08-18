/**
 * The PACTUM brand mark, as SVG strings for the report renderer.
 * Destination: src/lib/reporting/brandMark.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE GEOMETRY, ONE PLACE
 *
 * THE DEFECT
 *
 *   `renderer.ts` carried its own hand-copied duplicate of the logo —
 *   fourteen path strings pasted beside the nine that `PactumLogo.tsx`
 *   draws. Measured at the time of writing: the nine mark paths were
 *   still byte-identical, so nothing looked wrong yet.
 *
 *   That is precisely the danger. A duplicate that currently matches is
 *   invisible; it only announces itself the first time somebody redraws
 *   the brand and the printed reports keep the old mark. There is no
 *   error, no warning, and no test that would catch it — the report
 *   simply stops being the product's logo.
 *
 * WHY NOT IMPORT THE REACT COMPONENT
 *
 *   `PactumLogo.tsx` returns JSX. The report renderer builds a STRING
 *   that is written into a separate print window with `document.write`,
 *   so there is no React tree to mount into and no runtime to render it.
 *   Pulling React into the print path to draw one logo would be a much
 *   larger change than the problem deserves.
 *
 *   So the geometry lives here, in one module, and BOTH consumers read
 *   it: `PactumLogo.tsx` for the screen, `renderer.ts` for print. The
 *   paths exist exactly once in the codebase.
 *
 * WHY PLAIN STRINGS
 *
 *   The values below are the same numbers the component used, kept as
 *   data rather than markup so each consumer can apply its own attribute
 *   syntax — React needs `strokeWidth`, raw SVG needs `stroke-width`.
 * ══════════════════════════════════════════════════════════════════════
 */

export const BRAND_GOLD = '#d4af37';
export const BRAND_IVORY = '#ECEAE5';

/** Hexagonal frame — the industrial container. */
export const MARK_FRAME = 'M32 3 L57 17.5 L57 46.5 L32 61 L7 46.5 L7 17.5 Z';
/** Inner frame. Dropped at favicon sizes where it fills in. */
export const MARK_INNER = 'M32 9.5 L51.5 20.75 L51.5 43.25 L32 54.5 L12.5 43.25 L12.5 20.75 Z';
/** Isometric cube — top, left and right faces. */
export const MARK_CUBE_TOP   = 'M32 19 L45 26.5 L32 34 L19 26.5 Z';
export const MARK_CUBE_LEFT  = 'M19 26.5 L32 34 L32 48 L19 40.5 Z';
export const MARK_CUBE_RIGHT = 'M45 26.5 L45 40.5 L32 48 L32 34 Z';
/** Structural courses on the right face — the "built" reading. */
export const MARK_COURSES_R = ['M35.5 39.4 L41.8 35.8', 'M35.5 43.4 L41.8 39.8'];
/** Structural courses on the left face. */
export const MARK_COURSES_L = ['M22.6 32.2 L22.6 38.6', 'M27.2 34.8 L27.2 41.2'];
/** Vertices of the hexagon, drawn as nodes. */
export const MARK_NODES: [number, number][] = [
  [32, 3], [57, 17.5], [57, 46.5], [32, 61], [7, 46.5], [7, 17.5],
];

export const WORDMARK_FONT = "'IBM Plex Serif','Libre Baskerville',Georgia,serif";
export const DESCRIPTOR_FONT = "'IBM Plex Mono',ui-monospace,monospace";
export const DESCRIPTOR_TEXT = 'CONTRACT INTELLIGENCE';

/**
 * The mark as a raw SVG fragment, for the print renderer.
 *
 * `currentColor` throughout, so the caller sets the colour once on the
 * wrapping element exactly as the screen component does.
 */
export function markSvgBody(detail = true): string {
  const node = ([cx, cy]: [number, number]) =>
    `<circle cx="${cx}" cy="${cy}" r="2.1"/>`;
  return `<g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round">
<path d="${MARK_FRAME}" stroke-width="2"/>
${detail ? `<path d="${MARK_INNER}" stroke-width="1" opacity=".45"/>` : ''}
<path d="${MARK_CUBE_TOP}" stroke-width="2" fill="currentColor" fill-opacity=".16"/>
<path d="${MARK_CUBE_LEFT}" stroke-width="2" fill="currentColor" fill-opacity=".07"/>
<path d="${MARK_CUBE_RIGHT}" stroke-width="2" fill="currentColor" fill-opacity=".28"/>
${detail ? `<g stroke-width=".9" opacity=".75">${MARK_COURSES_R.map(d => `<path d="${d}"/>`).join('')}</g>
<g stroke-width=".9" opacity=".6">${MARK_COURSES_L.map(d => `<path d="${d}"/>`).join('')}</g>` : ''}
<g fill="currentColor" stroke="none">${MARK_NODES.map(node).join('')}</g></g>`;
}

/** The mark alone — the page header. Mirrors `<PactumLogo variant="icon" />`. */
export function markSvg(): string {
  return `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">${markSvgBody()}</svg>`;
}

/**
 * The full vertical lockup — the cover page.
 *
 * Coordinates are taken from `PactumLogo`'s `primary` variant so the
 * printed cover and the login splash are the same artwork: viewBox
 * 240x148, mark translated to x=88, wordmark centred at 120/100 at 27px
 * with 0.16em tracking, rule at y=116, descriptor at y=134.
 */
export function lockupSvg(): string {
  return `<svg viewBox="0 0 240 148" fill="none" aria-hidden="true">
<g transform="translate(88 0)">${markSvgBody()}</g>
<text x="120" y="100" fill="${BRAND_IVORY}" text-anchor="middle"
 font-family="${WORDMARK_FONT}" font-size="27" font-weight="600"
 letter-spacing="4.32">PACTUM</text>
<line x1="52" y1="116" x2="188" y2="116" stroke="currentColor" stroke-opacity=".3" stroke-width="1"/>
<text x="120" y="134" fill="currentColor" fill-opacity=".7" text-anchor="middle"
 font-family="${DESCRIPTOR_FONT}" font-size="8.5" letter-spacing="3.6">${DESCRIPTOR_TEXT}</text></svg>`;
}
