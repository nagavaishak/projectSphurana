import {
  GRAPH_API_BASE,
  INSTAGRAM_GRAPH_API_BASE,
} from '@borradh-workspace/integrations/shared';
/**
 * `fetchPageMedia` — pull an org's OWN published social media (Facebook Page
 * posts + Instagram media) for use as a brand-style corpus.
 *
 * This is the read counterpart to `publishSocialPost`: where publish pushes
 * content out, this pulls the org's history back in so we can learn their
 * visual style. Resolves the same credential sources publish uses:
 *   - Facebook Page  → `meta_ads_page` token (decrypted)
 *   - Instagram      → standalone Instagram-Login integration, OR the
 *                      Page-linked `instagram_business_account`
 *
 * Resilient by design: a failure on one platform (or one not being connected)
 * never drops the other — we collect what we can and return the union. Only
 * when NO source resolves do we return FORBIDDEN.
 *
 * Returns normalized items. Both image and video are surfaced (tagged via
 * `mediaType`); v1 callers filter to images, video is reserved for a later
 * video brand-style feature.
 *
 * FB only for video detection uses the post's `attachments.media_type`; the
 * still (`full_picture`) backs `thumbnailUrl` for both kinds.
 */

import {
  instagramIntegration,
  metaAdsIntegration,
  metaAdsPage,
} from '@borradh-workspace/database';
import { fetchWithTimeout } from '@borradh-workspace/http';
import type { InstagramCredentials } from '@borradh-workspace/integrations';
import {
  MetaApiError,
  parseMetaErrorResponse,
} from '@borradh-workspace/integrations';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { handleMetaAuthError } from '../../../integrations/services/mark-needs-reconnect/mark-needs-reconnect.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type FetchPageMediaInput,
  fetchPageMediaSchema,
} from './fetch-page-media.schema.js';

const REQUEST_TIMEOUT_MS = 15_000;

export interface PageMediaItem {
  /** Platform post/media id. */
  id: string;
  platform: 'facebook' | 'instagram';
  mediaType: 'image' | 'video';
  caption: string;
  /** Full-res media URL (image bitmap, or video file for video items). */
  mediaUrl: string;
  /** A still to use as the reference frame (== mediaUrl for images). */
  thumbnailUrl: string;
  permalink: string;
  /** ISO timestamp of publication. */
  timestamp: string;
}

export interface FetchPageMediaOutput {
  items: PageMediaItem[];
  /** Per-source counts + which sources resolved, for logs/diagnostics. */
  sources: {
    facebook: { connected: boolean; count: number };
    instagram: { connected: boolean; count: number };
  };
}

interface FacebookSource {
  pageId: string;
  token: string;
  pageRowId: string;
  pageName: string | null;
  linkedInstagramAccountId: string | null;
}

const logger = createLogger('FetchPageMedia');

async function getJson(url: string): Promise<unknown> {
  // Routed through the shared HTTP seam (`@borradh-workspace/http`) rather than
  // bare `fetch` so the E2E contract fake (META_E2E_STUB) can intercept it —
  // this is a Graph call, and a bare fetch here escapes to real Meta.
  const res = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!res.ok) {
    // Parse into a MetaApiError so revoked tokens (190) and other Meta
    // conditions classify — callers gate logging/reconnect handling on it.
    throw await parseMetaErrorResponse(res, 'Meta page-media request failed');
  }
  return res.json();
}

/**
 * Resolve the org's Facebook Page (default page, else first active page) and
 * decrypt its access token. Mirrors `publishSocialPost` / `syncSocialPosts`
 * resolution. Returns null when no usable page exists.
 */
