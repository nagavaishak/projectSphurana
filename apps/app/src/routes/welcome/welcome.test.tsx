import { fireEvent, renderWithProviders, screen } from '@/test/render';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '@/features/onboarding/types';

/**
 * WelcomePage — the 17-slide forward-only onboarding orchestrator. These tests
 * exercise the state machine at the seam that matters: `SLIDES[currentSlide]`
 * routing + the shared `onAdvance` (which PATCHes `{ currentSlide: next }` and,
 * when a slide passes an answer, records it under `{ slide: <current>, value }`).
 *
 * The two session hooks are mocked so `session`/`updateSession` are fully under
 * test control, and the per-slide API hooks are mocked so the REAL slide
 * components render and drive `onAdvance` with their real next-slide decisions
 * (incl. the campaign_pitch price fork). No network, no RouterProvider.
 */

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ── Router primitives: capture navigate, expose the route's component ────────
// Partial-mock so real exports (createRootRouteWithContext, etc.) survive for
// anything transitively pulled in by the slide deck; only override
// createFileRoute (so `Route.options.component` is the page) and useNavigate.
const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (opts: { component: ComponentType }) => ({
    options: opts,
  }),
  useNavigate: () => navigate,
}));

// A leaf of the slide deck (whatsapp slide → assistant hooks) transitively
// imports the app router, which pulls in the whole generated route tree and
// calls `.update()` on every route object. Stub it so the deck loads in
// isolation without standing up the real router.
vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }));

// ── Session + per-slide hooks (all read the mutable holders below) ───────────
let sessionState: OnboardingSession | null = null;
const updateSession = vi.fn();

// Auth session — drives the WelcomePage verify gate. Default verified so the
// deck renders whatever slide the onboarding session is parked on; flip to
// false to exercise the "force verify_email" guard.
let emailVerifiedState = true;

// campaign_pitch: the suggestion delivered to onSuccess drives the price fork.
let suggestPayload: {
  serviceId: string;
  serviceName: string;
  priceKnown: boolean;
  priceCents?: number;
  reasons: string[];
};

// ad_picker: candidates the grid renders.
let adCandidates: Array<{
  id: string;
  status: string;
  outputs: Array<{ url: string; status: string }>;
}> = [];

vi.mock('@/features/onboarding/api', () => ({
  useOnboardingSession: () => ({
    session: sessionState,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateOnboardingSession: () => ({
    updateSession,
    updateSessionAsync: vi.fn(),
    isUpdating: false,
  }),
  // website slide → advance on success
  useStartWebsiteAnalysis: (opts?: { onSuccess?: () => void }) => ({
    startAnalysis: () => opts?.onSuccess?.(),
    isStarting: false,
  }),
  // campaign_pitch slide → suggestion + (unused here) converse
  useSuggestService: (opts?: { onSuccess?: (d: unknown) => void }) => ({
    suggestService: () => opts?.onSuccess?.(suggestPayload),
  }),
  useConverseSlide: () => ({ converse: vi.fn(), isConversing: false }),
  // ad_picker / video_picker slides
  useCandidates: () => ({
    adCandidates,
    videoCandidates: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRegenerateAdCandidate: () => ({
    regenerateAd: vi.fn(),
    isRegenerating: false,
  }),
}));

// Auth session hook — partial-mock so ensureSession/refetchSession stay real
// for anything the deck transitively imports; only useSession is overridden.
vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  useSession: () => ({
    data: {
      user: { emailVerified: emailVerifiedState, email: 'owner@ex.com' },
    },
    refetch: vi.fn(),
  }),
}));

// Safety net: even if a non-rendered slide's hook slipped through, no real HTTP.
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue(null),
    post: vi.fn().mockResolvedValue(null),
    patch: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
  },
}));

import { Route } from './index';

// biome-ignore lint/suspicious/noExplicitAny: the mocked route exposes options.component.
const WelcomePage = (Route as any).options.component as ComponentType;

const makeSession = (
  overrides: Partial<OnboardingSession>
): OnboardingSession =>
  ({
    id: 's1',
    userId: 'u1',
    organizationId: 'org1',
    status: 'active',
    currentSlide: 'intro',
    answers: null,
    conversationTurns: null,
    websiteUrl: null,
    analysisJobId: null,
    analysisResult: null,
    contentSource: null,
    contentBatchId: null,
    selectedServiceId: null,
    servicePriceCents: null,
    offerId: null,
    adCandidateGraphicIds: null,
    selectedGraphicIds: null,
    videoCandidateIds: null,
    selectedVideoId: null,
    stagedCampaign: null,
    metaCampaignId: null,
    launchedAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }) as OnboardingSession;

