import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST videos/generate-script`.
 *
 * Four call sites fire this, but three of them (the create-video wizard's
 * context, generate-video-dialog, new-post-dialog) generate REACTIVELY — an
 * effect fires as soon as a service is picked, from state the user set for other
 * reasons. There is no "generate a script" form on those screens.
 *
 * The one surface where the user makes a choice specifically to steer the script
 * and then presses a Generate button is the create-from-client wizard's
 * Configure step: pick the TEMPLATE VARIATION, hit "AI Generate". That is the
 * form (see `generate-video-script.form`); `templateId` is pinned to
 * `before-after` by the flow.
 *
 * FINDING (not a dropped control, but worth knowing): this surface renders a
 * narration picker and knows the face group's `serviceId`, yet neither reaches
 * the generate-script body — `handleGenerateScript` sends only
 * `{ templateId, variationId }`. The other three call sites DO send `serviceId`
 * + `narrationMode`, so scripts generated from this wizard are not service- or
 * narration-tailored. That is an intent gap in the surface, not a form-contract
 * violation, so this spec pins the body it actually builds.
 */

// jsdom shims for Radix Select.
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
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
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

// The Configure step reads the face group it is building a video for from the
// wizard shell (client picker → media review → configure).
vi.mock(
  '@/routes/_authed/dashboard/l/$locationId/videos/create-from-client/-components/wizard-context',
  () => ({
    useWizard: () => ({
      step: 'configure',
      faceGroupId: 'fg-1',
      templateId: 'before-after',
      variationId: '',
      setFaceGroupId: vi.fn(),
      setTemplate: vi.fn(),
      goTo: vi.fn(),
      goBack: vi.fn(),
    }),
  })
);

import { StepConfigure } from '@/routes/_authed/dashboard/l/$locationId/videos/create-from-client/-components/step-configure';
import { generateVideoScriptForm } from './api/generate-video-script';

runFormContract({
  operation: 'POST videos/generate-script',
  description: 'Generate video script',
  form: generateVideoScriptForm,

  surfaces: [
    {
      name: 'create-from-client configure step',
      run: async (ctx) => {
        renderWithProviders(<StepConfigure />);
        await screen.findByText(/configure video/i);

        await ctx.fill('variationId');

        await ctx.user.click(
          screen.getByRole('button', { name: /ai generate/i })
        );
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ scriptText: 'A generated script.' });
    get.mockReset();
    get.mockResolvedValue({
      faceGroup: {
        id: 'fg-1',
        clientName: 'Alice Smith',
        serviceId: 'svc-1',
        isExcluded: false,
      },
      assets: [],
    });
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'videos/generate-script');
    if (!call) throw new Error('no POST videos/generate-script captured');
    return call[1] as Record<string, unknown>;
  },

  // `templateId` is pinned by the flow — this is the before/after wizard.
  expectedBody: () =>
    expectedFromFields(generateVideoScriptForm.fields, {
      templateId: 'before-after',
    }),
});
