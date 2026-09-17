import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { format, parseISO } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT /social-posts/:id` — update social post.
 *
 * Two surfaces render the shared `updateSocialPostForm`: the docked
 * {@link SocialPostPanel} and the mobile post-detail screen. Both pass typed
 * intent to the one `buildUpdateSocialPostPayload`.
 *
 * A third path reaches the same builder — the content-calendar's drag-and-drop —
 * but it is not a form: there are no fields to fill, only an already-ISO instant
 * handed over by the calendar. The harness's properties 2 and 3 have nothing to
 * say about it, so it is pinned below instead: its ISO instant and the form's
 * date/time pair must resolve to the identical `scheduledAt`.
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

const put = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    put: (...a: unknown[]) => put(...a),
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() }, navigate: vi.fn() }),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

vi.mock('@/components/app/side-panel', () => ({
  useSidePanel: () => ({ close: vi.fn() }),
}));

vi.mock('@/features/integrations', () => ({
  useListMetaAdsPages: () => ({
    pages: [
      {
        id: 'page-1',
        pageId: 'p1',
        pageName: 'Test Page',
        pageUsername: null,
        pagePictureUrl: null,
        platform: 'facebook',
        isActive: true,
      },
    ],
    isLoading: false,
  }),
}));

import { SocialsMobilePostDetail } from '@/features/socials/components/socials-mobile-post-detail';
import { buildUpdateSocialPostPayload, scheduledAtFromDateTime } from './api';
import { updateSocialPostForm } from './api/update-social-post/update-social-post.form';
import { SocialPostPanel } from './components/social-post-panel';
import { isSocialPostEditable } from './social-post-lifecycle';
import type { SocialPost } from './types';

const POST_ID = 'post-1';
/** Comfortably in the future, so both surfaces keep the schedule editable. */
const SCHEDULED_AT = '2099-01-01T10:00:00.000Z';
/** The seeded date, read the way the surfaces read it (local time). */
const SEEDED_DATE = format(parseISO(SCHEDULED_AT), 'yyyy-MM-dd');
const TIME = '14:30';

const makePost = (status: SocialPost['status'] = 'scheduled'): SocialPost =>
  ({
    id: POST_ID,
    title: 'Original title',
    caption: 'Original caption',
    mediaType: 'image',
    mediaUrl: 'https://cdn.example/a.jpg',
    thumbnailUrl: null,
    status,
    platforms: ['facebook'],
    scheduledAt: SCHEDULED_AT,
    createdAt: '2024-01-01T00:00:00.000Z',
    createdById: 'user-1',
  }) as unknown as SocialPost;

runFormContract({
  operation: 'PUT social-posts/:id',
  description: 'Update social post',
  form: updateSocialPostForm,

  fills: {
    /**
     * A calendar-popover button, not a text input. Asserted PRESENT and showing
     * the instant the post is scheduled for — the day itself is not re-picked,
     * so a picker that stopped seeding from the post would fail here rather than
     * be papered over by the harness typing a date in.
     */
    date: async () => {
      const picker = screen.getByLabelText(/^date$/i);
      expect(picker).toHaveTextContent(format(parseISO(SCHEDULED_AT), 'PP'));
    },
  },

  surfaces: [
    {
      name: 'social-post-panel',
      run: async (ctx) => {
        renderWithProviders(<SocialPostPanel post={makePost()} />);
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /save changes/i })
        );
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
    {
      name: 'mobile post-detail',
      run: async (ctx) => {
        renderWithProviders(<SocialsMobilePostDetail postId={POST_ID} />);
        // The post loads async, then seeds the form.
        await waitFor(() =>
          expect(screen.getByLabelText(/^title$/i)).toHaveValue(
            'Original title'
          )
        );
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /save post/i })
        );
        await waitFor(() => expect(put).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    put.mockReset();
    put.mockResolvedValue(makePost());
    get.mockReset();
    get.mockResolvedValue(makePost());
  },

  readBody: () => {
    const call = put.mock.calls.find((c) => c[0] === `social-posts/${POST_ID}`);
    if (!call) throw new Error('no PUT social-posts/:id call captured');
    return call[1] as Record<string, unknown>;
  },

  /** `date` + `time` fold into the one ISO instant the wire carries. */
  expectedBody: () =>
    expectedFromFields(updateSocialPostForm.fields, {
      scheduledAt: scheduledAtFromDateTime(SEEDED_DATE, TIME, 'UTC'),
    }),
});

describe('PUT social-posts/:id — the form-less calendar drag', () => {
  it('an ISO instant and a date/time pair resolve to the same scheduledAt', () => {
    // The panel and the mobile screen supply `yyyy-MM-dd` / `HH:mm`; the
    // calendar drag hands over an already-ISO instant. Same wall-clock time must
    // mean the same wire value — there is one converter, and this pins it.
    const iso = scheduledAtFromDateTime(SEEDED_DATE, TIME, 'UTC');

    const fromForm = buildUpdateSocialPostPayload(
      {
        id: POST_ID,
        title: 'Dragged',
        caption: 'A brand new caption',
        schedule: { date: SEEDED_DATE, time: TIME },
      },
      'UTC'
    );
    const fromDrag = buildUpdateSocialPostPayload(
      {
        id: POST_ID,
        title: 'Dragged',
        caption: 'A brand new caption',
        schedule: { at: iso },
      },
      'UTC'
    );

    expect(fromDrag).toEqual(fromForm);
    expect(fromDrag.scheduledAt).toBe(iso);
  });

  it('every update surface normalises an empty caption to null (clear)', () => {
    expect(
      buildUpdateSocialPostPayload({ id: POST_ID, caption: '' }, 'UTC').caption
    ).toBeNull();
  });
});

describe('immutable social-post states', () => {
  it.each(['publishing', 'published'] as const)(
    '%s posts are consistently read-only across edit surfaces',
    async (status) => {
      expect(isSocialPostEditable(status)).toBe(false);

      const { unmount } = renderWithProviders(
        <SocialPostPanel post={makePost(status)} />
      );
      expect(screen.getByLabelText(/^title$/i)).toBeDisabled();
      expect(
        screen.getByRole('button', { name: /save changes/i })
      ).toBeDisabled();
      unmount();

      get.mockResolvedValue(makePost(status));
      renderWithProviders(<SocialsMobilePostDetail postId={POST_ID} />);
      await waitFor(() =>
        expect(screen.getByLabelText(/^title$/i)).toBeDisabled()
      );
      expect(screen.getByRole('button', { name: /save post/i })).toBeDisabled();
    }
  );

  it.each(['draft', 'scheduled', 'partial', 'failed'] as const)(
    '%s posts remain editable',
    (status) => {
      expect(isSocialPostEditable(status)).toBe(true);
    }
  );
});
