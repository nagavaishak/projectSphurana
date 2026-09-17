import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type {
  OrganizationService,
  PractitionerWithRelations,
} from '@borradh-workspace/api-client/types';
import type { UserEvent } from '@testing-library/user-event';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT practitioners/:id/services` — reassign a practitioner's
 * services.
 *
 * NO FORM. Both surfaces are a checkbox list, not a form: there is no schema, no
 * defaults and no labelled field set for this operation — the body is the set of
 * rows the user ticked. Properties 1 and 2 have nothing to check; properties 3
 * and 4 still do, and they are the whole point here, because THE TWO SURFACES
 * TICK DIFFERENT THINGS:
 *
 *   - the team-member editor ticks SERVICES for one practitioner, and
 *   - the service form ticks PRACTITIONERS for one service, which
 *     `buildPractitionerAssignments` folds back into that practitioner's full
 *     service set.
 *
 * They meet at the one shared builder, so the same end state must reach the wire
 * as the same body. Here both surfaces put `prac_1` (who already has `svc_1`) on
 * `svc_2` as well — driven through their own real UIs.
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

// The editor navigates back to the team list on save; no router in these tests.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
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

import { EntityEditorRoute } from '@/features/entity-editors/entity-editor-route';
import { EditServiceDialog } from '@/features/services-dashboard/create-service-dialog/edit-service-dialog';

const PRACTITIONER_ID = 'prac_1';

/** `prac_1` already provides Haircut; both surfaces add Colour. */
const EXISTING = {
  id: PRACTITIONER_ID,
  name: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  services: [{ serviceId: 'svc_1' }],
  locations: [{ locationId: 'loc_1' }],
} as unknown as PractitionerWithRelations;

const SERVICES = [
  { id: 'svc_1', name: 'Haircut', categoryId: 'cat_1' },
  { id: 'svc_2', name: 'Colour', categoryId: 'cat_1' },
];
const LOCATIONS = [{ id: 'loc_1', name: 'Main Salon', isPrimary: true }];

const COLOUR_SERVICE = {
  id: 'svc_2',
  name: 'Colour',
  categoryId: 'cat_1',
  description: null,
  appointmentDuration: 90,
  priceText: '€80',
} as unknown as OrganizationService;

const setChecked = async (
  user: UserEvent,
  name: string | RegExp,
  want: boolean
) => {
  const box = screen.getByRole('checkbox', { name });
  const isOn = box.getAttribute('data-state') === 'checked';
  if (isOn !== want) await user.click(box);
};

const servicesCall = () =>
  put.mock.calls.find(
    (c) => c[0] === `practitioners/${PRACTITIONER_ID}/services`
  );

runFormContract({
  operation: 'PUT practitioners/:id/services',
  description: 'Assign practitioner services',
  form: null,
  noForm:
    'The two surfaces do not tick the same thing. The team-member editor ticks SERVICES ' +
    '(that field is `teamMemberForm.serviceIds`, and the create/update ' +
    'contracts already prove it reachable); the service form ticks ' +
    'PRACTITIONERS, and `buildPractitionerAssignments` folds that back into ' +
    "this practitioner's service set. There is no `serviceIds` control on the " +
    'service form to declare a field for — per-surface fills could paper over ' +
    'that, but the field would be a fiction. What this operation needs is 3 ' +
    'and 4: that both ways of saying it reach the wire identically.',

  surfaces: [
    {
      name: 'unified entity editor (team-member Services section)',
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
          screen.getAllByRole('button', { name: 'Services' })[0]
        );
        await screen.findByRole('checkbox', { name: 'Haircut' });
        await setChecked(ctx.user, 'Haircut', true);
        await setChecked(ctx.user, 'Colour', true);

        await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(servicesCall()).toBeDefined());
      },
    },
    {
      name: 'service-form team assignment',
      run: async (ctx) => {
        renderWithProviders(
          <EditServiceDialog
            open
            onOpenChange={() => {}}
            service={COLOUR_SERVICE}
          />
        );

        // Walk the wizard to its Team Members step.
        await screen.findByText('1. Basic Details');
        await ctx.user.click(screen.getByRole('button', { name: 'Continue' }));
        await ctx.user.click(screen.getByRole('button', { name: 'Continue' }));
        await screen.findByText('3. Team Members');

        // Tick Ada for this service; she keeps Haircut, and gains Colour.
        // (The row's accessible name carries the avatar initials: "AL Ada …".)
        await setChecked(ctx.user, /Ada Lovelace/, true);

        await ctx.user.click(
          screen.getByRole('button', { name: 'Save changes' })
        );
        await waitFor(() => expect(servicesCall()).toBeDefined());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    put.mockReset();
    put.mockImplementation((path: string) => {
      if (path.startsWith('organization-services/')) {
        return Promise.resolve(COLOUR_SERVICE);
      }
      return Promise.resolve({ id: PRACTITIONER_ID });
    });
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
    const call = servicesCall();
    if (!call)
      throw new Error('no PUT practitioners/:id/services call captured');
    return call[1] as Record<string, unknown>;
  },

  expectedBody: () => ({ serviceIds: ['svc_1', 'svc_2'] }),
});
