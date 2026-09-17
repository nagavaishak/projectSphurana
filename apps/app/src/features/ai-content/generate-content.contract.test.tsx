import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /ai-content/generate` — generate the AI caption for a
 * piece of media.
 *
 * FORM-LESS. There is no form here and there never was one: the body is
 * `{ mediaType, mediaId, contentType }`, and every key of it comes from the
 * media item the user CLICKED — not from fields they filled. The desktop
 * content-calendar dialog and the mobile content wizard both fire the
 * generation as a side-effect of selecting a video/asset, and neither offers a
 * single input that steers it. So properties 1 and 2 have nothing to check;
 * properties 3 and 4 still do, and they are the whole point — the two surfaces
 * must encode the SAME selection as the same body.
 *
 * (A third caller, the ads customize-step, hits the same endpoint with
 * `contentType: 'ad'` + `serviceIds`. It builds a deliberately different body
 * from a different selection, so it is not a parity surface for this one; it is
 * covered by the ad-wizard's own contract.)
 */

// jsdom shims for Radix (dialog, tabs, popover).
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

const { post, ASSET, PAGE } = vi.hoisted(() => ({
  post: vi.fn(),
  ASSET: {
    id: 'asset-1',
    name: 'My Clip',
    type: 'video' as const,
    blobUrl: 'https://cdn.example/clip.mp4',
    thumbnailUrl: 'https://cdn.example/thumb.jpg',
    duration: 12,
    createdAt: '2024-01-01T00:00:00.000Z',
    tags: [] as string[],
  },
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

vi.mock('@/features/integrations', () => ({
  useListMetaAdsPages: () => ({ pages: [PAGE], isLoading: false }),
}));

vi.mock('@/features/assets', () => ({
  useListAssets: () => ({ assets: [ASSET], isLoading: false }),
  useCreateAsset: () => ({ createAssetAsync: vi.fn(), isCreating: false }),
}));

vi.mock('@/features/videos', () => ({
  useListVideos: () => ({ videos: [], isLoading: false }),
  getVideoQueryOptions: () => ({ queryKey: ['videos', 'x'], queryFn: vi.fn() }),
}));

vi.mock('@/features/upload', () => ({
  useUploadImage: () => ({ uploadAsync: vi.fn(), isUploading: false }),
  useUploadVideo: () => ({ uploadAsync: vi.fn(), isUploading: false }),
  useUploadFile: () => ({ uploadAsync: vi.fn(), isUploading: false }),
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
  () => ({
    MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS: '',
  })
);

import { AddContentDialog } from '@/features/content-calendar/add-content-dialog';
import { ContentMobileWizard } from '@/routes/_authed/dashboard/l/$locationId/marketing/socials/new/-components/content-mobile-wizard';

runFormContract({
  operation: 'POST ai-content/generate',
  description: 'Generate AI content',
  form: null,
  noForm:
    'Not a form. The body is the media item the user CLICKED (mediaType + mediaId) ' +
    "plus the surface's own contentType — there is no field on either surface that " +
    'the user fills to steer it. Properties 3 and 4 still hold: both surfaces must ' +
    'encode the same selection as the same body.',

  surfaces: [
    {
      name: 'content-calendar add-content-dialog',
      run: async (ctx) => {
        renderWithProviders(
          <AddContentDialog>
            <button type="button">open</button>
          </AddContentDialog>
        );
        await ctx.user.click(screen.getByRole('button', { name: 'open' }));
        await ctx.user.click(
          screen.getByRole('tab', { name: /uploaded content/i })
        );
        // Selecting the asset is what triggers caption generation.
        await ctx.user.click(
          await screen.findByRole('button', { name: /my clip/i })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      name: 'mobile content wizard media step',
      run: async (ctx) => {
        renderWithProviders(<ContentMobileWizard />);
        await ctx.user.click(
          screen.getByRole('tab', { name: /uploaded content/i })
        );
        await ctx.user.click(
          (await screen.findAllByTestId('content-media-thumb'))[0]
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({
      contentType: 'social-post',
      content: { caption: 'Generated caption', hashtags: ['glow'] },
    });
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'ai-content/generate');
    if (!call) throw new Error('no POST ai-content/generate call captured');
    return call[1] as Record<string, unknown>;
  },

  // No fields, so nothing to derive from: the body IS the selection.
  expectedBody: () => ({
    mediaType: 'video',
    mediaId: ASSET.id,
    contentType: 'social-post',
  }),
});
