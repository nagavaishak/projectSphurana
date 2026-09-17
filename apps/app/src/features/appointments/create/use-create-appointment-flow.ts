import { useCallback, useRef, useState } from 'react';

import type { CreateAppointmentInput } from '@borradh-workspace/api-client/types';

import {
  type DoubleBookingConflict,
  useCreateAppointment,
} from '../api/create-appointment';
import type { Appointment } from '../api/types';

import { useOptionalCalendar } from '@/components/calendar/contexts/calendar-context';
import {
  type AppointmentCreateFormData,
  buildCreateAppointmentPayload,
} from './appointment-create-form';
import { useAppointmentCreateContext } from './use-appointment-create-context';

interface UseCreateAppointmentFlowOptions {
  onSuccess?: (appointment: Appointment) => void;
  onError?: (error: Error) => void;
}

/**
 * The single mutation entry point for creating an appointment. Takes validated
 * form values, builds the payload through the shared builder, and fires the
 * mutation. Every surface (desktop dialog, mobile route funnel, mobile drawer
 * funnel) goes through this — so there is exactly one place the API body is
 * constructed.
 *
 * ── The double-booking handshake (ENG-792) ─────────────────────────────────
 *
 * The server refuses a slot that overlaps an existing appointment for the same
 * team member, rather than creating it silently as it used to. That refusal
 * surfaces here as `conflict`: the surface renders it as a confirmation naming
 * the clashing appointment, and calls `confirmDoubleBooking()` if the user
 * accepts — which re-sends the SAME payload with `allowDoubleBooking: true`.
 *
 * The payload is stashed rather than rebuilt from the form so the second
 * attempt cannot differ from the one the conflict was reported for.
 */
export function useCreateAppointmentFlow(
  options?: UseCreateAppointmentFlowOptions
) {
  const context = useAppointmentCreateContext();
  const calendar = useOptionalCalendar();
  const locationId = calendar?.selectedLocationId ?? null;

  const [conflict, setConflict] = useState<DoubleBookingConflict | null>(null);
  const pendingPayload = useRef<CreateAppointmentInput | null>(null);

  const { createAppointment, isCreating } = useCreateAppointment({
    ...options,
    onSuccess: (appointment) => {
      setConflict(null);
      pendingPayload.current = null;
      options?.onSuccess?.(appointment);
    },
    onDoubleBookingConflict: setConflict,
  });

  /**
   * `extra` carries the few payload keys that are NOT form fields:
   * `resourceIds`, the front desk's explicit room/equipment pick, and
   * `allowResourceOverbook`, which says they were shown the clash inline and
   * chose to book anyway. The second is worthless without the first, and
   * omitting it when a chosen room IS busy would make the inline warning a
   * lie — the server would refuse the booking the operator was told would go
   * through.
   *
   * It is applied AFTER the shared builder rather than inside it on purpose:
   * the builder stays the one place the core body is constructed (title,
   * colour, start/end, ids), and a surface that passes nothing produces a
   * byte-identical payload to before — which is what keeps every org without
   * rooms, and the create-appointment form contract, untouched.
   */
  const submit = useCallback(
    (
      values: AppointmentCreateFormData,
      extra?: Pick<
        CreateAppointmentInput,
        'resourceIds' | 'allowResourceOverbook'
      >
    ) => {
      const base = buildCreateAppointmentPayload(values, context);
      // Which site the booking is at. Read from the calendar when there is
      // one, so the allocator can drop rooms pinned to another branch — until
      // this was threaded through, NO caller supplied a location and every
      // allocation was unfiltered. Omitted when the surface has no calendar
      // (or the org has one site), which is the previous behaviour exactly.
      const withLocation = locationId === null ? base : { ...base, locationId };
      const payload = extra?.resourceIds?.length
        ? {
            ...withLocation,
            resourceIds: extra.resourceIds,
            ...(extra.allowResourceOverbook
              ? { allowResourceOverbook: true }
              : {}),
          }
        : withLocation;
      // Stash the payload the ROOMS keys are already on, so a "book it anyway"
      // retry re-sends the same rooms — rebuilding it from the form would drop
      // the operator's explicit pick on the second attempt.
      pendingPayload.current = payload;
      createAppointment(payload);
    },
    [createAppointment, context, locationId]
  );

  /** The user said "book it anyway" — re-send the same slot, with consent. */
  const confirmDoubleBooking = useCallback(() => {
    const payload = pendingPayload.current;
    if (!payload) return;
    setConflict(null);
    createAppointment({ ...payload, allowDoubleBooking: true });
  }, [createAppointment]);

  const dismissConflict = useCallback(() => {
    setConflict(null);
    pendingPayload.current = null;
  }, []);

  return {
    submit,
    isCreating,
    context,
    conflict,
    confirmDoubleBooking,
    dismissConflict,
  };
}
