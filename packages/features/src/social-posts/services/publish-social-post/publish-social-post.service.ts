import {
  type PlatformPublishResult,
  type PlatformSettings,
  type SocialPost,
  graphic,
  instagramIntegration,
  metaAdsIntegration,
  metaAdsPage,
  socialPost,
} from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { fetchWithTimeout } from '@borradh-workspace/http';
import {
  decryptCredentials,
  parseMetaErrorResponse,
} from '@borradh-workspace/integrations';
import type { InstagramCredentials } from '@borradh-workspace/integrations';
import {
  GRAPH_API_BASE,
  INSTAGRAM_MESSAGING_API_BASE,
} from '@borradh-workspace/integrations/shared';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  extractKeyFromCdnUrl,
  getCdnUrl,
  getPresignedDownloadUrl,
  getSignedCdnUrl,
  isCdnEnabled,
  parseS3Url,
} from '@borradh-workspace/storage';
import { and, eq } from 'drizzle-orm';
import { collectGraphicSlideUrls } from '../../../graphics/utils/carousel-slides.js';
import { handleMetaAuthError } from '../../../integrations/services/mark-needs-reconnect/mark-needs-reconnect.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  isInstagramFlfbRoutingEnabled,
  ok,
} from '../../../shared/index.js';
import {
  type PublishSocialPostInput,
  publishSocialPostSchema,
} from './publish-social-post.schema.js';

/** Instagram Login API tokens require the instagram graph endpoint */

/** Timeout for individual Meta API calls (15 seconds) */
const META_API_TIMEOUT_MS = 15_000;

/**
 * Every Graph call in this file goes through the shared HTTP seam
 * (`@borradh-workspace/http`) rather than bare `fetch`.
 *
 * This used to be a local re-implementation of the timeout wrapper. That put
 * the publish paths OUTSIDE the one chokepoint the rest of the codebase routes
 * through, which meant the E2E contract fake (META_E2E_STUB) could not
 * intercept them — a Facebook/Instagram publish would have escaped to real Meta
 * even on a stubbed preview. The timeout is bound explicitly here so a future
 * change to the package default can't silently alter publish behaviour.
 */
function metaFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, { ...options, timeoutMs: META_API_TIMEOUT_MS });
}

/**
 * Generate a publicly-accessible download URL that external services
 * (Meta, Instagram) can use to fetch the media.
 *
 * Handles three URL formats:
 * 1. CDN URL (https://cdn.domain.com/key) → (re)sign with CloudFront
 * 2. S3 URL (https://bucket.s3.region.amazonaws.com/key) → sign with CloudFront if CDN enabled, else S3 presign
 * 3. Unknown URL (not CDN/S3) → return as-is
 *
 * IMPORTANT: a stored media URL may ALREADY carry a (possibly EXPIRED) signed
 * query string — graphic outputs are persisted as short-lived signed CloudFront
 * URLs. We must re-sign those, not pass them through, or Meta fails to fetch the
 * media at publish time (FB code 324, IG code 9004). `extractKeyFromCdnUrl` /
 * `parseS3Url` read `URL.pathname`, so any existing query is ignored when we
 * re-derive the key.
 */
async function generateExternalMediaUrl(url: string): Promise<string> {
  // CDN URL — always re-sign with a fresh signature (the stored one may be
  // expired); strip any existing query by re-deriving the key from the path.
  const cdnBase = getCdnUrl();
  if (cdnBase && url.startsWith(cdnBase)) {
    const key = extractKeyFromCdnUrl(url);
    if (key) {
      return getSignedCdnUrl(key, 3600);
    }
  }

  // Check if this is an S3 URL
  const s3Info = parseS3Url(url);
  if (s3Info) {
    // Prefer CloudFront signed URL in production (S3 direct access is
    // blocked by OAC bucket policy)
    if (isCdnEnabled()) {
      return getSignedCdnUrl(s3Info.key, 3600);
    }

    // Local dev fallback: S3 presigned URL
    return getPresignedDownloadUrl({
      bucket: s3Info.bucket,
      key: s3Info.key,
      expiresIn: 3600,
    });
  }

  // Unknown URL format — return as-is
  return url;
}

