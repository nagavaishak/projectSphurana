import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AdWizardForm — the ad-creation wizard orchestrator (Workstream D1).
 *
 * These tests exercise the wizard STATE MACHINE at its real seams:
 * `getActiveSteps()` → `STEP_COMPONENTS[currentStep.id]` routing, the
 * `handleContinue`/`handleBack` index moves, the two distinct advance-gates
 * (per-step `schema.safeParseAsync` validation AND the `canContinue` guard on
 * select-media), context-backed state that must survive step changes, the live
 * conditional branch (`preselectedCampaignId` skips the campaign step), and the
 * final `launchAd` payload the wizard assembles from every step.
 *
 * The REAL step components render — only the api hooks are mocked (with simple
 * fixtures) plus a few jsdom-hostile primitives:
 *  • ui/popover + ui/command (DetailsStep's service combobox is Radix Popover +
 *    cmdk) → passthrough stubs so the service option is a clickable role=option.
 *  • The Radix Select/Popover browser-API polyfills (ResizeObserver, pointer
 *    capture, scrollIntoView) so CampaignStep's closed Select renders.
 * No RouterProvider is stood up; '@tanstack/react-router' is partial-mocked so
 * useNavigate/useSearch/Link resolve without the generated route tree.
 *
 * NOTE ON DEAD CODE: the "existing post vs new creative" ad-source branch is
 * currently commented out in the orchestrator (AdSourceStep/SelectPostStep are
 * not in STEP_COMPONENTS, `isExistingPostFlow = false`). The LIVE branch is
 * `skipCampaign` — that is the conditional path covered here.
 */

// ── jsdom shims for Radix Select/Popover (CampaignStep renders a closed Select)
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
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

// ── Router: capture navigate; Link → plain anchor; useSearch → no preselect ──
const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  useSearch: () => ({}),
  Link: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    to?: string;
  }) => <a {...props}>{children}</a>,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

// A transitively-imported feature module could pull in the app router (whole
// generated route tree). Stub it so the wizard loads in isolation.
vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }));

// ── The submit hooks under assertion ────────────────────────────────────────
const launchAdAsync = vi.fn();
const createAdAsync = vi.fn();
const runHealthCheck = vi.fn();

// CRITICAL: every hook returns a STABLE reference (real React Query keeps data
// identity across renders). Fresh array/object literals per call would make the
// orchestrator's `campaigns`-keyed effect + the campaign-config context setter
// churn on every render → an infinite re-render loop. So all fixtures are
// module-level singletons.
const campaign = {
  id: 'camp_1',
  name: 'Summer Campaign',
  followUpType: 'lead_form',
  conversionDestination: null,
  dailyBudget: '1000',
  lifetimeBudget: null,
  effectiveStatus: 'ACTIVE',
  status: 'ACTIVE',
};
const campaigns = [campaign];
const pages = [
  {
    id: 'page_1',
    pageId: 'fb_1',
    pageName: 'My Salon',
    platform: 'facebook',
    isActive: true,
  },
];
const services = [{ id: 'svc_1', name: 'Balayage', isActive: true }];
const videos = [
  {
    id: 'vid_1',
    title: 'Promo Video',
    status: 'ready',
    thumbnailUrl: 'https://x/vid_1.png',
    blobUrl: null,
    durationMs: '15000',
  },
];
const session = { activeOrganizationId: 'org_1' };
const organization = { websiteUrl: '' };
const metaIntegration = {
  integration: { adAccountId: 'act_1' },
  availableAdAccounts: [] as unknown[],
};
const generateContentAsync = vi.fn().mockRejectedValue(new Error('skip-ai'));
const launchResult = { executeAsync: launchAdAsync, isExecuting: false };
const createResult = { executeAsync: createAdAsync, isExecuting: false };
const healthCheckResult = {
  runHealthCheck,
  healthCheckResult: null,
  isChecking: false,
  reset: vi.fn(),
};

// Keep the real payload builders (pure, no api-client/providers) so the wizard
// assembles a real body; only the mutation hooks are stubbed.
vi.mock('@/features/meta-ads', async () => {
  const create = await vi.importActual<
    typeof import('@/features/meta-ads/api/create-ad/create-ad.payload')
  >('@/features/meta-ads/api/create-ad/create-ad.payload');
  const launch = await vi.importActual<
    typeof import('@/features/meta-ads/api/launch-ad/launch-ad.payload')
  >('@/features/meta-ads/api/launch-ad/launch-ad.payload');
  return {
    useLaunchAd: () => launchResult,
    useCreateAd: () => createResult,
    buildCreateAdPayload: create.buildCreateAdPayload,
    buildLaunchAdPayload: launch.buildLaunchAdPayload,
  };
});

