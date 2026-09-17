import { isAIClientInitialized } from '@borradh-workspace/ai';
import type {
  AssistantRecommendation,
  BusinessProfile,
  MetaAd,
  Offer,
  OrganizationService,
  RankedService,
} from '@borradh-workspace/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// classifyBusiness pulls in the LLM client; stub it out before the engine code
// imports it. Mirrors recommendation-engine.test.ts.

import {
  FALLBACK_INTRO_PRICE,
  buildDefaultAdName,
  buildDefaultOfferName,
  buildDefaultOfferPricing,
  buildDefaultValidity,
  pickDefaultRankedService,
} from './draft-defaults.js';
import { getOrCreateDraftAd } from './get-or-create-draft-ad.service.js';
import { getOrCreateDraftOffer } from './get-or-create-draft-offer.service.js';
import { promoteDraftOffer } from './promote-draft-offer.service.js';

const ranked = (
  serviceId: string,
  rank: number,
  overrides: Partial<RankedService> = {}
): RankedService => ({
  serviceId,
  rank,
  score: 1 / rank,
  criteriaScores: {
    retentionFit: 0.8,
    barrierToEntry: 0.7,
    crossSell: 0.9,
    complianceRisk: 0,
  },
  marketPosition: 'at',
  offerStrategy: 'price_visible_intro',
  offerStrategyReason: 'fits playbook',
  suggestedIntroPrice: 125,
  serviceRecommendationCopy: {
    title: 'Run microneedling first',
    body: 'Short rebooking cycle, easy entry point.',
  },
  offerRecommendationCopy: { title: 'Offer copy', body: 'Show the price' },
  objections: [],
  ...overrides,
});

