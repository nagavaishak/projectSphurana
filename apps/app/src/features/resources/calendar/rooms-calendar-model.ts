import { roomAvatarDataUri, unassignedAvatarDataUri } from './room-avatar';
/**
 * Pure mapping layer for the ROOMS CALENDAR.
 *
 * The calendar library is already generic over its column entity: the day /
 * 3-day / week grids ask `config.eventFilter` which column an event belongs
 * to (see `hooks/use-column-matcher.ts`), exactly as the content planner
 * drives the same grids with social pages. So rooms are a PROVIDER CONFIG,
 * not a fork of the grid — everything below turns resources + allocations
 * into the shapes the shared context already understands (`IUser`, `IEvent`,
 * `TResolvedShift`) and nothing here knows how a grid is drawn.
 *
 * Kept free of React so the column/shift/turnaround rules can be asserted
 * directly (see `rooms-calendar-model.test.ts`).
 */

import { format } from 'date-fns';

import type { IEvent, IUser, TResolvedShift } from '@/components/calendar';
import type {
  AppointmentResourceAllocation,
  AppointmentWithRelations,
  Resource,
} from '@borradh-workspace/api-client/types';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';

/**
 * Synthetic column that collects bookings holding NO resource in the selected
 * category — manual-mode bookings and imported calendar events. It is a real
 * `IUser` in the calendar's `users` array (leading position = leading column);
 * nothing downstream needs to know it isn't a room.
 */
export const UNASSIGNED_ROOM_ID = '__rooms_unassigned__';

/** Minutes in a day — the "always open" interval for a room with no hours. */
const MINUTES_PER_DAY = 1440;

/** Utilisation at or above this reads as healthy (industry band is 75–85%). */
export const UTILISATION_TARGET = 0.75;

export type RoomsEventKind = 'resource-allocation' | 'resource-unassigned';

/**
 * What a rooms-calendar event carries in `IEvent.metadata`.
 *
 * `IEvent` already has an untyped `metadata` bag and the appointments provider
 * already stashes `practitionerId` there, so allocations ride along with NO
 * change to the shared interface. `resourceIds` is what `eventFilter` reads to
 * decide the column.
 */
export interface RoomsEventMetadata {
  type: RoomsEventKind;
  appointmentId: string;
  allocationId: string | null;
  /** The requirement slot this block belongs to — reassignment needs it. */
  categoryId: string;
  /** Columns this event belongs in. Empty = the Unassigned column. */
  resourceIds: string[];
  /** Minutes of the block that are cleanup, not bookable time. */
  turnaroundMinutes: number;
  serviceId: string | null;
  status: string;
  allowOverlap: boolean;
  /** Who the booking is for — the first thing a front desk looks for. */
  clientName?: string | null;
  /**
   * When the APPOINTMENT ends, which is not when the hold ends: `endDate`
   * carries the turnaround tail, so showing it as "End" told the operator the
   * client is in the chair 15 minutes longer than they are.
   */
  appointmentEndDate?: string | null;
  [key: string]: unknown;
}

/** Read the rooms metadata off an event, or null when it isn't one of ours. */
export function roomsMetadata(event: IEvent): RoomsEventMetadata | null {
  const metadata = event.metadata as RoomsEventMetadata | undefined;
  if (!metadata || typeof metadata.appointmentId !== 'string') return null;
  return metadata;
}

/**
 * The column predicate handed to `config.eventFilter`.
 *
 * This single function is why no grid component needed touching: the day view,
 * the 3-day/week timeline and the multi-room list rows all resolve their
 * column membership through `useColumnMatcher`, which calls straight into it.
 */
export function roomsEventFilter(event: IEvent, resourceId: string): boolean {
  const ids = roomsMetadata(event)?.resourceIds ?? [];
  if (resourceId === UNASSIGNED_ROOM_ID) return ids.length === 0;
  return ids.includes(resourceId);
}

/** The synthetic leading column. */
export function unassignedColumn(): IUser {
  return {
    id: UNASSIGNED_ROOM_ID,
    name: 'Unassigned',
    // A hollow chip, not a "U". This column is the absence of a room, so it
    // should read as an empty slot rather than as a colleague's initial.
    picturePath: unassignedAvatarDataUri(),
    color: null,
  };
}

/**
 * Resources → calendar columns. `IUser` needs no new fields: a room's photo is
 * its avatar and its colour is the same `user_color` enum practitioners write,
 * which is what lets a room tint its blocks exactly like a practitioner does.
 */
