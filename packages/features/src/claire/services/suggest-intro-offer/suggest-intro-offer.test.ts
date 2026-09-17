import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE modules, not the feature barrels: the barrels' re-exports are
// live getters under Vite SSR and cannot be redefined.
import * as listOffersModule from '../../../offers/services/list-offers/list-offers.service.js';
import * as getServiceModule from '../../../organization-services/services/get-service/get-service.service.js';
import { ErrorCodes, FeatureError } from '../../../shared/index.js';

import { suggestIntroOffer } from './suggest-intro-offer.service.js';

let mockListOffers: MockInstance;
let mockGetService: ReturnType<typeof vi.spyOn>;
const db = {} as never;

const okService = (overrides: Record<string, unknown> = {}) => ({
  success: true as const,
  data: {
    id: 'svc_1',
    name: 'Microneedling',
    priceText: '€180 per session',
    ...overrides,
  },
});

const okOffers = (items: Array<Record<string, unknown>>) => ({
  success: true as const,
  data: { items, total: items.length, limit: 50, offset: 0 },
});

describe('suggestIntroOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetService = vi.spyOn(getServiceModule, 'getService');
    mockGetService.mockResolvedValue(okService());
    mockListOffers = vi.spyOn(
      listOffersModule,
      'listOffers'
    ) as unknown as MockInstance;
    mockListOffers.mockResolvedValue(okOffers([]));
  });

  afterEach(() => {
    mockGetService.mockRestore();
    mockListOffers.mockRestore();
  });

  it('proposes a curated charm intro price from the owner-stated price', async () => {
    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      oneSessionPrice: 180,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.advisable).toBe(true);
    expect(result.data.needsPrice).toBe(false);
    expect(result.data.oneSessionPriceCents).toBe(18000);
    expect(result.data.priceSource).toBe('owner');
    expect(result.data.suggested).toMatchObject({
      discountType: 'fixed_price',
      originalPriceCents: 18000,
      // €180 interpolates between the 150→89 and 200→129 anchors, snapped to
      // the nearest charm price (€109).
      offerPriceCents: 10900,
      audienceText: 'New clients only',
      limitPerClient: true,
    });
    expect(result.data.suggested?.why).toMatch(/first-visit/i);
  });

  it('pulls the price from the service priceText and tags it for confirmation', async () => {
    // priceText is parseable ("€180 per session") and the owner gave no
    // number — pull it as a best-effort anchor and flag priceSource: 'parsed'
    // so Claire presents "Was €180, Now €X" for the owner to confirm/correct.
    mockGetService.mockResolvedValue(
      okService({ priceText: '€180 per session' })
    );
    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.needsPrice).toBe(false);
    expect(result.data.priceSource).toBe('parsed');
    expect(result.data.oneSessionPriceCents).toBe(18000);
    expect(result.data.suggested).toMatchObject({
      originalPriceCents: 18000,
      offerPriceCents: 10900, // €180 → curated €109
    });
  });

  it('maps regular prices to the curated intro-price anchors', async () => {
    const cases: Array<[regular: number, intro: number]> = [
      [100, 79],
      [150, 89],
      [200, 129],
      [300, 199],
      [500, 249],
    ];
    for (const [regular, intro] of cases) {
      const result = await suggestIntroOffer(db, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        oneSessionPrice: regular,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.suggested?.offerPriceCents).toBe(intro * 100);
    }
  });

  it('takes the lowest per-area price from a noisy priceText', async () => {
    // Body-contouring style listing — pull the lowest plausible figure as the
    // anchor; the owner corrects it at the confirmation gate if it's wrong.
    mockGetService.mockResolvedValue(
      okService({
        name: 'Fat Freezing',
        priceText: 'Buttocks £120, Abdomen £150, package of 3 from £400',
      })
    );
    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.needsPrice).toBe(false);
    expect(result.data.priceSource).toBe('parsed');
    expect(result.data.oneSessionPriceCents).toBe(12000); // lowest = £120
  });

  it('derives discountPercent from the curated intro price', async () => {
    mockGetService.mockResolvedValue(okService({ priceText: null }));
    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      oneSessionPrice: 100,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // €100 → curated €79, so the implied discount is 21%.
    expect(result.data.suggested?.offerPriceCents).toBe(7900);
    expect(result.data.suggested?.discountPercent).toBe(21);
  });

  it('asks for the price when it cannot be parsed and none is given', async () => {
    mockGetService.mockResolvedValue(okService({ priceText: 'POA' }));
    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.needsPrice).toBe(true);
    expect(result.data.suggested).toBeNull();
  });

  it('uses an owner-stated offer price verbatim and derives the discount', async () => {
    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      oneSessionPrice: 200,
      offerPrice: 120,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.suggested?.offerPriceCents).toBe(12000);
    expect(result.data.suggested?.originalPriceCents).toBe(20000);
    expect(result.data.suggested?.discountPercent).toBe(40); // (1 - 120/200)
  });

  it('builds an offer from an explicit offer price even when the regular price is unknown', async () => {
    mockGetService.mockResolvedValue(okService({ priceText: 'POA' }));
    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      offerPrice: 99,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.needsPrice).toBe(false);
    expect(result.data.suggested?.offerPriceCents).toBe(9900);
    expect(result.data.suggested?.originalPriceCents).toBeUndefined();
    expect(result.data.suggested?.discountPercent).toBeUndefined();
  });

  it('refuses a price offer for surgical services (consultation-led)', async () => {
    mockGetService.mockResolvedValue(
      okService({ name: 'Liposuction', priceText: '€4000' })
    );
    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.advisable).toBe(false);
    expect(result.data.advisoryReason).toMatch(/consultation/i);
    expect(result.data.suggested).toBeNull();
  });

  it('refuses a price offer for POM services', async () => {
    mockGetService.mockResolvedValue(
      okService({ name: 'Botox', priceText: '€200' })
    );
    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.advisable).toBe(false);
    expect(result.data.advisoryReason).toMatch(/prescription-only/i);
  });

  it('surfaces an existing new-client offer that already works as an intro', async () => {
    mockListOffers.mockResolvedValue(
      okOffers([
        {
          id: 'offer_good',
          name: 'New Client Microneedling',
          state: 'active',
          serviceIds: ['svc_1'],
          discountPercent: 33,
          originalPriceCents: null,
          offerPriceCents: null,
          limitPerClient: true,
        },
        {
          id: 'offer_not_newclient',
          name: 'Everyone Sale',
          state: 'active',
          serviceIds: ['svc_1'],
          discountPercent: 35,
          limitPerClient: false, // not new-client-only → not an intro fit
        },
      ])
    );

    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      oneSessionPrice: 180,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.existingFit?.offerId).toBe('offer_good');
    expect(result.data.existingFit?.impliedDiscountPercent).toBe(33);
    // A fresh suggestion is still offered as an alternative (price was given).
    expect(result.data.suggested).not.toBeNull();
  });

  it('ignores existing offers outside the intro discount band', async () => {
    mockListOffers.mockResolvedValue(
      okOffers([
        {
          id: 'offer_tiny',
          name: '10% loyalty',
          state: 'active',
          serviceIds: ['svc_1'],
          discountPercent: 10,
          limitPerClient: true,
        },
      ])
    );

    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.existingFit).toBeNull();
  });

  it('propagates a NOT_FOUND when the service is missing', async () => {
    mockGetService.mockResolvedValue({
      success: false,
      error: new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'),
    });

    const result = await suggestIntroOffer(db, {
      organizationId: 'org_1',
      serviceId: 'missing',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
