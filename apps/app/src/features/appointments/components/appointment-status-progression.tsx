import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { type AppointmentStatus, appointmentStatusLabels } from '../api/types';
import { useUpdateAppointment } from '../api/update-appointment';
import { appointmentEditForm } from '../edit';

/**
 * Front-desk statuses selectable from the appointment detail. Ordered as the
 * booking progresses, with the exception outcomes (no-show, cancelled) last.
 */
export const APPOINTMENT_STATUS_OPTIONS: AppointmentStatus[] = [
  'booked',
  'confirmed',
  'arrived',
  'started',
  'completed',
  'no_show',
  'cancelled',
];

export interface AppointmentStatusProgressionProps {
  appointmentId: string;
  status: AppointmentStatus;
  /** Optimistically reflect the new status in the host surface. */
  onLocalChange: (next: AppointmentStatus) => void;
  className?: string;
}

/**
 * Shared status selector. Composed by the desktop side-panel AND the mobile
 * booking sheet so both viewports change a booking's status via the same
 * mutation. Rendered as a single Select rather than a row of buttons.
 */
export function AppointmentStatusProgression({
  appointmentId,
  status,
  onLocalChange,
  className,
}: AppointmentStatusProgressionProps) {
  const { updateAppointment, isUpdating } = useUpdateAppointment();

  const setStatus = (next: AppointmentStatus) => {
    if (next === status || isUpdating) return;
    onLocalChange(next);
    updateAppointment({ id: appointmentId, status: next });
  };

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs font-medium text-muted-foreground">
        {appointmentEditForm.labels.status}
      </p>
      <Select
        value={status}
        onValueChange={(next) => setStatus(next as AppointmentStatus)}
        disabled={isUpdating}
      >
        <SelectTrigger
          className="w-full"
          aria-label={appointmentEditForm.labels.status}
        >
          <SelectValue placeholder="Select status" />
        </SelectTrigger>
        <SelectContent>
          {APPOINTMENT_STATUS_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {appointmentStatusLabels[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
