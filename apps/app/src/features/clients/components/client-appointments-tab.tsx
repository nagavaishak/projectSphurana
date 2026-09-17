import { format } from 'date-fns';
import { CalendarClock, CalendarX2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  type AppointmentStatus,
  type AppointmentWithRelations,
  appointmentStatusLabels,
} from '@borradh-workspace/api-client/types';
import { useClientAppointments } from '../api';

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

function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <Badge className={cn('text-xs', statusBadgeClass[status])}>
      {appointmentStatusLabels[status]}
    </Badge>
  );
}

function AppointmentRow({
  appointment,
}: {
  appointment: AppointmentWithRelations;
}) {
  const start = new Date(appointment.startDate);
  const end = new Date(appointment.endDate);
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div className="min-w-0">
        <p className="truncate font-medium">{appointment.title}</p>
        <p className="text-sm text-muted-foreground">
          {format(start, 'EEE d MMM yyyy')} · {format(start, 'HH:mm')}–
          {format(end, 'HH:mm')}
        </p>
      </div>
      <AppointmentStatusBadge status={appointment.status} />
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  appointments,
}: {
  icon: typeof CalendarClock;
  title: string;
  appointments: AppointmentWithRelations[];
}) {
  if (appointments.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="size-4" />
        {title} ({appointments.length})
      </div>
      <div className="space-y-2">
        {appointments.map((a) => (
          <AppointmentRow key={a.id} appointment={a} />
        ))}
      </div>
    </div>
  );
}

export function ClientAppointmentsTab({ leadId }: { leadId: string }) {
  const { appointments, isLoading, isError } = useClientAppointments(leadId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Failed to load appointments.
      </p>
    );
  }

  if (appointments.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarX2 />
          </EmptyMedia>
          <EmptyTitle>No appointments yet</EmptyTitle>
          <EmptyDescription>
            Appointments booked with this client will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const now = Date.now();
  const upcoming = appointments
    .filter((a) => new Date(a.startDate).getTime() >= now)
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );
  const past = appointments
    .filter((a) => new Date(a.startDate).getTime() < now)
    .sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );

  return (
    <div className="space-y-6">
      <Section icon={CalendarClock} title="Upcoming" appointments={upcoming} />
      <Section icon={CalendarX2} title="Past" appointments={past} />
    </div>
  );
}
