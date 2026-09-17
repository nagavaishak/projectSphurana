import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import {
  type AppointmentCreateFormData,
  AppointmentDateTimeFields,
  AppointmentDerivedSummary,
  AppointmentNotesField,
  AppointmentPractitionerField,
  DoubleBookingConfirmDialog,
  appointmentCreateDefaults,
  appointmentCreateForm,
  appointmentCreateSchema,
  useCreateAppointmentFlow,
} from '@/features/appointments/create';

import {
  AppointmentResourceFields,
  useAppointmentResourceSelection,
} from '@/features/resources/booking';
import { useResourceWarningToasts } from '@/features/resources/booking';

export interface AppointmentMobileCreateDetailsFormProps {
  formId: string;
  leadId: string;
  serviceId: string;
  slotDate: Date;
  defaultDate?: string;
  defaultHour?: number;
  defaultMinute?: number;
  practitionerId?: string;
  onSuccess: () => void;
  onPendingChange?: (isPending: boolean) => void;
}

/**
 * MOBILE surface for the SHARED appointment-create core. Composes the same
 * shared fields the desktop dialog uses, laid out as a funnel step.
 *
 * The title, the colour and the end time are all DERIVED (from the service and
 * the assigned practitioner) — mobile no longer asks the user to type a title,
 * pick a colour, or snap the duration to a bucket.
 */
export function AppointmentMobileCreateDetailsForm({
  formId,
  leadId,
  serviceId,
  slotDate,
  defaultDate,
  defaultHour,
  defaultMinute,
  practitionerId,
  onSuccess,
  onPendingChange,
}: AppointmentMobileCreateDetailsFormProps) {
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
    // Same warn-don't-block contract as the desktop dialog: the booking was
    // made, the room just clashes. Reported, never treated as a failure.
    // (A double-booked PRACTITIONER is the other axis and blocks until
    // confirmed — see `conflict` below.)
    onSuccess: (appointment) => {
      notifyResourceWarnings({
        response: appointment,
        appointmentId: String(appointment.id),
        window: resources.window,
      });
      onSuccess();
    },
  });

  const defaultValues = useMemo(() => {
    const values = appointmentCreateDefaults({
      slotDate,
      startTime:
        defaultHour !== undefined && defaultMinute !== undefined
          ? { hour: defaultHour, minute: defaultMinute }
          : undefined,
      leadId,
      serviceId,
      practitionerId,
    });
    return defaultDate ? { ...values, date: defaultDate } : values;
  }, [
    slotDate,
    defaultDate,
    defaultHour,
    defaultMinute,
    leadId,
    serviceId,
    practitionerId,
  ]);

  const form = useForm<AppointmentCreateFormData>({
    resolver: zodResolver(appointmentCreateSchema),
    defaultValues,
  });

  useEffect(() => {
    onPendingChange?.(isCreating);
  }, [isCreating, onPendingChange]);

  // Rooms & equipment — renders nothing for an org with no resource
  // categories, so this funnel step is byte-identical for every clinic today.
  const resources = useAppointmentResourceSelection(form.control);

  const service = context.services.find((s) => s.id === serviceId);

  return (
    <form
      id={formId}
      onSubmit={form.handleSubmit((values) =>
        submit(values, {
          resourceIds: resources.resourceIds,
          allowResourceOverbook: resources.overbooks,
        })
      )}
      className="flex flex-col gap-4"
    >
      {/* Same confirmation the desktop dialog shows — the mobile funnel took
          the identical silent-double-booking path (ENG-792). */}
      <DoubleBookingConfirmDialog
        conflict={conflict}
        onConfirm={confirmDoubleBooking}
        onCancel={dismissConflict}
      />

      <input type="hidden" {...form.register('leadId')} />
      <input type="hidden" {...form.register('serviceId')} />

      <AppointmentDerivedSummary service={service} />

      <AppointmentDateTimeFields control={form.control} variant="mobile" />

      <section>
        <p className="pb-2 text-[13px] text-[#8E8E93]">
          {appointmentCreateForm.labels.practitionerId}
        </p>
        <AppointmentPractitionerField
          control={form.control}
          practitioners={context.practitioners}
          variant="mobile"
        />
      </section>

      <AppointmentResourceFields selection={resources} variant="mobile" />

      <AppointmentNotesField control={form.control} variant="mobile" />

      {resourceOverrideDialog}
    </form>
  );
}
