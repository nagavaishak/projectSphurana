import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { claireTools } from './index.js';
import {
  getAlternativeRecommendationTool,
  publishAdTool,
  publishOfferTool,
  recommendOfferForServiceTool,
  recommendServiceForAdsTool,
  resolveDisagreementTool,
  saveAdDraftTool,
  saveOfferDraftTool,
  setPendingAdBudgetTool,
  setPendingAdCaptionTool,
  setPendingAdCopyTool,
  setPendingAdCreativeTool,
  setPendingAdHeadlineTool,
  setPendingAdPriceTool,
  setPendingAdScheduleTool,
  setPendingAdServiceTool,
  setPendingAdTargetingTool,
  setPendingOfferCodeTool,
  setPendingOfferIntroPriceTool,
  setPendingOfferLocationsTool,
  setPendingOfferNameTool,
  setPendingOfferRedemptionRulesTool,
  setPendingOfferServiceTool,
  setPendingOfferValidityTool,
  showAdPreviewTool,
  showOfferPreviewTool,
} from './index.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// The tool-factory's confirmation.ts imports `@borradh-workspace/features/
// assistant` for the real token services; buildCtx overrides
// createConfirmation / verifyConfirmation so that module is never reached at
// runtime — stub it so the barrel doesn't drag in the knowledge-query logger.
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
}));

// Short-circuit the database barrel — same reason as the ads / appointments /
// leads spec files. The claire tools only use `db` as an opaque handle they
// hand straight to the mocked feature services, and the offer-intro-price
// tool reads `offerDiscountTypeValues` at module-load time for its Zod enum.
jest.mock('@borradh-workspace/database', () => ({
  db: {},
  offerDiscountTypeValues: [
    'percentage',
    'fixed_amount',
    'fixed_price',
    'buy_x_get_y',
  ],
}));

// The claire tools call the feature services directly (not via apiFetch), so
// every service / telemetry helper they touch is mocked here. Tests override
// the relevant mock's return value per-case.
jest.mock('@borradh-workspace/features/claire', () => ({
  classifyBusiness: jest.fn(async () => ({ success: true, data: {} })),
  computeRecommendation: jest.fn(() => ({ topService: null })),
  getBusinessProfile: jest.fn(),
  getCurrentCycle: jest.fn(async () => ({ success: true, data: null })),
  getOrCreateDraftAd: jest.fn(),
  getOrCreateDraftOffer: jest.fn(),
  hasPushedTopPick: jest.fn(async () => ({ success: true, data: false })),
  markCycleAccepted: jest.fn(async () => ({ success: true, data: {} })),
  markDisagreementSurfaced: jest.fn(async () => ({ success: true, data: {} })),
  markTopPickPushed: jest.fn(async () => ({ success: true, data: {} })),
  pickAlternative: jest.fn(),
  recomputeRanking: jest.fn(() => []),
  promoteDraftAd: jest.fn(),
  promoteDraftOffer: jest.fn(),
  resolveDisagreement: jest.fn(async () => ({ success: true, data: {} })),
  trackDisagreementResolved: jest.fn(),
  trackRecommendationAccepted: jest.fn(),
  trackRecommendationDismissed: jest.fn(),
  trackRecommendationDraftSaved: jest.fn(),
  trackRecommendationImpression: jest.fn(),
  trackRecommendationPublished: jest.fn(),
  updateDraftAd: jest.fn(),
  updateDraftOffer: jest.fn(),
  endCycle: jest.fn(async () => ({ success: true, data: {} })),
}));

jest.mock('@borradh-workspace/features/organization-services', () => ({
  listServicesForOrg: jest.fn(),
}));

