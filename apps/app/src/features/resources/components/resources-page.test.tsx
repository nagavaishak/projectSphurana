import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings → Rooms & equipment.
 *
 * Drives the REAL feature hooks (only `apiClient` is mocked), because the two
 * behaviours most worth protecting here live in the hook/component seam:
 *  - the 409 delete guards must reach an AlertDialog offering "Deactivate
 *    instead", never the generic red toast; and
 *  - the Location and Capacity columns must disappear when they would repeat
 *    the same value on every row.
 */
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: (...args: unknown[]) => del(...args),
  },
  // conflict.ts imports this; the real errors we throw are ky-shaped, so it
  // must answer false and let the structural `response.status` read win.
  isApiClientError: () => false,
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

import { ResourcesPage } from './resources-page';

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

const roomsCategory = {
  id: 'cat_rooms',
  organizationId: 'org_1',
  name: 'Rooms',
  kind: 'room',
  description: null,
  sortOrder: 0,
  isActive: true,
  resourceCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

const roomTwo = {
  id: 'res_2',
  organizationId: 'org_1',
  categoryId: 'cat_rooms',
  locationId: 'loc_1',
  name: 'Room 2',
  description: null,
  color: 'blue',
  photo: null,
  capacity: 1,
  specs: null,
  workingHours: null,
  sortOrder: 0,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  category: { id: 'cat_rooms', name: 'Rooms', kind: 'room' },
};

/** A ky-shaped HTTP failure: `status` lives on `response`, not on the error. */
const conflictError = (message: string) =>
  Object.assign(new Error(message), { response: { status: 409 } });

interface StubOptions {
  categories?: unknown[];
  resources?: unknown[];
  locations?: { id: string; name: string }[];
}

const stubApi = ({
  categories = [roomsCategory],
  resources = [roomTwo],
  locations = [{ id: 'loc_1', name: 'Dublin' }],
}: StubOptions = {}) => {
  get.mockImplementation((path: string) => {
    if (path.startsWith('resources/categories'))
      return Promise.resolve(categories);
    if (path.startsWith('resources')) return Promise.resolve(resources);
    if (path.startsWith('organization-locations'))
      return Promise.resolve({ items: locations });
    return Promise.resolve({ items: [] });
  });
};

describe('ResourcesPage', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    del.mockReset();
    toastError.mockReset();
    put.mockResolvedValue({});
    del.mockResolvedValue(undefined);
  });

  describe('empty states', () => {
    it('offers ONE first-run CTA that creates the Rooms category and opens the add dialog', async () => {
      stubApi({ categories: [], resources: [] });
      post.mockResolvedValue({ ...roomsCategory, resourceCount: 0 });
      const user = userEvent.setup();

      renderWithProviders(<ResourcesPage />);

      expect(await screen.findByText('Set up your rooms')).toBeVisible();
      expect(
        screen.getByText(
          'Bookings will stop double-booking a room once it knows the room exists.'
        )
      ).toBeVisible();
      // A clinic with no rooms must not be shown a second, competing action.
      expect(
        screen.queryByRole('button', { name: /add category/i })
      ).not.toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: /add your first room/i })
      );

      await waitFor(() =>
        expect(post).toHaveBeenCalledWith('resources/categories', {
          name: 'Rooms',
          kind: 'room',
        })
      );
      expect(
        await screen.findByRole('heading', { name: /add room/i })
      ).toBeVisible();
    });

    it('shows an inline "Add room" for a category that exists but is empty', async () => {
      stubApi({ resources: [] });
      renderWithProviders(<ResourcesPage />);

      expect(
        await screen.findByText('Nothing in this category yet.')
      ).toBeVisible();
      expect(
        screen.getAllByRole('button', { name: 'Add room' }).length
      ).toBeGreaterThan(0);
      expect(screen.queryByText('Set up your rooms')).not.toBeInTheDocument();
    });

    it('uses the kind’s singular noun for an equipment category', async () => {
      stubApi({
        categories: [
          {
            ...roomsCategory,
            id: 'cat_lasers',
            name: 'Lasers',
            kind: 'equipment',
            resourceCount: 0,
          },
        ],
        resources: [],
      });
      renderWithProviders(<ResourcesPage />);

      expect(
        (await screen.findAllByRole('button', { name: 'Add equipment' })).length
      ).toBeGreaterThan(0);
    });
  });

  describe('conditional meta', () => {
    // The card meta line prints only what is TRUE OF THIS ROOM. Capacity 1 and
    // "all locations" are the defaults every room carries, so repeating them on
    // every card is how a glance surface turns back into a spreadsheet.
    it('omits the location for a single-location clinic', async () => {
      stubApi();
      renderWithProviders(<ResourcesPage />);

      expect(await screen.findByText('Room 2')).toBeVisible();
      expect(screen.queryByText(/All locations/)).not.toBeInTheDocument();
    });

    it('names the location once the org has more than one', async () => {
      stubApi({
        locations: [
          { id: 'loc_1', name: 'Dublin' },
          { id: 'loc_2', name: 'Cork' },
        ],
      });
      renderWithProviders(<ResourcesPage />);

      expect(await screen.findByText(/Dublin/)).toBeVisible();
    });

    it('omits capacity when every resource holds one appointment', async () => {
      stubApi();
      renderWithProviders(<ResourcesPage />);

      expect(await screen.findByText('Room 2')).toBeVisible();
      expect(screen.queryByText(/at once/)).not.toBeInTheDocument();
    });

    it('states capacity only on the resource that holds more than one', async () => {
      stubApi({
        resources: [
          roomTwo,
          { ...roomTwo, id: 'res_3', name: 'Nail bar', capacity: 4 },
        ],
      });
      renderWithProviders(<ResourcesPage />);

      expect(await screen.findByText(/4 at once/)).toBeVisible();
      // Exactly one card says it — the capacity-1 room stays silent.
      expect(screen.getAllByText(/at once/)).toHaveLength(1);
    });

    it('renders availability as a sentence, not a grid', async () => {
      stubApi();
      renderWithProviders(<ResourcesPage />);

      // `workingHours: null` means ALWAYS AVAILABLE. Rendering that as anything
      // resembling "no hours" would teach the exact misreading the schema note
      // warns about.
      expect(await screen.findByText(/Always available/)).toBeVisible();
    });

    it("counts in the clinic's noun, never the schema's", async () => {
      stubApi();
      renderWithProviders(<ResourcesPage />);

      expect(await screen.findByText(/\d+ rooms?/)).toBeVisible();
      expect(screen.queryByText(/resources?$/)).not.toBeInTheDocument();
    });
  });

  describe('409 delete guards', () => {
    it('offers "Deactivate instead" when a resource still has upcoming bookings', async () => {
      stubApi();
      const message =
        'Room 2 has 4 upcoming bookings. Deactivate it instead, or move those bookings first.';
      del.mockRejectedValue(conflictError(message));
      const user = userEvent.setup();

      renderWithProviders(<ResourcesPage />);
      expect(await screen.findByText('Room 2')).toBeVisible();

      await user.click(
        screen.getByRole('button', { name: 'Open Room 2 menu' })
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      await user.click(await screen.findByRole('button', { name: 'Delete' }));

      // The API's own copy, verbatim — not a generic red toast.
      expect(await screen.findByText(message)).toBeVisible();
      expect(toastError).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole('button', { name: 'Deactivate instead' })
      );

      await waitFor(() =>
        expect(put).toHaveBeenCalledWith('resources/res_2', {
          isActive: false,
        })
      );
    });

    it('offers "Deactivate instead" when a category still holds resources', async () => {
      stubApi();
      const message = 'Delete or move the 3 resources in this category first';
      del.mockRejectedValue(conflictError(message));
      const user = userEvent.setup();

      renderWithProviders(<ResourcesPage />);
      expect(await screen.findByText('Room 2')).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Open Rooms menu' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      await user.click(await screen.findByRole('button', { name: 'Delete' }));

      expect(await screen.findByText(message)).toBeVisible();
      expect(toastError).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole('button', { name: 'Deactivate instead' })
      );

      await waitFor(() =>
        expect(put).toHaveBeenCalledWith('resources/categories/cat_rooms', {
          isActive: false,
        })
      );
    });
  });
});
