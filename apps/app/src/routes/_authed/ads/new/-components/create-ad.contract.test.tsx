import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST meta-ads` — create ad (save as draft).
 *
 * Two surfaces build this body: the desktop {@link AdWizardForm} and the mobile
 * {@link AdMobileWizard}. Both walk the same four steps (campaign → details →
 * media → customize) over the one {@link adWizardForm}, and both hand the values
 * to the one `buildCreateAdPayload`. `POST meta-ads/launch` is the same form
 * with a different terminal button; see `launch-ad.contract.test.tsx`.
 *
 * The wizard is a walk, so the recipe fills each field at the step where its
 * control appears and the harness checks afterwards that NONE was skipped.
 *
 * The campaign is `email_only` on purpose. The customize step's fields are gated
 * on the CAMPAIGN's follow-up type, which is context and not a form field: a
 * chatbot campaign hides "Call to Action", a lead-form campaign hides (and
 * clears) "Destination URL". `email_only` is the one branch in which every
 * declared field has a control, which is what property 2 needs.
 */

// ── jsdom shims: Radix Select/Dialog + framer-motion ─────────────────────────
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

// ── Router: navigate stub; Link → anchor; no ?videoId preselect ──────────────
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
vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }));

// ── The submit hooks under assertion ─────────────────────────────────────────
const launchAdAsync = vi.fn();
const createAdAsync = vi.fn();
const runHealthCheck = vi.fn();

/**
 * `email_only`: the follow-up type that shows BOTH the call-to-action and the
 * destination-url controls (see the docblock above).
 */
const campaign = {
  id: 'camp_1',
  name: 'Summer Campaign',
  followUpType: 'email_only',
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
    createdAt: '2024-01-01T00:00:00.000Z',
  },
];
const session = { activeOrganizationId: 'org_1' };
const organization = { websiteUrl: '' };
const metaIntegration = {
  integration: { adAccountId: 'act_1' },
  availableAdAccounts: [] as unknown[],
};
// The customize step auto-generates copy from the selected media. Reject, so the
// contract's own samples are what land in the fields.
const generateContentAsync = vi.fn().mockRejectedValue(new Error('skip-ai'));
const launchResult = { executeAsync: launchAdAsync, isExecuting: false };
const createResult = { executeAsync: createAdAsync, isExecuting: false };
const healthCheckResult = {
  runHealthCheck,
  healthCheckResult: null,
  isChecking: false,
  reset: vi.fn(),
};

// Keep the real payload builders (pure) so each surface assembles a real body.
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

vi.mock('@/features/auth/api/get-session', () => ({
  useGetSession: () => ({ session }),
}));
vi.mock('@/features/organization/api/get-organization', () => ({
  useGetOrganization: () => ({ organization }),
}));
vi.mock('@/features/integrations/api', () => ({
  useGetMetaIntegration: () => metaIntegration,
}));
vi.mock('@/features/integrations', () => ({
  useListMetaAdsPages: () => ({ pages, isLoading: false }),
}));
vi.mock('@/features/organization-services', () => ({
  useListServices: () => ({ services, isLoading: false }),
}));
vi.mock('@/features/videos', () => ({
  useListVideos: () => ({ videos, isLoading: false }),
  useGetVideo: () => ({ video: null }),
}));
const emptyAssets = { assets: [] as unknown[], isLoading: false };
vi.mock('@/features/assets', () => ({
  useListAssets: () => emptyAssets,
  useCreateAsset: () => ({ createAssetAsync: vi.fn(), isCreating: false }),
}));
vi.mock('@/features/graphics', () => ({
  useListGraphics: () => ({ graphics: [], isLoading: false }),
}));
vi.mock('@/features/upload', () => ({
  useUploadFile: () => ({ uploadAsync: vi.fn(), isUploading: false }),
}));
vi.mock('@/features/social-posts', () => ({
  useListSocialPosts: () => ({ socialPosts: [], isLoading: false }),
  // Rendered by AdPreview inside the mobile customize step's collapsible.
  FacebookPostPreview: () => null,
}));
vi.mock('@/features/ai-content', () => ({
  useGenerateContent: () => ({ generateContentAsync }),
}));

// Mobile chrome — render children plainly, no header machinery.
vi.mock('@/features/mobile-dashboard-header', () => ({
  MobileDashboardHeader: () => null,
  MobileDashboardHeaderProvider: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <>{children}</>,
  useMobileDashboardHeaderContent: () => undefined,
}));
vi.mock(
  '@/features/mobile-dashboard-header/mobile-dashboard-header-layout',
  () => ({ MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS: '' })
);
vi.mock('@/features/mobile-ui', () => ({
  MobileSegmentedTabs: () => null,
}));

// ── DetailsStep service combobox: Radix Popover + cmdk → passthrough stubs ────
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
import { adWizardForm } from '../-schema';
import { AdMobileWizard } from './ad-mobile/ad-mobile-wizard';
import {
  adWizardFills,
  driveAdWizardToCustomize,
  setAdSurface,
} from './ad-wizard-contract-drive';
import { AdWizardForm } from './ad-wizard-form';

runFormContract({
  operation: 'POST meta-ads',
  description: 'Create ad',
  form: adWizardForm,
  fills: adWizardFills,

  surfaces: [
    {
      name: 'desktop ad-wizard',
      run: async (ctx) => {
        setAdSurface('desktop');
        renderWithProviders(
          <AdWizardProvider>
            <AdWizardForm />
          </AdWizardProvider>
        );

        await driveAdWizardToCustomize(ctx);

        const draft = await screen.findByRole('button', {
          name: 'Save as Draft',
        });
        await waitFor(() => expect(draft).not.toBeDisabled());
        await ctx.user.click(draft);
        await waitFor(() => expect(createAdAsync).toHaveBeenCalled());
      },
    },
    {
      name: 'mobile ad-wizard',
      run: async (ctx) => {
        setAdSurface('mobile');
        renderWithProviders(
          <AdWizardProvider>
            <AdMobileWizard />
          </AdWizardProvider>
        );

        await driveAdWizardToCustomize(ctx);

        const draft = await screen.findByRole('button', { name: 'Draft' });
        await waitFor(() => expect(draft).not.toBeDisabled());
        await ctx.user.click(draft);
        await waitFor(() => expect(createAdAsync).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    navigate.mockReset();
    createAdAsync.mockReset().mockResolvedValue(undefined);
    launchAdAsync.mockReset().mockResolvedValue(undefined);
    runHealthCheck.mockReset().mockResolvedValue({ overall: 'pass' });
  },

  readBody: () => {
    const call = createAdAsync.mock.calls[0];
    if (!call) throw new Error('no create-ad mutation captured');
    return call[0] as Record<string, unknown>;
  },

  /**
   * The samples, plus the keys the shared builder renames or derives: the
   * campaign id and the ad name land as `metaCampaignId` / `name`, the placement
   * is the wizard's fixed default, and the follow-up comes from the CAMPAIGN,
   * not the form.
   */
  expectedBody: () =>
    expectedFromFields(adWizardForm.fields, {
      metaCampaignId: 'camp_1',
      name: 'My Test Ad',
      adPlacement: 'facebook',
      followUpType: 'email_only',
    }),
});
