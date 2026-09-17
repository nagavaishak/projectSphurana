/**
 * Where a campaign's traffic LANDS, and how it is tagged (plan §9.5).
 *
 * TWO RULES, both of which have already been broken elsewhere in this codebase:
 *
 * 1. The host comes from `resolveMicrositeLinkTarget`. NEVER compose a
 *    path-tier URL by hand. A tenant with a live custom domain is paying for
 *    their brand to be the destination; hardcoding `{WEB_URL}/sites/{slug}`
 *    would point their paid traffic at OUR domain, on a host Meta has not
 *    verified for them, and nobody would notice for a month.
 * 2. `utm_campaign` is the Meta campaign ID, never the campaign name — see
 *    `microsites/attribution/utm.ts`. It is the join key that makes CAC
 *    computable from our own database.
 *
 * NOTHING HOST-SHAPED IS PERSISTED HERE. The destination is derived on demand
 * from the tenant's CURRENT primary domain, so a domain move needs no rewrite
 * of anything this file wrote. Ad rows, which do persist a `destination_url`,
 * are handled by the existing
 * `microsites/domain-verification/rewrite-ad-destinations` path; this is the
 * CREATION side and deliberately does not duplicate it.
 */

import { organization } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
// Sibling context through its PUBLIC barrel (the cross-context gate).
import { appendUtmParams, metaCampaignUtm } from '../../../microsites/index.js';
import {
  type DbConnection,
  type MicrositeLinkTarget,
  micrositeBookingBase,
  resolveMicrositeLinkTarget,
} from '../../../shared/index.js';

/**
 * Pure: the tagged destination for one campaign on an already-resolved target.
 *
 * Split from the resolver so tests can pin both tiers without a database.
 */
export const buildCampaignDestinationUrl = (
  target: MicrositeLinkTarget,
  metaCampaignId: string,
  adId?: string
): string =>
  appendUtmParams(
    micrositeBookingBase(target),
    metaCampaignUtm(metaCampaignId, adId)
  );

/**
 * The destination for a campaign, resolved against the org's live host.
 *
 * Returns null when the organization cannot be read — the caller treats that as
 * "no destination", never as a failure: a campaign that exists on Meta must not
 * be rolled back because we could not compute a landing page for it.
 */
export const resolveCampaignDestinationUrl = async (
  db: DbConnection,
  input: { organizationId: string; metaCampaignId: string; adId?: string }
): Promise<string | null> => {
  const org = await db.query.organization.findFirst({
    columns: { id: true, slug: true },
    where: eq(organization.id, input.organizationId),
  });
  if (!org?.slug) return null;

  const target = await resolveMicrositeLinkTarget(db, {
    id: org.id,
    slug: org.slug,
  });
  return buildCampaignDestinationUrl(target, input.metaCampaignId, input.adId);
};

/**
 * Campaigns whose clicks go to a WEBSITE.
 *
 * `chatbot` campaigns open Messenger/WhatsApp and `lead_form` campaigns open an
 * on-ad form — neither takes a URL, and handing one back would invite a caller
 * to set a destination Meta will reject.
 */
export const campaignHasSiteDestination = (followUpType: string): boolean =>
  followUpType !== 'chatbot' && followUpType !== 'lead_form';
