'use client';

import {
  ArrowLeftIcon,
  CalendarIcon,
  CalendarX2Icon,
  ClockIcon,
  MapPinIcon,
  UserIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

import { useCancelPatientBooking } from '../api/cancel-patient-booking.hook';
import { useListPatientBookings } from '../api/list-patient-bookings.hook';
import { PortalProvider, usePortalLink } from '../api/portal-provider';
import { useReschedulePatientBooking } from '../api/reschedule-patient-booking.hook';
import { ACTIONABLE_BOOKING_STATUSES, type PatientBooking } from '../api/types';
import { PortalAuthGate } from '../portal-auth-gate';
import type { PortalContext } from '../portal-context';
import { PortalStatusBadge } from '../portal-status-badge';
import { longDateInTz, shortDateTimeInTz, timeInTz } from '../portal-time';
import { ReschedulePicker } from '../reschedule-picker';
import { serviceIcon } from '../service-icon';
import { ConfirmDialog } from '../ui/confirm-dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../ui/empty';

const DetailSkeleton = (
  <div className="flex flex-col gap-4">
    <Skeleton className="h-5 w-40" />
    <Skeleton className="h-44 w-full rounded-xl" />
    <div className="flex gap-2">
      <Skeleton className="h-9 flex-1" />
      <Skeleton className="h-9 flex-1" />
    </div>
  </div>
);

function BackToBookings() {
  const link = usePortalLink();
  return (
    <a
      href={link()}
      className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      Back to your bookings
    </a>
  );
}

function BookingDetail({ appointmentId }: { appointmentId: string }) {
  const { upcoming, past, timezone, isLoading, isError, refetch } =
    useListPatientBookings();
  const link = usePortalLink();

  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);

  const { cancelBooking, isCancelling } = useCancelPatientBooking({
    onSuccess: () => setIsCancelOpen(false),
  });
  const { rescheduleBooking, isRescheduling } = useReschedulePatientBooking({
    onSuccess: () => setIsRescheduleOpen(false),
  });

  if (isLoading) return DetailSkeleton;

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <BackToBookings />
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <CalendarX2Icon />
            </EmptyMedia>
            <EmptyTitle>Couldn't load this booking</EmptyTitle>
            <EmptyDescription>Please try again.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const booking: PatientBooking | undefined = [...upcoming, ...past].find(
    (candidate) => candidate.id === appointmentId
  );

  if (!booking) {
    return (
      <div className="flex flex-col gap-4">
        <BackToBookings />
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <CalendarX2Icon />
            </EmptyMedia>
            <EmptyTitle>Booking not found</EmptyTitle>
            <EmptyDescription>
              This booking doesn't exist or is no longer available.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" asChild>
              <a href={link()}>Back to your bookings</a>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const isUpcoming = new Date(booking.startTime).getTime() > Date.now();
  const isActionable =
    isUpcoming && ACTIONABLE_BOOKING_STATUSES.has(booking.status);
  const Icon = serviceIcon(booking.serviceName);

  // Server-computed cancellation policy — absent fields mean "allowed"
  // (additive contract; a response without them stays valid).
  const canCancel = booking.canCancel ?? true;
  const canReschedule = booking.canReschedule ?? true;
  const cancelDeadline = booking.cancelDeadline ?? null;
  const cancelDeadlinePassed =
    cancelDeadline !== null && new Date(cancelDeadline).getTime() <= Date.now();
  const canRescheduleOnline = !!booking.serviceId && canReschedule;

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <BackToBookings />

      <Card>
        <CardContent className="flex flex-col gap-5 px-6">
          <div className="flex items-start gap-3">
            <div className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-xl">
              <Icon className="text-muted-foreground size-6" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <h1 className="text-lg font-semibold leading-tight">
                {booking.serviceName}
              </h1>
              <PortalStatusBadge status={booking.status} />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t pt-4">
            <div className="flex items-center gap-3 text-sm">
              <CalendarIcon
                className="size-5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>{longDateInTz(booking.startTime, timezone)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <ClockIcon
                className="size-5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>
                {timeInTz(booking.startTime, timezone)} (
                {booking.durationMinutes} minutes)
              </span>
            </div>
            {booking.practitionerName && (
              <div className="flex items-center gap-3 text-sm">
                <UserIcon
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span>{booking.practitionerName}</span>
              </div>
            )}
            {/* WHERE. A multi-branch clinic's portal is branded from the
                org-level config, i.e. the primary branch — so without this the
                page silently reads as Dublin for a Cork booking. Rendered only
                when the server actually knows the branch: no branch shows
                nothing, never a guess the patient would drive to. */}
            {booking.location &&
              (booking.location.name ||
                booking.location.addressLines.length > 0) && (
                <div className="flex items-start gap-3 text-sm">
                  <MapPinIcon
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    {booking.location.name && (
                      <span className="block font-medium">
                        {booking.location.name}
                      </span>
                    )}
                    {booking.location.addressLines.map((line) => (
                      <span key={line} className="block text-muted-foreground">
                        {line}
                      </span>
                    ))}
                  </span>
                </div>
              )}
          </div>
        </CardContent>
      </Card>

      {isActionable && (
        <div className="flex flex-col gap-2">
          {(canRescheduleOnline || canCancel) && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {canRescheduleOnline && (
                <Button
                  className="flex-1"
                  onClick={() => setIsRescheduleOpen(true)}
                >
                  Reschedule
                </Button>
              )}
              {canCancel && (
                <Button
                  className="flex-1"
                  variant="outline"
                  onClick={() => setIsCancelOpen(true)}
                >
                  Cancel booking
                </Button>
              )}
            </div>
          )}

          {canCancel && cancelDeadline && !cancelDeadlinePassed && (
            <p className="text-muted-foreground text-xs">
              Free to cancel until {shortDateTimeInTz(cancelDeadline, timezone)}
              .
            </p>
          )}

          {!booking.serviceId ? (
            <p className="text-muted-foreground text-xs">
              This booking can't be moved online — please contact the clinic.
            </p>
          ) : (
            !canReschedule && (
              <p className="text-muted-foreground text-xs">
                To reschedule, contact the clinic.
              </p>
            )
          )}

          {!canCancel && (
            <p className="text-muted-foreground text-xs">
              {cancelDeadlinePassed
                ? "It's too close to your appointment to cancel online — contact the clinic."
                : 'To cancel, contact the clinic.'}
            </p>
          )}
        </div>
      )}

      {/* Reschedule — contained picker, same slots endpoint as the public
          booking page. The DialogContent is a bounded flex column: fixed
          header, scrolling body, fixed confirm footer (see ReschedulePicker). */}
      <Dialog open={isRescheduleOpen} onOpenChange={setIsRescheduleOpen}>
        <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
          <DialogHeader className="shrink-0 px-5 pt-5 pb-4 text-left">
            <DialogTitle>Choose a new time</DialogTitle>
            <DialogDescription>
              Your {booking.durationMinutes} minute {booking.serviceName}
              {' — '}pick from the clinic's available times.
            </DialogDescription>
          </DialogHeader>
          {booking.serviceId && (
            <ReschedulePicker
              serviceId={booking.serviceId}
              // `slug ?? id` — the public endpoints accept either, and slug
              // is nullable until the backfill runs. Falling back to the id
              // is what lets a slug-less branch be rescheduled at all.
              locationSlug={
                booking.location?.slug ?? booking.location?.id ?? undefined
              }
              timezone={timezone}
              isSubmitting={isRescheduling}
              onCancel={() => setIsRescheduleOpen(false)}
              onConfirm={(slot) => {
                if (isRescheduling) return;
                rescheduleBooking({
                  appointmentId: booking.id,
                  startTime: new Date(slot.startTime).toISOString(),
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={isCancelOpen}
        onOpenChange={setIsCancelOpen}
        title="Cancel this booking?"
        description={`This will cancel your ${booking.serviceName} appointment on ${longDateInTz(
          booking.startTime,
          timezone
        )} at ${timeInTz(booking.startTime, timezone)}. If you change your mind you'll need to book again.`}
        cancelLabel="Keep booking"
        confirmLabel={isCancelling ? 'Cancelling…' : 'Cancel booking'}
        isConfirming={isCancelling}
        // Deliberately does NOT close the dialog here — it closes from the
        // mutation's onSuccess, so a failed cancel keeps the dialog (and the
        // error toast) in front of the customer.
        onConfirm={() => cancelBooking({ appointmentId: booking.id })}
      />
    </div>
  );
}

export function PortalBookingDetailIsland({
  ctx,
  appointmentId,
}: {
  ctx: PortalContext;
  appointmentId: string;
}) {
  return (
    <PortalProvider ctx={ctx}>
      <PortalAuthGate
        skeleton={DetailSkeleton}
        errorIcon={<CalendarX2Icon />}
        errorTitle="Something went wrong"
        errorDescription="We couldn't load your booking. Please try again."
      >
        {() => <BookingDetail appointmentId={appointmentId} />}
      </PortalAuthGate>
    </PortalProvider>
  );
}
