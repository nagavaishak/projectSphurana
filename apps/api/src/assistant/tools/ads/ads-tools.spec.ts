import {
  flagBudgetFailure,
  resolveBudgetFailureInterlock,
  validateGeneratedCopy,
} from '@borradh-workspace/features/assistant';
import {
  getPrimaryLocation,
  resolveOrgPrivacyPolicyUrl,
} from '@borradh-workspace/features/organizations';
import { logError, logWarning } from '@borradh-workspace/observability';
import { buildAssistantPorts } from '../../ports/index.js';
import { ApiFetchError, isPathAllowed } from '../../tool-factory/index.js';
import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { checkMetaIntegrationTool } from './check-meta-integration.tool.js';
import { confirmLaunchAdTool } from './confirm-launch-ad.tool.js';
import { confirmPauseAdTool } from './confirm-pause-ad.tool.js';
import { confirmUpdateBudgetTool } from './confirm-update-budget.tool.js';
import { createCampaignTool } from './create-campaign.tool.js';
import { createDraftAdTool } from './create-draft-ad.tool.js';
import { duplicateAdTool } from './duplicate-ad.tool.js';
import { duplicateCampaignTool } from './duplicate-campaign.tool.js';
import { executeLaunchAdTool } from './execute-launch-ad.tool.js';
import { executePauseAdTool } from './execute-pause-ad.tool.js';
import { executeUpdateBudgetTool } from './execute-update-budget.tool.js';
import { generateAdCopyTool } from './generate-ad-copy.tool.js';
import { getAdInsightsTool } from './get-ad-insights.tool.js';
import { getCampaignInsightsTool } from './get-campaign-insights.tool.js';
import { adsTools } from './index.js';
import { listCampaignsTool } from './list-campaigns.tool.js';
import { listLibraryImagesTool } from './list-library-images.tool.js';
import { listRecentAdsTool } from './list-recent-ads.tool.js';
import { previewCampaignTool } from './preview-campaign.tool.js';
import { replaceAdCreativeTool } from './replace-ad-creative.tool.js';
import { suggestAdOptimizationsTool } from './suggest-ad-optimizations.tool.js';
import { updateAdTool } from './update-ad.tool.js';

// `meta-ads.adapter.ts` now calls `updateCampaign` directly instead of going
// through the loopback (phase 4, step 4). That import drags the Meta
// integration graph — `packages/integrations` — into this unit test's module
// graph, and the api jest transform cannot load its ESM. Stubbing the use case
// keeps the unit tests about the ADAPTER's mapping; the real call is covered by
// `_integration/tool-meta-ads-budget.int-spec.ts`.
jest.mock('@borradh-workspace/features/meta-campaigns', () => ({
  updateCampaign: jest.fn(async () => ({
    success: true,
    data: { updated: true },
  })),
  // Default: no stored ad-account currency, so the service resolved from the
  // ORG's country — the fixture org is in `gb` → £. This is the common real
  // case (the campaign predates the `adAccountCurrency` column, or was made
  // outside Borradh and has no config row at all), and it must NOT render €.
  getCampaignCurrency: jest.fn(async () => ({
    success: true,
    data: {
      metaCampaignId: 'mc-1',
      organizationId: 'org-1',
      currencyCode: 'GBP',
      currencySymbol: '£',
      source: 'organization',
    },
  })),
}));
import {
  getCampaignCurrency,
  updateCampaign,
} from '@borradh-workspace/features/meta-campaigns';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Short-circuit the database barrel — same reason as the appointments and
// leads spec files. The factory's confirmation.ts module is the only thing
// that imports `db`, and `buildCtx` overrides createConfirmation /
// verifyConfirmation so that path is never reached.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  // The d2b validator is the one real production import the ads spec
  // exercises (via generateAdCopyTool). The simplest mock returns no
  // failures for the inputs the test passes; specific tests can override.
  validateGeneratedCopy: jest.fn(() => []),
  // Money-truth budget-failure interlock (register #137). Defaults: nothing
  // flagged → launches are not blocked. Individual tests override
  // resolveBudgetFailureInterlock to exercise the blocked path.
  flagBudgetFailure: jest.fn(async () => ({
    success: true,
    data: { flagged: true },
  })),
  clearBudgetFailure: jest.fn(async () => ({
    success: true,
    data: { cleared: true },
  })),
  resolveBudgetFailureInterlock: jest.fn(async () => ({
    success: true,
    data: { blocked: false, cleared: false },
  })),
}));

// createDraftAdTool reads org defaults to fill in missing service ids — mock
// the lookup so the unit test doesn't hit a real DB. The default returns a
// successful Result with no service-id default set, which means the model's
// input is used as-is.
jest.mock('@borradh-workspace/features/org-defaults', () => ({
  getOrgDefaults: jest.fn(async () => ({
    success: true,
    data: {
      organizationId: 'org-1',
      adDailyBudgetCents: 1000,
      adObjective: 'OUTCOME_LEADS',
      videoOrientation: 'landscape',
      videoLengthSecs: 60,
      brandVoice: null,
      defaultServiceIdForAds: null,
      adAreaType: null,
    },
  })),
  targetingRadiusKmForAreaType: (areaType: string | null | undefined) =>
    areaType === 'city' ? 20 : areaType === 'countryside' ? 40 : 25,
}));

