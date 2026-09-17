import type React from 'react';
import { Audio } from 'remotion';

export interface NarrationAudioLayerProps {
  /** URL of the AI-generated narration audio */
  audioUrl: string;
  /** Volume level (0-1), defaults to 1 */
  volume?: number;
}

/**
 * Narration Audio Layer - plays AI-generated voiceover audio
 *
 * Used when narrationType is 'ai' - the audio is generated from
 * the script using TTS (Kokoro) instead of being extracted from
 * a talking head video.
 *
 * This layer plays continuously throughout the video, similar to
 * how talking head audio works, but without any associated video.
 */
export const NarrationAudioLayer: React.FC<NarrationAudioLayerProps> = ({
  audioUrl,
  volume = 1,
}) => {
  return <Audio src={audioUrl} volume={volume} />;
};
