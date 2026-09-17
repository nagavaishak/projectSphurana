import { video } from '@borradh-workspace/database';
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
import { isDraftConfigComplete } from '../queue-video-export/queue-video-export.service.js';
import {
  type ValidateDraftConfigInput,
  validateDraftConfigSchema,
} from './validate-draft-config.schema.js';

export interface ValidateDraftConfigResponse {
  isValid: boolean;
  error: string | null;
}

const validateDraftConfigImpl = async (
  db: DbConnection,
  input: ValidateDraftConfigInput
): Promise<Result<ValidateDraftConfigResponse>> => {
  const parsed = validateDraftConfigSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const [currentVideo] = await db
    .select()
    .from(video)
    .where(and(eq(video.id, parsed.data.id), notDeleted(video)))
    .limit(1);

  if (!currentVideo) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'));
  }

  if (!currentVideo.draftConfig) {
    return ok({ isValid: false, error: 'Video has no draft configuration' });
  }

  const configError = isDraftConfigComplete(
    currentVideo.draftConfig,
    currentVideo.variationId
  );
  return ok({ isValid: configError === null, error: configError });
};

export const validateDraftConfig = (
  db: DbConnection,
  input: ValidateDraftConfigInput
) =>
  trackedResult(
    'videos.validateDraftConfig',
    () => validateDraftConfigImpl(db, input),
    {
      properties: { videoId: input.id },
      internalErrorsOnly: true,
    }
  );

export type ValidateDraftConfigResult = Awaited<
  ReturnType<typeof validateDraftConfig>
>;
