import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CalendarDays, ExternalLink } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

// TODO: Re-enable full provider list when integrations are built
// import { Clock, Link2 } from 'lucide-react';
// type BookingSystemChoice =
//   | 'borradh'
//   | 'calendly'
//   | 'timely'
//   | 'fresha'
//   | 'phorest'
//   | 'not_listed';
// interface BookingOption {
//   id: BookingSystemChoice;
//   name: string;
//   description: string;
//   icon: typeof CalendarDays;
//   tier: 0 | 1 | 2 | 3;
// }
// const BOOKING_OPTIONS: BookingOption[] = [
//   {
//     id: 'calendly',
//     name: 'Calendly',
//     description: 'Sync appointments & import your team',
//     icon: CalendarDays,
//     tier: 1,
//   },
//   {
//     id: 'timely',
//     name: 'Timely',
//     description: 'Sync appointments & import your team',
//     icon: Clock,
//     tier: 1,
//   },
//   {
//     id: 'fresha',
//     name: 'Fresha',
//     description: "We'll share your booking link with leads",
//     icon: ExternalLink,
//     tier: 2,
//   },
//   {
//     id: 'phorest',
//     name: 'Phorest',
//     description: "We'll share your booking link with leads",
//     icon: ExternalLink,
//     tier: 2,
//   },
//   {
//     id: 'not_listed',
//     name: 'Not listed',
//     description: 'Paste your booking page link',
//     icon: Link2,
//     tier: 3,
//   },
// ];

interface StepBookingLinksProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

type BookingSystemChoice = 'borradh' | 'not_listed';

interface BookingOption {
  id: BookingSystemChoice;
  name: string;
  description: string;
  icon: typeof CalendarDays;
}

const BOOKING_OPTIONS: BookingOption[] = [
  {
    id: 'borradh',
    name: 'Use Borradh calendar',
    description:
      "We'll manage your bookings and share your calendar with leads",
    icon: CalendarDays,
  },
  {
    id: 'not_listed',
    name: 'I use my own booking system',
    description: "Paste your booking link and we'll share it with leads",
    icon: ExternalLink,
  },
];

/**
 * Step: Booking System Selection
 * Temporarily simplified to: Borradh calendar vs external booking link.
 */
export function StepBookingLinks({ form }: StepBookingLinksProps) {
  const currentChoice: BookingSystemChoice =
    form.watch('bookingSystemChoice') || 'borradh';

  const selectOption = (id: BookingSystemChoice) => {
    form.setValue('bookingSystemChoice', id, { shouldDirty: true });

    if (id === 'borradh') {
      form.setValue('bookingLink', '', { shouldDirty: true });
    }
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">How do you handle bookings?</h1>
        <p className="text-muted-foreground">
          Choose to use our built-in calendar or link your existing booking
          system.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {BOOKING_OPTIONS.map((option) => {
          const isSelected = currentChoice === option.id;

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

      {/* Inline booking link input for external system */}
      {currentChoice === 'not_listed' && (
        <Field>
          <FieldLabel>Your booking page link</FieldLabel>
          <Input
            type="url"
            placeholder="https://your-booking-system.com/..."
            value={form.watch('bookingLink') || ''}
            onChange={(e) =>
              form.setValue('bookingLink', e.target.value || '', {
                shouldDirty: true,
              })
            }
          />
        </Field>
      )}
    </FieldGroup>
  );
}
