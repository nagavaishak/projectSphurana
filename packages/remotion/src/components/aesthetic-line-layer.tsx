import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { REEL_PALETTE } from '../types/reel-palette';
import type { AestheticLineConfig } from '../types/video-config';

const { fontFamily: serifFamily } = loadPlayfair('italic', {
  weights: ['400'],
  subsets: ['latin'],
});

export interface AestheticLineLayerProps {
  config: AestheticLineConfig;
}

/** Frames the line takes to gently fade in. */
const FADE_IN_FRAMES = 18;
/** Vertical position of the line as a fraction of viewport height. */
const VERTICAL_POSITION = 0.5;

/**
 * AestheticLineLayer — organic "aesthetic line" template.
 *
 * A single understated italic-serif line, lower third, that fades in gently
 * and holds for the whole clip over the b-roll. Quiet, relatable vibe.
 */
export const AestheticLineLayer: React.FC<AestheticLineLayerProps> = ({
  config,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, FADE_IN_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{ justifyContent: 'flex-start', alignItems: 'center' }}
    >
      <div
        style={{
          position: 'absolute',
          top: `${VERTICAL_POSITION * 100}%`,
          transform: 'translateY(-50%)',
          maxWidth: '78%',
          textAlign: 'center',
          opacity,
          fontFamily: serifFamily,
          fontStyle: 'italic',
          fontSize: 52,
          fontWeight: 400,
          color: REEL_PALETTE.cream,
          lineHeight: 1.25,
          textShadow: '0 2px 18px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.7)',
        }}
      >
        {config.text}
      </div>
    </AbsoluteFill>
  );
};
