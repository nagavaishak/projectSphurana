import { isAIClientInitialized } from '@borradh-workspace/ai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE modules, not the feature barrels: the barrels' re-exports are
// live getters under Vite SSR and cannot be redefined, and a bare `vi.mock`
// factory would delete every other export on the shared worker module graph.
import * as generateOfferCopyModule from '../../../ai-content/services/generate-offer-copy/generate-offer-copy.service.js';
import * as getOfferModule from '../../../offers/services/get-offer/get-offer.service.js';
import * as getOrganizationBrandModule from '../../../organizations/services/get-organization-brand/get-organization-brand.service.js';
import { ErrorCodes, FeatureError } from '../../../shared/index.js';

import { buildOfferCard } from './build-offer-card.service.js';

let mockGetOffer: MockInstance;
let mockGenerateOfferCopy: MockInstance;
let mockGetOrganizationBrand: MockInstance;
const mockIsAIClientInitialized = vi.mocked(isAIClientInitialized);

const db = {} as never;

const okOffer = (overrides: Record<string, unknown> = {}) => ({
  success: true as const,
  data: {
    offer: {
      id: 'offer_1',
      organizationId: 'org_1',
      originalPriceCents: 20000,
      offerPriceCents: 15000,
      discountPercent: 25,
      ...overrides,
    },
    serviceIds: [],
    locationIds: [],
  },
});

const okCopy = () => ({
  success: true as const,
  data: {
    headline: 'Glow this season',
    ctaText: 'Book now',
    urgencyText: 'Ends Sunday',
    audienceText: 'New clients',
    bulletPoints: ['Quick visit', 'Natural look'],
  },
});

describe('buildOfferCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Skip AI init — generateOfferCopy is mocked anyway.
    mockIsAIClientInitialized.mockReturnValue(true);
    mockGetOffer = vi.spyOn(
      getOfferModule,
      'getOffer'
    ) as unknown as MockInstance;
    mockGenerateOfferCopy = vi.spyOn(
      generateOfferCopyModule,
      'generateOfferCopy'
    ) as unknown as MockInstance;
    mockGetOrganizationBrand = vi.spyOn(
      getOrganizationBrandModule,
      'getOrganizationBrand'
    ) as unknown as MockInstance;
    mockGetOffer.mockResolvedValue(okOffer());
    mockGenerateOfferCopy.mockResolvedValue(okCopy());
    mockGetOrganizationBrand.mockResolvedValue({
      success: true,
      data: {
        primaryColor: '#111111',
        secondaryColor: '#EEEEEE',
        logoUrl: 'https://cdn/logo.png',
      },
    });
  });

  afterEach(() => {
    mockGetOffer.mockRestore();
    mockGenerateOfferCopy.mockRestore();
    mockGetOrganizationBrand.mockRestore();
  });

  it('assembles an offerCard from offer pricing + copy + brand', async () => {
    const result = await buildOfferCard(db, {
      organizationId: 'org_1',
      offerId: 'offer_1',
      serviceName: 'Lip Filler',
      businessName: 'Glow Clinic',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.offerCard).toMatchObject({
      serviceName: 'Lip Filler',
      headline: 'Glow this season',
      originalPriceCents: 20000,
      offerPriceCents: 15000,
      ctaText: 'Book now',
      businessName: 'Glow Clinic',
      primaryColor: '#111111',
      logoUrl: 'https://cdn/logo.png',
    });
    // The brand never shows a "% off" badge — the card renders Was/Now from
    // the two prices, so discountPercent is deliberately omitted.
    expect(result.data.offerCard.discountPercent).toBeUndefined();
    expect(mockGetOffer).toHaveBeenCalledWith(db, {
      id: 'offer_1',
      organizationId: 'org_1',
    });
  });

  it('returns the offer error when the offer is missing', async () => {
    mockGetOffer.mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.NOT_FOUND, 'Offer not found'),
    });

    const result = await buildOfferCard(db, {
      organizationId: 'org_1',
      offerId: 'missing',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    // Must not generate copy for an offer that doesn't belong to the org.
    expect(mockGenerateOfferCopy).not.toHaveBeenCalled();
  });

  it('still builds a card with default branding when brand lookup fails', async () => {
    mockGetOrganizationBrand.mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found'),
    });

    const result = await buildOfferCard(db, {
      organizationId: 'org_1',
      offerId: 'offer_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.offerCard.primaryColor).toBe('#007AFF');
    expect(result.data.offerCard.logoUrl).toBeUndefined();
  });
});
