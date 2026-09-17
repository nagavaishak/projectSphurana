import type React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { TextFrame, TextFrameStyle } from '../types/video-config';

export interface TextFrameLayerProps {
  textFrames: TextFrame[];
}

/**
 * Get style configuration for each text frame style type
 */
function getStyleConfig(style: TextFrameStyle = 'default'): {
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  prefix: string;
  opacity: number;
  fontWeight: number;
  maxWidth: string;
} {
  switch (style) {
    case 'question':
      return {
        fontSize: 80,
        color: '#FFFFFF',
        strokeColor: '#000000',
        strokeWidth: 24,
        prefix: '',
        opacity: 1,
        fontWeight: 900,
        maxWidth: '85%',
      };
    case 'answer':
      return {
        fontSize: 68,
        color: '#FFFFFF',
        strokeColor: '#000000',
        strokeWidth: 20,
        prefix: '\u2192 ', // → arrow
        opacity: 1,
        fontWeight: 800,
        maxWidth: '85%',
      };
    case 'disclaimer':
      return {
        fontSize: 42,
        color: 'rgba(255, 255, 255, 0.8)',
        strokeColor: 'rgba(0, 0, 0, 0.6)',
        strokeWidth: 12,
        prefix: '',
        opacity: 0.85,
        fontWeight: 600,
        maxWidth: '80%',
      };
    case 'cta':
      return {
        fontSize: 64,
        color: '#FFFFFF',
        strokeColor: '#000000',
        strokeWidth: 20,
        prefix: '',
        opacity: 1,
        fontWeight: 800,
        maxWidth: '85%',
      };
    default:
      return {
        fontSize: 72,
        color: '#FFFFFF',
        strokeColor: '#000000',
        strokeWidth: 22,
        prefix: '',
        opacity: 1,
        fontWeight: 800,
        maxWidth: '85%',
      };
  }
}

/**
 * Single animated text frame component
 */
const AnimatedTextFrame: React.FC<{
  text: string;
  style?: TextFrameStyle;
  durationInFrames: number;
}> = ({ text, style = 'default', durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const config = getStyleConfig(style);

  // Animate in: spring scale + fade
  const scaleSpring = spring({
    frame,
    fps,
    config: {
      damping: 20,
      stiffness: 120,
      mass: 0.8,
    },
  });

  const scale = interpolate(scaleSpring, [0, 1], [0.85, 1]);

  const fadeIn = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Fade out in last 6 frames
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 6, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  const opacity = Math.min(fadeIn, fadeOut) * config.opacity;

  const displayText = config.prefix + text;

  return (
    <AbsoluteFill
      style={{
        justifyContent: style === 'disclaimer' ? 'flex-end' : 'center',
        alignItems: 'center',
        paddingBottom: style === 'disclaimer' ? '15%' : undefined,
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          maxWidth: config.maxWidth,
          textAlign: 'center',
          padding: '0 40px',
        }}
      >
        {/* Text with stroke for readability over any background */}
        <div style={{ position: 'relative' }}>
          {/* Stroke layer */}
          <span
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: config.fontSize,
              fontWeight: config.fontWeight,
              lineHeight: 1.2,
              color: 'transparent',
              WebkitTextStroke: `${config.strokeWidth}px ${config.strokeColor}`,
              paintOrder: 'stroke fill',
              textAlign: 'center',
            }}
          >
            {displayText}
          </span>
          {/* Fill layer */}
          <span
            style={{
              position: 'relative',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: config.fontSize,
              fontWeight: config.fontWeight,
              lineHeight: 1.2,
              color: config.color,
              textAlign: 'center',
            }}
          >
            {displayText}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * TextFrameLayer - renders timed text frames for text-only narration mode.
 *
 * Each TextFrame appears at its startFrame for its duration with:
 * - Fade + scale spring animation on entry
 * - Fade out before disappearing
 * - Different visual styles for question, answer, disclaimer, cta
 *
 * Positioned above b-roll footage, replaces captions for text_only videos.
 */
export const TextFrameLayer: React.FC<TextFrameLayerProps> = ({
  textFrames,
}) => {
  if (!textFrames || textFrames.length === 0) return null;

  return (
    <AbsoluteFill>
      {textFrames.map((tf) => (
        <Sequence
          key={tf.id}
          from={tf.startFrame}
          durationInFrames={tf.durationInFrames}
        >
          <AnimatedTextFrame
            text={tf.text}
            style={tf.style}
            durationInFrames={tf.durationInFrames}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
