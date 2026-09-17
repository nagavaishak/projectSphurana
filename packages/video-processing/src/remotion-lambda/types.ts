import type { VideoConfig } from '@borradh-workspace/remotion';
import type { Orientation } from '../ffmpeg/types.js';

export interface RemotionLambdaConfig {
  region: string;
  functionName: string;
  serveUrl: string;
}

export interface RenderOptions {
  videoConfig: VideoConfig;
  orientation: Orientation;
  videoId: string;
  /** Override Lambda timeout in ms. Defaults to 600000 (10 min). */
  timeoutMs?: number;
}

export interface RenderResult {
  renderId: string;
  bucketName: string;
  outputUrl: string;
}

export interface RenderProgress {
  progress: number;
  isComplete: boolean;
  outputUrl?: string;
  errors?: string[];
}

export interface OrientationConfig {
  width: number;
  height: number;
  compositionId: string;
}
