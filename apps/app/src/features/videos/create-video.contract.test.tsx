import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST videos` — create the draft video.
 *
 * Two genuinely different creation flows write this body, and each OWNS a
 * different slice of it (hence `owns` per surface):
 *
 *  - THE CREATE-VIDEO WIZARD (desktop, and the mobile layout the ads
 *    "video-format" page hands off to — that page only picks a template and
 *    navigates, it builds no body) writes the draft the moment the user leaves
 *    the service step, so it owns `serviceId` + `offerId` and nothing else. The
 *    title, template, variation and minimal draftConfig are derived from the
 *    route, the variation and the org's brand/video defaults.
 *
 *  - THE CREATE-FROM-CLIENT WIZARD builds the whole video on one screen and
 *    owns `title`, `variationId`, `narrationType`, `aiVoiceId` and `scriptText`.
 *    Its `serviceId` comes from the face group, not from a control.
 *
 * The socials generate dialogs also `POST videos`, but their draftConfig is
 * written by the AI (organic copy / offer card) rather than by fields — they
 * add no field to this form, so they are covered by
 * `generate-organic-copy.contract.test.tsx` and the shared
 * `buildCreateVideoPayload` envelope.
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

// The render-progress modal polls the video until it is ready — a different
// operation, and it would keep firing after we have captured the body.
vi.mock(
  '@/routes/_authed/create-video/$templateId/-components/shared/processing-modal',
  () => ({ ProcessingModal: () => null })
);

// The create-from-client Configure step reads the face group it is building for
// from the wizard shell (client picker → media review → configure).
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

import { createVideoForm } from '@/features/videos/api/create-video';
import { VideoCreationForm } from '@/routes/_authed/create-video/$templateId/-components/video-creation-form';
import { VideoCreationProvider } from '@/routes/_authed/create-video/$templateId/-context';
import { StepConfigure } from '@/routes/_authed/dashboard/l/$locationId/videos/create-from-client/-components/step-configure';

/** Text-only template: the wizard's create fires on leaving the service step. */
const TEMPLATE_ID = 'educational';
const VARIATION_ID = 'educational-1';

const ORG = { id: 'org-1', name: 'Test Clinic' };
const SERVICE = { id: 'svc-1', name: 'Lip Filler', category: 'treatment' };
const OFFER = { id: 'offer-1', name: 'Spring Offer', serviceIds: [] };

const FACE_GROUP = {
  id: 'fg-1',
  clientName: 'Alice Smith',
  serviceId: 'svc-1',
  isExcluded: false,
};

const VOICE = createVideoForm.fields.aiVoiceId as { sample: string };

/** The date-stamped title the wizard generates when the user leaves it blank. */
const autoTitle = () =>
  `Video ${new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

/** The wizard's slice: service + offer, then Continue fires `POST videos`. */
const WIZARD_OWNS = ['serviceId', 'offerId'] as const;
/** The create-from-client slice: everything typed on the Configure screen. */
const CONFIGURE_OWNS = [
  'title',
  'variationId',
  'narrationType',
  'aiVoiceId',
  'scriptText',
] as const;

const driveWizardServiceStep = async (ctx: {
  user: import('@testing-library/user-event').UserEvent;
  fill: (...keys: ('serviceId' | 'offerId')[]) => Promise<void>;
}) => {
  await screen.findByText(/is this video for a specific service/i);
  await ctx.fill('serviceId', 'offerId');
  await ctx.user.click(screen.getByRole('button', { name: /continue/i }));
  await vi.waitFor(() =>
    expect(post.mock.calls.some((c) => c[0] === 'videos')).toBe(true)
  );
};

runFormContract({
  operation: 'POST videos',
  description: 'Create video',
  form: createVideoForm,

  fills: {
    // "Yes, for a service" reveals the service card grid.
    serviceId: async (user) => {
      await user.click(
        screen.getByRole('button', { name: /yes, for a service/i })
      );
      await user.click(
        await screen.findByRole('button', { name: /lip filler/i })
      );
    },
    // A Radix Select with a placeholder rather than a bound <label>.
    offerId: async (user) => {
      await user.click(await screen.findByRole('combobox'));
      await user.click(await screen.findByRole('option', { name: OFFER.name }));
    },
  },

  surfaces: [
    {
      name: 'create-video wizard (desktop)',
      owns: [...WIZARD_OWNS],
      run: async (ctx) => {
        renderWithProviders(
          <VideoCreationProvider templateId={TEMPLATE_ID}>
            <VideoCreationForm />
          </VideoCreationProvider>
        );
        await driveWizardServiceStep(ctx);
      },
    },
    {
      name: 'create-video wizard (mobile — ads video-format entry)',
      owns: [...WIZARD_OWNS],
      run: async (ctx) => {
        renderWithProviders(
          <VideoCreationProvider templateId={TEMPLATE_ID}>
            <VideoCreationForm
              layout="mobile"
              adsReturnContext={{ campaignId: 'camp-1' }}
            />
          </VideoCreationProvider>
        );
        await driveWizardServiceStep(ctx);
      },
    },
    {
      name: 'create-from-client configure step',
      owns: [...CONFIGURE_OWNS],
      run: async (ctx) => {
        renderWithProviders(<StepConfigure />);
        await screen.findByText(/configure video/i);

        await ctx.fill(
          'title',
          'variationId',
          'narrationType',
          'aiVoiceId',
          'scriptText'
        );

        await ctx.user.click(
          screen.getByRole('button', { name: /create .* render video/i })
        );
        await vi.waitFor(() =>
          expect(post.mock.calls.some((c) => c[0] === 'videos')).toBe(true)
        );
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockImplementation((path: string) => {
      if (path === 'videos/generate-script') {
        return Promise.resolve({ scriptText: 'Struggling with dry lips?' });
      }
      return Promise.resolve({ id: 'vid-1' });
    });
    put.mockReset();
    put.mockResolvedValue({ id: 'vid-1' });

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
      if (path.startsWith('face-groups/')) {
        return Promise.resolve({ faceGroup: FACE_GROUP, assets: [] });
      }
      return Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 });
    });
  },

  readBody: () => {
    const call = post.mock.calls.find((c) => c[0] === 'videos');
    if (!call) throw new Error('no POST videos call captured');
    return call[1] as Record<string, unknown>;
  },

  /**
   * Each surface's expectation covers the slice it owns, plus the envelope it
   * derives. The two flows deliberately build DIFFERENT draftConfigs — that is
   * what `owns` exists to model — so property 4 compares only the ground they
   * share (here: nothing, because their slices are disjoint), while property 3
   * still pins each body exactly.
   */
  expectedBody: (surface) => {
    if (surface.name.startsWith('create-from-client')) {
      return expectedFromFields(
        createVideoForm.fields,
        {
          templateId: 'before-after',
          serviceId: FACE_GROUP.serviceId,
          draftConfig: {
            scriptText: 'Look at this transformation.',
            narrationType: 'ai_voiceover',
            aiVoiceId: VOICE.sample,
            talkingHeadAssetId: null,
            talkingHeadUrl: null,
            bRollClips: [],
            captions: {
              enabled: true,
              position: 'bottom',
              fontFamily: 'Inter',
              fontSize: 42,
              textColor: '#ffffff',
              highlightColor: '#facc15',
              backgroundColor: '#000000',
              showBackground: true,
            },
            musicTrackId: 'tea-pop',
            musicVolume: 0.15,
            outro: {
              businessName: ORG.name,
              ctaText: 'Book Now',
              backgroundOpacity: 0.85,
              backgroundColor: '#000000',
              textColor: '#ffffff',
              durationSec: 3,
            },
            orientation: 'portrait',
            pipOverlays: undefined,
          },
        },
        { only: [...CONFIGURE_OWNS] }
      );
    }

    return expectedFromFields(
      createVideoForm.fields,
      {
        title: autoTitle(),
        templateId: TEMPLATE_ID,
        variationId: VARIATION_ID,
        draftConfig: {
          scriptText: '',
          narrationType: 'text_only',
          bRollClips: [],
          captions: {
            enabled: true,
            position: 'bottom',
            fontFamily: 'inter',
            textColor: '#FFFFFF',
            backgroundColor: '#000000',
            fontSize: 64,
            highlightColor: '#FFFFFF',
            showBackground: false,
          },
          musicVolume: 0.05,
          outro: {
            businessName: ORG.name,
            backgroundColor: '#000000',
            ctaText: 'Book Now',
            backgroundOpacity: 0.7,
            textColor: '#FFFFFF',
            durationSec: 3,
          },
          orientation: 'portrait',
        },
      },
      { only: [...WIZARD_OWNS] }
    );
  },
});
