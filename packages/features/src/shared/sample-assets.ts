/**
 * Sample media for the dev-only onboarding shortcut (`ONBOARDING_SAMPLE_ASSETS`).
 *
 * When the flag is on, the onboarding ad-picker / video-picker / content-approval
 * slides are seeded with these ready-made assets instead of the real (slow, paid)
 * Nano Banana / Remotion render pipeline. Public, stable URLs so nothing has to
 * be bundled or rendered. NEVER used in production — the flag defaults off.
 */

import type { GraphicOutput } from '@borradh-workspace/database';

/** Deterministic 4:5 sample image (Lorem Picsum, stable per seed). */
export const sampleImageUrl = (index: number): string =>
  `https://picsum.photos/seed/borradh-onboarding-${index}/1080/1350`;

/** Deterministic square sample thumbnail. */
export const sampleThumbnailUrl = (index: number): string =>
  `https://picsum.photos/seed/borradh-onboarding-thumb-${index}/1080/1080`;

/**
 * Well-known public sample MP4s (Google's gtv-videos bucket) — reliable, CORS-
 * friendly, and playable in a browser <video>. Cycled by index.
 */
const SAMPLE_VIDEO_URLS: readonly string[] = [
  'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
];

/** A sample video's playable URL + a poster thumbnail, cycled by index. */
export const sampleVideo = (
  index: number
): { blobUrl: string; thumbnailUrl: string } => ({
  blobUrl: SAMPLE_VIDEO_URLS[index % SAMPLE_VIDEO_URLS.length],
  thumbnailUrl: sampleThumbnailUrl(index),
});

/**
 * A ready `graphic.outputs` payload for a sample image — the minimal shape the
 * pickers read (`outputs.find(o => o.status !== 'failed' && o.url)`).
 */
export const sampleGraphicOutputs = (index: number): GraphicOutput[] => [
  {
    aspectRatioId: 'portrait-4-5',
    platform: 'instagram',
    width: 1080,
    height: 1350,
    url: sampleImageUrl(index),
    format: 'jpg',
    renderedAt: new Date().toISOString(),
    renderedBy: 'server',
    status: 'success',
  },
];
