import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
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

// One variant only — a bare loadFont() registers every subset and times out
// the Lambda render.
const { fontFamily: serifFamily } = loadPlayfair('normal', {
  weights: ['700'],
  subsets: ['latin'],
});

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

/** Inline map-pin glyph — no icon dependency in the Lambda bundle. */
const PinIcon: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label="Location"
  >
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

/**
 * Location outro — the "logo + location" clinic card, on the editorial reel
 * system: warm paper background, the logo inside a clean white disc with a
 * soft shadow, the clinic name in serif (the clinic voice), and the address
 * in tracked caps under a map pin. A slim brand-colour rule anchors the CTA.
 */
export const OutroLocation: React.FC<OutroLayoutProps> = ({ config }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = config.durationInFrames;
  const accent = config.primaryColor || '#C9A96A';

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [duration - 10, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const master = Math.min(fadeIn, fadeOut);

  const logoIn = spring({
    frame: Math.max(0, frame - 4),
    fps,
    config: { damping: 14, stiffness: 120 },
  });
  const nameIn = interpolate(frame, [12, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const nameY = interpolate(nameIn, [0, 1], [18, 0]);
  const addressIn = interpolate(frame, [20, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const addressY = interpolate(addressIn, [0, 1], [16, 0]);
  const ctaIn = interpolate(frame, [30, 42], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#FAF7F2',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: master,
        overflow: 'hidden',
      }}
    >
      {/* Whisper of brand colour at the top edge — depth without noise. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, ${accent}1F 0%, transparent 42%)`,
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          padding: '0 10%',
        }}
      >
        {/* Logo on a clean white disc. */}
        <div
          style={{
            width: 460,
            height: 460,
            borderRadius: '50%',
            backgroundColor: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 24px 80px ${accent}40, 0 8px 28px rgba(21,22,28,0.12)`,
            opacity: logoIn,
            transform: `scale(${0.85 + logoIn * 0.15})`,
          }}
        >
          {config.logoUrl ? (
            <Img
              src={config.logoUrl}
              style={{ width: 340, height: 340, objectFit: 'contain' }}
            />
          ) : (
            <span
              style={{
                fontFamily: serifFamily,
                fontSize: 150,
                fontWeight: 700,
                color: '#15161C',
              }}
            >
              {(config.businessName || 'B').slice(0, 1)}
            </span>
          )}
        </div>

        {/* Clinic name — serif, the clinic voice. */}
        <div
          style={{
            marginTop: 56,
            fontFamily: serifFamily,
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.15,
            color: '#15161C',
            textAlign: 'center',
            opacity: nameIn,
            transform: `translateY(${nameY}px)`,
          }}
        >
          {config.businessName}
        </div>

        {/* Slim brand rule. */}
        <div
          style={{
            marginTop: 30,
            width: 84,
            height: 5,
            borderRadius: 999,
            backgroundColor: accent,
            opacity: nameIn,
          }}
        />

        {/* Address under a map pin — tracked caps. */}
        {config.address ? (
          <div
            style={{
              marginTop: 34,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              opacity: addressIn,
              transform: `translateY(${addressY}px)`,
            }}
          >
            <PinIcon size={40} color={accent} />
            <span
              style={{
                fontFamily: SANS,
                fontSize: 32,
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                lineHeight: 1.7,
                color: 'rgba(21,22,28,0.72)',
                textAlign: 'center',
                whiteSpace: 'pre-line',
              }}
            >
              {config.address}
            </span>
          </div>
        ) : null}

        {/* Soft CTA. */}
        {config.ctaText ? (
          <span
            style={{
              marginTop: 44,
              fontFamily: SANS,
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              backgroundColor: '#15161C',
              borderRadius: 999,
              padding: '16px 44px',
              opacity: ctaIn,
            }}
          >
            {config.ctaText}
          </span>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
