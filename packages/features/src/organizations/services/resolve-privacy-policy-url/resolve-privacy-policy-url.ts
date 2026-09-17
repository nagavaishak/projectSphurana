import {
  and,
  eq,
  metaAdsIntegration,
  metaAdsPage,
} from '@borradh-workspace/database';
import type { DbConnection } from '../../../shared/index.js';

/**
 * The org fields a privacy-policy URL can be resolved from, in priority order.
 */
export interface PrivacyPolicySource {
  privacyPolicyUrl?: string | null;
  websiteUrl?: string | null;
  facebookPageUrl?: string | null;
}

/** Prepend `https://` when a stored URL has no protocol, and validate it. */
function normalizeUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    // eslint-disable-next-line no-new
    new URL(withProtocol);
    return withProtocol;
  } catch {
    return null;
  }
}

/**
 * Resolve the privacy-policy URL to attach to a Meta lead form.
 *
 * Meta hard-requires a privacy-policy URL on every instant form, so it can't be
 * omitted — Meta would reject the form. Rather than block the owner when they
 * haven't set a dedicated policy, we fall back to a link they already have on
 * file: their website, then their Facebook Page. Both are acceptable
 * privacy-policy destinations for Meta and keep the lead-form path unblocked.
 * Owners who want a dedicated policy can still set one in Settings → Business.
 *
 * Returns `null` only when the org has NONE of the three — a dedicated policy,
 * a website, or a Facebook Page URL.
 */
export function resolvePrivacyPolicyUrl(
  org: PrivacyPolicySource
): string | null {
  return (
    normalizeUrl(org.privacyPolicyUrl) ??
    normalizeUrl(org.websiteUrl) ??
    normalizeUrl(org.facebookPageUrl)
  );
}

/**
 * Load an organization and resolve its effective privacy-policy URL (see
 * {@link resolvePrivacyPolicyUrl}). Central helper so every lead-form creation
 * path — the web builder, onboarding, and Claire — shares one fallback rule.
 *
 * As a final fallback we use the org's own connected Facebook Page URL. Any org
 * that can run a Meta lead-form campaign has a Page, so a business with no
 * website or dedicated policy still isn't blocked — we simply point Meta at the
 * advertiser's own page. In practice this means the "add a privacy policy"
 * dead-end never fires for a real advertiser.
 */
export async function resolveOrgPrivacyPolicyUrl(
  db: DbConnection,
  organizationId: string
): Promise<string | null> {
  const org = await db.query.organization.findFirst({
    where: (o, { and, eq, isNull }) =>
      and(eq(o.id, organizationId), isNull(o.deletedAt)),
    columns: {
      privacyPolicyUrl: true,
      websiteUrl: true,
      facebookPageUrl: true,
    },
  });

  const fromOrg = org ? resolvePrivacyPolicyUrl(org) : null;
  if (fromOrg) return fromOrg;

  return resolveConnectedFacebookPageUrl(db, organizationId);
}

/**
 * Build a URL to the org's own connected Facebook Page (vanity username when we
 * have it, else the numeric page id — both resolve to the page). Prefers a
 * Facebook page over Instagram. Returns `null` when the org has no active page.
 */
async function resolveConnectedFacebookPageUrl(
  db: DbConnection,
  organizationId: string
): Promise<string | null> {
  const pages = await db
    .select({
      pageId: metaAdsPage.pageId,
      pageUsername: metaAdsPage.pageUsername,
      platform: metaAdsPage.platform,
    })
    .from(metaAdsPage)
    .innerJoin(
      metaAdsIntegration,
      eq(metaAdsPage.metaAdsIntegrationId, metaAdsIntegration.id)
    )
    .where(
      and(
        eq(metaAdsIntegration.organizationId, organizationId),
        eq(metaAdsPage.isActive, true)
      )
    );

  const page = pages.find((p) => p.platform === 'facebook') ?? pages[0];
  if (!page) return null;

  const handle = page.pageUsername?.trim() || page.pageId;
  return normalizeUrl(`https://facebook.com/${handle}`);
}
