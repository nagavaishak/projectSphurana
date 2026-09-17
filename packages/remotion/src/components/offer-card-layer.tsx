import type React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { OfferCard } from '../types/video-config';

export interface OfferCardLayerProps {
  card: OfferCard;
  fps: number;
  /** When the card should appear (frame number) */
  startFrame: number;
  /** How long the card is visible */
  durationInFrames: number;
  /** Card visual style */
  variant?: 'dark-overlay' | 'clean-info';
}

/**
 * Format price from cents using Intl.NumberFormat
 */
function formatPrice(cents: number, currencyCode = 'EUR'): string {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Create a staggered spring animation helper
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
 * Animated discount badge with overshoot spring
 */
const DiscountBadge: React.FC<{
  percent: number;
  accentColor: string;
  delaySec: number;
}> = ({ percent, accentColor, delaySec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delayFrames = Math.round(delaySec * fps);
  const adjustedFrame = Math.max(0, frame - delayFrames);

  const scaleSpring = spring({
    frame: adjustedFrame,
    fps,
    config: { damping: 12, stiffness: 150, mass: 0.6 },
  });

  const scale = interpolate(scaleSpring, [0, 1], [0, 1]);
  const opacity = interpolate(scaleSpring, [0, 0.3], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: 120,
        height: 120,
        borderRadius: '50%',
        backgroundColor: accentColor,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        transform: `scale(${scale})`,
        opacity,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}
    >
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 36,
          fontWeight: 900,
          color: '#FFFFFF',
          lineHeight: 1,
        }}
      >
        {percent}%
      </span>
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 18,
          fontWeight: 700,
          color: '#FFFFFF',
          lineHeight: 1,
          marginTop: 2,
        }}
      >
        OFF
      </span>
    </div>
  );
};

/**
 * Dark overlay variant — pricing card over video footage
 */
const DarkOverlayCard: React.FC<{
  card: OfferCard;
  durationInFrames: number;
}> = ({ card, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accentColor = card.primaryColor || '#007AFF';
  const currency = card.currencyCode || 'EUR';

  // Background fade in
  const bgOpacity = interpolate(frame, [0, Math.round(0.3 * fps)], [0, 0.85], {
    extrapolateRight: 'clamp',
  });

  // Staggered element animations
  const titleSpring = useStaggeredSpring(0.1);
  const priceSpring = useStaggeredSpring(0.7);
  const ctaSpring = useStaggeredSpring(1.2);
  const urgencyOpacity = interpolate(
    frame,
    [Math.round(1.4 * fps), Math.round(1.6 * fps)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Fade out in last 6 frames
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 6, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      {/* Semi-transparent dark background */}
      <AbsoluteFill
        style={{ backgroundColor: `rgba(0, 0, 0, ${bgOpacity})` }}
      />

      {/* Card content */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '75%',
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        {/* Discount badge - top right */}
        {card.discountPercent != null && card.discountPercent > 0 && (
          <div style={{ position: 'absolute', top: -60, right: 0 }}>
            <DiscountBadge
              percent={card.discountPercent}
              accentColor={accentColor}
              delaySec={0.5}
            />
          </div>
        )}

        {/* Service name */}
        <div
          style={{
            transform: `translateX(${interpolate(titleSpring, [0, 1], [-40, 0])}px)`,
            opacity: titleSpring,
          }}
        >
          <span
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 56,
              fontWeight: 800,
              color: '#FFFFFF',
              lineHeight: 1.1,
              display: 'block',
            }}
          >
            {card.serviceName}
          </span>
          {card.audienceText && (
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 28,
                fontWeight: 500,
                color: 'rgba(255,255,255,0.7)',
                marginTop: 8,
                display: 'block',
              }}
            >
              {card.audienceText}
            </span>
          )}
        </div>

        {/* Divider */}
        <div
          style={{
            width: '60%',
            height: 2,
            backgroundColor: 'rgba(255,255,255,0.2)',
            opacity: titleSpring,
          }}
        />

        {/* Pricing */}
        <div style={{ opacity: priceSpring }}>
          {card.offerPriceCents != null && (
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 72,
                fontWeight: 900,
                color: accentColor,
                lineHeight: 1,
                display: 'block',
              }}
            >
              {formatPrice(card.offerPriceCents, currency)}
            </span>
          )}
          {card.originalPriceCents != null && (
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 36,
                fontWeight: 500,
                color: 'rgba(255,255,255,0.5)',
                textDecoration: 'line-through',
                lineHeight: 1.4,
                display: 'block',
              }}
            >
              {formatPrice(card.originalPriceCents, currency)}
            </span>
          )}
          {/* Discount-only mode (no prices) */}
          {card.offerPriceCents == null &&
            card.discountPercent != null &&
            card.discountPercent > 0 && (
              <span
                style={{
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: 72,
                  fontWeight: 900,
                  color: accentColor,
                  lineHeight: 1,
                  display: 'block',
                }}
              >
                {card.discountPercent}% OFF
              </span>
            )}
        </div>

        {/* CTA button */}
        <div
          style={{
            transform: `translateY(${interpolate(ctaSpring, [0, 1], [30, 0])}px)`,
            opacity: ctaSpring,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              backgroundColor: accentColor,
              borderRadius: 16,
              padding: '20px 40px',
            }}
          >
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 32,
                fontWeight: 700,
                color: '#FFFFFF',
              }}
            >
              {card.ctaText}
            </span>
          </div>
        </div>

        {/* Urgency text */}
        {card.urgencyText && (
          <span
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 26,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.6)',
              opacity: urgencyOpacity,
            }}
          >
            {card.urgencyText}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Clean info variant — centered card with logo, description, bullet points
 */