vi.mock('@/features/meta-ads/api/health-check', () => ({
  useHealthCheck: () => healthCheckResult,
}));

vi.mock('@/features/meta-campaigns', () => ({
  useListCampaigns: () => ({ campaigns, isLoading: false }),
  campaignHasBudget: () => true,
  HealthCheckDialog: () => null,
  MetaErrorDialog: () => null,
  NoBudgetDialog: () => null,
}));

// ── Session + organization (orchestrator reads activeOrg + websiteUrl) ───────
vi.mock('@/features/auth/api/get-session', () => ({
  useGetSession: () => ({ session }),
}));
vi.mock('@/features/organization/api/get-organization', () => ({
  useGetOrganization: () => ({ organization }),
}));

// ── CampaignStep deps ────────────────────────────────────────────────────────
vi.mock('@/features/integrations/api', () => ({
  useGetMetaIntegration: () => metaIntegration,
}));

// ── DetailsStep / SelectPageStep / AdPlacementStep deps ──────────────────────
vi.mock('@/features/integrations', () => ({
  useListMetaAdsPages: () => ({ pages, isLoading: false }),
}));

// ── DetailsStep / SelectServicesStep deps ────────────────────────────────────
vi.mock('@/features/organization-services', () => ({
  useListServices: () => ({ services, isLoading: false }),
}));

// ── SelectVideoStep deps ─────────────────────────────────────────────────────
vi.mock('@/features/videos', () => ({
  useListVideos: () => ({ videos, isLoading: false }),
  useGetVideo: () => ({ video: null }),
}));
const emptyAssets = { assets: [] as unknown[], isLoading: false };
const uploadResult = { uploadAsync: vi.fn(), isUploading: false };
const createAssetResult = { createAssetAsync: vi.fn(), isCreating: false };
vi.mock('@/features/assets', () => ({
  useListAssets: () => emptyAssets,
  useCreateAsset: () => createAssetResult,
}));
vi.mock('@/features/graphics', () => ({
  useListGraphics: () => ({ graphics: [], isLoading: false }),
}));
vi.mock('@/features/upload', () => ({
  useUploadFile: () => uploadResult,
}));

// ── SelectPostStep dep (dead branch, never rendered — mock keeps barrel light)
vi.mock('@/features/social-posts', () => ({
  useListSocialPosts: () => ({ socialPosts: [], isLoading: false }),
}));

// ── CustomizeStep dep — reject so no AI copy is written (clean payload) ───────
vi.mock('@/features/ai-content', () => ({
  useGenerateContent: () => ({ generateContentAsync }),
}));

// ── ui/select (Radix) → native <select>. CampaignStep + CustomizeStep(CTA) use
//    it; the real Radix Select fires a spurious empty onValueChange on mount in
//    jsdom which wipes the callToAction default. A native select is drivable and
//    keeps the controlled value intact.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: React.ReactNode;
  }) => (
    <select
      value={value ?? ''}
      onChange={(e) => onValueChange?.(e.target.value)}
      data-slot="select"
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => (
    <optgroup style={{ display: 'none' }}>{children}</optgroup>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    value,
    children,
  }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// ── DetailsStep service combobox: Radix Popover + cmdk → passthrough stubs so
//    the service option is a clickable role="option" without pointer plumbing.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandInput: (props: { placeholder?: string }) => (
    <input placeholder={props.placeholder} />
  ),
  CommandList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandEmpty: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandItem: ({
    children,
    onSelect,
  }: {
    children?: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <div
      role="option"
      aria-selected={false}
      tabIndex={0}
      onClick={() => onSelect?.()}
      onKeyDown={() => onSelect?.()}
    >
      {children}
    </div>
  ),
}));

// Safety net: no real HTTP if a non-mocked hook slipped through.
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue(null),
    post: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
  },
}));

import { AdWizardProvider } from '../-context';
import { AdWizardForm } from './ad-wizard-form';

