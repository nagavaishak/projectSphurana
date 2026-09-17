import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { CalendarDays, CheckCircle2, Clock } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

interface Step4BookingSystemProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
  onConnectCalendly: () => void;
  isConnectingCalendly?: boolean;
}

interface BookingOption {
  id: 'calendly' | 'phorest' | 'none';
  name: string;
  description: string;
  icon: typeof CalendarDays;
  connectable: boolean;
  comingSoon?: boolean;
}

const BOOKING_OPTIONS: BookingOption[] = [
  {
    id: 'calendly',
    name: 'Calendly',
    description: 'Connect your Calendly account to sync services and bookings.',
    icon: CalendarDays,
    connectable: true,
  },
  {
    id: 'phorest',
    name: 'Phorest',
    description: 'Connect your Phorest salon software.',
    icon: Clock,
    connectable: false,
    comingSoon: true,
  },
  {
    id: 'none',
    name: "I don't use one",
    description: "That's okay! You can set up booking details manually.",
    icon: Clock,
    connectable: false,
  },
];

/**
 * Step 4: Booking System
 * Choose and optionally connect a booking system.
 */
export function Step4BookingSystem({
  form,
  onConnectCalendly,
  isConnectingCalendly,
}: Step4BookingSystemProps) {
  const bookingSystem: string = form.watch('bookingSystem') || '';
  const calendlyConnected: boolean = form.watch('calendlyConnected') || false;

  const selectOption = (id: 'calendly' | 'phorest' | 'none') => {
    form.setValue('bookingSystem', id, { shouldDirty: true });
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Connect your booking system</h1>
        <p className="text-muted-foreground">
          Link your booking platform to import services and sync appointments.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {BOOKING_OPTIONS.map((option) => {
          const isSelected = bookingSystem === option.id;
          const isCalendlyConnected =
            option.id === 'calendly' && calendlyConnected;

          return (
            <div
              key={option.id}
              role="button"
              tabIndex={0}
              className={`relative flex items-center gap-4 rounded-lg border p-4 transition-colors cursor-pointer ${
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30'
              } ${option.comingSoon ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={() => {
                if (option.comingSoon) return;
                selectOption(option.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!option.comingSoon) selectOption(option.id);
                }
              }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                {isCalendlyConnected ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <option.icon className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{option.name}</span>
                  {option.comingSoon && (
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                      Coming Soon
                    </span>
                  )}
                  {isCalendlyConnected && (
                    <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full">
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {option.description}
                </p>
              </div>

              {option.id === 'calendly' && isSelected && !calendlyConnected && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isConnectingCalendly}
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnectCalendly();
                  }}
                >
                  {isConnectingCalendly ? 'Connecting...' : 'Connect'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </FieldGroup>
  );
}
