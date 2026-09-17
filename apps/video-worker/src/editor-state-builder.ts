/**
 * EditorState Builder
 *
 * Extracted from main.ts — builds an EditorState from a VideoDraftConfig.
 * All external dependencies (DB, S3, Whisper) are injected via BuilderContext
 * so this module is unit-testable with mocks.
 */

import type { VideoProcessingStage } from '@borradh-workspace/database';
import type {
  BRollClipConfig,
  VideoDraftConfig,
} from '@borradh-workspace/database/schema';
import { getTemplateById } from '@borradh-workspace/features/videos';
import type { Logger } from '@borradh-workspace/observability';
import type {
  CaptionPage,
  ContentCardConfig,
  EditorState,
  FullScreenReveal,
  Item,
  MusicConfig,
  OutroLayoutConfig,
  PipOverlay,
  Scene,
  StackedListConfig,
  TemplateVariationId,
  TextFrame,
  TextInterstitial,
  TikTokCaptionStyle,
  VideoOrientation,
} from '@borradh-workspace/remotion';
import { getDimensions } from '@borradh-workspace/remotion';
import {
  type BRollClip,
  scheduleBRollClips,
  scheduledClipsToScenes,
} from '@borradh-workspace/video-processing/b-roll';
import {
  alignEditedCaptions,
  buildCaptionPages,
} from '@borradh-workspace/video-processing/captions';
import type { ActionSegment } from '@borradh-workspace/video-processing/vision';
import { EditorStateAssembler } from './editor-state-assembler.js';

// ================================================================
// Builder Context — injected dependencies for testability
// ================================================================

export interface OrgDetails {
  name: string;
  logo: string | null;
  outroStyle: 'offer' | 'location' | 'tagline';
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  tagline: string | null;
  address: string | null;
}

export type BRollAssetMap = Map<
  string,
  {
    url: string;
    durationSec: number;
    mediaType: 'video' | 'image';
    actionSegments?: ActionSegment[];
  }
>;

export interface WhisperCaption {
  text: string;
  startMs: number;
  endMs: number;
}

export interface BuilderContext {
  presignUrl: (url: string) => Promise<string>;
  getOrganizationDetails: (orgId: string) => Promise<OrgDetails | null>;
  resolveBRollAssets: (assetIds: string[]) => Promise<BRollAssetMap>;
  updateVideoStage: (
    videoId: string,
    stage: VideoProcessingStage
  ) => Promise<void>;
  transcribe: (audioPath: string) => Promise<WhisperCaption[]>;
  log: Logger;
}

// ================================================================
// Narration result — produced externally, passed into the builder
// ================================================================

export interface NarrationResult {
  audioPath: string | null;
  audioDurationSec: number;
  presignedTalkingHeadUrl?: string;
  narrationAudioUrl?: string;
  /** Parsed text frames (only set for text_only narration) */
  parsedTextFrames?: Array<{
    id: string;
    text: string;
    durationSec: number;
    style?: 'default' | 'question' | 'answer' | 'disclaimer' | 'cta';
  }>;
}

// ================================================================
// Builder options
// ================================================================

export interface ProcessingTimings {
  jobStarted: number;
  downloadStart?: number;
  downloadEnd?: number;
  generateVoiceoverStart?: number;
  generateVoiceoverEnd?: number;
  analyzeStart?: number;
  analyzeEnd?: number;
  extractAudioStart?: number;
  extractAudioEnd?: number;
  transcribeStart?: number;
  transcribeEnd?: number;
  buildCaptionsStart?: number;
  buildCaptionsEnd?: number;
  resolveAssetsStart?: number;
  resolveAssetsEnd?: number;
  scheduleBRollStart?: number;
  scheduleBRollEnd?: number;
  buildConfigStart?: number;
  buildConfigEnd?: number;
  renderStart?: number;
  renderEnd?: number;
  jobCompleted?: number;
}

export interface BuilderOptions {
  narration: NarrationResult;
  templateId?: string;
  variationId?: string;
  onProgress?: (stage: string, progress: number) => void;
  timings?: ProcessingTimings;
}

// ================================================================
// Intermediate types
// ================================================================

interface TemplateOverlayResult {
  pipOverlays?: PipOverlay[];
  textInterstitials?: TextInterstitial[];
  fullScreenReveals?: FullScreenReveal[];
}

