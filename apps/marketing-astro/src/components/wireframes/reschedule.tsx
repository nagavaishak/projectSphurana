'use client';

/**
 * Reschedule a booking — §23.8, governed by §10.4 / PR #848.
 *
 * §10.4 supersedes the original spec §6.4 and it changes this screen more than
 * any other. ONE deadline (`cancellation_reschedule_deadline_hours`) governs
 * both cancelling and rescheduling, and inside it the two actions diverge:
 *
 *   cancel      — ALLOWED, behind a forfeit warning
 *   reschedule  — BLOCKED outright
 *
 * There is no coherent "forfeit" story for MOVING a booking rather than
 * dropping it, so a late reschedule is refused and the patient is sent to the
 * clinic. It also closes the obvious dodge: reschedule far out for free, then
 * cancel the far-out booking for free.
 *
 * Because cancelling stays available when rescheduling does not, the blocked
 * screen says so explicitly. A patient who reads "you can't modify your
 * booking online" and stops there is stuck with an appointment they cannot
 * attend, and the clinic gets a no-show instead of a cancellation with two
 * hours' notice — which is worse for everyone including the next patient.
 *
 * OUTSIDE the deadline, the deposit CARRIES OVER. It is the same booking with a
 * new time; re-charging it would take a second £20 off someone who has paid
 * once, and refund-then-recharge is a worse version of the same thing. Saying
 * so before the picker, not after it, is what stops the "will I be charged
 * again?" phone call this page exists to prevent.
 */

