import { socialPost } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq, gte, isNull, lt, lte } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { publishSocialPost } from '../publish-social-post/publish-social-post.service.js';
import {
  type PublishDuePostsInput,
  publishDuePostsSchema,
} from './publish-due-posts.schema.js';

export interface PublishDuePostsResult {
  considered: number;
  published: number;
  failed: number;
  skippedStale: number;
}

/**
 * Publish every social post whose scheduled time has passed.
 *
 * This is the runner that was missing: `createSocialPost` inserts a row with
 * `status = 'scheduled'`, but nothing ever fired it. This sweep finds due
 * posts and hands each to `publishSocialPost` (which sets `status = 'publishing'`,
 * calls Meta, writes `platformResults`, and flips the row to
 * `published` / `partial` / `failed`).
 *
 * Meant to be called from the scheduler on a short interval, wrapped in
 * `withSystemScope` so the nested `withOrgScope` inside `publishSocialPost`
 * runs cross-org on the system pool.
 *
 * Posts more than `maxOverdueHours` overdue are skipped (and counted) so an
 * accidental ancient backlog never auto-publishes.
 */
const publishDuePostsImpl = async (
  db: DbConnection,
  input: PublishDuePostsInput = {}
): Promise<Result<PublishDuePostsResult>> => {
  const parsed = publishDuePostsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { batchSize, maxOverdueHours } = parsed.data;
  const now = new Date();
  const cutoff = new Date(now.getTime() - maxOverdueHours * 60 * 60 * 1000);

  // Due window: scheduled in the past but not older than the stale cutoff.
  // (Rows with a null scheduledAt are drafts and never match `lte`.)
  //
  // `platformResults IS NULL` is critical: the social-posts controller hands
  // future-scheduled posts to Meta for NATIVE scheduling at create time, which
  // stamps platformResults and leaves status='scheduled'. Those must NOT be
  // re-published here or they'd post twice. A null platformResults means the
  // post was never handed to any publish path — i.e. the orphaned posts
  // (content-batch accepts bypass the controller) this runner exists to fire.
  const due = await db.query.socialPost.findMany({
    where: and(
      eq(socialPost.status, 'scheduled'),
      isNull(socialPost.platformResults),
      lte(socialPost.scheduledAt, now),
      gte(socialPost.scheduledAt, cutoff)
    ),
    orderBy: [asc(socialPost.scheduledAt)],
    limit: batchSize,
  });

  // Count anything past the stale cutoff that we are deliberately NOT
  // publishing, so the skipped backlog is visible rather than silent.
  const staleRows = await db.query.socialPost.findMany({
    columns: { id: true },
    where: and(
      eq(socialPost.status, 'scheduled'),
      isNull(socialPost.platformResults),
      lt(socialPost.scheduledAt, cutoff)
    ),
  });
  const skippedStale = staleRows.length;

  let published = 0;
  let failed = 0;

  // Sequential on purpose: Instagram container processing can take minutes and
  // we'd rather not fan a burst of media uploads at Meta from one tick.
  for (const post of due) {
    const result = await publishSocialPost(db, {
      id: post.id,
      organizationId: post.organizationId,
    });

    // publishSocialPost logs its own failures internally; we only tally here.
    if (result.success && result.data.status !== 'failed') {
      published += 1;
    } else {
      failed += 1;
    }
  }

  return ok({ considered: due.length, published, failed, skippedStale });
};

/**
 * Publish all social posts whose scheduled time has passed.
 */
export const publishDuePosts = (
  db: DbConnection,
  input: PublishDuePostsInput = {}
) =>
  trackedResult(
    'socialPosts.publishDuePosts',
    () => publishDuePostsImpl(db, input),
    {
      properties: { batchSize: input.batchSize ?? 15 },
      // Called once a MINUTE by the scheduler, and on the overwhelming
      // majority of ticks there is nothing due — so a success event here is
      // 1,440/day per deployment reporting "found nothing". The scheduler
      // emits `socialPosts.publishTick` instead, only when the tick actually
      // published, failed, or skipped something. Failures still emit here.
      trackSuccess: false,
    }
  );

export type PublishDuePostsServiceResult = Awaited<
  ReturnType<typeof publishDuePosts>
>;
