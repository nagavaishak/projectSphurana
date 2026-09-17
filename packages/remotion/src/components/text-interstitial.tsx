import type React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { TextInterstitial as TextInterstitialConfig } from '../types/video-config';

export interface TextInterstitialLayerProps {
  interstitials: TextInterstitialConfig[];
}

const TextInterstitialItem: React.FC<{
  config: TextInterstitialConfig;
}> = ({ config }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const {
    text,
    durationInFrames,
    verticalPosition = 0.33,
    fontSize = 72,
  } = config;

  // Spring-in scale animation
  const scaleSpring = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.8 },
  });
  const scale = interpolate(scaleSpring, [0, 1], [0.85, 1]);

  // Fade in over first 8 frames
  const fadeIn = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fade out over last 10 frames
  const fadeOutStart = durationInFrames - 10;
  const fadeOut = interpolate(frame, [fadeOutStart, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <>
      <AbsoluteFill
        style={{
          justifyContent: 'flex-start',
          alignItems: 'center',
          paddingTop: `${verticalPosition * 100}%`,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            opacity,
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize,
            fontWeight: 900,
            color: '#FFFFFF',
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            lineHeight: 1.2,
            padding: '0 40px',
            WebkitTextStroke: '3px #000000',
            paintOrder: 'stroke fill',
            textShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
      {config.soundEffectUrl && (
        <Audio src={config.soundEffectUrl} volume={0.5} />
      )}
    </>
  );
};

/**
 * TextInterstitialLayer - renders animated text overlays at configurable positions.
 *
 * Each interstitial springs in (scale 0.85 → 1 + fade) then fades out.
 * Used for transition text like "CLIENT RESULTS COMING NOW".
 */
export const TextInterstitialLayer: React.FC<TextInterstitialLayerProps> = ({
  interstitials,
}) => {
  if (!interstitials || interstitials.length === 0) {
    return null;
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {interstitials.map((config, idx) => (
        <Sequence
          key={`text-interstitial-${idx}`}
          from={config.startFrame}
          durationInFrames={config.durationInFrames}
        >
          <TextInterstitialItem config={config} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
