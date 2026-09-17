import type { MetaAdsPage } from '@/features/integrations';
import type {
  PlatformSettings,
  SocialPost,
  SocialPostPlatform,
} from '@/features/social-posts';

/**
 * A post targets a page if either the platform-specific settings reference
 * the page's external id (preferred) or the post's platforms array includes
 * the page's platform (fallback for legacy rows without `platformSettings`).
 */
export function postTargetsPage(post: SocialPost, page: MetaAdsPage): boolean {
  const platforms = Array.isArray(post.platforms)
    ? (post.platforms as SocialPostPlatform[])
    : [];
  if (!platforms.includes(page.platform)) return false;

  const settings = (post.platformSettings ?? null) as PlatformSettings | null;
  if (!settings) return true;

  if (page.platform === 'facebook') {
    const pid = settings.facebook?.pageId;
    return pid ? pid === page.pageId : true;
  }
  const aid = settings.instagram?.accountId;
  return aid ? aid === page.pageId : true;
}
