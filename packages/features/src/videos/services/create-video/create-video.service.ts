import { randomUUID } from 'node:crypto';
import { type Video, video, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { selectRandomVariationForTemplate } from '../../templates/index.js';
import { ensureBRollClips } from '../queue-video-export/queue-video-export.service.js';
import {
  type CreateVideoInput,
  createVideoSchema,
} from './create-video.schema.js';

/**
 * Internal implementation of create video
 */
const createVideoImpl = async (
  db: DbConnection,
  input: CreateVideoInput
): Promise<Result<Video>> => {
  // Validate input
  const parsed = createVideoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Use provided variationId, or randomly select one from the template
  let variationId: string | undefined = parsed.data.variationId;
  if (!variationId && parsed.data.templateId) {
    const selection = selectRandomVariationForTemplate(parsed.data.templateId);
    if (selection) {
      variationId = selection.variation.id;
    }
  }

  try {
    // Create video with generated ID
    const [result] = await db
      .insert(video)
      .values({
        id: randomUUID(),
        title: parsed.data.title,
        templateId: parsed.data.templateId,
        variationId,
        serviceId: parsed.data.serviceId,
        offerId: parsed.data.offerId,
        draftConfig: parsed.data.draftConfig,
        status: 'draft',
        usageType: parsed.data.usageType ?? 'ad',
        progress: 0,
        organizationId: parsed.data.organizationId,
        createdById: parsed.data.createdById,
      })
      .returning();

    // Give it its footage NOW, not at export.
    //
    // A draft used to be born with `bRollClips: []` and the render filled them
    // in on the way past. That is fine for a renderer and wrong for a person:
    // the card in chat said "B-roll (0 / min 1) — pick at least 1 clip before
    // rendering", so the owner was asked to assemble a video the server could
    // assemble itself, and what they picked was frequently swapped out by the
    // export-time fill anyway.
    //
    // Filling here means the card shows the clips the render would actually
    // use, which is the difference between approving a video and being handed
    // an empty tray. The same function still runs at export for drafts that
    // never pass a card, and it no-ops on a draft that already has clips.
    //
    // Best-effort: a video that exists with no footage is recoverable — the
    // owner can pick, and export fills — whereas failing the create would lose
    // the draft entirely over an optional convenience.
    // MATCHED ONLY. The draft this creates is shown to the owner as a list of
    // the clips in their video, so it must not contain footage that was picked
    // merely because it was available — see `matchedOnly` on
    // `fillBRollForExport`. A service with no matched footage gets an empty
    // list and the card says so, which is the honest answer.
    const filled = await ensureBRollClips(db, result, {
      matchedOnly: true,
    }).catch((error) => {
      logError('videos.createVideo.ensureBRollClips', error, {
        feature: 'videos',
        extra: { videoId: result.id, organizationId: result.organizationId },
      });
      return null;
    });

    return ok(filled ? { ...result, draftConfig: filled } : result);
  } catch (error) {
    logError('videos.createVideo', error, {
      feature: 'videos',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create video')
    );
  }
};

/**
 * Create a new video project
 * Videos start in 'draft' status and can be queued for rendering
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Video creation input
 * @returns Result with created video or error
 */
export const createVideo = (db: DbConnection, input: CreateVideoInput) =>
  trackedResult(
    'videos.createVideo',
    () => withOrgScope((tx) => createVideoImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

/**
 * Result type for createVideo
 */
export type CreateVideoResult = Awaited<ReturnType<typeof createVideo>>;
