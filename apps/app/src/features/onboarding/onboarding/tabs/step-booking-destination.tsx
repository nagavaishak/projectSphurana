import { FieldGroup } from '@/components/ui/field';
import { Calendar, CalendarDays } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

interface StepBookingDestinationProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

interface BookingDestinationOption {
  id: 'borradh' | 'google_calendar';
  name: string;
  description: string;
  icon: typeof Calendar;
}

const BOOKING_DESTINATION_OPTIONS: BookingDestinationOption[] = [
  {
    id: 'borradh',
    name: 'Your Calendar',
    description: 'Manage bookings in your Borradh calendar.',
    icon: Calendar,
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'Sync bookings to your Google Calendar.',
    icon: CalendarDays,
  },
];

/**
 * Step: Booking Destination
 * Choose where bookings should go: Borradh built-in calendar or Google Calendar.
 */
export function StepBookingDestination({ form }: StepBookingDestinationProps) {
  const bookingDestination: string =
    form.watch('bookingDestination') || 'borradh';

  const selectOption = (id: 'borradh' | 'google_calendar') => {
    form.setValue('bookingDestination', id, { shouldDirty: true });
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          Where do you want your bookings to go?
        </h1>
        <p className="text-muted-foreground">
          Choose where new bookings will appear.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {BOOKING_DESTINATION_OPTIONS.map((option) => {
          const isSelected = bookingDestination === option.id;

          return (
            <div
              key={option.id}
              role="button"
              tabIndex={0}
              className={`relative flex items-center gap-4 rounded-lg border p-4 transition-colors cursor-pointer ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
              onClick={() => selectOption(option.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectOption(option.id);
                }
              }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <option.icon className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{option.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {option.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </FieldGroup>
  );
}
