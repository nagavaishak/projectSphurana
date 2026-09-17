import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

export type LabelPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface LabelOverlayProps {
  /** The text to display (e.g., "BEFORE", "AFTER") */
  text: string;
  /** Position of the label on the screen */
  position?: LabelPosition;
  /** Custom styling options */
  style?: {
    /** Background color for the label */
    backgroundColor?: string;
    /** Text color */
    textColor?: string;
    /** Font size in pixels */
    fontSize?: number;
    /** Horizontal padding */
    paddingX?: number;
    /** Vertical padding */
    paddingY?: number;
  };
  /** Duration of the clip in frames (for fade animation) */
  durationInFrames: number;
}

/**
 * Default styling for labels
 */
const DEFAULT_STYLE = {
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  textColor: '#FFFFFF',
  fontSize: 48,
  paddingX: 24,
  paddingY: 12,
};

/**
 * Get CSS position styles based on LabelPosition
 */
function getPositionStyles(position: LabelPosition): React.CSSProperties {
  const baseStyles: React.CSSProperties = {
    position: 'absolute',
    margin: 40, // Margin from edges
  };

  switch (position) {
    case 'top-left':
      return { ...baseStyles, top: 0, left: 0 };
    case 'top-center':
      return {
        ...baseStyles,
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
      };
    case 'top-right':
      return { ...baseStyles, top: 0, right: 0 };
    case 'bottom-left':
      return { ...baseStyles, bottom: 0, left: 0 };
    case 'bottom-right':
      return { ...baseStyles, bottom: 0, right: 0 };
    default:
      return { ...baseStyles, top: 0, left: 0 };
  }
}

/**
 * LabelOverlay - displays a text label on top of b-roll clips
 *
 * Used primarily for before-after-1 variation to show "BEFORE" and "AFTER" labels
 * on their respective clips.
 *
 * Features:
 * - Fade-in animation on appearance
 * - Fade-out animation before clip ends
 * - Semi-transparent background for readability
 * - Configurable position and styling
 */
export const LabelOverlay: React.FC<LabelOverlayProps> = ({
  text,
  position = 'top-left',
  style = {},
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  // Merge default styles with custom styles
  const mergedStyle = { ...DEFAULT_STYLE, ...style };

  // Fade in duration (in frames) - ~0.3 seconds at 30fps
  const fadeInDuration = Math.min(10, durationInFrames / 4);
  // Fade out duration (in frames) - ~0.3 seconds at 30fps
  const fadeOutDuration = Math.min(10, durationInFrames / 4);

  // Calculate opacity with fade in and fade out
  const opacity = interpolate(
    frame,
    [0, fadeInDuration, durationInFrames - fadeOutDuration, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const positionStyles = getPositionStyles(position);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      <div
        style={{
          ...positionStyles,
          backgroundColor: mergedStyle.backgroundColor,
          color: mergedStyle.textColor,
          fontSize: mergedStyle.fontSize,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          paddingLeft: mergedStyle.paddingX,
          paddingRight: mergedStyle.paddingX,
          paddingTop: mergedStyle.paddingY,
          paddingBottom: mergedStyle.paddingY,
          borderRadius: 8,
          display: 'inline-block',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
