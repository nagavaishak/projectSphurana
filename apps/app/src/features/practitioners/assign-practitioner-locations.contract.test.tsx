import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import type { UserEvent } from '@testing-library/user-event';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT practitioners/:id/locations` — reassign a practitioner's
 * locations.
 *
 * NO FORM. Both surfaces are a list of rows, not a form: no schema, no defaults,
 * no labelled field set — the body is what the user ticked (or a menu action
 * they confirmed). Properties 1 and 2 have nothing to check; 3 and 4 do, and
 * they carry the weight, because the two surfaces look nothing alike:
 *
 *   - the unified editor's Locations section unticks the location, and
 *   - the scheduling team-member menu's "Unassign from location" clears them in
 *     one action.
 *
 * Both express the same intent — this member works nowhere — and both go through
 * the one shared builder, which is the single place `locationIds` expand into
 * `{ locations: [{ locationId }] }`. So both must put the SAME body on the wire.
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
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
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

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The scheduling feature's own shift mutation + the wage form are other
// operations; only its team-member menu is under test here.
vi.mock('@/features/scheduling/api', () => ({
  useSetWeeklyShifts: () => ({ setWeeklyShifts: vi.fn() }),
}));
vi.mock('@/features/scheduling', () => ({
  WageConfigForm: () => <div>wage-config-form</div>,
  useUpdateWageConfig: () => ({ updateWageConfig: vi.fn() }),
}));

vi.mock('@/features/upload/api/upload.hook', () => ({
  useUploadImage: () => ({
    uploadAsync: vi.fn().mockResolvedValue({ url: '' }),
    isUploading: false,
  }),
}));

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

import { EntityEditorRoute } from '@/features/entity-editors/entity-editor-route';
import { TeamMemberMenu } from '@/features/scheduling/components/team-member-menu';

const PRACTITIONER_ID = 'prac_1';

const EXISTING = {
  id: PRACTITIONER_ID,
  name: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  services: [{ serviceId: 'svc_1' }],
  locations: [{ locationId: 'loc_1' }],
} as unknown as PractitionerWithRelations;

const SERVICES = [{ id: 'svc_1', name: 'Haircut', categoryId: 'cat_1' }];
const LOCATIONS = [{ id: 'loc_1', name: 'Main Salon', isPrimary: true }];

const setChecked = async (user: UserEvent, name: string, want: boolean) => {
  const box = screen.getByRole('checkbox', { name });
  const isOn = box.getAttribute('data-state') === 'checked';
  if (isOn !== want) await user.click(box);
};

const locationsCall = () =>
  put.mock.calls.find(
    (c) => c[0] === `practitioners/${PRACTITIONER_ID}/locations`
  );

runFormContract({
  operation: 'PUT practitioners/:id/locations',
  description: 'Assign practitioner locations',
  form: null,
  noForm:
    'The editor unticks a LOCATION (that field is `teamMemberForm.locationIds`, ' +
    'which the create/update contracts already prove reachable); the scheduling ' +
    'menu has no field at all — it is a menu action on a row the user clicked. ' +
    'There is nothing to declare a control for on that surface. What this ' +
    'operation needs is 3 and 4: that both expressions of "works nowhere" reach ' +
    'the wire identically.',

  surfaces: [
    {
      name: 'unified entity editor (team-member Locations section)',
      run: async (ctx) => {
        renderWithProviders(
          <EntityEditorRoute
            id={PRACTITIONER_ID}
            mode="edit"
            slug="team-member"
          />
        );
        await screen.findByRole('heading', { name: 'Edit team member' });

        // The section label renders twice — desktop nav and mobile pills are
        // one tree laid out in CSS now, not two branches.
        await ctx.user.click(
          screen.getAllByRole('button', { name: 'Locations' })[0]
        );
        await screen.findByRole('checkbox', { name: 'Main Salon' });
        await setChecked(ctx.user, 'Main Salon', false);

        await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(locationsCall()).toBeDefined());
      },
    },
    {
      name: 'scheduling team-member menu (unassign)',
      run: async (ctx) => {
        renderWithProviders(
          <TeamMemberMenu
            practitionerId={PRACTITIONER_ID}
            practitionerName="Ada Lovelace"
            locations={
              [
                { locationId: 'loc_1' },
              ] as unknown as PractitionerWithRelations['locations']
            }
          >
            <button type="button">Ada Lovelace</button>
          </TeamMemberMenu>
        );

        await ctx.user.click(
          screen.getByRole('button', { name: 'Ada Lovelace' })
        );
        await ctx.user.click(await screen.findByText('Unassign from location'));
        // The menu no longer fires a raw window.confirm — it opens the shared
        // destructive confirmation, which has to be clicked through.
        await ctx.user.click(
          await screen.findByRole('button', { name: 'Unassign' })
        );
        await waitFor(() => expect(locationsCall()).toBeDefined());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    put.mockReset();
    put.mockResolvedValue({ id: PRACTITIONER_ID });
    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path.startsWith('organization-services')) {
        return Promise.resolve({ items: SERVICES, total: SERVICES.length });
      }
      if (path.startsWith('service-categories')) {
        return Promise.resolve([{ id: 'cat_1', name: 'Hair' }]);
      }
      if (path.startsWith('organization-locations')) {
        return Promise.resolve({ items: LOCATIONS });
      }
      if (path === `practitioners/${PRACTITIONER_ID}`) {
        return Promise.resolve(EXISTING);
      }
      if (path.startsWith('practitioners')) {
        return Promise.resolve({ items: [EXISTING], total: 1 });
      }
      return Promise.resolve({ items: [] });
    });
  },

  readBody: () => {
    const call = locationsCall();
    if (!call) {
      throw new Error('no PUT practitioners/:id/locations call captured');
    }
    return call[1] as Record<string, unknown>;
  },

  expectedBody: () => ({ locations: [] }),
});
