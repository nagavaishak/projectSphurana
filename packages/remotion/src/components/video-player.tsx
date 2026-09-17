import { Player, type PlayerRef } from '@remotion/player';
import type React from 'react';
import { forwardRef, useMemo } from 'react';
import type { VideoConfig } from '../types/video-config';
import { getDimensions } from '../types/video-config';
import { VideoComposition } from './video-composition';

// Type assertion to satisfy Remotion's Player component typing
// biome-ignore lint/suspicious/noExplicitAny: Required for Remotion Player component typing
const VideoCompositionComponent = VideoComposition as React.FC<any>;

export interface VideoPlayerProps {
  /** Video configuration passed to the composition */
  config: VideoConfig;
  /** Whether to show default player controls */
  controls?: boolean;
  /** Whether to loop the video */
  loop?: boolean;
  /** Whether to autoplay */
  autoPlay?: boolean;
  /** Click to play behavior */
  clickToPlay?: boolean;
  /** Double click to fullscreen */
  doubleClickToFullscreen?: boolean;
  /** Poster frame number */
  posterFillMode?: 'player-size' | 'composition-size';
  /** Additional className for the player container */
  className?: string;
  /** Additional style for the player container */
  style?: React.CSSProperties;
}

/**
 * VideoPlayer - Wrapper around Remotion's Player component
 *
 * This provides a convenient way to render a video preview in the browser.
 * It automatically configures dimensions based on the video orientation.
 *
 * Usage:
 * ```tsx
 * <VideoPlayer
 *   config={videoConfig}
 *   controls
 *   loop
 * />
 * ```
 */
export const VideoPlayer = forwardRef<PlayerRef, VideoPlayerProps>(
  (
    {
      config,
      controls = true,
      loop = false,
      autoPlay = false,
      clickToPlay = true,
      doubleClickToFullscreen = true,
      className,
      style,
    },
    ref
  ) => {
    const dimensions = getDimensions(config.orientation);

    // Memoize inputProps to prevent unnecessary re-renders
    // biome-ignore lint/suspicious/noExplicitAny: Required for Remotion Player inputProps typing
    const inputProps = useMemo(() => config as any, [config]);

    return (
      <Player
        ref={ref}
        component={VideoCompositionComponent}
        inputProps={inputProps}
        durationInFrames={config.durationInFrames}
        fps={config.fps}
        compositionWidth={dimensions.width}
        compositionHeight={dimensions.height}
        controls={controls}
        loop={loop}
        autoPlay={autoPlay}
        clickToPlay={clickToPlay}
        doubleClickToFullscreen={doubleClickToFullscreen}
        style={{
          width: '100%',
          ...style,
        }}
        className={className}
      />
    );
  }
);

VideoPlayer.displayName = 'VideoPlayer';
