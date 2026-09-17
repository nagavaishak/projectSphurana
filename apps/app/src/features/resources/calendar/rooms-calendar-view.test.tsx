import { renderWithProviders, screen, within } from '@/test/render';
import { useEffect, useRef } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CalendarProvider, useCalendar } from '@/components/calendar';
import type { ICalendarConfig } from '@/components/calendar';
import { CalendarResourceDaysView } from '@/components/calendar/components/week-and-day-view/calendar-resource-days-view';
import type {
  AppointmentResourceAllocation,
  AppointmentWithRelations,
  Resource,
} from '@borradh-workspace/api-client/types';

/**
 * VIEW PARITY.
 *
 * The point of the rooms calendar is that it is not a second calendar: the
 * SHARED `CalendarResourceDaysView` — the very component the staff axis uses
 * for 3-day and week — renders rooms with nothing but a different provider
 * config. These render it directly with the rooms config to prove that, and to
 * pin the two behaviours a config could silently get wrong: rooms landing on
 * ROWS when several are selected, and the turnaround tail appearing over the
 * cleanup end of a block.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.scrollIntoView)
  Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture)
  Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture)
  Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture)
  Element.prototype.releasePointerCapture = () => {};
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const ROOMS_PATH = '/dashboard/l/loc_1/calendar/rooms/three-day';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ROOMS_PATH,
  // `useBranchRoutes()` reads the branch out of the pathname, so the mocked
  // path has to carry an `/l/<branch>/` segment or the hook throws. The value
  // is never asserted here — these tests are about the grid, not the links —
  // but it must be a BRANCH path for the components to render at all.
  useRouterState: ({
    select,
  }: {
    select: (s: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: ROOMS_PATH } }),
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  isApiClientError: () => false,
}));

// `RoomsSlot` opens the real add-appointment dialog so staff can book INTO a
// room column. That component reaches the routes tree — and therefore the
// router root — which this suite has no business constructing: it renders the
// shared grid to assert rooms-on-rows layout. Stubbed to a passthrough so the
// slot still renders its children (the hover-create target and drop zone).
vi.mock(
  '@/routes/_authed/dashboard/l/$locationId/calendar/-components/mobile/responsive-add-dialog',
  () => ({
    ResponsiveAddDialog: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
  })
);

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { RoomsCalendarContextProvider } from './rooms-calendar-context';
import {
  buildRoomsEvents,
  resourceShiftsForRange,
  roomsCalendarUsers,
  roomsEventFilter,
} from './rooms-calendar-model';
import { RoomsColumnHeader } from './rooms-column-header';
import { RoomsEventDetails } from './rooms-event-details';
import { RoomsSlot } from './rooms-slot';

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
  workingHours: null,
  specs: null,
});
const ROOM_B = asResource({
  id: 'room_b',
  name: 'Room B',
  categoryId: 'cat_rooms',
  color: 'green',
  photo: null,
  capacity: 1,
  workingHours: null,
  specs: null,
});

const MONDAY = new Date(2026, 7, 24);

const allocations = [
  asAllocation({
    id: 'alloc_a',
    appointmentId: 'appt_a',
    resourceId: 'room_a',
    resourceName: 'Room A',
    resourceColor: 'blue',
    categoryId: 'cat_rooms',
    startDate: '2026-08-24T09:00:00.000Z',
    endDate: '2026-08-24T10:15:00.000Z',
    turnaroundMinutes: 15,
    source: 'auto',
    allowOverlap: false,
  }),
  asAllocation({
    id: 'alloc_b',
    appointmentId: 'appt_b',
    resourceId: 'room_b',
    resourceName: 'Room B',
    resourceColor: 'green',
    categoryId: 'cat_rooms',
    startDate: '2026-08-24T13:00:00.000Z',
    endDate: '2026-08-24T14:00:00.000Z',
    turnaroundMinutes: 0,
    source: 'manual',
    allowOverlap: false,
  }),
];

const appointments = [
  asAppointment({
    id: 'appt_a',
    title: 'Peel in A',
    description: '',
    status: 'confirmed',
    serviceId: 'svc_1',
    startDate: '2026-08-24T09:00:00.000Z',
    endDate: '2026-08-24T10:00:00.000Z',
  }),
  asAppointment({
    id: 'appt_b',
    title: 'Facial in B',
    description: '',
    status: 'booked',
    serviceId: 'svc_2',
    startDate: '2026-08-24T13:00:00.000Z',
    endDate: '2026-08-24T14:00:00.000Z',
  }),
];

const events = buildRoomsEvents({
  allocations,
  appointments,
  resources: [ROOM_A, ROOM_B],
  categoryId: 'cat_rooms',
});

const roomsConfig: Partial<ICalendarConfig> = {
  mode: 'appointments',
  dayColumnsPerStaff: true,
  customAddDialog: RoomsSlot,
  customEventDetailsDialog: RoomsEventDetails,
  staffHeaderMenu: RoomsColumnHeader,
  eventFilter: roomsEventFilter,
  routerBasePath: '/dashboard/calendar/rooms',
};

/** Drives the context's selection + date the way the header controls would. */
function Select({ ids }: { ids: string[] }) {
  const { setSelectedUserIds, setSelectedDate } = useCalendar();
  // The context's setters are fresh closures each render, so the effect is
  // guarded rather than dependency-trimmed — trimming would loop.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    setSelectedDate(MONDAY);
    setSelectedUserIds(ids);
  }, [ids, setSelectedDate, setSelectedUserIds]);
  return null;
}

