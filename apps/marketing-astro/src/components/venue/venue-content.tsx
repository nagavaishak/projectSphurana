import { branchSegmentFor } from '@/components/booking/location-chooser';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPinIcon } from 'lucide-react';
import { useGetVenueConfig } from './use-venue-config';
import { VenueAbout } from './venue-about';
import { directionsUrl, formatShortAddress } from './venue-address';
import { VenueBookCard } from './venue-book-card';
import { VenueGallery } from './venue-gallery';
import { computeVenueStatus } from './venue-hours';
import { VenueServices } from './venue-services';
import { VenueTeam } from './venue-team';

interface VenueContentProps {
  organizationSlug: string;
  locationSlug?: string;
}

/**
 * The public venue page — a Fresha-style shopfront for one location.
 *
 * Everything time-related renders in the ORG's timezone, and the page is
 * public + indexable (no auth, no noindex). A missing venue is a calm
 * "not found" screen, not an error page.
 */
export function VenueContent({
  organizationSlug,
  locationSlug,
}: VenueContentProps) {
  const { venue, isLoading, isError } = useGetVenueConfig(
    organizationSlug,
    locationSlug
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-5 w-96" />
        <Skeleton className="aspect-[2/1] w-full rounded-2xl" />
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (isError || !venue) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardHeader>
            <CardTitle>Venue not found</CardTitle>
            <CardDescription>
              We couldn&apos;t find this venue. The link may be wrong, or the
              venue may no longer be listed.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { organization, location } = venue;
  const venueName = location.name ?? organization.name;
  const status = computeVenueStatus(
    location.openingHours,
    organization.timezone
  );
  const shortAddress = formatShortAddress(location);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="font-bold text-4xl">{venueName}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm">
          <span>No reviews yet</span>
          <span aria-hidden>·</span>
          <span
            className={status.isOpen ? 'text-green-600' : 'text-orange-600'}
          >
            {status.label}
          </span>
          {shortAddress && (
            <>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1">
                <MapPinIcon className="size-4" />
                {shortAddress}
              </span>
            </>
          )}
          <a
            href={directionsUrl(location)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Get directions
          </a>
        </div>
      </header>

      {venue.photos.length > 0 && (
        <VenueGallery photos={venue.photos} venueName={venueName} />
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
        <div className="space-y-12">
          <VenueServices
            organizationSlug={organization.slug}
            branchSegment={branchSegmentFor(venue.location)}
            services={venue.services}
            currencySymbol={venue.currency.symbol}
          />
          <VenueTeam team={venue.team} />
          <VenueAbout venue={venue} />
        </div>

        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <VenueBookCard venue={venue} />
        </aside>
      </div>
    </div>
  );
}