interface TextOnlyExtras {
  remotionTextFrames: TextFrame[];
  stackedListConfig?: StackedListConfig;
  contentCard?: ContentCardConfig;
}

// Default FPS for video rendering
const DEFAULT_FPS = 30;

// ================================================================
// Helper functions
// ================================================================

/**
 * Get b-roll scheduling params that differ by narration type.
 */
function getBRollSchedulingParams(
  draftConfig: VideoDraftConfig,
  isTextOnly: boolean,
  isAiVoiceover: boolean
): {
  introSec: number;
  outroBufferSec: number;
  gapBetweenClipsSec?: number;
  targetCoverage?: number;
  recycleClips?: boolean;
} {
  if (isTextOnly) {
    return {
      introSec: 0,
      outroBufferSec: 0,
      gapBetweenClipsSec: 0,
      targetCoverage: 1.0,
      recycleClips: false,
    };
  }
  const outroBufferSec = draftConfig.outro
    ? draftConfig.outro.durationSec || 3
    : 0;
  if (isAiVoiceover) {
    return {
      introSec: 0,
      outroBufferSec,
      targetCoverage: 1.0,
      recycleClips: true,
    };
  }
  // Recorded talking head
  return { introSec: 3, outroBufferSec };
}

/**
 * Build BRollClip array from draft config clips + resolved asset data.
 */
function buildBRollClips(
  bRollClipConfigs: BRollClipConfig[],
  bRollAssetMap: BRollAssetMap,
  log: Logger
): BRollClip[] {
  return bRollClipConfigs
    .map((clip: BRollClipConfig, index: number) => {
      const assetData = bRollAssetMap.get(clip.assetId);
      if (!assetData) {
        log.warn(`B-roll asset not found: ${clip.assetId}`);
        return null;
      }
      return {
        id: clip.assetId,
        url: assetData.url,
        sourceDurationSec: assetData.durationSec,
        order: clip.order ?? index,
        clipType: clip.clipType,
        mediaType: assetData.mediaType,
        actionSegments: assetData.actionSegments,
      };
    })
    .filter((clip): clip is BRollClip => clip !== null);
}

/**
 * Build template-specific overlays (PiP, text interstitials, full-screen reveals).
 * Runs for ALL narration types.
 */
async function buildTemplateOverlays(
  ctx: BuilderContext,
  draftConfig: VideoDraftConfig,
  bRollScenes: Array<{
    id: string;
    startFrame: number;
    durationInFrames: number;
    clipUrl: string;
    trimStart: number;
    bRollType?: string;
    mediaType?: string;
  }>,
  variationId: string | undefined,
  fps: number
): Promise<TemplateOverlayResult> {
  // Build PiP overlays (convert seconds to frames, presign S3 URLs)
  let pipOverlays: PipOverlay[] | undefined = draftConfig.pipOverlays
    ? await Promise.all(
        draftConfig.pipOverlays.map(async (pip) => ({
          imageUrl: await ctx.presignUrl(pip.imageUrl),
          label: pip.label,
          position: pip.position,
          startFrame: Math.round(pip.startSec * fps),
          durationInFrames: Math.round(pip.durationSec * fps),
          sizePercent: pip.sizePercent,
          soundEffectUrl: pip.soundEffectUrl
            ? await ctx.presignUrl(pip.soundEffectUrl)
            : undefined,
        }))
      )
    : undefined;

  // Build modular before-after overlays for before-after-1 variation
  let textInterstitials: TextInterstitial[] | undefined;
  let fullScreenReveals: FullScreenReveal[] | undefined;

  ctx.log.info(
    `[buildTemplateOverlays] variationId=${variationId} scenes=${JSON.stringify(bRollScenes.map((s) => ({ id: s.id.slice(0, 8), brt: s.bRollType ?? 'NONE' })))}`
  );

  if (variationId === 'before-after-1') {
    const beforeScene = bRollScenes.find((s) => s.bRollType === 'before');
    const afterScene = bRollScenes.find((s) => s.bRollType === 'after');

    ctx.log.info(
      `[before-after-1] beforeFound=${!!beforeScene} afterFound=${!!afterScene}`
    );

    if (beforeScene && afterScene) {
      // Auto-create before PiP overlay if none provided in draftConfig
      if (!pipOverlays || pipOverlays.length === 0) {
        pipOverlays = [
          {
            imageUrl: beforeScene.clipUrl,
            label: 'BEFORE',
            position: 'top-right' as const,
            startFrame: beforeScene.startFrame,
            durationInFrames: beforeScene.durationInFrames,
            sizePercent: 30,
            soundEffectUrl: undefined,
          },
        ];
      }

      // Text appears 0.3s after the before PiP disappears
      const beforeEndFrame =
        beforeScene.startFrame + beforeScene.durationInFrames;
      const textGapFrames = Math.round(0.3 * fps);
      const textStartFrame = beforeEndFrame + textGapFrames;
      // Text visible for max 1.2s (short, punchy), clamped to available gap
      const textBufferFrames = Math.round(0.3 * fps);
      const maxTextDuration = Math.round(1.2 * fps);
      const availableGap =
        afterScene.startFrame - textStartFrame - textBufferFrames;
      const textDurationFrames = Math.max(
        Math.round(0.5 * fps), // minimum 0.5s
        Math.min(maxTextDuration, availableGap)
      );

      textInterstitials = [
        {
          text: 'CLIENT RESULTS COMING NOW',
          startFrame: textStartFrame,
          durationInFrames: textDurationFrames,
          verticalPosition: 0.33,
          fontSize: 72,
        },
      ];

      // After photo as full-screen reveal with Ken Burns
      fullScreenReveals = [
        {
          src: afterScene.clipUrl,
          mediaType:
            (afterScene as { mediaType?: 'image' | 'video' }).mediaType ||
            'image',
          startFrame: afterScene.startFrame,
          durationInFrames: afterScene.durationInFrames,
          trimStart: afterScene.trimStart,
          zoomRange: [1.0, 1.12],
          transition: 'fade' as const,
          transitionDurationFrames: 8,
          label: 'AFTER',
          labelPosition: 'top-left' as const,
        },
      ];
    }
  }

  return { pipOverlays, textInterstitials, fullScreenReveals };
}

