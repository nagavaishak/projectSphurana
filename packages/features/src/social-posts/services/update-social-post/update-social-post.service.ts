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
  type UpdateSocialPostInput,
  updateSocialPostSchema,
} from './update-social-post.schema.js';

/**
 * Internal implementation of update social post
 */
const updateSocialPostImpl = async (
  db: DbConnection,
  input: UpdateSocialPostInput
): Promise<Result<SocialPost>> => {
  // Validate input
  const parsed = updateSocialPostSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updateData } = parsed.data;

  // Check if post exists and belongs to organization
  const existing = await db.query.socialPost.findFirst({
    where: and(
      eq(socialPost.id, id),
      eq(socialPost.organizationId, organizationId)
    ),
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Social post not found'));
  }

  // Cannot update published posts
  if (existing.status === 'published' || existing.status === 'publishing') {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Cannot update a post that is publishing or already published'
      )
    );
  }

  // Build update object (only include defined values)
  const updateValues: Partial<typeof socialPost.$inferInsert> = {};

  if (updateData.title !== undefined) updateValues.title = updateData.title;
  if (updateData.caption !== undefined)
    updateValues.caption = updateData.caption;
  if (updateData.mediaType !== undefined)
    updateValues.mediaType = updateData.mediaType;
  if (updateData.mediaUrl !== undefined)
    updateValues.mediaUrl = updateData.mediaUrl;
  if (updateData.thumbnailUrl !== undefined)
    updateValues.thumbnailUrl = updateData.thumbnailUrl;
  if (updateData.videoId !== undefined)
    updateValues.videoId = updateData.videoId;
  if (updateData.platforms !== undefined)
    updateValues.platforms = updateData.platforms;
  if (updateData.platformSettings !== undefined)
    updateValues.platformSettings = updateData.platformSettings;
  if (updateData.scheduledAt !== undefined)
    updateValues.scheduledAt = updateData.scheduledAt;

  // Auto-update status based on scheduledAt if not explicitly set
  if (updateData.status !== undefined) {
    updateValues.status = updateData.status;
  } else if (updateData.scheduledAt !== undefined) {
    // If scheduledAt is set to a date, mark as scheduled
    // If scheduledAt is cleared (null), mark as draft
    updateValues.status = updateData.scheduledAt ? 'scheduled' : 'draft';
  }

  // Update the post
  const [result] = await db
    .update(socialPost)
    .set(updateValues)
    .where(
      and(eq(socialPost.id, id), eq(socialPost.organizationId, organizationId))
    )
    .returning();

  return ok(result);
};

/**
 * Update an existing social post
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Social post update input
 * @returns Result with updated social post or error
 *
 * @example
 * ```ts
 * const result = await updateSocialPost(db, {
 *   id: 'post_123',
 *   organizationId: 'org_123',
 *   caption: 'Updated caption!',
 *   scheduledAt: new Date('2024-01-20T15:00:00Z'),
 * });
 * ```
 */
export const updateSocialPost = (
  db: DbConnection,
  input: UpdateSocialPostInput
) =>
  trackedResult(
    'socialPosts.updateSocialPost',
    () => withOrgScope((tx) => updateSocialPostImpl(tx, input), { db }),
    {
      properties: { id: input.id },
    }
  );

/**
 * Result type for updateSocialPost
 */
export type UpdateSocialPostResult = Awaited<
  ReturnType<typeof updateSocialPost>
>;
