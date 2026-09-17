import { describe, expect, it } from 'vitest';

import type { IEvent } from '@/components/calendar';
import {
  findResolvedShift,
  isHourDisabledForColumn,
} from '@/components/calendar/helpers';
import type {
  AppointmentResourceAllocation,
  AppointmentWithRelations,
  Resource,
} from '@borradh-workspace/api-client/types';

import {
  UNASSIGNED_ROOM_ID,
  buildRoomsEvents,
  resourceShiftsForRange,
  roomsCalendarUsers,
  roomsEventFilter,
  roomsMetadata,
  turnaroundPercent,
} from './rooms-calendar-model';

/**
 * The rooms calendar reuses the practitioner grids untouched, so every claim it
 * makes about layout is really a claim about the SHAPES it hands the shared
 * context. These assert those shapes against the shared helpers that consume
 * them — `roomsEventFilter` is what `useColumnMatcher` calls, and
 * `isHourDisabledForColumn` is what decides the off-hours hatch.
 */

// biome-ignore lint/suspicious/noExplicitAny: fixture rows are partial by design
const asResource = (partial: Partial<Resource>): Resource => partial as any;
const asAllocation = (
  partial: Partial<AppointmentResourceAllocation>
  // biome-ignore lint/suspicious/noExplicitAny: fixture rows are partial by design
): AppointmentResourceAllocation => partial as any;
const asAppointment = (
  partial: Partial<AppointmentWithRelations>
  // biome-ignore lint/suspicious/noExplicitAny: fixture rows are partial by design
): AppointmentWithRelations => partial as any;

const ROOM_A = asResource({
  id: 'room_a',
  name: 'Room A',
  categoryId: 'cat_rooms',
  color: 'blue',
  photo: null,
  capacity: 1,
  workingHours: null, // always open
});

const ROOM_B = asResource({
  id: 'room_b',
  name: 'Room B',
  categoryId: 'cat_rooms',
  color: 'green',
  photo: null,
  capacity: 1,
  // Minutes from midnight: Mon–Fri 09:00–17:00. Closed at the weekend.
  workingHours: {
    1: { from: 540, to: 1020 },
    2: { from: 540, to: 1020 },
    3: { from: 540, to: 1020 },
    4: { from: 540, to: 1020 },
    5: { from: 540, to: 1020 },
  },
});

const ALLOCATION_A = asAllocation({
  id: 'alloc_1',
  appointmentId: 'appt_1',
  resourceId: 'room_a',
  resourceName: 'Room A',
  resourceColor: 'blue',
  categoryId: 'cat_rooms',
  startDate: '2026-08-24T09:00:00.000Z',
  // 60 minutes of treatment + 15 minutes of turnaround.
  endDate: '2026-08-24T10:15:00.000Z',
  turnaroundMinutes: 15,
  source: 'auto',
  allowOverlap: false,
});

/** Same appointment, but its LASER hold — must not leak into the rooms grid. */
const ALLOCATION_OTHER_CATEGORY = asAllocation({
  id: 'alloc_2',
  appointmentId: 'appt_1',
  resourceId: 'laser_1',
  resourceName: 'Laser 1',
  resourceColor: null,
  categoryId: 'cat_lasers',
  startDate: '2026-08-24T09:00:00.000Z',
  endDate: '2026-08-24T10:00:00.000Z',
  turnaroundMinutes: 0,
  source: 'auto',
  allowOverlap: false,
});

const APPT_ALLOCATED = asAppointment({
  id: 'appt_1',
  title: 'Laser — Jane Doe',
  description: '',
  status: 'confirmed',
  serviceId: 'svc_1',
  startDate: '2026-08-24T09:00:00.000Z',
  endDate: '2026-08-24T10:00:00.000Z',
});

const APPT_MANUAL = asAppointment({
  id: 'appt_2',
  title: 'Consultation — John Roe',
  description: '',
  status: 'booked',
  serviceId: 'svc_2',
  startDate: '2026-08-24T11:00:00.000Z',
  endDate: '2026-08-24T11:30:00.000Z',
});

