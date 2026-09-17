'use client';

import {
  ChevronRightIcon,
  ClockIcon,
  MapPinIcon,
  UserIcon,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { usePortalLink } from './api/portal-provider';
import type { PatientBooking } from './api/types';
import { PortalStatusBadge } from './portal-status-badge';
import { relativeDayLabel, timeInTz } from './portal-time';
import { serviceIcon } from './service-icon';

export function PortalBookingCard({
  booking,
  timezone,
  isPast = false,
}: {
  booking: PatientBooking;
  timezone: string;
  isPast?: boolean;
}) {
  const Icon = serviceIcon(booking.serviceName);
  // TanStack's <Link to params={{organizationSlug, appointmentId}}> becomes a
  // plain anchor whose href is built from the resolved context, so it is
  // correct on the path tier today and on a tenant host later.
  const link = usePortalLink();
  const branchLabel =
    booking.location?.name ?? booking.location?.addressLines[0] ?? null;

  return (
    <a
      href={link(`/bookings/${booking.id}`)}
      className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Card
        className={cn(
          'transition-colors hover:bg-accent/50',
          isPast && 'opacity-60'
        )}
      >
        <CardContent className="flex items-center gap-3 px-4 py-4">
          <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Icon className="text-muted-foreground size-5" aria-hidden />
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate font-semibold">{booking.serviceName}</p>
            <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <ClockIcon className="size-3.5 shrink-0" aria-hidden />
              <span>
                {relativeDayLabel(booking.startTime, timezone)} ·{' '}
                {timeInTz(booking.startTime, timezone)}
              </span>
            </p>
            {booking.practitionerName && (
              <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
                <UserIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{booking.practitionerName}</span>
              </p>
            )}
            {/* WHICH BRANCH. One line only — the card is a summary; the detail
                page prints the full address. Falls back to the first address
                line for the many branches nobody bothered to name, and shows
                nothing at all when the booking carries no branch. */}
            {branchLabel && (
              <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
                <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{branchLabel}</span>
              </p>
            )}
          </div>

          <PortalStatusBadge status={booking.status} />
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </a>
  );
}

/** Skeleton matched to the card shape above. */
export function PortalBookingCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 px-4 py-4">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </CardContent>
    </Card>
  );
}