const CleanInfoCard: React.FC<{
  card: OfferCard;
  durationInFrames: number;
}> = ({ card, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accentColor = card.primaryColor || '#007AFF';

  // Background fade in
  const bgOpacity = interpolate(frame, [0, Math.round(0.3 * fps)], [0, 0.9], {
    extrapolateRight: 'clamp',
  });

  // Staggered animations
  const logoSpring = useStaggeredSpring(0.1);
  const descSpring = useStaggeredSpring(0.3);
  const ctaSpring = useStaggeredSpring(1.2);
  const urgencyOpacity = interpolate(
    frame,
    [Math.round(1.4 * fps), Math.round(1.6 * fps)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Fade out
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 6, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <AbsoluteFill
        style={{ backgroundColor: `rgba(0, 0, 0, ${bgOpacity})` }}
      />

      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '78%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
        }}
      >
        {/* Logo + Business Name */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            opacity: logoSpring,
            transform: `scale(${interpolate(logoSpring, [0, 1], [0.9, 1])})`,
          }}
        >
          {card.logoUrl && (
            <img
              src={card.logoUrl}
              alt=""
              style={{
                width: 80,
                height: 80,
                objectFit: 'contain',
                borderRadius: 16,
              }}
            />
          )}
          {card.businessName && (
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 28,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.8)',
                textAlign: 'center',
              }}
            >
              {card.businessName}
            </span>
          )}
        </div>

        {/* Service description */}
        {card.serviceDescription && (
          <span
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 34,
              fontWeight: 500,
              color: '#FFFFFF',
              textAlign: 'center',
              lineHeight: 1.4,
              opacity: descSpring,
              maxWidth: '90%',
            }}
          >
            {card.serviceDescription}
          </span>
        )}

        {/* Discount circle */}
        {card.discountPercent != null && card.discountPercent > 0 && (
          <div style={{ margin: '8px 0' }}>
            <DiscountBadge
              percent={card.discountPercent}
              accentColor={accentColor}
              delaySec={0.5}
            />
          </div>
        )}

        {/* Bullet points */}
        {card.bulletPoints && card.bulletPoints.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              width: '100%',
            }}
          >
            {card.bulletPoints.map((point, i) => {
              const bulletDelay = 0.8 + i * 0.1;
              const bulletSpring = useStaggeredSpring(bulletDelay);
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    opacity: bulletSpring,
                    transform: `translateX(${interpolate(bulletSpring, [0, 1], [-20, 0])}px)`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'Inter, system-ui, sans-serif',
                      fontSize: 28,
                      color: accentColor,
                    }}
                  >
                    ✓
                  </span>
                  <span
                    style={{
                      fontFamily: 'Inter, system-ui, sans-serif',
                      fontSize: 30,
                      fontWeight: 500,
                      color: '#FFFFFF',
                      lineHeight: 1.3,
                    }}
                  >
                    {point}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* CTA button */}
        <div
          style={{
            transform: `translateY(${interpolate(ctaSpring, [0, 1], [30, 0])}px)`,
            opacity: ctaSpring,
            marginTop: 8,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              backgroundColor: accentColor,
              borderRadius: 16,
              padding: '20px 40px',
            }}
          >
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 32,
                fontWeight: 700,
                color: '#FFFFFF',
              }}
            >
              {card.ctaText}
            </span>
          </div>
        </div>

        {/* Urgency text */}
        {card.urgencyText && (
          <span
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 26,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.6)',
              textAlign: 'center',
              opacity: urgencyOpacity,
            }}
          >
            {card.urgencyText}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};

/**
 * OfferCardLayer — renders an animated offer card overlay for promotion videos.
 *
 * Two card variants:
 * - `dark-overlay`: Semi-transparent dark card with pricing, discount badge, CTA
 * - `clean-info`: Centered card with logo, description, bullet points, CTA
 *
 * Animation: Sequential stagger using Remotion's spring() and interpolate():
 * 1. Background fades in (0-0.3s)
 * 2. Service name slides in (0.1s)
 * 3. Description appears (0.3s)
 * 4. Discount badge pops with overshoot (0.5s)
 * 5. Price reveals (0.7s)
 * 6. Bullet points fade in one-by-one (0.8-1.1s)
 * 7. CTA slides up (1.2s)
 * 8. Urgency text fades in (1.4s)
 */
export const OfferCardLayer: React.FC<OfferCardLayerProps> = ({
  card,
  startFrame,
  durationInFrames,
  variant = 'dark-overlay',
}) => {
  return (
    <Sequence from={startFrame} durationInFrames={durationInFrames}>
      {variant === 'clean-info' ? (
        <CleanInfoCard card={card} durationInFrames={durationInFrames} />
      ) : (
        <DarkOverlayCard card={card} durationInFrames={durationInFrames} />
      )}
    </Sequence>
  );
};