export function resourcesToCalendarUsers(resources: Resource[]): IUser[] {
  return resources.map((resource) => ({
    id: resource.id,
    // A retired room only appears here because it still holds bookings that
    // have to be movable. Saying so in the column name is the cheapest way to
    // stop it reading as somewhere new bookings can go — the reassign
    // endpoint refuses an inactive target, so a lane that looked ordinary
    // would silently reject every drop.
    name:
      resource.isActive === false
        ? `${resource.name} (retired)`
        : resource.name,
    // Photo if the clinic uploaded one; otherwise the room's colour chip —
    // never a person's initials. See `room-avatar.ts`.
    // `||`, not `??`: an empty-string photo is falsy to the shared Avatar and
    // would drop back to the initials fallback, which is the very thing the
    // chip exists to prevent.
    picturePath: resource.photo || roomAvatarDataUri(resource.color),
    color: (resource.color ?? null) as IUser['color'],
  }));
}

/** Columns for the grid: Unassigned first, then the category's resources. */
export function roomsCalendarUsers(resources: Resource[]): IUser[] {
  return [unassignedColumn(), ...resourcesToCalendarUsers(resources)];
}

/**
 * Per-resource resolved shifts, in the SAME shape the practitioner columns use
 * (`practitionerId` carries the resource id), so the diagonal off-hours hatch
 * works unchanged.
 *
 * ALWAYS-OPEN ROOMS (`workingHours === null`) EMIT A FULL-DAY OPEN ROW, NOT
 * NO ROW. This is the one place the shared helper's default cuts against us:
 * `isHourDisabledForColumn(..., { practitionerScoped: true })` treats a MISSING
 * shift as "off" and hatches the entire column — the exact blackout an all-day
 * `isOff` row would cause. A room with no hours inherits the clinic's and must
 * read as open, so we say so explicitly.
 */
export function resourceShiftsForRange(
  resources: Resource[],
  days: Date[]
): TResolvedShift[] {
  const shifts: TResolvedShift[] = [];
  const openAllDay = [{ startMinutes: 0, endMinutes: MINUTES_PER_DAY }];

  for (const day of days) {
    const date = format(day, 'yyyy-MM-dd');
    const dayOfWeek = day.getDay();

    // The Unassigned column is not a room and has no hours of its own; it must
    // never hatch, or every unplaced booking would sit behind a grey wall.
    shifts.push({
      practitionerId: UNASSIGNED_ROOM_ID,
      date,
      isOff: false,
      intervals: openAllDay,
    });

    for (const resource of resources) {
      const hours = resource.workingHours;
      if (!hours) {
        shifts.push({
          practitionerId: resource.id,
          date,
          isOff: false,
          intervals: openAllDay,
        });
        continue;
      }

      const entry = hours[dayOfWeek];
      // No entry for this weekday = the room is genuinely closed that day.
      if (!entry || entry.to <= entry.from) {
        shifts.push({
          practitionerId: resource.id,
          date,
          isOff: true,
          intervals: [],
        });
        continue;
      }

      shifts.push({
        practitionerId: resource.id,
        date,
        isOff: false,
        // `ResourceWorkingHours` is already minutes-from-midnight, the same
        // unit `TShiftInterval` uses.
        intervals: [{ startMinutes: entry.from, endMinutes: entry.to }],
      });
    }
  }

  return shifts;
}

const ACTIVE_STATUSES = new Set<string>(activeAppointmentStatuses);

/** Bookings that still hold their slot — the only ones a room grid should show. */
export function isActiveAppointment(appointment: {
  status: string;
}): boolean {
  return ACTIVE_STATUSES.has(appointment.status);
}

/** "Emma Doyle" off the joined lead, when the API returned one. */
function appointmentClientName(
  appointment: AppointmentWithRelations | undefined
): string | null {
  const lead = (appointment as { lead?: unknown } | undefined)?.lead as
    | { firstName?: string | null; lastName?: string | null }
    | undefined;
  if (!lead) return null;
  const name = [lead.firstName, lead.lastName]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(' ')
    .trim();
  return name.length > 0 ? name : null;
}

function eventColor(resource: Resource | undefined): IEvent['color'] {
  return (resource?.color ?? 'blue') as IEvent['color'];
}

/**
 * One allocation → one block.
 *
 * Positioned by the ALLOCATION range, not the appointment's: `endDate` already
 * includes `turnaroundMinutes`, so the block occupies the room for exactly as
 * long as the room is actually unavailable. The turnaround is carried in
 * metadata so the tail can be drawn as cleanup rather than bookable time.
 */
