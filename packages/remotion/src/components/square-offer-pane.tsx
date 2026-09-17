import type React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { OfferCard } from '../types/video-config';

export interface SquareOfferPaneProps {
  card: OfferCard;
  fps: number;
  durationInFrames: number;
}

/**
 * Staggered spring animation helper (matches offer-card-layer pattern)
 */
function useStaggeredSpring(delaySec: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delayFrames = Math.round(delaySec * fps);
  const adjustedFrame = Math.max(0, frame - delayFrames);

  return spring({
    frame: adjustedFrame,
    fps,
    config: { damping: 18, stiffness: 100, mass: 0.8 },
  });
}

/**
 * Checkmark icon SVG rendered inline
 */
const CheckIcon: React.FC<{ color: string; size: number }> = ({
  color,
  size,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    role="img"
    aria-label="Checkmark"
    style={{ flexShrink: 0 }}
  >
    <path
      d="M20 6L9 17L4 12"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * SquareOfferPane — the right 2/5 (432px) white-background pane in the square offer layout.
 *
 * Layout (vertically centered):
 * - Headline: ALL CAPS, brand primaryColor, quotation marks, bold
 * - Bullet points: checkmark icons in primaryColor, text in dark gray
 * - CTA button: primaryColor background, white text, rounded, full width
 *
 * Animation: Staggered spring entrance (same pattern as OfferCardLayer)
 */
export const SquareOfferPane: React.FC<SquareOfferPaneProps> = ({
  card,
  fps: _fps,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const accentColor = card.primaryColor || '#007AFF';
  const headline = card.headline || card.serviceName;
  const bullets = card.bulletPoints ?? [];

  // Staggered entrance animations
  const headlineSpring = useStaggeredSpring(0.2);
  const ctaSpring = useStaggeredSpring(0.6 + bullets.length * 0.1);

  // Fade out in last 6 frames
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 6, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <div
      style={{
        width: 432,
        height: 1080,
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '48px 32px',
        boxSizing: 'border-box',
        opacity: fadeOut,
        overflow: 'hidden',
      }}
    >
      {/* Logo */}
      {card.logoUrl && (
        <div
          style={{
            marginBottom: 24,
            opacity: headlineSpring,
            transform: `scale(${interpolate(headlineSpring, [0, 1], [0.8, 1])})`,
          }}
        >
          <img
            src={card.logoUrl}
            alt=""
            style={{
              width: 56,
              height: 56,
              objectFit: 'contain',
              borderRadius: 12,
            }}
          />
        </div>
      )}

      {/* Headline — ALL CAPS with quotation marks */}
      <div
        style={{
          opacity: headlineSpring,
          transform: `translateY(${interpolate(headlineSpring, [0, 1], [20, 0])}px)`,
          marginBottom: 32,
        }}
      >
        <span
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 36,
            fontWeight: 800,
            color: accentColor,
            lineHeight: 1.15,
            textTransform: 'uppercase',
            display: 'block',
            letterSpacing: 0.5,
          }}
        >
          &ldquo;{headline}&rdquo;
        </span>
      </div>

      {/* Bullet points */}
      {bullets.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            marginBottom: 32,
          }}
        >
          {bullets.map((point, i) => {
            const bulletSpring = useStaggeredSpring(0.4 + i * 0.1);
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  opacity: bulletSpring,
                  transform: `translateX(${interpolate(bulletSpring, [0, 1], [-16, 0])}px)`,
                }}
              >
                <div style={{ marginTop: 2 }}>
                  <CheckIcon color={accentColor} size={22} />
                </div>
                <span
                  style={{
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: 22,
                    fontWeight: 500,
                    color: '#333333',
                    lineHeight: 1.35,
                  }}
                >
                  {point}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* CTA button — full width */}
      <div
        style={{
          opacity: ctaSpring,
          transform: `translateY(${interpolate(ctaSpring, [0, 1], [20, 0])}px)`,
          marginTop: 'auto',
        }}
      >
        <div
          style={{
            width: '100%',
            backgroundColor: accentColor,
            borderRadius: 14,
            padding: '18px 24px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            boxSizing: 'border-box',
          }}
        >
          <span
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 26,
              fontWeight: 700,
              color: '#FFFFFF',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {card.ctaText}
          </span>
        </div>

        {/* Urgency text below CTA */}
        {card.urgencyText && (
          <span
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 16,
              fontWeight: 500,
              color: '#999999',
              textAlign: 'center',
              display: 'block',
              marginTop: 12,
            }}
          >
            {card.urgencyText}
          </span>
        )}
      </div>
    </div>
  );
};
