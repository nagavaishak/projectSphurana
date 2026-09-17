import type { VideoDraftClip } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { addDraftClip } from '../add-draft-clip/index.js';
import {
  type AddDraftClipsInput,
  addDraftClipsSchema,
} from './add-draft-clips.schema.js';

/** Re-wrap a tracked (structural) error into a `FeatureError` for propagation. */
const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);

/** Batch response vs single response — see the schema docblock. */
export type AddDraftClipsOutput = { clips: VideoDraftClip[] } | VideoDraftClip;

const addDraftClipsImpl = async (
  db: DbConnection,
  input: AddDraftClipsInput
): Promise<Result<AddDraftClipsOutput>> => {
  const parsed = addDraftClipsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { videoId, organizationId, clips } = parsed.data;

  // Discriminate on body shape: batch (`{ clips: [...] }`) vs single
  // (`{ assetId, source, ... }`). Lets `videos_autoSelectClips` persist
  // N suggestions in one round-trip while the frontend single-drop
  // handler stays a 1:1 POST.
  if (Array.isArray(clips)) {
    const inserted: VideoDraftClip[] = [];
    for (const entry of clips) {
      const r = await addDraftClip(db, {
        videoId,
        organizationId,
        assetId: entry.assetId,
        source: entry.source,
        beatOrder: entry.beatOrder,
        // Schema applies the same `'processing'` default when omitted, but
        // the call-site fallback keeps TS narrowing happy without forcing
        // every batch caller to fill it in.
        processingStatus: entry.processingStatus ?? 'processing',
      });
      if (!r.success) return err(rewrap(r.error));
      inserted.push(r.data);
    }
    return ok({ clips: inserted });
  }

  const result = await addDraftClip(db, {
    videoId,
    organizationId,
    assetId: parsed.data.assetId as string,
    source: parsed.data.source as NonNullable<AddDraftClipsInput['source']>,
    beatOrder: parsed.data.beatOrder,
    processingStatus: parsed.data.processingStatus ?? 'processing',
  });
  if (!result.success) return err(rewrap(result.error));
  return ok(result.data);
};

export const addDraftClips = (db: DbConnection, input: AddDraftClipsInput) =>
  trackedResult('videos.addDraftClips', () => addDraftClipsImpl(db, input), {
    properties: {
      videoId: input.videoId,
      organizationId: input.organizationId,
      batch: Array.isArray(input.clips),
    },
  });

export type AddDraftClipsResult = Awaited<ReturnType<typeof addDraftClips>>;