export function allocationToEvent(
  allocation: AppointmentResourceAllocation,
  appointment: AppointmentWithRelations | undefined,
  resource: Resource | undefined
): IEvent {
  const metadata: RoomsEventMetadata = {
    type: 'resource-allocation',
    appointmentId: allocation.appointmentId,
    allocationId: allocation.id,
    categoryId: allocation.categoryId,
    resourceIds: [allocation.resourceId],
    turnaroundMinutes: allocation.turnaroundMinutes,
    serviceId: appointment?.serviceId ?? null,
    status: appointment?.status ?? 'booked',
    allowOverlap: allocation.allowOverlap,
    source: allocation.source,
    resourceName: allocation.resourceName,
    clientName: appointmentClientName(appointment),
    appointmentEndDate: appointment?.endDate ?? null,
  };

  return {
    id: `alloc:${allocation.id}`,
    title: appointment?.title ?? allocation.resourceName,
    description: appointment?.description ?? '',
    startDate: allocation.startDate,
    endDate: allocation.endDate,
    color: eventColor(resource),
    user: {
      id: allocation.resourceId,
      name: allocation.resourceName,
      picturePath: resource?.photo ?? null,
      color: (resource?.color ?? null) as IUser['color'],
    },
    metadata,
  };
}

/**
 * An active booking with no hold in the selected category — a manual-mode
 * booking or an imported calendar event. Rendered in the leading Unassigned
 * column; dragging it into a room column assigns it.
 */
export function unassignedAppointmentToEvent(
  appointment: AppointmentWithRelations,
  categoryId: string
): IEvent {
  const metadata: RoomsEventMetadata = {
    type: 'resource-unassigned',
    appointmentId: appointment.id,
    allocationId: null,
    // The slot a drop would fill. Without it a dragged block could not name
    // which requirement it satisfies.
    categoryId,
    resourceIds: [],
    turnaroundMinutes: 0,
    serviceId: appointment.serviceId ?? null,
    status: appointment.status,
    allowOverlap: false,
    clientName: appointmentClientName(appointment),
    appointmentEndDate: appointment.endDate,
  };

  return {
    id: `unassigned:${appointment.id}`,
    title: appointment.title,
    description: appointment.description ?? '',
    startDate: appointment.startDate,
    endDate: appointment.endDate,
    color: 'gray',
    user: {
      id: UNASSIGNED_ROOM_ID,
      name: 'Unassigned',
      picturePath: null,
      color: null,
    },
    metadata,
  };
}

export interface BuildRoomsEventsInput {
  /** Every allocation in the window, across all categories. */
  allocations: AppointmentResourceAllocation[];
  /** Active + inactive bookings in the window; inactive ones are dropped. */
  appointments: AppointmentWithRelations[];
  resources: Resource[];
  /** Only this category's allocations become columns; the rest are ignored. */
  categoryId: string;
}

/**
 * The calendar's full event list for one category: a block per allocation,
 * plus a block per active booking that has no allocation in that category.
 */
export function buildRoomsEvents({
  allocations,
  appointments,
  resources,
  categoryId,
}: BuildRoomsEventsInput): IEvent[] {
  if (!categoryId) return [];

  const appointmentById = new Map(appointments.map((a) => [a.id, a]));
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  const inCategory = allocations.filter((a) => a.categoryId === categoryId);
  const allocatedAppointmentIds = new Set(
    inCategory.map((a) => a.appointmentId)
  );

  const events: IEvent[] = inCategory.map((allocation) =>
    allocationToEvent(
      allocation,
      appointmentById.get(allocation.appointmentId),
      resourceById.get(allocation.resourceId)
    )
  );

  for (const appointment of appointments) {
    if (allocatedAppointmentIds.has(appointment.id)) continue;
    if (!isActiveAppointment(appointment)) continue;
    events.push(unassignedAppointmentToEvent(appointment, categoryId));
  }

  return events;
}

/**
 * The share of a block that is turnaround, as a 0–100 percentage of its own
 * height. Drawn as a hatched tail pinned to the bottom of the block.
 */
export function turnaroundPercent(event: IEvent): number {
  const turnaroundMinutes = roomsMetadata(event)?.turnaroundMinutes ?? 0;
  if (turnaroundMinutes <= 0) return 0;

  const totalMs =
    new Date(event.endDate).getTime() - new Date(event.startDate).getTime();
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;

  const totalMinutes = totalMs / 60_000;
  return Math.min(100, (turnaroundMinutes / totalMinutes) * 100);
}