async function resolveFacebookSource(
  db: DbConnection,
  organizationId: string
): Promise<FacebookSource | null> {
  const integration = await db.query.metaAdsIntegration.findFirst({
    where: eq(metaAdsIntegration.organizationId, organizationId),
  });
  if (!integration?.isActive) return null;

  let page = integration.defaultPageId
    ? await db.query.metaAdsPage.findFirst({
        where: and(
          eq(metaAdsPage.metaAdsIntegrationId, integration.id),
          eq(metaAdsPage.id, integration.defaultPageId)
        ),
      })
    : undefined;
  if (!page) {
    page = await db.query.metaAdsPage.findFirst({
      where: and(
        eq(metaAdsPage.metaAdsIntegrationId, integration.id),
        eq(metaAdsPage.isActive, true)
      ),
    });
  }
  if (!page?.pageAccessToken || !page.pageId) return null;

  let token: string;
  try {
    token = (
      decryptCredentials(page.pageAccessToken) as { accessToken: string }
    ).accessToken;
  } catch {
    return null;
  }
  return {
    pageId: page.pageId,
    token,
    pageRowId: page.id,
    pageName: page.pageName,
    linkedInstagramAccountId: page.linkedInstagramAccountId ?? null,
  };
}

/** Standalone Instagram-Login credentials, if connected. */
async function resolveStandaloneInstagram(
  db: DbConnection,
  organizationId: string
): Promise<{ igUserId: string; token: string } | null> {
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
    return { igUserId: creds.instagramUserId, token: creds.accessToken };
  } catch {
    return null;
  }
}

interface FbPost {
  id: string;
  message?: string;
  full_picture?: string;
  permalink_url?: string;
  created_time?: string;
  attachments?: { data?: { media_type?: string }[] };
}

async function pullFacebook(
  fb: FacebookSource,
  limit: number
): Promise<PageMediaItem[]> {
  const items: PageMediaItem[] = [];
  let url: string | null =
    `${GRAPH_API_BASE}/${fb.pageId}/posts?fields=id,message,full_picture,permalink_url,created_time,attachments{media_type}&limit=50&access_token=${fb.token}`;
  while (url && items.length < limit) {
    const json = (await getJson(url)) as {
      data?: FbPost[];
      paging?: { next?: string };
    };
    for (const p of json.data ?? []) {
      if (!p.full_picture) continue; // need a still to reference
      const attachType = p.attachments?.data?.[0]?.media_type;
      const mediaType: 'image' | 'video' =
        attachType === 'video' ? 'video' : 'image';
      items.push({
        id: p.id,
        platform: 'facebook',
        mediaType,
        caption: p.message ?? '',
        mediaUrl: p.full_picture,
        thumbnailUrl: p.full_picture,
        permalink: p.permalink_url ?? '',
        timestamp: p.created_time ?? '',
      });
      if (items.length >= limit) break;
    }
    url = json.paging?.next ?? null;
  }
  return items;
}

interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string; // IMAGE | VIDEO | CAROUSEL_ALBUM
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

/**
 * Pull Instagram media. `apiBase` differs by credential source: standalone
 * Instagram-Login tokens use graph.instagram.com; Page-linked business
 * accounts use graph.facebook.com with the Page token.
 */
async function pullInstagram(
  igUserId: string,
  token: string,
  apiBase: string,
  limit: number
): Promise<PageMediaItem[]> {
  const items: PageMediaItem[] = [];
  let url: string | null =
    `${apiBase}/${igUserId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=50&access_token=${token}`;
  while (url && items.length < limit) {
    const json = (await getJson(url)) as {
      data?: IgMedia[];
      paging?: { next?: string };
    };
    for (const m of json.data ?? []) {
      const isVideo = m.media_type === 'VIDEO';
      // VIDEO: media_url is the file, thumbnail_url the still.
      // IMAGE / CAROUSEL_ALBUM: media_url is the image (album = first child's
      // image on the parent for single-image albums; missing → skip).
      const still = isVideo ? m.thumbnail_url : m.media_url;
      const full = m.media_url ?? still;
      if (!still || !full) continue;
      items.push({
        id: m.id,
        platform: 'instagram',
        mediaType: isVideo ? 'video' : 'image',
        caption: m.caption ?? '',
        mediaUrl: full,
        thumbnailUrl: still,
        permalink: m.permalink ?? '',
        timestamp: m.timestamp ?? '',
      });
      if (items.length >= limit) break;
    }
    url = json.paging?.next ?? null;
  }
  return items;
}

