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
 * Offer outro layout (matches SVG 1 design)
 *
 * Uses the org's primaryColor as a bold background to feel distinct.
 * Works without specific offer pricing — uses businessName + ctaText
 * with an animated highlight stripe for the "offer" feel.
 *
 * Layout:
 * - Solid primaryColor background
 * - Decorative line separators flanking the logo area
 * - Logo centered with fade-in + scale
 * - Tagline below logo (serif, spaced)
 * - Business name / service text
 * - CTA text with animated highlight stripe
 */
export const OutroOffer: React.FC<OutroLayoutProps> = ({ config }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = config.durationInFrames;

  // --- Overall fade-in (frames 0-12) ---
  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // --- Logo spring animation ---
  const logoProgress = spring({ frame, fps, config: { damping: 14 } });

  // --- Tagline fade-in (frames 12-24) ---
  const taglineOpacity = interpolate(frame, [12, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // --- Decorative lines wipe-in (frames 8-22) ---
  const lineWidth = interpolate(frame, [8, 22], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // --- Business name slide-up + fade (frames 20-34) ---
  const nameOpacity = interpolate(frame, [20, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const nameY = interpolate(frame, [20, 34], [40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // --- CTA text slide-up + fade (frames 30-44) ---
  const ctaOpacity = interpolate(frame, [30, 44], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ctaY = interpolate(frame, [30, 44], [40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // --- Highlight stripe wipe (frames 36-52) ---
  const highlightWidth = interpolate(frame, [36, 52], [0, 110], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // --- Fade out (last 12 frames) ---
  const fadeOut = interpolate(frame, [duration - 12, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const masterOpacity = Math.min(fadeIn, fadeOut);
  const bgColor = config.primaryColor || '#939D93';

  return (
    <AbsoluteFill
      style={{
        backgroundColor: bgColor,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: masterOpacity,
      }}
    >
      {/* Logo */}
      {config.logoUrl && (
        <Img
          src={config.logoUrl}
          style={{
            width: 430,
            height: 320,
            objectFit: 'contain',
            marginBottom: 16,
            opacity: logoProgress,
            transform: `scale(${0.85 + logoProgress * 0.15})`,
          }}
        />
      )}

      {/* Decorative lines flanking tagline area */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          marginBottom: config.tagline ? 0 : 80,
        }}
      >
        <div
          style={{
            width: `${lineWidth * 2}px`,
            maxWidth: 200,
            height: 1,
            backgroundColor: 'rgba(255,255,255,0.5)',
          }}
        />
        <div
          style={{
            width: `${lineWidth * 2}px`,
            maxWidth: 200,
            height: 1,
            backgroundColor: 'rgba(255,255,255,0.5)',
          }}
        />
      </div>

      {/* Tagline below logo */}
      {config.tagline && (
        <div
          style={{
            fontFamily: 'Georgia, serif',
            fontSize: 36,
            fontWeight: 400,
            color: 'rgba(255,255,255,0.9)',
            textAlign: 'center',
            letterSpacing: 3,
            opacity: taglineOpacity,
            marginTop: 12,
            marginBottom: 80,
          }}
        >
          {config.tagline}
        </div>
      )}

      {/* Business name / service text */}
      <div
        style={{
          fontFamily: 'sans-serif',
          fontSize: 54,
          fontWeight: 400,
          color: '#FFFFFF',
          textAlign: 'center',
          lineHeight: 1.35,
          maxWidth: '85%',
          marginBottom: 48,
          opacity: nameOpacity,
          transform: `translateY(${nameY}px)`,
        }}
      >
        {config.businessName}
      </div>

      {/* CTA with highlight stripe */}
      {config.ctaText && (
        <div
          style={{
            position: 'relative',
            opacity: ctaOpacity,
            transform: `translateY(${ctaY}px)`,
          }}
        >
          <div
            style={{
              fontFamily: 'sans-serif',
              fontSize: 72,
              fontWeight: 700,
              color: '#FFFFFF',
              textAlign: 'center',
              position: 'relative',
              zIndex: 1,
              paddingLeft: 24,
              paddingRight: 24,
              textTransform: 'uppercase',
              letterSpacing: 2,
            }}
          >
            {config.ctaText}
          </div>

          {/* Animated highlight stripe behind CTA */}
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: `${Math.max(0, (100 - highlightWidth) / 2)}%`,
              width: `${Math.min(highlightWidth, 110)}%`,
              height: 22,
              backgroundColor: config.secondaryColor || '#FEEF38',
              zIndex: 0,
            }}
          />
        </div>
      )}
    </AbsoluteFill>
  );
};
