import { type Video, video, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import type { InProgressVideo, VideoSlotSummary } from '../../models/index.js';
import { getVariationById } from '../../templates/index.js';
import {
  type ListInProgressVideosInput,
  listInProgressVideosSchema,
} from './list-in-progress-videos.schema.js';

/**
 * Extended draft config interface for checking completion
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
}

/**
 * Calculate slot summary for a video
 */
function calculateSlotSummary(
  videoData: Video,
  draftConfig: ExtendedDraftConfig | null
): VideoSlotSummary {
  // Count required slots: talking head + clip guidance
  let totalRequired = 1; // Talking head is always required
  let filled = 0;

  // Check talking head — URL alone is sufficient (mobile camera recording
  // sets talkingHeadUrl without creating an asset, so talkingHeadAssetId may be absent)
  const hasTalkingHead = Boolean(draftConfig?.talkingHeadUrl);
  if (hasTalkingHead) {
    filled += 1;
  }

  // Check b-roll based on variation
  if (videoData.variationId) {
    const variationResult = getVariationById(videoData.variationId);
    if (variationResult) {
      const guidanceCount = variationResult.variation.clipGuidance.length;
      totalRequired += guidanceCount;

      // Count filled b-roll slots that match guidance order
      const bRollClips = draftConfig?.bRollClips ?? [];
      const guidanceOrders = new Set(
        variationResult.variation.clipGuidance.map((g) => g.order)
      );
      const filledBRoll = bRollClips.filter((clip) =>
        guidanceOrders.has(clip.order)
      ).length;
      filled += filledBRoll;
    }
  }

  return {
    totalRequired,
    filled,
    needsTalkingHead: !hasTalkingHead,
  };
}

/**
 * Check if a video is incomplete (has unfilled slots)
 */
function isIncomplete(summary: VideoSlotSummary): boolean {
  return summary.filled < summary.totalRequired;
}

/**
 * Internal implementation of list in-progress videos
 */
const listInProgressVideosImpl = async (
  db: DbConnection,
  input: ListInProgressVideosInput
): Promise<Result<{ items: InProgressVideo[]; total: number }>> => {
  // Validate input
  const parsed = listInProgressVideosSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, limit, offset } = parsed.data;

  // Get all draft videos for the organization
  const draftVideos = await db
    .select()
    .from(video)
    .where(
      and(
        eq(video.organizationId, organizationId),
        eq(video.status, 'draft'),
        notDeleted(video)
      )
    )
    .orderBy(desc(video.createdAt));

  // Filter to incomplete videos and calculate summaries
  const incompleteVideos: InProgressVideo[] = [];

  for (const v of draftVideos) {
    const draftConfig = v.draftConfig as ExtendedDraftConfig | null;
    const slotSummary = calculateSlotSummary(v, draftConfig);

    if (isIncomplete(slotSummary)) {
      incompleteVideos.push({
        id: v.id,
        title: v.title,
        status: v.status,
        variationId: v.variationId,
        templateId: v.templateId,
        thumbnailUrl: v.thumbnailUrl,
        createdAt: v.createdAt,
        slotSummary,
      });
    }
  }

  // Get total count before pagination
  const total = incompleteVideos.length;

  // Apply pagination
  const paginatedItems = incompleteVideos.slice(offset, offset + limit);

  return ok({
    items: paginatedItems,
    total,
  });
};

/**
 * List videos that are in progress (have unfilled clip slots)
 * Used by mobile app to show videos that need recording/uploading
 *
 * @param db - Database connection
 * @param input - Organization ID and pagination params
 * @returns Result with in-progress videos or error
 */
export const listInProgressVideos = (
  db: DbConnection,
  input: ListInProgressVideosInput
) =>
  trackedResult(
    'videos.listInProgressVideos',
    () => withOrgScope((tx) => listInProgressVideosImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

/**
 * Result type for listInProgressVideos
 */
export type ListInProgressVideosResult = Awaited<
  ReturnType<typeof listInProgressVideos>
>;