/** Resolve the Page-linked IG business account id (if any). */
async function resolveLinkedInstagram(
  fb: FacebookSource
): Promise<string | null> {
  if (fb.linkedInstagramAccountId) return fb.linkedInstagramAccountId;
  try {
    const data = (await getJson(
      `${GRAPH_API_BASE}/${fb.pageId}?fields=instagram_business_account&access_token=${fb.token}`
    )) as { instagram_business_account?: { id: string } };
    return data.instagram_business_account?.id ?? null;
  } catch {
    return null;
  }
}

const fetchPageMediaImpl = async (
  db: DbConnection,
  input: FetchPageMediaInput
): Promise<Result<FetchPageMediaOutput>> => {
  const parsed = fetchPageMediaSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, limit } = parsed.data;

  const fb = await resolveFacebookSource(db, organizationId);
  const igStandalone = await resolveStandaloneInstagram(db, organizationId);

  if (!fb && !igStandalone) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'No connected Facebook Page or Instagram account for this organization'
      )
    );
  }

  const items: PageMediaItem[] = [];
  const sources: FetchPageMediaOutput['sources'] = {
    facebook: { connected: Boolean(fb), count: 0 },
    instagram: { connected: Boolean(igStandalone), count: 0 },
  };

  // Facebook posts.
  if (fb) {
    try {
      const fbItems = await pullFacebook(fb, limit);
      items.push(...fbItems);
      sources.facebook.count = fbItems.length;
    } catch (error) {
      // Capability degradation: attempt was made (never pre-skipped on
      // tokenStatus); on an actual auth failure mark needs_reconnect and
      // carry on — the Instagram source below still gets its attempt.
      await handleMetaAuthError(db, error, {
        type: 'meta_ads',
        organizationId,
      });
      if (error instanceof MetaApiError && error.isExpected) {
        logger.warn('Expected Meta error fetching Facebook page media', {
          organizationId,
          pageId: fb.pageId,
          metaCategory: error.category,
          message: error.message,
        });
      } else {
        logError('socialPosts.fetchPageMedia.facebook', error, {
          feature: 'social-posts',
          extra: { organizationId, pageId: fb.pageId },
        });
      }
    }
  }

  // Instagram: prefer the standalone integration (its own token); else fall
  // back to the Page-linked business account via the Page token.
  try {
    if (igStandalone) {
      const igItems = await pullInstagram(
        igStandalone.igUserId,
        igStandalone.token,
        INSTAGRAM_GRAPH_API_BASE,
        limit
      );
      items.push(...igItems);
      sources.instagram.connected = true;
      sources.instagram.count = igItems.length;
    } else if (fb) {
      const linkedIgId = await resolveLinkedInstagram(fb);
      if (linkedIgId) {
        const igItems = await pullInstagram(
          linkedIgId,
          fb.token,
          GRAPH_API_BASE,
          limit
        );
        items.push(...igItems);
        sources.instagram.connected = true;
        sources.instagram.count = igItems.length;
      }
    }
  } catch (error) {
    // Standalone IG uses the Instagram integration's token; the Page-linked
    // fallback uses the Meta Ads page token — mark the right integration.
    await handleMetaAuthError(db, error, {
      type: igStandalone ? 'instagram' : 'meta_ads',
      organizationId,
    });
    if (error instanceof MetaApiError && error.isExpected) {
      logger.warn('Expected Meta error fetching Instagram media', {
        organizationId,
        metaCategory: error.category,
        message: error.message,
      });
    } else {
      logError('socialPosts.fetchPageMedia.instagram', error, {
        feature: 'social-posts',
        extra: { organizationId },
      });
    }
  }

  return ok({ items, sources });
};

export const fetchPageMedia = (db: DbConnection, input: FetchPageMediaInput) =>
  trackedResult(
    'socialPosts.fetchPageMedia',
    () => fetchPageMediaImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type FetchPageMediaResult = Awaited<ReturnType<typeof fetchPageMedia>>;
