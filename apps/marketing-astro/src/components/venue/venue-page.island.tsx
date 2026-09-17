'use client';

import { BookingProviders } from '@/components/providers/booking-providers';

import { VenueContent } from './venue-content';

/**
 * The public venue page, as one hydrated island.
 *
 * Reuses `BookingProviders` rather than declaring a second QueryClient: this
 * page is a sibling of the booking flow, wants the same cache defaults, and a
 * second provider would mean two caches for one origin.
 */
export function VenuePageIsland({
  organizationSlug,
  locationSlug,
}: {
  organizationSlug: string;
  locationSlug?: string;
}) {
  return (
    <BookingProviders>
      <VenueContent
        organizationSlug={organizationSlug}
        locationSlug={locationSlug}
      />
    </BookingProviders>
  );
}