const buildProfile = (
  ranked_: RankedService[],
  overrides: Partial<BusinessProfile> = {}
): BusinessProfile =>
  ({
    id: 'bp_1',
    organizationId: 'org_1',
    vertical: 'aesthetic_clinic',
    retentionModel: 'course_based',
    commitmentLevel: 'planned',
    marketPosition: 'at',
    axesConfidence: 0.85,
    axesReasoning: 'because',
    classifierAxes: null,
    overriddenAxes: null,
    disagreement: null,
    rankedServices: ranked_,
    inputHash: 'h',
    classifiedAt: new Date(),
    classifierVersion: 'aesthetic_clinic@v1',
    verticalMetadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as BusinessProfile;

const makeService = (id: string, name: string): OrganizationService =>
  ({
    id,
    organizationId: 'org_1',
    name,
    description: null,
    category: 'treatment',
    sortOrder: 0,
    isCustom: false,
    isActive: true,
    requiresDeposit: false,
    depositAmountCents: null,
    depositLink: null,
    stripePaymentLinkId: null,
    stripeProductId: null,
    painPoints: null,
    expectedResults: null,
    processDescription: null,
    targetArea: null,
    pricingDescription: '€100',
    appointmentDuration: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as OrganizationService;

const fakeAd = (overrides: Partial<MetaAd> = {}): MetaAd =>
  ({
    id: 'draft_ad_1',
    organizationId: 'org_1',
    metaCampaignId: null,
    metaAdSetId: null,
    videoId: null,
    socialPostId: null,
    useExistingPost: false,
    name: 'Draft',
    headline: 'h',
    primaryText: 'p',
    description: null,
    callToAction: 'BOOK_NOW',
    destinationUrl: null,
    isImported: false,
    status: 'draft',
    targetingOverride: null,
    followUpType: 'lead_form',
    leadFormId: null,
    sequenceId: null,
    adPlacement: 'facebook',
    conversionDestination: null,
    destinations: null,
    metaAdsPageId: null,
    adAccountId: null,
    metaAdId: null,
    metaCreativeId: null,
    metaVideoId: null,
    metaImageHash: null,
    metaStatus: null,
    lastSyncAt: null,
    syncError: null,
    metaThumbnailUrl: null,
    metaPermalink: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as MetaAd;

const fakeOffer = (overrides: Partial<Offer> = {}): Offer =>
  ({
    id: 'draft_offer_1',
    organizationId: 'org_1',
    name: 'Microneedling intro',
    code: null,
    state: 'draft',
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 30 * 86_400_000),
    discountType: 'fixed_price',
    discountPercent: null,
    originalPriceCents: null,
    offerPriceCents: 12_500,
    buyQuantity: null,
    getQuantity: null,
    limitPerClient: false,
    redemptionLimit: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Offer;

// ── Default helpers ───────────────────────────────────────────────────

// pickDefaultRankedService now takes the LIVE ranked list (already computed by
// the caller via recomputeRanking), not a profile — so these assert the pure
// pick logic over an explicit array.
// `@borradh-workspace/ai` is canonically mocked (vite.config.ts alias). These
// tests exercise the no-API-key static path, so force `isAIClientInitialized`
// false here and restore the canonical `true` after, to avoid leaking the
// override across the shared worker graph under `isolate: false`. See
// docs/plans/features-test-suite-speedup.md.
beforeEach(() => {
  vi.mocked(isAIClientInitialized).mockReturnValue(false);
});
afterEach(() => {
  vi.mocked(isAIClientInitialized).mockReturnValue(true);
});

describe('pickDefaultRankedService', () => {
  it('returns the top-ranked service when no id is provided', () => {
    const list = [ranked('b', 2), ranked('a', 1)];
    expect(pickDefaultRankedService(list)?.serviceId).toBe('a');
  });

  it('returns the matching service when id is provided', () => {
    const list = [ranked('a', 1), ranked('b', 2)];
    expect(pickDefaultRankedService(list, 'b')?.serviceId).toBe('b');
  });

  it('returns null when nothing is ranked', () => {
    expect(pickDefaultRankedService([])).toBeNull();
  });

  it('returns the top pick when a specific id is not in the ranked list', () => {
    const list = [ranked('a', 1), ranked('b', 2)];
    expect(pickDefaultRankedService(list, 'c')?.serviceId).toBe('a');
  });
});

describe('buildDefaultAdName / buildDefaultOfferName', () => {
  it('builds ad names with the service name + today', () => {
    const name = buildDefaultAdName({ serviceName: 'Microneedling' });
    expect(name).toContain('Microneedling');
    expect(name).toContain('Claire draft');
  });
  it('builds offer names with "<service> intro"', () => {
    expect(buildDefaultOfferName({ serviceName: 'Microneedling' })).toBe(
      'Microneedling intro'
    );
  });
});

describe('buildDefaultOfferPricing', () => {
  it('is always fixed_price, never a percentage', () => {
    const pricing = buildDefaultOfferPricing(
      ranked('svc_1', 1, { suggestedIntroPrice: undefined })
    );
    expect(pricing.discountType).toBe('fixed_price');
    expect(pricing.discountPercent).toBeNull();
  });

  it('falls back to a concrete intro price with a was anchor when nothing is known', () => {
    const pricing = buildDefaultOfferPricing(
      ranked('svc_1', 1, {
        suggestedIntroPrice: undefined,
        ownerEstimatedCompetitorPrice: undefined,
      })
    );
    expect(pricing.offerPriceCents).toBe(FALLBACK_INTRO_PRICE * 100);
    expect(pricing.originalPriceCents).toBeGreaterThan(pricing.offerPriceCents);
  });

  it('uses suggestedIntroPrice as the now price', () => {
    const pricing = buildDefaultOfferPricing(
      ranked('svc_1', 1, { suggestedIntroPrice: 99 })
    );
    expect(pricing.offerPriceCents).toBe(9_900);
    expect(pricing.originalPriceCents).toBeGreaterThan(9_900);
  });

  it('uses ownerEstimatedCompetitorPrice as the was anchor', () => {
    const pricing = buildDefaultOfferPricing(
      ranked('svc_1', 1, {
        suggestedIntroPrice: 150,
        ownerEstimatedCompetitorPrice: 250,
      })
    );
    expect(pricing.offerPriceCents).toBe(15_000);
    expect(pricing.originalPriceCents).toBe(25_000);
  });

  it('derives an intro from competitor price when no intro is given', () => {
    const pricing = buildDefaultOfferPricing(
      ranked('svc_1', 1, {
        suggestedIntroPrice: undefined,
        ownerEstimatedCompetitorPrice: 200,
      })
    );
    // intro = 200 * 0.8 = 160; anchor = competitor 200.
    expect(pricing.offerPriceCents).toBe(16_000);
    expect(pricing.originalPriceCents).toBe(20_000);
  });
});

describe('buildDefaultValidity', () => {
  it('returns a 30-day window starting today', () => {
    const { validFrom, validUntil } = buildDefaultValidity();
    const diffDays = (validUntil.getTime() - validFrom.getTime()) / 86_400_000;
    expect(diffDays).toBeCloseTo(30, 0);
  });
});

// ── DB-mocked services ────────────────────────────────────────────────

const buildAdMockDb = (params: {
  cycleRows: AssistantRecommendation[];
  draftLookup: MetaAd | null;
  insertedAd: MetaAd;
  services: OrganizationService[];
  profile: BusinessProfile;
}) => {
  // Every select on assistantRecommendation chains
  // select().from().where().orderBy().limit() → rows. Return a fresh chain
  // per call so multiple internal getCurrentCycle calls each get one.
  const buildCycleSelect = () => {
    const limit = vi.fn().mockResolvedValue(params.cycleRows);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    return { from };
  };
  const select = vi.fn(() => buildCycleSelect());

  // setDraftPointer also calls select once more
  const insertReturning = vi.fn().mockResolvedValue([params.insertedAd]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertJunctionValues = vi.fn().mockResolvedValue(undefined);

  let insertCall = 0;
  const insert = vi.fn(() => {
    insertCall += 1;
    // first insert is metaAd (returning), second is metaAdService (no returning),
    // third is assistantRecommendation (returning).
    if (insertCall === 1) return { values: insertValues };
    if (insertCall === 2) return { values: insertJunctionValues };
    const cycleReturning = vi.fn().mockResolvedValue([
      {
        id: 'rec_1',
        organizationId: 'org_1',
        kind: 'ad_flow_service_pick',
        metadata: {
          surface: 'chat',
          conversationId: 'conv_1',
          draftId: params.insertedAd.id,
        },
      },
    ]);
    return { values: vi.fn().mockReturnValue({ returning: cycleReturning }) };
  });

  return {
    select,
    insert,
    query: {
      metaAd: { findFirst: vi.fn().mockResolvedValue(params.draftLookup) },
      organizationService: {
        // listServicesForOrg (used by the live ranking path) reads findMany;
        // the draft service-existence check reads findFirst.
        findMany: vi.fn().mockResolvedValue(params.services),
        findFirst: vi
          .fn()
          .mockResolvedValue(
            params.services.find(
              (s) => s.id === params.profile.rankedServices[0]?.serviceId
            )
          ),
      },
      businessProfile: { findFirst: vi.fn().mockResolvedValue(params.profile) },
    },
  };
};

describe('getOrCreateDraftAd', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a new draft populated from the top-ranked service', async () => {
    const services = [makeService('svc_1', 'Microneedling')];
    const profile = buildProfile([ranked('svc_1', 1)]);
    const insertedAd = fakeAd({ name: 'Claire draft' });
    const db = buildAdMockDb({
      cycleRows: [],
      draftLookup: null,
      insertedAd,
      services,
      profile,
    });

    const result = await getOrCreateDraftAd(db as never, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ad.id).toBe(insertedAd.id);
      expect(result.data.serviceIds).toEqual(['svc_1']);
    }
  });

  it('returns INVALID_STATE when no ranked services exist', async () => {
    const profile = buildProfile([]);
    const db = buildAdMockDb({
      cycleRows: [],
      draftLookup: null,
      insertedAd: fakeAd(),
      services: [],
      profile,
    });

    const result = await getOrCreateDraftAd(db as never, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STATE');
  });
});

// Captures the `.values(...)` payload passed into the offer insert so tests
// can assert the actual columns written (the mocked `.returning()` echoes a
// fixed row, so we must inspect the insert payload, not the result).
const buildOfferMockDb = (params: {
  profile: BusinessProfile;
  service: OrganizationService;
  insertedOffer: Offer;
}) => {
  const limit = vi.fn().mockResolvedValue([]); // no cycle yet
  const orderBy = vi.fn().mockReturnValue({ limit });
  const cycleWhere = vi.fn().mockReturnValue({ orderBy });
  const cycleFrom = vi.fn().mockReturnValue({ where: cycleWhere });
  const select = vi.fn(() => ({ from: cycleFrom }));

  const offerInsertPayloads: Record<string, unknown>[] = [];
  const offerInsertReturning = vi
    .fn()
    .mockResolvedValue([params.insertedOffer]);
  const offerInsertValues = vi.fn((payload: Record<string, unknown>) => {
    offerInsertPayloads.push(payload);
    return { returning: offerInsertReturning };
  });
  const junctionValues = vi.fn().mockResolvedValue(undefined);
  const cycleInsertReturning = vi.fn().mockResolvedValue([
    {
      id: 'rec_1',
      metadata: {
        surface: 'chat',
        conversationId: 'conv_1',
        draftId: params.insertedOffer.id,
      },
    },
  ]);
  let insertCall = 0;
  const insert = vi.fn(() => {
    insertCall += 1;
    if (insertCall === 1) return { values: offerInsertValues };
    if (insertCall === 2) return { values: junctionValues };
    return {
      values: vi.fn().mockReturnValue({ returning: cycleInsertReturning }),
    };
  });

  const db = {
    select,
    insert,
    query: {
      offer: { findFirst: vi.fn().mockResolvedValue(null) },
      organizationService: {
        findMany: vi.fn().mockResolvedValue([params.service]),
        findFirst: vi.fn().mockResolvedValue(params.service),
      },
      businessProfile: { findFirst: vi.fn().mockResolvedValue(params.profile) },
    },
  };

  return { db, offerInsertPayloads };
};

describe('getOrCreateDraftOffer', () => {
  beforeEach(() => vi.clearAllMocks());

  // These exercise the LIVE pipeline end-to-end: getOrCreateDraftOffer now
  // recomputes the ranking from the org's services (via listServicesForOrg)
  // rather than reading the cached rankedServices, then feeds the live ranked
  // service into buildDefaultOfferPricing. The exact intro→anchor arithmetic
  // is unit-tested in `describe('buildDefaultOfferPricing')` above; here we
  // assert the structural invariants that hold whatever the live price source.
  it('writes a fixed-price intro (never a percentage) with a "was" anchor above the "now" price', async () => {
    const service = makeService('svc_1', 'Microneedling');
    // priceText drives the live intro price; at-market → 70% of €120 = €84.
    const profile = buildProfile([ranked('svc_1', 1)]);
    const { db, offerInsertPayloads } = buildOfferMockDb({
      profile,
      service: { ...service, priceText: '€120' } as OrganizationService,
      insertedOffer: fakeOffer(),
    });

    const result = await getOrCreateDraftOffer(db as never, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
    });

    expect(result.success).toBe(true);
    const payload = offerInsertPayloads[0];
    expect(payload).toBeDefined();
    // Fixed price, NOT a percentage default.
    expect(payload?.discountType).toBe('fixed_price');
    expect(payload?.discountPercent).toBeNull();
    // Concrete "now" price + a populated "was" anchor above it.
    expect(typeof payload?.offerPriceCents).toBe('number');
    expect(payload?.offerPriceCents).toBeGreaterThan(0);
    expect(typeof payload?.originalPriceCents).toBe('number');
    expect(payload?.originalPriceCents as number).toBeGreaterThan(
      payload?.offerPriceCents as number
    );
  });

  it('falls back to a concrete intro price when the menu carries no usable price', async () => {
    // No priceText → live ranker yields no suggestedIntroPrice → the offer
    // pricing helper falls back to FALLBACK_INTRO_PRICE rather than inventing a
    // percentage.
    const service = makeService('svc_1', 'Botox');
    const profile = buildProfile([ranked('svc_1', 1)]);
    const { db, offerInsertPayloads } = buildOfferMockDb({
      profile,
      service,
      insertedOffer: fakeOffer(),
    });

    const result = await getOrCreateDraftOffer(db as never, {
      organizationId: 'org_1',
      conversationId: 'conv_1',
    });

    expect(result.success).toBe(true);
    const payload = offerInsertPayloads[0];
    expect(payload?.discountType).toBe('fixed_price');
    expect(payload?.discountPercent).toBeNull();
    expect(payload?.offerPriceCents).toBe(FALLBACK_INTRO_PRICE * 100);
    expect(payload?.originalPriceCents as number).toBeGreaterThan(
      FALLBACK_INTRO_PRICE * 100
    );
  });
});

describe('promoteDraftOffer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips state from draft to active on success', async () => {
    const draft = fakeOffer();
    const updated = { ...draft, state: 'active' as const };
    const updateReturning = vi.fn().mockResolvedValue([updated]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const db = {
      query: { offer: { findFirst: vi.fn().mockResolvedValue(draft) } },
      update: vi.fn().mockReturnValue({ set: updateSet }),
    };

    const result = await promoteDraftOffer(db as never, {
      organizationId: 'org_1',
      draftId: draft.id,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.state).toBe('active');
  });

  it('refuses to promote when draft is missing required price fields', async () => {
    const draft = fakeOffer({
      discountType: 'percentage',
      discountPercent: null,
      offerPriceCents: null,
    });
    const db = {
      query: { offer: { findFirst: vi.fn().mockResolvedValue(draft) } },
      update: vi.fn(),
    };

    const result = await promoteDraftOffer(db as never, {
      organizationId: 'org_1',
      draftId: draft.id,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_STATE');
      expect(result.error.message).toMatch(/discountPercent/);
    }
  });

  it('refuses to promote when offer is already non-draft', async () => {
    const db = {
      query: {
        offer: {
          findFirst: vi.fn().mockResolvedValue(fakeOffer({ state: 'active' })),
        },
      },
      update: vi.fn(),
    };

    const result = await promoteDraftOffer(db as never, {
      organizationId: 'org_1',
      draftId: 'draft_offer_1',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_STATE');
  });
});
