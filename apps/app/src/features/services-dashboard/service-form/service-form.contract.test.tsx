import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { OrganizationService } from '@borradh-workspace/api-client/types';
import { cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FORM CONTRACT: `POST|PUT organization-services` — create / update service.
 *
 * Three surfaces build this body: the desktop wizard (create/edit-service
 * dialogs) and the mobile service funnel.
 * All three compose the SAME shared fields (`service-form-fields.tsx`) and pass
 * their typed values to the SAME builders (`service-form-payload.ts`).
 *
 * They are driven here in EDIT mode, because that is the one operation all three
 * can perform: onboarding CONFIGURES services that were seeded earlier, so it
 * only ever PUTs. Property 4 (surfaces agree) is meaningless across a POST and a
 * PUT — the bodies are legitimately different shapes — so the parity that
 * matters is the one they can all reach.
 *
 * `practitionerIds` is `derived` — it never reaches the organization-services
 * body; the surfaces reconcile it through `PUT practitioners/:id/services`, its
 * own registered operation. It is still DECLARED and still filled, so the team
 * step's controls are proven to exist. Onboarding does not `own` it: its
 * configure step renders no team-member picker at all, so a service configured
 * only through onboarding has no practitioner and is not bookable. That is a
 * real gap, recorded here rather than papered over.
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

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

// The mobile funnel publishes its heading through the dashboard-header context;
// that chrome is not part of this form. (Its effect re-registers on every render,
// which loops without the real provider's shell around it.)
vi.mock('@/features/mobile-dashboard-header', () => ({
  useMobileDashboardHeaderContent: () => undefined,
}));

import { EditServiceDialog } from '../create-service-dialog/edit-service-dialog';
import { ServiceMobileFormPage } from '../mobile/service-mobile-form-page';
import { serviceForm } from './service-form-schema';

const SERVICE = {
  id: 'svc_1',
  organizationId: 'org_1',
  name: 'Old name',
  description: 'Old description',
  categoryId: 'cat_hair',
  category: 'treatment',
  appointmentDuration: 60,
  priceText: '€10.00',
  sortOrder: 0,
  isCustom: true,
  isActive: true,
  requiresDeposit: false,
} as unknown as OrganizationService;

const CATEGORIES = [
  { id: 'cat_hair', name: 'Hair', organizationId: 'org_1', sortOrder: 0 },
  { id: 'cat_skin', name: 'Skin', organizationId: 'org_1', sortOrder: 1 },
];

/** No practitioner holds this service, so the edit produces no assignment call. */
const PRACTITIONERS = [
  { id: 'prac_1', name: 'Ada Lovelace', photo: null, services: [] },
];

/** Desktop wizard and mobile funnel share the same 3-step walk. */
const driveWizard = async (
  ctx: {
    user: import('@testing-library/user-event').UserEvent;
    fill: (...keys: string[]) => Promise<void>;
  },
  submitLabel: RegExp
) => {
  await screen.findByLabelText('Service Name');
  await ctx.fill('name', 'categoryId', 'description');

  await ctx.user.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByLabelText('Duration');
  // `requiresDeposit` (the switch) is filled BEFORE `depositAmount` so the
  // amount input it reveals exists by the time the harness types into it.
  await ctx.fill(
    'durationMinutes',
    'priceType',
    'priceAmount',
    'taxCode',
    'requiresDeposit',
    // The fixed amount BEFORE the basis: only one amount input renders at a
    // time, so switching the basis to `percent` hides the fixed field.
    'depositAmount',
    'depositBasis',
    'depositPercent'
  );

  await ctx.user.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByText('All team members');
  await ctx.fill('practitionerIds');

  await ctx.user.click(screen.getByRole('button', { name: submitLabel }));
  await waitFor(() => expect(put).toHaveBeenCalled());
};

runFormContract({
  operation: 'POST|PUT organization-services',
  description: 'Create / update service',
  form: serviceForm,

  fills: {
    // The default is a real user choice: let Stripe use the clinic preset.
    // Seeing the labelled picker proves the control remains reachable.
    taxCode: async () => {
      await screen.findByLabelText(serviceForm.labels.taxCode);
    },
    // The team step is a checkbox per practitioner, plus a select-all. Each
    // checkbox is labelled by the practitioner's row (avatar + name).
    practitionerIds: async (user) => {
      await user.click(
        await screen.findByLabelText(new RegExp(PRACTITIONERS[0].name, 'i'))
      );
    },
  },

  surfaces: [
    {
      name: 'desktop edit-service-dialog',
      run: async (ctx) => {
        renderWithProviders(
          <EditServiceDialog open onOpenChange={() => {}} service={SERVICE} />
        );
        await driveWizard(ctx, /^save changes$/i);
      },
    },
    {
      name: 'mobile service funnel',
      run: async (ctx) => {
        renderWithProviders(<ServiceMobileFormPage editingService={SERVICE} />);
        await driveWizard(ctx, /^save changes$/i);
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'svc_1' });
    put.mockReset();
    put.mockResolvedValue({ ...SERVICE });
    get.mockReset();
    get.mockImplementation((path: string) => {
      // Deposit toggle is gated on an active Stripe Connect — return one so the
      // deposit fields stay reachable across every surface.
      if (path.includes('stripe')) {
        return Promise.resolve({ isActive: true, chargesEnabled: true });
      }
      if (path.startsWith('service-categories')) {
        return Promise.resolve(CATEGORIES);
      }
      if (path.startsWith('practitioners')) {
        return Promise.resolve({ items: PRACTITIONERS, total: 1 });
      }
      // The variants sub-path must resolve BEFORE the generic services list —
      // this service has no pricing options, so the editor loads empty.
      if (path.includes('/variants')) {
        return Promise.resolve({ items: [] });
      }
      if (path.startsWith('organization-services')) {
        return Promise.resolve({
          items: [SERVICE],
          total: 1,
          limit: 100,
          offset: 0,
        });
      }
      return Promise.resolve({ items: [], total: 0 });
    });
  },

  readBody: () => {
    const call = put.mock.calls.find(
      (c) => c[0] === `organization-services/${SERVICE.id}`
    );
    if (!call)
      throw new Error('no PUT organization-services/:id call captured');
    return call[1] as Record<string, unknown>;
  },

  // `id` rides in the URL, not the body. The derived keys:
  //   durationMinutes  →  appointmentDuration
  //   priceType + priceAmount  →  (priceType, priceCents)  ('from' + '75' → 7500 cents)
  //   depositAmount ('25')  →  depositAmountCents (2500); requiresDeposit rides 1:1.
  //   depositPercent ('20')  →  depositPercent (20), a number not a string.
  //   requiresDeposit       →  paymentPolicy ('deposit' | 'in_clinic'). The
  //     switch has no `paymentPolicy` control of its own; the booking resolver
  //     reads the policy, so a body without it collects nothing.
  // The freeform `priceText` is DEAD — the wire now carries the structured price.
  expectedBody: (surface) =>
    expectedFromFields(
      serviceForm.fields,
      {
        appointmentDuration: 90,
        priceType: 'from',
        priceCents: 7500,
        taxCode: null,
        depositAmountCents: 2500,
        depositPercent: 20,
        paymentPolicy: 'deposit',
      },
      { only: surface.owns }
    ),
});

/**
 * MOBILE PARITY — rooms & equipment.
 *
 * The section is not part of the `organization-services` body (it PUTs to its
 * own endpoint), so the contract harness above cannot see it. It is still a
 * control on this form, and a control that exists only on desktop is a bug on
 * this codebase — so both surfaces are driven to the same step and checked for
 * the same controls, on the same data.
 */
const ROOM_CATEGORY = {
  id: 'cat-rooms',
  organizationId: 'org_1',
  name: 'Treatment rooms',
  kind: 'room' as const,
  description: null,
  sortOrder: 0,
  isActive: true,
  resourceCount: 1,
};
const ROOMS = [
  { id: 'res-1', categoryId: 'cat-rooms', name: 'Room 1', isActive: true },
];

const SURFACES = [
  {
    name: 'desktop edit-service-dialog',
    render: () =>
      renderWithProviders(
        <EditServiceDialog open onOpenChange={() => {}} service={SERVICE} />
      ),
  },
  {
    name: 'mobile service funnel',
    render: () =>
      renderWithProviders(<ServiceMobileFormPage editingService={SERVICE} />),
  },
];

/** Baseline mock: an org with no rooms at all. */
const mockNoResources = () => {
  get.mockReset();
  get.mockImplementation((path: string) => {
    if (path.includes('stripe')) {
      return Promise.resolve({ isActive: true, chargesEnabled: true });
    }
    if (path.startsWith('service-categories'))
      return Promise.resolve(CATEGORIES);
    if (path.startsWith('practitioners')) {
      return Promise.resolve({ items: PRACTITIONERS, total: 1 });
    }
    if (path.includes('/variants')) return Promise.resolve({ items: [] });
    if (path.startsWith('organization-services')) {
      return Promise.resolve({
        items: [SERVICE],
        total: 1,
        limit: 100,
        offset: 0,
      });
    }
    return Promise.resolve([]);
  });
};

/** The same org, once it has set up one room. */
const mockWithRooms = () => {
  mockNoResources();
  const base = get.getMockImplementation() as (p: string) => Promise<unknown>;
  get.mockImplementation((path: string) => {
    if (path.startsWith('resources/requirements')) {
      return Promise.resolve({
        serviceId: SERVICE.id,
        turnaroundMinutes: null,
        requirements: [],
      });
    }
    if (path.startsWith('resources/categories')) {
      return Promise.resolve([ROOM_CATEGORY]);
    }
    if (path.startsWith('resources')) return Promise.resolve(ROOMS);
    return base(path);
  });
};

/** Walk either surface to the pricing/duration step. */
const gotoPricingStep = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByLabelText('Service Name');
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByLabelText('Duration');
};