/**
 * Build text-only extras: Remotion text frames, stacked list config, content card.
 * Only called for text_only narration.
 */
async function buildTextOnlyExtras(
  ctx: BuilderContext,
  parsedTextFrames: NonNullable<NarrationResult['parsedTextFrames']>,
  isEducational: boolean,
  org: OrgDetails | null,
  draftConfig: VideoDraftConfig,
  fps: number,
  selectedTrack?: { bpm?: number },
  template?: { beatsPerEdit?: number }
): Promise<TextOnlyExtras> {
  // Build Remotion text frames with frame-based timing
  let currentFrame = 0;
  const remotionTextFrames: TextFrame[] = parsedTextFrames.map((frame) => {
    const durationInFrames = Math.round(frame.durationSec * fps);
    const result: TextFrame = {
      id: frame.id,
      text: frame.text,
      startFrame: currentFrame,
      durationInFrames,
      style: frame.style,
    };
    currentFrame += durationInFrames;
    return result;
  });

  // Build stackedListConfig from textFrames for educational templates
  let stackedListConfig: StackedListConfig | undefined;
  if (isEducational && parsedTextFrames.length > 0) {
    const questionFrame = parsedTextFrames.find((f) => f.style === 'question');
    const itemFrames = parsedTextFrames.filter(
      (f) =>
        f.style === 'answer' ||
        f.style === 'default' ||
        f.style === 'disclaimer'
    );
    const ctaFrame = parsedTextFrames.find((f) => f.style === 'cta');

    stackedListConfig = {
      headerText: questionFrame?.text || parsedTextFrames[0]?.text || '',
      items: itemFrames.map((f) => f.text),
      ctaText: ctaFrame?.text || 'DM to Learn More',
      primaryColor: org?.primaryColor || '#6366f1',
      bpm: selectedTrack?.bpm || 100,
      beatsPerItem: template?.beatsPerEdit || 4,
    };
  }

  // Content card overlay for promotion videos
  const contentCard: ContentCardConfig | undefined = draftConfig.offerCard
    ? {
        serviceName: draftConfig.offerCard.serviceName,
        serviceDescription: draftConfig.offerCard.serviceDescription,
        headline: draftConfig.offerCard.headline,
        originalPriceCents: draftConfig.offerCard.originalPriceCents,
        offerPriceCents: draftConfig.offerCard.offerPriceCents,
        discountPercent: draftConfig.offerCard.discountPercent,
        bulletPoints: draftConfig.offerCard.bulletPoints,
        ctaText: draftConfig.offerCard.ctaText,
        urgencyText: draftConfig.offerCard.urgencyText,
        audienceText: draftConfig.offerCard.audienceText,
        logoUrl: draftConfig.offerCard.logoUrl
          ? await ctx.presignUrl(draftConfig.offerCard.logoUrl)
          : undefined,
        businessName: draftConfig.offerCard.businessName,
        primaryColor: draftConfig.offerCard.primaryColor,
        secondaryColor: draftConfig.offerCard.secondaryColor,
        currencyCode: draftConfig.offerCard.currencyCode,
      }
    : undefined;

  return { remotionTextFrames, stackedListConfig, contentCard };
}