import {
  ArrowRightIcon,
  CalendarXIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoIcon,
  LockIcon,
  PhoneIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import {
  BOOKING_DAYS,
  RESCHEDULE,
  RESCHEDULE_POLICY,
  SLOTS,
  type WfDay,
} from './mock';
import { WfNote, WfPortalShell, WfSummaryCard } from './wf-shell';

export function RescheduleBooking() {
  const [insideDeadline, setInsideDeadline] = useState(false);

  return (
    <WfPortalShell backLabel="Reschedule">
      <WfNote>
        Static page, modelled on PR #848 (the logic of record). Availability is
        a fixture. Note that inside the deadline rescheduling is refused while
        cancelling stays open — that asymmetry is real, not a wireframe
        shortcut.
      </WfNote>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-8">
        {/* Review affordance only — not part of the design. */}
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
          <span className="text-muted-foreground text-sm">Preview:</span>
          <Button
            type="button"
            size="sm"
            variant={insideDeadline ? 'outline' : 'default'}
            onClick={() => setInsideDeadline(false)}
          >
            Outside {RESCHEDULE_POLICY.deadlineHours}h — allowed
          </Button>
          <Button
            type="button"
            size="sm"
            variant={insideDeadline ? 'default' : 'outline'}
            onClick={() => setInsideDeadline(true)}
          >
            Inside {RESCHEDULE_POLICY.deadlineHours}h — blocked
          </Button>
        </div>

        {insideDeadline ? <BlockedInsideDeadline /> : <PickANewTime />}
      </main>
    </WfPortalShell>
  );
}

/* ------------------------------------------------- outside the deadline -- */

function PickANewTime() {
  const [selectedDayId, setSelectedDayId] = useState('d-05');
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const { booking, depositCarriedLabel, currentWhenLabel } = RESCHEDULE;

  const reasons = [
    ...new Set(
      BOOKING_DAYS.filter((day) => day.disabledReason).map(
        (day) => day.disabledReason as string
      )
    ),
  ];

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <h1 className="font-bold text-2xl md:text-3xl">Pick a new time</h1>
        <p className="mt-2 text-muted-foreground">
          You're moving {booking.serviceName}, currently {currentWhenLabel}.
        </p>

        {/*
          The policy is stated BEFORE the picker. A patient deciding whether to
          move an appointment is deciding about money as much as about time; put
          the deposit answer after the slot grid and they either ring the clinic
          or abandon the change.
        */}
        <Card className="mt-5 border-green-600/30 bg-green-50 dark:bg-green-950/20">
          <CardContent className="flex items-start gap-3 p-5">
            <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-green-700 dark:text-green-400" />
            <div className="space-y-1">
              <p className="font-semibold text-green-800 dark:text-green-300">
                Your {depositCarriedLabel} deposit moves with the booking
              </p>
              <p className="text-green-800/90 text-sm dark:text-green-300/90">
                You won't be charged again, and nothing is refunded and re-taken
                — it's the same booking at a new time. Free to change up to{' '}
                {RESCHEDULE_POLICY.noticePeriodLabel} before your appointment.
              </p>
            </div>
          </CardContent>
        </Card>

        {/*
          Service and practitioner are LOCKED. Changing either is a different
          booking with different availability, a different price and possibly a
          different deposit — so it is a new booking, not a reschedule. Showing
          them locked rather than hiding them stops the patient hunting for the
          control.
        */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <LockedRow label="Treatment" value={booking.serviceName} />
          <LockedRow label="With" value={booking.practitioner} />
        </div>
        <p className="mt-2 text-muted-foreground text-xs">
          Need a different treatment or a different practitioner? That's a new
          booking — cancel this one first.
        </p>

        <section className="mt-8">
          <h2 className="font-semibold text-sm">Select a date</h2>
          <div className="mt-3 flex items-stretch gap-2">
            <button
              type="button"
              aria-label="Previous week"
              className="flex w-9 shrink-0 items-center justify-center rounded-xl border bg-background transition-colors hover:bg-accent"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <div className="flex flex-1 gap-2 overflow-x-auto pb-2">
              {BOOKING_DAYS.map((day) => (
                <DayCell
                  key={day.id}
                  day={day}
                  isCurrent={day.id === 'd-02'}
                  isSelected={day.id === selectedDayId}
                  onSelect={() => setSelectedDayId(day.id)}
                />
              ))}
            </div>
            <button
              type="button"
              aria-label="Next week"
              className="flex w-9 shrink-0 items-center justify-center rounded-xl border bg-background transition-colors hover:bg-accent"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>

          <ul className="mt-3 space-y-1">
            <li className="flex items-start gap-2 text-muted-foreground text-xs">
              <span className="mt-1 size-2 shrink-0 rounded-sm bg-primary/30" />
              <span>Your current appointment</span>
            </li>
            {reasons.map((reason) => (
              <li
                key={reason}
                className="flex items-start gap-2 text-muted-foreground text-xs"
              >
                <span className="mt-1 size-2 shrink-0 rounded-sm border border-dashed bg-muted" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="font-semibold text-sm">Pick a time</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Times shown are {booking.practitioner}'s, at {booking.locationName}.
          </p>
          {SLOTS.map((group) => (
            <div key={group.label} className="mt-6">
              <h3 className="font-medium text-muted-foreground text-sm">
                {group.label}
              </h3>
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {group.slots.map((slot) => (
                  <li key={slot.time}>
                    <button
                      type="button"
                      onClick={() => setSelectedSlot(slot.time)}
                      className={cn(
                        'w-full rounded-xl border px-3 py-3 text-center font-semibold transition-colors hover:bg-accent/50',
                        selectedSlot === slot.time &&
                          'border-primary ring-1 ring-primary'
                      )}
                    >
                      {slot.time}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>

      <aside>
        <WfSummaryCard>
          <p className="font-semibold">{booking.serviceName}</p>
          <p className="text-muted-foreground text-sm">
            {booking.practitioner} · {booking.locationName}
          </p>
          <Separator className="my-4" />

          <div className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Currently</p>
              <p className="font-medium line-through">{currentWhenLabel}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Moving to</p>
              <p className="font-medium text-primary">
                {selectedSlot ? `Fri 5 Sep · ${selectedSlot}` : 'Pick a time'}
              </p>
            </div>
          </div>

          <Separator className="my-4" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Deposit</span>
            <span className="flex items-center gap-1.5 font-medium">
              <CheckIcon className="size-3.5 text-green-600" />
              {depositCarriedLabel} carried over
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">To pay now</span>
            <span className="font-semibold">£0.00</span>
          </div>

          <Button className="mt-4 w-full" size="lg" disabled={!selectedSlot}>
            Confirm the new time
            <ArrowRightIcon className="size-4" />
          </Button>
          <p className="mt-3 text-center text-muted-foreground text-xs">
            We'll message you a new confirmation. Your old slot is released as
            soon as this one is confirmed.
          </p>
        </WfSummaryCard>
      </aside>
    </div>
  );
}

function LockedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-4">
      <LockIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
    </div>
  );
}

function DayCell({
  day,
  isSelected,
  isCurrent,
  onSelect,
}: {
  day: WfDay;
  isSelected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  const disabled = day.state !== 'available' && day.state !== 'selected';

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={day.disabledReason}
      aria-label={
        day.disabledReason
          ? `${day.weekday} ${day.dayNumber} ${day.month} — ${day.disabledReason}`
          : `${day.weekday} ${day.dayNumber} ${day.month}`
      }
      className={cn(
        'flex w-16 shrink-0 flex-col items-center gap-0.5 rounded-xl border px-2 py-3 transition-colors',
        !disabled && 'hover:bg-accent',
        /* The current appointment stays visible in the strip so the patient can
           see how far they are moving it. */
        isCurrent && 'border-primary/40 bg-primary/10',
        isSelected && 'border-primary bg-primary text-primary-foreground',
        disabled &&
          'cursor-not-allowed border-dashed bg-muted/40 text-muted-foreground'
      )}
    >
      <span className="text-xs">{day.weekday}</span>
      <span className="font-semibold text-lg">{day.dayNumber}</span>
      <span className="text-xs">{day.month}</span>
    </button>
  );
}

/* -------------------------------------------------- inside the deadline -- */

function BlockedInsideDeadline() {
  const { booking } = RESCHEDULE;
  const { businessName, noticePeriodLabel, clinicPhone, hoursRemainingLabel } =
    RESCHEDULE_POLICY;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="space-y-3 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <CalendarXIcon className="size-6 text-muted-foreground" />
        </span>
        <h1 className="font-bold text-2xl">This one can't be moved online</h1>
        <p className="text-muted-foreground">
          Your appointment is in {hoursRemainingLabel}.
        </p>
      </div>

      <Card>
        <CardContent className="p-5">
          <Badge variant="secondary" className="mb-2">
            {booking.confirmation === 'confirmed' ? 'Confirmed' : 'Booked'}
          </Badge>
          <p className="font-semibold text-lg">{booking.serviceName}</p>
          <p className="text-muted-foreground text-sm">{booking.whenLabel}</p>
          <p className="text-muted-foreground text-sm">
            {booking.practitioner} · {booking.locationName}
          </p>
        </CardContent>
      </Card>

      {/*
        Verbatim per §10.4. Do not paraphrase it — this is the wording the
        clinic's own policy uses, and a reworded version is a different promise.
      */}
      <Card className="border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-3 p-5">
          <InfoIcon className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <p className="text-amber-900 text-sm dark:text-amber-200">
            As per the {businessName}'s cancellation &amp; rescheduling policy,
            you can't modify or cancel your booking online with less than{' '}
            {noticePeriodLabel} notice. Contact {businessName} directly.
          </p>
        </CardContent>
      </Card>

      <Button className="w-full" size="lg" asChild>
        <a href={`tel:${clinicPhone.replace(/\s/g, '')}`}>
          <PhoneIcon className="size-4" />
          Call {businessName} — {clinicPhone}
        </a>
      </Button>

      <Separator />

      {/*
        Cancelling IS still available inside the deadline — §10.4 blocks only
        the reschedule. Leaving this off would strand a patient who genuinely
        cannot attend, and the clinic would take a silent no-show rather than a
        late cancellation it could fill.
      */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="font-semibold">Can't make it at all?</p>
          <p className="text-muted-foreground text-sm">
            Cancelling online is still open, even this close to the appointment.
            We'll tell you what happens to your deposit before you confirm
            anything.
          </p>
          <Button variant="outline" className="w-full" asChild>
            <a href="/wireframes/cancel">
              <XIcon className="size-4" />
              Cancel this booking instead
            </a>
          </Button>
        </CardContent>
      </Card>

      <p className="text-center text-muted-foreground text-xs">
        Next time, you can change a booking yourself any time up to{' '}
        {noticePeriodLabel} before it starts.
      </p>
    </div>
  );
}
