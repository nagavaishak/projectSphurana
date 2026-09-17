import { user, video, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, count, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListVideosInput,
  listVideosSchema,
} from './list-videos.schema.js';

/**
 * Internal implementation of list videos
 */
const listVideosImpl = async (db: DbConnection, input: ListVideosInput) => {
  // Validate input
  const parsed = listVideosSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { limit, offset } = parsed.data;

  const items = await db
    .select({
      id: video.id,
      title: video.title,
      status: video.status,
      progress: video.progress,
      draftConfig: video.draftConfig,
      blobUrl: video.blobUrl,
      thumbnailUrl: video.thumbnailUrl,
      durationMs: video.durationMs,
      templateId: video.templateId,
      organizationId: video.organizationId,
      createdById: video.createdById,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
      exportedAt: video.exportedAt,
      creator: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(video)
    .leftJoin(user, eq(video.createdById, user.id))
    .where(
      and(
        eq(video.organizationId, parsed.data.organizationId),
        notDeleted(video)
      )
    )
    .orderBy(desc(video.createdAt))
    .limit(limit)
    .offset(offset);

  // `total` used to be `items.length` — the PAGE size under a field named
  // total, so it could never exceed `limit` and a paginating client could
  // neither learn the row count nor render page controls. Count over the SAME
  // predicate, without the join (the leftJoin cannot change cardinality here
  // — `createdById` is a single FK — so counting the base table is equivalent
  // and cheaper).
  const [totalRow] = await db
    .select({ value: count() })
    .from(video)
    .where(
      and(
        eq(video.organizationId, parsed.data.organizationId),
        notDeleted(video)
      )
    );

  return ok({ items, total: totalRow?.value ?? 0, limit, offset });
};

/**
 * List videos for an organization
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - List videos input with pagination
 * @returns Result with array of videos or error
 */
export const listVideos = (db: DbConnection, input: ListVideosInput) =>
  trackedResult(
    'videos.listVideos',
    () => withOrgScope((tx) => listVideosImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

/**
 * Result type for listVideos
 */
export type ListVideosResult = Awaited<ReturnType<typeof listVideos>>;
