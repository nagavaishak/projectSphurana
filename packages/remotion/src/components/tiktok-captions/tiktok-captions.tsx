import type React from 'react';
import {
  AbsoluteFill,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {
  CaptionPage,
  CaptionPosition,
  TikTokCaptionStyle,
} from '../../types/video-config';
import { framesToMs } from '../../types/video-config';
import { Page } from './page';

export interface TikTokCaptionsProps {
  /** Array of caption pages with word-level timing */
  captionPages: CaptionPage[];
  /** Caption styling */
  style: TikTokCaptionStyle;
}

/**
 * Get position styles based on caption position setting
 */
function getPositionStyles(position: CaptionPosition): React.CSSProperties {
  switch (position) {
    case 'top':
      return {
        top: 120,
      };
    case 'center':
      return {
        top: '50%',
        transform: 'translateY(-50%)',
      };
    default:
      return {
        bottom: 200,
      };
  }
}

/**
 * SubtitlePage wrapper - handles entrance animation for a single page
 */
const SubtitlePage: React.FC<{
  page: CaptionPage;
  style: TikTokCaptionStyle;
  videoWidth: number;
  fps: number;
}> = ({ page, style, videoWidth, fps }) => {
  const frame = useCurrentFrame();

  // Spring animation for entrance
  const enterProgress = spring({
    frame,
    fps,
    config: {
      damping: 200,
    },
    durationInFrames: 5,
  });

  // Calculate current time in milliseconds
  const absoluteFrame = page.startFrame + frame;
  const timeInMs = framesToMs(absoluteFrame, fps);

  return (
    <Page
      words={page.words}
      timeInMs={timeInMs}
      enterProgress={enterProgress}
      style={style}
      videoWidth={videoWidth}
    />
  );
};

/**
 * TikTokCaptions component - renders TikTok-style word-by-word captions
 *
 * Features:
 * - Word-by-word highlighting as words are spoken
 * - Smooth entrance animations for each page
 * - Configurable position (top, center, bottom)
 * - High contrast text with stroke outline
 */
export const TikTokCaptions: React.FC<TikTokCaptionsProps> = ({
  captionPages,
  style,
}) => {
  const { width, fps } = useVideoConfig();

  if (captionPages.length === 0) {
    return null;
  }

  const positionStyles = getPositionStyles(style.position);

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
      }}
    >
      {captionPages.map((page) => (
        <Sequence
          key={page.id}
          from={page.startFrame}
          durationInFrames={page.endFrame - page.startFrame}
        >
          <div
            style={{
              position: 'absolute',
              left: 40,
              right: 40,
              justifyContent: 'center',
              alignItems: 'center',
              display: 'flex',
              ...positionStyles,
            }}
          >
            <SubtitlePage
              page={page}
              style={style}
              videoWidth={width}
              fps={fps}
            />
          </div>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
