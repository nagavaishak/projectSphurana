import type React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion';
import type { OutroConfig } from '../types/video-config';

export interface OutroProps {
  config: OutroConfig;
}

/**
 * Outro component - displays CTA and branding at the end of the video
 */
export const Outro: React.FC<OutroProps> = ({ config }) => {
  const frame = useCurrentFrame();

  // Fade in animation
  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Scale animation for CTA
  const scale = interpolate(frame, [0, 20], [0.8, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: config.backgroundColor,
        opacity,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 40,
      }}
    >
      {config.logoUrl && (
        <Img
          src={config.logoUrl}
          style={{
            maxWidth: 300,
            maxHeight: 150,
            objectFit: 'contain',
          }}
        />
      )}

      <div
        style={{
          transform: `scale(${scale})`,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 64,
          fontWeight: 700,
          color: config.textColor,
          textAlign: 'center',
          padding: '0 60px',
          lineHeight: 1.2,
        }}
      >
        {config.ctaText}
      </div>
    </AbsoluteFill>
  );
};
