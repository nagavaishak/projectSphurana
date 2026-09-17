import { describe, expect, it, vi } from 'vitest';

/**
 * COMPONENT TEST: the `location` entity editor.
 *
 * Tier 1. Locations are create-only and split Details from Address, so this
 * covers that split, the two required address fields, and the fact that the
 * address search does NOT replace the manual fields — the failure mode of the
 * dialog this editor replaces, where picking a place hid the inputs behind an
 * either/or toggle. The POSTed body is the contract's job
 * (`location.contract.test.tsx`).
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  Navigate: () => null,
  // These specs stand up no RouterProvider (see `render-entity-editor.tsx`),
  // and the real `useRouterState` reads a router off context — so every editor
  // that resolves branch-scoped paths through `useRoutes()` crashes without
  // this. An org-level pathname is the honest answer: the editors are reached
  // from both branch and org routes.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard' } }),
}));

// The real control loads the Google Maps SDK over the network, which jsdom
// cannot do. Its own behaviour is not what this spec is about.
vi.mock('@/components/ui/address-autocomplete', () => ({
  AddressAutocomplete: () => null,
}));

const EXISTING = {
  id: 'loc-1',
  name: 'Bray Studio',
  addressLine1: '12 Quinsboro Road',
  addressLine2: null,
  city: 'Bray',
  county: 'Wicklow',
  postalCode: 'A98 X264',
  country: 'ie',
  isPrimary: false,
  latitude: null,
  longitude: null,
  openingHours: null,
};

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi.fn().mockImplementation((path: string) => {
      if (path.startsWith('organization-services')) {
        return Promise.resolve({ items: [{ id: 'svc-1', name: 'Balayage' }] });
      }
      if (path.endsWith('/catalog')) {
        return Promise.resolve({
          practitionerIds: [],
          serviceIds: ['svc-1'],
          productIds: [],
          membershipPlanIds: [],
          offerIds: [],
        });
      }
      if (path.startsWith('organization-locations')) {
        return Promise.resolve({ items: [EXISTING] });
      }
      // `useListMembershipPlans` reads the response as a bare array, not an
      // envelope — a `{ items: [] }` here fails inside the hook, not the test.
      if (path.startsWith('membership-plans')) return Promise.resolve([]);
      return Promise.resolve({ items: [] });
    }),
    post: vi.fn().mockResolvedValue({ id: 'loc_1' }),
    put: vi.fn().mockResolvedValue({ id: 'loc_1' }),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import { waitFor } from '@testing-library/react';

import {
  expectEditorChrome,
  renderEntityEditor,
  screen,
  switchSection,
} from '../testing/render-entity-editor';

describe('location entity editor', () => {
  it('renders the shared chrome and every section', async () => {
    renderEntityEditor('location');

    await expectEditorChrome({
      title: /add location/i,
      sections: [
        'Details',
        'Address',
        'Team',
        'Services',
        'Products',
        'Memberships',
        'Promotions',
      ],
    });
  });

  it('shows the identity fields on Details', async () => {
    renderEntityEditor('location');

    expect(await screen.findByLabelText('Location name')).toBeInTheDocument();
    expect(screen.getByLabelText('Primary location')).toBeInTheDocument();
    // Address lives on its own section.
    expect(screen.queryByLabelText('City')).not.toBeInTheDocument();
  });

  it('shows the address fields on Address', async () => {
    const { user } = renderEntityEditor('location');
    await screen.findByLabelText('Location name');

    await switchSection(user, 'Address');

    expect(await screen.findByLabelText('Address line 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Address line 2')).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('County')).toBeInTheDocument();
    expect(screen.getByLabelText('Postal code')).toBeInTheDocument();
    expect(screen.getByLabelText('Country')).toBeInTheDocument();
  });

  it('accepts input into a declared field', async () => {
    const { user } = renderEntityEditor('location');

    const name = await screen.findByLabelText('Location name');
    await user.type(name, 'Bray Studio');

    expect(name).toHaveValue('Bray Studio');
  });

  it('offers the org catalogue on a catalogue tab, ticked by nobody', async () => {
    const { user } = renderEntityEditor('location');
    await screen.findByLabelText('Location name');

    await switchSection(user, 'Services');

    // Nothing is pre-ticked: "copy nothing" is the default, and an empty tab is
    // NOT an empty branch — anything unrestricted is already available here.
    const [service] = await screen.findAllByRole('checkbox', {
      name: 'Balayage',
    });
    expect(service).not.toBeChecked();

    await user.click(service);
    expect(service).toBeChecked();
  });

  it('keeps Save disabled until the address is answered', async () => {
    const { user } = renderEntityEditor('location');
    await screen.findByLabelText('Location name');

    const save = screen.getAllByRole('button', { name: /^save/i })[0];
    expect(save).toBeDisabled();

    await switchSection(user, 'Address');
    await user.type(
      await screen.findByLabelText('Address line 1'),
      '12 Main St'
    );
    await user.type(screen.getByLabelText('City'), 'Bray');

    expect(screen.getAllByRole('button', { name: /^save/i })[0]).toBeEnabled();
  });

  it('loads the record and its assignments in edit mode', async () => {
    const { user } = renderEntityEditor('location', { id: 'loc-1' });

    expect(
      await screen.findByRole('heading', { level: 1, name: /edit location/i })
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Location name')).toHaveValue(
      'Bray Studio'
    );

    // The service this branch is explicitly assigned comes back ticked — the
    // state the catalogue endpoint returned, not "everything available here".
    await switchSection(user, 'Services');
    const [service] = await screen.findAllByRole('checkbox', {
      name: 'Balayage',
    });
    expect(service).toBeChecked();
  });

  it('offers opening hours on edit but not on create', async () => {
    const { unmount } = renderEntityEditor('location');
    await screen.findByLabelText('Location name');
    // Nothing to write hours against until the branch exists.
    expect(
      screen.queryAllByRole('button', { name: 'Opening hours' })
    ).toHaveLength(0);
    unmount();

    renderEntityEditor('location', { id: 'loc-1' });
    await screen.findByRole('heading', { level: 1, name: /edit location/i });
    expect(
      screen.getAllByRole('button', { name: 'Opening hours' }).length
    ).toBeGreaterThan(0);
  });

  it('persists edited opening hours via the standing endpoint', async () => {
    // Moved here from the org-settings Locations tab when "Edit" became a link
    // to this page: the hours editor now lives on the Opening hours tab, and
    // the guarantee — that hours go to their OWN endpoint, not the location
    // body — is unchanged.
    const { user } = renderEntityEditor('location', { id: 'loc-1' });
    await screen.findByRole('heading', { level: 1, name: /edit location/i });

    await switchSection(user, 'Opening hours');
    await user.click(
      (await screen.findAllByRole('switch', { name: /toggle monday/i }))[0]
    );
    await user.click(screen.getAllByRole('button', { name: /^save/i })[0]);

    const { apiClient } = await import('@borradh-workspace/api-client');
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        'locations/loc-1/opening-hours/standing',
        { openingHours: { '1': { from: 540, to: 1020 } } },
        expect.any(Object)
      )
    );
  });

  it('leaves the editor when cancelled', async () => {
    const { user } = renderEntityEditor('location');
    await screen.findByLabelText('Location name');

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(navigate).toHaveBeenCalled();
  });
});