jest.mock('@borradh-workspace/features/organizations', () => ({
  getPrimaryLocation: jest.fn(async () => ({
    success: true,
    data: {
      id: 'loc_1',
      label: 'Pelham Street, Stoke on Trent',
      city: 'Stoke on Trent',
      country: 'gb',
      latitude: 53.0201,
      longitude: -2.1695242,
    },
  })),
  // previewCampaign reads the org to decide whether a lead form can run (Meta
  // requires a privacy-policy URL). Default: URL present → lead_form default.
  getOrganization: jest.fn(async () => ({
    success: true,
    data: { id: 'org-1', privacyPolicyUrl: 'https://clinic.example/privacy' },
  })),
  // Default: the org resolves to a usable privacy-policy URL (website / FB page
  // / connected Facebook Page). Individual tests override this to null.
  resolveOrgPrivacyPolicyUrl: jest.fn(
    async () => 'https://clinic.example/privacy'
  ),
}));

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
  callCounter?: { count: number; max: number };
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
  runHardBlocks?: AssistantToolsContext['runHardBlocks'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    timezone: 'Europe/Dublin',
    userId: 'user-1',
    // The budget/campaign tools declare `policy: 'admin'`, which the factory
    // now ENFORCES against this field (fail-closed on undefined). Mirrors the
    // @RequireRole('admin') the loopback used to carry. See
    // `tool-factory/tool-policy.spec.ts` for the refusal cases.
    callerRole: 'admin',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    // Ports compose over the SAME mocked apiFetch, so assertions about which
    // paths a tool hits are unaffected by the port refactor.
    ports: buildAssistantPorts({
      apiFetch,
      organizationId: 'org-1',
      conversationId: 'conv-1',
    }),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks:
      overrides.runHardBlocks ??
      (jest.fn(async () => ({ pass: true })) as never),
    createConfirmation:
      overrides.createConfirmation ??
      (jest.fn(async () => ({
        id: 'token-abc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })) as never),
    verifyConfirmation:
      overrides.verifyConfirmation ??
      (jest.fn(async () => ({ valid: true, payload: null })) as never),
  };
}

describe('ads tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registry', () => {
    it('exports 26 tools', () => {
      // 24 -> 26: confirmResumeAd + executeResumeAd. Pause was exposed and
      // confirmed while resume had no tool at all, so Claire could stop an
      // owner's spend and not restart it.
      expect(adsTools).toHaveLength(26);
    });

    it('every tool name uses the meta_ads_ prefix', () => {
      for (const tool of adsTools) {
        expect(tool.name).toMatch(/^meta_ads_/);
        expect(tool.feature).toBe('meta-ads');
      }
    });

    it('launch / pause / update-budget tools split into confirm + execute (W-C05 D-1)', () => {
      // The pause / budget flows use the two-tool confirm+execute pattern
      // (factory destructive=false on both halves) instead of the factory's
      // destructive=true single-tool flow.
      //
      // executeLaunchAd is the exception (Phase 6, #131): it is now
      // destructive=true so the factory enforces the turn-boundary rule and
      // payload binding on the money-moving launch — see the assertion below.
      // confirmLaunchAd stays non-destructive: it is the token ISSUER and
      // still drives the two-tool `ad-confirmation:launch` card contract.
      const expectedNonDestructive = [
        'meta_ads_confirmLaunchAd',
        'meta_ads_confirmPauseAd',
        'meta_ads_executePauseAd',
        'meta_ads_confirmUpdateBudget',
        'meta_ads_executeUpdateBudget',
      ];
      for (const tool of adsTools.filter((t) =>
        expectedNonDestructive.includes(t.name)
      )) {
        expect(tool.destructive).toBe(false);
      }

      // The launch execute half is destructive so it routes through factory
      // verification (turn-boundary + payload binding), not a hand-rolled
      // token check.
      const executeLaunch = adsTools.find(
        (t) => t.name === 'meta_ads_executeLaunchAd'
      );
      expect(executeLaunch?.destructive).toBe(true);
      expect(executeLaunch?.destructiveAction).toBe('launch_ad');
    });
  });

  describe('checkMetaIntegrationTool', () => {
    it('returns the configured shape when integration is healthy', async () => {
      const apiFetch = jest.fn(async () => ({
        integration: {
          configurationStatus: 'configured',
          tokenStatus: 'healthy',
          adAccountName: 'Borradh Ads',
          defaultPage: { pageName: 'Borradh', platform: 'facebook' },
          pages: [
            {
              pageName: 'Borradh',
              platform: 'facebook',
              pageUsername: 'borradh',
              isActive: true,
            },
          ],
        },
      }));
      const result = await checkMetaIntegrationTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data).toMatchObject({
          connected: true,
          configured: true,
          tokenStatus: 'healthy',
        });
      }
    });

    it('returns connected: false when integration is null', async () => {
      const apiFetch = jest.fn(async () => ({ integration: null }));
      const result = await checkMetaIntegrationTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.connected).toBe(false);
        expect(result.data.message).toContain('Settings → Integrations');
      }
    });

    it('flags a failed lookup as checkFailed (not a confirmed disconnection)', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('boom');
      });
      const result = await checkMetaIntegrationTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // A thrown lookup error is "couldn't verify", not "disconnected" —
        // checkFailed must be set and the message must not claim disconnection.
        expect(result.data.checkFailed).toBe(true);
        expect(result.data.message).not.toContain('Settings → Integrations');
        expect(result.data.message?.toLowerCase()).toContain('try again');
      }
    });
  });

  describe('listCampaignsTool', () => {
    it('GETs meta-campaigns and maps the response', async () => {
      // Wire shape per `listMetaCampaignsResponseSchema`: Meta returns budgets
      // as STRINGS in minor units, and omits them entirely when unset.
      const apiFetch = jest.fn(async () => ({
        campaigns: [
          {
            id: 'c1',
            name: 'Q1',
            objective: 'LEADS',
            effectiveStatus: 'ACTIVE',
            status: 'ACTIVE',
            dailyBudget: '1000',
            adCount: 3,
            previewImageUrl: null,
          },
        ],
      }));
      const result = await listCampaignsTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'meta-campaigns',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.campaigns).toHaveLength(1);
        expect(result.data.total).toBe(1);
      }
    });

    it('returns soft error on apiFetch failure', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('meta down');
      });
      const result = await listCampaignsTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.error).toContain('meta down');
      }
    });
  });

  describe('listRecentAdsTool', () => {
    it('hits the campaign-scoped endpoint when campaignId is given', async () => {
      const apiFetch = jest.fn(async () => ({ ads: [], total: 0 }));
      await listRecentAdsTool.execute(
        { campaignId: 'c1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toMatch(/^meta-ads\/campaigns\/c1\?/);
    });
  });

  describe('replaceAdCreativeTool', () => {
    it('replaces exactly one creative on the existing draft', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'ad-1',
        name: 'Draft ad',
        status: 'draft',
        headline: 'A better headline',
        primaryText: 'Caption',
        callToAction: 'BOOK_NOW',
        destinationUrl: null,
        videoId: null,
        graphicId: 'graphic-new',
      }));
      const result = await replaceAdCreativeTool.execute(
        { adId: 'ad-1', graphicId: 'graphic-new' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith('meta-ads/ad-1/creative', {
        method: 'PUT',
        body: { graphicId: 'graphic-new' },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.adId).toBe('ad-1');
        expect(result.data.preview?.graphicId).toBe('graphic-new');
      }
    });

    it('rejects zero or two creatives before fetching', async () => {
      const apiFetch = jest.fn();
      const none = await replaceAdCreativeTool.execute(
        { adId: 'ad-1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const both = await replaceAdCreativeTool.execute(
        { adId: 'ad-1', videoId: 'v-1', graphicId: 'g-1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(none.ok).toBe(false);
      expect(both.ok).toBe(false);
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('folds a library assetId into the videoId slot and previews the image directly', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('assets/')) {
          return {
            id: 'asset-7',
            type: 'image',
            blobUrl: 'https://cdn.example.com/photo.jpg',
            thumbnailUrl: 'https://cdn.example.com/photo-thumb.jpg',
          };
        }
        return {
          id: 'ad-1',
          name: 'Draft ad',
          status: 'draft',
          headline: null,
          primaryText: null,
          callToAction: null,
          destinationUrl: null,
          videoId: 'asset-7',
          graphicId: null,
        };
      });
      const result = await replaceAdCreativeTool.execute(
        { adId: 'ad-1', assetId: 'asset-7' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      // PUT carries the asset id in the videoId slot.
      expect(apiFetch).toHaveBeenCalledWith('meta-ads/ad-1/creative', {
        method: 'PUT',
        body: { videoId: 'asset-7' },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // Direct image preview, and NOT the un-fetchable id poll.
        expect(result.data.preview?.assetImageUrl).toBe(
          'https://cdn.example.com/photo.jpg'
        );
        expect(result.data.preview?.videoId).toBeUndefined();
      }
    });
  });

  describe('listLibraryImagesTool', () => {
    it('returns only image assets from the library', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'img-1',
            name: 'Endosphere 1',
            type: 'image',
            blobUrl: 'https://cdn/1.jpg',
            thumbnailUrl: 'https://cdn/1-t.jpg',
          },
          {
            id: 'vid-1',
            name: 'A video',
            type: 'video',
            blobUrl: 'https://cdn/v.mp4',
            thumbnailUrl: null,
          },
        ],
      }));
      const result = await listLibraryImagesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      // Hits the image-filtered assets endpoint.
      // Second arg is the derived response schema (Gate 4) — assert the path and
      // that a schema was passed, not its internals.
      expect(apiFetch).toHaveBeenCalledWith(
        'assets?type=image&limit=50',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'images' in result.data) {
        expect(result.data.images).toHaveLength(1);
        expect(result.data.images?.[0]).toMatchObject({
          id: 'img-1',
          name: 'Endosphere 1',
        });
      }
    });

    it('scopes to a service when serviceId is given', async () => {
      const apiFetch = jest.fn(async () => ({ items: [] }));
      await listLibraryImagesTool.execute(
        { serviceId: 'svc-1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'assets/by-service/svc-1?type=image',
        expect.objectContaining({ schema: expect.anything() })
      );
    });
  });

  describe('getAdInsightsTool', () => {
    it("returns a 'no insights' shape when the ad is not found", async () => {
      const apiFetch = jest.fn(async () => ({
        totals: {
          spend: 0,
          reach: 0,
          clicks: 0,
          impressions: 0,
          leads: 0,
          conversions: 0,
          ctr: 0,
          cpc: 0,
          cpm: 0,
          frequency: 0,
        },
        ads: [],
        dateRange: { since: '2026-01-01', until: '2026-01-30' },
      }));
      const result = await getAdInsightsTool.execute(
        { metaCampaignId: 'c1', metaAdId: 'missing-ad' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.message).toContain('No insights data');
      }
    });
  });

  describe('getCampaignInsightsTool', () => {
    it('builds totals with cpl/cpa derived from leads/conversions', async () => {
      const apiFetch = jest.fn(async () => ({
        totals: {
          spend: 10000,
          reach: 1000,
          clicks: 50,
          impressions: 2000,
          leads: 5,
          conversions: 1,
          ctr: 2.5,
          cpc: 200,
          cpm: 5000,
          frequency: 1.2,
        },
        ads: [],
        dateRange: { since: '2026-01-01', until: '2026-01-30' },
      }));
      const result = await getCampaignInsightsTool.execute(
        { metaCampaignId: 'c1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data?.totals) {
        expect(result.data.totals.cpl).toBe(2000);
        expect(result.data.totals.cpa).toBe(10000);
      }
    });

    it('resolves a datePreset server-side and echoes the resolved range (Phase 3, #193)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00Z'));
      try {
        const apiFetch = jest.fn(async () => ({
          totals: {
            spend: 0,
            reach: 0,
            clicks: 0,
            impressions: 0,
            leads: 0,
            conversions: 0,
            ctr: 0,
            cpc: 0,
            cpm: 0,
            frequency: 0,
          },
          ads: [],
          // The API would echo whatever window it computed; the tool overrides
          // it with the server-resolved preset range.
          dateRange: { since: '2025-07-21', until: '2025-07-27' },
        }));
        const result = await getCampaignInsightsTool.execute(
          { metaCampaignId: 'c1', datePreset: 'this_week' },
          buildCtx({ apiFetch: apiFetch as never })
        );

        // "this week" is resolved from the real clock (Wed 29 Jul 2026 → Mon 27
        // Jul – Sun 2 Aug), never against the model's 2025 training prior.
        const [calledPath] = apiFetch.mock.calls[0] as [string];
        expect(calledPath).toContain('since=2026-07-27');
        expect(calledPath).toContain('until=2026-08-02');
        expect(result.ok).toBe(true);
        if (result.ok && result.data) {
          expect(result.data.dateRange).toEqual({
            since: '2026-07-27',
            until: '2026-08-02',
          });
        }
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('generateAdCopyTool', () => {
    /**
     * `POST /ai-content/generate` nests the copy under `content`. These mocks
     * used to assert the FLAT shape — which is why the "all-null copy with an
     * OK status" defect survived a green test suite: the fixture reproduced
     * the tool's misreading rather than the endpoint.
     */
    const generated = (content: Record<string, string>) => ({
      contentType: 'ad',
      content,
    });

    it('returns generated copy and the fixed BOOK_NOW callToAction', async () => {
      const apiFetch = jest.fn(async () =>
        generated({
          headline: 'Foundation creasing by lunchtime?',
          primaryText: 'A skin-smoothing facial. Just €49. Message us to book.',
        })
      );
      const result = await generateAdCopyTool.execute(
        { videoId: '11111111-1111-4111-8111-111111111111' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // Default CTA is the fixed BOOK_NOW button (the "Message us to book"
        // line lives in primaryText per the §8 locked structure).
        expect(result.data.callToAction).toBe('BOOK_NOW');
        expect(result.data.headline).toBe('Foundation creasing by lunchtime?');
        expect(result.data.error).toBeUndefined();
      }
    });

    it('never presents an empty generation as copy', async () => {
      // The measured production shape. `headline`/`primaryText` are not
      // nullable on the port's success member, so this can only come back as
      // an error — the model has nothing to relay as generated copy.
      const apiFetch = jest.fn(async () => generated({}));
      const result = await generateAdCopyTool.execute(
        { videoId: '11111111-1111-4111-8111-111111111111' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.headline).toBeUndefined();
        expect(result.data.primaryText).toBeUndefined();
        expect(result.data.error).toMatch(/empty/i);
      }
      // An empty envelope is not a content problem — no retries burnt.
      expect(apiFetch).toHaveBeenCalledTimes(1);
      // …and it is not a server fault either.
      expect(logWarning).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('hard-blocks "% off" copy: rejects, regenerates, returns compliant copy', async () => {
      // First generation includes a percentage discount → must be rejected and
      // regenerated, NOT returned with a soft warning. Second generation is
      // clean and is the one returned.
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(
          generated({
            headline: 'Dull skin?',
            primaryText:
              'Brightening facial. 20% off this week. Message us to book.',
          })
        )
        .mockResolvedValueOnce(
          generated({
            headline: 'Dull skin?',
            primaryText: 'Brightening facial. Just €49. Message us to book.',
          })
        );

      (validateGeneratedCopy as jest.Mock).mockImplementation(
        (payload: Record<string, string>) => {
          const text = Object.values(payload).join(' ');
          return /\d+\s*%/.test(text)
            ? [
                {
                  field: 'primaryText',
                  reason: 'percent_claim',
                  matched: '20%',
                },
              ]
            : [];
        }
      );

      const result = await generateAdCopyTool.execute(
        { videoId: '11111111-1111-4111-8111-111111111111' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      // It regenerated rather than returning the flagged copy.
      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.error).toBeUndefined();
        expect(result.data.primaryText).toBe(
          'Brightening facial. Just €49. Message us to book.'
        );
        // No soft validationWarnings field is surfaced anymore.
        expect(result.data).not.toHaveProperty('validationWarnings');
      }
    });

    it('returns a hard error (not bad copy) when copy stays non-compliant after retries', async () => {
      const apiFetch = jest.fn(async () =>
        generated({
          headline: 'Dull skin?',
          primaryText: 'Brightening facial. 20% off. Message us to book.',
        })
      );

      (validateGeneratedCopy as jest.Mock).mockImplementation(() => [
        { field: 'primaryText', reason: 'percent_claim', matched: '20%' },
      ]);

      const result = await generateAdCopyTool.execute(
        { videoId: '11111111-1111-4111-8111-111111111111' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      // Attempt 1 + 2 retries = 3 generation calls, then give up.
      expect(apiFetch).toHaveBeenCalledTimes(3);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // There is no copy field to be null: the union member that carries
        // this outcome cannot hold copy at all.
        expect(result.data.primaryText).toBeUndefined();
        expect(result.data.error).toMatch(
          /percentage discount|quantified|fabricated/i
        );
      }
      // A content-rule refusal is not a fault.
      expect(logWarning).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('does NOT report a 4xx, but does report a 5xx', async () => {
      const notFound = jest.fn(async () => {
        throw new ApiFetchError('Asset not found', 404);
      });
      await generateAdCopyTool.execute(
        { videoId: '11111111-1111-4111-8111-111111111111' },
        buildCtx({ apiFetch: notFound as never })
      );
      expect(logWarning).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();

      const boom = jest.fn(async () => {
        throw new ApiFetchError('Upstream exploded', 500);
      });
      const result = await generateAdCopyTool.execute(
        { videoId: '11111111-1111-4111-8111-111111111111' },
        buildCtx({ apiFetch: boom as never })
      );
      expect(logWarning).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.error).toBeTruthy();
      }
    });
  });

  describe('suggestAdOptimizationsTool', () => {
    it('short-circuits when Meta is not connected', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('Meta not connected');
      });
      const result = await suggestAdOptimizationsTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(typeof result.data.summary).toBe('string');
        expect(result.data.recommendations).toEqual([]);
      }
    });
  });

  describe('previewCampaignTool', () => {
    const integrationConfigured = {
      integration: {
        configurationStatus: 'configured',
        tokenStatus: 'valid',
        defaultPageId: 'page-1',
        pages: [
          {
            id: 'page-1',
            pageName: 'My Page',
            isActive: true,
            linkedInstagramAccountId: null,
            defaultAdAccountCurrency: 'EUR',
          },
        ],
      },
    };

    function mockApiFetch(opts: {
      hasWhatsApp?: boolean;
      address?: string;
    }) {
      return jest.fn(async (path: string) => {
        if (path === 'integrations/meta-ads/integration')
          return integrationConfigured;
        if (path === 'integrations/whatsapp/accounts')
          return { accounts: opts.hasWhatsApp ? [{ id: 'wa-1' }] : [] };
        if (path === 'assistant/context')
          return { name: 'Test Clinic', address: opts.address ?? null };
        throw new Error(`Unexpected path: ${path}`);
      });
    }

    it('renders a Campaign-preview card with WhatsApp when WhatsApp is connected (chatbot path)', async () => {
      const apiFetch = mockApiFetch({
        hasWhatsApp: true,
        address: 'Dublin',
      });
      const result = await previewCampaignTool.execute(
        { requestedFollowUpType: 'chatbot' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // Card shape — keyed off by the frontend's generic dispatch, so the
        // card persists across page refreshes.
        expect(result.data.uiState).toBe('created');
        expect(result.data.variant).toBe('preview');
        expect(result.data.title).toBe('Campaign preview');
        expect(result.data.actions).toEqual([]);
        const fields = result.data.fields ?? [];
        expect(fields.find((f) => f.label === 'Daily budget')?.value).toBe(
          '€10.00/day' // from org-defaults mock
        );
        expect(
          fields.find((f) => f.label === 'How leads reach you')?.value
        ).toBe('Messaging via WhatsApp');
        // Targeting line is anchored on the primary location (from the
        // getPrimaryLocation mock), not the org-level address field.
        expect(fields.find((f) => f.label === 'Targeting')?.value).toBe(
          'Within 25km of Pelham Street, Stoke on Trent'
        );
        expect(fields.find((f) => f.label === 'Age range')?.value).toBe(
          '18–65'
        );
        // Structured fields below the card are what the LLM reads when it
        // decides what to pass to createCampaign on turn 2.
        expect(result.data.ready).toBe(true);
        expect(result.data.followUpType).toBe('chatbot');
        expect(result.data.destinations).toEqual(['whatsapp']);
      }
    });

    it('falls back to Messenger when WhatsApp is not connected (chatbot path)', async () => {
      const apiFetch = mockApiFetch({ hasWhatsApp: false });
      const result = await previewCampaignTool.execute(
        { requestedFollowUpType: 'chatbot' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.destinations).toEqual(['messenger']);
        const fields = result.data.fields ?? [];
        expect(
          fields.find((f) => f.label === 'How leads reach you')?.value
        ).toBe('Messaging via Messenger');
      }
    });

    it("renders a Can't-preview card when Meta is not connected", async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'integrations/meta-ads/integration')
          return { integration: null };
        throw new Error(`Unexpected: ${path}`);
      });
      const result = await previewCampaignTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.uiState).toBe('created');
        expect(result.data.variant).toBe('preview');
        expect(result.data.title).toBe("Can't preview a campaign yet");
        expect(result.data.ready).toBe(false);
        expect(result.data.reason).toContain("isn't connected");
        // The blocker is also a field so it renders on the card after a
        // refresh, not just in the tool output the LLM consumes.
        expect(
          (result.data.fields ?? []).find((f) => f.label === 'Reason')?.value
        ).toContain("isn't connected");
      }
    });

    it('defaults to a lead form when the org has a privacy-policy URL', async () => {
      // getOrganization mock returns a privacy URL by default → lead_form.
      const apiFetch = mockApiFetch({ hasWhatsApp: true });
      const result = await previewCampaignTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.followUpType).toBe('lead_form');
        expect(result.data.canRunLeadForm).toBe(true);
        expect(result.data.destinations).toEqual([]);
      }
    });

    it('lead form → WhatsApp follow-up for a UK org with WhatsApp connected', async () => {
      // getPrimaryLocation mock returns country 'gb'; WhatsApp connected.
      const apiFetch = mockApiFetch({ hasWhatsApp: true });
      const result = await previewCampaignTool.execute(
        { requestedFollowUpType: 'lead_form' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.followUpType).toBe('lead_form');
        expect(result.data.nurtureChannel).toBe('whatsapp');
        expect(result.data.nurtureChannelFlagged).toBe(false);
        expect(
          (result.data.fields ?? []).find(
            (f) => f.label === 'How leads reach you'
          )?.value
        ).toBe('Lead form → WhatsApp follow-up');
      }
    });

    it('lead form → Messenger (flagged) for a UK org with no WhatsApp', async () => {
      const apiFetch = mockApiFetch({ hasWhatsApp: false });
      const result = await previewCampaignTool.execute(
        { requestedFollowUpType: 'lead_form' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.nurtureChannel).toBe('messenger');
        expect(result.data.nurtureChannelFlagged).toBe(true);
        expect(result.data.nurtureChannelReason).toMatch(/WhatsApp/);
        expect(
          (result.data.fields ?? []).find(
            (f) => f.label === 'How leads reach you'
          )?.value
        ).toBe('Lead form → Messenger follow-up');
      }
    });

    it('lead form → Messenger for a US org even with WhatsApp connected', async () => {
      // Override the country to US for this run (the nurture lookup is the
      // first getPrimaryLocation call; the targeting lookup falls back to gb).
      (getPrimaryLocation as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'loc_us',
          label: 'Main St, Austin',
          city: 'Austin',
          country: 'us',
          latitude: 30,
          longitude: -97,
        },
      });
      const apiFetch = mockApiFetch({ hasWhatsApp: true });
      const result = await previewCampaignTool.execute(
        { requestedFollowUpType: 'lead_form' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.nurtureChannel).toBe('messenger');
        expect(result.data.nurtureChannelFlagged).toBe(false);
      }
    });

    it('falls back to chatbot + leadFormBlockedReason when the org has no privacy URL', async () => {
      (resolveOrgPrivacyPolicyUrl as jest.Mock).mockResolvedValueOnce(null);
      const apiFetch = mockApiFetch({ hasWhatsApp: true });
      const result = await previewCampaignTool.execute(
        { requestedFollowUpType: 'lead_form' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.canRunLeadForm).toBe(false);
        expect(result.data.leadFormBlockedReason).toMatch(/privacy-policy/);
      }
    });
  });

  describe('createCampaignTool', () => {
    const integrationConfigured = {
      integration: {
        configurationStatus: 'configured',
        tokenStatus: 'valid',
        defaultPageId: 'page-1',
        pages: [
          {
            id: 'page-1',
            pageName: 'My Page',
            isActive: true,
            linkedInstagramAccountId: null,
            defaultAdAccountCurrency: 'EUR',
          },
        ],
      },
    };

    function mockApiFetch(
      campaignResponse: Record<string, unknown>,
      opts: { hasWhatsApp?: boolean } = {}
    ) {
      return jest.fn(async (path: string) => {
        if (path === 'integrations/meta-ads/integration')
          return integrationConfigured;
        if (path === 'integrations/whatsapp/accounts')
          return {
            accounts: opts.hasWhatsApp ? [{ id: 'wa-1' }] : [],
          };
        if (path === 'meta-campaigns') return campaignResponse;
        throw new Error(`Unexpected path: ${path}`);
      });
    }

    it('defaults to messaging via WhatsApp when WhatsApp is connected', async () => {
      // The org-defaults mock at the top of the file returns
      // adDailyBudgetCents: 1000 (€10), so when the user omits a budget the
      // tool falls through to that org default. The static €15 fallback only
      // kicks in when the org has no default set.
      //
      // The Meta API response is intentionally sparse — only the IDs come
      // back from the create-campaign service. The Created card draws its
      // fields from the input we just sent (name, budget, destinations) and
      // hardcodes the status to "paused" since the service always creates
      // PAUSED. Earlier versions of this tool tried to read name/status/
      // dailyBudget from the response and crashed in production because the
      // service doesn't echo them.
      const apiFetch = mockApiFetch(
        {
          metaCampaignId: 'mc-1',
          metaAdSetId: 'as-1',
          followUpType: 'chatbot',
          conversionDestination: 'whatsapp',
        },
        { hasWhatsApp: true }
      );
      const result = await createCampaignTool.execute(
        { name: 'Botox — September' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const postCall = apiFetch.mock.calls.find(
        (c) => c[0] === 'meta-campaigns'
      );
      expect(postCall).toBeDefined();
      const body = (postCall as [string, { body: Record<string, unknown> }])[1]
        .body;
      expect(body).toMatchObject({
        name: 'Botox — September',
        objective: 'OUTCOME_ENGAGEMENT',
        followUpType: 'chatbot',
        destinations: ['whatsapp'],
        conversionDestination: 'whatsapp',
        dailyBudget: 1000,
        metaAdsPageId: 'page-1',
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data && result.data.uiState === 'created') {
        expect(result.data.campaignId).toBe('mc-1');
        expect(
          result.data.fields?.find((f) => f.label === 'Status')?.value
        ).toBe('Paused — no spend yet');
        expect(
          result.data.fields?.find((f) => f.label === 'How leads reach you')
            ?.value
        ).toBe('WhatsApp');
      }
    });

    it('treats a needs-reconnect WhatsApp account as NOT connected → Messenger', async () => {
      const apiFetch = jest.fn(
        async (path: string, opts?: { body?: Record<string, unknown> }) => {
          if (path === 'integrations/meta-ads/integration')
            return integrationConfigured;
          if (path === 'integrations/whatsapp/accounts')
            return {
              // Account exists but its token needs reconnecting → unusable.
              accounts: [
                { id: 'wa-1', isActive: true, tokenStatus: 'needs_reconnect' },
              ],
            };
          if (path === 'meta-campaigns') {
            const dests = opts?.body?.destinations as string[] | undefined;
            expect(dests).toEqual(['messenger']);
            return {
              metaCampaignId: 'mc-msgr',
              metaAdSetId: 'as-msgr',
              followUpType: 'chatbot',
              conversionDestination: 'messenger',
            };
          }
          throw new Error(`Unexpected path: ${path}`);
        }
      );

      const result = await createCampaignTool.execute(
        { name: 'Body Contouring' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data && result.data.uiState === 'created') {
        expect(
          result.data.fields?.find((f) => f.label === 'How leads reach you')
            ?.value
        ).toBe('Messenger');
      }
    });

    it('auto-falls back to Messenger when the WhatsApp ad set is rejected (Page not linked)', async () => {
      let campaignPostCount = 0;
      const apiFetch = jest.fn(
        async (path: string, opts?: { body?: Record<string, unknown> }) => {
          if (path === 'integrations/meta-ads/integration')
            return integrationConfigured;
          if (path === 'integrations/whatsapp/accounts')
            return { accounts: [{ id: 'wa-1' }] };
          if (path === 'meta-campaigns') {
            campaignPostCount += 1;
            const dests = opts?.body?.destinations as string[] | undefined;
            if (dests?.includes('whatsapp')) {
              throw new Error(
                'Your Facebook Page is not linked to a WhatsApp Business Account.'
              );
            }
            return {
              metaCampaignId: 'mc-fb',
              metaAdSetId: 'as-fb',
              followUpType: 'chatbot',
              conversionDestination: 'messenger',
            };
          }
          throw new Error(`Unexpected path: ${path}`);
        }
      );

      const result = await createCampaignTool.execute(
        { name: 'Body Contouring — July' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      // First POST defaults to WhatsApp (rejected) → retry with Messenger.
      expect(campaignPostCount).toBe(2);
      expect(result.ok).toBe(true);
      if (result.ok && result.data && result.data.uiState === 'created') {
        expect(result.data.campaignId).toBe('mc-fb');
        expect(result.data.whatsappFallbackNote).toMatch(
          /whatsapp isn't linked/i
        );
        expect(
          result.data.fields?.find((f) => f.label === 'How leads reach you')
            ?.value
        ).toBe('Messenger');
      }
    });

    it('falls back to Messenger when no WhatsApp account is connected', async () => {
      const apiFetch = mockApiFetch(
        {
          metaCampaignId: 'mc-2',
          metaAdSetId: 'as-2',
          followUpType: 'chatbot',
          conversionDestination: 'messenger',
        },
        { hasWhatsApp: false }
      );
      const result = await createCampaignTool.execute(
        { name: 'Lip Filler' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const postCall = apiFetch.mock.calls.find(
        (c) => c[0] === 'meta-campaigns'
      );
      const body = (postCall as [string, { body: Record<string, unknown> }])[1]
        .body;
      expect(body).toMatchObject({
        followUpType: 'chatbot',
        destinations: ['messenger'],
        conversionDestination: 'messenger',
      });
      expect(result.ok).toBe(true);
    });

    it('uses lead_form objective and omits destinations when the user asks for a form', async () => {
      const apiFetch = mockApiFetch(
        {
          metaCampaignId: 'mc-3',
          metaAdSetId: 'as-3',
          followUpType: 'lead_form',
        },
        { hasWhatsApp: true } // still has WhatsApp, but lead_form overrides
      );
      const result = await createCampaignTool.execute(
        {
          name: 'Consult Sign-Ups',
          dailyBudgetAmount: 20,
          followUpType: 'lead_form',
          leadFormId: '550e8400-e29b-41d4-a716-446655440000',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const postCall = apiFetch.mock.calls.find(
        (c) => c[0] === 'meta-campaigns'
      );
      const body = (postCall as [string, { body: Record<string, unknown> }])[1]
        .body;
      expect(body).toMatchObject({
        objective: 'OUTCOME_LEADS',
        followUpType: 'lead_form',
        leadFormId: '550e8400-e29b-41d4-a716-446655440000',
        dailyBudget: 2000,
      });
      expect(body.destinations).toBeUndefined();
      expect(body.conversionDestination).toBeUndefined();
      expect(result.ok).toBe(true);
    });

    it('returns a soft error when Meta is not connected', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'integrations/meta-ads/integration')
          return { integration: null };
        throw new Error(`Unexpected path: ${path}`);
      });
      const result = await createCampaignTool.execute(
        { name: 'Botox' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.uiState).toBe('error');
        expect(result.data.error).toContain("isn't connected");
      }
    });

    it('is non-destructive (paused campaign = no spend = no confirmation flow)', () => {
      expect(createCampaignTool.destructive).toBe(false);
      expect(createCampaignTool.destructiveAction).toBeUndefined();
    });

    // ── Geo-targeting ────────────────────────────────────────────────────
    // Two incidents shaped this. An ad ran targeted at Null Island off West
    // Africa because the tool forwarded model-supplied coordinates (register
    // #82); and US/UK clinics' spend went to Ireland because a country
    // fallback was hardcoded to ['IE'] (2026-07 mistarget blast — Miso Life,
    // Chase Health, Skin from Brazil).
    //
    // Both inputs are now gone from this layer: the campaign's area is the
    // business's saved, geocoded branch, resolved by the API in
    // `resolveCampaignLocation` (which owns the refusal, and is tested where it
    // lives). What this tool still owes is that it cannot express an area at
    // all, and that a refusal is surfaced rather than papered over.
    describe('geo-targeting', () => {
      // Pull the targeting object the tool actually POSTs to /meta-campaigns.
      function targetingSentBy(apiFetch: jest.Mock): Record<string, unknown> {
        const postCall = apiFetch.mock.calls.find(
          (c) => c[0] === 'meta-campaigns'
        );
        expect(postCall).toBeDefined();
        const body = (
          postCall as [string, { body: Record<string, unknown> }]
        )[1].body;
        return body.targeting as Record<string, unknown>;
      }

      const created = {
        metaCampaignId: 'mc-geo',
        metaAdSetId: 'as-geo',
        followUpType: 'lead_form',
      };

      it('sends radius knobs only — no place, no coordinates, no country', async () => {
        const apiFetch = mockApiFetch(created);
        await createCampaignTool.execute(
          { name: 'Geocoded Clinic' },
          buildCtx({ apiFetch: apiFetch as never })
        );
        const targeting = targetingSentBy(apiFetch);
        expect(targeting.distanceKm).toBeDefined();
        expect(targeting.latitude).toBeUndefined();
        expect(targeting.longitude).toBeUndefined();
        expect(targeting.location).toBeUndefined();
        // The country fallback is what mistargeted three orgs. It is not this
        // layer's to make, so nothing here may put one on the wire.
        expect(targeting.countries).toBeUndefined();
      });

      it('cannot smuggle coordinates through — the schema drops them', async () => {
        const apiFetch = mockApiFetch(created);
        await createCampaignTool.execute(
          {
            name: 'Explicit Coords',
            targeting: {
              latitude: 40.7128,
              longitude: -74.006,
              location: 'New York',
            },
          } as never,
          buildCtx({ apiFetch: apiFetch as never })
        );
        const targeting = targetingSentBy(apiFetch);
        expect(targeting.latitude).toBeUndefined();
        expect(targeting.longitude).toBeUndefined();
        expect(targeting.location).toBeUndefined();
      });

      it("passes the owner's radius through and leaves the area to the API", async () => {
        const apiFetch = mockApiFetch(created);
        await createCampaignTool.execute(
          { name: 'Wide Net', targeting: { distanceKm: 60 } },
          buildCtx({ apiFetch: apiFetch as never })
        );
        expect(targetingSentBy(apiFetch).distanceKm).toBe(60);
      });

      it('surfaces the API refusal when the branch cannot be placed', async () => {
        // `resolveCampaignLocation` refuses rather than guessing a country.
        // The tool must show that, not a Created card for a campaign Meta
        // never got.
        const apiFetch = jest.fn(async (path: string) => {
          if (path === 'integrations/meta-ads/integration')
            return integrationConfigured;
          if (path === 'integrations/whatsapp/accounts')
            return { accounts: [] };
          if (path === 'meta-campaigns')
            throw new Error(
              'We could not place "Austin, TX" on the map, so we cannot target ads around it.'
            );
          throw new Error(`Unexpected path: ${path}`);
        });
        const result = await createCampaignTool.execute(
          { name: 'Un-geocoded Clinic' },
          buildCtx({ apiFetch: apiFetch as never })
        );
        expect(result.ok).toBe(true);
        if (result.ok && result.data) {
          expect(result.data.uiState).toBe('error');
          expect(result.data.error).toMatch(/could not place/i);
        }
      });

      it('names the branch the API actually targeted on the card', async () => {
        const apiFetch = mockApiFetch({
          ...created,
          location: { id: 'loc-1', label: 'Pelham Street, Stoke on Trent' },
        });
        const result = await createCampaignTool.execute(
          { name: 'Branch Named', targeting: { distanceKm: 30 } },
          buildCtx({ apiFetch: apiFetch as never })
        );
        expect(result.ok).toBe(true);
        if (result.ok && result.data) {
          expect(JSON.stringify(result.data)).toContain(
            'Within 30km of Pelham Street, Stoke on Trent'
          );
        }
      });
    });
  });

  describe('createDraftAdTool — single-ask launch token', () => {
    const draftInput = {
      metaCampaignId: 'mc-1',
      videoId: '11111111-1111-4111-8111-111111111111',
      name: 'Q1 Lip Filler',
      headline: 'Book your consult',
      targeting: { countries: ['IE'] },
      serviceIds: ['22222222-2222-4222-8222-222222222222'],
    };
    const draftResponse = {
      id: 'ad-1',
      name: 'Q1 Lip Filler',
      status: 'draft',
      metaCampaignId: 'mc-1',
    };

    it('mints a launch_ad confirmation bound to the ad and returns the token', async () => {
      const createConfirmation = jest.fn(async () => ({
        id: 'tok-1',
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      }));
      const result = await createDraftAdTool.execute(
        draftInput,
        buildCtx({
          apiFetch: jest.fn(async () => draftResponse) as never,
          createConfirmation: createConfirmation as never,
        })
      );

      expect(createConfirmation).toHaveBeenCalledTimes(1);
      const arg = createConfirmation.mock.calls[0][0] as unknown as {
        action: string;
        resourceId: string;
        payload: Record<string, unknown>;
      };
      expect(arg.action).toBe('launch_ad');
      expect(arg.resourceId).toBe('ad-1');
      // Bound to the same field names executeLaunchAd sends, so the factory's
      // payload binding rejects a launch whose copy drifted from the card.
      expect(arg.payload.adId).toBe('ad-1');
      expect(arg.payload.headline).toBe('Book your consult');

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.confirmationToken).toBe('tok-1');
        expect(result.data.expiresAt).toBe('2026-01-01T00:00:00.000Z');
      }
    });

    it('runs the launch hard-blocks first and mints NO token when one fires', async () => {
      const createConfirmation = jest.fn();
      const result = await createDraftAdTool.execute(
        draftInput,
        buildCtx({
          apiFetch: jest.fn(async () => draftResponse) as never,
          createConfirmation: createConfirmation as never,
          // Fail only the LAUNCH copy blocks — the service-grounding block
          // (noHallucinatedService, run before the API call) must pass so the
          // draft is still created; this test asserts the draft survives a
          // launch-block failure while the token is withheld.
          runHardBlocks: jest.fn(async (names: readonly string[]) =>
            names.includes('noHallucinatedService')
              ? { pass: true }
              : {
                  pass: false,
                  code: 'noFabricatedResultClaims',
                  message: 'Fabricated claim',
                }
          ) as never,
        })
      );

      // A token here would launch copy the blocks should have stopped:
      // executeLaunchAd skips hard-blocks whenever a token is present.
      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.adId).toBe('ad-1');
        expect(result.data.confirmationToken).toBeUndefined();
      }
    });

    it('still returns the draft when minting throws (falls back to confirmLaunchAd)', async () => {
      const result = await createDraftAdTool.execute(
        draftInput,
        buildCtx({
          apiFetch: jest.fn(async () => draftResponse) as never,
          createConfirmation: jest.fn(async () => {
            throw new Error('db down');
          }) as never,
        })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.adId).toBe('ad-1');
        expect(result.data.confirmationToken).toBeUndefined();
      }
    });

    it('refuses a hallucinated service: no API call, no draft, no token', async () => {
      // The service-grounding block (noHallucinatedService) fires BEFORE the
      // meta-ads POST, so an ad for a service the org doesn't offer is never
      // created — closing the "launched the fake draft" path at its source.
      const apiFetch = jest.fn(async () => draftResponse);
      const createConfirmation = jest.fn();
      const result = await createDraftAdTool.execute(
        draftInput,
        buildCtx({
          apiFetch: apiFetch as never,
          createConfirmation: createConfirmation as never,
          runHardBlocks: jest.fn(async (names: readonly string[]) =>
            names.includes('noHallucinatedService')
              ? {
                  pass: false,
                  code: 'noHallucinatedService',
                  message: 'Service "svc-fake" is not in the catalogue.',
                }
              : { pass: true }
          ) as never,
        })
      );

      expect(apiFetch).not.toHaveBeenCalled();
      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.adId).toBeUndefined();
        expect(result.data.confirmationToken).toBeUndefined();
        expect(result.data.error).toContain('svc-fake');
      }
    });
  });

  describe('createDraftAdTool', () => {
    it('POSTs to meta-ads with the input as the body', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'ad-1',
        name: 'Q1 Lip Filler',
        status: 'draft',
        metaCampaignId: 'mc-1',
      }));
      const result = await createDraftAdTool.execute(
        {
          metaCampaignId: 'mc-1',
          videoId: '11111111-1111-4111-8111-111111111111',
          name: 'Q1 Lip Filler',
          targeting: { countries: ['IE'] },
          serviceIds: ['22222222-2222-4222-8222-222222222222'],
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      // The create POST is the FIRST call; a best-effort campaign-budget
      // lookup (for the server-derived budget display) follows it.
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: unknown },
      ];
      expect(calledPath).toBe('meta-ads');
      expect(calledOpts.method).toBe('POST');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.adId).toBe('ad-1');
      }
    });

    it('returns a rich preview payload with caption / headline / campaign for the AdPreviewCard', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'ad-1',
        name: 'Laser Hair Removal — Educational',
        status: 'draft',
        metaCampaignId: 'mc-1',
      }));
      const result = await createDraftAdTool.execute(
        {
          metaCampaignId: 'mc-1',
          videoId: '11111111-1111-4111-8111-111111111111',
          name: 'Laser Hair Removal — Educational',
          headline: 'Smooth Skin Starts Here',
          primaryText:
            'Tired of razors and waxing? Our advanced laser hair removal delivers long-lasting results in a professional, welcoming environment. Book your consultation today.',
          callToAction: 'BOOK_NOW',
          destinationUrl: 'https://example.com/book',
          targeting: { latitude: 53.3498, longitude: -6.2603, distanceKm: 25 },
          serviceIds: ['22222222-2222-4222-8222-222222222222'],
          campaignName: 'Laser Hair Removal — July 2025',
          videoTitle: 'Laser Hair Removal — Educational',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      // Display-only fields must not leak into the POST body. The POST is the
      // FIRST apiFetch call; the (best-effort) campaign-budget lookup follows.
      const [, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { body?: Record<string, unknown> },
      ];
      expect(calledOpts.body).not.toHaveProperty('campaignName');
      expect(calledOpts.body).not.toHaveProperty('budgetDisplay');
      expect(calledOpts.body).not.toHaveProperty('targetingDisplay');
      expect(calledOpts.body).not.toHaveProperty('videoTitle');
      // Rich preview is populated. budgetDisplay/targetingDisplay are both
      // derived SERVER-SIDE (register #82). The area is no longer something a
      // caller can set — `resolveAdTargeting` reads the saved branch — so the
      // summary names that branch rather than echoing coordinates back.
      expect(result.data.preview).toMatchObject({
        variant: 'draft',
        adName: 'Laser Hair Removal — Educational',
        headline: 'Smooth Skin Starts Here',
        callToAction: 'BOOK_NOW',
        campaignName: 'Laser Hair Removal — July 2025',
        videoTitle: 'Laser Hair Removal — Educational',
        videoId: '11111111-1111-4111-8111-111111111111',
        targetingDisplay:
          'Within 25km of Pelham Street, Stoke on Trent (from your saved business address)',
        destinationUrl: 'https://example.com/book',
      });
      // CreatedCard fields use the human-readable campaign name, not the
      // raw Meta campaign id — that was the original UX bug.
      const fieldsByLabel = Object.fromEntries(
        (result.data.fields ?? []).map((f) => [f.label, f.value])
      );
      expect(fieldsByLabel.Campaign).toBe('Laser Hair Removal — July 2025');
      expect(fieldsByLabel.Headline).toBe('Smooth Skin Starts Here');
      expect(fieldsByLabel.Caption).toContain('Tired of razors');
      expect(fieldsByLabel.Targeting).toBe(
        'Within 25km of Pelham Street, Stoke on Trent (from your saved business address)'
      );
    });

    it('rejects near-(0,0) coordinates and falls back to the org geocode (register #82)', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'ad-1',
        name: 'Ad',
        status: 'draft',
        metaCampaignId: 'mc-1',
      }));
      const result = await createDraftAdTool.execute(
        {
          metaCampaignId: 'mc-1',
          videoId: '11111111-1111-4111-8111-111111111111',
          name: 'Ad',
          // Null-Island coords — the exact #82 bug.
          targeting: { latitude: 0, longitude: 0, distanceKm: 25 },
          serviceIds: ['22222222-2222-4222-8222-222222222222'],
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      // Invalid coords dropped; org primary location (Stoke on Trent, mocked)
      // used instead — never sent (0,0) to Meta.
      const body = (
        apiFetch.mock.calls[0] as [
          string,
          { body?: { targeting?: { latitude?: number; longitude?: number } } },
        ]
      )[1].body;
      expect(body?.targeting?.latitude).toBeCloseTo(53.0201, 2);
      expect(body?.targeting?.longitude).toBeCloseTo(-2.1695, 2);
      expect(result.data.preview?.targetingDisplay).toContain('Stoke on Trent');
    });

    it('derives the daily budget display SERVER-SIDE from the campaign, never from model input (register #82)', async () => {
      // Path-aware stub: the create POST returns the parent campaign id; the
      // campaign list carries Meta's raw minor-unit dailyBudget ("2500" =
      // 25.00). The campaign has no stored currency, so the symbol comes from
      // the org's country — the fixture org is in `gb` → £, NOT a blanket €.
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'meta-campaigns') {
          return {
            campaigns: [
              {
                id: 'mc-1',
                name: 'Campaign',
                status: 'PAUSED',
                effectiveStatus: 'PAUSED',
                objective: 'OUTCOME_ENGAGEMENT',
                dailyBudget: '2500',
                adCount: 0,
                previewImageUrl: null,
              },
            ],
          };
        }
        return {
          id: 'ad-1',
          name: 'Ad',
          status: 'draft',
          metaCampaignId: 'mc-1',
        };
      });
      const result = await createDraftAdTool.execute(
        {
          metaCampaignId: 'mc-1',
          videoId: '11111111-1111-4111-8111-111111111111',
          name: 'Ad',
          targeting: { latitude: 53.3, longitude: -6.2, distanceKm: 25 },
          serviceIds: ['22222222-2222-4222-8222-222222222222'],
          campaignName: 'Campaign',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      expect(result.data.preview?.budgetDisplay).toBe('£25.00/day');
      const fieldsByLabel = Object.fromEntries(
        (result.data.fields ?? []).map((f) => [f.label, f.value])
      );
      expect(fieldsByLabel['Daily budget']).toBe('£25.00/day');
    });

    // The campaign's own ad-account currency is the authoritative signal and
    // must beat the org-country fallback: a GB-registered org can run a
    // campaign on a USD ad account, and "£25.00/day" over $25/day is the same
    // class of defect as #82 — a true number wearing the wrong symbol.
    it('uses the CAMPAIGN ad-account currency over the org country when one is stored', async () => {
      (getCampaignCurrency as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: {
          metaCampaignId: 'mc-1',
          organizationId: 'org-1',
          currencyCode: 'USD',
          currencySymbol: '$',
          source: 'campaign',
        },
      });
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'meta-campaigns') {
          return {
            campaigns: [
              {
                id: 'mc-1',
                name: 'Campaign',
                status: 'PAUSED',
                effectiveStatus: 'PAUSED',
                objective: 'OUTCOME_ENGAGEMENT',
                dailyBudget: '2500',
                adCount: 0,
                previewImageUrl: null,
              },
            ],
          };
        }
        return {
          id: 'ad-1',
          name: 'Ad',
          status: 'draft',
          metaCampaignId: 'mc-1',
        };
      });
      const result = await createDraftAdTool.execute(
        {
          metaCampaignId: 'mc-1',
          videoId: '11111111-1111-4111-8111-111111111111',
          name: 'Ad',
          targeting: { latitude: 53.3, longitude: -6.2, distanceKm: 25 },
          serviceIds: ['22222222-2222-4222-8222-222222222222'],
          campaignName: 'Campaign',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      expect(result.data.preview?.budgetDisplay).toBe('$25.00/day');
    });

    it('passes replaceCampaignDrafts through to the POST body so a rebuild replaces prior drafts', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'ad-1',
        name: 'Rebuilt ad',
        status: 'draft',
        metaCampaignId: 'mc-1',
      }));
      await createDraftAdTool.execute(
        {
          metaCampaignId: 'mc-1',
          videoId: '11111111-1111-4111-8111-111111111111',
          name: 'Rebuilt ad',
          targeting: { countries: ['IE'] },
          serviceIds: ['22222222-2222-4222-8222-222222222222'],
          replaceCampaignDrafts: true,
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const [, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { body?: Record<string, unknown> },
      ];
      expect(calledOpts.body).toMatchObject({ replaceCampaignDrafts: true });
    });

    it('folds a library assetId into the videoId slot and renders a direct image preview', async () => {
      // The tool resolves the asset (for a direct preview) and POSTs the draft.
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('assets/')) {
          return {
            id: 'asset-9',
            type: 'image',
            blobUrl: 'https://cdn.example.com/endosphere.jpg',
            thumbnailUrl: 'https://cdn.example.com/endosphere-thumb.jpg',
          };
        }
        return {
          id: 'ad-1',
          name: 'Endosphere ad',
          status: 'draft',
          metaCampaignId: 'mc-1',
        };
      });
      const result = await createDraftAdTool.execute(
        {
          metaCampaignId: 'mc-1',
          assetId: 'asset-9',
          name: 'Endosphere ad',
          targeting: { countries: ['IE'] },
          serviceIds: ['22222222-2222-4222-8222-222222222222'],
        },
        buildCtx({ apiFetch: apiFetch as never })
      );

      // The asset was resolved for the preview.
      expect(apiFetch).toHaveBeenCalledWith(
        'assets/asset-9',
        expect.objectContaining({ schema: expect.anything() })
      );
      // The POST body carries the asset id in the videoId slot (the meta-ads
      // API has no assetId field) and never leaks a raw assetId.
      const postCall = apiFetch.mock.calls.find(
        (c) => (c as unknown[])[0] === 'meta-ads'
      ) as [string, { body?: Record<string, unknown> }];
      expect(postCall).toBeTruthy();
      expect(postCall[1].body).toMatchObject({ videoId: 'asset-9' });
      expect(postCall[1].body).not.toHaveProperty('assetId');
      // The preview renders the image directly (no videoId to poll).
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.preview?.assetImageUrl).toBe(
          'https://cdn.example.com/endosphere.jpg'
        );
        expect(result.data.preview?.videoId).toBeUndefined();
      }
    });

    it('rejects two creatives (assetId + graphicId)', async () => {
      const apiFetch = jest.fn();
      const result = await createDraftAdTool.execute(
        {
          metaCampaignId: 'mc-1',
          assetId: 'asset-9',
          graphicId: 'graphic-1',
          name: 'Conflicting creative',
          targeting: {},
          serviceIds: ['22222222-2222-4222-8222-222222222222'],
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  describe('updateAdTool', () => {
    const row = {
      id: 'ad-9',
      name: 'Lip filler — March',
      status: 'draft',
      // No `metaAdId`: this ad has never been published. That — not the
      // status string — is what makes it a draft. (ENG-631)
      metaAdId: null,
      headline: 'New headline',
      primaryText: null,
      description: null,
      callToAction: 'BOOK_NOW',
      destinationUrl: null,
      videoId: null,
      graphicId: null,
    };

    it('PUTs the changed fields to meta-ads/:id (in-place edit, no new row)', async () => {
      const apiFetch = jest.fn(async () => row);
      const result = await updateAdTool.execute(
        {
          adId: 'ad-9',
          headline: 'New headline',
          callToAction: 'BOOK_NOW',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledTimes(1);
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('meta-ads/ad-9');
      expect(calledOpts.method).toBe('PUT');
      // The ad id is the path param, not part of the body.
      expect(calledOpts.body).not.toHaveProperty('adId');
      expect(calledOpts.body).toMatchObject({
        headline: 'New headline',
        callToAction: 'BOOK_NOW',
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.adId).toBe('ad-9');
        expect(result.data.uiState).toBe('updated');
        // Named from the RESPONSE, not the request.
        expect(result.data.updated).toEqual(['headline', 'callToAction']);
        expect(result.data.unchanged).toBeUndefined();
        // `preview` is the shape apps/app renders for this tool.
        expect(result.data.preview?.headline).toBe('New headline');
      }
    });

    it('says so when the response does not carry a requested change', async () => {
      const apiFetch = jest.fn(async () => ({
        ...row,
        primaryText: 'the old caption',
      }));
      const result = await updateAdTool.execute(
        {
          adId: 'ad-9',
          headline: 'New headline',
          primaryText: 'a brand new caption',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.updated).toEqual(['headline']);
        expect(result.data.unchanged).toEqual(['primaryText']);
        expect(result.data.message).toMatch(/did not change/i);
        // The card never quotes the rejected value back as though it landed.
        expect(JSON.stringify(result.data)).not.toContain(
          'a brand new caption'
        );
      }
    });

    it('reports both halves when the local save lands but the Meta sync does not', async () => {
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError(
          'Cannot update creative fields on an ad created from an existing post. Only the ad name can be changed.',
          422
        );
      });
      const result = await updateAdTool.execute(
        { adId: 'ad-9', headline: 'x' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.error).toMatch(/saved/i);
        expect(result.data.error).toMatch(/NOT updated/);
      }
      expect(logWarning).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('surfaces a sanitized error when the update fails', async () => {
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError('Ad not found', 404);
      });
      const result = await updateAdTool.execute(
        { adId: 'missing', headline: 'x' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.error).toBeTruthy();
        expect(result.data.uiState).toBeUndefined();
      }
      // A 404 is a stated refusal, not a fault (API-9G / ENG-402).
      expect(logWarning).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('has no targeting parameter to silently drop', async () => {
      // `targetingOverride` persisted to the ad row and reached nothing that
      // talks to Meta — accepted, acknowledged, and inert. The schema no longer
      // offers it, so the model cannot ask for it and be told yes.
      const schema = updateAdTool.toAnthropicDefinition().input_schema as {
        properties?: Record<string, unknown>;
      };
      expect(Object.keys(schema.properties ?? {})).not.toContain(
        'targetingOverride'
      );
      expect(updateAdTool.description).toMatch(/CANNOT change targeting/i);
    });

    // ENG-631. The service edits LIVE ads too — it mints a new creative and
    // swaps it onto the running ad — but every string here said "draft", so
    // Claire signed a live-ad edit off with "nothing is live until you launch
    // it" while the ad was delivering and spending.
    it('reports a live ad as live, not as a draft', async () => {
      const liveRow = {
        ...row,
        status: 'active',
        metaAdId: '120246528563240037',
        headline: 'Edited live',
      };
      const apiFetch = jest.fn(async () => liveRow);
      const result = await updateAdTool.execute(
        { adId: 'ad-9', headline: 'Edited live' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      expect(result.data.live).toBe(true);
      expect(result.data.title).toBe('Updated live ad: Lip filler — March');
      expect(result.data.title).not.toMatch(/draft/i);
      // Must match AdPreviewProps in the chat card: an unmodelled variant
      // falls through `variant === 'launched'` and draws a live ad as a draft.
      expect(result.data.preview?.variant).toBe('launched');
      // Without this the card reuses the LAUNCH fallback ("Submitted to
      // Meta"), which describes a launch that never happened on an ad that
      // was already delivering.
      expect(result.data.preview?.context).toBe('edit');
      // The owner has to hear that Meta re-reviews an edited ad.
      expect(result.data.message).toMatch(/re-review/i);
    });

    it('still calls an unpublished ad a draft', async () => {
      const apiFetch = jest.fn(async () => row);
      const result = await updateAdTool.execute(
        { adId: 'ad-9', headline: 'New headline' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      expect(result.data.live).toBe(false);
      expect(result.data.title).toBe('Updated draft ad: Lip filler — March');
      expect(result.data.preview?.variant).toBe('draft');
      // No review warning on something that was never published.
      expect(result.data.message).toBeUndefined();
    });

    // ENG-631 follow-up. The first fix asked `status !== 'draft'`, which is a
    // different question: a publish that FAILED leaves `error` with no
    // `metaAdId`, and the tool then told the owner their change was on a
    // running ad and that Meta would re-review it — about an ad Meta never
    // accepted. Prod carries these rows.
    it('does not call a failed publish live', async () => {
      const failedRow = {
        ...row,
        status: 'error',
        metaAdId: null,
        headline: 'Edited after a failed publish',
      };
      const apiFetch = jest.fn(async () => failedRow);
      const result = await updateAdTool.execute(
        { adId: 'ad-9', headline: 'Edited after a failed publish' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      expect(result.data.live).toBe(false);
      expect(result.data.title).not.toMatch(/live/i);
      expect(result.data.preview?.variant).toBe('draft');
      // No promise of a re-review for an ad that is not on Meta.
      expect(result.data.message).toBeUndefined();
    });

    // ENG-631. `toFields` hardcoded "Draft — not running yet" on every result,
    // so the SAME payload that carried `live: true` and `status: "active"` also
    // told the model the ad was an unpublished draft. The narration was fixed;
    // the structured field it reads was not.
    it('does not report a live ad as a draft in its fields', async () => {
      const liveRow = {
        ...row,
        status: 'active',
        metaAdId: '120246528563240037',
        headline: 'Edited live',
      };
      const apiFetch = jest.fn(async () => liveRow);
      const result = await updateAdTool.execute(
        { adId: 'ad-9', headline: 'Edited live' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      const status = result.data.fields?.find((f) => f.label === 'Status');
      expect(status?.value).not.toMatch(/draft/i);
      expect(status?.value).toMatch(/live on meta/i);
      expect(status?.value).toMatch(/re-review/i);
    });

    it('still reports an unpublished ad as a draft in its fields', async () => {
      const apiFetch = jest.fn(async () => row);
      const result = await updateAdTool.execute(
        { adId: 'ad-9', headline: 'New headline' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      const status = result.data.fields?.find((f) => f.label === 'Status');
      expect(status?.value).toBe('Draft — not running yet');
    });

    // The chat card polls /videos/:id and /graphics/:id by id. An ad built
    // from an UPLOADED photo carries an asset id in `videoId` (the wizard puts
    // it there), that poll 404s forever, and the card sat as a grey skeleton —
    // so the owner never saw the edit. `createDraftAd` resolves the asset for
    // exactly this reason; this tool did not.
    it('resolves a library asset so the card can render it', async () => {
      const assetRow = {
        ...row,
        videoId: 'asset-77',
      };
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('assets/')) {
          return {
            id: 'asset-77',
            type: 'image',
            blobUrl: 'https://cdn.example.test/uploaded.jpg',
            thumbnailUrl: null,
          };
        }
        return assetRow;
      });
      const result = await updateAdTool.execute(
        { adId: 'ad-9', headline: 'New headline' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      expect(result.data.preview?.assetImageUrl).toBe(
        'https://cdn.example.test/uploaded.jpg'
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'assets/asset-77',
        expect.anything()
      );
    });

    // A rendered video id is NOT an asset — the lookup 404s and the card polls
    // for it by id, which is right for that case. The edit must still succeed.
    it('survives an id that is not an asset', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('assets/')) throw new Error('404 Not Found');
        return { ...row, videoId: 'video-1' };
      });
      const result = await updateAdTool.execute(
        { adId: 'ad-9', headline: 'New headline' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      expect(result.data.preview?.assetImageUrl).toBeUndefined();
      expect(result.data.preview?.videoId).toBe('video-1');
    });

    it('tells the model live ads are editable', () => {
      expect(updateAdTool.description).toMatch(/LIVE ads/i);
      expect(updateAdTool.description).toMatch(/Never call a live ad a draft/i);
    });
  });

  describe('confirmLaunchAdTool', () => {
    const baseInput = {
      adId: '11111111-1111-4111-8111-111111111111',
      adName: 'Lip filler — March',
      campaignName: 'Q1',
    };

    it('issues a token bound to launch_ad + adId on the happy path', async () => {
      const createConfirmation = jest.fn(async () => ({
        id: 'tok-launch',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        createConfirmation: createConfirmation as never,
      });
      const result = await confirmLaunchAdTool.execute(baseInput, ctx);

      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'launch_ad',
        resourceId: baseInput.adId,
        payload: expect.objectContaining({ adId: baseInput.adId }),
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.confirmationToken).toBe('tok-launch');
      }
    });

    it('blocks and emits hard_block_violation when validators fail', async () => {
      const runHardBlocks = jest.fn(async () => ({
        pass: false,
        code: 'noFabricatedResultClaims',
        message: 'no fabricated claims',
      }));
      const createConfirmation = jest.fn();
      const ctx = buildCtx({
        runHardBlocks: runHardBlocks as never,
        createConfirmation: createConfirmation as never,
      });
      const result = await confirmLaunchAdTool.execute(baseInput, ctx);

      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'hard_block_violation') {
        expect(result.presentation.code).toBe('noFabricatedResultClaims');
      }
    });
  });

  describe('executeLaunchAdTool', () => {
    it('rejects with confirmation_expired when the token is invalid', async () => {
      // Now destructive=true: the FACTORY runs verification before the tool's
      // execute, so an invalid token is a factory-level refusal (ok:false,
      // CONFIRMATION_INVALID) — the publish is never attempted.
      const verifyConfirmation = jest.fn(async () => ({
        valid: false,
        reason: 'expired' as const,
      }));
      const apiFetch = jest.fn();
      const ctx = buildCtx({
        verifyConfirmation: verifyConfirmation as never,
        apiFetch: apiFetch as never,
      });
      const result = await executeLaunchAdTool.execute(
        {
          adId: '11111111-1111-4111-8111-111111111111',
          confirmationToken: 'stale-token',
        },
        ctx
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONFIRMATION_INVALID');
        expect(result.presentation?.type).toBe('confirmation_expired');
        if (result.presentation?.type === 'confirmation_expired') {
          expect(result.presentation.reason).toBe('expired');
        }
      }
    });

    it('refuses same-turn launch (turn-boundary) with a wait instruction', async () => {
      // The turn-boundary rule (#131): a token created this turn cannot be
      // consumed until the operator replies in a LATER turn. The service
      // returns `no_user_turn`; the factory turns it into a stop-and-wait.
      const verifyConfirmation = jest.fn(async () => ({
        valid: false,
        reason: 'no_user_turn' as const,
      }));
      const apiFetch = jest.fn();
      const ctx = buildCtx({
        verifyConfirmation: verifyConfirmation as never,
        apiFetch: apiFetch as never,
      });
      const result = await executeLaunchAdTool.execute(
        {
          adId: '11111111-1111-4111-8111-111111111111',
          confirmationToken: 'fresh-token',
        },
        ctx
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONFIRMATION_INVALID');
        expect(result.error).toMatch(/WAIT|has not been approved/i);
        if (result.presentation?.type === 'confirmation_expired') {
          expect(result.presentation.reason).toBe('no_user_turn');
        }
      }
    });

    it('publishes the ad on a valid token', async () => {
      // The REAL envelope: `POST /meta-ads/:id/publish` returns publishAd's
      // `ok({ ad: updatedAd })`. This mock used to be FLAT, matching the tool's
      // wrong assertion rather than the API — so the suite stayed green while
      // every launch card read "Ad launched: undefined".
      const apiFetch = jest.fn(async () => ({
        ad: { id: 'ad-1', name: 'Lip filler', status: 'active' },
      }));
      const result = await executeLaunchAdTool.execute(
        {
          adId: '11111111-1111-4111-8111-111111111111',
          confirmationToken: 'tok',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      // The publish is the money call; a best-effort GET /meta-ads/:id (to
      // resolve the campaign for the budget display + interlock) precedes it.
      const publishCall = apiFetch.mock.calls.find((c) =>
        String(c[0]).endsWith('/publish')
      ) as [string, { method?: string }] | undefined;
      expect(publishCall?.[0]).toBe(
        'meta-ads/11111111-1111-4111-8111-111111111111/publish'
      );
      expect(publishCall?.[1].method).toBe('POST');
      expect(result.ok).toBe(true);
    });

    it('returns a launched-ad preview payload echoing the approved copy', async () => {
      const apiFetch = jest.fn(async () => ({
        ad: {
          id: 'ad-1',
          name: 'Laser Hair Removal — Educational',
          status: 'active',
        },
        // Read-back from Meta (ADR-005): the ad is verified live in an active
        // campaign, so the tool reports 'live' and titles the card "Ad
        // launched". A response WITHOUT this field is reported as unverified.
        launch: {
          state: 'live',
          adEffectiveStatus: 'ACTIVE',
          campaignEffectiveStatus: 'ACTIVE',
          detail:
            'Verified with Meta: the ad is active and its campaign is delivering.',
        },
      }));
      const result = await executeLaunchAdTool.execute(
        {
          adId: '11111111-1111-4111-8111-111111111111',
          confirmationToken: 'tok',
          adName: 'Laser Hair Removal — Educational',
          headline: 'Smooth Skin Starts Here',
          primaryText:
            'Tired of razors and waxing? Our advanced laser hair removal delivers long-lasting results.',
          callToAction: 'BOOK_NOW',
          campaignName: 'Laser Hair Removal — July 2025',
          videoTitle: 'Laser Hair Removal — Educational',
          videoId: '22222222-2222-4222-8222-222222222222',
          targetingDisplay: '25km radius, ages 18–65',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      expect(result.data.uiState).toBe('created');
      expect(result.data.title).toBe(
        'Ad launched: Laser Hair Removal — Educational'
      );
      // The tool reports ONLY the read-back state, never an optimistic literal.
      expect(result.data.launchState).toBe('live');
      // budgetDisplay is derived SERVER-SIDE (register #82); this mock doesn't
      // stub the campaign lookup, so it's simply omitted here.
      expect(result.data.preview).toMatchObject({
        variant: 'launched',
        adName: 'Laser Hair Removal — Educational',
        headline: 'Smooth Skin Starts Here',
        callToAction: 'BOOK_NOW',
        campaignName: 'Laser Hair Removal — July 2025',
        videoId: '22222222-2222-4222-8222-222222222222',
        targetingDisplay: '25km radius, ages 18–65',
      });
      const fieldsByLabel = Object.fromEntries(
        (result.data.fields ?? []).map((f) => [f.label, f.value])
      );
      expect(fieldsByLabel.Headline).toBe('Smooth Skin Starts Here');
      expect(fieldsByLabel.Campaign).toBe('Laser Hair Removal — July 2025');
    });

    it('holds the launch when a budget change for the campaign failed unacknowledged (register #137)', async () => {
      // Campaign resolves; the interlock reports the campaign is flagged.
      const apiFetch = jest.fn(async (path: string) => {
        if (
          String(path).startsWith('meta-ads/') &&
          !path.endsWith('/publish')
        ) {
          return { id: 'ad-1', metaCampaignId: 'mc-1' };
        }
        return { ad: { id: 'ad-1', name: 'Ad', status: 'active' } };
      });
      (resolveBudgetFailureInterlock as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: { blocked: true, cleared: false },
      });
      const result = await executeLaunchAdTool.execute(
        {
          adId: '11111111-1111-4111-8111-111111111111',
          confirmationToken: 'tok',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      // Blocked: no publish call, no live claim.
      expect(result.data.blocked).toBe('unacknowledged_budget_failure');
      expect(result.data.launchState).toBeUndefined();
      expect(
        apiFetch.mock.calls.some((c) => String(c[0]).endsWith('/publish'))
      ).toBe(false);
    });

    it('launches once the owner acknowledges the failed budget change (register #137)', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (
          String(path).startsWith('meta-ads/') &&
          !path.endsWith('/publish')
        ) {
          return { id: 'ad-1', metaCampaignId: 'mc-1' };
        }
        return {
          ad: { id: 'ad-1', name: 'Ad', status: 'active' },
          launch: {
            state: 'live',
            adEffectiveStatus: 'ACTIVE',
            campaignEffectiveStatus: 'ACTIVE',
            detail: 'Verified with Meta: the ad is active.',
          },
        };
      });
      // With acknowledged=true the interlock clears and does NOT block.
      (resolveBudgetFailureInterlock as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: { blocked: false, cleared: true },
      });
      const result = await executeLaunchAdTool.execute(
        {
          adId: '11111111-1111-4111-8111-111111111111',
          confirmationToken: 'tok',
          acknowledgeBudgetFailure: true,
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) return;
      expect(result.data.blocked).toBeUndefined();
      expect(result.data.launchState).toBe('live');
      expect(
        apiFetch.mock.calls.some((c) => String(c[0]).endsWith('/publish'))
      ).toBe(true);
    });
  });

  describe('confirmPauseAdTool', () => {
    it('issues a token bound to pause_campaign + metaCampaignId', async () => {
      const createConfirmation = jest.fn(async () => ({
        id: 'tok-pause',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        createConfirmation: createConfirmation as never,
      });
      const result = await confirmPauseAdTool.execute(
        { metaCampaignId: 'mc-1', campaignName: 'Q1' },
        ctx
      );
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'pause_campaign',
        resourceId: 'mc-1',
        payload: expect.objectContaining({ metaCampaignId: 'mc-1' }),
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.confirmationToken).toBe('tok-pause');
      }
    });
  });

  describe('executePauseAdTool', () => {
    it('POSTs the pause endpoint after token verification', async () => {
      // The REAL shape: `pauseCampaign` returns a bare `{ paused: true }` ack —
      // it does not echo the campaign id, status or name. The old mock returned
      // all three, which is why `apiFetch<PauseCampaignApiResponse>` asserting
      // those fields stayed green while the tool reported `undefined` for every
      // one of them in production.
      const apiFetch = jest.fn(async () => ({ paused: true }));
      const result = await executePauseAdTool.execute(
        { metaCampaignId: 'mc-1', confirmationToken: 'tok' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string },
      ];
      expect(calledPath).toBe('meta-campaigns/mc-1/pause');
      expect(calledOpts.method).toBe('POST');
      expect(result.ok).toBe(true);
    });
  });

  describe('confirmUpdateBudgetTool', () => {
    it('issues a token bound to update_budget + metaCampaignId', async () => {
      const createConfirmation = jest.fn(async () => ({
        id: 'tok-budget',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        createConfirmation: createConfirmation as never,
      });
      const result = await confirmUpdateBudgetTool.execute(
        {
          metaCampaignId: 'mc-1',
          campaignName: 'Q1',
          currentBudgetCents: 1000,
          newBudgetCents: 1500,
        },
        ctx
      );
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'update_budget',
        resourceId: 'mc-1',
        payload: expect.objectContaining({
          metaCampaignId: 'mc-1',
          newBudgetCents: 1500,
        }),
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('executeUpdateBudgetTool', () => {
    it('PUTs the new daily budget on a valid token', async () => {
      // PHASE 4, STEP 4: this no longer goes over the loopback. The port calls
      // `updateCampaign` directly, so the assertion is about the USE CASE call,
      // not an HTTP path. The apiFetch mock stays only to prove it is NOT used.
      const apiFetch = jest.fn();
      const result = await executeUpdateBudgetTool.execute(
        {
          metaCampaignId: 'mc-1',
          dailyBudget: 1500,
          confirmationToken: 'tok',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(updateCampaign).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          metaCampaignId: 'mc-1',
          organizationId: 'org-1',
          dailyBudget: 1500,
        })
      );
      // The loopback hop is gone; nothing should have reached for HTTP.
      expect(apiFetch).not.toHaveBeenCalled();

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // `accepted_unconfirmed` — `updateCampaign` returns `{ updated: true }`
        // and reads NOTHING back from Meta, so there has never been a
        // server-confirmed figure to quote. The tool therefore states NO
        // amount at all: repeating the requested number as fact is the defect
        // this union exists to prevent.
        expect(result.data.dailyBudget).toBeUndefined();
        expect(result.data.message).toContain('not confirmed');
      }
    });

    it('refuses to quote a budget the API did not confirm', async () => {
      // An owner asked for $20/day, the change did not take, and every ad card
      // showed $20/day while the campaign ran at $15 — because the message was
      // built from the REQUEST. With no confirmed value there is now no figure
      // to state, and the tool says so.
      const apiFetch = jest.fn(async () => ({
        metaCampaignId: 'mc-1',
        name: 'Q1',
      }));
      const result = await executeUpdateBudgetTool.execute(
        {
          metaCampaignId: 'mc-1',
          dailyBudget: 2000,
          confirmationToken: 'tok',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.dailyBudget).toBeUndefined();
        expect(result.data.message).not.toContain('20.00');
        expect(result.data.message).toContain('not confirmed');
      }
    });

    it('flags the campaign for the launch interlock when the budget change is blocked (register #137)', async () => {
      (updateCampaign as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Meta rejected the change' },
      });
      const result = await executeUpdateBudgetTool.execute(
        {
          metaCampaignId: 'mc-1',
          dailyBudget: 5000,
          confirmationToken: 'tok',
        },
        buildCtx()
      );
      expect(result.ok).toBe(true);
      expect(flagBudgetFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          organizationId: 'org-1',
          conversationId: 'conv-1',
          metaCampaignId: 'mc-1',
        })
      );
    });
  });

  describe('confirmUpdateBudgetTool honest states', () => {
    it('reports a hard block as `blocked`, with no token to act on', async () => {
      // The shape this replaces was an OK result carrying a `hardBlock` field.
      // It shipped 6 times, was never inspected, and the refusal never reached
      // the owner. `blocked` is now a different state, and the token — the only
      // thing that lets the change proceed — is simply absent.
      const result = await confirmUpdateBudgetTool.execute(
        {
          metaCampaignId: 'mc-1',
          campaignName: 'Q1',
          currentBudgetCents: 1500,
          newBudgetCents: 2000,
        },
        buildCtx({
          runHardBlocks: (async () => ({
            pass: false,
            code: 'noScalingBeforeLearningExits',
            message: 'Campaign is still in its learning phase.',
          })) as never,
        })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.status).toBe('blocked');
        expect(result.data.confirmationToken).toBeUndefined();
        expect(result.data.blockedReason?.code).toBe(
          'noScalingBeforeLearningExits'
        );
        expect('hardBlock' in result.data).toBe(false);
      }
    });

    it('marks a clean proposal `awaiting_approval`', async () => {
      const result = await confirmUpdateBudgetTool.execute(
        {
          metaCampaignId: 'mc-1',
          campaignName: 'Q1',
          newBudgetCents: 2000,
        },
        buildCtx()
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.status).toBe('awaiting_approval');
        expect(result.data.confirmationToken).toBeTruthy();
        expect(result.data.blockedReason).toBeUndefined();
      }
    });
  });

  // ─── 4xx over-reporting regression guard ────────────────────────────────────
  // These tests mirror the pattern introduced in #513 for createDraftVideoTool.
  // A 4xx ApiFetchError is an expected tool outcome (bad request / not found)
  // that Claire should relay to the user — it is NOT a server fault and must
  // NOT be sent to Sentry. 5xx / non-ApiFetchError errors still get reported.

  describe('4xx reportIssue gating (regression guard for API-9G / ENG-402)', () => {
    it('executeLaunchAdTool: returns message but does NOT report a 4xx', async () => {
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError('Ad already launched', 409);
      });
      const result = await executeLaunchAdTool.execute(
        { adId: 'ad-1', confirmationToken: 'tok' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // ENG-852: the sanitized message is followed by a factual retry hint
        // — the ad was not launched but is still saved and can be launched
        // again, instead of leaving Claire to imply it's gone.
        expect(result.data.error).toBe(
          'Ad already launched. The ad is still saved and was not launched — it can be launched again once this is fixed.'
        );
      }
      expect(logWarning).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('executeLaunchAdTool: still reports a 5xx as a genuine fault', async () => {
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError('Gateway timeout', 504);
      });
      const result = await executeLaunchAdTool.execute(
        { adId: 'ad-1', confirmationToken: 'tok' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.error).toBe(
          'Gateway timeout. The ad is still saved and was not launched — it can be launched again once this is fixed.'
        );
      }
      expect(logWarning).toHaveBeenCalledTimes(1);
    });

    it('checkMetaIntegrationTool: returns not-connected but does NOT report a 401', async () => {
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError('Unauthorized', 401);
      });
      const result = await checkMetaIntegrationTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.connected).toBe(false);
      }
      expect(logWarning).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('checkMetaIntegrationTool: reports a genuine 5xx fault', async () => {
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError('Service unavailable', 503);
      });
      const result = await checkMetaIntegrationTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.connected).toBe(false);
      }
      expect(logWarning).toHaveBeenCalledTimes(1);
    });
  });

  // Phase 7 — no-silent-substitution contract. When the owner referenced their
  // own upload in words (`assetRef`) and gave no creative id, the tool resolves
  // it via library search or ASKS — it never guesses an id and never creates
  // the ad against a substituted creative. (#37 #150 #151)
  describe('createDraftAdTool — assetRef resolution', () => {
    const baseInput = {
      metaCampaignId: 'camp-1',
      name: 'My photo ad',
      targeting: {},
      serviceIds: ['svc-1'],
    };

    it('resolves a single library match to an assetId and creates the ad', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('assets?')) {
          return {
            items: [
              { id: 'asset-42', name: 'Endosphere before', type: 'image' },
            ],
          };
        }
        if (path.startsWith('assets/')) {
          return {
            id: 'asset-42',
            type: 'image',
            blobUrl: 'https://cdn/x.jpg',
            thumbnailUrl: null,
          };
        }
        return {
          id: 'ad-9',
          name: 'My photo ad',
          status: 'draft',
          metaCampaignId: 'camp-1',
        };
      });
      const result = await createDraftAdTool.execute(
        { ...baseInput, assetRef: 'Endosphere photo' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      // The resolved asset id rides the videoId slot on the create POST.
      const postCall = apiFetch.mock.calls.find((c) => c[0] === 'meta-ads') as
        | [string, { body: Record<string, unknown> }]
        | undefined;
      expect(postCall).toBeDefined();
      expect(postCall?.[1].body.videoId).toBe('asset-42');
    });

    it('returns asset_unresolved (never guesses / never creates) on multiple matches', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('assets?')) {
          return {
            items: [
              { id: 'asset-1', name: 'Endosphere left', type: 'image' },
              { id: 'asset-2', name: 'Endosphere right', type: 'image' },
            ],
          };
        }
        throw new Error(`unexpected fetch ${path}`);
      });
      const result = await createDraftAdTool.execute(
        { ...baseInput, assetRef: 'Endosphere' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect('assetUnresolved' in result.data).toBe(true);
        if ('assetUnresolved' in result.data) {
          expect(result.data.assetUnresolved.candidates).toHaveLength(2);
        }
      }
      // The ad was NOT created — no POST to meta-ads.
      expect(apiFetch.mock.calls.some((c) => c[0] === 'meta-ads')).toBe(false);
    });

    it('asks (no candidates) rather than creating when nothing matches', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.startsWith('assets?')) return { items: [] };
        throw new Error(`unexpected fetch ${path}`);
      });
      const result = await createDraftAdTool.execute(
        { ...baseInput, assetRef: 'nonexistent' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'assetUnresolved' in result.data) {
        expect(result.data.assetUnresolved.candidates).toHaveLength(0);
      }
      expect(apiFetch.mock.calls.some((c) => c[0] === 'meta-ads')).toBe(false);
    });

    it('rejects assetRef together with a resolved creative id', async () => {
      const apiFetch = jest.fn();
      const result = await createDraftAdTool.execute(
        { ...baseInput, videoId: 'v-1', assetRef: 'my photo' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      // videoId + assetRef is still exactly one resolved creative (assetRef is
      // ignored when a creative id is present), so this is allowed and the
      // video is used — assetRef never triggers a search here.
      expect(result.ok).toBe(true);
      expect(
        apiFetch.mock.calls.some((c) => c[0]?.toString().startsWith('assets?'))
      ).toBe(false);
    });
  });

  describe('replaceAdCreativeTool — live-ad dead end → requiresNewAd', () => {
    it('returns requiresNewAd (not a raw error) when the ad is not an editable draft', async () => {
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError(
          'Creative can only be replaced on an unpublished Borradh draft ad',
          409
        );
      });
      const result = await replaceAdCreativeTool.execute(
        { adId: 'ad-live', graphicId: 'g-1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'requiresNewAd' in result.data) {
        expect(result.data.requiresNewAd?.adId).toBe('ad-live');
        expect(result.data.message).toMatch(/duplicate/i);
        expect(result.data.error).toBeUndefined();
      } else {
        throw new Error('expected requiresNewAd union');
      }
    });

    it('still surfaces a plain error for unrelated 4xx failures', async () => {
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError('Something else', 400);
      });
      const result = await replaceAdCreativeTool.execute(
        { adId: 'ad-1', graphicId: 'g-1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'error' in result.data) {
        expect(result.data.error).toBe('Something else');
      }
    });
  });

  // ENG-852: neither duplicate tool declared an `additionalAllowedPaths`
  // extension, so `ctx.apiFetch('meta-ads/:id/duplicate', ...)` /
  // `ctx.apiFetch('meta-campaigns/:id/duplicate', ...)` failed the shared
  // whitelist (path-whitelist.ts) on every call and surfaced as "This action
  // is not available." — duplicate has never worked from Claire.
  describe('duplicateAdTool / duplicateCampaignTool — path whitelist (ENG-852)', () => {
    it('duplicateAdTool declares meta-ads/:id/duplicate as an allowed path', () => {
      expect(
        isPathAllowed(
          'meta-ads/ad-1/duplicate',
          duplicateAdTool.additionalAllowedPaths
        )
      ).toBe(true);
      // Not on the SHARED whitelist — proves the extension is load-bearing.
      expect(isPathAllowed('meta-ads/ad-1/duplicate')).toBe(false);
    });

    it('duplicateCampaignTool declares meta-campaigns/:id/duplicate as an allowed path', () => {
      expect(
        isPathAllowed(
          'meta-campaigns/mc-1/duplicate',
          duplicateCampaignTool.additionalAllowedPaths
        )
      ).toBe(true);
      expect(isPathAllowed('meta-campaigns/mc-1/duplicate')).toBe(false);
    });

    it('duplicateAdTool actually reaches the duplicate endpoint end-to-end', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'ad-2',
        name: 'Draft ad (Copy)',
        status: 'draft',
      }));
      const buildApiFetch = jest.fn(() => apiFetch);
      const result = await duplicateAdTool.execute(
        { adId: 'ad-1' },
        buildCtx({
          apiFetch: apiFetch as never,
          buildApiFetch: buildApiFetch as never,
        })
      );
      // The factory only swaps in the extended fetcher when
      // `additionalAllowedPaths` is declared — confirms the whitelist
      // extension is actually wired through, not just present on the config.
      expect(buildApiFetch).toHaveBeenCalledWith(
        duplicateAdTool.additionalAllowedPaths
      );
      expect(apiFetch).toHaveBeenCalledWith('meta-ads/ad-1/duplicate', {
        method: 'POST',
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.id).toBe('ad-2');
      }
    });

    it('duplicateCampaignTool actually reaches the duplicate endpoint end-to-end', async () => {
      const apiFetch = jest.fn(async () => ({ queued: true }));
      const buildApiFetch = jest.fn(() => apiFetch);
      const result = await duplicateCampaignTool.execute(
        { metaCampaignId: 'mc-1' },
        buildCtx({
          apiFetch: apiFetch as never,
          buildApiFetch: buildApiFetch as never,
        })
      );
      expect(buildApiFetch).toHaveBeenCalledWith(
        duplicateCampaignTool.additionalAllowedPaths
      );
      expect(apiFetch.mock.calls[0]?.[0]).toBe('meta-campaigns/mc-1/duplicate');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.queued).toBe(true);
      }
    });
  });
});
