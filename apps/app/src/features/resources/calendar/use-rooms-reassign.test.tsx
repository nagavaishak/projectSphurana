import { act, renderWithProviders, waitFor } from '@/test/render';
import { QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IEvent } from '@/components/calendar';
import type {
  AppointmentResourceAllocation,
  Resource,
} from '@borradh-workspace/api-client/types';

const put = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: (...args: unknown[]) => put(...args),
    delete: vi.fn(),
  },
  // ky re-throws its own HTTPError, so ApiClientError is never constructed for
  // a real HTTP failure — the conflict helper reads `error.response.status`
  // instead. Mirroring that here is what makes this a faithful 409.
  isApiClientError: () => false,
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

import {
  type RoomsEventMetadata,
  UNASSIGNED_ROOM_ID,
} from './rooms-calendar-model';
import { reassignIntentFromDrop } from './rooms-reassign-intent';
import { useRoomsReassign } from './use-rooms-reassign';

// biome-ignore lint/suspicious/noExplicitAny: fixture rows are partial by design
const asResource = (partial: Partial<Resource>): Resource => partial as any;

const ROOM_B = asResource({
  id: 'room_b',
  name: 'Room B',
  categoryId: 'cat_rooms',
  color: 'green',
});

const ALLOCATIONS_KEY = [
  'resources',
  'allocations',
  { from: 'FROM', to: 'TO' },
] as const;

const allocation: AppointmentResourceAllocation = {
  id: 'alloc_1',
  appointmentId: 'appt_1',
  resourceId: 'room_a',
  resourceName: 'Room A',
  resourceColor: 'blue',
  categoryId: 'cat_rooms',
  startDate: '2026-08-24T09:00:00.000Z',
  endDate: '2026-08-24T10:15:00.000Z',
  turnaroundMinutes: 15,
  source: 'auto',
  allowOverlap: false,
};

const metadata: RoomsEventMetadata = {
  type: 'resource-allocation',
  appointmentId: 'appt_1',
  allocationId: 'alloc_1',
  categoryId: 'cat_rooms',
  resourceIds: ['room_a'],
  turnaroundMinutes: 15,
  serviceId: 'svc_1',
  status: 'confirmed',
  allowOverlap: false,
};

const blockInRoomA: IEvent = {
  id: 'alloc:alloc_1',
  title: 'Laser — Jane Doe',
  description: '',
  startDate: allocation.startDate,
  endDate: allocation.endDate,
  color: 'blue',
  user: { id: 'room_a', name: 'Room A', picturePath: null },
  metadata,
};

/** A 409 in the shape the api-client actually surfaces one. */
const conflict409 = () =>
  Object.assign(new Error('Room B is already booked from 09:00 to 10:15.'), {
    response: { status: 409 },
    details: { count: 1 },
  });

type DropFn = (event: IEvent, targetResourceId: string | null) => void;

function Harness({ onReady }: { onReady: (drop: DropFn) => void }) {
  const resourceById = useMemo(
    () => new Map<string, Resource>([['room_b', ROOM_B]]),
    []
  );
  const { dropOnRoom } = useRoomsReassign(resourceById);
  useEffect(() => onReady(dropOnRoom), [dropOnRoom, onReady]);
  return null;
}

function mountHarness() {
  let drop: DropFn = () => {};
  // The shared helper's client garbage-collects instantly (`gcTime: 0`), which
  // would evict the seeded window before the mutation could patch it. The
  // rooms calendar always holds its window open, so keep it.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(ALLOCATIONS_KEY, [allocation]);

  const rendered = renderWithProviders(
    <Harness
      onReady={(fn) => {
        drop = fn;
      }}
    />,
    { queryClient }
  );

  const readResourceId = () =>
    queryClient.getQueryData<AppointmentResourceAllocation[]>(
      ALLOCATIONS_KEY as unknown as unknown[]
    )?.[0]?.resourceId;

  return {
    ...rendered,
    drop: (...args: Parameters<DropFn>) => drop(...args),
    readResourceId,
  };
}

/** A promise the test resolves by hand, so the in-flight state is observable. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('reassignIntentFromDrop', () => {
  it('builds the move, carrying the target room so the block lands repainted', () => {
    expect(reassignIntentFromDrop(blockInRoomA, 'room_b', ROOM_B)).toEqual({
      appointmentId: 'appt_1',
      categoryId: 'cat_rooms',
      resourceId: 'room_b',
      optimistic: { resourceName: 'Room B', resourceColor: 'green' },
    });
  });

  it('is a no-op for a purely vertical drag inside the same column', () => {
    expect(
      reassignIntentFromDrop(blockInRoomA, 'room_a', undefined)
    ).toBeNull();
  });

  it('is a no-op when the drag ended outside any room column', () => {
    expect(reassignIntentFromDrop(blockInRoomA, null, undefined)).toBeNull();
  });

  it('refuses to drop INTO the Unassigned column', () => {
    // There is no "unassign" endpoint — a requirement still has to be met by
    // some room — so this must not fire a request that would 400.
    expect(
      reassignIntentFromDrop(blockInRoomA, UNASSIGNED_ROOM_ID, undefined)
    ).toBeNull();
  });
});

describe('useRoomsReassign', () => {
  beforeEach(() => {
    put.mockReset();
    toastError.mockReset();
  });

  it('moves the block optimistically, then snaps it back when the room is taken', async () => {
    const inFlight = deferred<unknown>();
    put.mockReturnValueOnce(inFlight.promise);
    const { drop, readResourceId } = mountHarness();

    await act(async () => {
      drop(blockInRoomA, 'room_b');
    });

    // Optimistic: the block is in its new column WHILE the request is open —
    // it follows the cursor rather than waiting for the server.
    expect(readResourceId()).toBe('room_b');
    expect(put).toHaveBeenCalledWith('appointments/appt_1/resources', {
      categoryId: 'cat_rooms',
      resourceId: 'room_b',
    });

    await act(async () => {
      inFlight.reject(conflict409());
      await inFlight.promise.catch(() => {});
    });

    // 409 → the server never moved it, so neither does the calendar.
    await waitFor(() => expect(readResourceId()).toBe('room_a'));
  });

  it('names the clash and offers Force rather than a generic error', async () => {
    put.mockRejectedValueOnce(conflict409());
    const { drop } = mountHarness();

    await act(async () => {
      drop(blockInRoomA, 'room_b');
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const [message, options] = toastError.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    // The API's own copy, verbatim — a second wording here would drift.
    expect(message).toBe('Room B is already booked from 09:00 to 10:15.');
    expect(options.action.label).toBe('Force');

    put.mockResolvedValueOnce({});
    await act(async () => {
      options.action.onClick();
    });

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith('appointments/appt_1/resources', {
      categoryId: 'cat_rooms',
      resourceId: 'room_b',
      force: true,
    });
  });

  it('sends nothing at all for a drop that is not a move', async () => {
    const { drop } = mountHarness();
    await act(async () => {
      drop(blockInRoomA, 'room_a');
      drop(blockInRoomA, null);
    });
    expect(put).not.toHaveBeenCalled();
  });
});
