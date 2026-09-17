import type React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { CaptionWord, TikTokCaptionStyle } from '../../types/video-config';
import { Word } from './word';

export interface PageProps {
  /** Words to display on this page */
  words: CaptionWord[];
  /** Current time in milliseconds (for highlighting active word) */
  timeInMs: number;
  /** Animation progress for page entrance (0-1) */
  enterProgress: number;
  /** Caption styling */
  style: TikTokCaptionStyle;
  /** Video width for text fitting */
  videoWidth: number;
}

/**
 * Page component - renders a group of words (a "page" of captions)
 *
 * TikTok-style captions display multiple words at once, with the
 * currently spoken word highlighted. This component handles:
 * - Word-by-word highlighting based on timestamps
 * - Entrance animation (scale + translate)
 * - Text fitting to video width
 */
export const Page: React.FC<PageProps> = ({
  words,
  timeInMs,
  enterProgress,
  style,
  videoWidth,
}) => {
  const frame = useCurrentFrame();

  // Entrance animation
  const scale = interpolate(enterProgress, [0, 1], [0.8, 1], {
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(enterProgress, [0, 1], [20, 0], {
    extrapolateRight: 'clamp',
  });
  const opacity = interpolate(enterProgress, [0, 1], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Calculate max width for text container (90% of video width)
  const maxWidth = videoWidth * 0.9;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        maxWidth,
        textAlign: 'center',
        transform: `scale(${scale}) translateY(${translateY}px)`,
        opacity,
        lineHeight: 1.2,
      }}
    >
      {words.map((word, index) => {
        // Check if this word is currently being spoken
        const isActive = timeInMs >= word.startMs && timeInMs < word.endMs;

        return (
          <Word
            key={`${word.text}-${index}-${frame}`}
            text={word.text}
            isActive={isActive}
            color={style.color}
            highlightColor={style.highlightColor}
            fontSize={style.fontSize}
            fontFamily={style.fontFamily}
            strokeWidth={style.strokeWidth}
            strokeColor={style.strokeColor}
          />
        );
      })}
    </div>
  );
};
