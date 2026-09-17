import {
  metaAd,
  metaCampaignConfig,
  organizationLocation,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Which BRANCH a customer conversation is about.
 *
 * Claire quotes prices and (eventually) sends booking links per branch, so she
 * needs to know which one the customer means. She must never invent it: every
 * tier below is a signal someone actually gave us, and the function returns
 * NULL rather than guessing.
 *
 * Tier 1 — THE AD. The advertiser already told us which branch a campaign is
 * for (`meta_campaign_config.location_id`), and the conversation records which
 * ad it came from. This is the strongest signal available and costs the
 * customer nothing: no question, no friction.
 *
 * Tier 2 — A SINGLE-BRANCH ORG. One branch is a fact, not a guess. Setting it
 * keeps NULL meaning strictly "we never knew" instead of blurring into "this
 * org only has one anyway".
 *
 * Deliberately NOT a tier: the org's default/primary branch for a multi-branch
 * org. `resolveDefaultLocation` answers "which branch when none is specified",
 * which is the right answer for an un-branched form and the WRONG one here —
 * it would stamp a real-looking branch onto a conversation nobody has said
 * anything about, indistinguishable afterwards from a signal. A multi-branch
 * org with no ad resolves to NULL, and the caller decides whether to ask.
 *
 * Also not a tier yet: the Meta page. `meta_ads_page` carries no location
 * column, so "this page is the Cork page" is not expressible. It needs a column
 * and somewhere for the owner to set it.
 */
export async function resolveConversationBranch(
  db: DbConnection,
  input: {
    organizationId: string;
    /** `metadata.adInternalId` — the ad the conversation came from, if any. */
    adInternalId?: string | null;
  }
): Promise<string | null> {
  const { organizationId, adInternalId } = input;

  if (adInternalId) {
    const ad = await db.query.metaAd.findFirst({
      where: eq(metaAd.id, adInternalId),
      columns: { metaCampaignId: true },
    });

    if (ad?.metaCampaignId) {
      const config = await db.query.metaCampaignConfig.findFirst({
        // Scoped to the org as well as the campaign: `meta_campaign_id` is
        // globally unique, so without this a corrupt or cross-linked row could
        // hand back another tenant's branch.
        where: and(
          eq(metaCampaignConfig.metaCampaignId, ad.metaCampaignId),
          eq(metaCampaignConfig.organizationId, organizationId)
        ),
        columns: { locationId: true },
      });

      if (config?.locationId) {
        // Belt and braces. A foreign key does NOT enforce tenant isolation —
        // Postgres validates FKs internally, unfiltered by RLS — so the branch
        // being real does not make it OURS.
        const owned = await db.query.organizationLocation.findFirst({
          where: and(
            eq(organizationLocation.id, config.locationId),
            eq(organizationLocation.organizationId, organizationId)
          ),
          columns: { id: true },
        });
        if (owned) return owned.id;
      }
    }
  }

  // `limit: 2` — the question is "is there exactly one", not "list them".
  const locations = await db.query.organizationLocation.findMany({
    where: eq(organizationLocation.organizationId, organizationId),
    columns: { id: true },
    limit: 2,
  });

  return locations.length === 1 ? (locations[0]?.id ?? null) : null;
}