/**
 * Transcribe audio and build caption pages. Skipped for text_only.
 */
async function buildCaptionResult(
  ctx: BuilderContext,
  audioPath: string,
  draftConfig: VideoDraftConfig,
  isAiVoiceover: boolean,
  videoId: string,
  fps: number,
  onProgress?: (stage: string, progress: number) => void,
  timings?: ProcessingTimings
): Promise<{ captionPages: CaptionPage[] }> {
  // Transcribe audio (works on any WAV — talking head or TTS)
  await ctx.updateVideoStage(videoId, 'transcribing');
  if (timings) timings.transcribeStart = Date.now();
  onProgress?.('Transcribing audio', 0.3);
  const whisperCaptions = await ctx.transcribe(audioPath);
  if (timings) timings.transcribeEnd = Date.now();

  // Align caption text to Whisper timing
  const captionTextSource =
    draftConfig.editedCaptionText ??
    (isAiVoiceover ? draftConfig.scriptText : null);
  const finalCaptions = captionTextSource
    ? alignEditedCaptions(whisperCaptions, captionTextSource)
    : whisperCaptions;

  // Build TikTok-style caption pages
  await ctx.updateVideoStage(videoId, 'building_captions');
  if (timings) timings.buildCaptionsStart = Date.now();
  onProgress?.('Building captions', 0.5);
  const captionPages = buildCaptionPages(finalCaptions, {
    fps,
    maxWordsPerPage: 5,
    maxPageDurationMs: 1200,
  });
  if (timings) timings.buildCaptionsEnd = Date.now();

  return { captionPages };
}

/**
 * Build outro layout config from org preferences + draft config.
 */
async function buildOutroLayout(
  ctx: BuilderContext,
  outroConfig: VideoDraftConfig['outro'],
  org: OrgDetails | null,
  fps: number
): Promise<OutroLayoutConfig | undefined> {
  if (!outroConfig) return undefined;

  const outroLayoutStyle =
    outroConfig.outroStyle || org?.outroStyle || 'tagline';
  const rawLogoUrl = outroConfig.logoUrl || org?.logo || undefined;

  return {
    layout: outroLayoutStyle,
    businessName: outroConfig.businessName || org?.name || '',
    tagline: org?.tagline || undefined,
    primaryColor: org?.primaryColor || '#6366f1',
    secondaryColor: org?.secondaryColor || '#8b5cf6',
    backgroundColor: org?.backgroundColor || '#FFFFFF',
    address: org?.address || undefined,
    ctaText: outroConfig.ctaText || 'Book Now',
    logoUrl: rawLogoUrl ? await ctx.presignUrl(rawLogoUrl) : undefined,
    durationInFrames: Math.round((outroConfig.durationSec || 3) * fps),
  };
}

/**
 * Build music config from draft config.
 */
function buildMusicConfig(
  draftConfig: VideoDraftConfig
): MusicConfig | undefined {
  return draftConfig.musicUrl && draftConfig.musicTrackId
    ? {
        trackId: draftConfig.musicTrackId,
        url: draftConfig.musicUrl,
        volume: draftConfig.musicVolume || 0.05,
      }
    : undefined;
}

/**
 * Build caption style from draft config captions settings.
 */
function buildCaptionStyle(
  captions?: VideoDraftConfig['captions']
): TikTokCaptionStyle {
  const captionConfig = captions || {
    position: 'center' as const,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 64,
    textColor: '#FFFFFF',
    highlightColor: '#FFFFFF',
    backgroundColor: 'transparent',
    showBackground: false,
  };
  return {
    position: captionConfig.position || 'center',
    fontFamily: captionConfig.fontFamily || 'Inter, system-ui, sans-serif',
    fontSize: captionConfig.fontSize || 64,
    color: captionConfig.textColor || '#FFFFFF',
    highlightColor: captionConfig.highlightColor || '#FFFFFF',
    backgroundColor: captionConfig.backgroundColor || 'transparent',
    showBackground: captionConfig.showBackground || false,
    strokeWidth: 20,
    strokeColor: '#000000',
  };
}

