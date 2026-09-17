import { cn } from '@/lib/utils';

import type { PatientBooking } from './api/types';

type BookingStatus = PatientBooking['status'];

export const PATIENT_BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  booked: 'Booked',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  started: 'Started',
  completed: 'Completed',
  no_show: 'No show',
  cancelled: 'Cancelled',
};

/** Soft tinted tone per status — matches the house status-badge palette. */
const STATUS_TONE: Record<BookingStatus, string> = {
  booked: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  confirmed: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  arrived: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  started: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  completed:
    'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  no_show: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

/**
 * Booking status as a soft tinted pill (not a solid badge). Booked/confirmed
 * read as blue, in-progress as amber, completed as green, and
 * cancelled/no-show as red.
 */
export function PortalStatusBadge({
  status,
  className,
}: {
  status: BookingStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_TONE[status],
        className
      )}
    >
      {PATIENT_BOOKING_STATUS_LABELS[status]}
    </span>
  );
}
