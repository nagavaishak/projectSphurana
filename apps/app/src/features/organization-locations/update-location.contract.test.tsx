import { updateLocationForm } from '@/features/organization-locations/location-form';
import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT /organization-locations/:id` — update a location.
 *
 * A SEPARATE operation from create, not a variation of it, and the wire
 * contract is where the difference bites: update is PATCH-shaped, so
 * `isPrimary` carries no `.default(false)` — omitting it must mean "leave
 * primary alone", never "demote" — and `addressLine1` / `city` may be left
 * untouched but not blanked. Create's contract cannot prove any of that.
 *
 * The catalogue tabs are deliberately NOT part of this body. On an existing
 * branch they are written by `PUT /organization-locations/:id/catalog`, so
 * `updateLocationForm` does not declare them and the editor's update call
 * cannot smuggle them in.
 *
 * What property 3 earns here is the same blank-optional coalesce create pins,
 * on the surface where it is most likely to regress: clearing a branch's
 * `addressLine2` must send `null`, not `''`.
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

/** The branch being edited, as the locations list returns it. */
const EXISTING = {
  id: 'loc-1',
  name: 'Old name',
  addressLine1: '1 Old Street',
  addressLine2: 'Old unit',
  city: 'Oldtown',
  county: 'Oldshire',
  postalCode: 'OLD 123',
  country: 'ie',
  isPrimary: false,
  latitude: null,
  longitude: null,
  openingHours: null,
};

const put = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    put: (...a: unknown[]) => put(...a),
    post: (...a: unknown[]) => vi.fn()(...a),
    delete: (...a: unknown[]) => vi.fn()(...a),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}));

// Loads the Google Maps SDK over the network; jsdom cannot.
vi.mock('@/components/ui/address-autocomplete', () => ({
  AddressAutocomplete: () => null,
}));

import {
  renderEntityEditor,
  switchSection,
} from '@/features/entity-editors/testing/render-entity-editor';

const F = updateLocationForm.fields;

runFormContract({
  operation: 'PUT organization-locations/:id',
  description: 'Update location',
  form: updateLocationForm,

  surfaces: [
    {
      name: 'unified entity editor (/edit/location/:id)',
      run: async (ctx) => {
        renderEntityEditor('location', { id: EXISTING.id });
        await screen.findByRole('heading', { name: /edit location/i });

        // The record's saved values land in the fields first, so every fill
        // below is an EDIT over real content — which is the state that produces
        // a blank optional, and the one create can never exercise.
        await waitFor(() =>
          expect(screen.getByLabelText('Location name')).toHaveValue('Old name')
        );

        await ctx.fill('name', 'isPrimary');

        await switchSection(ctx.user, 'Address');
        await ctx.fillRest();

        await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
          expect(
            put.mock.calls.some(
              (c) => c[0] === `organization-locations/${EXISTING.id}`
            )
          ).toBe(true)
        );
      },
    },
  ],

  reset: () => {
    put.mockReset();
    put.mockResolvedValue(EXISTING);
    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path.endsWith('/catalog')) {
        return Promise.resolve({
          practitionerIds: [],
          serviceIds: [],
          productIds: [],
          membershipPlanIds: [],
          offerIds: [],
        });
      }
      if (path.startsWith('organization-locations')) {
        return Promise.resolve({ items: [EXISTING] });
      }
      // `useListMembershipPlans` reads a bare array, not an envelope.
      if (path.startsWith('membership-plans')) return Promise.resolve([]);
      return Promise.resolve({ items: [] });
    });
  },

  readBody: () => {
    const call = put.mock.calls.find(
      (c) => c[0] === `organization-locations/${EXISTING.id}`
    );
    if (!call) throw new Error('no PUT organization-locations/:id captured');
    return call[1] as Record<string, unknown>;
  },

  // `latitude` / `longitude` are exempt — not typed — but the builder still
  // emits them, so the nulls are pinned rather than allowed to go missing.
  expectedBody: () =>
    expectedFromFields(F, { latitude: null, longitude: null }),
});