/**
 * Build the scenes array based on narration type.
 */
function buildScenesArray(
  bRollScenes: Scene[],
  totalDurationFrames: number,
  isAiVoiceover: boolean,
  isTextOnly: boolean,
  presignedTalkingHeadUrl?: string
): Scene[] {
  // AI voiceover and text_only: b-roll only (no talking head)
  if (isAiVoiceover || isTextOnly) {
    return [...bRollScenes];
  }
  // Recorded: talking head base + b-roll overlays
  return [
    {
      id: 'talking-head-main',
      type: 'talking-head' as const,
      clipUrl: presignedTalkingHeadUrl as string,
      trimStart: 0,
      trimEnd: 0,
      startFrame: 0,
      durationInFrames: totalDurationFrames,
    },
    ...bRollScenes,
  ];
}

// ================================================================
// Main builder function
// ================================================================

/**
 * Build EditorState from draft config.
 *
 * Unified pipeline — narration type only affects audio resolution (done externally)
 * and a few scheduling params. Template overlays run for ALL narration types.
 */
export async function buildEditorState(
  ctx: BuilderContext,
  draftConfig: VideoDraftConfig,
  organizationId: string,
  videoId: string,
  options: BuilderOptions
): Promise<EditorState> {
  const { narration, templateId, variationId, onProgress, timings } = options;
  const fps = DEFAULT_FPS;

  // Pre-flight validation
  if (!draftConfig.narrationType) {
    throw new Error(
      `Video ${videoId}: narrationType is not set. Cannot determine whether to use recorded talking head, AI voiceover, or text_only.`
    );
  }

  const isAiVoiceover = draftConfig.narrationType === 'ai_voiceover';
  const isTextOnly = draftConfig.narrationType === 'text_only';
  const isEducational = variationId?.startsWith('educational-') ?? false;

  const hasOfferCard = isTextOnly && !!draftConfig.offerCard;
  const isBeforeAfterTemplate =
    variationId?.startsWith('before-after-') ?? false;
  if (isTextOnly) {
    if (
      !hasOfferCard &&
      !isBeforeAfterTemplate &&
      (!draftConfig.textFrames || draftConfig.textFrames.length === 0)
    ) {
      throw new Error(
        `Video ${videoId}: text_only mode requires at least one text frame or an offer card`
      );
    }
    if (!draftConfig.bRollClips || draftConfig.bRollClips.length === 0) {
      throw new Error(
        `Video ${videoId}: text_only mode requires at least one b-roll clip for visual content`
      );
    }
  } else if (isAiVoiceover) {
    if (!draftConfig.scriptText) {
      throw new Error(`Video ${videoId}: AI voiceover requires scriptText`);
    }
    if (!draftConfig.aiVoiceId) {
      throw new Error(`Video ${videoId}: AI voiceover requires aiVoiceId`);
    }
    if (!draftConfig.bRollClips || draftConfig.bRollClips.length === 0) {
      throw new Error(
        `Video ${videoId}: AI voiceover requires at least one b-roll clip for visual content`
      );
    }
  } else {
    if (
      !draftConfig.talkingHeadUrl ||
      draftConfig.talkingHeadUrl.trim() === ''
    ) {
      throw new Error(
        `Video ${videoId}: Recorded narration requires a talkingHeadUrl`
      );
    }
  }

  // Step 1: Fetch org details + template
  onProgress?.('Loading organization', 0.05);
  const org = await ctx.getOrganizationDetails(organizationId);
  const template = templateId ? getTemplateById(templateId) : undefined;
  const selectedTrack =
    template?.musicTracks && draftConfig.musicTrackId
      ? template.musicTracks.find((t) => t.id === draftConfig.musicTrackId)
      : undefined;

  const totalDurationSec = narration.audioDurationSec;
  const totalDurationFrames = Math.round(totalDurationSec * fps);

  // Step 2: Resolve b-roll assets
  await ctx.updateVideoStage(videoId, 'resolving_assets');
  if (timings) timings.resolveAssetsStart = Date.now();
  onProgress?.('Resolving b-roll assets', narration.audioPath ? 0.55 : 0.3);
  const bRollAssetIds = (draftConfig.bRollClips || []).map(
    (clip: BRollClipConfig) => clip.assetId
  );
  const bRollAssetMap = await ctx.resolveBRollAssets(bRollAssetIds);
  if (timings) timings.resolveAssetsEnd = Date.now();

  // Step 3: Build + schedule b-roll
  if (timings) timings.scheduleBRollStart = Date.now();
  onProgress?.('Scheduling b-roll', narration.audioPath ? 0.6 : 0.5);
  const allBRollClips = buildBRollClips(
    draftConfig.bRollClips || [],
    bRollAssetMap,
    ctx.log
  );

  // For before-after-1: separate before/after clips from scheduling.
  const isBeforeAfterVar = variationId?.startsWith('before-after-');
  const schedulingClips = isBeforeAfterVar
    ? allBRollClips.filter(
        (c) => c.clipType !== 'before' && c.clipType !== 'after'
      )
    : allBRollClips;
  const beforeAfterClips = isBeforeAfterVar
    ? allBRollClips.filter(
        (c) => c.clipType === 'before' || c.clipType === 'after'
      )
    : [];

  const schedulingParams = getBRollSchedulingParams(
    draftConfig,
    isTextOnly,
    isAiVoiceover
  );
  const scheduledBRoll = scheduleBRollClips(schedulingClips, {
    totalDurationSec,
    ...schedulingParams,
    minClipDurationSec: 2,
    maxClipDurationSec: 5,
    fps,
    bpm: selectedTrack?.bpm,
    beatsPerEdit: template?.beatsPerEdit,
  });

  // For before-after: add before/after as virtual scenes
  if (isBeforeAfterVar && beforeAfterClips.length > 0) {
    const beforeClip = beforeAfterClips.find((c) => c.clipType === 'before');
    const afterClip = beforeAfterClips.find((c) => c.clipType === 'after');

    if (beforeClip) {
      const pipStartSec = 0.5;
      const pipDurationSec = 1.5;
      scheduledBRoll.push({
        id: beforeClip.id,
        url: beforeClip.url,
        startTimeSec: pipStartSec,
        durationSec: pipDurationSec,
        trimStartSec: 0,
        clipType: 'before',
      });
    }
    if (afterClip) {
      const afterStartSec = Math.min(3, totalDurationSec * 0.5);
      const afterDurationSec = Math.min(1.5, totalDurationSec - afterStartSec);
      scheduledBRoll.push({
        id: afterClip.id,
        url: afterClip.url,
        startTimeSec: afterStartSec,
        durationSec: afterDurationSec,
        trimStartSec: 0,
        clipType: 'after',
      });
    }
  }

  // Step 4: Convert to scenes
  ctx.log.info(
    `[debug] clipType chain: draft=${JSON.stringify((draftConfig.bRollClips || []).map((c) => ({ a: c.assetId.slice(0, 8), ct: c.clipType ?? 'NONE' })))} built=${JSON.stringify(allBRollClips.map((c) => ({ a: c.id.slice(0, 8), ct: c.clipType ?? 'NONE' })))} scheduled=${JSON.stringify(scheduledBRoll.map((c) => ({ a: c.id.slice(0, 8), ct: c.clipType ?? 'NONE' })))}`
  );
  const clipLookup = new Map(allBRollClips.map((c) => [c.id, c]));
  const bRollScenes = scheduledClipsToScenes(scheduledBRoll, fps, clipLookup);
  if (timings) timings.scheduleBRollEnd = Date.now();

  // Step 5: Build scenes array
  if (timings) timings.buildConfigStart = Date.now();
  onProgress?.('Building video config', 0.7);
  const scenes = buildScenesArray(
    bRollScenes,
    totalDurationFrames,
    isAiVoiceover,
    isTextOnly,
    narration.presignedTalkingHeadUrl
  );

  // Step 6: Build template overlays (ALL narration types)
  const overlays = await buildTemplateOverlays(
    ctx,
    draftConfig,
    bRollScenes,
    variationId,
    fps
  );

  // Step 7: Build text-only extras (text_only only)
  const textOnlyExtras = isTextOnly
    ? await buildTextOnlyExtras(
        ctx,
        narration.parsedTextFrames || [],
        isEducational,
        org,
        draftConfig,
        fps,
        selectedTrack,
        template
      )
    : undefined;

  // Step 8: Transcribe + build captions (skip for text_only)
  let captionPages: CaptionPage[] = [];
  if (narration.audioPath) {
    const captionResult = await buildCaptionResult(
      ctx,
      narration.audioPath,
      draftConfig,
      isAiVoiceover,
      videoId,
      fps,
      onProgress,
      timings
    );
    const captionsEnabled = draftConfig.captions?.enabled !== false;
    captionPages = captionsEnabled ? captionResult.captionPages : [];
  }

  // Step 9: Build outro, music, narration audio, caption style
  const outroLayout =
    isTextOnly && isEducational
      ? undefined
      : await buildOutroLayout(ctx, draftConfig.outro, org, fps);
  const music = buildMusicConfig(draftConfig);
  const tikTokCaptionStyle = buildCaptionStyle(draftConfig.captions);
  const narrationAudio =
    isAiVoiceover && narration.narrationAudioUrl
      ? { url: narration.narrationAudioUrl, volume: 1 }
      : undefined;

  if (timings) timings.buildConfigEnd = Date.now();
  onProgress?.('Config ready', 0.8);

  // Step 10: Assemble EditorState using EditorStateAssembler
  const isBeforeAfter = variationId?.startsWith('before-after-');
  const orientation: VideoOrientation = draftConfig.orientation || 'portrait';
  const dims = getDimensions(orientation);
  const asm = new EditorStateAssembler();

  // --- base-video track: talking head ---
  const talkingHeadScene = scenes.find((s) => s.type === 'talking-head');
  if (talkingHeadScene) {
    const assetId = asm.addAsset('video', talkingHeadScene.clipUrl);

    // Pre-compute hidden ranges from b-roll scenes
    const bRollItems = scenes.filter((s) => s.type === 'b-roll');
    const hiddenRanges = bRollItems.map((s) => ({
      from: s.startFrame,
      durationInFrames: s.durationInFrames,
    }));

    asm.addItem('base-video', 'Base Video', {
      type: 'talking-head',
      from: talkingHeadScene.startFrame,
      durationInFrames: talkingHeadScene.durationInFrames,
      assetId,
      trimStart: talkingHeadScene.trimStart,
      volume: 1,
      hiddenRanges,
    } as Omit<Item, 'id' | 'trackId'>);
  }

  // --- b-roll track ---
  const bRollSceneItems = scenes.filter((s) => s.type === 'b-roll');
  if (bRollSceneItems.length > 0) {
    for (const scene of bRollSceneItems) {
      const assetId = asm.addAsset(
        scene.mediaType === 'image' ? 'image' : 'video',
        scene.clipUrl
      );
      asm.addItem('b-roll', 'B-Roll', {
        type: 'b-roll',
        from: scene.startFrame,
        durationInFrames: scene.durationInFrames,
        assetId,
        trimStart: scene.trimStart,
        transition: (scene.transition === 'fade' ? 'fade' : 'none') as
          | 'fade'
          | 'none',
        mediaType: (scene.mediaType || 'video') as 'video' | 'image',
        bRollType: scene.bRollType as
          | 'before'
          | 'after'
          | 'procedure'
          | undefined,
        variationId: variationId as TemplateVariationId | undefined,
      } as Omit<Item, 'id' | 'trackId'>);
    }
  }

  // --- reveals track: full-screen reveals ---
  if (overlays.fullScreenReveals && overlays.fullScreenReveals.length > 0) {
    for (const reveal of overlays.fullScreenReveals) {
      const assetId = asm.addAsset(
        reveal.mediaType === 'image' ? 'image' : 'video',
        reveal.src
      );
      let sfxAssetId: string | undefined;
      if (reveal.soundEffectUrl) {
        sfxAssetId = asm.addAsset('audio', reveal.soundEffectUrl);
      }
      asm.addItem('reveals', 'Reveals', {
        type: 'full-screen-reveal',
        from: reveal.startFrame,
        durationInFrames: reveal.durationInFrames,
        assetId,
        mediaType: reveal.mediaType,
        trimStart: reveal.trimStart,
        zoomRange: reveal.zoomRange,
        transition: reveal.transition,
        transitionDurationFrames: reveal.transitionDurationFrames,
        label: reveal.label,
        labelPosition: reveal.labelPosition,
        soundEffectAssetId: sfxAssetId,
        soundEffectVolume: reveal.soundEffectVolume,
      } as Omit<Item, 'id' | 'trackId'>);
    }
  }

  // --- audio track: narration + music ---
  if (narrationAudio) {
    const assetId = asm.addAsset('audio', narrationAudio.url);
    asm.addItem('audio', 'Audio', {
      type: 'narration-audio',
      from: 0,
      durationInFrames: totalDurationFrames,
      assetId,
      volume: narrationAudio.volume ?? 1,
    } as Omit<Item, 'id' | 'trackId'>);
  }
  if (music) {
    const assetId = asm.addAsset('audio', music.url);
    asm.addItem('audio', 'Audio', {
      type: 'music',
      from: 0,
      durationInFrames: totalDurationFrames,
      assetId,
      volume: music.volume,
      fps,
    } as Omit<Item, 'id' | 'trackId'>);
  }

  // --- text track: text interstitials + text frames + stacked-list ---
  if (overlays.textInterstitials && overlays.textInterstitials.length > 0) {
    for (const ti of overlays.textInterstitials) {
      let sfxAssetId: string | undefined;
      if (ti.soundEffectUrl) {
        sfxAssetId = asm.addAsset('audio', ti.soundEffectUrl);
      }
      asm.addItem('text', 'Text', {
        type: 'text-interstitial',
        from: ti.startFrame,
        durationInFrames: ti.durationInFrames,
        text: ti.text,
        verticalPosition: ti.verticalPosition,
        fontSize: ti.fontSize,
        soundEffectAssetId: sfxAssetId,
      } as Omit<Item, 'id' | 'trackId'>);
    }
  }
  const textFrames = isBeforeAfter
    ? undefined
    : textOnlyExtras?.remotionTextFrames;
  if (textFrames && textFrames.length > 0) {
    for (const tf of textFrames) {
      asm.addItem('text', 'Text', {
        type: 'text-frame',
        from: tf.startFrame,
        durationInFrames: tf.durationInFrames,
        text: tf.text,
        style: tf.style,
      } as Omit<Item, 'id' | 'trackId'>);
    }
  }
  if (textOnlyExtras?.stackedListConfig) {
    asm.addItem('text', 'Text', {
      type: 'stacked-list',
      from: 0,
      durationInFrames: totalDurationFrames,
      config: textOnlyExtras.stackedListConfig,
      orientation,
    } as Omit<Item, 'id' | 'trackId'>);
  }

  // --- captions track ---
  if (captionPages.length > 0) {
    asm.addItem('captions', 'Captions', {
      type: 'tiktok-captions',
      from: 0,
      durationInFrames: totalDurationFrames,
      pages: captionPages,
      style: tikTokCaptionStyle,
    } as Omit<Item, 'id' | 'trackId'>);
  }

  // --- overlays track: PiP + content card ---
  if (overlays.pipOverlays && overlays.pipOverlays.length > 0) {
    for (const pip of overlays.pipOverlays) {
      asm.addItem('overlays', 'Overlays', {
        type: 'pip-overlay',
        from: pip.startFrame,
        durationInFrames: pip.durationInFrames,
        imageUrl: pip.imageUrl,
        label: pip.label,
        position: pip.position,
        sizePercent: pip.sizePercent,
        soundEffectUrl: pip.soundEffectUrl,
      } as Omit<Item, 'id' | 'trackId'>);
    }
  }
  if (textOnlyExtras?.contentCard) {
    asm.addItem('overlays', 'Overlays', {
      type: 'content-card',
      from: 0,
      durationInFrames: totalDurationFrames,
      card: textOnlyExtras.contentCard,
      fps,
      variant: 'dark-overlay',
    } as Omit<Item, 'id' | 'trackId'>);
  }

  // --- outro track ---
  if (outroLayout) {
    const outroStartFrame = totalDurationFrames - outroLayout.durationInFrames;
    asm.addItem('outro', 'Outro', {
      type: 'outro-layout',
      from: Math.max(0, outroStartFrame),
      durationInFrames: outroLayout.durationInFrames,
      config: outroLayout,
    } as Omit<Item, 'id' | 'trackId'>);
  }

  return asm.build({
    fps,
    durationInFrames: totalDurationFrames,
    compositionWidth: dims.width,
    compositionHeight: dims.height,
    orientation,
  });
}
