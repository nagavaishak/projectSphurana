import {
  type PlatformPublishResult,
  metaAdsIntegration,
  metaAdsPage,
  socialPost,
} from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { fetchWithRetry } from '@borradh-workspace/http';
import { decryptCredentials } from '@borradh-workspace/integrations';
import { GRAPH_API_BASE } from '@borradh-workspace/integrations/shared';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type DeleteSocialPostInput,
  deleteSocialPostSchema,
} from './delete-social-post.schema.js';

/**
 * Best-effort delete a post from Meta (Facebook/Instagram).
 * Logs errors but never throws — local deletion always proceeds.
 */
async function deleteFromMeta(
  postId: string,
  platform: string,
  pageAccessToken: string
): Promise<void> {
  try {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/${postId}?access_token=${pageAccessToken}`,
      { method: 'DELETE' }
    );

    // 404 means already gone — treat as success
    if (!response.ok && response.status !== 404) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string; code?: number };
      };
      // GraphMethodException code 100 with "does not exist" is also fine
      if (body.error?.code === 100) return;
      throw new Error(
        `Meta API ${response.status}: ${body.error?.message || 'Unknown error'}`
      );
    }
  } catch (error) {
    logError('socialPosts.deleteFromMeta', error, {
      feature: 'social-posts',
      extra: { postId, platform },
    });
  }
}

/**
 * Internal implementation of delete social post
 */
const deleteSocialPostImpl = async (
  db: DbConnection,
  input: DeleteSocialPostInput
): Promise<Result<{ success: true }>> => {
  // Validate input
  const parsed = deleteSocialPostSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

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

  // Cannot delete posts that are currently publishing
  if (existing.status === 'publishing') {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Cannot delete a post that is currently publishing'
      )
    );
  }

  // Best-effort: delete from Meta if post was published with postIds
  const platformResults = existing.platformResults as
    | PlatformPublishResult[]
    | null;
  const publishedResults = (platformResults || []).filter(
    (r) => r.success && r.postId
  );

  if (publishedResults.length > 0) {
    // Get Meta credentials for the organization
    const integration = await db.query.metaAdsIntegration.findFirst({
      where: eq(metaAdsIntegration.organizationId, organizationId),
    });

    if (integration?.isActive) {
      let page = await db.query.metaAdsPage.findFirst({
        where: and(
          eq(metaAdsPage.metaAdsIntegrationId, integration.id),
          eq(metaAdsPage.id, integration.defaultPageId || '')
        ),
      });

      if (!page) {
        page = await db.query.metaAdsPage.findFirst({
          where: and(
            eq(metaAdsPage.metaAdsIntegrationId, integration.id),
            eq(metaAdsPage.isActive, true)
          ),
        });
      }

      if (page?.pageAccessToken) {
        try {
          const decrypted = decryptCredentials(
            page.pageAccessToken as string
          ) as { accessToken: string };

          await Promise.all(
            publishedResults.map((r) =>
              deleteFromMeta(r.postId ?? '', r.platform, decrypted.accessToken)
            )
          );
        } catch (error) {
          logError('socialPosts.deleteSocialPost.decryptCredentials', error, {
            feature: 'social-posts',
            extra: { postId: id },
          });
        }
      }
    }
  }

  // Delete the post locally
  await db
    .delete(socialPost)
    .where(
      and(eq(socialPost.id, id), eq(socialPost.organizationId, organizationId))
    );

  return ok({ success: true });
};

/**
 * Delete a social post
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Input with post ID and organization ID
 * @returns Result with success or error
 *
 * @example
 * ```ts
 * const result = await deleteSocialPost(db, {
 *   id: 'post_123',
 *   organizationId: 'org_123',
 * });
 * ```
 */
export const deleteSocialPost = (
  db: DbConnection,
  input: DeleteSocialPostInput
) =>
  trackedResult(
    'socialPosts.deleteSocialPost',
    () => withOrgScope((tx) => deleteSocialPostImpl(tx, input), { db }),
    {
      properties: { id: input.id },
    }
  );

/**
 * Result type for deleteSocialPost
 */
export type DeleteSocialPostResult = Awaited<
  ReturnType<typeof deleteSocialPost>
>;
