import { zodResolver } from '@hookform/resolvers/zod';
import { SaveIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { useUpdateEvent } from '@/components/calendar/hooks/use-update-event';
import { useDisclosure } from '@/hooks/use-disclosure';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AppointmentEditFields,
  type AppointmentEditFormData,
  applyAppointmentEdit,
  appointmentEditDefaults,
  appointmentEditSchema,
  appointmentEditStaffOptions,
  appointmentEventDuration,
} from '@/features/appointments/edit';

import type { IEvent } from '@/components/calendar/interfaces';

interface IProps {
  children: React.ReactNode;
  event: IEvent;
}

/**
 * DESKTOP surface for the SHARED appointment-edit core. A calendar drag/resize
 * reaches the very same `config.onUpdateEvent`; this dialog is the typed way in.
 * Every field, its seeding and the edited event are built by
 * `@/features/appointments/edit` — the mobile booking sheet composes the same
 * pieces, so the two cannot build different bodies (see
 * `update-appointment.contract.test.tsx`).
 */
export function EditEventDialog({ children, event }: IProps) {
  const { isOpen, onClose, onToggle } = useDisclosure();
  const { users, timeZone } = useCalendar();
  const { updateEvent } = useUpdateEvent();

  const context = { users, timeZone };
  const staffOptions = appointmentEditStaffOptions(event, users);
  const durationMinutes = appointmentEventDuration(event, timeZone);

  const form = useForm<AppointmentEditFormData>({
    resolver: zodResolver(appointmentEditSchema),
    defaultValues: appointmentEditDefaults(event, context),
  });

  const handleSubmit = (data: AppointmentEditFormData) => {
    updateEvent(applyAppointmentEdit(event, data, context));
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onToggle}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Appointment</DialogTitle>
          <DialogDescription>
            Make changes to your appointment here.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <AppointmentEditFields
            control={form.control}
            staff={staffOptions}
            currentDurationMinutes={durationMinutes}
            className="space-y-4"
          />

          <DialogFooter>
            <Button type="submit">
              <SaveIcon className="size-4" />
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
