import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom shims for the Radix Select the row opens. Same set the
// create-appointment contract spec installs for Radix Select/Popover.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * "Rooms & equipment" on the appointment side panel.
 *
 * The row is rendered in isolation rather than through `AppointmentSidePanel`:
 * the panel needs the side-panel context, the checkout store and a full
 * `IEvent`, none of which this row reads. What the row DOES own is the manual
 * -mode worklist signal — the amber `Needs room` pill — and the regression
 * guard that keeps the whole section invisible for every clinic that has not
 * configured resources.
 */

const get = vi.fn();
const put = vi.fn();

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    put: (...args: unknown[]) => put(...args),
    delete: vi.fn(),
  },
  // The reassign hook reads the 409 through this; no request fails here.
  isApiClientError: () => false,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import { AppointmentResourcePanelRow } from './appointment-resource-panel-row';

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
const REQUIREMENTS = {
  serviceId: 'svc-1',
  turnaroundMinutes: 0,
  requirements: [
    {
      categoryId: 'cat-1',
      categoryName: 'Room',
      categoryKind: 'room',
      eligibleResourceIds: [],
    },
  ],
};

/** This appointment holds Room 2, auto-assigned. */
const OWN_ALLOCATION = {
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

/** SOMEONE ELSE holds Room 1 across the same window — so Room 1 reads busy. */
const OTHER_ALLOCATION = {
  ...OWN_ALLOCATION,
  id: 'alloc-2',
  appointmentId: 'appt-other',
  resourceId: 'res-1',
  resourceName: 'Room 1',
};

interface Fixture {
  /** Empty ⇒ the org has not configured rooms at all. */
  categories?: unknown[];
  allocations?: unknown[];
  mode?: 'auto' | 'manual';
}

const routeGet =
  ({ categories = [CATEGORY], allocations = [], mode = 'auto' }: Fixture) =>
  (url: string) => {
    if (typeof url === 'string') {
      // Order matters — the bare `resources` prefix would swallow all three.
      if (url.startsWith('resources/categories')) {
        return Promise.resolve(categories);
      }
      if (url.startsWith('resources/requirements')) {
        return Promise.resolve(REQUIREMENTS);
      }
      if (url.startsWith('resources/allocations')) {
        return Promise.resolve(allocations);
      }
      if (url.startsWith('resources')) return Promise.resolve(ROOMS);
      if (url.startsWith('org-defaults')) {
        return Promise.resolve({
          organizationId: 'org-1',
          resourceAssignmentMode: mode,
          overrides: {},
        });
      }
    }
    return Promise.resolve({ items: [], total: 0 });
  };

const renderRow = (serviceId: string | null = 'svc-1') =>
  renderWithProviders(
    <AppointmentResourcePanelRow
      appointmentId="appt-1"
      serviceId={serviceId}
      startDate={START}
      endDate={END}
    />
  );

/**
 * Settle every query before asserting a NEGATIVE.
 *
 * `expect(container).toBeEmptyDOMElement()` passes trivially on the first
 * paint — before any response has landed — so a guard test written without
 * this would go green even if the gate were broken. Waiting for the queries to
 * start and then for `isFetching()` to fall back to zero means the row has all
 * the data it is ever going to get, and is still rendering nothing.
 */
const settle = async (queryClient: {
  isFetching: () => number;
}): Promise<void> => {
  await waitFor(() => expect(get).toHaveBeenCalled());
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
};

describe('AppointmentResourcePanelRow', () => {
  beforeEach(() => {
    put.mockResolvedValue({});
  });

  // THE REGRESSION GUARD — every clinic on the platform today is this org.
  it('renders nothing for an org with no resource categories', async () => {
    get.mockImplementation(routeGet({ categories: [] }));
    const { container, queryClient } = renderRow();

    await settle(queryClient);
    expect(screen.queryByText(/rooms & equipment/i)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();

    // The gate short-circuits the per-service fetch too: an org with no rooms
    // never even asks the API what its services require.
    expect(
      get.mock.calls.some(([url]) =>
        String(url).startsWith('resources/requirements')
      )
    ).toBe(false);
  });

  // A category the clinic created but never filled is not a usable
  // configuration — an empty picker would be worse than nothing.
  it('renders nothing for a category that holds no resources', async () => {
    get.mockImplementation(
      routeGet({ categories: [{ ...CATEGORY, resourceCount: 0 }] })
    );
    const { container, queryClient } = renderRow();

    await settle(queryClient);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the allocated room as the dropdown value', async () => {
    get.mockImplementation(routeGet({ allocations: [OWN_ALLOCATION] }));
    renderRow();

    const trigger = await screen.findByRole('combobox', {
      name: 'Choose room',
    });
    // waitFor, not a bare assert: the trigger mounts before the allocations
    // query lands, so the first paint legitimately reads "Unassigned".
    await waitFor(() => expect(trigger).toHaveTextContent('Room 2'));
    expect(screen.getByText(/rooms & equipment/i)).toBeVisible();
  });

  // The manual-mode worklist signal: a console booking creates NO allocation,
  // so a booking that still needs a room reads "Unassigned" — and, crucially,
  // the dropdown next to it is how the front desk clears it.
  it('reads Unassigned when nothing is allocated', async () => {
    get.mockImplementation(routeGet({ allocations: [], mode: 'manual' }));
    renderRow();

    const trigger = await screen.findByRole('combobox', {
      name: 'Choose room',
    });
    expect(trigger).toHaveTextContent('Unassigned');
  });

  /**
   * Busy options stay SELECTABLE — the front desk can see the room and the
   * diary cannot — but the panel WRITES ON SELECT, so the clash has to be put
   * to them before it lands, not reported afterwards. Confirming sends
   * `force`, which is what stops the server refusing the thing they were just
   * told would happen.
   */
  it('warns before double-booking, then writes it with force', async () => {
    get.mockImplementation(
      routeGet({ allocations: [OWN_ALLOCATION, OTHER_ALLOCATION] })
    );
    const user = userEvent.setup();
    renderRow();

    await user.click(
      await screen.findByRole('combobox', { name: 'Choose room' })
    );

    const busy = await screen.findByRole('option', { name: /Room 1/ });
    // Free/busy is announced, not merely tinted.
    expect(busy).toHaveTextContent('booked');
    expect(busy).not.toHaveAttribute('data-disabled');
    await user.click(busy);

    // Nothing written yet — the operator is still free to back out.
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent(/already booked/i);
    expect(put).not.toHaveBeenCalled();

    await user.click(
      within(confirm).getByRole('button', { name: /book it anyway/i })
    );

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toBe('appointments/appt-1/resources');
    expect(put.mock.calls[0][1]).toMatchObject({
      categoryId: 'cat-1',
      resourceId: 'res-1',
      force: true,
    });
  });

  it('writes nothing when the double-book is cancelled', async () => {
    get.mockImplementation(
      routeGet({ allocations: [OWN_ALLOCATION, OTHER_ALLOCATION] })
    );
    const user = userEvent.setup();
    renderRow();

    await user.click(
      await screen.findByRole('combobox', { name: 'Choose room' })
    );
    await user.click(await screen.findByRole('option', { name: /Room 1/ }));

    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
    expect(put).not.toHaveBeenCalled();
  });

  // Unassign has to exist wherever assign does: a room put on the wrong
  // booking would otherwise stay held all day with no way to free it.
  it('sends resourceId: null when Unassigned is chosen', async () => {
    get.mockImplementation(routeGet({ allocations: [OWN_ALLOCATION] }));
    const user = userEvent.setup();
    renderRow();

    await user.click(
      await screen.findByRole('combobox', { name: 'Choose room' })
    );
    await user.click(await screen.findByRole('option', { name: 'Unassigned' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1]).toMatchObject({
      categoryId: 'cat-1',
      resourceId: null,
    });
  });

  /**
   * No service ⇒ no REQUIREMENTS, which is not the same as nothing to show.
   *
   * The section still offers the org's categories as optional, because the
   * overwhelming majority of bookings in an existing clinic predate this
   * feature and require nothing — a required-only panel showed those staff an
   * empty space where the room picker should be. What must NOT happen is the
   * booking being described as needing a room it does not need.
   */
  it('offers categories as optional when the appointment has no service', async () => {
    get.mockImplementation(routeGet({ mode: 'manual' }));
    renderRow(null);

    expect(
      await screen.findByRole('combobox', { name: 'Choose room' })
    ).toHaveTextContent('Unassigned');
    expect(screen.getByText('optional')).toBeVisible();
  });
});
