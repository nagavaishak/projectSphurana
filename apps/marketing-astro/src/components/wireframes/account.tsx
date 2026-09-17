'use client';

/**
 * Account-side pages: the hub, the bookings list, and cancelling.
 *
 * The cancel page is the one that earns its keep. Spec §6.4 makes the deposit
 * outcome depend on which side of the cancellation window the patient is on,
 * and those are two genuinely different screens — one reassures, one warns and
 * gates the destructive action behind an explicit acknowledgement. Rendering a
 * single screen with a variable sentence in it would bury the only fact that
 * matters.
 */

import {
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  CreditCardIcon,
  FileTextIcon,
  GiftIcon,
  GraduationCapIcon,
  InfoIcon,
  PhoneIcon,
  ReceiptIcon,
  TriangleAlertIcon,
  UserIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import {
  CANCELLING,
  ORG,
  PAST_BOOKINGS,
  PATIENT,
  UPCOMING_BOOKINGS,
  type WfBooking,
} from './mock';
import { WfNote, WfPortalShell } from './wf-shell';

/**
 * The portal hub — ONE page, not two.
 *
 * The live portal already has a hub: `home.island.tsx` greets the patient by
 * name, surfaces outstanding consent, and lists their bookings. An earlier
 * version of this wireframe drew a separate "My account" page that ALSO
 * greeted by name, ALSO surfaced consent, and then linked to "My bookings" —
 * the first page's entire content. Two hubs, one job.
 *
 * So this is what home becomes: the greeting once, the thing you came for
 * (your next appointment) at the top, and everything else as a compact list
 * below. Nothing is a second front door.
 *
 * ## Why a list and not tabs
 *
 * A17 puts tabs and a persistent aside on the clinic's entity views. That is
 * right for a 1440px dashboard and wrong here. The portal is overwhelmingly a
 * phone, the sections are visited rarely, and eight tabs on a 375px screen
 * either wrap to three rows or scroll out of sight. Hub-and-drill is the
 * native mobile pattern, and it is what this keeps.
 *
 * What DOES transfer from A17 is the discipline: identity stated once, the
 * thing that blocks care surfaced without navigation, and no section that
 * exists only to hold a link.
 */
export function AccountHub() {
  const next = UPCOMING_BOOKINGS[0];

  return (
    <WfPortalShell
      actions={
        <Button variant="outline" size="sm">
          Sign out
        </Button>
      }
    >
      <WfNote>
        Static page. This replaces the separate "My account" hub — the live
        portal home already greets by name and lists bookings, so a second page
        doing the same was two front doors. Courses, vouchers, purchase history
        and notification preferences are all new.
      </WfNote>

      <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
        <header>
          <h1 className="font-bold text-3xl tracking-tight">
            Hi {PATIENT.firstName}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Everything for your care at {ORG.name}.
          </p>
        </header>

        {/*
          Blocking first. A consent form due before an appointment is the only
          thing here that stops treatment happening, so it sits above the
          appointment it blocks rather than in a list further down.
        */}
        <Card className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <TriangleAlertIcon className="size-4 shrink-0 text-amber-600" />
            <p className="min-w-0 flex-1 text-amber-900 text-sm dark:text-amber-200">
              1 consent form to complete before Wed 2 September
            </p>
            <Button size="sm">Complete it</Button>
          </CardContent>
        </Card>

        {/* The thing they opened the app for. */}
        <section className="space-y-3">
          <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Your next appointment
          </h2>
          <Card>
            <CardContent className="space-y-3 p-5">
              <div>
                <p className="font-semibold text-lg">{next.serviceName}</p>
                <p className="text-muted-foreground text-sm">
                  {next.whenLabel} · {next.practitioner}
                </p>
                <p className="text-muted-foreground text-sm">
                  {next.locationName}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="gap-1.5">
                  <CheckIcon className="size-3" />
                  {next.depositLabel}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm">
                  Reschedule
                </Button>
                <Button variant="outline" size="sm">
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Three things worth a tap, not a row of eight. */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: CalendarIcon, label: 'Book again' },
            { icon: GraduationCapIcon, label: 'My courses' },
            { icon: GiftIcon, label: 'Vouchers' },
          ].map((a) => (
            <button
              key={a.label}
              type="button"
              className="flex flex-col items-center gap-2 rounded-xl border bg-background px-2 py-4 text-center transition-colors hover:bg-muted"
            >
              <a.icon className="size-5 text-muted-foreground" />
              <span className="text-xs leading-tight">{a.label}</span>
            </button>
          ))}
        </div>

        {/*
          Everything else, as one list. Each row goes somewhere real — a row
          that only exists to hold a link to an empty page is worse than no row.
        */}
        <section className="space-y-3">
          <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Your account
          </h2>
          <Card className="overflow-hidden">
            <CardContent className="divide-y p-0">
              {HUB_ROWS.map((row) => (
                <button
                  key={row.label}
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/60"
                >
                  <row.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{row.label}</span>
                    {row.meta ? (
                      <span className="block text-muted-foreground text-xs">
                        {row.meta}
                      </span>
                    ) : null}
                  </span>
                  {row.badge ? (
                    <Badge variant="secondary" className="shrink-0">
                      {row.badge}
                    </Badge>
                  ) : null}
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </CardContent>
          </Card>
        </section>

        <p className="px-1 text-center text-muted-foreground text-xs">
          Download or delete my data
        </p>
      </div>
    </WfPortalShell>
  );
}

/**
 * Past bookings sits in this list rather than beside "next appointment": the
 * overwhelming reason to open the portal is the appointment that has not
 * happened yet.
 */
const HUB_ROWS = [
  {
    icon: CalendarIcon,
    label: 'Past appointments',
    meta: '6 visits',
    badge: null,
  },
  {
    icon: ReceiptIcon,
    label: 'Purchase history',
    meta: 'Deposits, treatments, courses and vouchers',
    badge: null,
  },
  {
    icon: FileTextIcon,
    label: 'Forms & consent',
    meta: null,
    badge: '1 due',
  },
  {
    icon: FileTextIcon,
    label: 'My documents',
    meta: 'Aftercare, letters, results',
    badge: null,
  },
  {
    icon: CreditCardIcon,
    label: 'Payment method',
    meta: 'Visa •••• 4242 · expires 04/29',
    badge: null,
  },
  { icon: UserIcon, label: 'Profile & details', meta: null, badge: null },
  {
    icon: BellIcon,
    label: 'Reminders',
    meta: 'How we contact you',
    badge: null,
  },
];

export function ManageBookings() {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const bookings = tab === 'upcoming' ? UPCOMING_BOOKINGS : PAST_BOOKINGS;

  return (
    <WfPortalShell backLabel="My bookings">
      <WfNote>
        Static page. Deposit, consent and prepaid badges are all new on this
        list, as is rescheduling from the portal.
      </WfNote>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-6">
        <h1 className="font-bold text-3xl">My bookings</h1>

        <div className="flex gap-2">
          <Button
            variant={tab === 'upcoming' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('upcoming')}
          >
            Upcoming ({UPCOMING_BOOKINGS.length})
          </Button>
          <Button
            variant={tab === 'past' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('past')}
          >
            Past
          </Button>
        </div>

        <ul className="space-y-4">
          {bookings.map((booking) => (
            <li key={booking.id}>
              <BookingCard booking={booking} isPast={tab === 'past'} />
            </li>
          ))}
        </ul>

        {tab === 'upcoming' ? (
          <p className="text-muted-foreground text-sm">
            “Unconfirmed” just means you haven't replied to our reminder yet —
            your slot is held either way.
          </p>
        ) : null}
      </main>
    </WfPortalShell>
  );
}

function BookingCard({
  booking,
  isPast,
}: {
  booking: WfBooking;
  isPast: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p
              className={cn(
                'font-medium text-sm',
                isPast ? 'text-muted-foreground' : 'text-primary'
              )}
            >
              {booking.whenLabel}
            </p>
            <p className="mt-1 font-semibold text-lg">{booking.serviceName}</p>
            <p className="text-muted-foreground text-sm">
              {booking.practitioner} · {booking.locationName}
            </p>
          </div>
          <Badge
            variant={
              booking.confirmation === 'confirmed' ? 'default' : 'secondary'
            }
            className="shrink-0"
          >
            {booking.confirmation === 'confirmed'
              ? 'Confirmed'
              : booking.confirmation === 'unconfirmed'
                ? 'Unconfirmed'
                : 'Cancellation requested'}
          </Badge>
        </div>

        {booking.depositLabel ||
        booking.consentOutstanding ||
        booking.prepaidLabel ? (
          <div className="flex flex-wrap gap-2">
            {booking.depositLabel ? (
              <Badge variant="outline" className="text-green-700">
                <CheckIcon className="size-3" />
                {booking.depositLabel}
              </Badge>
            ) : null}
            {booking.prepaidLabel ? (
              <Badge variant="outline">{booking.prepaidLabel}</Badge>
            ) : null}
            {booking.consentOutstanding ? (
              <Badge variant="outline" className="text-amber-700">
                <TriangleAlertIcon className="size-3" />
                Consent outstanding
              </Badge>
            ) : null}
          </div>
        ) : null}

        {isPast ? (
          <Button variant="outline" size="sm">
            Book again
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm">
              Reschedule
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="/wireframes/cancel">Cancel</a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- cancel -- */

/**
 * Cancel and reschedule, modelled on PR #848 — NOT on spec §6.4.
 *
 * That PR is the logic of record and it differs from the spec in three ways
 * that change this screen completely:
 *
 *  1. ONE deadline (`cancellation_reschedule_deadline_hours`) governs both
 *     cancel and reschedule, replacing the two legacy notice windows.
 *  2. Inside the deadline, **cancel is allowed** but **reschedule is BLOCKED**.
 *     There is no sensible "forfeit" story for moving a booking rather than
 *     dropping it — so the customer is sent to the clinic instead. The earlier
 *     wireframe offered "reschedule for free" as the escape hatch here, which
 *     would have pointed the patient at the one action the system refuses.
 *  3. Whether a late cancel actually forfeits the deposit is the org's
 *     `deposit_forfeit_on_late_cancel` switch — not the deadline alone. With it
 *     off, a late cancel behaves exactly like an early one, and promising a
 *     forfeit that never happens is its own kind of wrong.
 *
 * The never-charged `no_show_or_late_cancel_fee_cents` is dropped by that PR, so
 * there is no "the clinic may charge a fee" copy anywhere on this screen.
 */
export function CancelBooking() {
  const [insideDeadline, setInsideDeadline] = useState(true);
  const [forfeitEnabled, setForfeitEnabled] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);

  const {
    booking,
    depositLabel,
    cancellationRescheduleDeadlineHours: deadlineHours,
    businessName,
  } = CANCELLING;

  /* The deposit is only at risk when BOTH are true. */
  const depositAtRisk = insideDeadline && forfeitEnabled;

  return (
    <WfPortalShell backLabel="Cancel booking">
      <WfNote>
        Static page, modelled on PR #848 (the logic of record). Use the toggles
        to compare states — note that inside the deadline, rescheduling is
        blocked outright while cancelling stays available.
      </WfNote>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-6">
        {/* Review affordance only — not part of the design. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
          <span className="text-muted-foreground text-sm">Preview:</span>
          <Button
            variant={insideDeadline ? 'default' : 'outline'}
            size="sm"
            onClick={() => setInsideDeadline(true)}
          >
            Inside {deadlineHours}h
          </Button>
          <Button
            variant={insideDeadline ? 'outline' : 'default'}
            size="sm"
            onClick={() => setInsideDeadline(false)}
          >
            Outside {deadlineHours}h
          </Button>
          <span className="ml-2 text-muted-foreground text-sm">
            Forfeit switch:
          </span>
          <Button
            variant={forfeitEnabled ? 'default' : 'outline'}
            size="sm"
            onClick={() => setForfeitEnabled((v) => !v)}
          >
            {forfeitEnabled ? 'On' : 'Off'}
          </Button>
        </div>

        <h1 className="font-bold text-3xl">Cancel this booking?</h1>

        <Card>
          <CardContent className="p-5">
            <p className="font-semibold text-lg">{booking.serviceName}</p>
            <p className="text-muted-foreground text-sm">{booking.whenLabel}</p>
            <p className="text-muted-foreground text-sm">
              {booking.practitioner} · {booking.locationName}
            </p>
          </CardContent>
        </Card>

        {depositAtRisk ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-3 p-5">
              <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className="font-semibold text-destructive">
                  This appointment is in under {deadlineHours} hours
                </p>
                <p className="mt-1.5 text-destructive/90 text-sm">
                  Cancelling now means your{' '}
                  <strong>{depositLabel} deposit will not be refunded</strong>,
                  in line with the clinic's cancellation policy.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-green-600/30 bg-green-50 dark:bg-green-950/20">
            <CardContent className="flex items-start gap-3 p-5">
              <CheckIcon className="mt-0.5 size-5 shrink-0 text-green-600" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-300">
                  Your {depositLabel} deposit will be refunded in full
                </p>
                <p className="mt-1.5 text-green-800/90 text-sm dark:text-green-300/90">
                  {insideDeadline
                    ? 'This clinic does not retain deposits on late cancellations.'
                    : 'Refunds usually reach your account within 5–10 days.'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/*
          Rescheduling is BLOCKED inside the deadline. Saying so here — with the
          same verbatim wording the reschedule surface uses — is the difference
          between the patient ringing the clinic and the patient tapping
          "reschedule" and hitting a wall.
        */}
        {insideDeadline ? (
          <Card className="bg-muted/50">
            <CardContent className="flex items-start gap-3 p-5">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Want to move it instead?</p>
                <p className="mt-1 text-muted-foreground text-sm">
                  As per {businessName}'s cancellation &amp; rescheduling
                  policy, you can't modify your booking online with less than{' '}
                  {deadlineHours} hours notice. Contact {businessName} directly
                  and we'll find you another time.
                </p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <a href="tel:01782555240">
                    <PhoneIcon className="size-3.5" />
                    Call the clinic
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {depositAtRisk ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="font-medium text-sm">
              I understand my {depositLabel} deposit will not be refunded.
            </span>
          </label>
        ) : null}

        <div className="space-y-3">
          <Button className="w-full" size="lg">
            Keep my appointment
          </Button>
          <Button
            variant="destructive"
            className="w-full"
            size="lg"
            disabled={depositAtRisk && !acknowledged}
          >
            Cancel anyway
          </Button>
          {/*
            Reschedule is only offered as a way out when it will actually work.
            Outside the deadline it is free and the better outcome for both
            sides; inside it, the block notice above has already explained why
            the option is not here.
          */}
          {insideDeadline ? null : (
            <p className="text-center text-muted-foreground text-sm">
              Need to move it instead?{' '}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
              >
                Reschedule for free
              </button>{' '}
              up to {deadlineHours} hours before.
            </p>
          )}
        </div>
      </main>
    </WfPortalShell>
  );
}
