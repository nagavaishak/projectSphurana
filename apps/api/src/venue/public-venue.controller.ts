import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { resolveVenueConfig } from './resolve-venue-config.js';

/**
 * Public (unauthenticated) venue page route.
 *
 * RLS note: mirrors PublicBookingController — the `db` reference passed to the
 * service is the seam that Phase 2 replaces with the `app_public`-pool
 * connection, which is why `withPublicOrgScope` inside the service receives
 * `{ db }`. See apps/api/src/booking-forms/public-booking.controller.ts.
 *
 * Rate limiting: the global FlyThrottlerGuard keys on the real client IP; the
 * per-route @Throttle below is what actually bounds abuse.
 *
 * Lookup, logging and Result→HTTP translation live in `resolve-venue-config.ts`
 * so both routes share one copy and the handlers stay at "call the use case,
 * return it" (Gate 5).
 */
@Controller('public/venue')
export class PublicVenueController {
  // Recomputes brand/venue/photos/services/team on each hit; bound per-IP like
  // the public booking config route. No locationSlug → the org's PRIMARY venue.
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(':organizationSlug')
  async getVenue(@Param('organizationSlug') organizationSlug: string) {
    return resolveVenueConfig(organizationSlug);
  }

  // A specific branch by its per-location slug.
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(':organizationSlug/:locationSlug')
  async getVenueForLocation(
    @Param('organizationSlug') organizationSlug: string,
    @Param('locationSlug') locationSlug: string
  ) {
    return resolveVenueConfig(organizationSlug, locationSlug);
  }
}
