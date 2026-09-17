import type React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { REEL_PALETTE } from '../types/reel-palette';
import type { ImprovesConfig, Scene } from '../types/video-config';

export interface ImprovesLayerProps {
  config: ImprovesConfig;
  bRollScenes: Scene[];
  fps: number;
  durationInFrames: number;
}

type Segment =
  | { kind: 'service'; text: string }
  | { kind: 'improve'; label: string; item: string }
  | { kind: 'cta'; text: string };

const buildSegments = (config: ImprovesConfig): Segment[] => {
  const { serviceName, items, ctaText, improvesLabel = 'IMPROVES:' } = config;
  const segments: Segment[] = [];
  segments.push({ kind: 'service', text: serviceName });
  for (const item of items) {
    segments.push({ kind: 'improve', label: improvesLabel, item });
  }
  segments.push({ kind: 'cta', text: ctaText });
  return segments;
};

/**
 * Compute a [startFrame, durationInFrames] window for each text segment.
 *
 * Preferred: map segments 1:1 onto sorted b-roll scenes so the text changes
 * exactly when the underlying clip cuts.
 *
 * Fallback (mismatched scene/segment counts): split the total duration evenly
 * across the segment count. The video still plays — only the visual cut
 * timing stops lining up with the text change.
 */
const computeWindows = (
  segments: Segment[],
  scenes: Scene[],
  totalFrames: number
): Array<{ startFrame: number; durationInFrames: number }> => {
  if (scenes.length === segments.length) {
    const sorted = [...scenes].sort((a, b) => a.startFrame - b.startFrame);
    return sorted.map((s) => ({
      startFrame: s.startFrame,
      durationInFrames: s.durationInFrames,
    }));
  }
  // Fallback: even split
  const per = Math.floor(totalFrames / segments.length);
  return segments.map((_, i) => ({
    startFrame: i * per,
    durationInFrames: i === segments.length - 1 ? totalFrames - i * per : per,
  }));
};

const SegmentFrame: React.FC<{
  segment: Segment;
  durationInFrames: number;
  accent: string;
}> = ({ segment, durationInFrames, accent }) => {
  const frame = useCurrentFrame();

  // Quick fade in / fade out at segment edges so the cut feels deliberate.
  const fadeIn = interpolate(frame, [0, 5], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 5, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  const baseTextStyle: React.CSSProperties = {
    fontFamily: 'Inter, system-ui, sans-serif',
    color: '#FFFFFF',
    textAlign: 'center',
    textShadow: '0 2px 14px rgba(0, 0, 0, 0.55)',
    letterSpacing: '0.04em',
  };

  if (segment.kind === 'service') {
    return (
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 8%',
          opacity,
        }}
      >
        <div
          style={{
            ...baseTextStyle,
            fontSize: 96,
            fontWeight: 300,
            textTransform: 'uppercase',
            lineHeight: 1.1,
          }}
        >
          {segment.text}
        </div>
      </AbsoluteFill>
    );
  }

  if (segment.kind === 'cta') {
    return (
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 10%',
          opacity,
        }}
      >
        <div
          style={{
            ...baseTextStyle,
            fontSize: 64,
            fontWeight: 400,
            lineHeight: 1.2,
          }}
        >
          {segment.text}
        </div>
      </AbsoluteFill>
    );
  }

  // improve
  return (
    <AbsoluteFill
      style={{
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 8%',
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 34,
          fontWeight: 800,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: REEL_PALETTE.cream,
          backgroundColor: accent,
          borderRadius: 999,
          padding: '10px 32px 10px 40px',
          marginBottom: '8%',
          boxShadow: '0 6px 22px rgba(0,0,0,0.3)',
        }}
      >
        {segment.label}
      </div>
      <div
        style={{
          ...baseTextStyle,
          fontSize: 96,
          fontWeight: 300,
          textTransform: 'uppercase',
          lineHeight: 1.1,
        }}
      >
        {segment.item}
      </div>
    </AbsoluteFill>
  );
};

/**
 * ImprovesLayer — improves-1 organic template.
 *
 * Plays a sequence of timed text states synced to b-roll clip windows:
 *   clip 0: service name (e.g., "MICRONEEDLING")
 *   clip 1..N: "IMPROVES:" + one item per clip
 *   final clip: closing CTA (e.g., "Start your microneedling journey today")
 *
 * When the scene count doesn't match (1 + items + 1), falls back to splitting
 * the total duration evenly across the text states.
 */
export const ImprovesLayer: React.FC<ImprovesLayerProps> = ({
  config,
  bRollScenes,
  fps: _fps,
  durationInFrames,
}) => {
  const segments = buildSegments(config);
  const windows = computeWindows(segments, bRollScenes, durationInFrames);

  return (
    <AbsoluteFill>
      {/* Soft vignette keeps the thin uppercase type legible without a wash. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.14) 30%, rgba(0,0,0,0.14) 70%, rgba(0,0,0,0.4) 100%)',
        }}
      />
      {segments.map((seg, i) => {
        const w = windows[i];
        if (!w) return null;
        return (
          <Sequence
            key={`improves-seg-${i}`}
            from={w.startFrame}
            durationInFrames={w.durationInFrames}
          >
            <SegmentFrame
              segment={seg}
              durationInFrames={w.durationInFrames}
              accent={config.primaryColor ?? REEL_PALETTE.slateSolid}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