function renderWizard(props?: { preselectedCampaignId?: string }) {
  return renderWithProviders(
    <AdWizardProvider>
      <AdWizardForm {...props} />
    </AdWizardProvider>
  );
}

/** From the details step (step 0 in the skipCampaign branch): fill name +
 *  service + page, then advance to the select-media step. */
async function completeDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Ad name'), 'My Test Ad');
  await user.click(screen.getByRole('option', { name: /Balayage/ }));
  await user.click(screen.getByRole('button', { name: /My Salon/ }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Select content for your ad');
}

/** From select-media: pick the video, then advance to the customize step. */
async function selectMediaAndContinue(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.click(screen.getByTestId('video-card'));
  const continueBtn = screen.getByRole('button', { name: 'Continue' });
  await waitFor(() => expect(continueBtn).not.toBeDisabled());
  await user.click(continueBtn);
  await screen.findByText('Customize your ad');
}

describe('AdWizardForm · wizard state machine', () => {
  beforeEach(() => {
    navigate.mockReset();
    launchAdAsync.mockReset().mockResolvedValue(undefined);
    createAdAsync.mockReset().mockResolvedValue(undefined);
    runHealthCheck.mockReset().mockResolvedValue({ overall: 'pass' });
  });

  // NOTE: step content lives inside a `motion.div` whose `initial="hidden"`
  // variant renders at opacity:0 in jsdom (framer-motion's animation loop never
  // ticks), so assert presence with toBeInTheDocument rather than toBeVisible.
  it('starts on the campaign step when no campaign is preselected (4-step branch)', () => {
    renderWizard();

    expect(
      screen.getByRole('heading', { name: 'Select a campaign' })
    ).toBeInTheDocument();
    // Later steps are not mounted yet.
    expect(screen.queryByText('Ad details')).not.toBeInTheDocument();
  });

  it('skips the campaign step when a campaign is preselected (3-step branch)', () => {
    renderWizard({ preselectedCampaignId: 'camp_1' });

    // Campaign step is dropped → the wizard opens straight on Details.
    expect(
      screen.getByRole('heading', { name: 'Ad details' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Select a campaign' })
    ).not.toBeInTheDocument();
  });

  it('blocks Continue on an incomplete details step (schema gate)', async () => {
    const user = userEvent.setup();
    renderWizard({ preselectedCampaignId: 'camp_1' });

    // No name / no service → validateCurrentStep fails, index does not advance.
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('heading', { name: 'Ad details' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Select content for your ad')
    ).not.toBeInTheDocument();
  });

  it('disables Continue on select-media until media is chosen (canContinue gate)', async () => {
    const user = userEvent.setup();
    renderWizard({ preselectedCampaignId: 'camp_1' });

    await completeDetails(user);

    // canContinue = !!selectedVideo → button starts disabled.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await user.click(screen.getByTestId('video-card'));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Continue' })
      ).not.toBeDisabled()
    );
  });

  it('Back returns to the previous step and preserves the media selection', async () => {
    const user = userEvent.setup();
    renderWizard({ preselectedCampaignId: 'camp_1' });

    await completeDetails(user);
    await selectMediaAndContinue(user);

    // On customize (last step) → go back to select-media. AnimatePresence
    // mode="wait" swaps steps asynchronously, so await the incoming heading.
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    await screen.findByText('Select content for your ad');

    // Selection survived the round-trip (context-backed) → Continue re-enabled.
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
  });

  it('assembles the launch payload from every step on publish', async () => {
    const user = userEvent.setup();
    renderWizard({ preselectedCampaignId: 'camp_1' });

    await completeDetails(user);
    await selectMediaAndContinue(user);

    // Last step: publish → health check passes → confirm modal → confirm.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Publish' })).not.toBeDisabled()
    );
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(launchAdAsync).toHaveBeenCalledTimes(1));
    // The payload threads state entered across THREE different steps:
    // campaign (preselect) + details (name/service/page) + media (video).
    expect(launchAdAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        metaCampaignId: 'camp_1',
        name: 'My Test Ad',
        serviceIds: ['svc_1'],
        metaAdsPageId: 'page_1',
        videoId: 'vid_1',
        adPlacement: 'facebook',
        followUpType: 'lead_form',
        // lead-form campaigns seed SIGN_UP as the default CTA on the customize step.
        callToAction: 'SIGN_UP',
      })
    );
    expect(createAdAsync).not.toHaveBeenCalled();
  });
});
