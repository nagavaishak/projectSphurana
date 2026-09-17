import {
  type BRollClipConfig,
  type Video,
  type VideoDraftConfig,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
import type { VideoSlotStatus } from '../../models/index.js';
import { getVariationById } from '../../templates/index.js';
import { queueVideoExport } from '../queue-video-export/index.js';
import {
  type AddVideoClipInput,
  addVideoClipSchema,
} from './add-video-clip.schema.js';

/**
 * Response type for add video clip
 */
export interface AddVideoClipResponse {
  video: Video;
  slotStatus: VideoSlotStatus;
  autoQueued: boolean;
}

/**
 * Extended draft config interface for flexible updates
 */
interface ExtendedDraftConfig extends Partial<VideoDraftConfig> {
  talkingHeadAssetId?: string;
  talkingHeadUrl?: string;
  bRollClips?: BRollClipConfig[];
  // Legacy script fields
  hook?: string;
  script?: string;
  cta?: string;
}

/**
 * Build slot status from video data
 */
function buildSlotStatus(
  videoData: Video,
  draftConfig: ExtendedDraftConfig | null
): VideoSlotStatus {
  const slots: VideoSlotStatus['slots'] = [];

  // Always add talking head slot first (order 0)
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

  // If video has a variation, get clip guidance from it
  if (videoData.variationId) {
    const variationResult = getVariationById(videoData.variationId);
    if (variationResult) {
      const { variation } = variationResult;
      const bRollClips = draftConfig?.bRollClips ?? [];

      // Add slots from clip guidance
      for (const guidance of variation.clipGuidance) {
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

  // Extract script
  let script: VideoSlotStatus['script'] = null;
  if (draftConfig?.hook || draftConfig?.script || draftConfig?.cta) {
    const parts = [draftConfig.hook, draftConfig.script, draftConfig.cta]
      .filter(Boolean)
      .join('\n\n');
    script = {
      hook: draftConfig.hook,
      body: draftConfig.script,
      cta: draftConfig.cta,
      fullText: parts,
    };
  } else if (videoData.variationId) {
    const variationResult = getVariationById(videoData.variationId);
    if (variationResult) {
      script = {
        fullText: variationResult.variation.scriptTemplate,
      };
    }
  }

  const isComplete = slots.every((slot) => slot.filled !== null);

  return {
    videoId: videoData.id,
    title: videoData.title,
    variationId: videoData.variationId,
    slots,
    isComplete,
    script,
    thumbnailUrl: videoData.thumbnailUrl,
  };
}

/**
 * Internal implementation of add video clip
 */
const addVideoClipImpl = async (
  db: DbConnection,
  input: AddVideoClipInput
): Promise<Result<AddVideoClipResponse>> => {
  // Validate input
  const parsed = addVideoClipSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { videoId, slotType, assetId, url, order, clipType } = parsed.data;

  // Fetch video
  const [videoData] = await db
    .select()
    .from(video)
    .where(and(eq(video.id, videoId), notDeleted(video)))
    .limit(1);

  if (!videoData) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found', { videoId })
    );
  }

  // Verify video is in draft status
  if (videoData.status !== 'draft') {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        `Cannot add clips to video with status '${videoData.status}'. Video must be in draft status.`,
        { currentStatus: videoData.status }
      )
    );
  }

  // Get current draft config or create default
  const currentConfig = (videoData.draftConfig as ExtendedDraftConfig) ?? {
    bRollClips: [],
    captions: {
      enabled: true,
      position: 'bottom',
      fontFamily: 'inter',
      fontSize: 24,
      textColor: '#FFFFFF',
      highlightColor: '#FFD700',
      backgroundColor: '#000000',
      showBackground: true,
    },
    musicVolume: 0.05,
    outro: {
      businessName: '',
      ctaText: '',
      backgroundOpacity: 0.8,
      backgroundColor: '#000000',
      textColor: '#FFFFFF',
      durationSec: 3,
    },
    orientation: 'portrait' as const,
  };

  // Update config based on slot type
  let updatedConfig: ExtendedDraftConfig;

  if (slotType === 'talkingHead') {
    updatedConfig = {
      ...currentConfig,
      talkingHeadAssetId: assetId,
      talkingHeadUrl: url,
    };
  } else {
    // b-roll
    if (order === undefined) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Order is required for b-roll clips'
        )
      );
    }

    // Enforce template hard cap on b-roll count when set. Protects Remotion
    // Lambda from OOM when too many clips have to be decoded concurrently per
    // chunk. Only applied when the variation opts in via `maxBRollClips`.
    if (videoData.variationId) {
      const variationResult = getVariationById(videoData.variationId);
      const maxBRollClips = variationResult?.variation.maxBRollClips;
      if (maxBRollClips && order >= maxBRollClips) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            `This template supports a maximum of ${maxBRollClips} b-roll clips.`,
            { maxBRollClips, requestedOrder: order }
          )
        );
      }
    }

    const existingClips = currentConfig.bRollClips ?? [];

    // Remove any existing clip with the same order
    const filteredClips = existingClips.filter((clip) => clip.order !== order);

    // Add the new clip
    const newClip: BRollClipConfig = {
      assetId,
      url,
      order,
      clipType,
    };

    updatedConfig = {
      ...currentConfig,
      bRollClips: [...filteredClips, newClip].sort((a, b) => a.order - b.order),
    };
  }

  // Update video with new config
  const [updatedVideo] = await db
    .update(video)
    .set({ draftConfig: updatedConfig as VideoDraftConfig })
    .where(and(eq(video.id, videoId), notDeleted(video)))
    .returning();

  // Build slot status
  const slotStatus = buildSlotStatus(updatedVideo, updatedConfig);

  // Auto-queue if complete
  let autoQueued = false;
  if (slotStatus.isComplete) {
    try {
      const queueResult = await queueVideoExport(db, { id: videoId });
      if (queueResult.success) {
        autoQueued = true;
      }
    } catch (error) {
      // Log but don't fail the request if auto-queue fails
      logError('videos.addVideoClip.autoQueue', error, {
        feature: 'videos',
        extra: { videoId },
      });
    }
  }

  return ok({
    video: updatedVideo,
    slotStatus,
    autoQueued,
  });
};

/**
 * Add a clip to a video's draft configuration
 * Handles both talking head and b-roll clips
 * Automatically queues the video for rendering when all slots are filled
 *
 * @param db - Database connection
 * @param input - Clip data to add
 * @returns Result with updated video, slot status, and auto-queue flag
 */
export const addVideoClip = (db: DbConnection, input: AddVideoClipInput) =>
  trackedResult(
    'videos.addVideoClip',
    () => withOrgScope((tx) => addVideoClipImpl(tx, input), { db }),
    {
      properties: {
        videoId: input.videoId,
        slotType: input.slotType,
        order: input.order,
      },
    }
  );

/**
 * Result type for addVideoClip
 */
export type AddVideoClipResult = Awaited<ReturnType<typeof addVideoClip>>;
