import { createLocationForm } from '@/features/organization-locations/location-form';
import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /organization-locations` — create a location.
 *
 * ONE surface: the unified entity editor (`/create/location`). The dialog this
 * replaced is gone, so there is no second create form to drift from.
 *
 * The onboarding wizard also creates the org's FIRST location, but through its
 * own step and its own body; it is not a second surface of this form and is not
 * claimed here. If it ever grows the same fields, it belongs in `surfaces`.
 *
 * What property 3 earns here is the blank-optional coalesce: `addressLine2`,
 * `county`, `postalCode` and `name` are `''` in the form and must reach the
 * wire as `null`, because the request schema is `.strict()` and the endpoint
 * that took `''` is the shape that produced the `POST /leads` 400.
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

const post = vi.fn();
const get = vi.fn();

/** One of each catalogue entity, so the tabs have something to tick. */
const CATALOG = {
  practitioner: { id: 'prac-1', name: 'Aoife Byrne' },
  service: { id: 'svc-1', name: 'Balayage' },
  product: { id: 'prod-1', name: 'Argan oil shampoo' },
  plan: { id: 'plan-1', name: 'Gold membership' },
  offer: { id: 'offer-1', name: 'January 20% off' },
};
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => vi.fn()(...a),
    delete: (...a: unknown[]) => vi.fn()(...a),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}));

// Loads the Google Maps SDK over the network; jsdom cannot. It writes into the
// address fields below it, and those are what this contract drives.
vi.mock('@/components/ui/address-autocomplete', () => ({
  AddressAutocomplete: () => null,
}));

import {
  renderEntityEditor,
  switchSection,
} from '@/features/entity-editors/testing/render-entity-editor';

const F = createLocationForm.fields;

/** Walk to a catalogue tab and tick one row by its visible name. */
async function tickCatalogItem(
  user: { click: (el: Element) => Promise<void> },
  tab: string,
  itemName: string
) {
  await switchSection(user as never, tab);
  // Both the desktop nav and the mobile pills render, so the section's content
  // is queried with findAll and driven through the first match — the same
  // convention `switchSection` itself uses for the nav buttons.
  await user.click(
    (await screen.findAllByRole('checkbox', { name: itemName }))[0]
  );
}

runFormContract({
  operation: 'POST organization-locations',
  description: 'Create location',
  form: createLocationForm,

  surfaces: [
    {
      name: 'unified entity editor (/create/location)',
      fills: {
        // The copy-from picker is hidden when the org has no other branch,
        // which is the case this run sets up. Reachability still has to mean
        // something, so assert the tab it lives on rendered.
        copyFromLocationId: async (user) => {
          await switchSection(user, 'Details');
          await screen.findByLabelText('Location name');
        },
        practitionerIds: (user) =>
          tickCatalogItem(user, 'Team', CATALOG.practitioner.name),
        serviceIds: (user) =>
          tickCatalogItem(user, 'Services', CATALOG.service.name),
        productIds: (user) =>
          tickCatalogItem(user, 'Products', CATALOG.product.name),
        membershipPlanIds: (user) =>
          tickCatalogItem(user, 'Memberships', CATALOG.plan.name),
        offerIds: (user) =>
          tickCatalogItem(user, 'Promotions', CATALOG.offer.name),
      },
      run: async (ctx) => {
        renderEntityEditor('location');
        await screen.findByRole('heading', { name: /add location/i });

        await ctx.fill('name', 'isPrimary');

        // Everything else lives on the Address tab; a field on an unvisited
        // tab has no reachable control, which is what property 2 asserts.
        await switchSection(ctx.user, 'Address');
        await ctx.fill(
          'addressLine1',
          'addressLine2',
          'city',
          'county',
          'postalCode',
          'country'
        );

        await ctx.fillRest();

        await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'loc_1' });
    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path.startsWith('practitioners')) {
        return Promise.resolve({ items: [CATALOG.practitioner] });
      }
      if (path.startsWith('organization-services')) {
        return Promise.resolve({ items: [CATALOG.service] });
      }
      if (path.startsWith('products')) {
        return Promise.resolve({ items: [CATALOG.product] });
      }
      if (path.startsWith('membership-plans')) {
        return Promise.resolve([CATALOG.plan]);
      }
      if (path.startsWith('offers')) {
        return Promise.resolve({ items: [CATALOG.offer] });
      }
      // No other branches: the copy-from control is hidden, which is the
      // first-location case and the one the contract drives.
      return Promise.resolve({ items: [] });
    });
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'organization-locations');
    if (!call) throw new Error('no POST organization-locations call captured');
    return call[1] as Record<string, unknown>;
  },

  // Two things spelled out rather than derived from `fields`:
  //
  //   - `latitude` / `longitude` are exempt (not typed), but the builder still
  //     emits them, so the nulls are pinned rather than allowed to go missing.
  //   - `catalog` is the additive seed. Every id ticked on a tab must arrive
  //     under its own key, and `copyFromLocationId` must be ABSENT when nothing
  //     was picked — an empty catalogue has to cost the server no work at all.
  expectedBody: () =>
    expectedFromFields(F, {
      latitude: null,
      longitude: null,
      catalog: {
        practitionerIds: [CATALOG.practitioner.id],
        serviceIds: [CATALOG.service.id],
        productIds: [CATALOG.product.id],
        membershipPlanIds: [CATALOG.plan.id],
        offerIds: [CATALOG.offer.id],
      },
    }),
});