const APPT_CANCELLED = asAppointment({
  id: 'appt_3',
  title: 'Cancelled — nobody',
  status: 'cancelled',
  serviceId: null,
  startDate: '2026-08-24T12:00:00.000Z',
  endDate: '2026-08-24T12:30:00.000Z',
});

const buildEvents = () =>
  buildRoomsEvents({
    allocations: [ALLOCATION_A, ALLOCATION_OTHER_CATEGORY],
    appointments: [APPT_ALLOCATED, APPT_MANUAL, APPT_CANCELLED],
    resources: [ROOM_A, ROOM_B],
    categoryId: 'cat_rooms',
  });

const byId = (events: IEvent[], id: string) =>
  events.find((event) => event.id === id);

describe('rooms calendar columns', () => {
  it('puts the Unassigned column first, then the rooms', () => {
    const users = roomsCalendarUsers([ROOM_A, ROOM_B]);
    expect(users.map((u) => u.id)).toEqual([
      UNASSIGNED_ROOM_ID,
      'room_a',
      'room_b',
    ]);
    // A room's photo IS its avatar and its colour its tint — no new IUser fields.
    expect(users[1]).toMatchObject({ name: 'Room A', color: 'blue' });
  });

  it('maps an allocation into its own room column and no other', () => {
    const events = buildEvents();
    const block = byId(events, 'alloc:alloc_1');
    expect(block).toBeDefined();
    if (!block) return;

    expect(roomsEventFilter(block, 'room_a')).toBe(true);
    expect(roomsEventFilter(block, 'room_b')).toBe(false);
    expect(roomsEventFilter(block, UNASSIGNED_ROOM_ID)).toBe(false);
  });

  it('positions the block by the ALLOCATION range, so the turnaround tail is included', () => {
    const block = byId(buildEvents(), 'alloc:alloc_1');
    // The appointment ends at 10:00; the room is held until 10:15.
    expect(block?.endDate).toBe('2026-08-24T10:15:00.000Z');
    expect(roomsMetadata(block as IEvent)?.turnaroundMinutes).toBe(15);
  });

  it('ignores allocations belonging to another category', () => {
    const events = buildEvents();
    expect(byId(events, 'alloc:alloc_2')).toBeUndefined();
  });

  it('collects bookings with no hold in this category into the Unassigned column', () => {
    const events = buildEvents();
    const block = byId(events, 'unassigned:appt_2');
    expect(block).toBeDefined();
    if (!block) return;

    expect(roomsEventFilter(block, UNASSIGNED_ROOM_ID)).toBe(true);
    expect(roomsEventFilter(block, 'room_a')).toBe(false);
    // It still names the slot a drop would fill, or a drag could not say which
    // requirement it satisfies.
    expect(roomsMetadata(block)?.categoryId).toBe('cat_rooms');
  });

  it('does not show the allocated booking twice, nor cancelled bookings at all', () => {
    const events = buildEvents();
    expect(byId(events, 'unassigned:appt_1')).toBeUndefined();
    expect(byId(events, 'unassigned:appt_3')).toBeUndefined();
    expect(events).toHaveLength(2);
  });
});

