import { db } from '@borradh-workspace/database';
import { verifyPreviewToken } from '@borradh-workspace/features/microsites';
import type { MicrositeHostTier } from '@borradh-workspace/features/microsites';
import {
  getMicrositeDocument,
  resolveMicrositeHost,
} from '@borradh-workspace/features/microsites';
import { getMetaVerificationToken } from '@borradh-workspace/features/microsites/meta-verification';
import { getOrganization } from '@borradh-workspace/features/organizations';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { getVenueConfig } from '@borradh-workspace/features/venue';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { toMicrositeData } from './microsite-data.js';

/**
 * The two public microsite reads, with logging and Result→HTTP translation.
 *
 * Lives beside the controller rather than in it, exactly like
 * `apps/api/src/venue/resolve-venue-config.ts` — the handlers stay at "call the
 * use case, return it" (Gate 5, controller-thinness). The logging is the point
 * of the file existing: these routes are unauthenticated and serve anonymous
 * visitors, so a bad host or an unpublished site produces no other signal.
 *
 * RLS note: mirrors PublicVenueController — the `db` reference handed to each
 * service is the seam Phase 2 replaces with the `app_public` pool.
 */

const logger = new Logger('PublicMicrositesController');

export interface MicrositeHostQuery {
  host: string;
  path?: string;
}

/**
 * The booking flow is the primary conversion target, so this must never be a
 * dead link.
 *
 * HOST-RELATIVE, deliberately. This URL is rendered INTO the page the visitor
 * is already looking at, so the host is whatever they typed — and a relative
 * path cannot disagree with it. The absolute version did: it was built from
 * `WEB_URL`, which on a preview is the DASHBOARD deployment, so every "Book"
 * button on a preview microsite pointed at an app that has no booking routes
 * and returned 404. It also still used the retired top-level `/book/{slug}`
 * shape, so it was wrong twice, exactly like the venue link before it.
 *
 * The rule this follows: links rendered ON the site are relative; links built
 * OUTSIDE a request — emails, chatbot messages, ad destinations — must be
 * absolute and go through `micrositeBookingBase`, because there is no host to
 * be relative to. Relative is strictly better here: it survives a tenant
 * moving to their own domain with no republish, and it cannot be broken by
 * environment config at all.
 */
const bookingUrlFor = (
  organizationSlug: string,
  tier: MicrositeHostTier
): string =>
  tier === 'path'
    ? `/sites/${encodeURIComponent(organizationSlug)}/book`
    : // On a tenant's own host the org is implied by the hostname. NOTE the
      // top-level `/book` route lands with the wildcard tier — no tenant can
      // reach this branch until then, since no custom domain is active.
      '/book';

export async function resolveMicrositeForHost(query: MicrositeHostQuery) {
  logger.log(`Resolve microsite: host=${query.host} path=${query.path ?? '-'}`);

  const result = await resolveMicrositeHost(db, query);

  if (!result.success) {
    logger.warn(
      `Resolve microsite failed: host=${query.host} ${result.error.code} - ${result.error.message}`
    );
    throw micrositeHttpException(result.error);
  }

  return result.data;
}

export async function resolveMicrositeDocument(
  micrositeId: string,
  query: MicrositeHostQuery & { mode: 'published' | 'draft'; token?: string }
) {
  // A public caller has no session, so an unqualified `draft` would be an open
  // door onto whatever the agent last wrote — including copy the owner has not
  // seen. The documented exception (plan §9) is a SIGNED PREVIEW TOKEN, minted
  // for an owner who was already authorized and bound to this one microsite.
  //
  // `micrositeId` here comes from the ROUTE, never from the token, so a token
  // minted for one tenant cannot be pointed at another tenant's draft.
  if (query.mode === 'draft') {
    if (!verifyPreviewToken(micrositeId, query.token)) {
      logger.warn(
        `Draft refused on the public route: id=${micrositeId} hasToken=${Boolean(query.token)}`
      );
      throw new HttpException(
        'Draft rendering requires a valid preview token',
        HttpStatus.FORBIDDEN
      );
    }
  }

  // HOST IMPLIES ORG (plan §2.2). `getMicrositeDocument` enforces the org
  // boundary and takes an `organizationId` an anonymous visitor cannot supply,
  // so the host resolves it — and the `:micrositeId` in the route is then only
  // an assertion, never the authority.
  const site = await resolveMicrositeForHost(query);
  if (site.micrositeId !== micrositeId) {
    logger.warn(
      `Microsite id does not match host: id=${micrositeId} host=${query.host}`
    );
    throw new HttpException('Microsite not found', HttpStatus.NOT_FOUND);
  }

  return loadPublishedDocument(site, query.host);
}

