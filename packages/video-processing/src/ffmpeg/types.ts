export type Orientation = 'portrait' | 'landscape' | 'square';

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  frameRate?: number;
  orientation: Orientation;
}

export interface FFmpegInitOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
}

export interface FrameWithTimestamp {
  path: string;
  timestampSec: number;
}

export type RemuxErrorCode =
  | 'UNSUPPORTED_CODEC'
  | 'CORRUPTED_INPUT'
  | 'DISK_SPACE'
  | 'SYSTEM_ERROR'
  | 'UNKNOWN';
