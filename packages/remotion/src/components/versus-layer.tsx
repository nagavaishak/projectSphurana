import type React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { REEL_PALETTE, accentTextColor } from '../types/reel-palette';
import type { VersusConfig } from '../types/video-config';

export interface VersusLayerProps {
  config: VersusConfig;
  durationInFrames: number;
}

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

const NameCard: React.FC<{
  text: string;
  accent?: string;
  fromLeft: boolean;
  delay: number;
  big?: boolean;
}> = ({ text, accent, fromLeft, delay, big }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 16, stiffness: 140, mass: 0.8 },
    durationInFrames: 12,
  });
  const x = interpolate(enter, [0, 1], [fromLeft ? -80 : 80, 0]);
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        fontFamily: SANS,
        fontSize: big ? 74 : 44,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
        color: accent ? accentTextColor(accent) : REEL_PALETTE.slate,
        backgroundColor: accent ?? 'rgba(250,247,242,0.94)',
        borderRadius: 18,
        padding: big ? '16px 34px' : '10px 26px',
        boxShadow: '0 10px 32px rgba(0,0,0,0.32)',
        opacity: enter,
        transform: `translateX(${x}px)`,
      }}
    >
      {text}
    </span>
  );
};

/**
 * VersusLayer — organic "X vs Y" treatment-comparison template.
 *
 * Hook beat: the two treatment names stacked on cream cards with a small VS
 * chip. Then one attribute round per beat (label pill up top, the two answers
 * as slate bars lower-third), closing on a verdict card. Every beat restates
 * context — reels are entered mid-scroll.
 */
export const VersusLayer: React.FC<VersusLayerProps> = ({
  config,
  durationInFrames,
}) => {
  const accent = config.primaryColor ?? REEL_PALETTE.blush;
  const segments = 1 + config.rounds.length + 1;
  const per = Math.floor(durationInFrames / segments);

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.26) 38%, rgba(0,0,0,0.3) 62%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* Beat 1: title stack. */}
      <Sequence durationInFrames={per}>
        <AbsoluteFill
          style={{
            flexDirection: 'column',
            justifyContent: 'center',
            paddingLeft: '9%',
            gap: 20,
          }}
        >
          <NameCard
            text={config.treatmentA}
            accent={accent}
            fromLeft
            delay={2}
            big
          />
          <NameCard text="VS" fromLeft={false} delay={10} />
          <NameCard text={config.treatmentB} fromLeft delay={6} big />
        </AbsoluteFill>
      </Sequence>

      {/* Attribute rounds. */}
      {config.rounds.map((round, i) => {
        const from = (i + 1) * per;
        return (
          <Sequence key={`round-${i}`} from={from} durationInFrames={per}>
            <RoundBeat
              label={round.label}
              a={`${config.treatmentA}: ${round.aValue}`}
              b={`${config.treatmentB}: ${round.bValue}`}
              accent={accent}
            />
          </Sequence>
        );
      })}

      {/* Verdict beat. */}
      <Sequence
        from={(config.rounds.length + 1) * per}
        durationInFrames={durationInFrames - (config.rounds.length + 1) * per}
      >
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 9%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 26,
              width: '100%',
            }}
          >
            <span
              style={{
                fontFamily: SANS,
                fontSize: 42,
                fontWeight: 800,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: accentTextColor(accent),
                backgroundColor: accent,
                borderRadius: 999,
                padding: '12px 40px 12px 50px',
                boxShadow: '0 8px 26px rgba(0,0,0,0.35)',
              }}
            >
              The Verdict
            </span>
            <div
              style={{
                backgroundColor: 'rgba(250,247,242,0.92)',
                borderRadius: 28,
                padding: '34px 40px',
                textAlign: 'center',
                boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
              }}
            >
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: 46,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  color: REEL_PALETTE.slate,
                }}
              >
                {config.verdict}
              </span>
            </div>
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

const RoundBeat: React.FC<{
  label: string;
  a: string;
  b: string;
  accent: string;
}> = ({ label, a, b, accent }) => {
  const frame = useCurrentFrame();
  const labelIn = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const aIn = interpolate(frame, [4, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bIn = interpolate(frame, [10, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bar: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 44,
    fontWeight: 700,
    lineHeight: 1.25,
    color: '#FFFFFF',
    backgroundColor: 'rgba(13,15,24,0.66)',
    borderRadius: 14,
    padding: '12px 26px',
    maxWidth: '86%',
  };
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: '13%',
          opacity: labelIn,
        }}
      >
        <span
          style={{
            fontFamily: SANS,
            fontSize: 46,
            fontWeight: 800,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: accentTextColor(accent),
            backgroundColor: accent,
            borderRadius: 999,
            padding: '10px 36px 10px 44px',
            boxShadow: '0 8px 26px rgba(0,0,0,0.35)',
          }}
        >
          {label}
        </span>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: '16%',
          gap: 16,
        }}
      >
        <span
          style={{
            ...bar,
            opacity: aIn,
            transform: `translateX(${(1 - aIn) * -40}px)`,
          }}
        >
          {a}
        </span>
        <span
          style={{
            ...bar,
            opacity: bIn,
            transform: `translateX(${(1 - bIn) * 40}px)`,
          }}
        >
          {b}
        </span>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
