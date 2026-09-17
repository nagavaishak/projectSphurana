import { AppointmentResourcePanelRow } from '@/features/resources/booking';

import type { IEvent } from '@/components/calendar';

import { roomsMetadata } from './rooms-calendar-model';

/**
 * The room row inside the event-details dialog — `config.eventDetailsExtra`.
 *
 * Clicking a booking is the obvious way to ask "which room is this in?", and
 * for a long time it was the one place that could not answer: rooms were only
 * changeable by dragging on the rooms calendar, which meant existing bookings
 * (which hold nothing) had no assignment path at all.
 *
 * Wired on BOTH axes, so the answer is in the same place whether you are
 * looking at the team calendar or the rooms one.
 *
 * Renders nothing for blocked time (which occupies a practitioner, not a room)
 * and nothing at all for an org with no rooms.
 */
export function EventRoomsDetail({ event }: { event: IEvent }) {
  const metadata = (event.metadata ?? {}) as {
    type?: string;
    serviceId?: string | null;
  };

  if (metadata.type === 'blocked-time' || metadata.type === 'unavailability') {
    return null;
  }

  /**
   * The APPOINTMENT id — which is not always `event.id`.
   *
   * On the staff calendar an event IS an appointment, so `event.id` is right.
   * On the ROOMS calendar it is not: blocks are keyed `alloc:<allocationId>`
   * or `unassigned:<appointmentId>`, because one appointment can occupy
   * several rooms and each needs its own block. Reading `event.id` there
   * produced a string no appointment has, which meant this panel matched none
   * of the booking's holds (so every category read "Unassigned" however many
   * rooms it was actually in) and sent that non-id to
   * `PUT appointments/:id/resources`, so picking a room did nothing.
   *
   * The rooms metadata carries the real id; the staff calendar has no rooms
   * metadata and falls through to `event.id`.
   */
  const appointmentId = roomsMetadata(event)?.appointmentId ?? String(event.id);
  if (!appointmentId) return null;

  return (
    <AppointmentResourcePanelRow
      appointmentId={appointmentId}
      serviceId={metadata.serviceId ?? null}
      startDate={event.startDate}
      endDate={event.endDate}
    />
  );
}
