import { format } from 'date-fns';
import { Calendar, Clock, DoorOpen, Text, User } from 'lucide-react';
import { useState } from 'react';

import { EditEventDialog } from '@/components/calendar/components/dialogs/edit-event-dialog';
import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { zonedEvent } from '@/lib/timezone';

import type { IEvent } from '@/components/calendar/interfaces';

interface IProps {
  event: IEvent;
  children: React.ReactNode;
}

export function EventDetailsDialog({ event, children }: IProps) {
  const { config } = useCalendar();

  // Delegate to custom dialog if configured
  if (config.customEventDetailsDialog) {
    const CustomDialog = config.customEventDetailsDialog;
    return <CustomDialog event={event}>{children}</CustomDialog>;
  }

  return (
    <DefaultEventDetailsDialog event={event}>
      {children}
    </DefaultEventDetailsDialog>
  );
}

/**
 * Built-in event details dialog. Custom `customEventDetailsDialog` hosts should
 * render this on desktop (or whenever they need the default UI) to avoid
 * delegating back through `EventDetailsDialog` and recursing infinitely.
 */
export function DefaultEventDetailsDialog({ event, children }: IProps) {
  const { config, timeZone } = useCalendar();
  const ExtraDetails = config.eventDetailsExtra;
  const startDate = zonedEvent(event.startDate, timeZone);
  const endDate = zonedEvent(event.endDate, timeZone);
  // Blocked time (and legacy unavailability) use the host-supplied edit dialog
  // and delete callback instead of the built-in appointment editor.
  const isTimeBlock =
    event.metadata?.type === 'blocked-time' ||
    event.metadata?.type === 'unavailability';

  // A rooms-calendar block is an ALLOCATION: `event.user` is the room, and the
  // person the booking is for lives in metadata. Naming the room "Responsible"
  // reads as a staff label, and the block's end carries the turnaround tail.
  const isResourceBlock =
    event.metadata?.type === 'resource-allocation' ||
    event.metadata?.type === 'resource-unassigned';
  const clientName =
    typeof event.metadata?.clientName === 'string'
      ? event.metadata.clientName
      : null;
  const appointmentEnd =
    typeof event.metadata?.appointmentEndDate === 'string'
      ? event.metadata.appointmentEndDate
      : null;
  const shownEndDate = appointmentEnd
    ? zonedEvent(appointmentEnd, timeZone)
    : endDate;
  const personLabel = isTimeBlock
    ? 'Applies to'
    : isResourceBlock
      ? 'Room'
      : 'Responsible';

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {clientName && (
            <div className="flex items-start gap-2">
              <User className="mt-1 size-4 shrink-0" />
              <div>
                <p className="text-sm font-medium">Client</p>
                <p className="text-sm text-muted-foreground">{clientName}</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2">
            {isResourceBlock ? (
              <DoorOpen className="mt-1 size-4 shrink-0" />
            ) : (
              <User className="mt-1 size-4 shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium">{personLabel}</p>
              <p className="text-sm text-muted-foreground">{event.user.name}</p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Calendar className="mt-1 size-4 shrink-0" />
            <div>
              <p className="text-sm font-medium">Start Date</p>
              <p className="text-sm text-muted-foreground">
                {format(startDate, 'MMM d, yyyy h:mm a')}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Clock className="mt-1 size-4 shrink-0" />
            <div>
              <p className="text-sm font-medium">End Date</p>
              <p className="text-sm text-muted-foreground">
                {format(shownEndDate, 'MMM d, yyyy h:mm a')}
              </p>
            </div>
          </div>

          {event.description && (
            <div className="flex items-start gap-2">
              <Text className="mt-1 size-4 shrink-0" />
              <div>
                <p className="text-sm font-medium">Description</p>
                <p className="text-sm text-muted-foreground">
                  {event.description}
                </p>
              </div>
            </div>
          )}
          {ExtraDetails && <ExtraDetails event={event} />}
        </div>

        <DialogFooter>
          {isTimeBlock ? (
            <>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => config.onDeleteEvent?.(event)}
                >
                  Delete
                </Button>
              </DialogClose>
              {config.customEditDialog ? (
                <UnavailabilityEditTrigger
                  event={event}
                  EditDialog={config.customEditDialog}
                />
              ) : null}
            </>
          ) : (
            <EditEventDialog event={event}>
              <Button type="button" variant="outline">
                Edit
              </Button>
            </EditEventDialog>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Renders an "Edit" button that opens the host-provided edit dialog for an
 * unavailability event. The host (e.g. appointments-provider) supplies the
 * dialog component via `config.customEditDialog` so the calendar package
 * stays decoupled from the practitioner-unavailability feature.
 */
function UnavailabilityEditTrigger({
  event,
  EditDialog,
}: {
  event: IEvent;
  EditDialog: NonNullable<
    ReturnType<typeof useCalendar>['config']['customEditDialog']
  >;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && <EditDialog event={event} onClose={() => setOpen(false)} />}
    </>
  );
}
