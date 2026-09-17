import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { REEL_PALETTE, accentTextColor } from '../types/reel-palette';
import type { QuestionCtaConfig } from '../types/video-config';

export interface QuestionCtaLayerProps {
  config: QuestionCtaConfig;
}

const SANS = "'Inter', system-ui, -apple-system, Helvetica, Arial, sans-serif";

/**
 * QuestionCtaLayer — question-cta-1 / curiosity-hook-1 organic templates.
 *
 * Top: the hook/question on IG-style rounded dark bars (the classic reel
 * text treatment — each line carries its own pill-shaped backing). Bottom:
 * the CTA as a solid brand-colour pill. Replaces the old black-fill/white-
 * stroke look, which read cheap over busy footage.
 */
export const QuestionCtaLayer: React.FC<QuestionCtaLayerProps> = ({
  config,
}) => {
  const frame = useCurrentFrame();
  const { question, ctaText } = config;
  const accent = config.primaryColor ?? REEL_PALETTE.blush;

  const questionOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const ctaOpacity = interpolate(frame, [12, 24], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const ctaRise = interpolate(ctaOpacity, [0, 1], [14, 0]);

  return (
    <AbsoluteFill>
      {/* Light top/bottom gradient — the bars carry their own contrast. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 68%, rgba(0,0,0,0.4) 100%)',
        }}
      />

      {/* Top: question on a rounded dark bar. `box-decoration-break: clone`
          gives every wrapped line its own pill backing (the IG text tool). */}
      <div
        style={{
          position: 'absolute',
          top: '9%',
          left: 0,
          right: 0,
          textAlign: 'center',
          padding: '0 7%',
          opacity: questionOpacity,
        }}
      >
        <span
          style={{
            display: 'inline',
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
            fontFamily: SANS,
            fontSize: 52,
            fontWeight: 800,
            lineHeight: 1.52,
            color: '#FFFFFF',
            backgroundColor: REEL_PALETTE.slateBar,
            borderRadius: 14,
            padding: '0.18em 0.5em',
          }}
        >
          {question}
        </span>
      </div>

      {/* Bottom: CTA as a brand-colour pill. */}
      <div
        style={{
          position: 'absolute',
          bottom: '10%',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          padding: '0 7%',
          opacity: ctaOpacity,
          transform: `translateY(${ctaRise}px)`,
        }}
      >
        <span
          style={{
            fontFamily: SANS,
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: '0.04em',
            color: accentTextColor(accent),
            backgroundColor: accent,
            borderRadius: 999,
            padding: '16px 40px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}
        >
          {ctaText}
        </span>
      </div>
    </AbsoluteFill>
  );
};
