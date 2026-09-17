'use client';

import {
  AlertCircleIcon,
  CalendarIcon,
  ClockIcon,
  MapPinIcon,
  UserIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

import {
  useCancelManagedBooking,
  useGetManagedBooking,
  useRescheduleManagedBooking,
} from './api';
import { GeneralDateTimePicker } from './general-datetime-picker';
import { longDateDayFirstInTz, time24InTz } from './wizard-time';

interface ManageBookingContentProps {
  /** Resolved by the Astro page and passed in — never parsed from the URL. */
  organizationSlug: string;
  token: string;
}

/**
 * A notice box. apps/app uses `@/components/ui/alert`, which this app has no
 * copy of; rather than add a shared UI primitive from inside a feature port,
 * the same markup lives here. `role="alert"` is the part that matters.
 */
function Notice({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'destructive';
}) {
  return (
    <div
      role="alert"
      className={
        tone === 'destructive'
          ? 'flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm'
          : 'flex items-start gap-3 rounded-lg border p-4 text-sm'
      }
    >
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>{children}</div>
    </div>
  );
}

/**
 * The page a patient lands on from the link in their confirmation email.
 *
 * Times are rendered in the ORG's timezone, not the browser's. A clinic in
 * Dublin booking a patient who opens the email in Spain must still show the
 * Dublin time they agreed to — otherwise the email says 10:00 and the page says
 * 11:00, and the patient turns up an hour late.
 */
export function ManageBookingContent({
  organizationSlug,
  token,
}: ManageBookingContentProps) {
  const { booking, isLoading, isError, refetch } = useGetManagedBooking(
    organizationSlug,
    token
  );

  const [isReschedulingOpen, setIsReschedulingOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const { cancelBooking, isCancelling } = useCancelManagedBooking(
    organizationSlug,
    token,
    {
      onSuccess: () => {
        setIsCancelOpen(false);
        refetch();
      },
    }
  );

  const { rescheduleBooking, isRescheduling } = useRescheduleManagedBooking(
    organizationSlug,
    token,
    {
      onSuccess: () => {
        setIsReschedulingOpen(false);
        refetch();
      },
    }
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // A dead link is the steady state for old emails, so this is a normal screen,
  // not an error state. Say what happened and give them a way forward.
  if (isError || !booking) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card>
          <CardHeader>
            <CardTitle>This link is no longer valid</CardTitle>
            <CardDescription>
              It may have expired, or the booking may already have been
              cancelled. Please contact the clinic if you need to make a change.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const tz = booking.organization.timezone;
  // The server decides whether the picker may open: it knows whether this
  // booking's branch can be named to the slots endpoint. Falling back to the
  // old `!!serviceId` rule keeps an older API working.
  const canRescheduleOnline =
    booking.canRescheduleOnline ?? !!booking.serviceId;
  const branch = booking.location ?? null;
  const formattedDate = longDateDayFirstInTz(booking.startDate, tz);
  const formattedTime = time24InTz(booking.startDate, tz);

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="font-bold text-2xl">Your booking</h1>
        <p className="text-muted-foreground text-sm">
          {booking.organization.name}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>{booking.serviceName ?? booking.title}</span>
            {!booking.isActionable && (
              <Badge variant="secondary">{booking.status}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CalendarIcon className="size-4 text-muted-foreground" />
            <span>{formattedDate}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <ClockIcon className="size-4 text-muted-foreground" />
            <span>
              {formattedTime} ({booking.durationMinutes} minutes)
            </span>
          </div>
          {booking.practitionerName && (
            <div className="flex items-center gap-2 text-sm">
              <UserIcon className="size-4 text-muted-foreground" />
              <span>{booking.practitionerName}</span>
            </div>
          )}
          {/* WHERE. The header above names the ORG; for a multi-branch clinic
              that is not an address anyone can drive to. Shown only when the
              server knows the branch — a booking with no branch shows nothing
              rather than the primary one's address. */}
          {branch && (branch.name || branch.addressLines.length > 0) && (
            <div className="flex items-start gap-2 text-sm">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                {branch.name && (
                  <span className="block font-medium">{branch.name}</span>
                )}
                {branch.addressLines.map((line) => (
                  <span key={line} className="block text-muted-foreground">
                    {line}
                  </span>
                ))}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {booking.isActionable ? (
        <>
          {/* Tell them the cost of acting BEFORE they act, not after. */}
          {!booking.policy.isWithinFreeWindow && (
            <Notice>
              {booking.policy.lateFeeCents
                ? `This booking is within ${booking.policy.noticeRequiredHours} hours. Cancelling or moving it now may incur a €${(booking.policy.lateFeeCents / 100).toFixed(2)} fee.`
                : `This booking is within ${booking.policy.noticeRequiredHours} hours. Please contact the clinic if you need to make a change.`}
            </Notice>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="flex-1"
              onClick={() => setIsReschedulingOpen(true)}
              disabled={!canRescheduleOnline}
            >
              Reschedule
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              onClick={() => setIsCancelOpen(true)}
            >
              Cancel booking
            </Button>
          </div>

          {!canRescheduleOnline && (
            <p className="text-muted-foreground text-xs">
              This booking can't be moved online — please contact the clinic.
            </p>
          )}
        </>
      ) : (
        <Notice>
          This booking is {booking.status} and can no longer be changed.
        </Notice>
      )}

      {/* Reschedule — reuses the SAME picker as the booking page, so the slots
          offered here are exactly the slots that page would offer. */}
      <Dialog open={isReschedulingOpen} onOpenChange={setIsReschedulingOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pick a new time</DialogTitle>
            <DialogDescription>
              Choose from the times {booking.organization.name} has available.
            </DialogDescription>
          </DialogHeader>

          {canRescheduleOnline && booking.serviceId && (
            <GeneralDateTimePicker
              organizationSlug={organizationSlug}
              serviceId={booking.serviceId}
              // The branch the booking is ALREADY on, so the times offered come
              // from that diary. Undefined only where it is provably harmless:
              // the server sets `canRescheduleOnline` false whenever omitting
              // the slug would resolve a different branch.
              locationSlug={branch?.slug ?? undefined}
              appointmentDuration={booking.durationMinutes}
              timezone={tz}
              onBack={() => setIsReschedulingOpen(false)}
              onConfirm={(slot) => {
                if (isRescheduling) return;
                rescheduleBooking({
                  startDate: new Date(slot.startTime).toISOString(),
                });
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this booking?</DialogTitle>
            <DialogDescription>
              {booking.policy.isWithinFreeWindow
                ? 'You can cancel this booking free of charge.'
                : booking.policy.lateFeeCents
                  ? `A €${(booking.policy.lateFeeCents / 100).toFixed(2)} late cancellation fee may apply.`
                  : 'This is a late cancellation.'}
            </DialogDescription>
          </DialogHeader>

          <Textarea
            placeholder="Let the clinic know why (optional)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            maxLength={500}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCancelOpen(false)}>
              Keep booking
            </Button>
            <Button
              variant="destructive"
              disabled={isCancelling}
              onClick={() =>
                cancelBooking({ reason: cancelReason.trim() || undefined })
              }
            >
              {isCancelling ? 'Cancelling…' : 'Cancel booking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
