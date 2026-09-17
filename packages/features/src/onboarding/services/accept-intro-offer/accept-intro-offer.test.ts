import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE modules, not the `suggest-intro-offer/index.js` or
// `offers/index.js` barrels — barrel re-exports are live getters and
// `vi.spyOn` cannot redefine them.
import * as suggestIntroOfferModule from '../../../claire/services/suggest-intro-offer/suggest-intro-offer.service.js';
import * as createOfferModule from '../../../offers/services/create-offer/create-offer.service.js';
import * as updateOfferModule from '../../../offers/services/update-offer/update-offer.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { acceptIntroOffer } from './accept-intro-offer.service.js';

// Restored `vi.spyOn`s, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file.
let mockSuggestIntroOffer: MockInstance;
let mockCreateOffer: MockInstance;
let mockUpdateOffer: MockInstance;

const queryFns = { onboardingSession: { findFirst: vi.fn() } };
const whereMock = vi.fn().mockResolvedValue([]);
const setMock = vi.fn().mockReturnValue({ where: whereMock });
const mockDb = {
  query: queryFns,
  update: vi.fn().mockReturnValue({ set: setMock }),
};

const baseSession = {
  id: 'sess_1',
  userId: 'user_1',
  organizationId: 'org_1',
  selectedServiceId: 'svc_1',
  servicePriceCents: 18000,
  offerId: null,
};

const okSuggestion = (overrides: Record<string, unknown> = {}) => ({
  success: true as const,
  data: {
    serviceId: 'svc_1',
    serviceName: 'Microneedling',
    advisable: true,
    needsPrice: false,
    oneSessionPriceCents: 18000,
    targetDiscountPercent: 35,
    existingFit: null,
    suggested: {
      name: 'Microneedling — New Client Intro',
      discountType: 'fixed_price' as const,
      originalPriceCents: 18000,
      offerPriceCents: 9900,
      discountPercent: 45,
      audienceText: 'New clients only',
      limitPerClient: true as const,
      why: 'first-visit price',
    },
    ...overrides,
  },
});

describe('acceptIntroOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryFns.onboardingSession.findFirst.mockResolvedValue(baseSession);
    mockSuggestIntroOffer = vi
      .spyOn(suggestIntroOfferModule, 'suggestIntroOffer')
      .mockResolvedValue(okSuggestion() as never);
    mockCreateOffer = vi
      .spyOn(createOfferModule, 'createOffer')
      .mockResolvedValue({
        success: true,
        data: { id: 'offer_1' },
      } as never);
    mockUpdateOffer = vi
      .spyOn(updateOfferModule, 'updateOffer')
      .mockResolvedValue({
        success: true,
        data: { id: 'offer_9' },
      } as never);
    setMock.mockClear();
    setMock.mockReturnValue({ where: whereMock });
  });

  afterEach(() => {
    mockSuggestIntroOffer.mockRestore();
    mockCreateOffer.mockRestore();
    mockUpdateOffer.mockRestore();
  });

  it('creates the offer from the suggested price and pins it on the session', async () => {
    await expectResult(
      acceptIntroOffer(mockDb as never, { userId: 'user_1' })
    ).toSucceedWith((data) => {
      expect(data).toEqual({ offerId: 'offer_1', offerPriceCents: 9900 });
    });

    // Regular price threaded into the suggestion engine in major units.
    expect(mockSuggestIntroOffer).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        organizationId: 'org_1',
        serviceId: 'svc_1',
        oneSessionPrice: 180,
      })
    );
    expect(mockCreateOffer).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        organizationId: 'org_1',
        name: 'Microneedling — New Client Intro',
        discountType: 'fixed_price',
        originalPriceCents: 18000,
        offerPriceCents: 9900,
        limitPerClient: true,
        serviceIds: ['svc_1'],
        state: 'active',
      })
    );
    expect(setMock).toHaveBeenCalledWith({ offerId: 'offer_1' });
  });

  it('threads an owner-adjusted price through as offerPrice (major units)', async () => {
    mockSuggestIntroOffer.mockResolvedValue(
      okSuggestion({
        suggested: {
          ...okSuggestion().data.suggested,
          offerPriceCents: 12900,
        },
      })
    );

    await expectResult(
      acceptIntroOffer(mockDb as never, {
        userId: 'user_1',
        offerPriceCents: 12900,
      })
    ).toSucceedWith((data) => {
      expect(data.offerPriceCents).toBe(12900);
    });

    expect(mockSuggestIntroOffer).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ offerPrice: 129 })
    );
  });

  it('updates the EXISTING offer instead of duplicating on renegotiation', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      offerId: 'offer_9',
    });

    await expectResult(
      acceptIntroOffer(mockDb as never, { userId: 'user_1' })
    ).toSucceedWith((data) => {
      expect(data).toEqual({ offerId: 'offer_9', offerPriceCents: 9900 });
    });

    expect(mockUpdateOffer).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        id: 'offer_9',
        organizationId: 'org_1',
        offerPriceCents: 9900,
      })
    );
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when there is no onboarding session', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue(undefined);
    await expectResult(
      acceptIntroOffer(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns CONFLICT when the session has no organization yet', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      organizationId: null,
    });
    await expectResult(
      acceptIntroOffer(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when no service has been selected yet', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      selectedServiceId: null,
    });
    await expectResult(
      acceptIntroOffer(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it('returns CONFLICT when the engine still needs a price', async () => {
    queryFns.onboardingSession.findFirst.mockResolvedValue({
      ...baseSession,
      servicePriceCents: null,
    });
    mockSuggestIntroOffer.mockResolvedValue(
      okSuggestion({ needsPrice: true, suggested: null })
    );
    await expectResult(
      acceptIntroOffer(mockDb as never, { userId: 'user_1' })
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mockCreateOffer).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an empty userId', async () => {
    await expectResult(
      acceptIntroOffer(mockDb as never, { userId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockSuggestIntroOffer).not.toHaveBeenCalled();
  });
});
