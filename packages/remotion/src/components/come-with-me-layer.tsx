import { loadFont as loadAllura } from '@remotion/google-fonts/Allura';
import type React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { REEL_PALETTE } from '../types/reel-palette';
import type { ComeWithMeConfig } from '../types/video-config';

// One variant only — a bare loadFont() registers every subset and times out
// the Lambda render.
const { fontFamily: scriptFamily } = loadAllura('normal', {
  weights: ['400'],
  subsets: ['latin'],
});

export interface ComeWithMeLayerProps {
  config: ComeWithMeConfig;
  durationInFrames: number;
}

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

/**
 * ComeWithMeLayer — organic "come with me" mini-vlog template.
 *
 * The invitation format: a handwritten script title drifts in centre-frame
 * ("come get a hydrating facial with me"), then lowercase diary-tone step
 * captions ride the top of the frame one beat at a time, closing on the
 * clinic CTA. Calm is the aesthetic — fades and drift, no pops.
 */
export const ComeWithMeLayer: React.FC<ComeWithMeLayerProps> = ({
  config,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  const segments = 1 + config.steps.length + 1; // title, steps, closing
  const per = Math.floor(durationInFrames / segments);

  const chipIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.1) 30%, rgba(0,0,0,0.1) 70%, rgba(0,0,0,0.42) 100%)',
        }}
      />

      {config.seriesChip ? (
        <div
          style={{
            position: 'absolute',
            top: '6%',
            left: '6%',
            fontFamily: SANS,
            fontSize: 30,
            fontWeight: 700,
            color: REEL_PALETTE.slate,
            backgroundColor: 'rgba(250,247,242,0.92)',
            borderRadius: 999,
            padding: '8px 22px',
            opacity: chipIn,
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          }}
        >
          {config.seriesChip}
        </div>
      ) : null}

      {/* Title beat: script font, slight rotation, gentle drift. */}
      <Sequence durationInFrames={per}>
        <TitleBeat text={config.title} durationInFrames={per} />
      </Sequence>

      {/* Step captions: top-centre, lowercase, one per beat. */}
      {config.steps.map((step, i) => {
        const from = (i + 1) * per;
        return (
          <Sequence key={`step-${i}`} from={from} durationInFrames={per}>
            <StepBeat text={step} durationInFrames={per} />
          </Sequence>
        );
      })}

      {/* Closing CTA. */}
      <Sequence
        from={(config.steps.length + 1) * per}
        durationInFrames={durationInFrames - (config.steps.length + 1) * per}
      >
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingBottom: '24%',
          }}
        >
          <span
            style={{
              fontFamily: SANS,
              fontSize: 40,
              fontWeight: 700,
              color: REEL_PALETTE.slate,
              backgroundColor: 'rgba(250,247,242,0.94)',
              borderRadius: 999,
              padding: '16px 38px',
              boxShadow: '0 8px 28px rgba(0,0,0,0.3)',
            }}
          >
            {config.closingCta}
          </span>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

const TitleBeat: React.FC<{ text: string; durationInFrames: number }> = ({
  text,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 8, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.02]);
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 8%',
      }}
    >
      <span
        style={{
          fontFamily: scriptFamily,
          fontSize: 92,
          lineHeight: 1.2,
          textAlign: 'center',
          color: REEL_PALETTE.cream,
          textShadow: '0 4px 26px rgba(0,0,0,0.55)',
          opacity: Math.min(fadeIn, fadeOut),
          transform: `rotate(-3deg) scale(${drift})`,
        }}
      >
        {text}
      </span>
    </AbsoluteFill>
  );
};

const StepBeat: React.FC<{ text: string; durationInFrames: number }> = ({
  text,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 9], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
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
        justifyContent: 'flex-start',
        paddingTop: '10%',
        padding: '10% 8% 0',
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontSize: 42,
          fontWeight: 600,
          textAlign: 'center',
          textTransform: 'lowercase',
          color: '#FFFFFF',
          textShadow: '0 3px 18px rgba(0,0,0,0.6)',
          opacity: Math.min(fadeIn, fadeOut),
        }}
      >
        {text}
      </span>
    </AbsoluteFill>
  );
};
