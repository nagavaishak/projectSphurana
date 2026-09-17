import { useQuery } from '@tanstack/react-query';
import { differenceInMinutes, format, parse } from 'date-fns';
import { MoreVerticalIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useActiveOrganization } from '@/features/organization/api/get-active-organization';
import { zonedEvent, zonedWallTimeToUtc } from '@/lib/timezone';

import { useDeleteAppointment } from '../api/delete-appointment';
import { getAppointmentQueryOptions } from '../api/get-appointment';
import type { AppointmentStatus } from '../api/types';
import { useUpdateAppointment } from '../api/update-appointment';
import { appointmentEditForm } from '../edit';

export interface AppointmentQuickActionsProps {
  appointmentId: string;
  status: AppointmentStatus;
  /** Appointment start as an ISO string (real UTC instant). */
  startDate: string;
  /** Appointment end as an ISO string (real UTC instant). */
  endDate: string;
  /** Called after any action (update/reschedule/no-show/cancel) succeeds. */
  onDone?: () => void;
  /** Extra menu entries rendered at the bottom (e.g. New sale / Close checkout). */
  extraItems?: React.ReactNode;
}

/**
 * Fresha-style "Quick actions" ⋮ menu for an appointment. Reuses the existing
 * update/delete hooks — no new backend. Actions: Add a note, Reschedule,
 * No-show, Cancel. Optional `extraItems` are appended below a separator.
 */
export function AppointmentQuickActions({
  appointmentId,
  status,
  startDate,
  endDate,
  onDone,
  extraItems,
}: AppointmentQuickActionsProps) {
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';

  const [noteOpen, setNoteOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const afterSuccess = () => {
    setNoteOpen(false);
    setRescheduleOpen(false);
    onDone?.();
  };

  const { updateAppointment, isUpdating } = useUpdateAppointment({
    onSuccess: afterSuccess,
  });
  const { deleteAppointment, isDeleting } = useDeleteAppointment({
    onSuccess: () => {
      setCancelOpen(false);
      onDone?.();
    },
  });

  // ----- Add a note ---------------------------------------------------------
  // Seed from the appointment's current note (`description`). Fetch lazily only
  // when the note dialog is open; the query is cached so it's usually instant.
  const noteQuery = useQuery({
    ...getAppointmentQueryOptions(appointmentId),
    enabled: noteOpen,
  });
  const [note, setNote] = useState('');
  const seededRef = useRef(false);
  useEffect(() => {
    if (!noteOpen) {
      seededRef.current = false;
      return;
    }
    if (!seededRef.current && noteQuery.data) {
      setNote(noteQuery.data.description ?? '');
      seededRef.current = true;
    }
  }, [noteOpen, noteQuery.data]);

  const saveNote = () => {
    updateAppointment({ id: appointmentId, description: note });
  };

  // ----- Reschedule ---------------------------------------------------------
  const start = zonedEvent(startDate, timeZone);
  const end = zonedEvent(endDate, timeZone);
  const durationMinutes = Math.max(differenceInMinutes(end, start), 0);

  const [date, setDate] = useState(() => format(start, 'yyyy-MM-dd'));
  const [time, setTime] = useState(() => format(start, 'HH:mm'));

  const openReschedule = () => {
    // Re-seed from the current start each time the dialog opens.
    setDate(format(start, 'yyyy-MM-dd'));
    setTime(format(start, 'HH:mm'));
    setRescheduleOpen(true);
  };

  const saveReschedule = () => {
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    if (!year || !month || !day || Number.isNaN(hours) || Number.isNaN(minutes))
      return;
    // Picked wall-clock is in the business timezone → real UTC instant.
    const newStart = zonedWallTimeToUtc(
      new Date(year, month - 1, day),
      hours,
      minutes,
      timeZone
    );
    const newEnd = new Date(newStart.getTime() + durationMinutes * 60 * 1000);
    updateAppointment({
      id: appointmentId,
      startDate: newStart.toISOString(),
      endDate: newEnd.toISOString(),
    });
  };

  // ----- No-show ------------------------------------------------------------
  const markNoShow = () => {
    if (status === 'no_show') return;
    updateAppointment({ id: appointmentId, status: 'no_show' });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 rounded-full"
            aria-label="Quick actions"
          >
            <MoreVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setNoteOpen(true)}>
            Add a note
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openReschedule}>
            Reschedule
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={status === 'no_show'}
            onSelect={markNoShow}
          >
            No-show
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setCancelOpen(true)}
          >
            Cancel
          </DropdownMenuItem>
          {extraItems ? (
            <>
              <DropdownMenuSeparator />
              {extraItems}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Add a note */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a note</DialogTitle>
            <DialogDescription>
              Notes are saved to this appointment.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="quick-action-note">Note</FieldLabel>
            <Textarea
              id="quick-action-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note about this appointment..."
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setNoteOpen(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button type="button" onClick={saveNote} disabled={isUpdating}>
              {isUpdating ? 'Saving...' : 'Save note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule appointment</DialogTitle>
            <DialogDescription>
              Pick a new date and time. The duration ({durationMinutes} min) is
              preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="quick-action-date">
                {appointmentEditForm.labels.date}
              </FieldLabel>
              <DatePicker
                id="quick-action-date"
                placeholder="Select date"
                value={date ? parse(date, 'yyyy-MM-dd', new Date()) : undefined}
                onChange={(d) => setDate(d ? format(d, 'yyyy-MM-dd') : '')}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="quick-action-time">
                {appointmentEditForm.labels.startTime}
              </FieldLabel>
              <Input
                id="quick-action-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRescheduleOpen(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveReschedule}
              disabled={isUpdating || !date || !time}
            >
              {isUpdating ? 'Saving...' : 'Reschedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        cancelLabel="Keep"
        confirmLabel="Cancel booking"
        description="The booking is removed from the calendar and the client’s history. This can’t be undone."
        isPending={isDeleting}
        onConfirm={() => deleteAppointment(appointmentId)}
        onOpenChange={setCancelOpen}
        open={cancelOpen}
        title="Cancel this booking?"
      />
    </>
  );
}