/**
 * Resolve the ordered list of source media URLs to publish for a post.
 *
 * Precedence:
 * 1. `post.mediaUrls` (2+ entries) — the explicit carousel list recorded when
 *    the post was created from a multi-slide graphic.
 * 2. A carousel `graphic` linked via `post.graphicId` — fallback for posts
 *    created before `media_urls` existed (or by paths that don't set it), so
 *    already-scheduled carousels still publish all slides.
 * 3. `[post.mediaUrl]` — a normal single-image/video post.
 *
 * URLs returned here are the stored (possibly expired) signed URLs; the caller
 * re-signs each via `generateExternalMediaUrl` before handing them to Meta.
 */
async function resolveOrderedMediaUrls(
  db: DbConnection,
  post: SocialPost
): Promise<string[]> {
  if (Array.isArray(post.mediaUrls) && post.mediaUrls.length > 1) {
    return post.mediaUrls;
  }

  // Carousels are images only; never expand a video post.
  if (post.mediaType === 'image' && post.graphicId) {
    const linked = await db.query.graphic.findFirst({
      where: eq(graphic.id, post.graphicId),
    });
    if (linked?.kind === 'carousel' && Array.isArray(linked.outputs)) {
      const slides = collectGraphicSlideUrls(linked.outputs);
      if (slides.length > 1) return slides;
    }
  }

  return [post.mediaUrl];
}

interface FacebookPostResponse {
  id: string;
  post_id?: string;
}

interface InstagramContainerResponse {
  id: string;
}

interface InstagramPublishResponse {
  id: string;
}

interface MetaCredentials {
  accessToken: string;
}

/**
 * Get Instagram credentials from the standalone Instagram integration
 * Returns null if no active integration exists
 */
async function getStandaloneInstagramCredentials(
  db: DbConnection,
  organizationId: string
): Promise<{ igUserId: string; accessToken: string } | null> {
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
    return { igUserId: creds.instagramUserId, accessToken: creds.accessToken };
  } catch {
    return null;
  }
}

/**
 * Publish or schedule an image to Facebook Page
 */
async function publishToFacebookImage(
  pageId: string,
  pageAccessToken: string,
  imageUrl: string,
  caption?: string,
  scheduledAt?: Date | null
): Promise<{ postId: string; postUrl: string }> {
  const params = new URLSearchParams({
    url: imageUrl,
    access_token: pageAccessToken,
  });

  if (caption) {
    params.append('message', caption);
  }

  // Use Meta's native scheduling if scheduledAt is in the future
  if (scheduledAt && scheduledAt.getTime() > Date.now()) {
    params.append(
      'scheduled_publish_time',
      String(Math.floor(scheduledAt.getTime() / 1000))
    );
    params.append('published', 'false');
  }

  const response = await metaFetch(`${GRAPH_API_BASE}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw await parseMetaErrorResponse(response, 'Facebook post failed');
  }

  const data = (await response.json()) as FacebookPostResponse;
  const postId = data.post_id || data.id;

  return {
    postId,
    postUrl: `https://www.facebook.com/${postId}`,
  };
}

/**
 * Publish or schedule a multi-image carousel to a Facebook Page.
 *
 * Facebook has no single "carousel" endpoint: you upload each photo
 * unpublished (`/{page}/photos?published=false`) to obtain a `media_fbid`,
 * then create one feed post that attaches them all via `attached_media[n]`.
 * The result is a single multi-photo post (FB renders it as a swipeable
 * album/carousel in feed).
 */
