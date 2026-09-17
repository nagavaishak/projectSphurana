/**
 * Audio Asset enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Audio asset kind labels. Used by the video template engine's
// synthesize-tts + synthesize-captions services to memoize synthesized
// audio in the audio_asset table.
export const audioAssetKindLabels = {
  tts: 'TTS Narration',
  captions: 'Captions Transcript',
} as const;

export const audioAssetKindValues = Object.keys(audioAssetKindLabels) as [
  keyof typeof audioAssetKindLabels,
  ...(keyof typeof audioAssetKindLabels)[],
];

export type AudioAssetKind = keyof typeof audioAssetKindLabels;
