import { useState } from 'react';

import { cn } from '@/lib/utils';
import {
  MediaControlBar,
  MediaController,
  MediaFullscreenButton,
  MediaLoadingIndicator,
  MediaMuteButton,
  MediaPipButton,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from 'media-chrome/react';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  autoPlay?: boolean;
  /**
   * Take the player's shape from the MEDIA rather than assuming 16:9.
   *
   * The default is `aspect-video`, which is right for the ad previews this was
   * written for and wrong for everything the organic templates produce — those
   * are portrait, and a 9:16 video in a 16:9 box is a thin strip between two
   * black margins that take up most of the player.
   *
   * Measured from `videoWidth`/`videoHeight` on `loadedmetadata` rather than
   * read from `draftConfig.orientation`: the file is the authority on its own
   * dimensions, and a config that disagrees with the render would put the
   * letterbox back for reasons nobody could see.
   */
  fitToMedia?: boolean;
}

export function VideoPlayer({
  src,
  poster,
  className,
  onTimeUpdate,
  onEnded,
  onPlay,
  onPause,
  autoPlay = false,
  fitToMedia = false,
}: VideoPlayerProps) {
  // Null until the browser has read the header. Until then the player keeps its
  // default shape rather than guessing, so it does not visibly re-proportion
  // itself a beat after mounting.
  const [ratio, setRatio] = useState<number | null>(null);

  return (
    <MediaController
      style={fitToMedia && ratio ? { aspectRatio: String(ratio) } : undefined}
      className={cn(
        'w-full bg-black rounded-lg overflow-hidden',
        // Only the fallback. An inline `aspect-ratio` wins over the class, and
        // `fitToMedia` without a measurement yet still needs a shape to hold.
        !(fitToMedia && ratio) && 'aspect-video',
        '[&_media-control-bar]:bg-gradient-to-t [&_media-control-bar]:from-black/80 [&_media-control-bar]:to-transparent',
        '[&_media-control-bar]:px-2 [&_media-control-bar]:py-1',
        className
      )}
    >
      <video
        slot="media"
        src={src}
        poster={poster}
        preload="metadata"
        autoPlay={autoPlay}
        onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
        onEnded={onEnded}
        onPlay={onPlay}
        onPause={onPause}
        onLoadedMetadata={(e) => {
          if (!fitToMedia) return;
          const { videoWidth, videoHeight } = e.currentTarget;
          if (videoWidth > 0 && videoHeight > 0) {
            setRatio(videoWidth / videoHeight);
          }
        }}
        className="w-full h-full object-contain"
      />

      <MediaLoadingIndicator slot="centered-chrome" />

      <MediaControlBar>
        <MediaPlayButton />
        <MediaSeekBackwardButton seekOffset={10} />
        <MediaSeekForwardButton seekOffset={10} />
        <MediaTimeRange />
        <MediaTimeDisplay showDuration />
        <MediaMuteButton />
        <MediaVolumeRange />
        <MediaPipButton />
        <MediaFullscreenButton />
      </MediaControlBar>
    </MediaController>
  );
}