async function publishToFacebookCarousel(
  pageId: string,
  pageAccessToken: string,
  imageUrls: string[],
  caption?: string,
  scheduledAt?: Date | null
): Promise<{ postId: string; postUrl: string }> {
  // Step 1: upload each image as an unpublished photo, collecting its fbid.
  const mediaFbids: string[] = [];
  for (const imageUrl of imageUrls) {
    const photoParams = new URLSearchParams({
      url: imageUrl,
      access_token: pageAccessToken,
      published: 'false', // staged for attachment, not its own post
    });

    const photoResponse = await metaFetch(
      `${GRAPH_API_BASE}/${pageId}/photos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: photoParams.toString(),
      }
    );

    if (!photoResponse.ok) {
      throw await parseMetaErrorResponse(
        photoResponse,
        'Facebook carousel photo upload failed'
      );
    }

    const photoData = (await photoResponse.json()) as FacebookPostResponse;
    mediaFbids.push(photoData.id);
  }

  // Step 2: create the feed post attaching every uploaded photo, in order.
  const feedParams = new URLSearchParams({ access_token: pageAccessToken });
  if (caption) {
    feedParams.append('message', caption);
  }
  mediaFbids.forEach((fbid, i) => {
    feedParams.append(
      `attached_media[${i}]`,
      JSON.stringify({ media_fbid: fbid })
    );
  });

  // Use Meta's native scheduling if scheduledAt is in the future
  if (scheduledAt && scheduledAt.getTime() > Date.now()) {
    feedParams.append(
      'scheduled_publish_time',
      String(Math.floor(scheduledAt.getTime() / 1000))
    );
    feedParams.append('published', 'false');
  }

  const feedResponse = await metaFetch(`${GRAPH_API_BASE}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: feedParams.toString(),
  });

  if (!feedResponse.ok) {
    throw await parseMetaErrorResponse(
      feedResponse,
      'Facebook carousel post failed'
    );
  }

  const feedData = (await feedResponse.json()) as FacebookPostResponse;
  const postId = feedData.post_id || feedData.id;

  return {
    postId,
    postUrl: `https://www.facebook.com/${postId}`,
  };
}

/**
 * Publish or schedule a video to Facebook Page
 */
async function publishToFacebookVideo(
  pageId: string,
  pageAccessToken: string,
  videoUrl: string,
  caption?: string,
  scheduledAt?: Date | null
): Promise<{ postId: string; postUrl: string }> {
  const params = new URLSearchParams({
    file_url: videoUrl,
    access_token: pageAccessToken,
  });

  if (caption) {
    params.append('description', caption);
  }

  // Use Meta's native scheduling if scheduledAt is in the future
  if (scheduledAt && scheduledAt.getTime() > Date.now()) {
    params.append(
      'scheduled_publish_time',
      String(Math.floor(scheduledAt.getTime() / 1000))
    );
    params.append('published', 'false');
  }

  const response = await metaFetch(`${GRAPH_API_BASE}/${pageId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw await parseMetaErrorResponse(response, 'Facebook video post failed');
  }

  const data = (await response.json()) as FacebookPostResponse;

  return {
    postId: data.id,
    postUrl: `https://www.facebook.com/${pageId}/videos/${data.id}`,
  };
}

/**
 * Get Instagram Business Account ID from Facebook Page
 */
