import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { format } from 'date-fns';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `POST /social-posts` — create social post.
 *
 * Three surfaces build this body: the content-calendar {@link AddContentDialog}
 * (desktop scheduler), the mobile content wizard, and the content-studio
 * {@link PostContentDialog} (post an asset you already picked in the gallery).
 * All three now render the ONE `createSocialPostForm` declaration and pass typed
 * intent to the one `buildCreateSocialPostPayload`.
 *
 * The harness fills every field the form DECLARES — not a hand-written list, so
 * it cannot quietly omit the field that was dropped — and checks the four
 * properties. See `@/test/form-contract/harness`.
 */

// Radix / cmdk (dialog, popover, command, calendar) need these in jsdom.
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
    // Must match the declaration's `mediaUrl` sample — the harness picks THIS
    // asset and then asserts its url reaches the body.
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

vi.mock('@/features/ai-content', () => ({
  useGenerateContent: () => ({ generateContent: vi.fn(), isGenerating: false }),
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
  () => ({ MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS: '' })
);

// The mobile wizard's media grid is a heavy leaf tree (segmented tabs, thumbs
// with no accessible name, resumable uploads). Replace it with a deterministic
// double that sets the SAME four values the real picker sets for our shared
// asset — the wizard's own intent construction (schedule shaping, field
// forwarding) stays under test, and `fills.mediaUrl` drives this button. The
// pages step is NOT stubbed: its rows are real, reachable controls.
vi.mock(
  '../../routes/_authed/dashboard/marketing/socials/new/-components/content-mobile-media-step',
  async () => {
    const React = await import('react');
    const { useFormContext } = await import('react-hook-form');
    return {
      ContentMobileMediaStep: () => {
        const { setValue } = useFormContext();
        return React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => {
              setValue('mediaId', ASSET.id);
              setValue('mediaUrl', ASSET.blobUrl, { shouldValidate: true });
              setValue('mediaType', 'video');
              setValue('thumbnailUrl', ASSET.thumbnailUrl);
            },
          },
          'select media'
        );
      },
    };
  }
);

import { AddContentDialog } from '@/features/content-calendar/add-content-dialog';
import { PostContentDialog } from '@/features/content-studio/post-content-dialog';
import { ContentMobileWizard } from '@/routes/_authed/dashboard/l/$locationId/marketing/socials/new/-components/content-mobile-wizard';
import { scheduledAtFromDateTime } from './api';
import { createSocialPostForm } from './api/create-social-post/create-social-post.form';

/** Every surface seeds the schedule with the day it is opened. */
const TODAY = format(new Date(), 'yyyy-MM-dd');
const TIME = '14:30';

const awaitPost = () => waitFor(() => expect(post).toHaveBeenCalled());

runFormContract({
  operation: 'POST social-posts',
  description: 'Create social post',
  form: createSocialPostForm,

  fills: {
    /**
     * The same asset, reached three different ways.
     *
     * If none of the three affordances is on screen the last line throws, and
     * the harness reports the field unreachable — a media picker deleted from
     * any surface fails here rather than silently posting nothing.
     */
    mediaUrl: async (user) => {
      // Desktop scheduler: a tabbed grid of videos / uploaded assets.
      const tab = screen.queryByRole('tab', { name: /uploaded content/i });
      if (tab) {
        await user.click(tab);
        await user.click(
          await screen.findByRole('button', { name: /my clip/i })
        );
        return;
      }
      // Mobile wizard: the media step (doubled above).
      const mobile = screen.queryByRole('button', { name: 'select media' });
      if (mobile) {
        await user.click(mobile);
        return;
      }
      // Content-studio: the asset is carried in from the gallery the user
      // already picked it in, and shown as a read-only tile. Nothing to click —
      // but the tile must be on screen, and property 3 still proves the asset's
      // url AND thumbnail reach the body (this is the surface that dropped the
      // thumbnail, so a video posted from here lost its poster frame).
      screen.getByText(ASSET.name);
    },

    /** Desktop + content-studio: a multi-select popover. Mobile: page rows. */
    pageIds: async (user) => {
      const trigger = screen.queryByText(/select pages\.\.\./i);
      if (trigger) await user.click(trigger);
      await user.click(await screen.findByText(PAGE.pageName));
    },

    /**
     * The date is a calendar-popover button, not a text input. It is asserted
     * PRESENT and showing its seeded value rather than hand-picked: picking one
     * here would paper over a missing default, and a missing default is exactly
     * how PostContentDialog shipped submitting `date: undefined` the moment a
     * user chose "Schedule for Later".
     */
    date: async () => {
      const picker = screen.getByLabelText(/^date$/i);
      expect(picker).toHaveTextContent(format(new Date(), 'PP'));
    },
  },

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
        await screen.findByRole('dialog');
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /schedule content/i })
        );
        await awaitPost();
      },
    },
    {
      name: 'mobile content wizard',
      run: async (ctx) => {
        renderWithProviders(<ContentMobileWizard />);

        // Step 1 — media.
        await ctx.fill('mediaUrl');
        await ctx.user.click(screen.getByRole('button', { name: /continue/i }));

        // Step 2 — details.
        await screen.findByLabelText(/^title$/i);
        await ctx.fill('title', 'caption');
        await ctx.user.click(screen.getByRole('button', { name: /continue/i }));

        // Step 3 — pages.
        await ctx.fill('pageIds');
        await ctx.user.click(screen.getByRole('button', { name: /continue/i }));

        // Step 4 — schedule.
        await screen.findByLabelText(/^time$/i);
        await ctx.fill('date', 'time');
        await ctx.user.click(
          screen.getByRole('button', { name: /schedule content/i })
        );
        await awaitPost();
      },
    },
    {
      name: 'content-studio post-content-dialog',
      run: async (ctx) => {
        renderWithProviders(
          <PostContentDialog
            open
            onOpenChange={() => {}}
            asset={ASSET as never}
            onSuccess={() => {}}
          />
        );

        await ctx.fill('title', 'caption', 'mediaUrl', 'pageIds');

        // The date/time controls only exist in schedule mode — `mode` is the
        // exempt discriminator, flipped here by the radio the user would click.
        await ctx.user.click(screen.getByText(/schedule for later/i));
        await ctx.fill('date', 'time');

        await ctx.user.click(
          screen.getByRole('button', { name: /^schedule$/i })
        );
        await awaitPost();
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ id: 'new-post', status: 'scheduled' });
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'social-posts');
    if (!call) throw new Error('no POST social-posts call captured');
    return call[1] as Record<string, unknown>;
  },

  /**
   * The field samples, plus the keys the picker sets and the builder derives:
   * `mediaType` + `thumbnailUrl` are properties of the chosen asset (exempt), and
   * `date` + `time` fold into one `scheduledAt` instant (derived).
   */
  expectedBody: () =>
    expectedFromFields(createSocialPostForm.fields, {
      mediaType: 'video',
      thumbnailUrl: ASSET.thumbnailUrl,
      // The canonical request contract COERCES `scheduledAt`
      // (`z.coerce.date()`, matching the server schema it derives), so the
      // parsed body holds a `Date` — which JSON-serialises to exactly the ISO
      // string this used to assert.
      scheduledAt: new Date(scheduledAtFromDateTime(TODAY, TIME, 'UTC')),
    }),
});
