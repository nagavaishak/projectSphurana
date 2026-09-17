import { type Video, video, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import type { ClipSlot, VideoSlotStatus } from '../../models/index.js';
import { getVariationById } from '../../templates/index.js';
import {
  type GetVideoSlotStatusInput,
  getVideoSlotStatusSchema,
} from './get-video-slot-status.schema.js';

/**
 * Extended draft config interface to handle legacy script fields
 * These fields may exist in older videos created before the current schema
 */
interface ExtendedDraftConfig {
  talkingHeadAssetId?: string;
  talkingHeadUrl?: string;
  bRollClips?: Array<{
    assetId: string;
    url: string;
    order: number;
    clipType?: 'before' | 'after' | 'bRoll';
  }>;
  // User-edited script text (new field)
  scriptText?: string;
  // Narration type: recorded (default) or AI voiceover
  narrationType?: 'recorded' | 'ai_voiceover';
  // Legacy script fields (may exist in some videos)
  hook?: string;
  script?: string;
  cta?: string;
}

/**
 * Build clip slots for a video based on its variation
 */
function buildSlots(
  videoData: Video,
  draftConfig: ExtendedDraftConfig | null
): ClipSlot[] {
  const slots: ClipSlot[] = [];

  const isAiVoiceover = draftConfig?.narrationType === 'ai_voiceover';

  // Always add talking head slot first (order 0) — only for recorded narration
  if (!isAiVoiceover) {
    slots.push({
      type: 'talkingHead',
      order: 0,
      label: 'Talking Head',
      description: 'Record yourself speaking to camera with the teleprompter',
      filled: draftConfig?.talkingHeadUrl
        ? {
            assetId: draftConfig.talkingHeadAssetId ?? null,
            url: draftConfig.talkingHeadUrl,
          }
        : null,
    });
  }

  const bRollClips = draftConfig?.bRollClips ?? [];

  // For AI voiceover, return a single generic background footage slot
  if (isAiVoiceover) {
    const filledClips = bRollClips.filter((clip) => clip.assetId && clip.url);
    slots.push({
      type: 'bRoll',
      order: 1,
      label: 'Background Footage',
      description: 'B-roll clips to show during your video',
      filled:
        filledClips.length > 0
          ? { assetId: filledClips[0].assetId, url: filledClips[0].url }
          : null,
    });
    return slots;
  }

  // If video has a variation, get clip guidance from it
  if (videoData.variationId) {
    const variationResult = getVariationById(videoData.variationId);
    if (variationResult) {
      const { variation } = variationResult;

      // Add slots from clip guidance
      for (const guidance of variation.clipGuidance) {
        // Check if this slot is filled
        const filledClip = bRollClips.find(
          (clip) => clip.order === guidance.order
        );

        slots.push({
          type: 'bRoll',
          order: guidance.order,
          label: guidance.label,
          description: guidance.description,
          filled: filledClip
            ? { assetId: filledClip.assetId, url: filledClip.url }
            : null,
        });
      }
    }
  }

  return slots;
}

/**
 * Extract script from video data
 * Handles both variation scriptTemplate and legacy direct script fields
 */
function extractScript(
  videoData: Video,
  draftConfig: ExtendedDraftConfig | null
): VideoSlotStatus['script'] {
  // 1. Check for user-edited scriptText (new field, highest priority)
  if (draftConfig?.scriptText) {
    return {
      fullText: draftConfig.scriptText,
    };
  }

  // 2. Check for legacy direct script fields in draftConfig
  if (draftConfig?.hook || draftConfig?.script || draftConfig?.cta) {
    const parts = [draftConfig.hook, draftConfig.script, draftConfig.cta]
      .filter(Boolean)
      .join('\n\n');
    return {
      hook: draftConfig.hook,
      body: draftConfig.script,
      cta: draftConfig.cta,
      fullText: parts,
    };
  }

  // 3. Fallback to template variation's scriptTemplate
  if (videoData.variationId) {
    const variationResult = getVariationById(videoData.variationId);
    if (variationResult) {
      return {
        fullText: variationResult.variation.scriptTemplate,
      };
    }
  }

  return null;
}

/**
 * Check if all required slots are filled
 */
function checkIsComplete(slots: ClipSlot[]): boolean {
  return slots.every((slot) => slot.filled !== null);
}

/**
 * Internal implementation of get video slot status
 */
const getVideoSlotStatusImpl = async (
  db: DbConnection,
  input: GetVideoSlotStatusInput
): Promise<Result<VideoSlotStatus>> => {
  // Validate input
  const parsed = getVideoSlotStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Fetch video
  const [videoData] = await db
    .select()
    .from(video)
    .where(and(eq(video.id, parsed.data.videoId), notDeleted(video)))
    .limit(1);

  if (!videoData) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found', {
        videoId: parsed.data.videoId,
      })
    );
  }

  const draftConfig = videoData.draftConfig as ExtendedDraftConfig | null;
  const slots = buildSlots(videoData, draftConfig);
  const isComplete = checkIsComplete(slots);
  const script = extractScript(videoData, draftConfig);

  return ok({
    videoId: videoData.id,
    title: videoData.title,
    variationId: videoData.variationId,
    slots,
    isComplete,
    script,
    thumbnailUrl: videoData.thumbnailUrl,
  });
};

/**
 * Get the slot status for a video
 * Returns which clips have been uploaded and which are still needed
 *
 * @param db - Database connection
 * @param input - Video ID to get slot status for
 * @returns Result with slot status or error
 */
export const getVideoSlotStatus = (
  db: DbConnection,
  input: GetVideoSlotStatusInput
) =>
  trackedResult(
    'videos.getVideoSlotStatus',
    () => withOrgScope((tx) => getVideoSlotStatusImpl(tx, input), { db }),
    { properties: { videoId: input.videoId }, internalErrorsOnly: true }
  );

/**
 * Result type for getVideoSlotStatus
 */
export type GetVideoSlotStatusResult = Awaited<
  ReturnType<typeof getVideoSlotStatus>
>;
