import { useNavigate, useParams } from '@tanstack/react-router';
import { differenceInMinutes, format, parse } from 'date-fns';
import {
  Loader2,
  Maximize2Icon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { useSidePanel } from '@/components/app/side-panel';
import type { IEvent, IUser } from '@/components/calendar/interfaces';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  AppointmentQuickActions,
  type AppointmentStatus,
  AppointmentStatusProgression,
  DepositBadge,
  DepositDetailRow,
  appointmentStatusLabels,
  readDepositFromMetadata,
} from '@/features/appointments';
import {
  appointmentEditStaffOptions,
  currentAppointmentPractitionerId,
} from '@/features/appointments/edit';
import { useActiveOrganization } from '@/features/organization';
import { useCheckoutStore } from '@/features/sales';
import { zonedEvent, zonedWallTimeToUtc } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { CreditCardIcon } from 'lucide-react';

import { AppointmentResourcePanelRow } from '@/features/resources/booking';

function colorBar(color: IEvent['color']): string {
  switch (color) {
    case 'blue':
      return 'bg-blue-500';
    case 'green':
      return 'bg-green-500';
    case 'red':
      return 'bg-red-500';
    case 'yellow':
      return 'bg-yellow-500';
    case 'purple':
      return 'bg-purple-500';
    case 'orange':
      return 'bg-orange-500';
    case 'gray':
      return 'bg-gray-400';
    default:
      return 'bg-muted-foreground/40';
  }
}

interface FormData {
  date: string;
  time: string;
  assignedToId: string;
  notes: string;
}

export interface AppointmentSidePanelProps {
  event: IEvent;
  /** Practitioners/staff the appointment can be assigned to. */
  users: IUser[];
  /** Commit an updated event through the calendar's canonical update path. */
  onCommit: (event: IEvent) => Promise<void> | void;
  /** Delete/cancel the appointment. */
  onDelete: (event: IEvent) => Promise<void> | void;
}

/**
 * Inline (non-modal) side-panel body for viewing and editing an appointment.
 * Editable: date/time, assigned staff, and notes. Service and status are shown
 * read-only. Updates flow through the injected `onCommit` so the calendar's
 * optimistic update + reschedule mapping stay intact.
 */
