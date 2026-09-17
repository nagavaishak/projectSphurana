import {
  getAIClient,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import type { VideoDraftConfig } from '@borradh-workspace/database';
import { video } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  downloadAsBuffer,
  getOrgAssetsBucket,
  parseS3Url,
} from '@borradh-workspace/storage';
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
  type TranscribeVideoInput,
  transcribeVideoSchema,
} from './transcribe-video.schema.js';

/**
 * Extract S3 bucket + key from a talkingHeadUrl which may be:
 * - A full S3 URL: https://bucket.s3.region.amazonaws.com/key
 * - A raw S3 key: orgId/videos/userId/timestamp.mp4
 */
function resolveS3Location(talkingHeadUrl: string): {
  bucket: string;
  key: string;
} {
  if (talkingHeadUrl.startsWith('http')) {
    const s3Info = parseS3Url(talkingHeadUrl);
    if (s3Info) {
      return s3Info;
    }
    // Not an S3 URL — extract key from path as fallback
    const urlPath = new URL(talkingHeadUrl).pathname.slice(1);
    return { bucket: getOrgAssetsBucket(), key: urlPath };
  }
  // Raw S3 key
  return { bucket: getOrgAssetsBucket(), key: talkingHeadUrl };
}

const transcribeVideoImpl = async (
  db: DbConnection,
  input: TranscribeVideoInput
): Promise<Result<{ text: string }>> => {
  const parsed = transcribeVideoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  // Fetch video and verify ownership
  const [record] = await db
    .select({
      id: video.id,
      organizationId: video.organizationId,
      draftConfig: video.draftConfig,
    })
    .from(video)
    // SCOPED BY ORG. The predicate used to be id + notDeleted only, with the
    // ownership test done afterwards and answered with FORBIDDEN. That pair was
    // an org-enumeration oracle: 404 meant "no such video anywhere", 403 meant
    // "exists, owned by someone else" — so a caller could confirm the existence
    // of another org's video id without any access to it.
    //
    // Filtering in the query collapses both cases to one indistinguishable
    // NOT_FOUND. There is no legitimate caller that needs to tell them apart:
    // FORBIDDEN here never meant "ask for access", it meant "wrong org".
    .where(
      and(
        eq(video.id, id),
        eq(video.organizationId, organizationId),
        notDeleted(video)
      )
    )
    .limit(1);

  if (!record) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'));
  }

  const draftConfig = record.draftConfig as VideoDraftConfig | null;

  // Return cached transcript if available
  if (draftConfig?.transcriptText) {
    return ok({ text: draftConfig.transcriptText });
  }

  // Require talking head URL for transcription
  const talkingHeadUrl = draftConfig?.talkingHeadUrl;
  if (!talkingHeadUrl) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No talking head video uploaded yet'
      )
    );
  }

  // Ensure AI client is initialized
  if (!isAIClientInitialized()) {
    const { apiEnv } = await import('@borradh-workspace/env/api');
    const apiKey = apiEnv.OPENAI_API_KEY;
    if (!apiKey) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'OpenAI API key not configured'
        )
      );
    }
    initAIClient({ apiKey });
  }

  try {
    // Download via S3 SDK (handles private buckets with proper auth)
    const { bucket, key } = resolveS3Location(talkingHeadUrl);
    const buffer = await downloadAsBuffer({ bucket, key });

    // OpenAI Whisper API has a 25MB file size limit
    const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
    if (buffer.byteLength > WHISPER_MAX_BYTES) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Video file is too large for transcription (${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB). Maximum is 25MB. Please upload a shorter or lower-resolution video.`
        )
      );
    }

    const file = new File([buffer], 'talking-head.mp4', {
      type: 'video/mp4',
    });

    // Call OpenAI Whisper API
    const client = getAIClient();
    const transcription = await client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'text',
    });

    const transcriptText =
      typeof transcription === 'string'
        ? transcription
        : (transcription as unknown as { text: string }).text;

    // Cache the transcript in draftConfig
    await db
      .update(video)
      .set({
        draftConfig: {
          ...draftConfig,
          transcriptText,
        },
      })
      .where(and(eq(video.id, id), notDeleted(video)));

    return ok({ text: transcriptText });
  } catch (error) {
    logError('videos.transcribeVideo', error, {
      feature: 'videos',
      extra: { videoId: id, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to transcribe video')
    );
  }
};

export const transcribeVideo = (
  db: DbConnection,
  input: TranscribeVideoInput
) =>
  trackedResult(
    'videos.transcribeVideo',
    () => transcribeVideoImpl(db, input),
    {
      properties: { videoId: input.id, organizationId: input.organizationId },
    }
  );

export type TranscribeVideoResult = Awaited<ReturnType<typeof transcribeVideo>>;