async function getInstagramAccountId(
  pageId: string,
  pageAccessToken: string
): Promise<string | null> {
  const response = await metaFetch(
    `${GRAPH_API_BASE}/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    instagram_business_account?: { id: string };
  };

  return data.instagram_business_account?.id || null;
}

/**
 * Publish or schedule to Instagram (using Content Publishing API)
 */
async function publishToInstagram(
  igUserId: string,
  accessToken: string,
  mediaUrl: string,
  mediaType: 'image' | 'video',
  caption?: string,
  scheduledAt?: Date | null,
  apiBase: string = GRAPH_API_BASE
): Promise<{ postId: string; postUrl: string }> {
  const isScheduled = scheduledAt && scheduledAt.getTime() > Date.now();

  // Step 1: Create media container
  const containerParams = new URLSearchParams({
    access_token: accessToken,
  });

  if (mediaType === 'image') {
    containerParams.append('image_url', mediaUrl);
  } else {
    containerParams.append('video_url', mediaUrl);
    containerParams.append('media_type', 'REELS'); // Instagram video posts are reels
  }

  if (caption) {
    containerParams.append('caption', caption);
  }

  const containerResponse = await metaFetch(`${apiBase}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: containerParams.toString(),
  });

  if (!containerResponse.ok) {
    throw await parseMetaErrorResponse(
      containerResponse,
      'Instagram container creation failed'
    );
  }

  const containerData =
    (await containerResponse.json()) as InstagramContainerResponse;
  const containerId = containerData.id;

  // Wait for processing — videos always need this; images may also need it
  // when Instagram downloads from an external URL.
  await waitForInstagramContainerReady(containerId, accessToken, apiBase);

  // Step 2: Publish (or schedule) the container
  const publishParams = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  });

  // Use Meta's native scheduling for Instagram
  if (isScheduled) {
    publishParams.append(
      'scheduled_publish_time',
      String(Math.floor(scheduledAt.getTime() / 1000))
    );
  }

  const publishResponse = await metaFetch(
    `${apiBase}/${igUserId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishParams.toString(),
    }
  );

  if (!publishResponse.ok) {
    throw await parseMetaErrorResponse(
      publishResponse,
      'Instagram publish failed'
    );
  }

  const publishData =
    (await publishResponse.json()) as InstagramPublishResponse;

  return {
    postId: publishData.id,
    postUrl: `https://www.instagram.com/p/${publishData.id}`,
  };
}

/**
 * Publish or schedule a multi-image carousel to Instagram.
 *
 * IG carousels require three steps (Content Publishing API):
 * 1. Create one child container per image (`is_carousel_item=true`), and wait
 *    for each to finish processing.
 * 2. Create a parent container (`media_type=CAROUSEL`, `children=<ids>`) with
 *    the caption, and wait for it to be ready.
 * 3. Publish the parent container.
 */
async function publishToInstagramCarousel(
  igUserId: string,
  accessToken: string,
  imageUrls: string[],
  caption?: string,
  scheduledAt?: Date | null,
  apiBase: string = GRAPH_API_BASE
): Promise<{ postId: string; postUrl: string }> {
  const isScheduled = scheduledAt && scheduledAt.getTime() > Date.now();

  // Step 1: create a child container per image.
  const childIds: string[] = [];
  for (const imageUrl of imageUrls) {
    const childParams = new URLSearchParams({
      access_token: accessToken,
      image_url: imageUrl,
      is_carousel_item: 'true',
    });

    const childResponse = await metaFetch(`${apiBase}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: childParams.toString(),
    });

    if (!childResponse.ok) {
      throw await parseMetaErrorResponse(
        childResponse,
        'Instagram carousel item creation failed'
      );
    }

    const childData =
      (await childResponse.json()) as InstagramContainerResponse;
    childIds.push(childData.id);
  }

  // Each child must finish processing before it can be added to the carousel.
  for (const childId of childIds) {
    await waitForInstagramContainerReady(childId, accessToken, apiBase);
  }

  // Step 2: create the parent carousel container referencing every child.
  const carouselParams = new URLSearchParams({
    access_token: accessToken,
    media_type: 'CAROUSEL',
    children: childIds.join(','),
  });
  if (caption) {
    carouselParams.append('caption', caption);
  }

  const carouselResponse = await metaFetch(`${apiBase}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: carouselParams.toString(),
  });

  if (!carouselResponse.ok) {
    throw await parseMetaErrorResponse(
      carouselResponse,
      'Instagram carousel container creation failed'
    );
  }

  const carouselData =
    (await carouselResponse.json()) as InstagramContainerResponse;
  const carouselId = carouselData.id;

  await waitForInstagramContainerReady(carouselId, accessToken, apiBase);

  // Step 3: publish (or schedule) the carousel container.
  const publishParams = new URLSearchParams({
    creation_id: carouselId,
    access_token: accessToken,
  });
  if (isScheduled) {
    publishParams.append(
      'scheduled_publish_time',
      String(Math.floor(scheduledAt.getTime() / 1000))
    );
  }

  const publishResponse = await metaFetch(
    `${apiBase}/${igUserId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishParams.toString(),
    }
  );

  if (!publishResponse.ok) {
    throw await parseMetaErrorResponse(
      publishResponse,
      'Instagram carousel publish failed'
    );
  }

  const publishData =
    (await publishResponse.json()) as InstagramPublishResponse;

  return {
    postId: publishData.id,
    postUrl: `https://www.instagram.com/p/${publishData.id}`,
  };
}

