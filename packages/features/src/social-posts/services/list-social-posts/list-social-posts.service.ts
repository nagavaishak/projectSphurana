import { type SocialPost, socialPost } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type SQL,
  and,
  arrayContains,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
} from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListSocialPostsInput,
  listSocialPostsSchema,
} from './list-social-posts.schema.js';

/**
 * Internal implementation of list social posts
 */
const listSocialPostsImpl = async (
  db: DbConnection,
  input: ListSocialPostsInput
): Promise<
  Result<{ items: SocialPost[]; total: number; limit: number; offset: number }>
> => {
  // Validate input
  const parsed = listSocialPostsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Build where conditions
  const conditions: SQL[] = [
    eq(socialPost.organizationId, parsed.data.organizationId),
  ];

  if (parsed.data.status) {
    conditions.push(eq(socialPost.status, parsed.data.status));
  }

  if (parsed.data.mediaType) {
    conditions.push(eq(socialPost.mediaType, parsed.data.mediaType));
  }

  // Filter by platform (check if platform is in the platforms array)
  if (parsed.data.platform) {
    conditions.push(
      arrayContains(socialPost.platforms, [parsed.data.platform])
    );
  }

  // Date range filter (for calendar views)
  if (parsed.data.startDate) {
    conditions.push(gte(socialPost.scheduledAt, parsed.data.startDate));
  }
  if (parsed.data.endDate) {
    conditions.push(lte(socialPost.scheduledAt, parsed.data.endDate));
  }

  // Search by title
  if (parsed.data.search) {
    const searchTerm = `%${parsed.data.search}%`;
    conditions.push(ilike(socialPost.title, searchTerm));
  }

  const { limit, offset } = parsed.data;

  // Fetch social posts
  const items = await db.query.socialPost.findMany({
    where: and(...conditions),
    orderBy: desc(socialPost.scheduledAt),
    limit,
    offset,
  });

  // `total` was `items.length` — the PAGE size, after LIMIT, under a field
  // named total. The same defect as videos/assets/campaigns/segments; this
  // service was missed in that pass because its `total` still satisfied the
  // contract's bare `z.number()`, so no gate could see it. `conditions` is
  // reused verbatim so the count cannot drift from the page's filters.
  const [totalRow] = await db
    .select({ value: count() })
    .from(socialPost)
    .where(and(...conditions));

  return ok({ items, total: totalRow?.value ?? 0, limit, offset });
};

/**
 * List social posts for an organization
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Social post list input with filters
 * @returns Result with social posts array or error
 *
 * @example
 * ```ts
 * const result = await listSocialPosts(db, {
 *   organizationId: 'org_123',
 *   status: 'scheduled',
 *   startDate: new Date('2024-01-01'),
 *   endDate: new Date('2024-01-31'),
 * });
 * ```
 */
export const listSocialPosts = (
  db: DbConnection,
  input: ListSocialPostsInput
) =>
  trackedResult(
    'socialPosts.listSocialPosts',
    () => withOrgScope((tx) => listSocialPostsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for listSocialPosts
 */
export type ListSocialPostsResult = Awaited<ReturnType<typeof listSocialPosts>>;
