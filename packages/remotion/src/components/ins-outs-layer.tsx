import type React from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill } from 'remotion';
import { REEL_PALETTE, accentTextColor } from '../types/reel-palette';
import type { InsOutsConfig } from '../types/video-config';

export interface InsOutsLayerProps {
  config: InsOutsConfig;
}

/**
 * A single list line that auto-shrinks horizontally so the text always sits
 * on one line, even when the copy is long. Measures the rendered width and
 * applies `transform: scaleX(...)` when it would overflow the safe area.
 *
 * Measurement runs synchronously via useLayoutEffect, so the scale is correct
 * before the frame is captured by Remotion's renderer.
 */
const SingleLineItem: React.FC<{
  text: string;
  bold?: boolean;
  fontSize: number;
  maxWidthPx: number;
  isLabel?: boolean;
}> = ({ text, bold, fontSize, maxWidthPx, isLabel }) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [scale, setScale] = useState(1);

  // text/fontSize/bold are listed as deps because changing them changes
  // el.offsetWidth — even though the effect body doesn't reference them
  // directly. biome's exhaustive-deps rule misfires on this indirect pattern.
  // biome-ignore lint/correctness/useExhaustiveDependencies: indirect deps via ref.current width
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measured = el.offsetWidth;
    if (measured > maxWidthPx) {
      setScale(maxWidthPx / measured);
    } else {
      setScale(1);
    }
  }, [text, maxWidthPx, fontSize, bold]);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
        // small gap between items
        marginTop: isLabel ? 18 : 6,
        marginBottom: isLabel ? 8 : 0,
      }}
    >
      <span
        ref={ref}
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize,
          fontWeight: bold ? 800 : 500,
          lineHeight: 1.15,
          color: '#FFFFFF',
          whiteSpace: 'nowrap',
          letterSpacing: bold ? '0.02em' : 0,
          textTransform: bold ? 'uppercase' : 'none',
          transform: `scaleX(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {text}
      </span>
    </div>
  );
};

/** Section header rendered as a solid rounded pill — the reel chip treatment. */
const SectionPill: React.FC<{ text: string; accent: string }> = ({
  text,
  accent,
}) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      marginBottom: 14,
    }}
  >
    <span
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 40,
        fontWeight: 800,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: accentTextColor(accent),
        backgroundColor: accent,
        borderRadius: 999,
        padding: '10px 34px 10px 40px',
        boxShadow: '0 6px 22px rgba(0,0,0,0.3)',
      }}
    >
      {text}
    </span>
  </div>
);

/**
 * InsOutsLayer — ins-outs-1 organic template.
 *
 * Title at top, INS section (bold header + items), gap, OUTS section
 * (bold header + items). All text white, sans-serif, centered. Items render
 * on a single line — long items auto-shrink via scaleX.
 *
 * A semi-transparent dark scrim sits over the b-roll for legibility.
 */
export const InsOutsLayer: React.FC<InsOutsLayerProps> = ({ config }) => {
  const {
    title,
    insLabel = 'INS',
    insItems,
    outsLabel = 'OUTS',
    outsItems,
  } = config;

  // Reserve ~6% of viewport on each side; portrait video is 1080px wide so
  // the safe area is ~950px. Same fraction maps reasonably for other orientations.
  const safeAreaPx = 950;

  return (
    <AbsoluteFill>
      {/* Cinematic scrim: heavier top/bottom bands, footage breathes mid-frame. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0.3) 35%, rgba(0,0,0,0.3) 65%, rgba(0,0,0,0.62) 100%)',
        }}
      />

      <AbsoluteFill
        style={{
          padding: '6% 5% 8%',
          color: '#FFFFFF',
          textShadow: '0 2px 14px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
        }}
      >
        {/* Title */}
        <div style={{ marginTop: '6%' }}>
          <SingleLineItem
            text={title}
            bold
            fontSize={54}
            maxWidthPx={safeAreaPx}
          />
        </div>

        {/* INS section */}
        <div style={{ marginTop: '8%', width: '100%' }}>
          <SectionPill
            text={insLabel}
            accent={config.primaryColor ?? REEL_PALETTE.blush}
          />
          {insItems.map((item) => (
            <SingleLineItem
              key={`in-${item}`}
              text={item}
              fontSize={46}
              maxWidthPx={safeAreaPx}
            />
          ))}
        </div>

        {/* OUTS section */}
        <div style={{ marginTop: '6%', width: '100%' }}>
          <SectionPill text={outsLabel} accent={REEL_PALETTE.slateSolid} />
          {outsItems.map((item) => (
            <SingleLineItem
              key={`out-${item}`}
              text={item}
              fontSize={46}
              maxWidthPx={safeAreaPx}
            />
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
