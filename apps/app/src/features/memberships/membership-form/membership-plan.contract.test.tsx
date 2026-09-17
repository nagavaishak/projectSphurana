import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { screen, waitFor } from '@/test/render';
import type { OrganizationService } from '@borradh-workspace/api-client/types';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /membership-plans` — create a membership plan.
 *
 * ONE surface since the unified editor landed: `/create/membership` is the only
 * place a plan is authored (the dialog it replaced is deleted). Property 4 has
 * nothing to compare, which is the point — a second surface cannot drift from
 * this one because there is no second surface.
 *
 * What is still worth proving here, and what the component test cannot see:
 * the editor types a price in MAJOR units and a session count as a STRING, and
 * the wire takes cents and a number-or-null. Property 3 pins that mapping;
 * property 5 pins that a plan created without a description sends ABSENCE
 * rather than `''`.
 */

// Radix (select, popover, radio) needs these in jsdom.
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

const post = vi.fn();
const put = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  Navigate: () => null,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

import { renderEntityEditor } from '@/features/entity-editors/testing/render-entity-editor';
import {
  buildMembershipPlanPayload,
  membershipPlanForm,
} from './membership-plan.form';

const SERVICES = [
  { id: 'svc-1', name: 'Haircut' },
] as unknown as OrganizationService[];

runFormContract({
  operation: 'POST membership-plans',
  description: 'Create membership plan',
  form: membershipPlanForm,

  fills: {
    // Two-mode radio: "Limited" is a substring of "Unlimited", so the generic
    // radio driver cannot tell them apart — pick by exact accessible name.
    sessionsMode: async (user) => {
      await user.click(screen.getByRole('radio', { name: 'Limited' }));
    },
    serviceIds: async (user) => {
      await user.click(screen.getByRole('button', { name: 'Select services' }));
      await user.click(await screen.findByRole('option', { name: /Haircut/i }));
      await user.keyboard('{Escape}');
    },
  },

  surfaces: [
    {
      name: 'unified entity editor (/create/membership)',
      run: async (ctx) => {
        renderEntityEditor('membership');
        await screen.findByLabelText('Name');

        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  buildBody: (values) => buildMembershipPlanPayload(values),

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'plan_1' });
    put.mockReset();
    put.mockResolvedValue({ id: 'plan_1' });
    get.mockReset();
    get.mockImplementation((path: string) =>
      typeof path === 'string' && path.startsWith('organization-services')
        ? Promise.resolve({ items: SERVICES, total: SERVICES.length })
        : Promise.resolve({ items: [] })
    );
    navigate.mockReset();
  },

  readBody: () => {
    const call = post.mock.calls
      .filter((c) => c[0] === 'membership-plans')
      .at(-1);
    if (!call) throw new Error('no POST membership-plans call captured');
    return call[1] as Record<string, unknown>;
  },

  // The derived keys: '120.00' typed → 12000 minor units, the '8' string →
  // the number 8, and the currency / isActive the builder always sends.
  expectedBody: () =>
    expectedFromFields(membershipPlanForm.fields, {
      currency: 'eur',
      isActive: true,
      priceCents: 12000,
      sessionCount: 8,
    }),
});