function renderGrid({
  ids,
  dayCount,
  openMinutes = 480,
}: {
  ids: string[];
  dayCount: number;
  /** 0 models a day the branch is closed — see the "Closed" test below. */
  openMinutes?: number;
}) {
  return renderWithProviders(
    <DndProvider backend={HTML5Backend}>
      <CalendarProvider
        users={roomsCalendarUsers([ROOM_A, ROOM_B])}
        events={events}
        config={roomsConfig}
        resolvedShifts={resourceShiftsForRange([ROOM_A, ROOM_B], [MONDAY])}
        timeZone="UTC"
      >
        <RoomsCalendarContextProvider
          value={{
            categories: [],
            selectedCategoryId: 'cat_rooms',
            setSelectedCategoryId: () => {},
            resourceById: new Map([
              ['room_a', ROOM_A],
              ['room_b', ROOM_B],
            ]),
            // Carries `openMinutes` alongside the ratio: the header must be
            // able to tell "0% of an open day" from "no open minutes at all",
            // which otherwise both rendered as "0% booked". A full day here so
            // these rooms take the ordinary percentage path.
            utilisationByResourceId: new Map([
              ['room_a', { utilisation: 0.82, openMinutes }],
              ['room_b', { utilisation: 0.31, openMinutes }],
            ]),
          }}
        >
          <Select ids={ids} />
          <CalendarResourceDaysView
            singleDayEvents={events}
            multiDayEvents={[]}
            dayCount={dayCount}
          />
        </RoomsCalendarContextProvider>
      </CalendarProvider>
    </DndProvider>
  );
}

/** Position of a piece of text in document order. */
const orderOf = (text: string) => {
  const nodes = Array.from(document.querySelectorAll('*')).filter(
    (node) => node.children.length === 0 && node.textContent?.includes(text)
  );
  const node = nodes[0];
  if (!node) throw new Error(`not rendered: ${text}`);
  return Array.from(document.querySelectorAll('*')).indexOf(node);
};

describe.each([
  ['3day', 3],
  ['week', 7],
])('%s view with several rooms selected', (_name, dayCount) => {
  beforeEach(() => {
    renderGrid({ ids: ['room_a', 'room_b'], dayCount });
  });

  it('puts rooms on ROWS and days on COLUMNS', () => {
    // Rows mean each room is followed by ITS bookings before the next room
    // begins. A rooms-as-columns layout could not produce this order.
    expect(orderOf('Room A')).toBeLessThan(orderOf('Peel in A'));
    expect(orderOf('Peel in A')).toBeLessThan(orderOf('Room B'));
    expect(orderOf('Room B')).toBeLessThan(orderOf('Facial in B'));
  });

  it('drops the times column — list cells, not a time grid', () => {
    // `[data-slot-time]` is the hover-create slot, and it only exists in the
    // time grid. Its absence is what "no time column" means structurally.
    expect(document.querySelectorAll('[data-slot-time]')).toHaveLength(0);
  });

  it('renders each day as a column header exactly once', () => {
    expect(
      screen.getAllByRole('button', { name: /View Monday, August 24/ })
    ).toHaveLength(1);
  });
});

describe('3day view with a single room selected', () => {
  beforeEach(() => {
    renderGrid({ ids: ['room_a'], dayCount: 3 });
  });

  it('falls back to the time grid, with a column per day', () => {
    expect(
      document.querySelectorAll('[data-slot-time]').length
    ).toBeGreaterThan(0);
  });

  it('hatches the turnaround tail over the cleanup end of the block', () => {
    const tail = document.querySelector('[data-turnaround-tail]');
    expect(tail).not.toBeNull();
    expect(tail?.getAttribute('data-turnaround-minutes')).toBe('15');
    expect(tail?.getAttribute('aria-label')).toBe('Turnaround — 15 min');
    // 15 of the block's 75 minutes, pinned to its bottom.
    expect((tail as HTMLElement).style.height).toBe('20%');
  });

  it('leaves a block with no turnaround untailed', () => {
    // Only Room A is selected, so Room B's untailed block is out of view; the
    // single tail on screen is the one asserted above.
    expect(document.querySelectorAll('[data-turnaround-tail]')).toHaveLength(1);
  });
});

describe('room column header', () => {
  it('says Closed rather than 0% when the room had no open minutes', () => {
    // `utilisation` is `bookedMinutes / openMinutes`, and the service floors it
    // to 0 when `openMinutes` is 0 — a divide-by-zero GUARD, not an answer.
    // Rendering that as "0% booked" states something false: on a day the branch
    // is closed a room can still hold a booking, and the header then reports it
    // as unused. Seen on the seeded demo — a room with a one-hour Sunday
    // booking reading "0% booked".
    //
    // The ratio here is deliberately NON-zero: if the label ever keyed off the
    // percentage instead of the denominator, this would read "82% booked" and
    // the test would catch it.
    renderGrid({ ids: ['room_a'], dayCount: 3, openMinutes: 0 });
    const utilisation = document.querySelector('[data-utilisation]');
    expect(utilisation).toBeNull();
    expect(document.body.textContent).toContain('Closed');
  });

  it('shows the room utilisation against the target band', () => {
    renderGrid({ ids: ['room_a'], dayCount: 3 });
    const utilisation = document.querySelector('[data-utilisation]');
    expect(utilisation?.textContent).toBe('82% booked');
    // 82% clears the 75% target, so it reads as healthy.
    expect(utilisation?.className).toContain('text-green-600');
  });

  it('does not claim a utilisation figure for the Unassigned column', () => {
    renderGrid({ ids: ['__rooms_unassigned__'], dayCount: 3 });
    expect(within(document.body).getByText('No room')).toBeInTheDocument();
    expect(document.querySelector('[data-utilisation]')).toBeNull();
  });
});
