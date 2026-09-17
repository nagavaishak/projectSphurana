import { aLead } from '@/features/leads/contracts/base-lead';
import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import {
  type LeadDetail,
  fixture,
  leadDetailSchema,
} from '@borradh-workspace/contracts';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT /leads/:id` — update lead / client.
 *
 * Two surfaces edit a lead: the docked {@link LeadDetailPanel} and the client
 * profile's {@link ClientDetailsTab}. Both render the one shared
 * {@link LeadEditFields} and hand the shared intent to the one
 * `buildUpdateLeadPayload` — they used to copy-paste the same trim/drop-empty
 * body assembly verbatim.
 *
 * The harness fills every field the form DECLARES — not a hand-written list, so
 * it cannot quietly omit the field that was dropped — and checks the four
 * properties. See `@/test/form-contract/harness`.
 */

// jsdom shim for Radix Select.
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

const put = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    put: (...args: unknown[]) => put(...args),
    get: (...args: unknown[]) => get(...args),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ClientDetailsTab uses useNavigate (delete redirect); keep the real module and
// override only useNavigate.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/customers' } }),
}));

// LeadDetailPanel closes itself through the side-panel dock; stub the context.
vi.mock('@/components/app/side-panel', () => ({
  useSidePanel: () => ({ close: vi.fn() }),
}));

import { ClientDetailsTab } from '@/features/clients/components/client-details-tab';
import { LeadDetailPanel } from './components/lead-detail/lead-detail-panel';
import { updateLeadForm } from './components/lead-detail/update-lead-schema';

const LEAD_ID = 'lead-1';

/** The saved lead both surfaces load and edit. Every value differs from a sample. */
const makeLead = (): LeadDetail =>
  fixture(leadDetailSchema, {
    ...aLead({
      id: LEAD_ID,
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob@x.io',
      source: 'manual',
      status: 'new',
      tags: [],
      consentEmail: false,
      consentSms: false,
      consentVoice: false,
    }),
    sourceLeadForm: null,
  });

/** Both surfaces render the same shared fields, so one walk fits both. */
const fillAndSubmit = async (ctx: {
  fillRest: () => Promise<void>;
  user: import('@testing-library/user-event').UserEvent;
}) => {
  // The panel loads the lead asynchronously and resets the form on arrival —
  // wait for that before typing, or the reset overwrites what we filled.
  const first = await screen.findByLabelText(/^\s*First Name \*\s*$/i);
  await waitFor(() => expect(first).toHaveValue('Bob'));

  await ctx.fillRest();
  await ctx.user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(put).toHaveBeenCalled());
};

runFormContract({
  operation: 'PUT leads/:id',
  description: 'Update lead / client',
  form: updateLeadForm,

  fills: {
    // The tag chips are a bespoke type-and-Enter input with no labelled control.
    tags: async (user) => {
      const input = screen.getByPlaceholderText(/type a tag and press enter/i);
      for (const tag of ['vip']) await user.type(input, `${tag}{Enter}`);
    },
  },

  surfaces: [
    {
      name: 'lead-detail-panel',
      run: async (ctx) => {
        renderWithProviders(<LeadDetailPanel leadId={LEAD_ID} />);
        await fillAndSubmit(ctx);
      },
    },
    {
      name: 'client-details-tab',
      run: async (ctx) => {
        renderWithProviders(<ClientDetailsTab lead={makeLead()} />);
        await fillAndSubmit(ctx);
      },
    },
  ],

  reset: () => {
    put.mockReset();
    put.mockResolvedValue({ id: LEAD_ID });
    get.mockReset();
    get.mockResolvedValue(makeLead());
  },

  readBody: () => {
    const call = put.mock.calls.find((c) => c[0] === `leads/${LEAD_ID}`);
    if (!call) throw new Error(`no PUT leads/${LEAD_ID} call captured`);
    return call[1] as Record<string, unknown>;
  },

  // Straight from the field samples: the builder only trims and drops empties,
  // and every sample is a non-empty trimmed value, so nothing is derived.
  expectedBody: () => expectedFromFields(updateLeadForm.fields),
});