describe('WelcomePage · slide routing + onAdvance', () => {
  beforeEach(() => {
    sessionState = null;
    emailVerifiedState = true;
    updateSession.mockReset();
    navigate.mockReset();
    suggestPayload = {
      serviceId: 'svc1',
      serviceName: 'Balayage',
      priceKnown: true,
      priceCents: 12000,
      reasons: ['Popular', 'High margin'],
    };
    adCandidates = [];
  });

  it('renders the intro slide for a session on currentSlide:intro', () => {
    sessionState = makeSession({ currentSlide: 'intro' });
    renderWithProviders(<WelcomePage />);

    // The intro hero's "Let's go" CTA is unique to that slide.
    expect(screen.getByRole('button', { name: "Let's go" })).toBeVisible();
  });

  it('advances intro → verify_email (no answer recorded)', () => {
    sessionState = makeSession({ currentSlide: 'intro' });
    renderWithProviders(<WelcomePage />);

    fireEvent.click(screen.getByRole('button', { name: "Let's go" }));

    expect(updateSession).toHaveBeenCalledWith({
      currentSlide: 'verify_email',
    });
  });

  it('advances verify_email → website once the email is verified', () => {
    // emailVerifiedState defaults to true, so the verify slide's effect fires.
    sessionState = makeSession({ currentSlide: 'verify_email' });
    renderWithProviders(<WelcomePage />);

    expect(updateSession).toHaveBeenCalledWith({ currentSlide: 'website' });
  });

  it('forces an unverified session past the gate back to verify_email', () => {
    emailVerifiedState = false;
    sessionState = makeSession({ currentSlide: 'website' });
    renderWithProviders(<WelcomePage />);

    // The website slide's URL field must NOT be shown — the guard swapped in
    // the verify step instead (its resend link is unique to that slide).
    expect(screen.queryByLabelText('Your website URL')).toBeNull();
    expect(
      screen.getByRole('button', { name: /resend the link/i })
    ).toBeVisible();
  });

  it('advances website → analysis on analysis-start success (no answer)', () => {
    sessionState = makeSession({ currentSlide: 'website' });
    renderWithProviders(<WelcomePage />);

    // Fill a URL so the submit gate opens, then continue. The mocked
    // useStartWebsiteAnalysis fires onSuccess synchronously → onAdvance.
    fireEvent.change(screen.getByLabelText('Your website URL'), {
      target: { value: 'acme.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(updateSession).toHaveBeenCalledWith({ currentSlide: 'analysis' });
  });

  it('records the answer under the CURRENT slide key on ad_picker → video_picker', () => {
    sessionState = makeSession({
      currentSlide: 'ad_picker',
      selectedGraphicIds: null,
    });
    adCandidates = [
      {
        id: 'g1',
        status: 'ready',
        outputs: [{ url: 'x/g1.png', status: 'success' }],
      },
      {
        id: 'g2',
        status: 'ready',
        outputs: [{ url: 'x/g2.png', status: 'success' }],
      },
    ];
    renderWithProviders(<WelcomePage />);

    const options = screen.getAllByRole('button', { pressed: false });
    fireEvent.click(options[0]);
    fireEvent.click(options[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(updateSession).toHaveBeenCalledWith({
      currentSlide: 'video_picker',
      answer: {
        slide: 'ad_picker',
        value: { selectedGraphicIds: ['g1', 'g2'] },
      },
    });
  });

  it('campaign_pitch forks to intro_offer when the price is known', () => {
    sessionState = makeSession({ currentSlide: 'campaign_pitch' });
    suggestPayload = { ...suggestPayload, priceKnown: true };
    renderWithProviders(<WelcomePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ok, sounds good' }));

    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSlide: 'intro_offer',
        answer: expect.objectContaining({ slide: 'campaign_pitch' }),
      })
    );
  });

  it('campaign_pitch forks to service_price when the price is unknown', () => {
    sessionState = makeSession({ currentSlide: 'campaign_pitch' });
    suggestPayload = {
      ...suggestPayload,
      priceKnown: false,
      priceCents: undefined,
    };
    renderWithProviders(<WelcomePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ok, sounds good' }));

    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSlide: 'service_price',
        answer: expect.objectContaining({ slide: 'campaign_pitch' }),
      })
    );
  });

  // NOTE: the "completed session bounces to the dashboard" guard no longer lives
  // in this component — it moved to the /welcome layout route's `beforeLoad`, so
  // it redirects before the deck ever renders. It is covered by
  // `src/routes/welcome.route.test.tsx`.
});