/**
 * The renderer's ONE call: host → microsite → published document, in a single
 * round trip.
 *
 * The route above resolves the host too — it has to, because the host and not
 * the route id is the org authority — so making the renderer call `/resolve`
 * first bought nothing but a second serial Vercel→Fly hop on a cache miss, and
 * a miss is what an ad campaign's first click pays for. Same work, half the
 * round trips.
 *
 * PUBLISHED ONLY, with no `mode` and no token to get wrong. Draft rendering
 * stays on the id-keyed route, where the signed preview token is checked
 * against an id that came from the route rather than from the host — a narrower
 * surface, kept narrow.
 */
export async function resolveMicrositeDocumentForHost(
  query: MicrositeHostQuery
) {
  const site = await resolveMicrositeForHost(query);
  return loadPublishedDocument(site, query.host);
}

async function loadPublishedDocument(
  site: {
    micrositeId: string;
    organizationId: string;
    // Typed, not `string`: the booking URL's shape depends on it, and a
    // widened type let a bad tier through to the link builder silently.
    tier: MicrositeHostTier;
  },
  host: string
) {
  const { micrositeId } = site;

  logger.log(`Get microsite document: id=${micrositeId} tier=${site.tier}`);

  const [document, organization] = await Promise.all([
    getMicrositeDocument(db, {
      micrositeId,
      organizationId: site.organizationId,
      mode: 'published',
    }),
    // `ResolvedMicrositeHost` carries identifiers only, and `getVenueConfig`
    // keys on the ORG SLUG. See the handover note: adding `organizationSlug` to
    // the resolver's output removes this read entirely.
    getOrganization(db, { id: site.organizationId }),
  ]);

  if (!document.success) {
    logger.warn(
      `Get microsite document failed: ${document.error.code} - ${document.error.message}`
    );
    throw micrositeHttpException(document.error);
  }
  if (!organization.success) {
    logger.warn(
      `Microsite organization lookup failed: ${organization.error.code} - ${organization.error.message}`
    );
    throw micrositeHttpException(organization.error);
  }

  const organizationSlug = organization.data.slug;

  // The live business data the data-bound blocks read. Fetched on every hit and
  // never snapshotted into the revision: a price or hours edit in the dashboard
  // has to show on the website WITHOUT a republish — that is the whole
  // differentiator (plan §5). The edge window in front of this is deliberately
  // short for the same reason; see `_microsite-cache.ts` in marketing-astro.
  const venue = await getVenueConfig(db, { organizationSlug });

  /**
   * META DOMAIN VERIFICATION (plan §9.4) — carried on THIS response rather than
   * fetched by the renderer.
   *
   * The renderer has to put `<meta name="facebook-domain-verify">` in the head
   * of the tenant's custom domain or Meta never verifies it, and an unverified
   * domain makes the pixel near-useless for iOS traffic. It cannot read the
   * database, and a second Vercel→Fly round trip is exactly what collapsing
   * `/resolve` + `/document` into this one call just removed — so it rides
   * along here. One indexed single-column read, never throws, and returns null
   * on `{slug}.borradh.io` (that apex is ours, not the tenant's).
   */
  const metaDomainVerifyToken = await getMetaVerificationToken(db, { host });

  if (!venue.success) {
    logger.warn(
      `Microsite venue data failed: org=${organizationSlug} ${venue.error.code} - ${venue.error.message}`
    );
    throw micrositeHttpException(venue.error);
  }

  return {
    ...document.data,
    organizationId: site.organizationId,
    organizationSlug,
    tier: site.tier,
    metaDomainVerifyToken,
    data: toMicrositeData(
      venue.data,
      bookingUrlFor(organizationSlug, site.tier)
    ),
  };
}

function micrositeHttpException(error: { code: string; message: string }) {
  switch (error.code) {
    case ErrorCodes.VALIDATION_ERROR:
    case ErrorCodes.INVALID_INPUT:
      return new HttpException(error.message, HttpStatus.BAD_REQUEST);
    case ErrorCodes.NOT_FOUND:
      return new HttpException(error.message, HttpStatus.NOT_FOUND);
    case ErrorCodes.FORBIDDEN:
      return new HttpException(error.message, HttpStatus.FORBIDDEN);
    default:
      return new HttpException(
        error.message || 'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
  }
}
