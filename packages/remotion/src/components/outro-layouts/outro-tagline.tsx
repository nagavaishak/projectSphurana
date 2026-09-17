import type React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { OutroLayoutProps } from '../../types/outro-layouts';

/**
 * Tagline outro layout
 *
 * Clean logo outro with optional tagline text.
 *
 * Layout:
 * - Background color from brand config (falls back to white)
 * - Centered logo (large)
 * - Optional tagline text below logo, colored with primaryColor
 * - Smooth spring + fade animations
 */
export const OutroTagline: React.FC<OutroLayoutProps> = ({ config }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = config.durationInFrames;

  // --- Overall fade-in (frames 0-12) ---
  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // --- Logo spring animation ---
  const logoProgress = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 100 },
  });

  // --- Tagline spring animation (delayed by 8 frames) ---
  const taglineProgress = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 18, stiffness: 80 },
  });

  // --- Fade out (last 12 frames) ---
  const fadeOut = interpolate(frame, [duration - 12, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const masterOpacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: config.backgroundColor || '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: masterOpacity,
      }}
    >
      {/* Logo — large and centered */}
      {config.logoUrl && (
        <Img
          src={config.logoUrl}
          style={{
            width: 504,
            height: 504,
            objectFit: 'contain',
            opacity: logoProgress,
            transform: `scale(${0.82 + logoProgress * 0.18})`,
          }}
        />
      )}

      {/* Tagline text — below logo */}
      {config.tagline && (
        <div
          style={{
            marginTop: 24,
            fontSize: 36,
            fontWeight: 600,
            color: config.primaryColor || '#000000',
            textAlign: 'center',
            opacity: taglineProgress,
            transform: `translateY(${(1 - taglineProgress) * 12}px)`,
            maxWidth: '80%',
          }}
        >
          {config.tagline}
        </div>
      )}
    </AbsoluteFill>
  );
};