describe('rooms & equipment — surface parity', () => {
  beforeEach(() => {
    put.mockReset();
    put.mockResolvedValue({ ...SERVICE });
    post.mockReset();
    post.mockResolvedValue({ id: SERVICE.id });
  });
  afterEach(() => cleanup());

  for (const surface of SURFACES) {
    it(`renders the section on ${surface.name} once the org has a room`, async () => {
      mockWithRooms();
      const user = userEvent.setup();
      surface.render();
      await gotoPricingStep(user);

      expect(
        await screen.findByRole('switch', { name: /requires a room/i })
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Turnaround time')).toBeInTheDocument();

      await user.click(
        screen.getByRole('switch', { name: /requires a room/i })
      );
      // Defaults to "any room" — an EMPTY eligible list, the widest rule.
      expect(await screen.findByLabelText('Any room')).toBeChecked();
      expect(screen.getByLabelText('Room 1')).not.toBeChecked();
    });

    it(`hides the section on ${surface.name} for an org with no resources`, async () => {
      mockNoResources();
      const user = userEvent.setup();
      surface.render();
      await gotoPricingStep(user);

      expect(screen.queryByText('Rooms & equipment')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('switch', { name: /requires a room/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText('Turnaround time')
      ).not.toBeInTheDocument();
    });
  }
});
