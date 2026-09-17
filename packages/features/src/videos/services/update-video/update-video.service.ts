import {
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
import {
  type UpdateVideoInput,
  updateVideoSchema,
} from './update-video.schema.js';

/**
 * Deep merge for VideoDraftConfig — merges nested objects like captions, outro
 * instead of overwriting them. Top-level primitives are replaced as normal.
 *
 * Null handling:
 * - `undefined` = "not included in this update" → skip (keep existing value)
 * - `null` = "explicitly clear this field" → set to undefined in merged config
 * - any value = replace existing value
 */
function deepMergeDraftConfig(
  existing: VideoDraftConfig,
  partial: Partial<VideoDraftConfig>
): VideoDraftConfig {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;

    const k = key as keyof VideoDraftConfig;

    // null means "clear this field" — remove it from the merged config
    if (value === null) {
      (merged as Record<string, unknown>)[k] = undefined;
      continue;
    }

    const existingVal = existing[k];

    // Deep merge plain objects (captions, outro) but not arrays (bRollClips)
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existingVal !== null &&
      existingVal !== undefined &&
      typeof existingVal === 'object' &&
      !Array.isArray(existingVal)
    ) {
      (merged as Record<string, unknown>)[k] = {
        ...existingVal,
        ...value,
      };
    } else {
      (merged as Record<string, unknown>)[k] = value;
    }
  }

  return merged;
}

/**
 * Internal implementation of update video
 */
const updateVideoImpl = async (
  db: DbConnection,
  input: UpdateVideoInput
): Promise<Result<Video>> => {
  // Validate input
  const parsed = updateVideoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, ...updateData } = parsed.data;

  // Filter out undefined values
  const filteredData = Object.fromEntries(
    Object.entries(updateData).filter(([, value]) => value !== undefined)
  );

  if (Object.keys(filteredData).length === 0) {
    // Nothing to update, return current video
    const [current] = await db
      .select()
      .from(video)
      .where(and(eq(video.id, id), notDeleted(video)))
      .limit(1);

    if (!current) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'));
    }

    return ok(current);
  }

  // Deep merge partial draftConfig with existing instead of replacing
  if (filteredData.draftConfig) {
    const [existing] = await db
      .select({ draftConfig: video.draftConfig })
      .from(video)
      .where(and(eq(video.id, id), notDeleted(video)))
      .limit(1);

    if (!existing) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'));
    }

    if (existing.draftConfig) {
      filteredData.draftConfig = deepMergeDraftConfig(
        existing.draftConfig,
        filteredData.draftConfig as Partial<VideoDraftConfig>
      );
    }
  }

  try {
    const [result] = await db
      .update(video)
      .set(filteredData)
      .where(and(eq(video.id, id), notDeleted(video)))
      .returning();

    if (!result) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'));
    }

    return ok(result);
  } catch (error) {
    logError('videos.updateVideo', error, {
      feature: 'videos',
      extra: { videoId: id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update video')
    );
  }
};

/**
 * Update a video
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Update video input with fields to update
 * @returns Result with updated video or error
 */
export const updateVideo = (db: DbConnection, input: UpdateVideoInput) =>
  trackedResult(
    'videos.updateVideo',
    () => withOrgScope((tx) => updateVideoImpl(tx, input), { db }),
    { properties: { videoId: input.id } }
  );

/**
 * Result type for updateVideo
 */
export type UpdateVideoResult = Awaited<ReturnType<typeof updateVideo>>;
