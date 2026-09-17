import { generateGraphicForm } from '@/features/graphics/api/generate-graphic';
import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { graphicCategoryValues } from '@borradh-workspace/api-client/types';
import type { UserEvent } from '@testing-library/user-event';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /graphics/generate` — generate a graphic.
 *
 * Two surfaces build this body: the unified {@link NewPostDialog} (graphic
 * path) and the standalone {@link GenerateGraphicDialog}, which the gallery/new
 * mobile wizard opens. Both now render `generateGraphicForm.labels` and pass
 * typed intent to the one `buildGenerateGraphicPayload`.
 *
 * BRANCH. The form is a discriminated union on `usageType`: an organic graphic
 * picks a `kind`, a paid ad picks an `offerId` and never renders the format
 * control. The harness fills every declared field on every surface, so only ONE
 * branch can be pinned — this contract pins ORGANIC (the branch both surfaces
 * open in) and `offerId` is exempt with that reason. The ad branch is not
 * covered.
 *
 * The editorial `category` is picked at RANDOM at submit ("the system picks for
 * you"), so it is exempt and `Math.random` is pinned here — otherwise the body
 * would not be assertable at all.
 */

// jsdom shims for Radix (dialog, popover, radio, tabs).
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

const { post, SERVICE, OFFER } = vi.hoisted(() => ({
  post: vi.fn(),
  SERVICE: { id: 'svc-1', name: 'Signature Facial', hasGraphicMedia: true },
  OFFER: { id: 'offer-1', name: 'Summer Glow', code: null, serviceIds: [] },
}));

/** The category `pickRandomGraphicCategory` yields with Math.random pinned to 0. */
const CATEGORY = graphicCategoryValues[0];

vi.mock('@borradh-workspace/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@borradh-workspace/api-client')>()),
  apiClient: {
    post: (...a: unknown[]) => post(...a),
    put: vi.fn(),
    // The gallery wizard's style step lists `GET graphics/templates`; an empty
    // list is fine — the walk takes the always-present "Surprise me" row.
    get: (url: unknown) =>
      typeof url === 'string' && url.startsWith('graphics/templates')
        ? Promise.resolve({ templates: [] })
        : Promise.resolve(undefined),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() } }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

// The PostHog provider imports the router, which imports the generated route
// tree — i.e. the whole app. Stub the two telemetry entry points our tree
// reaches instead.
vi.mock('@/components/providers', () => ({ trackEvent: vi.fn() }));
vi.mock('@/components/posthog-provider', () => ({
  trackEvent: vi.fn(),
  usePostHog: () => null,
}));

vi.mock('@borradh-workspace/runtime-config/client', () => ({
  useRuntimeConfig: () => ({ cdnUrl: 'https://cdn.example', apiUrl: '/api' }),
}));

vi.mock('@/features/organization-services', () => ({
  useListServices: () => ({ services: [SERVICE], isLoading: false }),
}));

vi.mock('@/features/offers', () => ({
  useListOffers: () => ({ offers: [OFFER], isLoading: false }),
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
  useCreateVideo: () => ({ createVideoAsync: vi.fn() }),
}));
vi.mock('@/features/videos/api/update-video', () => ({
  useUpdateVideo: () => ({ updateVideoAsync: vi.fn() }),
}));
vi.mock('@/features/videos/api/delete-video', () => ({
  useDeleteVideo: () => ({ deleteVideoAsync: vi.fn() }),
}));
vi.mock('@/features/videos/api/queue-video-export', () => ({
  useQueueVideoExport: () => ({ queueExportAsync: vi.fn() }),
}));
vi.mock('@/features/videos/api/generate-video-script', () => ({
  useGenerateVideoScript: () => ({
    generateScriptAsync: vi.fn(),
    isGenerating: false,
  }),
}));
vi.mock('@/features/videos/api/generate-organic-copy', () => ({
  useGenerateOrganicCopy: () => ({ generateCopyAsync: vi.fn() }),
}));
vi.mock('@/features/upload', () => ({
  useUploadVideo: () => ({ upload: vi.fn(), isUploading: false }),
  useUploadImage: () => ({ uploadAsync: vi.fn(), isUploading: false }),
  useUploadFile: () => ({ uploadAsync: vi.fn(), isUploading: false }),
}));

// The processing modals poll the generated graphic/video — a different
// operation, and they mount only AFTER the body we're asserting has been sent.
vi.mock('@/features/socials/components/graphic-processing-modal', () => ({
  GraphicProcessingModal: () => null,
}));
vi.mock(
  '@/routes/_authed/create-video/$templateId/-components/shared/processing-modal',
  () => ({ ProcessingModal: () => null })
);

vi.mock('@/features/mobile-dashboard-header', () => ({
  MobileDashboardHeader: () => null,
  MobileDashboardHeaderProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => children,
  useMobileDashboardHeaderContent: () => undefined,
}));
vi.mock(
  '@/features/mobile-dashboard-header/mobile-dashboard-header-layout',
  () => ({ MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS: '' })
);

import { NewPostDialog } from '@/features/socials/components/new-post-dialog';
import { ContentCreateMobileWizard } from '@/routes/_authed/dashboard/l/$locationId/marketing/gallery/new/-components/content-create-mobile-wizard';

/** Open the new-post-dialog and walk to the graphic service step. */
const openNewPostGraphic = async (user: UserEvent) => {
  renderWithProviders(<NewPostDialog open onOpenChange={() => {}} />);
  await user.click(await screen.findByRole('radio', { name: /graphic/i }));
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByText(/what's this graphic for\?/i);
};

/**
 * Open the gallery/new wizard's generate-graphic dialog: pick the Graphic
 * type, then "Surprise me" on the style step — the row that exists regardless
 * of the fetched template list and, like the new-post surface, sends NO
 * `templateSlug` (so both surfaces assert the same body).
 */
const openGalleryGraphicDialog = async (user: UserEvent) => {
  renderWithProviders(<ContentCreateMobileWizard />);
  await user.click(
    screen.getByRole('button', { name: /graphic a designed post/i })
  );
  await user.click(await screen.findByRole('button', { name: /surprise me/i }));
  await screen.findByRole('dialog');
};

/**
 * Enter the paid-ad branch. This is NAVIGATION, not a fill: the usage-type radio
 * is the discriminator, so the two branches of one component necessarily send it
 * differently and cannot both "own" it. The organic surfaces own it (they fill it
 * from its sample and prove the control is on screen); the ad surfaces reach the
 * other option of that same control here — and if it is gone, this throws.
 */
const pickPaidAd = async (user: UserEvent) => {
  await user.click(screen.getByRole('radio', { name: /paid ad/i }));
};

const ORGANIC_OWNS = [
  'usageType',
  'serviceId',
  'allowAiImages',
  'allowStockImages',
  'kind',
  'refinementInstruction',
] as const;

const AD_OWNS = [
  'serviceId',
  'allowAiImages',
  'allowStockImages',
  'refinementInstruction',
  'offerId',
] as const;

runFormContract({
  operation: 'POST graphics/generate',
  description: 'Generate graphic',
  form: generateGraphicForm,

  fills: {
    // Both surfaces render a `role="combobox"` popover trigger, which takes no
    // accessible name from its content — locate it by the placeholder the user
    // reads, then pick the service by name.
    serviceId: async (user) => {
      await user.click(screen.getByText(/search and select a service/i));
      await user.click(await screen.findByText(SERVICE.name));
    },
    // Same shape, one row down.
    offerId: async (user) => {
      await user.click(screen.getByText(/search and select an offer/i));
      await user.click(await screen.findByText(OFFER.name));
    },
    // Same choice, two control shapes: a radio pair in the new-post-dialog, a
    // Tabs row in the generate-graphic-dialog. Either must be on screen — if
    // neither is, this throws and PROPERTY 2 reports the field unreachable.
    kind: async (user) => {
      const radio = screen.queryByRole('radio', { name: /single image/i });
      if (radio) {
        await user.click(radio);
        return;
      }
      await user.click(screen.getByRole('tab', { name: /^single$/i }));
    },
  },

  // A BRANCH IS A SURFACE. Each (component × usageType) pair owns its slice, so
  // `kind` is proven on the two organic surfaces and `offerId` on the two paid-ad
  // ones — and the harness still refuses to let any field fall off all of them.
  surfaces: [
    {
      name: 'new-post-dialog (organic)',
      owns: [...ORGANIC_OWNS],
      run: async (ctx) => {
        await openNewPostGraphic(ctx.user);
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /generate graphic/i })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'new-post-dialog (paid ad)',
      owns: [...AD_OWNS],
      run: async (ctx) => {
        await openNewPostGraphic(ctx.user);
        await pickPaidAd(ctx.user);
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /generate graphic/i })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'gallery/new generate-graphic-dialog (organic)',
      owns: [...ORGANIC_OWNS],
      run: async (ctx) => {
        await openGalleryGraphicDialog(ctx.user);
        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: /generate/i }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'gallery/new generate-graphic-dialog (paid ad)',
      owns: [...AD_OWNS],
      run: async (ctx) => {
        await openGalleryGraphicDialog(ctx.user);
        await pickPaidAd(ctx.user);
        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: /generate/i }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'graphic-1', status: 'rendering' });
    // The editorial category is chosen at random at submit; pin it so the body
    // is assertable. (Both surfaces call the one shared picker.)
    vi.spyOn(Math, 'random').mockReturnValue(0);
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'graphics/generate');
    if (!call) throw new Error('no POST graphics/generate call captured');
    return call[1] as Record<string, unknown>;
  },

  // Organic: everything but `category`, which is exempt (the system picks it at
  // random) — so the contract spells out the value the pinned RNG yields.
  // Paid ad: no category, no kind; the usage-type radio lands on the other
  // option than the field's sample.
  expectedBody: (surface) => {
    const isAd = surface.owns?.includes('offerId') ?? false;
    const body = expectedFromFields(
      generateGraphicForm.fields,
      // `usageType` is the branch discriminator (navigation, not a fill) and
      // `category` is exempt — the system picks it at random, pinned above.
      isAd ? { usageType: 'ad' } : { usageType: 'organic', category: CATEGORY },
      { only: surface.owns }
    );
    // Paid ads don't pick an editorial category, so the canonical request
    // contract's `.default('tips')` MATERIALISES it into the parsed body — the
    // same value the server would have applied, now visible on the wire.
    return isAd ? { ...body, category: 'tips' } : body;
  },
});