jest.mock('@borradh-workspace/features/shared', () => ({
  ErrorCodes: {
    NOT_FOUND: 'NOT_FOUND',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
  // Pure helper used by the pending budget/price tools to format money in the
  // ad-account currency. Mirror the real mapping for the codes the tests use.
  currencyForCode: (code: string) => {
    const map: Record<string, { code: string; symbol: string }> = {
      eur: { code: 'EUR', symbol: '€' },
      usd: { code: 'USD', symbol: '$' },
      gbp: { code: 'GBP', symbol: '£' },
    };
    const k = code.trim().toLowerCase();
    return map[k] ?? { code: code.toUpperCase(), symbol: code.toUpperCase() };
  },
  // `adAccountCurrency` (via the ad-currency helper) gates on this; the test
  // currencies are all 2-decimal.
  currencyMinorUnitDigits: (code: string) =>
    ({ jpy: 0, krw: 0, bhd: 3 })[code.trim().toLowerCase()] ?? 2,
}));

import {
  classifyBusiness,
  computeRecommendation,
  endCycle,
  getBusinessProfile,
  getOrCreateDraftAd,
  getOrCreateDraftOffer,
  hasPushedTopPick,
  markCycleAccepted,
  markDisagreementSurfaced,
  markTopPickPushed,
  pickAlternative,
  promoteDraftAd,
  promoteDraftOffer,
  recomputeRanking,
  resolveDisagreement,
  updateDraftAd,
  updateDraftOffer,
} from '@borradh-workspace/features/claire';
import { listServicesForOrg } from '@borradh-workspace/features/organization-services';

// Mocked-function handles, typed loosely so tests can `.mockResolvedValue`.
const mockClassifyBusiness = classifyBusiness as jest.Mock;
const mockComputeRecommendation = computeRecommendation as jest.Mock;
const mockEndCycle = endCycle as jest.Mock;
const mockGetBusinessProfile = getBusinessProfile as jest.Mock;
const mockGetOrCreateDraftAd = getOrCreateDraftAd as jest.Mock;
const mockGetOrCreateDraftOffer = getOrCreateDraftOffer as jest.Mock;
const mockHasPushedTopPick = hasPushedTopPick as jest.Mock;
const mockMarkCycleAccepted = markCycleAccepted as jest.Mock;
const mockMarkDisagreementSurfaced = markDisagreementSurfaced as jest.Mock;
const mockMarkTopPickPushed = markTopPickPushed as jest.Mock;
const mockPickAlternative = pickAlternative as jest.Mock;
const mockRecomputeRanking = recomputeRanking as jest.Mock;
const mockPromoteDraftAd = promoteDraftAd as jest.Mock;
const mockPromoteDraftOffer = promoteDraftOffer as jest.Mock;
const mockResolveDisagreement = resolveDisagreement as jest.Mock;
const mockUpdateDraftAd = updateDraftAd as jest.Mock;
const mockUpdateDraftOffer = updateDraftOffer as jest.Mock;
const mockListServicesForOrg = listServicesForOrg as jest.Mock;

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
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
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

// ---- Draft-row fixtures matching the MetaAd / Offer shapes the snapshot
// helpers (adToSnapshot / offerToSnapshot) read. Only the fields the helpers
// touch matter; everything else is filler. ----

function makeAd(over: Record<string, unknown> = {}) {
  return {
    id: 'ad-1',
    name: 'Lip filler — March',
    headline: 'Existing headline',
    primaryText: 'Body copy',
    description: null,
    callToAction: 'BOOK_NOW',
    destinationUrl: null,
    followUpType: 'chatbot',
    adPlacement: 'feed',
    metaCampaignId: 'mc-1',
    metaAdsPageId: 'page-1',
    videoId: 'vid-1',
    targetingOverride: null,
    status: 'draft',
    ...over,
  };
}

function makeOffer(over: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    name: 'Botox intro',
    code: null,
    state: 'draft',
    discountType: 'percentage',
    discountPercent: 20,
    offerPriceCents: null,
    originalPriceCents: null,
    buyQuantity: null,
    getQuantity: null,
    limitPerClient: false,
    redemptionLimit: null,
    validFrom: null,
    validUntil: null,
    ...over,
  };
}

function draftAdOk(over: Record<string, unknown> = {}, serviceIds = ['svc-1']) {
  return { success: true, data: { ad: makeAd(over), serviceIds } };
}

function draftOfferOk(
  over: Record<string, unknown> = {},
  serviceIds = ['svc-1'],
  locationIds: string[] = []
) {
  return {
    success: true,
    data: { offer: makeOffer(over), serviceIds, locationIds },
  };
}

function failure(message = 'boom', code = 'INTERNAL_ERROR') {
  return { success: false, error: { code, message } };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults for the per-field draft tools.
  mockGetOrCreateDraftAd.mockResolvedValue(draftAdOk());
  mockUpdateDraftAd.mockResolvedValue(draftAdOk());
  mockGetOrCreateDraftOffer.mockResolvedValue(draftOfferOk());
  mockUpdateDraftOffer.mockResolvedValue(draftOfferOk());
  mockGetBusinessProfile.mockResolvedValue({
    success: true,
    data: { rankedServices: [], marketPosition: 'mid' },
  });
});

