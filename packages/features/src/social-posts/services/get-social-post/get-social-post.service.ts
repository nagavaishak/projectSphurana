import { type SocialPost, socialPost } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetSocialPostInput,
  getSocialPostSchema,
} from './get-social-post.schema.js';

/**
 * Internal implementation of get social post
 */
const getSocialPostImpl = async (
  db: DbConnection,
  input: GetSocialPostInput
): Promise<Result<SocialPost>> => {
  // Validate input
  const parsed = getSocialPostSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Fetch social post
  const result = await db.query.socialPost.findFirst({
    where: and(
      eq(socialPost.id, parsed.data.id),
      eq(socialPost.organizationId, parsed.data.organizationId)
    ),
  });

  if (!result) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Social post not found'));
  }

  return ok(result);
};

/**
 * Get a single social post by ID
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Input with post ID and organization ID
 * @returns Result with social post or error
 *
 * @example
 * ```ts
 * const result = await getSocialPost(db, {
 *   id: 'post_123',
 *   organizationId: 'org_123',
 * });
 * ```
 */
export const getSocialPost = (db: DbConnection, input: GetSocialPostInput) =>
  trackedResult(
    'socialPosts.getSocialPost',
    () => withOrgScope((tx) => getSocialPostImpl(tx, input), { db }),
    {
      properties: { id: input.id },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getSocialPost
 */
export type GetSocialPostResult = Awaited<ReturnType<typeof getSocialPost>>;
