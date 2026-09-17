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
import type { ClientQuestionConfig } from '../types/video-config';

export interface ClientQuestionLayerProps {
  config: ClientQuestionConfig;
  durationInFrames: number;
}

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

/**
 * ClientQuestionLayer — organic "pinned client question" template.
 *
 * The TikTok reply-sticker pattern: a white speech bubble with a (fake-
 * anonymised) client question pops in at frame 0 top-left and then NEVER
 * moves — its stillness against the changing b-roll is the signature look.
 * Answer beats swap in the lower third, first beat answering directly.
 */
export const ClientQuestionLayer: React.FC<ClientQuestionLayerProps> = ({
  config,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bubbleIn = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.7 },
    durationInFrames: 10,
  });

  const beats = [...config.answers];
  const segments = beats.length + (config.ctaText ? 1 : 0);
  const per = Math.floor(durationInFrames / Math.max(segments, 1));

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.14) 34%, rgba(0,0,0,0.2) 62%, rgba(0,0,0,0.58) 100%)',
        }}
      />

      {/* The pinned question bubble — pops once, then static. */}
      <div
        style={{
          position: 'absolute',
          top: '8.5%',
          left: '6%',
          width: '62%',
          backgroundColor: 'rgba(255,255,255,0.97)',
          borderRadius: 22,
          padding: '22px 28px',
          boxShadow: '0 10px 34px rgba(0,0,0,0.28)',
          opacity: bubbleIn,
          transform: `scale(${interpolate(bubbleIn, [0, 1], [0.8, 1])})`,
          transformOrigin: 'top left',
        }}
      >
        <span
          style={{
            display: 'block',
            fontFamily: SANS,
            fontSize: 26,
            fontWeight: 600,
            color: 'rgba(21,22,28,0.55)',
            marginBottom: 8,
          }}
        >
          Replying to {config.asker}
        </span>
        <span
          style={{
            fontFamily: SANS,
            fontSize: 40,
            fontWeight: 700,
            lineHeight: 1.28,
            color: REEL_PALETTE.slate,
          }}
        >
          {config.question}
        </span>
        {/* Bubble tail. */}
        <div
          style={{
            position: 'absolute',
            bottom: -16,
            left: 44,
            width: 0,
            height: 0,
            borderLeft: '16px solid transparent',
            borderRight: '16px solid transparent',
            borderTop: '18px solid rgba(255,255,255,0.97)',
          }}
        />
      </div>

      {/* Answer beats, lower third, one per beat. */}
      {beats.map((beat, i) => {
        const from = i * per;
        const dur = i === segments - 1 ? durationInFrames - from : per;
        return (
          <Sequence key={`beat-${i}`} from={from} durationInFrames={dur}>
            <AnswerBeat text={beat} durationInFrames={dur} />
          </Sequence>
        );
      })}

      {config.ctaText ? (
        <Sequence
          from={beats.length * per}
          durationInFrames={durationInFrames - beats.length * per}
        >
          <AnswerBeat text={config.ctaText} durationInFrames={per} pill />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

const AnswerBeat: React.FC<{
  text: string;
  durationInFrames: number;
  pill?: boolean;
}> = ({ text, durationInFrames, pill }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 5, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: '18%',
        padding: '0 8% 18%',
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontSize: pill ? 40 : 50,
          fontWeight: 800,
          lineHeight: 1.25,
          textAlign: 'center',
          color: '#FFFFFF',
          backgroundColor: pill
            ? REEL_PALETTE.slateSolid
            : 'rgba(13,15,24,0.6)',
          borderRadius: pill ? 999 : 16,
          padding: pill ? '16px 38px' : '14px 28px',
          opacity: Math.min(enter, fadeOut),
          transform: `translateY(${(1 - enter) * 18}px)`,
        }}
      >
        {text}
      </span>
    </AbsoluteFill>
  );
};