describe('claire tools', () => {
  describe('registry', () => {
    it('exports 26 tools', () => {
      expect(claireTools).toHaveLength(26);
    });

    it('every tool name uses the claire_ prefix and the claire feature', () => {
      for (const tool of claireTools) {
        expect(tool.name).toMatch(/^claire_/);
        expect(tool.feature).toBe('claire');
      }
    });

    it('exposes unique tool names', () => {
      const names = claireTools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('only publishAd / publishOffer are destructive (two-call confirm flow)', () => {
      const destructive = claireTools
        .filter((t) => t.destructive)
        .map((t) => t.name)
        .sort();
      expect(destructive).toEqual(['claire_publishAd', 'claire_publishOffer']);
      // Destructive tools must carry a destructiveAction enum value.
      expect(publishAdTool.destructiveAction).toBe('launch_ad');
      expect(publishOfferTool.destructiveAction).toBe('create_offer');
    });

    it('save-draft tools are non-destructive (no Meta API call)', () => {
      expect(saveAdDraftTool.destructive).toBe(false);
      expect(saveOfferDraftTool.destructive).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // recommend_* group
  // ---------------------------------------------------------------------------

  describe('recommendServiceForAdsTool', () => {
    const rankedService = {
      serviceId: 'svc-1',
      rank: 1,
      offerStrategy: 'intro_price',
      suggestedIntroPrice: 12500,
      serviceRecommendationCopy: { title: 'Advertise Botox', body: 'Why' },
      offerRecommendationCopy: { title: 'Intro €125', body: 'How' },
    };

    it('returns the top-ranked pick and opens a push-memory cycle', async () => {
      mockComputeRecommendation.mockReturnValue({ topService: rankedService });
      mockListServicesForOrg.mockResolvedValue({
        success: true,
        data: [{ id: 'svc-1', name: 'Botox' }],
      });
      mockHasPushedTopPick.mockResolvedValue({ success: true, data: false });

      const result = await recommendServiceForAdsTool.execute({}, buildCtx());

      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'serviceId' in result.data) {
        expect(result.data.serviceId).toBe('svc-1');
        expect(result.data.serviceName).toBe('Botox');
        expect(result.data.isTopPick).toBe(true);
        expect(result.data.alreadyPushed).toBe(false);
        expect(result.data.offer.strategy).toBe('intro_price');
      }
      // First push in the cycle marks it pushed.
      expect(mockMarkTopPickPushed).toHaveBeenCalledTimes(1);
    });

    it('does not re-mark when the pick was already pushed this cycle', async () => {
      mockComputeRecommendation.mockReturnValue({ topService: rankedService });
      mockListServicesForOrg.mockResolvedValue({
        success: true,
        data: [{ id: 'svc-1', name: 'Botox' }],
      });
      mockHasPushedTopPick.mockResolvedValue({ success: true, data: true });

      const result = await recommendServiceForAdsTool.execute({}, buildCtx());

      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'alreadyPushed' in result.data) {
        expect(result.data.alreadyPushed).toBe(true);
      }
      expect(mockMarkTopPickPushed).not.toHaveBeenCalled();
    });

    it('self-heals + returns an error message when no profile exists yet', async () => {
      mockGetBusinessProfile.mockResolvedValue(
        failure('not found', 'NOT_FOUND')
      );

      const result = await recommendServiceForAdsTool.execute({}, buildCtx());

      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'error' in result.data) {
        expect(result.data.error).toContain('still classifying');
      }
      // NOT_FOUND triggers the fire-and-forget reclassification.
      expect(mockClassifyBusiness).toHaveBeenCalledTimes(1);
    });

    it('returns an error when there is no ranked service', async () => {
      mockComputeRecommendation.mockReturnValue({ topService: null });
      mockListServicesForOrg.mockResolvedValue({ success: true, data: [] });

      const result = await recommendServiceForAdsTool.execute({}, buildCtx());

      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'error' in result.data) {
        expect(result.data.error).toContain('No ranked services');
      }
    });
  });

  describe('recommendOfferForServiceTool', () => {
    it('returns the offer copy for a ranked service (from the live ranking)', async () => {
      mockGetBusinessProfile.mockResolvedValue({
        success: true,
        data: { marketPosition: 'mid' },
      });
      mockListServicesForOrg.mockResolvedValue({
        success: true,
        data: [{ id: 'svc-1', name: 'Filler' }],
      });
      // The tool now derives the offer from the LIVE ranking, not the cached
      // rankedServices snapshot.
      mockRecomputeRanking.mockReturnValue([
        {
          serviceId: 'svc-1',
          offerStrategy: 'intro_price',
          suggestedIntroPrice: 9900,
          offerRecommendationCopy: { title: 'Intro', body: 'Body' },
        },
      ]);

      const result = await recommendOfferForServiceTool.execute(
        { serviceId: 'svc-1' },
        buildCtx()
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'strategy' in result.data) {
        expect(result.data.strategy).toBe('intro_price');
        expect(result.data.suggestedIntroPrice).toBe(9900);
      }
    });

    it('errors when the service is not in the ranked list', async () => {
      mockGetBusinessProfile.mockResolvedValue({
        success: true,
        data: { marketPosition: 'mid' },
      });
      mockListServicesForOrg.mockResolvedValue({ success: true, data: [] });
      mockRecomputeRanking.mockReturnValue([]);

      const result = await recommendOfferForServiceTool.execute(
        { serviceId: 'not-ranked' },
        buildCtx()
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'error' in result.data) {
        expect(result.data.error).toContain('not in the ranked list');
      }
    });

    it('rejects empty serviceId at the schema layer', async () => {
      const result = await recommendOfferForServiceTool.execute(
        { serviceId: '' },
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('getAlternativeRecommendationTool', () => {
    it('returns the next-ranked alternative + records dismissal/impression', async () => {
      mockGetBusinessProfile.mockResolvedValue({
        success: true,
        data: { marketPosition: 'mid' },
      });
      mockListServicesForOrg.mockResolvedValue({
        success: true,
        data: [{ id: 'svc-2', name: 'Filler' }],
      });
      // Dismissed-event metadata is now sourced from the live ranking.
      mockRecomputeRanking.mockReturnValue([
        { serviceId: 'svc-1', rank: 1, offerStrategy: 'intro_price' },
        { serviceId: 'svc-2', rank: 2, offerStrategy: 'bundle' },
      ]);
      mockPickAlternative.mockReturnValue({
        serviceId: 'svc-2',
        rank: 2,
        offerStrategy: 'bundle',
        suggestedIntroPrice: 8000,
        serviceRecommendationCopy: { title: 'Filler', body: 'Why' },
        offerRecommendationCopy: { title: 'Bundle', body: 'How' },
      });

      const result = await getAlternativeRecommendationTool.execute(
        { rejectedServiceId: 'svc-1' },
        buildCtx()
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'serviceId' in result.data) {
        expect(result.data.serviceId).toBe('svc-2');
        expect(result.data.isTopPick).toBe(false);
      }
    });

    it('errors when there is no viable alternative', async () => {
      mockListServicesForOrg.mockResolvedValue({ success: true, data: [] });
      mockPickAlternative.mockReturnValue(null);

      const result = await getAlternativeRecommendationTool.execute(
        { rejectedServiceId: 'svc-1' },
        buildCtx()
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'error' in result.data) {
        expect(result.data.error).toContain('no viable alternative');
      }
    });

    it('rejects missing rejectedServiceId', async () => {
      const result = await getAlternativeRecommendationTool.execute(
        {} as never,
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // set_pending_ad_* group — uniform getOrCreateDraftAd → updateDraftAd shape.
  // ---------------------------------------------------------------------------

  describe('set_pending_ad_* (uniform draft mutators)', () => {
    type Case = {
      name: string;
      tool: (typeof claireTools)[number];
      input: Record<string, unknown>;
      // The `update` slice we expect to flow into updateDraftAd.
      expectUpdate?: Record<string, unknown>;
    };

    const cases: Case[] = [
      {
        name: 'setPendingAdHeadlineTool',
        tool: setPendingAdHeadlineTool,
        input: { headline: 'New headline' },
        expectUpdate: { headline: 'New headline' },
      },
      {
        name: 'setPendingAdCaptionTool',
        tool: setPendingAdCaptionTool,
        input: { caption: 'A long caption' },
        expectUpdate: { primaryText: 'A long caption' },
      },
      {
        name: 'setPendingAdCopyTool',
        tool: setPendingAdCopyTool,
        input: { headline: 'H', caption: 'C', description: 'D' },
        expectUpdate: { headline: 'H', primaryText: 'C', description: 'D' },
      },
      {
        name: 'setPendingAdCreativeTool',
        tool: setPendingAdCreativeTool,
        input: { videoId: 'vid-9' },
        expectUpdate: { videoId: 'vid-9' },
      },
      {
        // A library / uploaded asset id rides the same videoId slot.
        name: 'setPendingAdCreativeTool (assetId)',
        tool: setPendingAdCreativeTool,
        input: { assetId: 'asset-3' },
        expectUpdate: { videoId: 'asset-3' },
      },
    ];

    it.each(cases)(
      '$name updates the draft and returns a snapshot',
      async ({ tool, input, expectUpdate }) => {
        const result = await tool.execute(input, buildCtx());
        expect(mockGetOrCreateDraftAd).toHaveBeenCalledTimes(1);
        expect(mockUpdateDraftAd).toHaveBeenCalledTimes(1);
        if (expectUpdate) {
          const arg = mockUpdateDraftAd.mock.calls[0][1];
          expect(arg.update).toMatchObject(expectUpdate);
          expect(arg.draftId).toBe('ad-1');
        }
        expect(result.ok).toBe(true);
        if (result.ok && result.data && 'draftId' in result.data) {
          expect(result.data.draftId).toBe('ad-1');
        }
      }
    );

    it.each(cases)(
      '$name surfaces a soft error when the draft cannot be loaded',
      async ({ tool, input }) => {
        mockGetOrCreateDraftAd.mockResolvedValue(failure('no draft'));
        const result = await tool.execute(input, buildCtx());
        expect(result.ok).toBe(true);
        if (result.ok && result.data && 'error' in result.data) {
          expect(result.data.error).toBe('no draft');
        }
        expect(mockUpdateDraftAd).not.toHaveBeenCalled();
      }
    );

    it('setPendingAdHeadlineTool rejects an over-length headline (>80)', async () => {
      const result = await setPendingAdHeadlineTool.execute(
        { headline: 'x'.repeat(81) },
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('setPendingAdCaptionTool rejects an over-length caption (>500)', async () => {
      const result = await setPendingAdCaptionTool.execute(
        { caption: 'x'.repeat(501) },
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('setPendingAdServiceTool', () => {
    it('swaps service + cascades defaults when the draft is on a different service', async () => {
      mockGetOrCreateDraftAd.mockResolvedValue(draftAdOk({}, ['svc-old']));
      mockUpdateDraftAd.mockResolvedValue(draftAdOk({}, ['svc-1']));
      mockGetBusinessProfile.mockResolvedValue({
        success: true,
        data: { marketPosition: 'mid' },
      });
      mockListServicesForOrg.mockResolvedValue({
        success: true,
        data: [{ id: 'svc-1', name: 'Filler' }],
      });
      // Funnel-accept hook now matches against the live ranking.
      mockRecomputeRanking.mockReturnValue([
        { serviceId: 'svc-1', rank: 1, offerStrategy: 'intro_price' },
      ]);

      const result = await setPendingAdServiceTool.execute(
        { serviceId: 'svc-1' },
        buildCtx()
      );

      const arg = mockUpdateDraftAd.mock.calls[0][1];
      expect(arg.update).toEqual({ serviceIds: ['svc-1'] });
      expect(arg.cascadeDefaults).toBe(true);
      // Ranked service → records the accept on the cycle.
      expect(mockMarkCycleAccepted).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    });

    it('no-ops when the draft is already on the requested service', async () => {
      mockGetOrCreateDraftAd.mockResolvedValue(draftAdOk({}, ['svc-1']));
      const result = await setPendingAdServiceTool.execute(
        { serviceId: 'svc-1' },
        buildCtx()
      );
      expect(mockUpdateDraftAd).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'draftId' in result.data) {
        expect(result.data.serviceIds).toEqual(['svc-1']);
      }
    });
  });

  describe('setPendingAdTargetingTool', () => {
    it('merges partial targeting with the existing override', async () => {
      mockGetOrCreateDraftAd.mockResolvedValue(
        draftAdOk({ targetingOverride: { countries: ['IE'] } })
      );
      const result = await setPendingAdTargetingTool.execute(
        { ageMin: 25, ageMax: 45 },
        buildCtx()
      );
      const arg = mockUpdateDraftAd.mock.calls[0][1];
      expect(arg.update.targetingOverride).toEqual({
        countries: ['IE'],
        ageMin: 25,
        ageMax: 45,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects an out-of-range distanceKm', async () => {
      const result = await setPendingAdTargetingTool.execute(
        { distanceKm: 5000 },
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('never writes coordinates into the targeting override', async () => {
      // The area is the branch's saved, geocoded address, resolved server-side
      // at publish time — the tool has no latitude/longitude to set. Zod strips
      // the unknown keys rather than rejecting them, so the invariant to pin is
      // that they do not reach the stored override (an ad targeted at Null
      // Island is what made this non-negotiable).
      mockGetOrCreateDraftAd.mockResolvedValue(
        draftAdOk({ targetingOverride: { countries: ['IE'] } })
      );
      const result = await setPendingAdTargetingTool.execute(
        { latitude: 200, longitude: 200, distanceKm: 25 } as never,
        buildCtx()
      );
      expect(result.ok).toBe(true);
      const arg = mockUpdateDraftAd.mock.calls[0][1];
      expect(arg.update.targetingOverride).toEqual({
        countries: ['IE'],
        distanceKm: 25,
      });
    });
  });

  describe('setPendingAdPriceTool', () => {
    it('rewrites the headline to lead with the price in the ad-account currency', async () => {
      mockGetOrCreateDraftAd.mockResolvedValue(
        draftAdOk({ headline: 'Botox by the experts' })
      );
      // Currency is derived from the connected ad account (GBP here), not a
      // model guess — so the label leads with £, not a hardcoded €.
      const apiFetch = jest.fn(async () => ({
        integration: {
          defaultPageId: 'p1',
          pages: [
            { id: 'p1', isActive: true, defaultAdAccountCurrency: 'GBP' },
          ],
        },
      }));
      const result = await setPendingAdPriceTool.execute(
        { introPrice: 125 },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const arg = mockUpdateDraftAd.mock.calls[0][1];
      expect(arg.update.headline).toContain('Just £125 —');
      expect(result.ok).toBe(true);
    });

    it('replaces a prior price prefix instead of stacking one', async () => {
      mockGetOrCreateDraftAd.mockResolvedValue(
        draftAdOk({ headline: 'Just kr1250 — Botox by the experts' })
      );
      await setPendingAdPriceTool.execute({ introPrice: 99 }, buildCtx());
      const arg = mockUpdateDraftAd.mock.calls[0][1];
      expect(arg.update.headline).toBe('Just €99 — Botox by the experts');
    });

    it('leaves an operator headline that merely starts with a number alone', async () => {
      // "Top 10 - ..." is copy, not a price prefix: a looser strip pattern ate
      // the leading segment because "Top" looked like a multi-char symbol.
      mockGetOrCreateDraftAd.mockResolvedValue(
        draftAdOk({ headline: 'Top 10 - reasons to choose us' })
      );
      await setPendingAdPriceTool.execute({ introPrice: 99 }, buildCtx());
      const arg = mockUpdateDraftAd.mock.calls[0][1];
      expect(arg.update.headline).toBe(
        'Just €99 — Top 10 - reasons to choose us'
      );
    });

    it('rejects a negative price', async () => {
      const result = await setPendingAdPriceTool.execute(
        { introPrice: -5 },
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('setPendingAdScheduleTool', () => {
    it('returns the unchanged snapshot plus a scheduleNote (no persistence)', async () => {
      const result = await setPendingAdScheduleTool.execute(
        { startDate: '2026-06-01', endDate: '2026-06-30' },
        buildCtx()
      );
      // Schedule lives on the ad set at launch time — never persisted here.
      expect(mockUpdateDraftAd).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'scheduleNote' in result.data) {
        expect(result.data.scheduleNote).toContain('2026-06-01');
        expect(result.data.scheduleNote).toContain('2026-06-30');
      }
    });

    it('rejects a missing startDate', async () => {
      const result = await setPendingAdScheduleTool.execute(
        {} as never,
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('setPendingAdBudgetTool', () => {
    it('formats the budgetNote and surfaces the EUR assumption when no ad account is connected', async () => {
      // Default ctx has no Meta integration, so currency can't be resolved →
      // EUR fallback, and the note must SURFACE that assumption per spec.
      const result = await setPendingAdBudgetTool.execute(
        { dailyBudgetCents: 1500 },
        buildCtx()
      );
      expect(mockUpdateDraftAd).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'budgetNote' in result.data) {
        expect(result.data.budgetNote).toContain('€15.00');
        expect(result.data.budgetNote).toContain('assuming EUR');
      }
    });

    it('rejects a sub-minimum budget (<100 cents)', async () => {
      const result = await setPendingAdBudgetTool.execute(
        { dailyBudgetCents: 50 },
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // set_pending_offer_* group
  // ---------------------------------------------------------------------------

  describe('set_pending_offer_* (uniform draft mutators)', () => {
    type Case = {
      name: string;
      tool: (typeof claireTools)[number];
      input: Record<string, unknown>;
      expectUpdate?: Record<string, unknown>;
    };

    const cases: Case[] = [
      {
        name: 'setPendingOfferNameTool',
        tool: setPendingOfferNameTool,
        input: { name: 'Spring special' },
        expectUpdate: { name: 'Spring special' },
      },
      {
        name: 'setPendingOfferLocationsTool',
        tool: setPendingOfferLocationsTool,
        input: { locationIds: ['loc-1', 'loc-2'] },
        expectUpdate: { locationIds: ['loc-1', 'loc-2'] },
      },
      {
        name: 'setPendingOfferRedemptionRulesTool',
        tool: setPendingOfferRedemptionRulesTool,
        input: { limitPerClient: true, redemptionLimit: 50 },
        expectUpdate: { limitPerClient: true, redemptionLimit: 50 },
      },
    ];

    it.each(cases)(
      '$name updates the offer draft and returns a snapshot',
      async ({ tool, input, expectUpdate }) => {
        const result = await tool.execute(input, buildCtx());
        expect(mockGetOrCreateDraftOffer).toHaveBeenCalledTimes(1);
        expect(mockUpdateDraftOffer).toHaveBeenCalledTimes(1);
        if (expectUpdate) {
          const arg = mockUpdateDraftOffer.mock.calls[0][1];
          expect(arg.update).toMatchObject(expectUpdate);
          expect(arg.draftId).toBe('offer-1');
        }
        expect(result.ok).toBe(true);
        if (result.ok && result.data && 'draftId' in result.data) {
          expect(result.data.draftId).toBe('offer-1');
        }
      }
    );

    it.each(cases)(
      '$name surfaces a soft error when the draft cannot be loaded',
      async ({ tool, input }) => {
        mockGetOrCreateDraftOffer.mockResolvedValue(failure('no offer'));
        const result = await tool.execute(input, buildCtx());
        expect(result.ok).toBe(true);
        if (result.ok && result.data && 'error' in result.data) {
          expect(result.data.error).toBe('no offer');
        }
        expect(mockUpdateDraftOffer).not.toHaveBeenCalled();
      }
    );
  });

  describe('setPendingOfferServiceTool', () => {
    it('swaps service + cascades defaults + records cycle accept for a ranked service', async () => {
      mockGetOrCreateDraftOffer.mockResolvedValue(
        draftOfferOk({}, ['svc-old'])
      );
      mockUpdateDraftOffer.mockResolvedValue(draftOfferOk({}, ['svc-1']));
      mockGetBusinessProfile.mockResolvedValue({
        success: true,
        data: { marketPosition: 'mid' },
      });
      mockListServicesForOrg.mockResolvedValue({
        success: true,
        data: [{ id: 'svc-1', name: 'Filler' }],
      });
      mockRecomputeRanking.mockReturnValue([
        { serviceId: 'svc-1', rank: 1, offerStrategy: 'intro_price' },
      ]);

      const result = await setPendingOfferServiceTool.execute(
        { serviceId: 'svc-1' },
        buildCtx()
      );
      const arg = mockUpdateDraftOffer.mock.calls[0][1];
      expect(arg.update).toEqual({ serviceIds: ['svc-1'] });
      expect(arg.cascadeDefaults).toBe(true);
      expect(mockMarkCycleAccepted).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    });

    it('no-ops when the offer is already on the requested service', async () => {
      mockGetOrCreateDraftOffer.mockResolvedValue(draftOfferOk({}, ['svc-1']));
      const result = await setPendingOfferServiceTool.execute(
        { serviceId: 'svc-1' },
        buildCtx()
      );
      expect(mockUpdateDraftOffer).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });
  });

  describe('setPendingOfferIntroPriceTool', () => {
    it('nulls non-applicable columns for a percentage discount', async () => {
      const result = await setPendingOfferIntroPriceTool.execute(
        { discountType: 'percentage', discountPercent: 25 },
        buildCtx()
      );
      const arg = mockUpdateDraftOffer.mock.calls[0][1];
      expect(arg.update).toMatchObject({
        discountType: 'percentage',
        discountPercent: 25,
        offerPriceCents: null,
        buyQuantity: null,
        getQuantity: null,
      });
      expect(result.ok).toBe(true);
    });

    it('keeps offerPriceCents for a fixed_price discount', async () => {
      const result = await setPendingOfferIntroPriceTool.execute(
        { discountType: 'fixed_price', offerPriceCents: 9900 },
        buildCtx()
      );
      const arg = mockUpdateDraftOffer.mock.calls[0][1];
      expect(arg.update).toMatchObject({
        discountType: 'fixed_price',
        offerPriceCents: 9900,
        discountPercent: null,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects a percentage discount missing discountPercent (superRefine)', async () => {
      const result = await setPendingOfferIntroPriceTool.execute(
        { discountType: 'percentage' },
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
      expect(mockUpdateDraftOffer).not.toHaveBeenCalled();
    });
  });

  describe('setPendingOfferValidityTool', () => {
    it('parses ISO dates into Date objects on the update', async () => {
      const result = await setPendingOfferValidityTool.execute(
        { validFrom: '2026-06-01', validUntil: '2026-06-30' },
        buildCtx()
      );
      const arg = mockUpdateDraftOffer.mock.calls[0][1];
      expect(arg.update.validFrom).toBeInstanceOf(Date);
      expect(arg.update.validUntil).toBeInstanceOf(Date);
      expect(result.ok).toBe(true);
    });

    it('returns a soft error for an invalid validUntil date', async () => {
      const result = await setPendingOfferValidityTool.execute(
        { validUntil: 'not-a-date' },
        buildCtx()
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'error' in result.data) {
        expect(result.data.error).toContain('validUntil');
      }
      expect(mockUpdateDraftOffer).not.toHaveBeenCalled();
    });

    it('rejects a missing validUntil at the schema layer', async () => {
      const result = await setPendingOfferValidityTool.execute(
        {} as never,
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('setPendingOfferCodeTool', () => {
    it('auto-generates a 6-char code when none is given', async () => {
      const result = await setPendingOfferCodeTool.execute({}, buildCtx());
      const arg = mockUpdateDraftOffer.mock.calls[0][1];
      expect(typeof arg.update.code).toBe('string');
      expect(arg.update.code).toHaveLength(6);
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'generated' in result.data) {
        expect(result.data.generated).toBe(true);
      }
    });

    it('clears the code when passed null', async () => {
      const result = await setPendingOfferCodeTool.execute(
        { code: null },
        buildCtx()
      );
      const arg = mockUpdateDraftOffer.mock.calls[0][1];
      expect(arg.update.code).toBeNull();
      expect(result.ok).toBe(true);
      if (result.ok && result.data && 'generated' in result.data) {
        expect(result.data.generated).toBe(false);
      }
    });

    it('uses the trimmed code when one is provided', async () => {
      const result = await setPendingOfferCodeTool.execute(
        { code: '  SPRING20  ' },
        buildCtx()
      );
      const arg = mockUpdateDraftOffer.mock.calls[0][1];
      expect(arg.update.code).toBe('SPRING20');
      expect(result.ok).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // preview group
  // ---------------------------------------------------------------------------

  describe('showAdPreviewTool', () => {
    it('emits the preview_card presentation and reports ready when complete', async () => {
      mockGetOrCreateDraftAd.mockResolvedValue(
        draftAdOk({
          videoId: 'vid-1',
          metaCampaignId: 'mc-1',
          headline: 'A headline',
        })
      );
      const result = await showAdPreviewTool.execute({}, buildCtx());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.presentation).toMatchObject({
          type: 'preview_card',
          kind: 'ad',
          draftId: 'ad-1',
        });
        if (result.data) {
          expect(result.data.ready).toBe(true);
          expect(result.data.missing).toEqual([]);
        }
      }
    });

    it('lists missing requirements when the draft is incomplete', async () => {
      mockGetOrCreateDraftAd.mockResolvedValue(
        draftAdOk({ videoId: null, metaCampaignId: null, headline: null }, [])
      );
      const result = await showAdPreviewTool.execute({}, buildCtx());
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.ready).toBe(false);
        expect(result.data.missing).toEqual(
          expect.arrayContaining([
            'creative',
            'campaign',
            'headline',
            'serviceIds',
          ])
        );
      }
    });

    it('reports not-ready when the draft cannot be loaded', async () => {
      mockGetOrCreateDraftAd.mockResolvedValue(failure('no draft'));
      const result = await showAdPreviewTool.execute({}, buildCtx());
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.ready).toBe(false);
        expect(result.data.missing).toEqual(['no draft']);
      }
    });
  });

  describe('showOfferPreviewTool', () => {
    it('emits the preview_card presentation and flags missing validUntil/percent', async () => {
      mockGetOrCreateDraftOffer.mockResolvedValue(
        draftOfferOk({
          discountType: 'percentage',
          discountPercent: null,
          validUntil: null,
        })
      );
      const result = await showOfferPreviewTool.execute({}, buildCtx());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.presentation).toMatchObject({
          type: 'preview_card',
          kind: 'offer',
          draftId: 'offer-1',
        });
        if (result.data) {
          expect(result.data.ready).toBe(false);
          expect(result.data.missing).toEqual(
            expect.arrayContaining(['validUntil', 'discountPercent'])
          );
        }
      }
    });

    it('is ready when a percentage offer has both percent and validUntil', async () => {
      mockGetOrCreateDraftOffer.mockResolvedValue(
        draftOfferOk({
          discountType: 'percentage',
          discountPercent: 20,
          validUntil: new Date('2026-06-30'),
        })
      );
      const result = await showOfferPreviewTool.execute({}, buildCtx());
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.ready).toBe(true);
        expect(result.data.missing).toEqual([]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // publish / save group (destructive confirm+execute flow for publish)
  // ---------------------------------------------------------------------------

  describe('publishAdTool', () => {
    it('emits confirmation_required on the first call (no token)', async () => {
      const createConfirmation = jest.fn(async () => ({
        id: 'tok-pub-ad',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      mockGetOrCreateDraftAd.mockResolvedValue(draftAdOk({ id: 'ad-1' }));
      const result = await publishAdTool.execute(
        { draftId: 'ad-1' },
        buildCtx({ createConfirmation: createConfirmation as never })
      );
      expect(createConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'launch_ad',
          resourceId: 'ad-1',
          payload: expect.objectContaining({ draftId: 'ad-1' }),
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.token).toBe('tok-pub-ad');
        expect(result.presentation.executeToolName).toBe('claire_publishAd');
      }
      // The draft is NOT promoted on the confirm half.
      expect(mockPromoteDraftAd).not.toHaveBeenCalled();
    });

    it('promotes the draft + ends the cycle on a valid token', async () => {
      mockPromoteDraftAd.mockResolvedValue({
        success: true,
        data: {
          ad: { id: 'ad-1', status: 'launching' },
          metaCampaignId: 'mc-1',
          metaAdSetId: 'as-1',
        },
      });
      const result = await publishAdTool.execute(
        { draftId: 'ad-1', confirmationToken: 'tok' },
        buildCtx()
      );
      expect(mockPromoteDraftAd).toHaveBeenCalledTimes(1);
      expect(mockEndCycle).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.adId).toBe('ad-1');
        expect(result.data.metaCampaignId).toBe('mc-1');
        expect(result.data.status).toBe('launching');
      }
    });

    it('rejects with confirmation_expired when the token is invalid', async () => {
      const verifyConfirmation = jest.fn(async () => ({
        valid: false,
        reason: 'expired' as const,
      }));
      const result = await publishAdTool.execute(
        { draftId: 'ad-1', confirmationToken: 'stale' },
        buildCtx({ verifyConfirmation: verifyConfirmation as never })
      );
      expect(mockPromoteDraftAd).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok && result.presentation?.type === 'confirmation_expired') {
        expect(result.presentation.reason).toBe('expired');
      }
    });

    it('returns a sanitized tool error when promote fails', async () => {
      mockPromoteDraftAd.mockResolvedValue(failure('draft already launched'));
      const result = await publishAdTool.execute(
        { draftId: 'ad-1', confirmationToken: 'tok' },
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('TOOL_EXECUTION_ERROR');
    });

    it('rejects a missing draftId at the schema layer', async () => {
      const result = await publishAdTool.execute({} as never, buildCtx());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('publishOfferTool', () => {
    it('emits confirmation_required bound to create_offer on the first call', async () => {
      const createConfirmation = jest.fn(async () => ({
        id: 'tok-pub-offer',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      mockGetOrCreateDraftOffer.mockResolvedValue(
        draftOfferOk({ id: 'offer-1' })
      );
      const result = await publishOfferTool.execute(
        { draftId: 'offer-1' },
        buildCtx({ createConfirmation: createConfirmation as never })
      );
      expect(createConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create_offer',
          resourceId: 'offer-1',
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.token).toBe('tok-pub-offer');
      }
      expect(mockPromoteDraftOffer).not.toHaveBeenCalled();
    });

    it('promotes the offer on a valid token', async () => {
      mockPromoteDraftOffer.mockResolvedValue({
        success: true,
        data: { id: 'offer-1', state: 'active', name: 'Botox intro' },
      });
      const result = await publishOfferTool.execute(
        { draftId: 'offer-1', confirmationToken: 'tok' },
        buildCtx()
      );
      expect(mockPromoteDraftOffer).toHaveBeenCalledTimes(1);
      expect(mockEndCycle).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.offerId).toBe('offer-1');
        expect(result.data.state).toBe('active');
      }
    });

    it('returns a tool error when promote fails', async () => {
      mockPromoteDraftOffer.mockResolvedValue(failure('invalid offer'));
      const result = await publishOfferTool.execute(
        { draftId: 'offer-1', confirmationToken: 'tok' },
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('TOOL_EXECUTION_ERROR');
    });
  });

  describe('saveAdDraftTool', () => {
    it('ends the cycle as actioned and returns saved: true', async () => {
      const result = await saveAdDraftTool.execute(
        { draftId: 'ad-1' },
        buildCtx()
      );
      expect(mockEndCycle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: 'ad_flow_service_pick',
          resolution: 'actioned',
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data).toEqual({ draftId: 'ad-1', saved: true });
      }
    });

    it('rejects a missing draftId', async () => {
      const result = await saveAdDraftTool.execute({} as never, buildCtx());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('saveOfferDraftTool', () => {
    it('ends the offer cycle as actioned and returns saved: true', async () => {
      const result = await saveOfferDraftTool.execute(
        { draftId: 'offer-1' },
        buildCtx()
      );
      expect(mockEndCycle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: 'ad_flow_offer_pick',
          resolution: 'actioned',
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data).toEqual({ draftId: 'offer-1', saved: true });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // disagreement
  // ---------------------------------------------------------------------------

  describe('resolveDisagreementTool', () => {
    it('owner_changed flows through resolveDisagreement and reports reclassified', async () => {
      mockResolveDisagreement.mockResolvedValue({ success: true, data: {} });
      const result = await resolveDisagreementTool.execute(
        { resolution: 'owner_changed' },
        buildCtx()
      );
      expect(mockResolveDisagreement).toHaveBeenCalledTimes(1);
      expect(mockMarkDisagreementSurfaced).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data).toEqual({ resolved: true, reclassified: true });
      }
    });

    it('owner_held resolves without reclassifying', async () => {
      mockResolveDisagreement.mockResolvedValue({ success: true, data: {} });
      const result = await resolveDisagreementTool.execute(
        { resolution: 'owner_held' },
        buildCtx()
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data).toEqual({ resolved: true, reclassified: false });
      }
    });

    it('dismissed only marks the disagreement surfaced (no resolve)', async () => {
      mockMarkDisagreementSurfaced.mockResolvedValue({
        success: true,
        data: {},
      });
      mockGetBusinessProfile.mockResolvedValue({
        success: true,
        data: { disagreement: null },
      });
      const result = await resolveDisagreementTool.execute(
        { resolution: 'dismissed' },
        buildCtx()
      );
      expect(mockResolveDisagreement).not.toHaveBeenCalled();
      expect(mockMarkDisagreementSurfaced).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data).toEqual({ resolved: true, reclassified: false });
      }
    });

    it('reports resolved: false when the resolve service fails', async () => {
      mockResolveDisagreement.mockResolvedValue(failure('cannot resolve'));
      const result = await resolveDisagreementTool.execute(
        { resolution: 'owner_changed' },
        buildCtx()
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.resolved).toBe(false);
      }
    });

    it('rejects an unknown resolution value', async () => {
      const result = await resolveDisagreementTool.execute(
        { resolution: 'nope' } as never,
        buildCtx()
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });
});
