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
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SyncSocialPostsInput,
  syncSocialPostsSchema,
} from './sync-social-posts.schema.js';

export interface SyncResult {
  checked: number;
  deleted: number;
  errors: number;
}

/**
 * Check if a post still exists on Meta.
 * Returns true if the post exists, false if deleted/gone.
 */
async function postExistsOnMeta(
  postId: string,
  accessToken: string
): Promise<boolean> {
  try {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/${postId}?fields=id&access_token=${accessToken}`
    );

    if (response.ok) return true;

    // 404 or GraphMethodException (code 100) = post deleted
    if (response.status === 404) return false;

    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: number };
    };
    if (body.error?.code === 100) return false;

    // Other errors — assume post exists (don't delete on ambiguity)
    return true;
  } catch {
    // Network errors — assume post exists
    return true;
  }
}

/**
 * Internal implementation of sync social posts
 */
const syncSocialPostsImpl = async (
  db: DbConnection,
  input: SyncSocialPostsInput
): Promise<Result<SyncResult>> => {
  const parsed = syncSocialPostsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Get Meta credentials
  const integration = await db.query.metaAdsIntegration.findFirst({
    where: eq(metaAdsIntegration.organizationId, organizationId),
  });

  if (!integration?.isActive) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'Meta integration not found or not active'
      )
    );
  }

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

  if (!page?.pageAccessToken) {
    return err(
      new FeatureError(ErrorCodes.FORBIDDEN, 'No Facebook Page connected')
    );
  }

  let accessToken: string;
  try {
    const decrypted = decryptCredentials(page.pageAccessToken as string) as {
      accessToken: string;
    };
    accessToken = decrypted.accessToken;
  } catch (error) {
    logError('socialPosts.syncSocialPosts.decryptCredentials', error, {
      feature: 'social-posts',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to decrypt Meta credentials'
      )
    );
  }

  // Get all published/scheduled posts with platformResults
  const posts = await db.query.socialPost.findMany({
    where: and(
      eq(socialPost.organizationId, organizationId),
      inArray(socialPost.status, ['published', 'scheduled', 'partial'])
    ),
  });

  const postsWithResults = posts.filter((post) => {
    const results = post.platformResults as PlatformPublishResult[] | null;
    return results?.some((r) => r.success && r.postId);
  });

  // Phase 1: Check all posts against Meta API in parallel (no DB connection held)
  const checksPerPost = await Promise.all(
    postsWithResults.map(async (post) => {
      const platformResults = post.platformResults as PlatformPublishResult[];
      const publishedResults = platformResults.filter(
        (r) => r.success && r.postId
      );

      const existenceChecks = await Promise.all(
        publishedResults.map(async (pr) => {
          try {
            const exists = await postExistsOnMeta(pr.postId ?? '', accessToken);
            return { platform: pr.platform, exists, error: false };
          } catch {
            return { platform: pr.platform, exists: true, error: true };
          }
        })
      );

      return { post, platformResults, existenceChecks };
    })
  );

  // Phase 2: Apply DB updates based on results (brief DB usage)
  const result: SyncResult = {
    checked: checksPerPost.length,
    deleted: 0,
    errors: 0,
  };

  for (const { post, platformResults, existenceChecks } of checksPerPost) {
    result.errors += existenceChecks.filter((c) => c.error).length;

    const allDeleted = existenceChecks.every((c) => !c.exists);
    const someDeleted = existenceChecks.some((c) => !c.exists);

    if (allDeleted) {
      await db
        .delete(socialPost)
        .where(
          and(
            eq(socialPost.id, post.id),
            eq(socialPost.organizationId, organizationId)
          )
        );
      result.deleted++;
    } else if (someDeleted) {
      const updatedResults = platformResults.map((r) => {
        const check = existenceChecks.find((c) => c.platform === r.platform);
        if (check && !check.exists) {
          return { ...r, deletedOnMeta: true };
        }
        return r;
      });

      await db
        .update(socialPost)
        .set({
          platformResults: updatedResults,
          status: 'partial',
        })
        .where(eq(socialPost.id, post.id));
    }
  }

  return ok(result);
};

/**
 * Sync social posts with Meta to detect posts deleted on the platform side.
 *
 * @param db - Database connection
 * @param input - Input with organization ID
 * @returns Result with sync statistics
 */
export const syncSocialPosts = (
  db: DbConnection,
  input: SyncSocialPostsInput
) =>
  trackedResult(
    'socialPosts.syncSocialPosts',
    () => withOrgScope((tx) => syncSocialPostsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for syncSocialPosts
 */
export type SyncSocialPostsResult = Awaited<ReturnType<typeof syncSocialPosts>>;
