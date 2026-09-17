/**
 * The org context a microsite is provisioned from.
 *
 * READ PATH: `getVenueConfig` (packages/features/src/venue/services/get-venue-config).
 * It is already the page-shaped public read — org identity, one location with
 * address, geo and standing hours, active services with structured pricing,
 * active practitioners, and the photo gallery. Plan §5 is explicit that the
 * two public endpoints already run their own inline queries and that composing
 * the internal list services here would create a THIRD way to read the same
 * data, so this reuses the richer one rather than adding queries.
 *
 * What lands in the context is deliberately thin: names and COUNTS, plus a few
 * booleans that decide which blocks a page gets. Nothing here is persisted
 * into block props — the blocks that show services, team, hours and the map
 * are data-bound and hold a query. This context exists to (a) choose blocks
 * and (b) give the copy model something concrete to write about.
 */

import { type Database, organization } from '@borradh-workspace/database';
import { createLogger } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
// Imported from the DEFINING module rather than its barrel so tests can drive
// it with a restored `vi.spyOn` (the features suite runs `isolate: false`, so
// `vi.mock` on an internal module leaks across files).
// Through the venue context's PUBLIC barrel, not a deep path into its
// internals — the cross-context architecture gate enforces this, and a deep
// import couples us to a sibling domain's file layout.
import { getVenueConfig } from '../../../venue/index.js';

const logger = createLogger('ProvisionMicrosite');

export interface MicrositeOrgContext {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  /** Primary location, when the org has one. Used to SCOPE data-bound blocks. */
  locationId: string | null;
  city: string | null;
  /** Names only, and capped — prompt material, never page content. */
  serviceNames: string[];
  serviceCount: number;
  practitionerCount: number;
  hasOpeningHours: boolean;
  hasPhotos: boolean;
}

/** Enough service names to characterise the business without bloating the prompt. */
const MAX_PROMPT_SERVICES = 12;

export const gatherOrgContext = async (
  db: Database,
  organizationId: string
): Promise<Result<MicrositeOrgContext>> => {
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { id: true, name: true, slug: true },
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  const base: MicrositeOrgContext = {
    organizationId: org.id,
    organizationName: org.name,
    organizationSlug: org.slug,
    locationId: null,
    city: null,
    serviceNames: [],
    serviceCount: 0,
    practitionerCount: 0,
    hasOpeningHours: false,
    hasPhotos: false,
  };

  // A brand-new org may have no location yet, and `getVenueConfig` NOT_FOUNDs
  // on that. Provisioning must still produce a site: a page set with a hero, an
  // about section and a booking CTA is a perfectly good day-one website, and
  // the data-bound blocks fill themselves in the moment the org adds a
  // location. Degrade, never fail.
  const venue = await getVenueConfig(db, { organizationSlug: org.slug });
  if (!venue.success) {
    logger.warn('Venue config unavailable; provisioning a minimal site', {
      event: 'microsites.venue_context_unavailable',
      organizationId,
      reason: venue.error.message,
    });
    return ok(base);
  }

  const { location, services, team, photos } = venue.data;

  return ok({
    ...base,
    organizationName: venue.data.organization.name || org.name,
    locationId: location.id,
    city: location.city || null,
    serviceNames: services.slice(0, MAX_PROMPT_SERVICES).map((s) => s.name),
    serviceCount: services.length,
    practitionerCount: team.length,
    hasOpeningHours: Object.keys(location.openingHours ?? {}).length > 0,
    hasPhotos: photos.length > 0,
  });
};
