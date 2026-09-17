/**
 * Video enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Video status labels
export const videoStatusLabels = {
  draft: 'Draft',
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
} as const;

export const videoStatusValues = Object.keys(videoStatusLabels) as [
  keyof typeof videoStatusLabels,
  ...(keyof typeof videoStatusLabels)[],
];

export type VideoStatus = keyof typeof videoStatusLabels;

// Usage type — distinguishes videos rendered for paid ads from organic
// social posts. Existing video templates (before/after, talking head) all
// produce ad-suitable creatives, so existing rows default to 'ad'. Organic
// video templates (reels with section labels, longer-form testimonials) are
// a separate workstream — the monthly bulk batch flow only emits organic
// videos when at least one organic-tagged template is available.
export const videoUsageTypeLabels = {
  ad: 'Ad',
  organic: 'Organic',
} as const;

export const videoUsageTypeValues = Object.keys(videoUsageTypeLabels) as [
  keyof typeof videoUsageTypeLabels,
  ...(keyof typeof videoUsageTypeLabels)[],
];

export type VideoUsageType = keyof typeof videoUsageTypeLabels;

// Video processing stage labels
export const videoProcessingStageLabels = {
  downloading: 'Downloading Video',
  generating_voiceover: 'Generating Voiceover',
  analyzing: 'Analyzing Content',
  transcribing: 'Transcribing Audio',
  building_captions: 'Building Captions',
  resolving_assets: 'Resolving Assets',
  rendering: 'Rendering Video',
} as const;

export const videoProcessingStageValues = Object.keys(
  videoProcessingStageLabels
) as [
  keyof typeof videoProcessingStageLabels,
  ...(keyof typeof videoProcessingStageLabels)[],
];

export type VideoProcessingStage = keyof typeof videoProcessingStageLabels;

// AI voice ID labels (for TTS - Kokoro/OpenAI voices)
export const aiVoiceIdLabels = {
  // American Female voices
  af_heart: 'Heart (Female, Warm)',
  af_alloy: 'Alloy (Female)',
  af_bella: 'Bella (Female)',
  af_jessica: 'Jessica (Female)',
  af_nicole: 'Nicole (Female)',
  af_nova: 'Nova (Female)',
  af_sarah: 'Sarah (Female)',
  // American Male voices
  am_adam: 'Adam (Male)',
  am_echo: 'Echo (Male)',
  am_eric: 'Eric (Male)',
  am_liam: 'Liam (Male)',
  am_michael: 'Michael (Male)',
  // British Female voices
  bf_emma: 'Emma (British Female)',
  bf_isabella: 'Isabella (British Female)',
  // British Male voices
  bm_george: 'George (British Male)',
  bm_lewis: 'Lewis (British Male)',
} as const;

export const aiVoiceIdValues = Object.keys(aiVoiceIdLabels) as [
  keyof typeof aiVoiceIdLabels,
  ...(keyof typeof aiVoiceIdLabels)[],
];

export type AiVoiceId = keyof typeof aiVoiceIdLabels;

// Video draft clip source — discriminates how a clip landed in the tray.
// W-C10-clip-tray. `uploaded` = operator dropped it in chat this session;
// `library` = picked from existing asset library; `suggested` = persisted
// after `videos_autoSelectClips` chose it (operator can swap before render).
export const videoDraftClipSourceLabels = {
  uploaded: 'Uploaded',
  library: 'Library',
  suggested: 'Suggested',
} as const;

export const videoDraftClipSourceValues = Object.keys(
  videoDraftClipSourceLabels
) as [
  keyof typeof videoDraftClipSourceLabels,
  ...(keyof typeof videoDraftClipSourceLabels)[],
];

export type VideoDraftClipSource = keyof typeof videoDraftClipSourceLabels;

// Per-clip processing status independent of the parent video's render state.
// `uploading` = S3 PUT in flight (assetId may be null); `processing` = asset
// ingest pipeline running (probe + transcode + analysis); `ready` = usable
// for render; `failed` = ingest gave up (operator can retry / remove).
export const videoDraftClipProcessingStatusLabels = {
  uploading: 'Uploading',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
} as const;

export const videoDraftClipProcessingStatusValues = Object.keys(
  videoDraftClipProcessingStatusLabels
) as [
  keyof typeof videoDraftClipProcessingStatusLabels,
  ...(keyof typeof videoDraftClipProcessingStatusLabels)[],
];

export type VideoDraftClipProcessingStatus =
  keyof typeof videoDraftClipProcessingStatusLabels;
