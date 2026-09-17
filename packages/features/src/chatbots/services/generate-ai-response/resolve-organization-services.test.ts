import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOrganizationServices } from './resolve-organization-services.js';

// `@borradh-workspace/env/api` is canonically aliased in vite.config.ts to
// `src/__mocks__/env-api.ts` (a static fake config). A per-file
// `vi.mock('@borradh-workspace/env/api', ...)` would install into the SHARED
// module registry and race with whichever file loads the env module first
// under `isolate: false`. We assert against the canonical mock's `WEB_URL`.
const MOCK_MARKETING_URL = 'https://mock-marketing.example.com';

describe('resolveOrganizationServices', () => {
  const mockDb = createMockDatabase();

  const makeService = (id: string, name: string) => ({
    id,
    name,
    pricingDescription: null,
    requiresDeposit: false,
    depositAmountCents: null,
    depositLink: null,
    appointmentDuration: 60,
    description: null,
    isActive: true,
    sortOrder: 0,
    organizationId: 'org-1',
  });

  /** An org on its defaults: nothing due online unless a service says so. */
  const baseOrg = {
    defaultPaymentPolicy: 'in_clinic' as const,
    defaultDepositBasis: 'fixed' as const,
    defaultDepositPercent: null,
    depositAggregation: 'sum' as const,
    depositEnabled: false,
    depositAmount: null,
  };

  const baseInput = {
    organizationId: 'org-1',
    orgSlug: 'test-clinic',
    convMetadata: null,
    primaryCalendarType: 'borradh',
    defaultBookingLink: null,
    // No live custom domain — the path tier. Resolved by the caller, once per
    // turn, and passed in so this per-service loop cannot query per service.
    micrositePrimaryDomain: null,
    org: baseOrg,
  };

  describe('per-branch prices', () => {
    /**
     * Claire must quote the price of the BRANCH the conversation is about.
     * Quoting the org's base price to a customer asking about Cork is a wrong
     * number said to a real person, and it is invisible from the outside — the
     * reply is well-formed either way.
     */
    const priced = (id: string, name: string) => ({
      ...makeService(id, name),
      priceType: 'fixed' as const,
      priceCents: 25000,
      requiresDeposit: true,
      // A PERCENTAGE deposit, deliberately: it is computed FROM the price, so
      // it only lands correctly if the branch override is applied first.
      depositAmountCents: null,
    });

    const orgWithPercentDeposit = {
      ...baseOrg,
      defaultPaymentPolicy: 'deposit' as const,
      defaultDepositBasis: 'percent' as const,
      defaultDepositPercent: 20,
      depositEnabled: true,
    };

    it('quotes the branch price, and derives the deposit from it', async () => {
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([
        priced('svc-1', 'Deluxe Facial'),
      ]);
      mockDb.query.organizationServiceLocation.findMany.mockResolvedValueOnce([
        {
          serviceId: 'svc-1',
          priceCentsOverride: 22000,
          durationMinutesOverride: null,
        },
      ]);

      const { services } = await resolveOrganizationServices(mockDb as never, {
        ...baseInput,
        org: orgWithPercentDeposit,
        locationId: 'loc-cork',
      });

      // €220, the branch's price — not the org's €250.
      expect(services[0]?.pricingDescription).toContain('220');
      expect(services[0]?.pricingDescription).not.toContain('250');
      // AND the deposit follows it: 20% of 22000, not of 25000. Applying the
      // override after the deposit was computed would quote €220 and charge
      // €50 — the quote/charge split this ordering exists to prevent.
      expect(services[0]?.depositCents).toBe(4400);
    });

    it('sends a link to the SAME branch it quoted the price of', async () => {
      // The pairing is the point. Claire quoting Cork's €220 beside a link that
      // asks "which branch?" is a question she has the answer to; quoting
      // Cork's €220 beside a link to Dublin is worse than either alone.
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([
        priced('svc-1', 'Deluxe Facial'),
      ]);
      mockDb.query.organizationServiceLocation.findMany.mockResolvedValueOnce([
        {
          serviceId: 'svc-1',
          priceCentsOverride: 22000,
          durationMinutesOverride: null,
        },
      ]);

      const { services } = await resolveOrganizationServices(mockDb as never, {
        ...baseInput,
        org: orgWithPercentDeposit,
        locationId: 'loc-cork',
        branchSegment: 'cork',
      });

      expect(services[0]?.pricingDescription).toContain('220');
      expect(services[0]?.bookingFormUrl).toContain('/l/cork/book/svc-1');
    });

    it('sends a branch-less link when it has no branch to name', async () => {
      // Safe rather than wrong: that URL lands on the chooser with the service
      // carried through, so nobody is silently booked into the primary branch.
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([
        priced('svc-1', 'Deluxe Facial'),
      ]);

      const { services } = await resolveOrganizationServices(mockDb as never, {
        ...baseInput,
        org: orgWithPercentDeposit,
        locationId: null,
        branchSegment: null,
      });

      expect(services[0]?.bookingFormUrl).toContain('/book/svc-1');
      expect(services[0]?.bookingFormUrl).not.toContain('/l/');
    });

    it('quotes the org price when no branch is known', async () => {
      // A multi-branch org that has told us nothing. Guessing a branch here
      // would be a fabricated number; the org's own price is the honest answer.
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([
        priced('svc-1', 'Deluxe Facial'),
      ]);

      const { services } = await resolveOrganizationServices(mockDb as never, {
        ...baseInput,
        org: orgWithPercentDeposit,
        locationId: null,
      });

      expect(services[0]?.pricingDescription).toContain('250');
      expect(services[0]?.depositCents).toBe(5000);
      // The override table must not even be consulted without a branch.
      expect(
        mockDb.query.organizationServiceLocation.findMany
      ).not.toHaveBeenCalled();
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('should return ad-specific services when ad has linked services', async () => {
    const svc = makeService('svc-1', 'Botox');
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad-1',
      services: [{ service: svc }],
    });

    const result = await resolveOrganizationServices(mockDb as never, {
      ...baseInput,
      convMetadata: { adInternalId: 'ad-1' },
    });

    expect(result.services).toHaveLength(1);
    expect(result.services[0]?.name).toBe('Botox');
  });

  it('should fall back to org-wide services when ad has none', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad-1',
      services: [],
    });

    const svc = makeService('svc-3', 'Laser');
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([svc]);

    const result = await resolveOrganizationServices(mockDb as never, {
      ...baseInput,
      convMetadata: { adInternalId: 'ad-1' },
    });

    expect(result.services).toHaveLength(1);
    expect(result.services[0]?.name).toBe('Laser');
  });

  it('should return all org services when no ad context', async () => {
    const svc = makeService('svc-3', 'Laser');
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([svc]);

    const result = await resolveOrganizationServices(
      mockDb as never,
      baseInput
    );

    expect(result.services).toHaveLength(1);
    expect(result.services[0]?.name).toBe('Laser');
  });

  it('should return empty array when no services exist anywhere', async () => {
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);

    const result = await resolveOrganizationServices(
      mockDb as never,
      baseInput
    );

    expect(result.services).toHaveLength(0);
  });

  it('should build booking URLs from serviceId directly', async () => {
    const svc = makeService('svc-1', 'Botox');
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([svc]);

    const result = await resolveOrganizationServices(
      mockDb as never,
      baseInput
    );

    expect(result.services[0]?.bookingFormUrl).toBe(
      `${MOCK_MARKETING_URL}/sites/test-clinic/book/svc-1`
    );
  });

  it("builds booking URLs on the tenant's own host once their domain is live", async () => {
    const svc = makeService('svc-1', 'Botox');
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([svc]);

    const result = await resolveOrganizationServices(mockDb as never, {
      ...baseInput,
      micrositePrimaryDomain: 'glowaesthetics.ie',
    });

    // Full url, host included: Claire quoting OUR domain to a tenant's
    // customers is the failure this whole change exists to prevent.
    expect(result.services[0]?.bookingFormUrl).toBe(
      'https://glowaesthetics.ie/book/svc-1'
    );
    expect(result.services[0]?.bookingFormUrl).not.toContain('/sites/');
  });

  it('should handle null service in ad services gracefully', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad-1',
      services: [{ service: null }, { service: makeService('svc-1', 'Botox') }],
    });

    const result = await resolveOrganizationServices(mockDb as never, {
      ...baseInput,
      convMetadata: { adInternalId: 'ad-1' },
    });

    expect(result.services).toHaveLength(1);
    expect(result.services[0]?.name).toBe('Botox');
  });

  it('should not build booking URLs when orgSlug is null', async () => {
    const svc = makeService('svc-1', 'Botox');
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([svc]);

    const result = await resolveOrganizationServices(mockDb as never, {
      ...baseInput,
      orgSlug: null,
    });

    expect(result.services[0]?.bookingFormUrl).toBeNull();
  });

  it('should not build per-service URLs when using external calendar', async () => {
    const svc = makeService('svc-1', 'Botox');
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([svc]);

    const result = await resolveOrganizationServices(mockDb as never, {
      ...baseInput,
      primaryCalendarType: 'calendly',
      defaultBookingLink: 'https://calendly.com/my-clinic',
    });

    expect(result.services[0]?.bookingFormUrl).toBeNull();
  });

  it('should handle ad not found for adInternalId', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);

    const result = await resolveOrganizationServices(mockDb as never, {
      ...baseInput,
      convMetadata: { adInternalId: 'nonexistent' },
    });

    expect(result.services).toHaveLength(0);
  });

  describe('Tier 2: Page-level ad services', () => {
    it('should use services from active page ads when no ad referral', async () => {
      const svc = makeService('svc-1', 'Botox');
      mockDb.query.metaAd.findMany.mockResolvedValueOnce([
        {
          id: 'ad-1',
          metaAdId: '120239552387420330',
          status: 'active',
          services: [{ service: svc }],
        },
      ]);

      const result = await resolveOrganizationServices(mockDb as never, {
        ...baseInput,
        metaAdsPageId: 'page-1',
      });

      expect(result.services).toHaveLength(1);
      expect(result.services[0]?.name).toBe('Botox');
    });

    it('should deduplicate services across multiple ads on same page', async () => {
      const svc1 = makeService('svc-1', 'Botox');
      const svc2 = makeService('svc-2', 'Filler');
      mockDb.query.metaAd.findMany.mockResolvedValueOnce([
        { id: 'ad-1', services: [{ service: svc1 }] },
        { id: 'ad-2', services: [{ service: svc1 }, { service: svc2 }] },
      ]);

      const result = await resolveOrganizationServices(mockDb as never, {
        ...baseInput,
        metaAdsPageId: 'page-1',
      });

      expect(result.services).toHaveLength(2);
    });

    it('should fall back to Tier 3 when page ads have no services', async () => {
      mockDb.query.metaAd.findMany.mockResolvedValueOnce([
        { id: 'ad-1', services: [] },
      ]);
      const svc = makeService('svc-3', 'Laser');
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([svc]);

      const result = await resolveOrganizationServices(mockDb as never, {
        ...baseInput,
        metaAdsPageId: 'page-1',
      });

      expect(result.services).toHaveLength(1);
      expect(result.services[0]?.name).toBe('Laser');
    });

    it('should skip Tier 2 when metaAdsPageId is not provided', async () => {
      const svc = makeService('svc-3', 'Laser');
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([svc]);

      const result = await resolveOrganizationServices(
        mockDb as never,
        baseInput
      );

      expect(mockDb.query.metaAd.findMany).not.toHaveBeenCalled();
      expect(result.services).toHaveLength(1);
      expect(result.services[0]?.name).toBe('Laser');
    });

    it('should prefer Tier 1 over Tier 2', async () => {
      const adSvc = makeService('svc-1', 'Ad-Specific Botox');
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
        id: 'ad-1',
        services: [{ service: adSvc }],
      });

      const result = await resolveOrganizationServices(mockDb as never, {
        ...baseInput,
        convMetadata: { adInternalId: 'ad-1' },
        metaAdsPageId: 'page-1',
      });

      expect(result.services).toHaveLength(1);
      expect(result.services[0]?.name).toBe('Ad-Specific Botox');
      // Tier 2 should NOT be called since Tier 1 succeeded
      expect(mockDb.query.metaAd.findMany).not.toHaveBeenCalled();
    });
  });

  describe('structured pricing (formatServicePrice)', () => {
    // Raw org service with the STRUCTURED price model. The legacy `priceText`
    // is intentionally absent — pricingDescription must be derived from
    // priceType + priceCents + the org-country currency symbol.
    const makePricedService = (
      id: string,
      priceType: string,
      priceCents: number | null
    ) => ({
      id,
      name: `Service ${id}`,
      priceType,
      priceCents,
      requiresDeposit: false,
      depositAmountCents: null,
      depositLink: null,
      appointmentDuration: 60,
      description: null,
      isActive: true,
      sortOrder: 0,
      organizationId: 'org-1',
    });

    it('derives pricingDescription from priceType/priceCents with the org-country currency', async () => {
      // Tier 3: all active org services.
      mockDb.query.organizationService.findMany.mockResolvedValueOnce([
        makePricedService('from', 'from', 8000),
        makePricedService('fixed', 'fixed', 12000),
        makePricedService('poa', 'poa', null),
        makePricedService('free', 'free', null),
      ]);

      const result = await resolveOrganizationServices(mockDb as never, {
        ...baseInput,
        orgCountry: 'ie',
      });

      const byName = Object.fromEntries(
        result.services.map((s) => [s.name, s.pricingDescription])
      );

      expect(byName['Service from']).toBe('From €80');
      expect(byName['Service fixed']).toBe('€120');
      expect(byName['Service poa']).toBe('Price on consultation');
      expect(byName['Service free']).toBe('Free');
    });
  });
});
