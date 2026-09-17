import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { UserEvent } from '@testing-library/user-event';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `POST lead-forms` — the Meta instant-form builder.
 *
 * Two surfaces build this body, and they are genuinely different UIs rather
 * than a desktop/mobile pair of the same one:
 *
 *   - the unified entity editor (`/create/lead-form`), one page of three blocks;
 *   - `CreateLeadFormDialog`, the three-step wizard, which SURVIVES only inside
 *     the campaign-creation modal — offering "create a lead form" there must not
 *     navigate away and throw the half-filled campaign draft out.
 *
 * That is exactly the shape PROPERTY 4 exists for: both run the same validator
 * and the same `leadFormBuilderToInput`, and this proves they still send one
 * body for one set of answers.
 */

// jsdom shims for Radix Select / Popover.
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
    delete: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

import { EntityEditorRoute } from '@/features/entity-editors/entity-editor-route';

import { CreateLeadFormDialog } from './components/create-lead-form-dialog';
import { leadFormBuilderToInput } from './components/lead-form-builder';
import { leadFormForm, toBuilderValue } from './components/lead-form.form';

const F = leadFormForm.fields;

const WHATSAPP_NUMBER = (F.whatsappNumber as { sample: string }).sample;

/** The one question row the recipe adds on top of the seeded defaults. */
const ADDED_QUESTION_LABEL = 'Preferred stylist';

const fills = {
  questions: async (user: UserEvent) => {
    await user.click(screen.getByRole('button', { name: /add field/i }));
    // A new row opens straight into its inline editor, typed CUSTOM.
    const labels = screen.getAllByLabelText('Label');
    await user.type(labels[labels.length - 1], ADDED_QUESTION_LABEL);
  },
  followUpChannel: async (user: UserEvent) => {
    // The card is disabled until the connected-account query resolves, and a
    // click landing on the same tick the card becomes enabled is dropped — so
    // press until it reports pressed, then assert it. The assertion is what
    // stops this quietly passing with nothing selected.
    const card = () =>
      screen.getByRole('button', { name: /chat on whatsapp/i });
    await waitFor(() => expect(card()).toBeEnabled());
    for (let attempt = 0; attempt < 3; attempt++) {
      if (card().getAttribute('aria-pressed') === 'true') break;
      await user.click(card());
    }
    await waitFor(() => expect(card()).toHaveAttribute('aria-pressed', 'true'));
  },
};

/** The wire shape `toApiQuestions` produces for the seeded rows plus ours. */
const expectedQuestions = [
  { type: 'FULL_NAME', required: true },
  { type: 'EMAIL', required: true },
  { type: 'PHONE', required: true },
  {
    type: 'CUSTOM',
    label: 'How soon are you hoping to get this treatment done?',
    key: 'treatment_timing',
    options: [
      { value: 'ASAP', key: 'asap' },
      { value: '1 week', key: '1_week' },
      { value: '2 weeks', key: '2_weeks' },
    ],
    required: true,
  },
  {
    type: 'CUSTOM',
    label: ADDED_QUESTION_LABEL,
    key: 'preferred_stylist',
    options: undefined,
    required: true,
  },
];

runFormContract({
  operation: 'POST lead-forms',
  description: 'Create Meta lead form',
  form: leadFormForm,
  fills,

  surfaces: [
    {
      name: 'unified entity editor (/create/lead-form)',
      run: async (ctx) => {
        renderWithProviders(
          <EntityEditorRoute mode="create" slug="lead-form" />
        );
        await screen.findByLabelText('Form name');

        // One page: every field is reachable without walking anywhere.
        await ctx.fill(
          'name',
          'questions',
          'followUpChannel',
          'whatsappNumber'
        );
        await ctx.fill('privacyPolicyUrl', 'thankYouTitle', 'thankYouBody');

        await ctx.user.click(
          screen.getAllByRole('button', { name: /^save/i })[0]
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'CreateLeadFormDialog (campaign modal wizard)',
      run: async (ctx) => {
        renderWithProviders(
          <CreateLeadFormDialog onOpenChange={() => {}} open />
        );
        await screen.findByLabelText('Form name');

        await ctx.fill('name', 'questions');
        await ctx.user.click(screen.getByRole('button', { name: /^next$/i }));

        await ctx.fill('followUpChannel', 'whatsappNumber');
        await ctx.user.click(screen.getByRole('button', { name: /^next$/i }));

        await ctx.fill('privacyPolicyUrl', 'thankYouTitle', 'thankYouBody');
        await ctx.user.click(
          screen.getByRole('button', { name: /create form/i })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'lf_new' });
    put.mockReset();
    put.mockResolvedValue({ id: 'lf_new' });
    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path.startsWith('integrations/whatsapp/accounts')) {
        return Promise.resolve({
          accounts: [
            {
              id: 'wa_1',
              isActive: true,
              tokenStatus: 'valid',
              phoneNumber: '+353870000000',
            },
          ],
        });
      }
      return Promise.resolve({ items: [] });
    });
  },

  buildBody: (values) => leadFormBuilderToInput(toBuilderValue(values)),

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'lead-forms');
    if (!call) throw new Error('no POST lead-forms call captured');
    return call[1] as Record<string, unknown>;
  },

  // `questions` is derived (the wire drops the client-side row ids), and every
  // save re-syncs the form to Meta.
  expectedBody: () =>
    expectedFromFields(leadFormForm.fields, {
      questions: expectedQuestions,
      whatsappNumber: WHATSAPP_NUMBER,
      syncToMeta: true,
    }),
});
