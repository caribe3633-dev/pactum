/**
 * PACTUM Brand Mark
 *
 * Abstract geometric symbol representing the platform — NOT a personal monogram.
 * Form: A precision document crest — a rectangle with a folded top-right corner
 * and two internal rule lines, evoking contract governance, architectural precision,
 * and structured intelligence.
 *
 * No initials. No letters. Platform identity only.
 */
import React from 'react';

interface PactumMarkProps {
  /** Rendered size in px (applied to both width and height). Default: 32 */
  size?: number;
  /** Stroke / fill colour. Default: #D4AF5A (matte gold) */
  color?: string;
  /** Show internal rule lines. Auto-hides below 20px. */
  showLines?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean | 'true' | 'false';
}

/**
 * The raw SVG paths that make up the PACTUM mark (32×32 viewBox).
 *
 *   ┌──────────┐╲
 *   │          │  ╲  ← folded corner
 *   │  ──────  │
 *   │  ─────   │
 *   └──────────┘
 *
 * Outer document body   — pentagon, sharp corners, no fill
 * Fold crease           — two-segment right-angle crease
 * Rule line 1 (full)    — wide horizontal bar
 * Rule line 2 (short)   — narrower second bar
 */
export function PactumMark({
  size = 32,
  color = '#D4AF5A',
  showLines,
  className,
  style,
  ...rest
}: PactumMarkProps) {
  const lines = showLines !== undefined ? showLines : size >= 20;
  const sw = Math.max(1, 1.5 * (size / 32));          // scale stroke with size
  const sw2 = Math.max(0.8, 1.2 * (size / 32));       // thinner second line

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      role="img"
      {...rest}
    >
      {/* Document body — pentagon (top-right corner folded) */}
      <path
        d="M4 3 L21 3 L28 10 L28 29 L4 29 Z"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="miter"
      />
      {/* Fold crease — right-angle at corner */}
      <path
        d="M21 3 L21 10 L28 10"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="miter"
      />
      {/* Rule lines — only when size allows */}
      {lines && (
        <>
          <line x1="8" y1="17" x2="24" y2="17" stroke={color} strokeWidth={sw} />
          <line x1="8" y1="22" x2="18" y2="22" stroke={color} strokeWidth={sw2} />
        </>
      )}
    </svg>
  );
}

/**
 * Full horizontal lockup: mark + wordmark.
 * Use for sidebar header, report covers, email headers.
 */
export function PactumLogo({
  markSize = 28,
  color = '#D4AF5A',
  wordmarkColor = '#ffffff',
  subtitleColor,
  subtitle = 'Contract Intelligence',
  className,
}: {
  markSize?: number;
  color?: string;
  wordmarkColor?: string;
  subtitleColor?: string;
  subtitle?: string;
  className?: string;
}) {
  const sc = subtitleColor ?? (color + 'b3'); // 70% opacity gold fallback
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <PactumMark size={markSize} color={color} aria-hidden="true" />
      <div>
        <p
          className="font-serif font-bold tracking-[0.18em] leading-none"
          style={{ color: wordmarkColor, fontSize: markSize * 0.57 }}
        >
          PACTUM
        </p>
        {subtitle && (
          <p
            className="uppercase tracking-widest leading-none mt-1"
            style={{ color: sc, fontSize: markSize * 0.32 }}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Centred vertical lockup: large mark above wordmark.
 * Use for login screen, splash screens, loading states.
 */
export function PactumLogoVertical({
  markSize = 80,
  color = '#D4AF5A',
  wordmarkColor = '#ffffff',
  subtitleColor,
  subtitle,
  className,
}: {
  markSize?: number;
  color?: string;
  wordmarkColor?: string;
  subtitleColor?: string;
  subtitle?: string;
  className?: string;
}) {
  const sc = subtitleColor ?? color + '99';
  return (
    <div className={`flex flex-col items-center gap-5 ${className ?? ''}`}>
      {/* Precision frame around the mark */}
      <div className="relative flex items-center justify-center" style={{ width: markSize + 32, height: markSize + 32 }}>
        {/* Corner tick marks — enterprise precision detail */}
        <span className="absolute top-0 left-0 border-t border-l"
          style={{ width: 14, height: 14, borderColor: color + '80' }} aria-hidden="true" />
        <span className="absolute top-0 right-0 border-t border-r"
          style={{ width: 14, height: 14, borderColor: color + '80' }} aria-hidden="true" />
        <span className="absolute bottom-0 left-0 border-b border-l"
          style={{ width: 14, height: 14, borderColor: color + '80' }} aria-hidden="true" />
        <span className="absolute bottom-0 right-0 border-b border-r"
          style={{ width: 14, height: 14, borderColor: color + '80' }} aria-hidden="true" />
        <PactumMark size={markSize} color={color} aria-hidden="true" />
      </div>

      <div className="text-center">
        <p
          className="font-serif font-bold tracking-[0.3em] leading-none"
          style={{ color: wordmarkColor, fontSize: markSize * 0.5 }}
        >
          PACTUM
        </p>
        {subtitle !== undefined && (
          <p
            className="uppercase tracking-[0.25em] leading-none mt-2"
            style={{ color: sc, fontSize: markSize * 0.18 }}
          >
            {subtitle ?? 'CONTRACT INTELLIGENCE'}
          </p>
        )}
      </div>
    </div>
  );
}

export default PactumMark;
