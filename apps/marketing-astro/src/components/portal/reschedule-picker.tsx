'use client';

import { addDays, format, startOfDay } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';

import { useGetRescheduleSlots } from './api/get-reschedule-slots.hook';
import type { TimeSlot } from './api/types';
import { localDayKey, shortDateTimeInTz, time12InTz } from './portal-time';

interface ReschedulePickerProps {
  /** The clinic's IANA timezone — every time is rendered in it. */
  timezone: string;
  serviceId: string;
  /**
   * The branch the booking is on. Scopes the offered times to THAT branch's
   * diary; see `useGetRescheduleSlots` for why omitting it is only safe on a
   * single-branch clinic.
   */
  locationSlug?: string;
  /** True while the reschedule mutation is in flight. */
  isSubmitting: boolean;
  onConfirm: (slot: TimeSlot) => void;
  onCancel: () => void;
}

/**
 * The portal's reschedule picker.
 *
 * Layout contract (unchanged from apps/app): renders the BODY + FOOTER of a
 * `DialogContent` that is itself a bounded flex column. The body is the only
 * scrolling region; the header (owned by the page) and the confirm footer stay
 * fixed. Desktop is a `[minmax(0,1fr)_200px]` grid — calendar left, that day's
 * slots in one internally-scrolling column right; both panes are `min-w-0` so
 * nothing can force horizontal overflow.
 *
 * `organizationSlug` is no longer a prop: the slots hook reads it from the
 * portal context, same as every other call.
 */
export function ReschedulePicker({
  timezone,
  serviceId,
  locationSlug,
  isSubmitting,
  onConfirm,
  onCancel,
}: ReschedulePickerProps) {
  const today = startOfDay(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  const dateString = selectedDate ? localDayKey(selectedDate) : '';
  const { slots, isLoading: isLoadingSlots } = useGetRescheduleSlots({
    serviceId,
    date: dateString,
    locationSlug,
  });

  const presets = useMemo(
    () => [
      { label: 'Today', date: today },
      { label: 'Tomorrow', date: addDays(today, 1) },
      { label: 'In 3 days', date: addDays(today, 3) },
      { label: 'In a week', date: addDays(today, 7) },
    ],
    [today]
  );

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    setSelectedSlot(null);
  };

  const confirmLabel = selectedSlot
    ? shortDateTimeInTz(selectedSlot.startTime, timezone)
    : null;

  return (
    <>
      {/* Scrolling body — the only region allowed to scroll vertically. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
        <div
          className="flex flex-wrap gap-2 pb-3"
          role="group"
          aria-label="Quick date choices"
        >
          {presets.map((preset) => {
            const isActive =
              !!selectedDate &&
              localDayKey(selectedDate) === localDayKey(preset.date);
            return (
              <Button
                key={preset.label}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                className="rounded-full motion-safe:transition-colors"
                aria-pressed={isActive}
                onClick={() => handleDateSelect(preset.date)}
              >
                {preset.label}
              </Button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div className="flex min-w-0 justify-center sm:justify-start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              disabled={(date: Date) =>
                date < today || date > addDays(today, 60)
              }
              className="rounded-md border"
            />
          </div>

          <div className="relative min-w-0 sm:min-h-full">
            <div className="flex max-h-56 min-h-40 flex-col overflow-y-auto overscroll-contain rounded-md border [-webkit-overflow-scrolling:touch] sm:absolute sm:inset-0 sm:max-h-none">
              {!selectedDate ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                  <CalendarIcon
                    className="size-6 text-muted-foreground/50"
                    aria-hidden
                  />
                  <p className="text-muted-foreground text-sm">
                    Pick a date to see available times
                  </p>
                </div>
              ) : (
                <>
                  <div className="sticky top-0 z-10 border-b bg-background px-3 py-2">
                    <h3 className="text-sm font-medium">
                      {format(selectedDate, 'EEEE d MMMM')}
                    </h3>
                  </div>

                  {isLoadingSlots ? (
                    /* Matches the slot-pill list exactly (h-11 rows, same
                       gaps) so nothing shifts when slots land. */
                    <div className="flex flex-col gap-2 p-3">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton
                          key={`slot-skeleton-${i}`}
                          className="h-11 w-full rounded-md"
                        />
                      ))}
                    </div>
                  ) : slots.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center p-4 text-center">
                      <p className="text-muted-foreground text-sm">
                        No times available this day — try another date.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 p-3">
                      {slots.map((slot) => {
                        const isSelected =
                          selectedSlot?.startTime === slot.startTime;
                        return (
                          <Button
                            key={slot.startTime}
                            type="button"
                            variant={isSelected ? 'default' : 'outline'}
                            className="min-h-11 w-full justify-center focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors"
                            aria-pressed={isSelected}
                            aria-label={shortDateTimeInTz(
                              slot.startTime,
                              timezone
                            )}
                            onClick={() => setSelectedSlot(slot)}
                          >
                            {time12InTz(slot.startTime, timezone)}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Fixed footer — confirm arms once a slot is picked. */}
      <div className="shrink-0 border-t bg-background px-5 py-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-w-0 flex-1 truncate"
            disabled={!selectedSlot || isSubmitting}
            aria-label={
              confirmLabel
                ? `Confirm new time, ${confirmLabel}`
                : 'Confirm new time'
            }
            onClick={() => {
              if (selectedSlot && !isSubmitting) onConfirm(selectedSlot);
            }}
          >
            {isSubmitting
              ? 'Moving your booking…'
              : confirmLabel
                ? `Confirm — ${confirmLabel}`
                : 'Pick a time to continue'}
          </Button>
        </div>
      </div>
    </>
  );
}
