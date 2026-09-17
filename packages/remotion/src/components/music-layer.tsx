import type React from 'react';
import { Audio } from 'remotion';
import type { MusicConfig } from '../types/video-config';

const MUSIC_SKIP_SECONDS = 5;

export interface MusicLayerProps {
  config: MusicConfig;
  fps: number;
}

/**
 * Music Layer - renders background music track
 *
 * The volume is controlled by the config and is typically lower
 * than the talking head audio to not overpower speech.
 * Skips the first 5 seconds of the music track.
 */
export const MusicLayer: React.FC<MusicLayerProps> = ({ config, fps }) => {
  return (
    <Audio
      src={config.url}
      volume={config.volume}
      startFrom={Math.round(MUSIC_SKIP_SECONDS * fps)}
      // Loop the music if it's shorter than the video
      loop
    />
  );
};
