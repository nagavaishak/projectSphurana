import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /assets` — create an asset.
 *
 * FORM-LESS, and the worst offender in the app: ~10 surfaces create an asset,
 * and NONE of them is a form. The user picks a File (file input or drag-drop);
 * every key of the body is then DERIVED from that File by
 * `buildCreateAssetPayload` — `name` is the filename with its extension
 * stripped, `sourceFileName` the raw one, `type` the MIME type, plus the
 * surface's own context (tags / source / batch). There is not one field the
 * user fills, so properties 1 and 2 have nothing to check.
 *
 * Properties 3 and 4 are the entire point here. Each surface used to assemble
 * this body itself, and they diverged — `onboarding-upload-panel` sent raw
 * `file.name` (keeping `.mp4`) while every other surface stripped the
 * extension. This drives three surfaces through their REAL upload UI with the
 * SAME File and asserts one byte-identical body.
 */

// jsdom shims for Radix (dialog, tabs).
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
// jsdom has no object-URL support; the onboarding panel previews with it.
URL.createObjectURL ??= () => 'blob:preview';
URL.revokeObjectURL ??= () => {};

const { post, BLOB_URL, PAGE } = vi.hoisted(() => ({
  post: vi.fn(),
  BLOB_URL: 'https://cdn.example.com/uploads/abc.mp4',
  PAGE: {
    id: 'page-1',
    pageId: 'p1',
    pageName: 'Test Page',
    pageUsername: null,
    pagePictureUrl: null,
    platform: 'facebook' as const,
    isActive: true,
  },
}));

/** The one File every surface uploads. Its name is what the body is built from. */
const videoFile = () =>
  new File(['x'], 'my clip.mp4', {
    type: 'video/mp4',
    lastModified: Date.parse('2026-01-02T03:04:05.000Z'),
  });

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
vi.mock('@/components/providers', () => ({ trackEvent: vi.fn() }));
vi.mock('@/components/posthog-provider', () => ({
  trackEvent: vi.fn(),
  usePostHog: () => null,
}));

// `useCreateAsset` — the thing under test — must stay REAL. Only the sibling
// list/delete hooks are stubbed.
vi.mock('@/features/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/assets')>()),
  useListAssets: () => ({ assets: [], isLoading: false }),
  useDeleteAsset: () => ({ deleteAsset: vi.fn(), isDeleting: false }),
}));

vi.mock('@/features/videos', () => ({
  useListVideos: () => ({ videos: [], isLoading: false }),
  useGetVideo: () => ({ video: null }),
  getVideoQueryOptions: () => ({ queryKey: ['videos', 'x'], queryFn: vi.fn() }),
}));

vi.mock('@/features/graphics', () => ({
  useListGraphics: () => ({ graphics: [], isLoading: false }),
}));

// The ad wizard's media pickers read the ?videoId preselect from the router.
vi.mock('@/routes/_authed/ads/new/-hooks/use-new-ad-search', () => ({
  useNewAdSearch: () => ({}),
}));

vi.mock('@/features/integrations', () => ({
  useListMetaAdsPages: () => ({ pages: [PAGE], isLoading: false }),
}));

vi.mock('@/features/ai-content', () => ({
  useGenerateContent: () => ({ generateContent: vi.fn(), isGenerating: false }),
}));

// The storage upload itself is not this operation — every surface hands the
// resulting blob URL to the one payload builder.
vi.mock('@/features/upload', () => ({
  useUploadImage: () => ({
    uploadAsync: vi.fn().mockResolvedValue({ url: BLOB_URL }),
    isUploading: false,
  }),
  useUploadVideo: () => ({
    uploadAsync: vi.fn().mockResolvedValue({ url: BLOB_URL }),
    isUploading: false,
  }),
  useUploadFile: () => ({
    uploadAsync: vi.fn().mockResolvedValue({ url: BLOB_URL }),
    isUploading: false,
  }),
}));
vi.mock('@/features/upload/api/resumable-upload', () => ({
  ResumableUploadError: class extends Error {},
}));

vi.mock('@/features/claire/lib/widget-state', () => ({
  useClaireWidgetState: (
    selector: (s: { isTourRunning: boolean }) => unknown
  ) => selector({ isTourRunning: false }),
}));

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

import { AddContentDialog } from '@/features/content-calendar/add-content-dialog';
import { OnboardingUploadPanel } from '@/features/onboarding/components/onboarding-upload-panel';
import { AdMobileSelectVideo } from '@/routes/_authed/ads/new/-components/ad-mobile/ad-mobile-select-video';
import { SelectVideoStep } from '@/routes/_authed/ads/new/-components/steps/select-video-step';
import { AdWizardProvider } from '@/routes/_authed/ads/new/-context';
import type { AdWizardFormData } from '@/routes/_authed/ads/new/-schema';
import { ContentMobileWizard } from '@/routes/_authed/dashboard/l/$locationId/marketing/socials/new/-components/content-mobile-wizard';
import { FormProvider, useForm } from 'react-hook-form';

/** The ad wizard's media steps need the wizard's form + context, nothing else. */
function AdWizardHarness({ children }: { children: React.ReactNode }) {
  const form = useForm<AdWizardFormData>({ defaultValues: {} as never });
  return (
    <AdWizardProvider>
      <FormProvider {...form}>{children}</FormProvider>
    </AdWizardProvider>
  );
}

/** The one file input a surface renders (they are all `hidden`, never labelled). */
const fileInputIn = (root: HTMLElement): HTMLInputElement => {
  const input = root.querySelector('input[type="file"]');
  if (!input) throw new Error('no file input rendered on this surface');
  return input as HTMLInputElement;
};

runFormContract({
  operation: 'POST assets',
  description: 'Create asset',
  form: null,
  noForm:
    'Not a form. An asset is created from a File the user dropped or picked — ' +
    'every key of the body is derived from that File (name, sourceFileName, ' +
    "type) plus the surface's context (tags / source / batch). There is no " +
    'user-editable field, so properties 1 and 2 have nothing to check; 3 and 4 ' +
    'do, and they are what the surfaces used to get wrong.',

  surfaces: [
    {
      name: 'content-calendar add-content-dialog',
      run: async (ctx) => {
        const { baseElement } = renderWithProviders(
          <AddContentDialog>
            <button type="button">open</button>
          </AddContentDialog>
        );
        await ctx.user.click(screen.getByRole('button', { name: 'open' }));
        await screen.findByRole('dialog');
        // The upload input lives on the "Uploaded content" tab.
        await ctx.user.click(
          screen.getByRole('tab', { name: /uploaded content/i })
        );
        await ctx.user.upload(fileInputIn(baseElement), videoFile());
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'socials/new mobile media step',
      run: async (ctx) => {
        renderWithProviders(<ContentMobileWizard />);
        await ctx.user.upload(
          await screen.findByTestId('content-media-file-input'),
          videoFile()
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'ads/new select-video-step (desktop)',
      run: async (ctx) => {
        const { container } = renderWithProviders(
          <AdWizardHarness>
            <SelectVideoStep />
          </AdWizardHarness>
        );
        // The upload input lives on the Video · Uploaded panel.
        await ctx.user.click(screen.getByRole('tab', { name: /uploaded/i }));
        await ctx.user.upload(fileInputIn(container), videoFile());
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'ads/new ad-mobile-select-video',
      run: async (ctx) => {
        const { container } = renderWithProviders(
          <AdWizardHarness>
            <AdMobileSelectVideo />
          </AdWizardHarness>
        );
        await ctx.user.upload(fileInputIn(container), videoFile());
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'onboarding upload-panel (dropzone)',
      run: async (ctx) => {
        const { container } = renderWithProviders(<OnboardingUploadPanel />);
        await ctx.user.upload(fileInputIn(container), videoFile());
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({
      id: 'asset-1',
      name: 'my clip',
      blobUrl: BLOB_URL,
      thumbnailUrl: null,
      type: 'video',
    });
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'assets');
    if (!call) throw new Error('no POST assets call captured');
    return call[1] as Record<string, unknown>;
  },

  // No fields — the body IS the File, canonicalised by buildCreateAssetPayload.
  // `name` must have lost its extension on EVERY surface (the onboarding-panel
  // regression), `sourceFileName` must keep it.
  expectedBody: () => ({
    name: 'my clip',
    sourceFileName: 'my clip.mp4',
    blobUrl: BLOB_URL,
    type: 'video',
    tags: [],
    source: 'raw',
    placeholderTypes: [],
    capturedAt: undefined,
    batchId: undefined,
  }),
});