/**
 * Wait for Instagram media container to be ready.
 * Videos typically take 2-5 minutes; images are usually instant but can
 * also return IN_PROGRESS when Instagram needs to download from a URL.
 */
async function waitForInstagramContainerReady(
  containerId: string,
  accessToken: string,
  apiBase: string = GRAPH_API_BASE,
  maxAttempts = 90,
  intervalMs = 2000
): Promise<void> {
  let lastStatusCode: string | undefined;
  let consecutiveErrors = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await metaFetch(
      `${apiBase}/${containerId}?fields=status_code,status,error_message&access_token=${accessToken}`
    );

    if (response.ok) {
      consecutiveErrors = 0;
      const data = (await response.json()) as {
        status_code?: string;
        status?: string;
        error_message?: string;
      };
      lastStatusCode = data.status_code;

      if (data.status_code === 'FINISHED') {
        return;
      }
      if (data.status_code === 'ERROR') {
        // Build a detailed error message from all available fields
        const reason = data.error_message || data.status || 'unknown reason';
        logError(
          'socialPosts.waitForInstagramContainer',
          new Error(`Container ${containerId} failed`),
          {
            feature: 'social-posts',
            extra: {
              containerId,
              statusCode: data.status_code,
              status: data.status,
              errorMessage: data.error_message,
              attempt,
            },
          }
        );
        throw new Error(`Instagram media processing failed: ${reason}`);
      }
    } else {
      consecutiveErrors++;
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: { message?: string; code?: number };
      };
      const errorMsg = `HTTP ${response.status}: ${errorBody.error?.message || 'Unknown error'}`;

      logError('socialPosts.waitForInstagramContainer', new Error(errorMsg), {
        feature: 'social-posts',
        extra: { containerId, attempt, consecutiveErrors },
      });

      if (consecutiveErrors >= 5) {
        throw new Error(
          `Instagram container status check failed repeatedly: ${errorMsg}`
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Instagram media processing timed out after ${(maxAttempts * intervalMs) / 1000}s (last status: ${lastStatusCode || 'unknown'})`
  );
}

/**
 * Internal implementation of publish social post
 */
const publishSocialPostImpl = async (
  db: DbConnection,
  input: PublishSocialPostInput
): Promise<Result<SocialPost>> => {
  // Validate input
  const parsed = publishSocialPostSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  // Get the social post
  const post = await db.query.socialPost.findFirst({
    where: and(
      eq(socialPost.id, id),
      eq(socialPost.organizationId, organizationId)
    ),
  });

  if (!post) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Social post not found'));
  }

  // Check if already published
  if (post.status === 'published') {
    return err(
      new FeatureError(ErrorCodes.CONFLICT, 'Post has already been published')
    );
  }

  if (post.status === 'publishing') {
    return err(
      new FeatureError(ErrorCodes.CONFLICT, 'Post is currently being published')
    );
  }

  const { platforms, mediaType, caption, scheduledAt } = post;
  const needsFacebook = (platforms as string[]).includes('facebook');
  const needsInstagram = (platforms as string[]).includes('instagram');

  // Get Meta integration (required for Facebook, optional for Instagram)
  const integration = await db.query.metaAdsIntegration.findFirst({
    where: eq(metaAdsIntegration.organizationId, organizationId),
  });

  // For Facebook publishing, Meta integration is required
  let page: typeof metaAdsPage.$inferSelect | undefined;
  let pageAccessToken: string | null = null;

  if (needsFacebook || (needsInstagram && integration?.isActive)) {
    if (integration?.isActive) {
      // Prefer the page the post was created for (platformSettings snapshot) —
      // under FLfB an org has multiple pages, so falling back to the default
      // would silently publish selected posts to the wrong page.
      const selectedPageId = (post.platformSettings as PlatformSettings | null)
        ?.facebook?.pageId;
      if (selectedPageId) {
        page = await db.query.metaAdsPage.findFirst({
          where: and(
            eq(metaAdsPage.metaAdsIntegrationId, integration.id),
            eq(metaAdsPage.pageId, selectedPageId)
          ),
        });
      }

      // Fall back to the default page, then first active page
      if (!page) {
        page = await db.query.metaAdsPage.findFirst({
          where: and(
            eq(metaAdsPage.metaAdsIntegrationId, integration.id),
            eq(metaAdsPage.id, integration.defaultPageId || '')
          ),
        });
      }

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
            page.pageAccessToken
          ) as MetaCredentials;
          pageAccessToken = decrypted.accessToken;
        } catch {
          // If we need Facebook, this is fatal
          if (needsFacebook) {
            await db
              .update(socialPost)
              .set({
                status: 'failed',
                errorMessage: 'Failed to decrypt Meta credentials',
              })
              .where(eq(socialPost.id, id));

            return err(
              new FeatureError(
                ErrorCodes.INTERNAL_ERROR,
                'Failed to decrypt Meta credentials'
              )
            );
          }
        }
      }
    }

    // If Facebook is needed but no page is available, fail
    if (needsFacebook && (!page || !pageAccessToken)) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'No Facebook Page connected. Please add a page to your Meta integration.'
        )
      );
    }
  }

  // For Instagram-only posts, check that at least standalone Instagram exists
  if (needsInstagram && !needsFacebook && !page && !pageAccessToken) {
    const standaloneCreds = await getStandaloneInstagramCredentials(
      db,
      organizationId
    );
    if (!standaloneCreds) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'No Instagram account connected. Please connect Instagram in Integrations.'
        )
      );
    }
  }

  // Update status to publishing
  await db
    .update(socialPost)
    .set({ status: 'publishing' })
    .where(eq(socialPost.id, id));

  const results: PlatformPublishResult[] = [];
  const isScheduled = scheduledAt && scheduledAt.getTime() > Date.now();

  // Kill-switch (default-off, per-org): when ON, Instagram publishes via the
  // Facebook Page's linked IG account on the durable system-user token
  // (graph.facebook.com); when OFF, the legacy standalone Instagram-Login path
  // (graph.instagram.com) runs unchanged. Flip off in PostHog to roll back.
  const useFlfbInstagram = await isInstagramFlfbRoutingEnabled(organizationId);

  // Resolve every image to publish (1 for a normal post, N for a carousel),
  // then re-sign each so Meta can fetch it (stored signed URLs may be expired).
  const orderedSourceUrls = await resolveOrderedMediaUrls(db, post);
  const mediaUrls = await Promise.all(
    orderedSourceUrls.map(generateExternalMediaUrl)
  );
  // Primary URL, used for single-image/video posts and for error logging.
  const mediaUrl = mediaUrls[0];
  // A carousel is 2+ images; videos are never carousels.
  const isCarousel = mediaType === 'image' && mediaUrls.length > 1;

  // Publish (or schedule) to each platform
  for (const platform of platforms as ('facebook' | 'instagram')[]) {
    // Track which integration's token was used so we mark the right one on auth error
    let credentialSource: 'meta_ads' | 'instagram' = 'meta_ads';
    try {
      if (platform === 'facebook') {
        if (!page || !pageAccessToken) {
          results.push({
            platform: 'facebook',
            success: false,
            error: 'No Facebook Page connected.',
          });
          continue;
        }

        const fbResult = isCarousel
          ? await publishToFacebookCarousel(
              page.pageId,
              pageAccessToken,
              mediaUrls,
              caption || undefined,
              scheduledAt
            )
          : mediaType === 'image'
            ? await publishToFacebookImage(
                page.pageId,
                pageAccessToken,
                mediaUrl,
                caption || undefined,
                scheduledAt
              )
            : await publishToFacebookVideo(
                page.pageId,
                pageAccessToken,
                mediaUrl,
                caption || undefined,
                scheduledAt
              );

        results.push({
          platform: 'facebook',
          success: true,
          postId: fbResult.postId,
          postUrl: fbResult.postUrl,
          publishedAt: new Date().toISOString(),
        });
      } else if (platform === 'instagram') {
        if (useFlfbInstagram) {
          // FLfB (flag-gated): prefer the page-linked IG Business Account on
          // the durable system-user token via graph.facebook.com. Fall back to
          // the standalone Instagram-Login token for orgs not yet migrated.
          let igAccountId: string | null = null;
          let igAccessToken: string | null = null;
          let igApiBase = GRAPH_API_BASE;

          if (page && pageAccessToken) {
            igAccountId =
              page.linkedInstagramAccountId ??
              (await getInstagramAccountId(page.pageId, pageAccessToken));
            if (igAccountId) {
              igAccessToken = pageAccessToken;
              igApiBase = GRAPH_API_BASE;
              credentialSource = 'meta_ads';
            }
          }

          if (!igAccountId) {
            const standaloneCreds = await getStandaloneInstagramCredentials(
              db,
              organizationId
            );
            if (standaloneCreds) {
              igAccountId = standaloneCreds.igUserId;
              igAccessToken = standaloneCreds.accessToken;
              igApiBase = INSTAGRAM_MESSAGING_API_BASE;
              credentialSource = 'instagram';
            }
          }

          if (!igAccountId || !igAccessToken) {
            results.push({
              platform: 'instagram',
              success: false,
              error:
                'Instagram not connected. Please connect your Instagram account in Integrations.',
            });
            continue;
          }

          const igResult = isCarousel
            ? await publishToInstagramCarousel(
                igAccountId,
                igAccessToken,
                mediaUrls,
                caption || undefined,
                scheduledAt,
                igApiBase
              )
            : await publishToInstagram(
                igAccountId,
                igAccessToken,
                mediaUrl,
                mediaType,
                caption || undefined,
                scheduledAt,
                igApiBase
              );

          results.push({
            platform: 'instagram',
            success: true,
            postId: igResult.postId,
            postUrl: igResult.postUrl,
            publishedAt: new Date().toISOString(),
          });
        } else {
          // LEGACY (default): standalone Instagram-Login preferred via
          // graph.instagram.com; page-linked account as fallback.
          const standaloneCreds = await getStandaloneInstagramCredentials(
            db,
            organizationId
          );

          if (standaloneCreds) {
            credentialSource = 'instagram';
            // Instagram Login API tokens must use graph.instagram.com
            const igResult = isCarousel
              ? await publishToInstagramCarousel(
                  standaloneCreds.igUserId,
                  standaloneCreds.accessToken,
                  mediaUrls,
                  caption || undefined,
                  scheduledAt,
                  INSTAGRAM_MESSAGING_API_BASE
                )
              : await publishToInstagram(
                  standaloneCreds.igUserId,
                  standaloneCreds.accessToken,
                  mediaUrl,
                  mediaType,
                  caption || undefined,
                  scheduledAt,
                  INSTAGRAM_MESSAGING_API_BASE
                );

            results.push({
              platform: 'instagram',
              success: true,
              postId: igResult.postId,
              postUrl: igResult.postUrl,
              publishedAt: new Date().toISOString(),
            });
          } else if (page && pageAccessToken) {
            // Fallback: use Facebook page's linked IG Business Account
            const igAccountId = await getInstagramAccountId(
              page.pageId,
              pageAccessToken
            );

            if (!igAccountId) {
              results.push({
                platform: 'instagram',
                success: false,
                error:
                  'Instagram not connected. Please connect your Instagram account in Integrations.',
              });
              continue;
            }

            const igResult = isCarousel
              ? await publishToInstagramCarousel(
                  igAccountId,
                  pageAccessToken,
                  mediaUrls,
                  caption || undefined,
                  scheduledAt,
                  INSTAGRAM_MESSAGING_API_BASE
                )
              : await publishToInstagram(
                  igAccountId,
                  pageAccessToken,
                  mediaUrl,
                  mediaType,
                  caption || undefined,
                  scheduledAt,
                  INSTAGRAM_MESSAGING_API_BASE
                );

            results.push({
              platform: 'instagram',
              success: true,
              postId: igResult.postId,
              postUrl: igResult.postUrl,
              publishedAt: new Date().toISOString(),
            });
          } else {
            results.push({
              platform: 'instagram',
              success: false,
              error:
                'Instagram not connected. Please connect your Instagram account in Integrations.',
            });
          }
        }
      }
    } catch (error) {
      // Detect timeout (AbortError) and provide a clearer message
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const errorMessage = isTimeout
        ? `Meta API request timed out after ${META_API_TIMEOUT_MS / 1000}s — please try again`
        : error instanceof Error
          ? error.message
          : 'Unknown error';

      logError('socialPosts.publishSocialPost', error, {
        feature: 'social-posts',
        extra: { platform, postId: id, mediaType, mediaUrl, isTimeout },
      });

      // Mark the appropriate integration as needs_reconnect on auth errors.
      // credentialSource tracks whether standalone IG or Meta page token was used.
      // Skip for timeouts — they're not auth errors.
      if (!isTimeout) {
        await handleMetaAuthError(db, error, {
          type: credentialSource,
          organizationId,
        });
      }

      results.push({
        platform,
        success: false,
        error: errorMessage,
      });
    }
  }

  // Determine final status
  const allSucceeded = results.every((r) => r.success);
  const someSucceeded = results.some((r) => r.success);

  let finalStatus: 'published' | 'scheduled' | 'partial' | 'failed';
  let errorMessage: string | null = null;

  if (allSucceeded) {
    // If scheduling, keep status as 'scheduled' (Meta will publish at the scheduled time)
    finalStatus = isScheduled ? 'scheduled' : 'published';
  } else if (someSucceeded) {
    finalStatus = 'partial';
    errorMessage = results
      .filter((r) => !r.success)
      .map((r) => `${r.platform}: ${r.error}`)
      .join('; ');
  } else {
    finalStatus = 'failed';
    errorMessage = results.map((r) => `${r.platform}: ${r.error}`).join('; ');
  }

  // Update the post with results
  const [updatedPost] = await db
    .update(socialPost)
    .set({
      status: finalStatus,
      platformResults: results,
      publishedAt: !isScheduled && someSucceeded ? new Date() : null,
      errorMessage,
    })
    .where(eq(socialPost.id, id))
    .returning();

  return ok(updatedPost);
};

/**
 * Publish a social post to the selected platforms
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Input with post ID and organization ID
 * @returns Result with updated social post or error
 *
 * @example
 * ```ts
 * const result = await publishSocialPost(db, {
 *   id: 'post_123',
 *   organizationId: 'org_123',
 * });
 * ```
 */
export const publishSocialPost = (
  db: DbConnection,
  input: PublishSocialPostInput
) =>
  trackedResult(
    'socialPosts.publishSocialPost',
    () => withOrgScope((tx) => publishSocialPostImpl(tx, input), { db }),
    { properties: { id: input.id } }
  );

/**
 * Result type for publishSocialPost
 */
export type PublishSocialPostResult = Awaited<
  ReturnType<typeof publishSocialPost>
>;
