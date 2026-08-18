import React from 'react';
// SINGLE SOURCE OF GEOMETRY. The print renderer reads the same module, so
// a change to the mark reaches the screen AND every generated report.
// Previously the renderer carried its own pasted copy of these paths.
import {
  BRAND_GOLD, BRAND_IVORY, DESCRIPTOR_FONT, DESCRIPTOR_TEXT, WORDMARK_FONT,
  MARK_FRAME, MARK_INNER, MARK_CUBE_TOP, MARK_CUBE_LEFT, MARK_CUBE_RIGHT,
  MARK_COURSES_R, MARK_COURSES_L, MARK_NODES,
} from '../lib/reporting/brandMark';

/**
 * PACTUM logo system.
 *
 * The mark is a redrawn, simplified version of the brand emblem: an
 * isometric cube inside a hexagonal frame. Everything is vector, so it stays
 * sharp at 16px in a favicon and at 400px on a splash screen. No image is
 * loaded and nothing here reads application state.
 *
 * Variants
 *   icon        the mark alone
 *   horizontal  mark + wordmark side by side  — application header
 *   vertical    mark above wordmark           — login / splash
 *   primary     vertical with the descriptor line
 *   favicon     heaviest strokes, no fine detail, for 16-32px
 */

export type LogoVariant = 'icon' | 'horizontal' | 'vertical' | 'primary' | 'favicon';

interface Props {
  variant?: LogoVariant;
  /** Height of the mark in px. The wordmark scales from it. */
  size?: number;
  /** Mark colour. Defaults to the gold accent. */
  color?: string;
  /** Wordmark colour. Defaults to ivory. */
  textColor?: string;
  className?: string;
  title?: string;
}

const GOLD = BRAND_GOLD;
const IVORY = BRAND_IVORY;

/** The mark. `weight` thickens strokes for small renders. */
function Mark({ c, weight = 1, detail = true }: { c: string; weight?: number; detail?: boolean }) {
  const w = (n: number) => n * weight;
  return (
    <g fill="none" stroke={c} strokeLinejoin="round" strokeLinecap="round">
      {/* Hexagonal frame — the industrial container. */}
      <path d={MARK_FRAME} strokeWidth={w(2)} />
      {/* Inner frame, dropped on the favicon where it would fill in. */}
      {detail && (
        <path d={MARK_INNER} strokeWidth={w(1)} opacity={0.45} />
      )}

      {/* Isometric cube — top face. */}
      <path d={MARK_CUBE_TOP} strokeWidth={w(2)} fill={c} fillOpacity={0.16} />
      {/* Left face */}
      <path d={MARK_CUBE_LEFT} strokeWidth={w(2)} fill={c} fillOpacity={0.07} />
      {/* Right face */}
      <path d={MARK_CUBE_RIGHT} strokeWidth={w(2)} fill={c} fillOpacity={0.28} />

      {/* Structural courses on the right face — the "built" reading. */}
      {detail && (
        <g strokeWidth={w(0.9)} opacity={0.75}>
          {MARK_COURSES_R.map(d => <path key={d} d={d} />)}
        </g>
      )}
      {/* Openings on the left face. */}
      {detail && (
        <g strokeWidth={w(0.9)} opacity={0.6}>
          {MARK_COURSES_L.map(d => <path key={d} d={d} />)}
        </g>
      )}

      {/* Six vertex nodes — the network the original emblem implied. */}
      {detail && (
        <g fill={c} stroke="none">
          {MARK_NODES.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={w(2.1)} />
          ))}
        </g>
      )}
    </g>
  );
}

export default function PactumLogo({
  variant = 'horizontal',
  size = 40,
  color = GOLD,
  textColor = IVORY,
  className,
  title = 'PACTUM',
}: Props) {
  const a11y = { role: 'img' as const, 'aria-label': title };

  if (variant === 'favicon') {
    return (
      <svg viewBox="0 0 64 64" width={size} height={size} className={className} {...a11y}>
        <rect width="64" height="64" fill="#121414" />
        <g transform="translate(4 4) scale(0.875)">
          <Mark c={color} weight={1.5} detail={false} />
        </g>
      </svg>
    );
  }

  if (variant === 'icon') {
    return (
      <svg viewBox="0 0 64 64" width={size} height={size} className={className} {...a11y}>
        <Mark c={color} />
      </svg>
    );
  }

  // Wordmark: serif, wide tracking, drawn as text so it stays selectable-free
  // inside the SVG but renders with the system serif.
  const word = (x: number, y: number, fs: number, anchor: 'start' | 'middle') => (
    <text
      x={x} y={y} fill={textColor} textAnchor={anchor}
      fontFamily={WORDMARK_FONT}
      fontSize={fs} fontWeight={600} letterSpacing={fs * 0.16}
    >
      PACTUM
    </text>
  );

  if (variant === 'horizontal') {
    // 64 mark + 20 gutter + wordmark
    return (
      <svg viewBox="0 0 260 64" height={size} className={className} {...a11y}>
        <Mark c={color} />
        {/* Hairline divider keeps the mark and word from crowding. */}
        <line x1="78" y1="16" x2="78" y2="48" stroke={color} strokeOpacity={0.28} strokeWidth={1} />
        {word(94, 41, 26, 'start')}
      </svg>
    );
  }

  if (variant === 'vertical') {
    return (
      <svg viewBox="0 0 200 116" height={size * 1.8} className={className} {...a11y}>
        <g transform="translate(68 0)"><Mark c={color} /></g>
        {word(100, 100, 26, 'middle')}
      </svg>
    );
  }

  // primary — vertical plus the descriptor rule
  return (
    <svg viewBox="0 0 240 148" height={size * 2.3} className={className} {...a11y}>
      <g transform="translate(88 0)"><Mark c={color} /></g>
      {word(120, 100, 27, 'middle')}
      <line x1="52" y1="116" x2="188" y2="116" stroke={color} strokeOpacity={0.3} strokeWidth={1} />
      <text
        x="120" y="134" fill={color} fillOpacity={0.7} textAnchor="middle"
        fontFamily={DESCRIPTOR_FONT}
        fontSize="8.5" letterSpacing="3.6"
      >
        {DESCRIPTOR_TEXT}
      </text>
    </svg>
  );
}
