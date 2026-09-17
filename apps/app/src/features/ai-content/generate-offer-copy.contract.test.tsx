import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { useForm } from 'react-hook-form';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /ai-content/generate-offer-copy` — generate the video
 * copy bundle (headline + CTA + urgency + audience + bullets) for an offer.
 *
 * FORM-LESS. The body is `{ offerId }`, and the offer id is the row the user
 * PICKED — there is no field they fill. Every surface fires the generation as a
 * side-effect of selecting an offer (`create-video` offer-step radio list, the
 * socials generate-video-dialog offer combobox, the new-post-dialog offer
 * step). So properties 1 and 2 have nothing to check; properties 3 and 4 do,
 * and they are what matters: picking the same offer must produce the same body
 * on every surface.
 *
 * (The re-roll path in the new-post-dialog's review modal adds
 * `refinementInstruction` + `priorCopy` to the same builder. That is a second,
 * deliberately different body built from a different action — a change request
 * typed in the processing modal — not a second surface for this one.)
 */

// jsdom shims for Radix (dialog, popover, radio group).
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

const { post, OFFER, SERVICE } = vi.hoisted(() => ({
  post: vi.fn(),
  OFFER: {
    id: 'offer-1',
    name: 'Summer Glow',
    code: null,
    serviceIds: ['svc-1'],
  },
  SERVICE: { id: 'svc-1', name: 'Facial', hasGraphicMedia: true },
}));

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    post: (...a: unknown[]) => post(...a),
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

vi.mock('@borradh-workspace/runtime-config/client', () => ({
  useRuntimeConfig: () => ({ cdnUrl: 'https://cdn.example', apiUrl: '/api' }),
}));

vi.mock('@/features/offers', async () => {
  const actual =
    await vi.importActual<typeof import('@/features/offers')>(
      '@/features/offers'
    );
  return {
    ...actual,
    useListOffers: () => ({ offers: [OFFER], isLoading: false }),
    // The "create new offer" dialog is a different operation with its own
    // contract; it must not mount its form tree here.
    OfferFormDialog: () => null,
  };
});

vi.mock('@/features/organization-services', () => ({
  useListServices: () => ({ services: [SERVICE], isLoading: false }),
}));

vi.mock('@/features/organization', () => ({
  useGetActiveOrganization: () => ({ data: { id: 'org-1', name: 'Org' } }),
  useGetOrganizationBrand: () => ({ brand: null }),
}));

vi.mock('@/features/assets', () => ({
  useListAssets: () => ({ assets: [], isLoading: false }),
  useListAssetsByService: () => ({ assets: [], isLoading: false }),
  useCreateAsset: () => ({ createAssetAsync: vi.fn(), isCreating: false }),
}));

vi.mock('@/features/videos/api/create-video', () => ({
  useCreateVideo: () => ({ createVideoAsync: vi.fn(), isCreating: false }),
}));
vi.mock('@/features/videos/api/queue-video-export', () => ({
  useQueueVideoExport: () => ({ queueExportAsync: vi.fn(), isQueuing: false }),
}));
vi.mock('@/features/videos/api/generate-video-script', () => ({
  useGenerateVideoScript: () => ({
    generateScriptAsync: vi.fn().mockResolvedValue({ scriptText: '' }),
    isGenerating: false,
  }),
}));
vi.mock('@/features/videos/api/generate-organic-copy', () => ({
  useGenerateOrganicCopy: () => ({
    generateCopyAsync: vi.fn(),
    isGenerating: false,
  }),
}));
vi.mock(
  '@/routes/_authed/create-video/$templateId/-components/shared/processing-modal',
  () => ({ ProcessingModal: () => null })
);

import { GenerateVideoDialog } from '@/features/socials/components/generate-video-dialog';
import { OfferStep } from '@/routes/_authed/create-video/$templateId/-components/steps/offer-step';
import type { VideoFormData } from '@/routes/_authed/create-video/$templateId/-schema';

/** The create-video wizard's offer step, mounted with a real form. */
function OfferStepHarness() {
  const form = useForm<VideoFormData>({
    defaultValues: { serviceId: SERVICE.id } as Partial<VideoFormData> as never,
  });
  return <OfferStep form={form} />;
}

runFormContract({
  operation: 'POST ai-content/generate-offer-copy',
  description: 'Generate offer copy',
  form: null,
  noForm:
    'Not a form. The body is `{ offerId }` — the offer the user PICKED from a ' +
    'list, not a field they filled. Both surfaces fire generation as a ' +
    'side-effect of the pick, so properties 1 and 2 have nothing to check; ' +
    '3 and 4 still prove the pick encodes identically on both.',

  surfaces: [
    {
      name: 'create-video offer-step',
      run: async (ctx) => {
        renderWithProviders(<OfferStepHarness />);
        await ctx.user.click(
          await screen.findByRole('radio', { name: /summer glow/i })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'socials generate-video-dialog (offer template)',
      run: async (ctx) => {
        renderWithProviders(
          <GenerateVideoDialog
            open
            onOpenChange={() => {}}
            templateId="offer"
          />
        );
        // The offer combobox: open it, pick the offer. That pick — nothing else
        // — is what generates the copy. (Its trigger is a `role="combobox"`
        // button, which takes no accessible name from its content, so we locate
        // it by the placeholder the user actually reads.)
        await ctx.user.click(
          await screen.findByText(/search and select an offer/i)
        );
        await ctx.user.click(await screen.findByText(OFFER.name));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({
      headline: 'Glow up',
      bulletPoints: ['One', 'Two'],
      ctaText: 'Book now',
      urgencyText: '',
      audienceText: '',
    });
  },

  readBody: () => {
    const call = post.mock.calls.find(
      (c) => c[0] === 'ai-content/generate-offer-copy'
    );
    if (!call)
      throw new Error('no POST ai-content/generate-offer-copy captured');
    return call[1] as Record<string, unknown>;
  },

  expectedBody: () => ({ offerId: OFFER.id }),
});