describe('resource working hours → off-hours hatch', () => {
  // 2026-08-24 is a Monday; 2026-08-23 the Sunday before it.
  const monday = new Date(2026, 7, 24);
  const sunday = new Date(2026, 7, 23);
  const days = [sunday, monday];

  const shifts = resourceShiftsForRange([ROOM_A, ROOM_B], days);

  const disabledAt = (resourceId: string, day: Date, hour: number) =>
    isHourDisabledForColumn(
      day,
      hour,
      {},
      findResolvedShift(shifts, resourceId, day),
      { practitionerScoped: true }
    );

  it('never emits an all-day-off row for an always-open room', () => {
    const roomARows = shifts.filter((s) => s.practitionerId === 'room_a');
    expect(roomARows).toHaveLength(2);
    expect(roomARows.every((row) => row.isOff)).toBe(false);
    expect(roomARows.every((row) => !row.isOff)).toBe(true);
  });

  it('leaves an always-open room unhatched for the whole day', () => {
    // The blackout this guards against: `isHourDisabledForColumn` treats a
    // MISSING shift as off, so an always-open room must say it is open.
    for (const hour of [0, 6, 9, 17, 23]) {
      expect(disabledAt('room_a', monday, hour)).toBe(false);
      expect(disabledAt('room_a', sunday, hour)).toBe(false);
    }
  });

  it('hatches a room outside its own hours, and all day when it is closed', () => {
    expect(disabledAt('room_b', monday, 8)).toBe(true);
    expect(disabledAt('room_b', monday, 9)).toBe(false);
    expect(disabledAt('room_b', monday, 16)).toBe(false);
    expect(disabledAt('room_b', monday, 17)).toBe(true);

    const sundayRow = findResolvedShift(shifts, 'room_b', sunday);
    expect(sundayRow?.isOff).toBe(true);
    expect(disabledAt('room_b', sunday, 12)).toBe(true);
  });

  it('leaves the Unassigned column unhatched', () => {
    expect(disabledAt(UNASSIGNED_ROOM_ID, monday, 3)).toBe(false);
    expect(disabledAt(UNASSIGNED_ROOM_ID, sunday, 20)).toBe(false);
  });
});

describe('turnaroundPercent', () => {
  it('is the turnaround share of the block it tails', () => {
    // 15 of 75 minutes.
    expect(
      turnaroundPercent(byId(buildEvents(), 'alloc:alloc_1') as IEvent)
    ).toBe(20);
  });

  it('is zero for a block with no turnaround', () => {
    expect(
      turnaroundPercent(byId(buildEvents(), 'unassigned:appt_2') as IEvent)
    ).toBe(0);
  });
});

/**
 * The popover reads these two off the block's metadata. Before they existed it
 * showed the ROOM under a "Responsible" label with no client anywhere, and
 * quoted the hold's end (which carries the turnaround tail) as the time the
 * client leaves.
 */
describe('block metadata for the details popover', () => {
  const withLead = asAppointment({
    ...APPT_ALLOCATED,
    lead: { firstName: 'Jane', lastName: 'Doe' },
  } as Partial<AppointmentWithRelations>);

  const eventsWithLead = () =>
    buildRoomsEvents({
      allocations: [ALLOCATION_A],
      appointments: [withLead],
      resources: [ROOM_A],
      categoryId: 'cat_rooms',
    });

  it('carries the client name and the APPOINTMENT end, not the hold end', () => {
    const event = byId(eventsWithLead(), 'alloc:alloc_1') as IEvent;
    const metadata = roomsMetadata(event);

    expect(metadata?.clientName).toBe('Jane Doe');
    // The block itself still spans the hold — that is what occupies the room.
    expect(event.endDate).toBe('2026-08-24T10:15:00.000Z');
    // …but the popover quotes when the client is actually done.
    expect(metadata?.appointmentEndDate).toBe('2026-08-24T10:00:00.000Z');
  });

  it('leaves the client null when the API returned no lead', () => {
    const event = byId(buildEvents(), 'alloc:alloc_1') as IEvent;
    expect(roomsMetadata(event)?.clientName).toBeNull();
  });

  it('carries them on an unassigned block too', () => {
    const events = buildRoomsEvents({
      allocations: [],
      appointments: [
        asAppointment({
          ...APPT_MANUAL,
          lead: { firstName: 'John', lastName: 'Roe' },
        } as Partial<AppointmentWithRelations>),
      ],
      resources: [ROOM_A],
      categoryId: 'cat_rooms',
    });
    const metadata = roomsMetadata(byId(events, 'unassigned:appt_2') as IEvent);

    expect(metadata?.clientName).toBe('John Roe');
    expect(metadata?.appointmentEndDate).toBe('2026-08-24T11:30:00.000Z');
  });
});
