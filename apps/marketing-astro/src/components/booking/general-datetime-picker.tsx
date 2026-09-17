'use client';

import { addDays, format, startOfDay } from 'date-fns';
import { ArrowLeftIcon, CalendarIcon, ClockIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { PractitionerPicker } from '@/features/booking-forms';

import { useGetGeneralBookingSlots } from './api';
import type { TimeSlot } from './types';
import { localDayKey, time12InTz } from './wizard-time';

interface GeneralDateTimePickerProps {
  organizationSlug: string;
  serviceId: string;
  appointmentDuration: number;
  /**
   * The CLINIC's IANA zone. apps/app's picker formatted slots in the browser
   * zone even when embedded in the manage page, whose whole point is that times
   * render in the clinic's. Passing it through fixes that mismatch; omitting it
   * keeps the original browser-local behaviour.
   */
  timezone?: string | null;
  /**
   * The branch whose diary the offered times come from. Absent = the org's
   * default branch, which is what this picker did before branches existed and
   * is still right for a single-branch clinic. A caller that HAS a branch (the
   * manage-booking page rescheduling an existing appointment) must pass it, or
   * it offers the customer a different branch's times.
   */
  locationSlug?: string;
  onConfirm: (slot: TimeSlot, date: Date, practitionerId?: string) => void;
  onBack: () => void;
}

export function GeneralDateTimePicker({
  organizationSlug,
  serviceId,
  appointmentDuration,
  timezone = null,
  locationSlug,
  onConfirm,
  onBack,
}: GeneralDateTimePickerProps) {
  const today = startOfDay(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<
    string | null
  >(null);

  const dateString = selectedDate ? localDayKey(selectedDate) : '';
  const {
    slots,
    byPractitioner,
    isLoading: isLoadingSlots,
    isError: isSlotsError,
    refetch,
  } = useGetGeneralBookingSlots({
    organizationSlug,
    serviceId,
    date: dateString,
    locationSlug,
  });

  // When byPractitioner is available and a specific practitioner is selected,
  // filter to only that practitioner's slots. Otherwise show all merged slots.
  const displayedSlots = useMemo(() => {
    if (!selectedPractitionerId || !byPractitioner) return slots;
    const match = byPractitioner.find(
      (p) => p.practitioner.id === selectedPractitionerId
    );
    return match?.slots ?? [];
  }, [slots, byPractitioner, selectedPractitionerId]);

  // Extract practitioner list for the picker
  const practitioners = useMemo(
    () => byPractitioner?.map((p) => p.practitioner) ?? [],
    [byPractitioner]
  );

  const handlePractitionerSelect = (id: string | null) => {
    setSelectedPractitionerId(id);
    setSelectedSlot(null); // reset slot when practitioner changes
  };

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

  const handleSlotSelect = (slot: TimeSlot) => {
    setSelectedSlot(slot);
  };

  const handleConfirm = () => {
    if (selectedDate && selectedSlot) {
      onConfirm(
        selectedSlot,
        selectedDate,
        selectedPractitionerId ?? undefined
      );
    }
  };

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>Select date and time</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Choose a {appointmentDuration} min slot for your appointment
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Practitioner selection (only shown when byPractitioner data exists) */}
        {practitioners.length > 0 && (
          <div className="mb-6">
            <PractitionerPicker
              practitioners={practitioners}
              selectedPractitionerId={selectedPractitionerId}
              onSelect={handlePractitionerSelect}
            />
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6">
          {/* Left: Calendar + Presets */}
          <div className="flex-1 min-w-0">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              disabled={(date: Date) =>
                date < today || date > addDays(today, 60)
              }
              className="rounded-md border p-3 [--cell-size:--spacing(14)]"
            />

            {/* Preset buttons */}
            <div className="flex flex-wrap gap-2 mt-4">
              {presets.map((preset) => (
                <Button
                  key={preset.label}
                  variant={
                    selectedDate &&
                    localDayKey(selectedDate) === localDayKey(preset.date)
                      ? 'default'
                      : 'outline'
                  }
                  size="sm"
                  onClick={() => handleDateSelect(preset.date)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Right: Time Slots */}
          <div className="flex-1 min-w-0">
            {!selectedDate ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[280px] text-center">
                <CalendarIcon className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Pick a date to see available times
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <ClockIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">
                    {format(selectedDate, 'EEEE, MMMM d')}
                  </h3>
                </div>

                {isLoadingSlots ? (
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={`slot-skel-${i}`} className="h-10" />
                    ))}
                  </div>
                ) : isSlotsError ? (
                  /* A failed fetch is not a full diary — say which it is, or
                     the patient gives up on a clinic that had times free. */
                  <div className="flex flex-col items-center justify-center min-h-[200px] text-center">
                    <p className="text-sm font-medium">
                      We couldn't load available times.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
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
                ) : displayedSlots.length === 0 ? (
                  <div className="flex flex-col items-center justify-center min-h-[200px] text-center">
                    <p className="text-sm text-muted-foreground">
                      No times available this day — try another date.
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[320px] pr-3">
                    <div className="grid grid-cols-2 gap-2">
                      {displayedSlots.map((slot) => {
                        const isSelected =
                          selectedSlot?.startTime === slot.startTime;
                        return (
                          <Button
                            key={slot.startTime}
                            variant={isSelected ? 'default' : 'outline'}
                            size="sm"
                            className="justify-center"
                            onClick={() => handleSlotSelect(slot)}
                          >
                            {time12InTz(slot.startTime, timezone)}
                          </Button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </>
            )}
          </div>
        </div>

        {/* Confirm Button */}
        {selectedSlot && selectedDate && (
          <div className="mt-6 pt-4 border-t">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <p className="font-medium">
                  {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                </p>
                <p className="text-muted-foreground">
                  {time12InTz(selectedSlot.startTime, timezone)} -{' '}
                  {time12InTz(selectedSlot.endTime, timezone)}
                </p>
              </div>
              <Button onClick={handleConfirm}>Confirm Booking</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
