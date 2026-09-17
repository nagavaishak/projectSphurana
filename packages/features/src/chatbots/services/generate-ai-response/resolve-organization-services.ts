import { metaAd, organizationService } from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { formatServicePrice } from '@borradh-workspace/labels';
import { createLogger } from '@borradh-workspace/observability';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import {
  serviceDepositCents,
  toBookingPaymentDefaults,
  toBookingPaymentService,
} from '../../../booking-forms/index.js';
import {
  applyServiceLocationOverride,
  loadServiceLocationOverrides,
} from '../../../shared/index.js';
import { micrositeServiceBookingUrl } from '../../../shared/index.js';
import type { MicrositeLinkTarget } from '../../../shared/index.js';
import { currencyForCountry } from '../../../shared/index.js';
import type { DbConnection } from '../../../shared/index.js';

const logger = createLogger('ResolveOrgServices');

export interface ResolvedService {
  name: string;
  pricingDescription: string | null | undefined;
  bookingFormUrl: string | null;
  requiresDeposit: boolean;
  /**
   * What this service's deposit ACTUALLY comes to, resolved through the same
   * `serviceDepositCents` the booking charges from — so a percentage deposit is
   * already applied and rounded, and the figure Claire quotes is the figure the
   * customer is asked for. Null means nothing is due online for this service.
   *
   * Previously Claire read raw `depositAmountCents` while the booking ran its
   * own chain, which is how she could quote €50 against a €100 charge.
   */
  depositCents: number | null;
  appointmentDuration: number | null;
  description: string | null;
}

/**
 * Resolve organization services with 3-tier fallback:
 * 1. Ad-specific services (if conversation has ad referral metadata)
 * 2. Page-level ad services (if page has active click-to-message ads with linked services)
 * 3. All active org services
 *
 * Generates booking URLs. Branch-scoped (`/l/{branch}/book/{serviceId}`) when
 * the conversation has a branch; otherwise the org-level form, which lands on
 * the chooser.
 */
