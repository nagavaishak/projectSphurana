import {
  allBranchesPath,
  branchBookingPath,
  branchSegmentFor,
} from '@/components/booking/location-chooser';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { VenueConfig } from '@borradh-workspace/contracts';
import { ClockIcon, MapPinIcon } from 'lucide-react';
import { directionsUrl, formatAddress } from './venue-address';
import { computeVenueStatus } from './venue-hours';

interface VenueBookCardProps {
  venue: VenueConfig;
}

/**
 * The sticky "Book now" card: the venue name, a review placeholder, the primary
 * booking CTA, and the live open/closed status + address. Mirrors the right-rail
 * card in the Fresha design.
 */
export function VenueBookCard({ venue }: VenueBookCardProps) {
  const { organization, location } = venue;
  const status = computeVenueStatus(
    location.openingHours,
    organization.timezone
  );
  const address = formatAddress(location);

  // This page has ALREADY resolved a branch — the name, hours and address
  // above are this branch's. Sending the customer to the org-level `/book`
  // would drop them into the default branch's flow, so they would read Cork's
  // address and then be quoted and booked at Dublin. Carry the branch.
  //
  // `slug ?? id` — every branch is addressable, so there is no fallback to the
  // org-level entry point any more. That fallback used to fire for EVERY
  // branch pre-backfill (slug is nullable), which meant this button silently
  // did the exact thing the comment above says it must not.
  const siteBase = `/sites/${encodeURIComponent(organization.slug)}`;
  const bookHref = `${siteBase}${branchBookingPath(branchSegmentFor(location))}`;

  // Back out to the chooser. A customer who followed an ad to the wrong branch
  // has, until now, had no way to reach the others: the venue page named one
  // address and offered one button.
  const allLocationsHref = `${siteBase}${allBranchesPath()}`;

  return (
    <Card className="space-y-5 p-6">
      <div className="space-y-1">
        <h2 className="font-bold text-2xl leading-tight">
          {location.name ?? organization.name}
        </h2>
        <p className="text-muted-foreground text-sm">No reviews yet</p>
      </div>

      <Button asChild size="lg" className="w-full">
        {/* Booking now lives on the clinic's microsite, which the marketing
            app serves — so this leaves this origin and cannot be a router
            Link. See lib/microsite-url.ts. */}
        <a href={bookHref}>Book now</a>
      </Button>

      {/* Only when there IS somewhere else to go. On a single-branch clinic
          this would offer a chooser that immediately 302s back here — a link
          that looks like a choice and is not one. */}
      {venue.hasOtherLocations ? (
        <Button asChild variant="outline" size="lg" className="w-full">
          <a href={allLocationsHref}>View all locations</a>
        </Button>
      ) : null}

      <div className="space-y-3 border-t pt-4 text-sm">
        <div className="flex items-start gap-2">
          <ClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span
            className={status.isOpen ? 'text-green-600' : 'text-orange-600'}
          >
            {status.label}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">
            {address}{' '}
            <a
              href={directionsUrl(location)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Get directions
            </a>
          </span>
        </div>
      </div>
    </Card>
  );
}
