import type React from 'react';

export interface WordProps {
  /** The word text to display */
  text: string;
  /** Whether this word is currently being spoken (highlighted) */
  isActive: boolean;
  /** Default text color */
  color: string;
  /** Highlighted text color (for active word) */
  highlightColor: string;
  /** Font size in pixels */
  fontSize: number;
  /** Font family */
  fontFamily: string;
  /** Stroke width for text outline */
  strokeWidth: number;
  /** Stroke color for text outline */
  strokeColor: string;
}

/**
 * Word component - renders a single word with TikTok-style highlighting
 *
 * Active words are displayed in the highlight color, while inactive
 * words are displayed in the default color. Text has a stroke/outline
 * for better visibility against video backgrounds.
 */
export const Word: React.FC<WordProps> = ({
  text,
  isActive,
  color,
  highlightColor,
  fontSize,
  fontFamily,
  strokeWidth,
  strokeColor,
}) => {
  const textColor = isActive ? highlightColor : color;

  return (
    <span
      style={{
        color: textColor,
        fontFamily,
        fontSize,
        fontWeight: 800,
        textTransform: 'uppercase',
        // Text stroke for contrast against video backgrounds
        WebkitTextStroke: `${strokeWidth}px ${strokeColor}`,
        paintOrder: 'stroke fill',
        // Subtle scale effect for active word
        transform: isActive ? 'scale(1.05)' : 'scale(1)',
        transition: 'transform 0.1s ease-out, color 0.1s ease-out',
        display: 'inline-block',
        marginRight: '0.25em',
      }}
    >
      {text}
    </span>
  );
};
