/**
 * REGRESSION — archived services must be reachable from the services page.
 *
 * `useListServices` hides archived rows unless the caller passes the
 * `isActive` key at all, and this page did not pass it. Two consequences, both
 * shipped:
 *
 *   1. The page's own "Archive" action removed a service from the ONLY screen
 *      that lists services, so there was nowhere left to un-archive it from.
 *   2. The CSV import's "import as archived, so I can review them" wrote rows
 *      that could never be reviewed. A clinic imported a catalogue, got
 *      "Import complete: 11 added", and saw nothing.
 *
 * The hook itself was never wrong and is covered in
 * `organization-services/api/list-services/list-services.test.ts`. What was
 * wrong is what THIS page asks it for, which is why the assertion below is on
 * the call, not on the hook.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listServices = vi.fn();

// PARTIAL mock. The page mounts both import dialogs, which reach into this
// same barrel for their own hooks; enumerating them here would make this
// suite fail every time one is added. Only `useListServices` is replaced.
vi.mock('@/features/organization-services', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useListServices: (params: unknown) => {
    listServices(params);
    return {
      services: [
        {
          id: 'svc_active',
          name: 'Signature Glow Facial',
          isActive: true,
          priceType: 'fixed',
          priceCents: 8500,
          appointmentDuration: 60,
          locationIds: [],
        },
        {
          id: 'svc_archived',
          name: 'Imported Hydrafacial',
          isActive: false,
          priceType: 'fixed',
          priceCents: 14500,
          appointmentDuration: 75,
          locationIds: [],
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    };
  },
  useDeleteService: () => ({ deleteService: vi.fn() }),
  useUpdateService: () => ({ updateService: vi.fn() }),
  useRemoveServiceLocation: () => ({
    removeServiceLocationAsync: vi.fn(),
    isRemoving: false,
  }),
}));

vi.mock('@/features/organization', () => ({
  useActiveOrganization: () => ({ data: null }),
}));

vi.mock('@/features/organization-locations', () => ({
  useActiveLocation: () => ({ location: null, locations: [] }),
  isSharedAcrossBranches: () => false,
}));

vi.mock('@/features/service-categories', () => ({
  useListCategories: () => ({ categories: [] }),
}));

vi.mock('@/hooks/use-org-currency', () => ({
  useOrgCurrency: () => ({ format: (cents: number) => `€${cents / 100}` }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: unknown }) => children,
}));

import { ServicesPage } from './services-page';

beforeEach(() => listServices.mockClear());

/**
 * The import dialogs mount with the page and use their real (unmocked) hooks,
 * which need a query client. Nothing here fetches — the only query that would
 * is `useListServices`, and that one IS mocked.
 */
const renderPage = (ui: ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
  );

describe('ServicesPage — archived services are reachable', () => {
  it('asks for archived services as well as active ones', () => {
    renderPage(<ServicesPage />);

    // `isActive: undefined` is NOT the same as omitting the key — the hook
    // reads `'isActive' in params` and defaults a missing key to true. This
    // assertion is the whole regression.
    expect(listServices).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: undefined })
    );
    const [params] = listServices.mock.calls[0] as [Record<string, unknown>];
    expect('isActive' in params).toBe(true);
  });

  it('renders an archived service, badged, alongside the active ones', () => {
    renderPage(<ServicesPage />);

    expect(screen.getByText('Imported Hydrafacial')).toBeInTheDocument();
    expect(screen.getByText('Signature Glow Facial')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
