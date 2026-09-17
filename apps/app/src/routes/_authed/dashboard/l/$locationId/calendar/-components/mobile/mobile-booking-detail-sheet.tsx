import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { CreditCardIcon, Loader2, SaveIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Drawer } from 'vaul';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { isTimeBlockEvent, useCalendar } from '@/components/calendar';
import { useUpdateEvent } from '@/components/calendar/hooks/use-update-event';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  AppointmentEditFields,
  type AppointmentEditFormData,
  applyAppointmentEdit,
  appointmentEditDefaults,
  appointmentEditSchema,
  appointmentEditStaffOptions,
  appointmentEventDuration,
} from '@/features/appointments/edit';
import { useCheckoutStore } from '@/features/sales';
import {
  MobileBlockedTimeForm,
  blockedTimeTargetFromEvent,
} from '@/features/scheduling';
import { zonedEvent } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import type { IEvent } from '@/components/calendar/interfaces';

interface MobileBookingDetailSheetProps {
  event: IEvent;
  children: React.ReactNode;
}

/**
 * Mobile-only detail/edit bottom sheet. Conforms to
 * ICalendarConfig.customEventDetailsDialog — opened by tapping an event.
 *
 * Time BLOCKS route to the SHARED blocked-time editor (edit + delete, with the
 * type preset, multi-practitioner selection and recurrence). Appointments get an
 * explicit SAVE — the old sheet fire-and-forgot every field change, so a save
 * the server rejected left the stale value on screen — plus the same status
 * progression, no-show, quick actions and CHECKOUT the desktop side-panel has.
 */
