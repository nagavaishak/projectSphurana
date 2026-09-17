import { zodResolver } from '@hookform/resolvers/zod';
import { SaveIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

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
  AppointmentClientField,
  type AppointmentCreateFormData,
  AppointmentDateTimeFields,
  AppointmentNotesField,
  AppointmentPractitionerField,
  AppointmentServiceField,
  DoubleBookingConfirmDialog,
  appointmentCreateDefaults,
  appointmentCreateSchema,
  useCreateAppointmentFlow,
} from '@/features/appointments/create';

import {
  AppointmentResourceFields,
  useAppointmentResourceSelection,
} from '@/features/resources/booking';
import { useResourceWarningToasts } from '@/features/resources/booking';

interface AddAppointmentDialogProps {
  /** Trigger element. Optional when driving the dialog via `open`. */
  children?: React.ReactNode;
  startDate?: Date;
  startTime?: { hour: number; minute: number };
  /**
   * Column the slot was clicked in. Drives the appointment's practitioner and,
   * via the practitioner record, its calendar tint color.
   */
  practitionerId?: string;
  /**
   * Room to start with, when the dialog was opened from a ROOMS calendar
   * column. Seeds that category's slot; the operator can still change it.
   */
  preselectedResourceId?: string;
  /** Controlled open state (e.g. opened from the header "Add" menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * DESKTOP surface for the SHARED appointment-create core. The clicked slot SEEDS
 * the practitioner (column) and the date/time (position), and the service fixes
 * the duration, title and colour — but every seeded value stays EDITABLE here,
 * exactly as it is in the mobile funnels.
 *
 * (It didn't used to be: `date`, `startTime` and `practitionerId` were in the
 * schema and in the payload, and the mobile funnel let you change all three,
 * while this dialog rendered no control for any of them. Opened from the staff
 * header menu — which passes a `startDate` but no `startTime` — that meant a
 * booking pinned to 00:00 with no way for the user to move it.)
 *
 * The payload is built by the shared builder, which the mobile funnels also use
 * (see create-appointment.contract.test.tsx).
 */
export function AddAppointmentDialog({
  children,
  startDate,
  startTime,
  practitionerId,
  open: controlledOpen,
  onOpenChange,
  preselectedResourceId,
}: AddAppointmentDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  };

  const { notifyResourceWarnings, resourceOverrideDialog } =
    useResourceWarningToasts();

  const {
    submit,
    isCreating,
    context,
    conflict,
    confirmDoubleBooking,
    dismissConflict,
  } = useCreateAppointmentFlow({
    // WARN-DON'T-BLOCK: a staff booking that clashed with a room's existing
    // hold still SUCCEEDED — the response just carries `resourceWarnings`.
    // Report it and offer the repair; do not treat it as a failure. A clashing
    // PRACTITIONER is the other axis and does block — that arrives as
    // `conflict`, and the confirm dialog below re-sends with consent.
    onSuccess: (appointment) => {
      notifyResourceWarnings({
        response: appointment,
        appointmentId: String(appointment.id),
        window: resources.window,
      });
      setOpen(false);
      form.reset(defaultValues);
    },
  });

  const defaultValues = useMemo(
    () =>
      appointmentCreateDefaults({
        slotDate: startDate,
        startTime,
        practitionerId,
      }),
    [startDate, startTime, practitionerId]
  );

  const form = useForm<AppointmentCreateFormData>({
    resolver: zodResolver(appointmentCreateSchema),
    defaultValues,
  });

  // Re-seed the form each time the dialog opens.
  //
  // `useForm` reads `defaultValues` ONCE, at mount. In the multi-day views
  // that is harmless because every day is its own column, so each slot's
  // dialog mounts already holding the right date. The single-day view has no
  // such remount: changing the date updates `selectedDate` and re-renders the
  // same dialog instances, so the form kept whatever date it first mounted
  // with and the appointment was created for that day instead of the one
  // clicked — silently, since the date field showed the stale value too.
  //
  // Keyed on the OPEN TRANSITION, not on `defaultValues`.
  //
  // The intent below was always "re-seed when the dialog opens, and never
  // underneath someone who is typing" — but `defaultValues` sat in the
  // dependency array, so any change to its identity while the dialog was OPEN
  // re-ran the effect and reset the form. `defaultValues` is a `useMemo` over
  // props (`startDate`, `startTime`, `practitionerId`), so an ordinary parent
  // re-render was enough.
  //
  // What that looks like to a user: you edit Start time, the field snaps back
  // to what it was, and nothing says why. Reproduced by hand — typing 17:20
  // over 16:15 left 16:15 — and it is the same shape as the intermittent
  // failure in `lead-management.spec.ts`, where a filled field comes back
  // empty and the submit is then blocked by a required-field error.
  //
  // `hasSeeded` makes the reset fire on false→true only, which is what the
  // comment always claimed.
  const hasSeeded = useRef(false);
  useEffect(() => {
    if (open && !hasSeeded.current) {
      form.reset(defaultValues);
      hasSeeded.current = true;
    } else if (!open) {
      hasSeeded.current = false;
    }
  }, [open, defaultValues, form]);

  // Rooms & equipment. Entirely inert — and renders nothing at all — for an
  // org with no resource categories, which is every clinic today.
  const resources = useAppointmentResourceSelection(
    form.control,
    preselectedResourceId,
    open
  );

  return (
    <>
      {/*
        Rendered OUTSIDE the create dialog: an AlertDialog nested inside an open
        Dialog inherits its focus trap, so the confirm buttons are unreachable.
        The create dialog deliberately stays open behind it — cancelling returns
        the user to their filled-in form rather than losing it.
      */}
      <DoubleBookingConfirmDialog
        conflict={conflict}
        onConfirm={confirmDoubleBooking}
        onCancel={dismissConflict}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}

        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create Appointment</DialogTitle>
            <DialogDescription>Book a client into this slot.</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={form.handleSubmit((values) =>
              submit(values, {
                resourceIds: resources.resourceIds,
                allowResourceOverbook: resources.overbooks,
              })
            )}
            className="space-y-4"
          >
            <AppointmentClientField control={form.control} />
            <AppointmentServiceField
              control={form.control}
              services={context.services}
              isLoading={context.isLoading}
            />
            <AppointmentPractitionerField
              control={form.control}
              practitioners={context.practitioners}
            />
            <AppointmentDateTimeFields control={form.control} />
            <AppointmentResourceFields selection={resources} />
            <AppointmentNotesField control={form.control} />

            <DialogFooter>
              <Button type="submit" disabled={isCreating}>
                <SaveIcon className="size-4" />
                {isCreating ? 'Creating...' : 'Create Appointment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/*
        Outside the Dialog: the create dialog CLOSES on success, so an override
        anchored inside it would unmount before the user could reach the toast
        that offers it.
      */}
      {resourceOverrideDialog}
    </>
  );
}
