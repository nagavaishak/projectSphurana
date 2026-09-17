import { format } from 'date-fns';
import { CalendarX2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  type AppointmentStatus,
  appointmentStatusLabels,
} from '@borradh-workspace/api-client/types';
import type { LeadProfileAppointment } from '../api';

const statusBadgeClass: Record<AppointmentStatus, string> = {
  booked:
    'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  confirmed:
    'border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  arrived:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  started:
    'border-transparent bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  completed:
    'border-transparent bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  no_show:
    'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  cancelled: 'border-transparent bg-muted text-muted-foreground',
  // Dashed, not solid: a hold is provisional and releases itself if it is never
  // confirmed, so it should not read as a settled booking at a glance.
  held: 'border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};

/**
 * Bookings tab — the lead's appointments (most recent first), with the
 * booked service and status. Read-only; managing appointments stays in the
 * calendar.
 */
export function PatientBookingsTab({
  appointments,
}: {
  appointments: LeadProfileAppointment[];
}) {
  if (appointments.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarX2 />
          </EmptyMedia>
          <EmptyTitle>No bookings yet</EmptyTitle>
          <EmptyDescription>
            Appointments booked for this patient will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Service</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {appointments.map((appointment) => {
            const start = new Date(appointment.startDate);
            const end = new Date(appointment.endDate);
            return (
              <TableRow key={appointment.id}>
                <TableCell>
                  <p className="font-medium">
                    {format(start, 'EEE d MMM yyyy')}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {format(start, 'HH:mm')}–{format(end, 'HH:mm')}
                  </p>
                </TableCell>
                <TableCell>
                  {appointment.serviceName ?? appointment.title}
                </TableCell>
                <TableCell>
                  <Badge
                    className={cn(
                      'text-xs',
                      statusBadgeClass[appointment.status]
                    )}
                  >
                    {appointmentStatusLabels[appointment.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
