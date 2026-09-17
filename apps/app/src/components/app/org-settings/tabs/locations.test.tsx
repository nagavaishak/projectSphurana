import { renderWithProviders, screen } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationsTab } from './locations';

/**
 * Regression coverage for the settings → Locations tab.
 *
 * The reported bug: a location's opening hours were carried all the way to this
 * component by the API but never rendered. These tests lock in that (1) the
 * card now shows the weekly hours and (2) a location with no standing hours
 * shows the inherit-default hint.
 *
 * EDITING hours is no longer this tab's job — "Edit" is a link to
 * `/edit/location/:id` now — so the case that drove the old dialog moved to
 * `entity-editors/definitions/location.component.test.tsx` with it.
 */

// Radix ScrollArea/Select rely on ResizeObserver, absent from jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// "Add Location" is a <Link> to the shared create editor, and Link reads the
// router context. `renderWithProviders` deliberately stands up no
// RouterProvider (see src/test/render.tsx), so router-coupled components mock
// the module — the pattern every other spec here uses.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNavigate: () => vi.fn(),
}));

const get = vi.fn();
const put = vi.fn();

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    put: (...args: unknown[]) => put(...args),
    delete: vi.fn(),
  },
}));

const baseLocation = {
  id: 'loc-1',
  organizationId: 'org-1',
  name: 'Main Clinic',
  addressLine1: '1 Grafton St',
  addressLine2: null,
  city: 'Dublin',
  county: null,
  postalCode: null,
  country: 'ie',
  latitude: null,
  longitude: null,
  stripeTerminalLocationId: null,
  slug: 'main-clinic',
  about: null,
  amenities: null,
  isPrimary: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Stub `apiClient.get` BY PATH, not by call order.
 *
 * `mockResolvedValueOnce` assumed this component made exactly one GET. It makes
 * two — `useListLocations` now also resolves the active organization — so the
 * org request consumed the locations stub and the tab rendered its empty state.
 * Keying on the path makes the test independent of how many requests, and in
 * what order, the component happens to make.
 */
const stubGet = (locations: unknown[]) => {
  get.mockImplementation((path: string) =>
    String(path).startsWith('organization-locations')
      ? Promise.resolve({ items: locations })
      : Promise.resolve({ id: 'org-1', name: 'Test Org' })
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LocationsTab opening hours', () => {
  it('renders the weekly opening hours on the location card', async () => {
    stubGet([
      {
        ...baseLocation,
        // Mon–Fri 9:00am–5:00pm, closed weekends.
        openingHours: {
          '1': { from: 540, to: 1020 },
          '2': { from: 540, to: 1020 },
          '3': { from: 540, to: 1020 },
          '4': { from: 540, to: 1020 },
          '5': { from: 540, to: 1020 },
        },
      },
    ]);

    renderWithProviders(<LocationsTab />);

    await screen.findByText('Main Clinic');
    expect(screen.getByText('Opening hours')).toBeInTheDocument();
    // Monday row shows the formatted range, Saturday is closed.
    expect(screen.getAllByText('9:00 AM – 5:00 PM').length).toBeGreaterThan(0);
    expect(screen.getByText('Monday')).toBeInTheDocument();
    expect(screen.getByText('Saturday')).toBeInTheDocument();
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
  });

  it('shows the inherit-default hint when a location has no standing hours', async () => {
    stubGet([{ ...baseLocation, openingHours: null }]);

    renderWithProviders(<LocationsTab />);

    await screen.findByText('Main Clinic');
    expect(screen.getByText('Uses default opening hours')).toBeInTheDocument();
  });
});
