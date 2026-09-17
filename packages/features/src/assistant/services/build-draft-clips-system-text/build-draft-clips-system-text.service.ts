import { video, videoDraftClip } from '@borradh-workspace/database';
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
import { listDraftClips } from '../../../videos/services/list-draft-clips/index.js';
import {
  type BuildDraftClipsSystemTextInput,
  type BuildDraftClipsSystemTextOutput,
  buildDraftClipsSystemTextSchema,
} from './build-draft-clips-system-text.schema.js';

/**
 * Polling-on-send draft-clips system block (W-C10-clip-tray Step 7).
 *
 * The chat composer maintains a persistent clip tray scoped to the active
 * video draft. Asset ingest (probe + transcode + analysis) is async, so a
 * clip dropped mid-conversation may flip from `processing` → `ready` between
 * operator sends. Rather than open an SSE side-channel, the controller
 * fetches the latest tray state once per send and folds it into the system
 * prompt (Block 4, alongside `knowledgeContext` + `activeContextText` —
 * Block 4 is uncached, so this doesn't break the persona/skill cache hits).
 *
 * Implementation:
 *   1. Find the most recent `draft`-status video for the org that has at
 *      least one tray row. Operators rarely build two videos at once, so
 *      LIMIT 1 + the most-recently-updated one is the right heuristic.
 *   2. Read the tray with the existing `listDraftClips` service (joins to
 *      the asset library so we can render names + statuses).
 *   3. Render a one-line summary the model can react to.
 *
 * Returns `text: null` when there's no active draft (the common case in
 * non-video conversations) so the controller appends nothing extra.
 */
const buildDraftClipsSystemTextImpl = async (
  db: DbConnection,
  input: BuildDraftClipsSystemTextInput
): Promise<Result<BuildDraftClipsSystemTextOutput>> => {
  const parsed = buildDraftClipsSystemTextSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Find the most recent draft video that has tray rows. We don't filter on
  // userId — videos are org-scoped, and "the active draft for this org"
  // matches operator UX (they almost never juggle two drafts at once).
  const recent = await db
    .select({ id: video.id })
    .from(video)
    .innerJoin(videoDraftClip, eq(video.id, videoDraftClip.videoId))
    .where(and(eq(video.organizationId, organizationId), notDeleted(video)))
    .orderBy(desc(video.updatedAt))
    .limit(1);

  const videoId = recent[0]?.id;
  if (!videoId) return ok({ text: null });

  const result = await listDraftClips(db, { videoId, organizationId });
  if (!result.success) return ok({ text: null });
  const { clips } = result.data;
  if (clips.length === 0) return ok({ text: null });

  const summary = clips
    .map((c) => {
      const name = c.asset?.name ?? '(uploading)';
      // Truncate long filenames so the summary stays readable.
      const trimmedName = name.length > 32 ? `${name.slice(0, 29)}…` : name;
      return `${trimmedName} [${c.source}, ${c.processingStatus}]`;
    })
    .join('; ');

  const text = `[Active video draft ${videoId}: ${clips.length} clip${clips.length === 1 ? '' : 's'} — ${summary}]`;
  return ok({ text });
};

export const buildDraftClipsSystemText = (
  db: DbConnection,
  input: BuildDraftClipsSystemTextInput
) =>
  trackedResult(
    'assistant.buildDraftClipsSystemText',
    () => buildDraftClipsSystemTextImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type BuildDraftClipsSystemTextResult = Awaited<
  ReturnType<typeof buildDraftClipsSystemText>
>;
