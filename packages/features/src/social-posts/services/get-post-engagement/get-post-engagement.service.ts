import {
  type PlatformPublishResult,
  instagramIntegration,
  metaAdsIntegration,
  metaAdsPage,
  socialPost,
} from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { fetchWithRetry } from '@borradh-workspace/http';
import { decryptCredentials } from '@borradh-workspace/integrations';
import type { InstagramCredentials } from '@borradh-workspace/integrations';
import {
  GRAPH_API_BASE as FACEBOOK_GRAPH_API_BASE,
  INSTAGRAM_GRAPH_API_BASE,
} from '@borradh-workspace/integrations/shared';
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
  type GetPostEngagementInput,
  getPostEngagementSchema,
} from './get-post-engagement.schema.js';

export interface PostEngagement {
  likes: number;
  comments: number;
  shares: number;
  platform: 'facebook' | 'instagram';
  postId: string;
}

interface MetaCredentials {
  accessToken: string;
}

/**
 * Get Instagram access token from the standalone Instagram Business Login integration
 */
async function getInstagramAccessToken(
  db: DbConnection,
  organizationId: string
): Promise<string | null> {
  const integration = await db.query.instagramIntegration.findFirst({
    where: and(
      eq(instagramIntegration.organizationId, organizationId),
      eq(instagramIntegration.isActive, true)
    ),
  });

  if (!integration?.encryptedCredentials) return null;

  try {
    const creds = decryptCredentials<InstagramCredentials>(
      integration.encryptedCredentials
    );
    return creds.accessToken;
  } catch {
    return null;
  }
}

/**
 * Get Facebook Page access token from Meta Ads integration
 */
async function getPageAccessToken(
  db: DbConnection,
  organizationId: string
): Promise<string | null> {
  const integration = await db.query.metaAdsIntegration.findFirst({
    where: eq(metaAdsIntegration.organizationId, organizationId),
  });

  if (!integration?.isActive) return null;

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

  if (!page?.pageAccessToken) return null;

  try {
    const decrypted = decryptCredentials(
      page.pageAccessToken as string
    ) as MetaCredentials;
    return decrypted.accessToken;
  } catch {
    return null;
  }
}

const getPostEngagementImpl = async (
  db: DbConnection,
  input: GetPostEngagementInput
): Promise<Result<PostEngagement>> => {
  const parsed = getPostEngagementSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    socialPostId,
    organizationId,
    platform: requestedPlatform,
  } = parsed.data;

  // Fetch the social post
  const post = await db.query.socialPost.findFirst({
    where: and(
      eq(socialPost.id, socialPostId),
      eq(socialPost.organizationId, organizationId)
    ),
  });

  if (!post) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Social post not found'));
  }

  // Find a successful platform result with a postId
  const platformResults =
    (post.platformResults as PlatformPublishResult[]) || [];
  const targetResult = platformResults.find(
    (r) =>
      r.success &&
      r.postId &&
      (!requestedPlatform || r.platform === requestedPlatform)
  );

  if (!targetResult || !targetResult.postId) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No published platform result found for this post'
      )
    );
  }

  // Fetch engagement from the appropriate API
  try {
    const postId = targetResult.postId;

    if (targetResult.platform === 'instagram') {
      // Prefer standalone Instagram token (graph.instagram.com), fall back to
      // the Facebook Page token. Page tokens (incl. FLfB system-user page
      // tokens) are only valid against graph.facebook.com — the host MUST
      // follow the token source.
      const instagramToken = await getInstagramAccessToken(db, organizationId);
      const pageToken = instagramToken
        ? null
        : await getPageAccessToken(db, organizationId);
      const accessToken = instagramToken || pageToken;

      if (!accessToken) {
        return err(
          new FeatureError(
            ErrorCodes.FORBIDDEN,
            'Instagram integration not found or not active'
          )
        );
      }

      const igApiBase = instagramToken
        ? INSTAGRAM_GRAPH_API_BASE
        : FACEBOOK_GRAPH_API_BASE;
      const url = `${igApiBase}/${postId}?fields=like_count,comments_count&access_token=${accessToken}`;
      const response = await fetchWithRetry(url);

      if (!response.ok) {
        const errorBody = await response.text();
        logError(
          'socialPosts.getPostEngagement.instagram',
          new Error(errorBody),
          {
            feature: 'social-posts',
            extra: { postId, statusCode: response.status },
          }
        );
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to fetch Instagram engagement'
          )
        );
      }

      const data = (await response.json()) as {
        like_count?: number;
        comments_count?: number;
      };

      return ok({
        likes: data.like_count ?? 0,
        comments: data.comments_count ?? 0,
        shares: 0, // Instagram API doesn't provide share count for feed posts
        platform: 'instagram',
        postId,
      });
    }

    // Facebook post engagement — uses page access token
    const pageAccessToken = await getPageAccessToken(db, organizationId);

    if (!pageAccessToken) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'Facebook Page integration not found or not active'
        )
      );
    }

    // Try with shares first (works for regular posts), fall back without shares (for videos)
    const fields = 'likes.summary(true),comments.summary(true),shares';
    const url = `${FACEBOOK_GRAPH_API_BASE}/${postId}?fields=${fields}&access_token=${pageAccessToken}`;
    let response = await fetchWithRetry(url);

    let isVideoFallback = false;
    if (!response.ok) {
      const errorBody = await response.text();
      // Video nodes don't support the shares field — retry without it
      if (errorBody.includes('nonexisting field (shares)')) {
        const videoFields = 'likes.summary(true),comments.summary(true)';
        const videoUrl = `${FACEBOOK_GRAPH_API_BASE}/${postId}?fields=${videoFields}&access_token=${pageAccessToken}`;
        response = await fetchWithRetry(videoUrl);
        isVideoFallback = true;
      }

      if (!response.ok) {
        const retryBody = isVideoFallback ? await response.text() : errorBody;
        logError(
          'socialPosts.getPostEngagement.facebook',
          new Error(retryBody),
          {
            feature: 'social-posts',
            extra: { postId, statusCode: response.status },
          }
        );
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to fetch Facebook engagement'
          )
        );
      }
    }

    const data = (await response.json()) as {
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    };

    return ok({
      likes: data.likes?.summary?.total_count ?? 0,
      comments: data.comments?.summary?.total_count ?? 0,
      shares: data.shares?.count ?? 0,
      platform: 'facebook',
      postId,
    });
  } catch (error) {
    logError('socialPosts.getPostEngagement', error, {
      feature: 'social-posts',
      extra: { socialPostId, platform: targetResult.platform },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to fetch post engagement'
      )
    );
  }
};

export const getPostEngagement = (
  db: DbConnection,
  input: GetPostEngagementInput
) =>
  trackedResult(
    'socialPosts.getPostEngagement',
    () => withOrgScope((tx) => getPostEngagementImpl(tx, input), { db }),
    {
      properties: { socialPostId: input.socialPostId },
      internalErrorsOnly: true,
    }
  );

export type GetPostEngagementResult = Awaited<
  ReturnType<typeof getPostEngagement>
>;
