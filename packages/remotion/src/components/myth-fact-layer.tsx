import type React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { REEL_PALETTE } from '../types/reel-palette';
import type { MythFactConfig } from '../types/video-config';

export interface MythFactLayerProps {
  config: MythFactConfig;
  durationInFrames: number;
}

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";
const MYTH_RED = '#D64550';
const FACT_GREEN = '#3E8E68';

/** One state card: MYTH/FACT pill + statement on a cream card. */
const StateCard: React.FC<{
  kind: 'myth' | 'fact';
  text: string;
  struck: boolean;
  durationInFrames: number;
}> = ({ kind, text, struck, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 10,
  });
  const scale = interpolate(enter, [0, 1], [1.05, 1]);
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 6, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        opacity: Math.min(enter, fadeOut),
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 30,
          transform: `scale(${scale})`,
          width: '82%',
        }}
      >
        <span
          style={{
            fontFamily: SANS,
            fontSize: 46,
            fontWeight: 800,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#FFFFFF',
            backgroundColor: kind === 'myth' ? MYTH_RED : FACT_GREEN,
            borderRadius: 999,
            padding: '12px 42px 12px 52px',
            boxShadow: '0 8px 26px rgba(0,0,0,0.35)',
          }}
        >
          {kind === 'myth' ? 'Myth' : 'Fact'}
        </span>
        <div
          style={{
            backgroundColor: 'rgba(250,247,242,0.92)',
            borderRadius: 28,
            padding: '38px 44px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
          }}
        >
          <span
            style={{
              fontFamily: SANS,
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.28,
              color: REEL_PALETTE.slate,
              textDecoration: struck ? 'line-through' : 'none',
              textDecorationColor: MYTH_RED,
              textDecorationThickness: struck ? 5 : undefined,
            }}
          >
            {text}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * MythFactLayer — organic "myth → fact" debunk template.
 *
 * A confidently wrong belief lands on a cream card under a red MYTH pill,
 * holds one beat, then flips to the green FACT correction — the observed
 * red→green resolution that carries the format. An optional series label
 * persists up top; an optional CTA card closes.
 */
export const MythFactLayer: React.FC<MythFactLayerProps> = ({
  config,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const titleIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Segments: myth + fact per pair, plus an optional CTA beat.
  const segments: Array<
    | { kind: 'myth' | 'fact'; text: string; struck: boolean }
    | { kind: 'cta'; text: string }
  > = [];
  for (const pair of config.pairs) {
    segments.push({ kind: 'myth', text: pair.myth, struck: false });
    segments.push({ kind: 'fact', text: pair.fact, struck: false });
  }
  if (config.ctaText) segments.push({ kind: 'cta', text: config.ctaText });

  const per = Math.floor(durationInFrames / Math.max(segments.length, 1));

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.28) 40%, rgba(0,0,0,0.28) 65%, rgba(0,0,0,0.55) 100%)',
        }}
      />
      {config.seriesTitle ? (
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'flex-start',
            paddingTop: '11%',
            opacity: titleIn,
          }}
        >
          <span
            style={{
              fontFamily: SANS,
              fontSize: 42,
              fontWeight: 800,
              letterSpacing: '0.24em',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              textShadow: '0 3px 18px rgba(0,0,0,0.55)',
            }}
          >
            {config.seriesTitle}
          </span>
        </AbsoluteFill>
      ) : null}

      {segments.map((seg, i) => {
        const from = i * per;
        const dur = i === segments.length - 1 ? durationInFrames - from : per;
        return (
          <Sequence key={`seg-${i}`} from={from} durationInFrames={dur}>
            {seg.kind === 'cta' ? (
              <AbsoluteFill
                style={{ alignItems: 'center', justifyContent: 'center' }}
              >
                <span
                  style={{
                    fontFamily: SANS,
                    fontSize: 46,
                    fontWeight: 800,
                    color: '#FFFFFF',
                    backgroundColor: REEL_PALETTE.slateSolid,
                    borderRadius: 999,
                    padding: '18px 44px',
                    boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
                  }}
                >
                  {seg.text}
                </span>
              </AbsoluteFill>
            ) : (
              <StateCard
                kind={seg.kind}
                text={seg.text}
                struck={false}
                durationInFrames={dur}
              />
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