export async function resolveOrganizationServices(
  db: DbConnection,
  input: {
    organizationId: string;
    orgSlug: string | null;
    convMetadata: ConversationMetadata | null;
    primaryCalendarType: string | null;
    defaultBookingLink: string | null;
    metaAdsPageId?: string | null;
    /** Org country → currency symbol for the derived price string. */
    orgCountry?: string | null;
    /**
     * The org's LIVE primary custom domain, or null for the path tier —
     * resolved ONCE by the caller (`resolveMicrositeLinkTarget`) because this
     * runs per chatbot turn and the per-service URLs below are a loop.
     * Required, not optional: a new caller that forgets it should not silently
     * quote our domain to a tenant's customers.
     */
    micrositePrimaryDomain: string | null;
    /**
     * The BRANCH this conversation is about, when one is known.
     *
     * Null for a multi-branch org that has told us nothing — quote the org's
     * own prices rather than guessing a branch's.
     */
    locationId?: string | null;
    /**
     * The same branch, as it is NAMED in a URL (`slug ?? id`).
     *
     * Separate from `locationId` because they are used for different things
     * and one can be present without the other being useful: `locationId`
     * picks the price override, this goes in the link. The caller resolves it
     * from the branch row it has already loaded rather than making this
     * function query for a slug it would otherwise never need.
     *
     * Null → a branch-less link, which lands on the chooser. Safe, but it
     * asks the customer a question we may already have the answer to.
     */
    branchSegment?: string | null;
    /**
     * The org row, for resolving each service's deposit exactly as the booking
     * flow will. Passed in rather than re-queried: the caller already has it.
     */
    org: Parameters<typeof toBookingPaymentDefaults>[0];
  }
): Promise<{
  services: ResolvedService[];
  rawServices: (typeof organizationService.$inferSelect)[];
}> {
  const { organizationId, orgSlug, convMetadata } = input;

  let resolvedServices: (typeof organizationService.$inferSelect)[] = [];

  // Tier 1: Ad-specific services (from referral metadata)
  if (convMetadata?.adInternalId) {
    logger.info('Tier 1: Looking up ad-specific services', {
      adInternalId: convMetadata.adInternalId,
      adMetaId: convMetadata.adMetaId,
    });
    const specificAd = await db.query.metaAd.findFirst({
      where: eq(metaAd.id, convMetadata.adInternalId),
      with: { services: { with: { service: true } } },
    });
    if (specificAd) {
      resolvedServices = specificAd.services
        .map((s) => s.service)
        .filter((s): s is NonNullable<typeof s> => s !== null);
      logger.info('Tier 1: Found ad-specific services', {
        adInternalId: convMetadata.adInternalId,
        serviceCount: resolvedServices.length,
        serviceNames: resolvedServices.map((s) => s.name),
      });
    } else {
      logger.warn('Tier 1: Ad not found in database', {
        adInternalId: convMetadata.adInternalId,
      });
    }
  }

  // Tier 2: Page-level ad services (Meta doesn't reliably send referral data,
  // so check if the page has active click-to-message ads with linked services)
  if (resolvedServices.length === 0 && input.metaAdsPageId) {
    const activePageAds = await db.query.metaAd.findMany({
      where: and(
        eq(metaAd.metaAdsPageId, input.metaAdsPageId),
        eq(metaAd.status, 'active'),
        isNotNull(metaAd.metaAdId)
      ),
      with: { services: { with: { service: true } } },
    });

    // Collect unique services from all active ads on this page
    const serviceMap = new Map<
      string,
      typeof organizationService.$inferSelect
    >();
    for (const ad of activePageAds) {
      for (const junction of ad.services) {
        if (junction.service) {
          serviceMap.set(junction.service.id, junction.service);
        }
      }
    }
    resolvedServices = [...serviceMap.values()];

    if (resolvedServices.length > 0) {
      logger.info('Tier 2: Found page-level ad services', {
        metaAdsPageId: input.metaAdsPageId,
        activeAdCount: activePageAds.length,
        serviceCount: resolvedServices.length,
        serviceNames: resolvedServices.map((s) => s.name),
      });
    } else {
      logger.info('Tier 2: No page-level ad services found', {
        metaAdsPageId: input.metaAdsPageId,
        activeAdCount: activePageAds.length,
      });
    }
  }

  // Tier 3: All active org services
  if (resolvedServices.length === 0) {
    resolvedServices = await db.query.organizationService.findMany({
      where: and(
        eq(organizationService.organizationId, organizationId),
        eq(organizationService.isActive, true)
      ),
      orderBy: [asc(organizationService.sortOrder)],
    });
    logger.info('Tier 3: Using all org services (fallback)', {
      organizationId,
      serviceCount: resolvedServices.length,
    });
  }

  // Build per-service Borradh booking URLs only when using Borradh calendar.
  // When using an external system, services get no per-service URL so the
  // defaultBookingLink is used instead in clinic-data-builder.
  const webUrl = apiEnv.WEB_URL;
  const useBorradhUrls = input.primaryCalendarType === 'borradh';
  // The host these per-service links sit on, decided once for the whole loop.
  const linkTarget: MicrositeLinkTarget | null = orgSlug
    ? { organizationSlug: orgSlug, primaryDomain: input.micrositePrimaryDomain }
    : null;
  // Derive the customer-facing price from the STRUCTURED model (priceType +
  // priceCents), not the retiring freeform `priceText`. `formatServicePrice`
  // is the single canonical price string used by every other surface, so the
  // bot now quotes exactly what the booking widget / venue page show. Currency
  // symbol comes from the org's country.
  const currencySymbol = currencyForCountry(input.orgCountry).symbol;

  // Per-branch prices, applied BEFORE anything reads a number off these rows.
  //
  // Order matters and is the whole point: `serviceDepositCents` below computes
  // a PERCENTAGE deposit from the service's price, so applying the override
  // after it would quote the branch's price and charge a deposit derived from
  // the org's — the exact quote/charge split that
  // `shared/service-location-pricing.ts` was written to stop.
  //
  // A no-op when `locationId` is null (the loader returns an empty map), so a
  // conversation with no branch behaves exactly as before.
  const priceOverrides = await loadServiceLocationOverrides(db, {
    serviceIds: resolvedServices.map((s) => s.id),
    locationId: input.locationId ?? undefined,
  });
  resolvedServices = resolvedServices.map((s) =>
    applyServiceLocationOverride(s, priceOverrides.get(s.id))
  );

  // Each service's deposit resolves exactly as the booking flow will resolve
  // it — org defaults, inheritance and all.
  const paymentDefaults = toBookingPaymentDefaults(input.org);

  const services: ResolvedService[] = resolvedServices.map((s) => ({
    name: s.name,
    pricingDescription: formatServicePrice({
      priceType: s.priceType,
      priceCents: s.priceCents,
      currencySymbol,
    }),
    bookingFormUrl:
      // A tenant on their own host needs no WEB_URL at all; the path tier
      // still does.
      useBorradhUrls && linkTarget && (webUrl || linkTarget.primaryDomain)
        ? micrositeServiceBookingUrl(linkTarget, s.id, input.branchSegment)
        : null,
    requiresDeposit: s.requiresDeposit,
    depositCents: serviceDepositCents(
      toBookingPaymentService(s),
      paymentDefaults
    ),
    appointmentDuration: s.appointmentDuration,
    description: s.description,
  }));

  return { services, rawServices: resolvedServices };
}
