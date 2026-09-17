'use client';

/**
 * The appointment full view — a real page for a single appointment.
 *
 * The calendar keeps its side panel: skimming and editing a booking without
 * losing your place in the day is what that panel is for, and a page cannot do
 * it. This is the other half — somewhere to *read* an appointment, with room
 * for the clinical note, the payment history and the consent trail that the
 * panel has no space for.
 *
 * Renders through `components/app/entity-view` (A17), the same shell as the
 * client record, so the two do not drift into different headers.
 *
 * The title is `Service (Client Name)`. The entity is the appointment; the
 * patient is who it is for. Titled with her name alone it reads as a second
 * client record.
 */

import { useNavigate } from '@tanstack/react-router';
import { differenceInMinutes, format } from 'date-fns';
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  UserIcon,
  XCircleIcon,
} from 'lucide-react';
import { useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { EntityView, EntityViewAside } from '@/components/app/entity-view';
import { StateError } from '@/components/app/state-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveOrganization } from '@/features/organization';
import { zonedEvent } from '@/lib/timezone';
import { useResolvedRoutes } from '@/lib/use-routes';

import { useDeleteAppointment } from '../api/delete-appointment/delete-appointment.hook';
import { useGetAppointment } from '../api/get-appointment/get-appointment.hook';
import { appointmentStatusLabels } from '../api/types';
import { ClinicalPanel } from './appointment-view-clinical';
import {
  ActivityPanel,
  ConsentPanel,
  PaymentsPanel,
} from './appointment-view-panels';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'clinical', label: 'Notes' },
  { id: 'payments', label: 'Payments' },
  { id: 'consent', label: 'Forms & consent' },
  { id: 'activity', label: 'Activity' },
];

export function AppointmentView({ appointmentId }: { appointmentId: string }) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { data: organization } = useActiveOrganization();
  const { appointment, isLoading, isError, refetch } =
    useGetAppointment(appointmentId);
  const [tab, setTab] = useState('overview');
  const [cancelling, setCancelling] = useState(false);
  /**
   * Cancellation lives HERE, not on the calendar side panel. The panel is for
   * skimming a day; cancelling needs room for the thing §10.4 actually asks
   * for — whether a fee applies, and who bears it — which a panel with a
   * status select and a notes box has nowhere to put.
   */
  const { deleteAppointment, isDeleting } = useDeleteAppointment({
    onSuccess: () => navigate({ to: routes.calendar }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !appointment) {
    return (
      <StateError
        message="Failed to load this appointment. Please try again."
        onRetry={() => refetch()}
      />
    );
  }

  const timeZone = organization?.timezone ?? 'UTC';
  const start = zonedEvent(appointment.startDate, timeZone);
  const end = zonedEvent(appointment.endDate, timeZone);
  const minutes = differenceInMinutes(end, start);

  const patient = appointment.lead
    ? `${appointment.lead.firstName} ${appointment.lead.lastName ?? ''}`.trim()
    : 'Walk-in';
  /**
   * `Service (Client)` only when we HAVE a service relation. Falling back to
   * `appointment.title` and appending the patient produced "Skin Consultation —
   * Niamh Murphy (Niamh Murphy)": a free-text title already names the client,
   * so it is used verbatim instead.
   */
  const serviceName = appointment.service?.name ?? null;
  const serviceLabel = serviceName ?? appointment.title ?? 'Appointment';
  const heading = serviceName ? `${serviceName} (${patient})` : serviceLabel;

  return (
    <EntityView
      config={{
        identity: {
          title: heading,
          initials: initialsFor(patient),
          subtitle: `${format(start, 'EEE d MMM')} · ${format(start, 'HH:mm')}–${format(end, 'HH:mm')}${
            appointment.assignedTo ? ` · ${appointment.assignedTo.name}` : ''
          }`,
          status: appointment.status ? (
            <Badge variant="secondary">
              {
                appointmentStatusLabels[
                  appointment.status as keyof typeof appointmentStatusLabels
                ]
              }
            </Badge>
          ) : undefined,
        },
        back: {
          label: 'Back to calendar',
          onClick: () => navigate({ to: routes.calendar }),
        },
        actions: (
          <>
            <Button size="sm" variant="outline">
              <PencilIcon className="size-3.5" />
              Reschedule
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setCancelling(true)}
                >
                  <XCircleIcon className="size-4" />
                  Cancel booking
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ),
        tabs: TABS,
        activeTab: tab,
        onTabChange: setTab,
        aside: (
          <EntityViewAside>
            <div className="space-y-3">
              <Fact
                icon={ClockIcon}
                label="Duration"
                value={`${minutes} min`}
              />
              {appointment.assignedTo ? (
                <Fact
                  icon={UserIcon}
                  label="Practitioner"
                  value={appointment.assignedTo.name}
                />
              ) : null}
              {appointment.deposit ? (
                <Fact
                  icon={CheckIcon}
                  label="Deposit"
                  value={`${formatMoney(appointment.deposit.amountCents, appointment.deposit.currency)} · ${appointment.deposit.status}`}
                />
              ) : null}
              <Fact
                icon={CalendarIcon}
                label="Booked"
                value={format(
                  zonedEvent(appointment.createdAt, timeZone),
                  'd MMM yyyy'
                )}
              />
            </div>
          </EntityViewAside>
        ),
      }}
    >
      {tab === 'overview' ? (
        <Overview
          rows={[
            {
              label: 'Service',
              value: `${serviceLabel} · ${minutes} min`,
            },
            {
              label: 'Practitioner',
              value: appointment.assignedTo?.name ?? 'Unassigned',
            },
            {
              label: 'When',
              value: `${format(start, 'EEEE d MMMM')}, ${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`,
            },
            {
              label: 'Client',
              value: appointment.lead
                ? `${patient}${appointment.lead.phone ? ` · ${appointment.lead.phone}` : ''}`
                : 'Walk-in',
            },
          ]}
        />
      ) : null}
      {tab === 'clinical' ? (
        <ClinicalPanel patient={patient} start={start} />
      ) : null}
      {tab === 'payments' ? <PaymentsPanel /> : null}
      {tab === 'consent' ? <ConsentPanel /> : null}
      {tab === 'activity' ? <ActivityPanel start={start} /> : null}

      <ConfirmDeleteDialog
        open={cancelling}
        onOpenChange={setCancelling}
        icon={XCircleIcon}
        title="Cancel this booking?"
        description={
          <>
            {patient} will be told the appointment is cancelled. The slot is
            released immediately and can be booked by someone else.
          </>
        }
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        isPending={isDeleting}
        onConfirm={() => deleteAppointment(appointmentId)}
      />
    </EntityView>
  );
}

function initialsFor(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ClockIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="break-words text-sm">{value}</p>
      </div>
    </div>
  );
}

function Overview({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-background">
      <div className="divide-y">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-4"
          >
            <span className="w-32 shrink-0 text-muted-foreground text-sm">
              {row.label}
            </span>
            <span className="min-w-0 flex-1 text-sm">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
