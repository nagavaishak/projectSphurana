import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { fireEvent, renderWithProviders, screen } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT videos/:id` — save the video draft.
 *
 * `PUT videos/:id` is a PARTIAL update, and the create-video wizard calls it
 * from four places (service step, script step, caption review, submit) each
 * sending only the slice it just changed. The one that is a FORM — where the
 * user fills fields and presses a button that writes the whole draft — is the
 * final CUSTOMISATION step, so `videoCustomiseForm` is this operation's form
 * and the surface is the wizard driven end-to-end to "Create Video".
 *
 * TWO DROPPED CONTROLS WERE FOUND AND RESTORED while writing this (both are in
 * the schema, the defaults AND the submitted body, with no way for a user to
 * set them):
 *   - `outroStyle` — its "Outro Style" picker was deleted from the customise
 *     step in 06fcba15a; every video has shipped with the 'tagline' outro since.
 *   - `title` — `data.title?.trim() || 'Video <date>'` at submit, but this
 *     wizard has never rendered a title input, so every video is auto-named.
 *
 * OTHER `PUT videos/:id` CALLERS ARE NOT PARITY SURFACES: the script step's
 * autosave, the teleprompter recorder and new-post-dialog each send a different
 * partial body by design (that is what a partial update is). The shared
 * `buildUpdateVideoPayload` + `.strict()` envelope is what keeps them honest;
 * "same input → same body" is not a property that can hold between them.
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
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const post = vi.fn();
const get = vi.fn();
const put = vi.fn();
vi.mock('@borradh-workspace/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@borradh-workspace/api-client')>()),
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@borradh-workspace/runtime-config/client', () => ({
  useRuntimeConfig: () => ({ cdnUrl: 'https://cdn.test' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

vi.mock(
  '@/routes/_authed/create-video/$templateId/-components/shared/processing-modal',
  () => ({ ProcessingModal: () => null })
);

import { VideoCreationForm } from '@/routes/_authed/create-video/$templateId/-components/video-creation-form';
import { VideoCreationProvider } from '@/routes/_authed/create-video/$templateId/-context';
import { videoCustomiseForm } from '@/routes/_authed/create-video/$templateId/-schema';

/** Text-only template: service → media → customisation, no script step. */
const TEMPLATE_ID = 'educational';
const VIDEO_ID = 'vid-1';

const ORG = { id: 'org-1', name: 'Test Clinic' };
const SERVICE = { id: 'svc-1', name: 'Lip Filler', category: 'treatment' };
const OFFER = { id: 'offer-1', name: 'Spring Offer', serviceIds: [] };

/** The single clip the media step auto-selects for the slot. */
const ASSET = {
  id: 'asset-1',
  name: 'Procedure clip',
  type: 'video',
  blobUrl: 'https://cdn.test/procedure.mp4',
  thumbnailUrl: null,
  duration: 12,
  tags: ['procedure'],
};

/** The AI script the wizard generates for the (skipped) script step. */
const SCRIPT = [
  'Struggling with dry lips?',
  'Lip filler helps restore volume',
  'Results vary • Consultation required',
  'Book now',
].join('\n');

const TEXT_FRAMES = [
  {
    id: 'tf-0',
    text: SCRIPT.split('\n')[0],
    durationSec: 3,
    style: 'question',
  },
  { id: 'tf-1', text: SCRIPT.split('\n')[1], durationSec: 3, style: 'answer' },
  {
    id: 'tf-2',
    text: SCRIPT.split('\n')[2],
    durationSec: 3,
    style: 'disclaimer',
  },
  { id: 'tf-3', text: SCRIPT.split('\n')[3], durationSec: 3, style: 'cta' },
];

/** Opens the music dialog and picks Tea Pop. Idempotent. */
const pickMusic = async (
  user: import('@testing-library/user-event').UserEvent
) => {
  await user.click(
    screen.getByRole('button', { name: videoCustomiseForm.labels.musicTrackId })
  );
  const row = await screen.findByRole('button', { name: /^tea pop/i });
  await user.click(row);
  await user.click(screen.getByRole('button', { name: /confirm selection/i }));
};

const setColor = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

runFormContract({
  operation: 'PUT videos/:id',
  description: 'Update video draft',
  form: videoCustomiseForm,

  fills: {
    musicTrackId: pickMusic,
    // Same control, second key: re-picking the track is idempotent and still
    // proves the control that produces `musicUrl` is on screen.
    musicUrl: pickMusic,
    musicVolume: async (user) => {
      // Radix's Slider root takes the label; the draggable thumb is the only
      // `slider` role on the step, so drive that.
      const slider = screen.getByRole('slider');
      slider.focus();
      // step=5 on a 0-100 scale → 5% → 10% → musicVolume 0.1.
      await user.keyboard('{ArrowRight}');
    },
    textColor: async () => {
      setColor(videoCustomiseForm.labels.textColor, '#facc15');
    },
    backgroundColor: async () => {
      setColor(videoCustomiseForm.labels.backgroundColor, '#101010');
    },
  },

  surfaces: [
    {
      name: 'create-video wizard (customise step → Create Video)',
      run: async (ctx) => {
        renderWithProviders(
          <VideoCreationProvider templateId={TEMPLATE_ID}>
            <VideoCreationForm />
          </VideoCreationProvider>
        );

        // ---- service step: creates the draft this PUT will update.
        await screen.findByText(/is this video for a specific service/i);
        await ctx.user.click(
          screen.getByRole('button', { name: /yes, for a service/i })
        );
        await ctx.user.click(
          await screen.findByRole('button', { name: /lip filler/i })
        );
        await ctx.user.click(await screen.findByRole('combobox'));
        await ctx.user.click(
          await screen.findByRole('option', { name: OFFER.name })
        );
        await ctx.user.click(screen.getByRole('button', { name: /continue/i }));
        await vi.waitFor(() =>
          expect(post.mock.calls.some((c) => c[0] === 'videos')).toBe(true)
        );

        // ---- media step: the slot auto-selects the one available clip.
        await screen.findByText(/procedure footage/i);
        await ctx.user.click(screen.getByRole('button', { name: /continue/i }));

        // ---- customisation step: the form behind this write.
        await screen.findByText(/music & captions/i);
        await ctx.fill('title', 'musicTrackId', 'musicUrl');

        // Captions, outro and volume live under "Advanced Customization".
        await ctx.user.click(
          screen.getByRole('button', { name: /advanced customization/i })
        );
        await ctx.fill(
          'captionsEnabled',
          'fontFamily',
          'textColor',
          'backgroundColor',
          'position',
          'outroStyle',
          'musicVolume'
        );

        await ctx.user.click(
          screen.getByRole('button', { name: /create video/i })
        );
        await vi.waitFor(() =>
          expect(
            put.mock.calls.some((c) => c[0] === `videos/${VIDEO_ID}`)
          ).toBe(true)
        );
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockImplementation((path: string) => {
      if (path === 'videos/generate-script') {
        return Promise.resolve({ scriptText: SCRIPT });
      }
      return Promise.resolve({ id: VIDEO_ID });
    });
    put.mockReset();
    put.mockResolvedValue({ id: VIDEO_ID });

    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path === 'organization/active') return Promise.resolve(ORG);
      if (path === `organizations/${ORG.id}/brand`)
        return Promise.resolve(null);
      if (path === `organizations/${ORG.id}`) {
        return Promise.resolve({
          ...ORG,
          videoCaptionColor: null,
          videoCaptionFont: null,
          videoCaptionPosition: null,
          videoMusicVolume: null,
        });
      }
      if (path.startsWith('organization-services')) {
        return Promise.resolve({
          items: [SERVICE],
          total: 1,
          limit: 100,
          offset: 0,
        });
      }
      if (path.startsWith('offers')) {
        return Promise.resolve({ items: [OFFER], total: 1 });
      }
      if (path.startsWith('assets/by-service/')) {
        return Promise.resolve({ items: [] });
      }
      if (path.startsWith('assets')) {
        return Promise.resolve({
          items: [ASSET],
          total: 1,
          limit: 50,
          offset: 0,
        });
      }
      return Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 });
    });
  },

  readBody: () => {
    const call = put.mock.calls.find((c) => c[0] === `videos/${VIDEO_ID}`);
    if (!call) throw new Error('no PUT videos/:id call captured');
    return call[1] as Record<string, unknown>;
  },

  // Only `title` reaches the body at top level. Every other declared field is
  // folded into `draftConfig` (hence `derived: true`), so its wire value is
  // spelled out here — alongside the values the wizard carries in from the
  // earlier steps (service, offer, clips) and derives (the AI script → frames).
  expectedBody: () =>
    expectedFromFields(videoCustomiseForm.fields, {
      serviceId: SERVICE.id,
      offerId: OFFER.id,
      draftConfig: {
        narrationType: 'text_only',
        aiVoiceId: null,
        scriptText: SCRIPT,
        talkingHeadUrl: null,
        textFrames: TEXT_FRAMES,
        offerCard: undefined,
        bRollClips: [
          { assetId: ASSET.id, url: '', order: 0, clipType: 'bRoll' },
        ],
        captions: {
          enabled: true,
          position: 'top',
          fontFamily: 'montserrat',
          textColor: '#facc15',
          backgroundColor: '#101010',
          fontSize: 64,
          highlightColor: '#FFFFFF',
          showBackground: false,
        },
        musicTrackId: 'tea-pop',
        musicUrl: 'https://cdn.test/public/audio/tea-pop.mp3',
        musicVolume: 0.1,
        outro: {
          logoUrl: undefined,
          businessName: ORG.name,
          backgroundColor: '#000000',
          outroStyle: 'location',
          ctaText: 'Book Now',
          backgroundOpacity: 0.7,
          textColor: '#FFFFFF',
          durationSec: 3,
        },
        editedCaptionText: null,
        orientation: 'portrait',
      },
    }),
});
