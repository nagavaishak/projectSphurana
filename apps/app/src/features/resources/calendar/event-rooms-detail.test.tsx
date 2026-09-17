import { renderWithProviders, screen } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `EventRoomsDetail` — the rooms row inside the event-details dialog.
 *
 * It is wired on BOTH calendars, and the two disagree about what `event.id`
 * means. On the staff calendar an event IS an appointment. On the rooms
 * calendar it is a BLOCK: one appointment can occupy several rooms, so blocks
 * are keyed `alloc:<allocationId>` / `unassigned:<appointmentId>` and the
 * appointment id lives in metadata.
 *
 * Reading `event.id` on the rooms calendar therefore produced a string no
 * appointment has, and the row matched none of the booking's holds — so a
 * booking sitting in Room 2 reported "Unassigned", and picking a room sent
 * that non-id to `PUT appointments/:id/resources`, which did nothing. These
 * tests pin the id derivation on both axes.
 */

// Radix Select shims, as in the panel-row spec.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const get = vi.fn();

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  isApiClientError: () => false,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import type { IEvent } from '@/components/calendar';

import { EventRoomsDetail } from './event-rooms-detail';

const START = '2026-03-05T14:00:00.000Z';
const END = '2026-03-05T14:30:00.000Z';

const CATEGORY = {
  id: 'cat-1',
  name: 'Room',
  kind: 'room',
  resourceCount: 2,
  isActive: true,
};

const ROOMS = [
  {
    id: 'res-1',
    name: 'Room 1',
    categoryId: 'cat-1',
    isActive: true,
    capacity: 1,
  },
  {
    id: 'res-2',
    name: 'Room 2',
    categoryId: 'cat-1',
    isActive: true,
    capacity: 1,
  },
];

/** The booking holds Room 2. */
const ALLOCATION = {
  id: 'alloc-1',
  appointmentId: 'appt-1',
  resourceId: 'res-2',
  resourceName: 'Room 2',
  resourceColor: null,
  categoryId: 'cat-1',
  startDate: START,
  endDate: END,
  turnaroundMinutes: 0,
  source: 'auto',
  allowOverlap: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation((url: string) => {
    if (typeof url === 'string') {
      if (url.startsWith('resources/categories'))
        return Promise.resolve([CATEGORY]);
      if (url.startsWith('resources/requirements')) {
        return Promise.resolve({
          serviceId: 'svc-1',
          turnaroundMinutes: 0,
          requirements: [],
        });
      }
      if (url.startsWith('resources/allocations')) {
        return Promise.resolve([ALLOCATION]);
      }
      if (url.startsWith('resources')) return Promise.resolve(ROOMS);
      if (url.startsWith('org-defaults')) {
        return Promise.resolve({
          organizationId: 'org-1',
          resourceAssignmentMode: 'auto',
          overrides: {},
        });
      }
    }
    return Promise.resolve({ items: [], total: 0 });
  });
});

const anEvent = (over: Partial<IEvent>): IEvent =>
  ({
    id: 'appt-1',
    title: 'Facial',
    description: '',
    startDate: START,
    endDate: END,
    color: 'blue',
    user: { id: 'u1', name: 'Staff', picturePath: null, color: null },
    metadata: { serviceId: 'svc-1' },
    ...over,
  }) as IEvent;

describe('EventRoomsDetail — which appointment the row is about', () => {
  it('reads the appointment id from metadata on a rooms-calendar block', async () => {
    // `alloc:alloc-1` is not an appointment id; `metadata.appointmentId` is.
    renderWithProviders(
      <EventRoomsDetail
        event={anEvent({
          id: 'alloc:alloc-1',
          metadata: {
            type: 'resource-allocation',
            appointmentId: 'appt-1',
            allocationId: 'alloc-1',
            categoryId: 'cat-1',
            resourceIds: ['res-2'],
            turnaroundMinutes: 0,
            serviceId: 'svc-1',
            status: 'booked',
            allowOverlap: false,
          },
        })}
      />
    );

    // The room it actually holds — not "Unassigned".
    expect(await screen.findByText('Room 2')).toBeInTheDocument();
  });

  it('reads it from metadata on an UNASSIGNED rooms block too', async () => {
    renderWithProviders(
      <EventRoomsDetail
        event={anEvent({
          id: 'unassigned:appt-1',
          metadata: {
            type: 'resource-unassigned',
            appointmentId: 'appt-1',
            allocationId: null,
            categoryId: 'cat-1',
            resourceIds: [],
            turnaroundMinutes: 0,
            serviceId: 'svc-1',
            status: 'booked',
            allowOverlap: false,
          },
        })}
      />
    );

    expect(await screen.findByText('Room 2')).toBeInTheDocument();
  });

  it('still uses event.id on the staff calendar, where it IS the appointment', async () => {
    renderWithProviders(<EventRoomsDetail event={anEvent({ id: 'appt-1' })} />);

    expect(await screen.findByText('Room 2')).toBeInTheDocument();
  });

  it('renders nothing for blocked time', async () => {
    const { container } = renderWithProviders(
      <EventRoomsDetail
        event={anEvent({ metadata: { type: 'blocked-time' } })}
      />
    );

    // Returns null before any hook runs, so there is nothing to settle — and
    // nothing is fetched for a block that occupies a practitioner, not a room.
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });
});
