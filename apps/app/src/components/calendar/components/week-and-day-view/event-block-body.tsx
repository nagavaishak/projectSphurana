import { type VariantProps, cva } from 'class-variance-authority';
import { differenceInMinutes, format } from 'date-fns';

import { HOUR_PX } from '@/components/calendar/constants';
import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { zonedEvent } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import type { IEvent } from '@/components/calendar/interfaces';
import type { TBadgeVariant } from '@/components/calendar/types';

export const eventBlockBodyVariants = cva(
  'flex select-none flex-col gap-0.5 truncate whitespace-nowrap rounded-md border px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  {
    variants: {
      color: {
        // Colored and mixed variants
        blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 [&_.event-dot]:fill-blue-600',
        green:
          'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300 [&_.event-dot]:fill-green-600',
        red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300 [&_.event-dot]:fill-red-600',
        yellow:
          'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300 [&_.event-dot]:fill-yellow-600',
        purple:
          'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300 [&_.event-dot]:fill-purple-600',
        orange:
          'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300 [&_.event-dot]:fill-orange-600',
        gray: 'border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 [&_.event-dot]:fill-neutral-600',

        // Dot variants
        'blue-dot':
          'bg-neutral-50 dark:bg-neutral-900 [&_.event-dot]:fill-blue-600',
        'green-dot':
          'bg-neutral-50 dark:bg-neutral-900 [&_.event-dot]:fill-green-600',
        'red-dot':
          'bg-neutral-50 dark:bg-neutral-900 [&_.event-dot]:fill-red-600',
        'orange-dot':
          'bg-neutral-50 dark:bg-neutral-900 [&_.event-dot]:fill-orange-600',
        'purple-dot':
          'bg-neutral-50 dark:bg-neutral-900 [&_.event-dot]:fill-purple-600',
        'yellow-dot':
          'bg-neutral-50 dark:bg-neutral-900 [&_.event-dot]:fill-yellow-600',
        'gray-dot':
          'bg-neutral-50 dark:bg-neutral-900 [&_.event-dot]:fill-neutral-600',
      },
    },
    defaultVariants: {
      color: 'blue-dot',
    },
  }
);

interface EventBlockBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  event: IEvent;
  badgeVariant?: TBadgeVariant;
}

/**
 * Pure visual render of a week/day-view event card. Takes its colour, title,
 * and time labels from the event. Reused both by `EventBlock` (the live grid
 * item) and by `CustomDragLayer` (the drag preview, with a computed event
 * carrying the snapped time so the labels update as you drag).
 */
export function EventBlockBody({
  event,
  badgeVariant = 'colored',
  className,
  ...rest
}: EventBlockBodyProps) {
  const { timeZone } = useCalendar();
  const start = zonedEvent(event.startDate, timeZone);
  const end = zonedEvent(event.endDate, timeZone);
  const durationInMinutes = differenceInMinutes(end, start);
  const heightInPixels = (durationInMinutes / 60) * HOUR_PX - 8;

  const isUnavailability = event.metadata?.type === 'unavailability';
  // Practitioner-specific unavailability inherits the practitioner's color
  // (stripes use currentColor, so the hatching tints automatically).
  // Org-wide unavailability stays neutral gray.
  const baseColor = isUnavailability
    ? (event.user?.color ?? 'gray')
    : (event.user?.color ?? event.color);

  const color = (
    badgeVariant === 'dot' ? `${baseColor}-dot` : baseColor
  ) as VariantProps<typeof eventBlockBodyVariants>['color'];

  const classes = cn(
    eventBlockBodyVariants({ color, className }),
    durationInMinutes < 35 && 'py-0 justify-center',
    isUnavailability && 'bg-unavailability-stripes'
  );

  return (
    <div
      className={classes}
      style={{ height: `${heightInPixels}px` }}
      {...rest}
    >
      <div className="flex items-center gap-1.5 truncate">
        {['mixed', 'dot'].includes(badgeVariant) && (
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            className="event-dot shrink-0"
            aria-hidden="true"
          >
            <circle cx="4" cy="4" r="4" />
          </svg>
        )}

        <p className="truncate font-semibold">{event.title}</p>
      </div>

      {durationInMinutes > 25 && (
        <p>
          {format(start, 'h:mm a')} - {format(end, 'h:mm a')}
        </p>
      )}
    </div>
  );
}