export function MobileBookingDetailSheet({
  event,
  children,
}: MobileBookingDetailSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>{children}</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[100] bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[100] flex max-h-[92dvh] flex-col overflow-hidden rounded-t-[22px] border-t border-border bg-background pb-[max(16px,env(safe-area-inset-bottom,0px))] pt-2.5 outline-none">
          <div className="flex shrink-0 flex-col items-center pt-0.5 pb-1">
            <div
              className="h-1 w-8 shrink-0 rounded-full bg-muted-foreground/30"
              aria-hidden
            />
          </div>
          {open &&
            (isTimeBlockEvent(event) ? (
              <BlockedTimeBody event={event} onClose={() => setOpen(false)} />
            ) : (
              <AppointmentBody event={event} onClose={() => setOpen(false)} />
            ))}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// =============================================================================
// Time block — shared blocked-time editor (edit + delete)
// =============================================================================

function BlockedTimeBody({
  event,
  onClose,
}: {
  event: IEvent;
  onClose: () => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const formId = 'mobile-edit-block';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-2 pb-3">
        <Drawer.Title className="text-xl font-bold leading-tight">
          {event.title}
        </Drawer.Title>
        <Badge variant="outline" className="mt-1 rounded-full">
          Blocked
        </Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <MobileBlockedTimeForm
          formId={formId}
          editing={blockedTimeTargetFromEvent(event)}
          onPendingChange={setIsSaving}
          onSaved={onClose}
          onDeleted={onClose}
        />
      </div>

      <div className="border-t border-border px-5 pt-3 pb-2">
        <Button
          type="submit"
          form={formId}
          disabled={isSaving}
          className="h-12 w-full rounded-full"
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SaveIcon className="size-4" />
          )}
          {isSaving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Appointment — explicit save + status / quick actions / checkout
// =============================================================================

function AppointmentBody({
  event,
  onClose,
}: {
  event: IEvent;
  onClose: () => void;
}) {
  const { users, config, timeZone } = useCalendar();
  const { updateEvent } = useUpdateEvent();
  const openCheckout = useCheckoutStore((s) => s.openCheckout);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const startDate = zonedEvent(event.startDate, timeZone);
  const context = { users, timeZone };
  const durationMinutes = appointmentEventDuration(event, timeZone);

  const [status, setStatus] = useState<AppointmentStatus | undefined>(
    typeof event.metadata?.status === 'string'
      ? (event.metadata.status as AppointmentStatus)
      : undefined
  );
  const serviceName =
    (event.metadata?.serviceName as string | undefined) ?? event.title;
  const deposit = readDepositFromMetadata(event.metadata);

  // Keep the currently-assigned person selectable even if they're no longer in
  // the active practitioner list. Same resolution as the desktop dialog.
  const staffOptions = appointmentEditStaffOptions(event, users);

  const form = useForm<AppointmentEditFormData>({
    resolver: zodResolver(appointmentEditSchema),
    defaultValues: appointmentEditDefaults(event, context),
  });

  /**
   * Explicit save. `updateEvent` reverts its optimistic update and RE-THROWS on
   * a rejected save, so we must catch: surface the failure and keep the sheet
   * open with the user's edits rather than pretending the change stuck.
   */
  const onSubmit = async (data: AppointmentEditFormData) => {
    if (!form.formState.isDirty) {
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      await updateEvent(applyAppointmentEdit(event, data, context));
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save changes'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!config.onDeleteEvent) return;
    setIsDeleting(true);
    try {
      await config.onDeleteEvent(event);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to cancel booking'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const goToCheckout = () => {
    onClose();
    openCheckout({
      appointmentId: String(event.id),
      appointmentName: serviceName,
    });
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-2 pb-3">
        <div className="min-w-0 flex-1">
          <Drawer.Title className="truncate text-xl font-bold leading-tight">
            {event.title}
          </Drawer.Title>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(startDate, 'EEE d MMM')} · {format(startDate, 'HH:mm')} ·{' '}
            {durationMinutes} min
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && (
            <Badge variant="outline" className="rounded-full">
              {appointmentStatusLabels[status] ?? status}
            </Badge>
          )}
          <DepositBadge deposit={deposit} />
          <AppointmentQuickActions
            appointmentId={String(event.id)}
            status={status ?? 'booked'}
            startDate={event.startDate}
            endDate={event.endDate}
            onDone={onClose}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
          <Avatar className="size-10">
            {event.user.picturePath && (
              <AvatarImage src={event.user.picturePath} alt={event.user.name} />
            )}
            <AvatarFallback className="text-xs">
              {event.user.name
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{serviceName}</p>
            <p className="text-xs text-muted-foreground">{event.user.name}</p>
          </div>
          <span
            className={cn(
              'ml-auto h-8 w-1 shrink-0 rounded-full',
              colorBar(event.color)
            )}
            aria-hidden
          />
        </div>

        <DepositDetailRow deposit={deposit} />

        {status && (
          <AppointmentStatusProgression
            appointmentId={String(event.id)}
            status={status}
            onLocalChange={setStatus}
          />
        )}

        <AppointmentEditFields
          control={form.control}
          staff={staffOptions}
          currentDurationMinutes={durationMinutes}
          className="space-y-5"
        />

        {config.onDeleteEvent && (
          <ConfirmDeleteDialog
            cancelLabel="Keep"
            confirmLabel="Cancel booking"
            description="The booking is removed from the calendar and the client’s history. This can’t be undone."
            isPending={isDeleting}
            onConfirm={handleDelete}
            title="Cancel this booking?"
            trigger={
              <button
                className="flex w-full items-center justify-center gap-2 rounded-full border border-destructive/30 py-3 text-sm font-semibold text-destructive active:bg-destructive/5 disabled:opacity-50"
                disabled={isDeleting}
                type="button"
              >
                {isDeleting ? 'Cancelling…' : 'Cancel booking'}
              </button>
            }
          />
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 pt-3 pb-2">
        <Button
          type="button"
          variant="outline"
          className="h-12 flex-1 rounded-full"
          onClick={goToCheckout}
        >
          <CreditCardIcon className="size-4" />
          Checkout
        </Button>
        <Button
          type="submit"
          className="h-12 flex-1 rounded-full"
          disabled={!form.formState.isDirty || isSaving}
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SaveIcon className="size-4" />
          )}
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

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
