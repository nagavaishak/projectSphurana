'use client';

import {
  CalendarClockIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileSignatureIcon,
  FolderClosedIcon,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useGetOrgBranding } from '../api/get-org-branding.hook';
import { useListPatientBookings } from '../api/list-patient-bookings.hook';
import { useListPendingForms } from '../api/list-pending-forms.hook';
import {
  PortalProvider,
  useBookingLink,
  usePortalLink,
} from '../api/portal-provider';
import { PortalAuthGate } from '../portal-auth-gate';
import {
  PortalBookingCard,
  PortalBookingCardSkeleton,
} from '../portal-booking-card';
import type { PortalContext } from '../portal-context';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../ui/empty';

function GreetingHeader({ firstName }: { firstName: string }) {
  const { branding } = useGetOrgBranding();
  const clinicName = branding?.organizationName ?? 'your clinic';

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Hi {firstName}
      </h1>
      <p className="text-sm text-muted-foreground">
        Here's everything for your care at {clinicName}.
      </p>
    </div>
  );
}

/**
 * The clinic's note to this customer, from `lead.portalNote`.
 *
 * This is NEVER `lead.notes` — that column holds staff-internal commentary.
 * Renders nothing when there is no note, so the page is unchanged for the
 * overwhelming majority of customers who don't have one.
 */
function ClinicNoteCard({ note }: { note: string | null }) {
  const trimmed = note?.trim();
  if (!trimmed) return null;

  return (
    <section
      aria-labelledby="clinic-note-heading"
      className="rounded-xl border bg-card p-4"
    >
      <h2
        id="clinic-note-heading"
        className="text-muted-foreground text-xs font-medium uppercase tracking-wide"
      >
        A note from your clinic
      </h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
        {trimmed}
      </p>
    </section>
  );
}

/**
 * Amber, actionable nudge shown ONLY when pending consent forms exist. Links
 * straight to the first outstanding form. The hook resolves every failure to
 * an empty list, so until forms exist this renders nothing.
 */
function PendingFormsCard() {
  const { pendingForms } = useListPendingForms();
  const link = usePortalLink();

  if (pendingForms.length === 0) return null;

  const count = pendingForms.length;
  const first = pendingForms[0];

  return (
    <Card className="border-amber-500/50 bg-amber-500/10">
      <CardContent className="flex items-center gap-4 px-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <FileSignatureIcon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-800 dark:text-amber-200">
            {count === 1 ? '1 form to complete' : `${count} forms to complete`}
          </p>
          <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
            Please complete {count === 1 ? 'it' : 'them'} before your
            appointment.
          </p>
        </div>
        <Button
          asChild
          size="sm"
          className="shrink-0 bg-amber-600 text-white hover:bg-amber-700"
        >
          <a href={link(`/forms/${first.id}`)}>
            {count === 1 ? 'Complete form' : 'Start'}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function QuickActionInner({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Card className="transition-colors hover:bg-accent/50">
      <CardContent className="flex items-center gap-3 px-4 py-4">
        <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Icon className="text-muted-foreground size-5" aria-hidden />
        </div>
        <span className="flex-1 truncate font-medium text-sm">{label}</span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

const QUICK_ACTION_LINK =
  'block rounded-xl focus-visible:outline-2 focus-visible:outline-ring';

function QuickActions() {
  const { pendingForms } = useListPendingForms();
  const link = usePortalLink();
  const firstPendingForm = pendingForms[0];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <a href={link('/documents')} className={QUICK_ACTION_LINK}>
        <QuickActionInner icon={FolderClosedIcon} label="My documents" />
      </a>
      {firstPendingForm && (
        <a
          href={link(`/forms/${firstPendingForm.id}`)}
          className={QUICK_ACTION_LINK}
        >
          <QuickActionInner icon={ClipboardListIcon} label="My forms" />
        </a>
      )}
    </div>
  );
}

function PortalBookingsSection() {
  const { upcoming, past, timezone, isLoading, isError, refetch } =
    useListPatientBookings();
  const bookingLink = useBookingLink();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <PortalBookingCardSkeleton />
        <PortalBookingCardSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <CalendarClockIcon />
          </EmptyMedia>
          <EmptyTitle>Couldn't load your bookings</EmptyTitle>
          <EmptyDescription>Please try again.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <CalendarClockIcon />
          </EmptyMedia>
          <EmptyTitle>No appointments yet</EmptyTitle>
          <EmptyDescription>
            When you book with us, your appointments will show up here.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <a href={bookingLink}>Book an appointment</a>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="mb-0 mt-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 px-6 py-6 text-center">
              <p className="text-muted-foreground text-sm">
                No upcoming appointments.
              </p>
              <Button asChild size="sm" variant="outline">
                <a href={bookingLink}>Book an appointment</a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          upcoming.map((booking) => (
            <PortalBookingCard
              key={booking.id}
              booking={booking}
              timezone={timezone}
            />
          ))
        )}
      </section>

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="mb-0 mt-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Past
          </h2>
          {past.map((booking) => (
            <PortalBookingCard
              key={booking.id}
              booking={booking}
              timezone={timezone}
              isPast
            />
          ))}
        </section>
      )}
    </div>
  );
}

const HomeSkeleton = (
  <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </div>
    <PortalBookingCardSkeleton />
    <PortalBookingCardSkeleton />
  </div>
);

export function PortalHomeIsland({ ctx }: { ctx: PortalContext }) {
  return (
    <PortalProvider ctx={ctx}>
      <PortalAuthGate
        skeleton={HomeSkeleton}
        errorIcon={<CalendarClockIcon />}
        errorTitle="Something went wrong"
        errorDescription="We couldn't load your portal. Please try again."
      >
        {(patient) => (
          <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <GreetingHeader firstName={patient.firstName || patient.email} />
            <ClinicNoteCard note={patient.portalNote} />
            <PendingFormsCard />
            <QuickActions />
            <PortalBookingsSection />
          </div>
        )}
      </PortalAuthGate>
    </PortalProvider>
  );
}
