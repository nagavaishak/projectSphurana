import {
  type SocialPost,
  metaAdsPage,
  socialPost,
} from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { inArray } from 'drizzle-orm';
import { STANDALONE_IG_PREFIX } from '../../../integrations/services/list-meta-ads-pages/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateSocialPostInput,
  createSocialPostSchema,
} from './create-social-post.schema.js';

/**
 * Internal implementation of create social post
 */
const createSocialPostImpl = async (
  db: DbConnection,
  input: CreateSocialPostInput
): Promise<Result<SocialPost>> => {
  // Validate input
  const parsed = createSocialPostSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const data = parsed.data;

  // Resolve platforms from pageIds if provided
  let platforms = data.platforms ?? [];
  let platformSettings = data.platformSettings;

  if (data.pageIds && data.pageIds.length > 0) {
    // Separate standalone Instagram IDs from regular Meta Ads page IDs
    const standaloneIgIds = data.pageIds.filter((id) =>
      id.startsWith(STANDALONE_IG_PREFIX)
    );
    const metaPageIds = data.pageIds.filter(
      (id) => !id.startsWith(STANDALONE_IG_PREFIX)
    );

    // Look up Meta Ads pages to derive platforms
    if (metaPageIds.length > 0) {
      const pages = await db.query.metaAdsPage.findMany({
        where: inArray(metaAdsPage.id, metaPageIds),
      });

      // Derive unique platforms from pages
      const metaPlatforms = [...new Set(pages.map((p) => p.platform))] as (
        | 'facebook'
        | 'instagram'
      )[];
      platforms = [...platforms, ...metaPlatforms];

      // Build platformSettings from pages if not already provided
      if (!platformSettings) {
        platformSettings = {};
        for (const page of pages) {
          if (page.platform === 'facebook') {
            platformSettings.facebook = { pageId: page.pageId };
          } else if (page.platform === 'instagram') {
            platformSettings.instagram = { accountId: page.pageId };
          }
        }
      }
    }

    // Handle standalone Instagram selection
    if (standaloneIgIds.length > 0) {
      if (!platforms.includes('instagram')) {
        platforms.push('instagram');
      }
      // publishSocialPost already prefers standalone Instagram credentials,
      // so no special platformSettings needed
    }

    if (metaPageIds.length === 0 && standaloneIgIds.length === 0) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'No valid pages found')
      );
    }
  }

  // Deduplicate platforms
  platforms = [...new Set(platforms)] as ('facebook' | 'instagram')[];

  // Ensure we have at least one platform
  if (platforms.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'At least one platform must be selected'
      )
    );
  }

  // Determine status based on scheduledAt
  let status: 'draft' | 'scheduled' = data.status ?? 'draft';
  if (data.scheduledAt && !data.status) {
    status = 'scheduled';
  }

  // Normalise the carousel media list: keep 2+ distinct entries only, and
  // ensure mediaUrl is the first slide so single-image consumers stay correct.
  // A single (or empty) list collapses to null — a normal one-image post.
  const mediaUrls =
    data.mediaUrls && data.mediaUrls.length > 1
      ? Array.from(new Set([data.mediaUrl, ...data.mediaUrls]))
      : null;

  // Create social post
  const [result] = await db
    .insert(socialPost)
    .values({
      organizationId: data.organizationId,
      createdById: data.createdById,
      title: data.title,
      caption: data.caption,
      mediaType: data.mediaType,
      mediaUrl: data.mediaUrl,
      mediaUrls,
      thumbnailUrl: data.thumbnailUrl,
      videoId: data.videoId,
      graphicId: data.graphicId,
      platforms,
      platformSettings,
      scheduledAt: data.scheduledAt,
      status,
    })
    .returning();

  return ok(result);
};

/**
 * Create a new social post
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Social post creation input
 * @returns Result with created social post or error
 *
 * @example
 * ```ts
 * const result = await createSocialPost(db, {
 *   organizationId: 'org_123',
 *   createdById: 'user_123',
 *   title: 'Summer Sale Post',
 *   caption: 'Check out our summer sale!',
 *   mediaType: 'image',
 *   mediaUrl: 'https://example.com/image.jpg',
 *   platforms: ['facebook', 'instagram'],
 *   scheduledAt: new Date('2024-01-15T10:00:00Z'),
 * });
 * ```
 */
export const createSocialPost = (
  db: DbConnection,
  input: CreateSocialPostInput
) =>
  trackedResult(
    'socialPosts.createSocialPost',
    () => withOrgScope((tx) => createSocialPostImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for createSocialPost
 */
export type CreateSocialPostResult = Awaited<
  ReturnType<typeof createSocialPost>
>;