export function AppointmentSidePanel({
  event,
  users,
  onCommit,
  onDelete,
}: AppointmentSidePanelProps) {
  const { close } = useSidePanel();
  const navigate = useNavigate();
  // `strict: false` because this panel is rendered from several calendar
  // views; the branch param is present in all of them.
  const { locationId } = useParams({ strict: false });
  const openCheckout = useCheckoutStore((s) => s.openCheckout);
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const startDate = zonedEvent(event.startDate, timeZone);
  const endDate = zonedEvent(event.endDate, timeZone);
  const durationMinutes = differenceInMinutes(endDate, startDate);

  const [status, setStatus] = useState<AppointmentStatus | undefined>(
    typeof event.metadata?.status === 'string'
      ? (event.metadata.status as AppointmentStatus)
      : undefined
  );
  const serviceName =
    (event.metadata?.serviceName as string | undefined) ?? event.title;
  const deposit = readDepositFromMetadata(event.metadata);

  const goToCheckout = () => {
    close();
    openCheckout({
      appointmentId: String(event.id),
      appointmentName: serviceName,
    });
  };

  // Staff options + the current selection are resolved by PRACTITIONER id
  // through the shared edit core — the same helpers the desktop edit dialog and
  // mobile sheet use. Keying on `event.user.id` (the owning USER id) here would
  // never match the practitioner-keyed `users` list, so the panel would always
  // prepend a synthetic "current assignee" and show the booked staff twice.
  const staffOptions = appointmentEditStaffOptions(event, users);
  const currentPractitionerId = currentAppointmentPractitionerId(event, users);

  const form = useForm<FormData>({
    defaultValues: {
      date: format(startDate, 'yyyy-MM-dd'),
      time: format(startDate, 'HH:mm'),
      assignedToId: currentPractitionerId,
      notes: event.description || '',
    },
  });

  const onSubmit = async (data: FormData) => {
    if (!form.formState.isDirty) {
      close();
      return;
    }

    const [year, month, day] = data.date.split('-').map(Number);
    const [hours, minutes] = data.time.split(':').map(Number);
    // Picked wall-clock is in the business timezone → real instant.
    const newStart = zonedWallTimeToUtc(
      new Date(year, month - 1, day),
      hours,
      minutes,
      timeZone
    );
    const newEnd = new Date(newStart.getTime() + durationMinutes * 60 * 1000);

    // The Select carries a PRACTITIONER id. Map it to BOTH the owning user id
    // (`user.id` → assignedToId) and the practitioner id
    // (`metadata.practitionerId`), so a practitioner id never lands in the user
    // FK — mirrors `applyAppointmentEdit` in the shared edit core.
    const selected = users.find((u) => u.id === data.assignedToId);
    const user = selected
      ? {
          id: selected.userId ?? '',
          name: selected.name,
          picturePath: selected.picturePath ?? null,
          userId: selected.userId ?? null,
          color: selected.color ?? null,
        }
      : event.user;
    const metadata = selected
      ? { ...event.metadata, practitionerId: selected.id }
      : event.metadata;

    setIsSaving(true);
    try {
      await onCommit({
        ...event,
        user,
        metadata,
        description: data.notes,
        startDate: newStart.toISOString(),
        endDate: newEnd.toISOString(),
      });
      close();
    } finally {
      setIsSaving(false);
    }
  };

  const openFullView = () => {
    if (!locationId) return;
    close();
    navigate({
      to: '/dashboard/l/$locationId/calendar/appointment/$appointmentId',
      params: { locationId, appointmentId: String(event.id) },
    });
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(event);
      close();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex h-full min-h-0 flex-col"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold">{event.title}</h2>
            {status && (
              <Badge variant="outline" className="shrink-0">
                {appointmentStatusLabels[status] ?? status}
              </Badge>
            )}
            <DepositBadge deposit={deposit} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(startDate, 'EEE d MMM')} · {format(startDate, 'HH:mm')} ·{' '}
            {durationMinutes} min
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <AppointmentQuickActions
            appointmentId={String(event.id)}
            status={status ?? 'booked'}
            startDate={event.startDate}
            endDate={event.endDate}
            onDone={close}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            onClick={close}
            aria-label="Close panel"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {/* Service — read-only */}
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs font-medium text-muted-foreground">Service</p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={cn(
                'h-8 w-1 shrink-0 rounded-full',
                colorBar(event.color)
              )}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{serviceName}</p>
              <p className="text-xs text-muted-foreground">
                {durationMinutes} min
              </p>
            </div>
          </div>
        </div>

        <DepositDetailRow deposit={deposit} />

        {status && (
          <AppointmentStatusProgression
            appointmentId={String(event.id)}
            status={status}
            onLocalChange={setStatus}
          />
        )}

        <Controller
          name="assignedToId"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel>Staff</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select staff" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <Controller
            name="date"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Date</FieldLabel>
                <DatePicker
                  id={field.name}
                  placeholder="Select date"
                  value={
                    field.value
                      ? parse(field.value, 'yyyy-MM-dd', new Date())
                      : undefined
                  }
                  onChange={(date) =>
                    field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                  }
                />
              </Field>
            )}
          />
          <Controller
            name="time"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Start time</FieldLabel>
                <Input {...field} id={field.name} type="time" />
              </Field>
            )}
          />
        </div>

        <Controller
          name="notes"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Notes</FieldLabel>
              <Textarea
                {...field}
                id={field.name}
                rows={4}
                placeholder="Add notes about this appointment..."
              />
            </Field>
          )}
        />

        {/*
          Rooms & equipment — LAST in the panel, deliberately.

          It is the least-edited thing here and the only section that is
          irrelevant to most bookings, so sitting above Staff/Date/Notes it
          pushed the fields the front desk actually changes below the fold.
          It also renders nothing at all for an org with no resource
          categories, and an empty slot mid-panel is a hole; at the end it is
          simply absent.
        */}
        <AppointmentResourcePanelRow
          appointmentId={String(event.id)}
          serviceId={
            typeof event.metadata?.serviceId === 'string'
              ? event.metadata.serviceId
              : null
          }
          startDate={event.startDate}
          endDate={event.endDate}
        />
      </div>

      {/* Footer */}
      {/*
        WRAPS. Restoring "Cancel booking" made this a four-button row in a
        narrow panel, and the overflow pushed Save out of view entirely — it
        was still in the DOM, which is why only an e2e caught it. Two rows on
        a narrow panel beats a Save nobody can reach.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
        {/*
          Opens the appointment's own page. The panel stays the place you skim
          and edit without losing the day; the page is where you read the
          clinical note, the payment history and the consent trail it has no
          room for. Cancelling is available in BOTH places: here for the quick
          case, and on the page where §10.4's fee policy has room to explain
          itself.
        */}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openFullView}
          >
            <Maximize2Icon className="size-4" />
            View full screen
          </Button>
          {/* Cancelling from the day view is a receptionist's ordinary
              Tuesday, and moving it to the full page made a common action
              cost a navigation. It sits on the LEFT, away from Save — and the
              confirm dialog, which names what is lost, is the real protection
              against a mis-click. Removing the button entirely was heavier
              than the problem. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2Icon className="size-4" />
            Cancel booking
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goToCheckout}
          >
            <CreditCardIcon className="size-4" />
            Checkout
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!form.formState.isDirty || isSaving}
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SaveIcon className="size-4" />
            )}
            {isSaving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </div>

      <ConfirmDeleteDialog
        cancelLabel="Keep"
        confirmLabel="Cancel booking"
        description="The booking is removed from the calendar and the client’s history. This can’t be undone."
        isPending={isDeleting}
        onConfirm={handleDelete}
        onOpenChange={setShowDeleteConfirm}
        open={showDeleteConfirm}
        title="Cancel this booking?"
      />
    </form>
  );
}
