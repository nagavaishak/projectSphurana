'use client';

import { addDays, format, startOfDay } from 'date-fns';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useGetGeneralBookingSlots } from './api';
import type { WizardConfig } from './booking-cart';
import type { TimeSlot } from './types';
import { localDayKey, time12InTz } from './wizard-time';

interface WizardDateTimeStepProps {
  config: WizardConfig;
  /** The cart's primary service — drives the public slots query. */
  primaryServiceId: string;
  /** Summed duration of the cart, used to label slot end times. */
  durationMinutes: number;
  /** Chosen practitioner (from the Professional step), or undefined for "any". */
  practitionerId?: string;
  /**
   * The branch being booked, forwarded to the slots call. Absent = the org's
   * default branch. Without it this step draws its day from the DEFAULT
   * branch's opening hours and exceptions no matter which branch page the
   * customer is standing on.
   */
  locationSlug?: string;
  selectedSlot: TimeSlot | null;
  onSelect: (slot: TimeSlot, date: Date) => void;
}

const DAYS_AHEAD = 14;

/**
 * The Time step: a horizontal strip of upcoming days and a vertical list of
 * available start times for the chosen day. Times render in the org timezone.
 * Slots come from the same public endpoint the standalone picker uses; for a
 * multi-service cart we query the primary service and label the end time using
 * the summed cart duration (the backend recomputes the true end from the cart).
 */
export function WizardDateTimeStep({
  config,
  primaryServiceId,
  durationMinutes,
  practitionerId,
  locationSlug,
  selectedSlot,
  onSelect,
}: WizardDateTimeStepProps) {
  const today = startOfDay(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const stripRef = useRef<HTMLDivElement>(null);

  const days = useMemo(
    () => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)),
    [today]
  );

  const scrollStrip = (direction: -1 | 1) => {
    stripRef.current?.scrollBy({
      left: direction * 240,
      behavior: 'smooth',
    });
  };

  const dateString = localDayKey(selectedDate);
  const { slots, isLoading, isError, refetch } = useGetGeneralBookingSlots({
    organizationSlug: config.organizationSlug,
    serviceId: primaryServiceId,
    date: dateString,
    practitionerId,
    locationSlug,
  });

  const formatSlot = (iso: string) => time12InTz(iso, config.timezone);

  return (
    <div>
      <h1 className="font-bold text-3xl md:text-4xl">Select date and time</h1>

      {/* Date strip */}
      <div className="mt-8">
        <h2 className="font-semibold text-sm">Select a date</h2>
        <div className="mt-3 flex items-stretch gap-2">
          <button
            type="button"
            aria-label="Earlier dates"
            onClick={() => scrollStrip(-1)}
            className="flex w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <div
            ref={stripRef}
            className="flex flex-1 gap-2 overflow-x-auto scroll-smooth pb-2"
          >
            {days.map((day) => {
              const active = localDayKey(day) === dateString;
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  aria-pressed={active}
                  aria-label={format(day, 'EEEE d MMMM')}
                  onClick={() => setSelectedDate(day)}
                  className={cn(
                    'flex min-w-[64px] shrink-0 flex-col items-center gap-0.5 rounded-xl border px-3 py-3 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:bg-accent'
                  )}
                >
                  <span className="text-xs">{format(day, 'EEE')}</span>
                  <span className="font-semibold text-lg">
                    {format(day, 'd')}
                  </span>
                  <span className="text-xs">{format(day, 'MMM')}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-label="Later dates"
            onClick={() => scrollStrip(1)}
            className="flex w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
      </div>

      {/* Time list */}
      <div className="mt-8">
        <h2 className="font-semibold text-sm">Pick a time</h2>
        {isLoading ? (
          <div className="mt-3 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton
                key={`slot-skel-${i}`}
                className="h-14 w-full rounded-xl"
              />
            ))}
          </div>
        ) : isError ? (
          /* A FAILED availability fetch is not a fully-booked day. Rendering
             the "no available times" empty state here would tell the customer
             the clinic has nothing free, when in fact we never asked. */
          <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center">
            <p className="text-sm font-medium">
              We couldn't load available times.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              This is a problem on our side, not a full diary.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        ) : slots.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No times available this day — try another date.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {slots.map((slot) => {
              const active = selectedSlot?.startTime === slot.startTime;
              return (
                <li key={slot.startTime}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(slot, selectedDate)}
                    className={cn(
                      'w-full rounded-xl border px-5 py-4 text-left font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      active
                        ? 'border-primary ring-1 ring-primary'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    {formatSlot(slot.startTime)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {durationMinutes > 0 && slots.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Appointments run about {durationMinutes} minutes.
          </p>
        )}
      </div>
    </div>
  );
}
