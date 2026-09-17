import type { Video } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { type CreateVideoInput, createVideo } from '../create-video/index.js';
import { synthesizeVideoInput } from '../synthesize-video-input/index.js';
import {
  type CreateVideoFromRequestInput,
  createVideoFromRequestSchema,
} from './create-video-from-request.schema.js';

const logger = createLogger('CreateVideoFromRequest');
/** Re-wrap a tracked (structural) error into a `FeatureError` for propagation. */
const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);

/**
 * Keys whose presence marks a `draftConfig` as "complete" — i.e. the legacy
 * wizard already assembled the whole thing and no synthesis should run.
 *
 * This is a sniff, not a version tag, and it is load-bearing: on this branch
 * the caller's values survive VERBATIM (including `orientation: 'landscape'`,
 * which the synthesiser would otherwise rewrite to portrait).
 */
const COMPLETE_DRAFT_CONFIG_KEYS = [
  'bRollClips',
  'captions',
  'outro',
  'orientation',
] as const;

const isCompleteDraftConfig = (draftConfig: unknown): boolean =>
  Boolean(draftConfig) &&
  typeof draftConfig === 'object' &&
  COMPLETE_DRAFT_CONFIG_KEYS.every(
    (key) => key in (draftConfig as Record<string, unknown>)
  );

const createVideoFromRequestImpl = async (
  db: DbConnection,
  input: CreateVideoFromRequestInput
): Promise<Result<Video>> => {
  const parsed = createVideoFromRequestSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, createdById, ...payload } = parsed.data;

  let finalInput: CreateVideoInput;

  if (isCompleteDraftConfig(payload.draftConfig)) {
    if (!payload.title) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'title is required when draftConfig is fully provided'
        )
      );
    }
    finalInput = {
      ...payload,
      title: payload.title,
      draftConfig: payload.draftConfig as CreateVideoInput['draftConfig'],
      organizationId,
      createdById,
    };
  } else {
    const synthesized = await synthesizeVideoInput(db, {
      ...payload,
      organizationId,
      createdById,
    });
    if (!synthesized.success) return err(rewrap(synthesized.error));
    finalInput = synthesized.data;
  }

  const result = await createVideo(db, finalInput);
  // Which branch ran, and what the caller must do next.
  //
  // `createVideo` does NOT enqueue a render — the video is created in 'draft'
  // and only starts rendering when POST /videos/:id/export runs. A stalled
  // "Processing your video…" therefore has two very different causes that look
  // identical from outside: the export call never happened, or it was
  // rejected. Neither was visible in the logs; tracing a stalled video's id
  // previously returned nothing at all.
  //
  // Logged at info because it is one line per create, and it is the anchor for
  // finding the video's id in the logs at all.
  if (result.success) {
    logger.info(
      `Created video ${result.data.id} via ${
        isCompleteDraftConfig(payload.draftConfig)
          ? 'complete-draftConfig'
          : 'synthesis'
      } branch, status=${result.data.status} — awaiting POST /videos/${result.data.id}/export to queue the render`
    );
  }
  if (!result.success) {
    const details = result.error.details
      ? ` ${JSON.stringify(result.error.details)}`
      : '';
    logger.warn(
      `Create video failed: ${result.error.code} - ${result.error.message}${details}`
    );
    return err(rewrap(result.error));
  }

  return ok(result.data);
};

/**
 * The `POST /videos` use case: decide between synthesis and legacy
 * passthrough, then persist. The controller does nothing but hand over the
 * request and map the error.
 */
export const createVideoFromRequest = (
  db: DbConnection,
  input: CreateVideoFromRequestInput
) =>
  trackedResult(
    'videos.createVideoFromRequest',
    () => createVideoFromRequestImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        templateId: input.templateId,
        format: input.format,
      },
    }
  );

export type CreateVideoFromRequestResult = Awaited<
  ReturnType<typeof createVideoFromRequest>
>;
