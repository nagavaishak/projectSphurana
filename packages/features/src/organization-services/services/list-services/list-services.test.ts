import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listServices } from './list-services.service.js';

// Mock database exports to provide serviceCategoryValues for z.enum()

describe('listServices', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // listServiceIdsWithMedia ends its chain at `.where(...)`. Default to "no
    // services have media" so existing assertions are unaffected; individual
    // tests override with mockResolvedValueOnce to exercise hasGraphicMedia.
    mockDb.where.mockResolvedValue([]);
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return list of services', async () => {
    const mockServices = [
      {
        id: 'svc_1',
        organizationId: 'org_123',
        name: 'Haircut',
        category: 'treatment',
        sortOrder: 0,
        isActive: true,
        isCustom: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'svc_2',
        organizationId: 'org_123',
        name: 'Hair Coloring',
        category: 'treatment',
        sortOrder: 1,
        isActive: true,
        isCustom: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // Mock: findMany for items
    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce(mockServices)
      // Mock: findMany for count
      .mockResolvedValueOnce([{ id: 'svc_1' }, { id: 'svc_2' }]);

    const result = await listServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].name).toBe('Haircut');
      expect(result.data.items[1].name).toBe('Hair Coloring');
      expect(result.data.total).toBe(2);
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(0);
    }
  });

  it('annotates services with hasGraphicMedia from linked assets', async () => {
    const mockServices = [
      {
        id: 'svc_1',
        organizationId: 'org_123',
        name: 'Haircut',
        category: 'treatment',
        sortOrder: 0,
        isActive: true,
      },
      {
        id: 'svc_2',
        organizationId: 'org_123',
        name: 'Hair Coloring',
        category: 'treatment',
        sortOrder: 1,
        isActive: true,
      },
    ];

    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce(mockServices)
      .mockResolvedValueOnce([{ id: 'svc_1' }, { id: 'svc_2' }]);
    // listServiceIdsWithMedia: only svc_1 has eligible media.
    mockDb.where.mockResolvedValueOnce([{ serviceId: 'svc_1' }]);

    const result = await listServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      const byId = Object.fromEntries(
        result.data.items.map((s) => [s.id, s.hasGraphicMedia])
      );
      expect(byId.svc_1).toBe(true);
      expect(byId.svc_2).toBe(false);
    }
  });

  it('annotates services with hasVideoFootage from linked video clips', async () => {
    const mockServices = [
      {
        id: 'svc_1',
        organizationId: 'org_123',
        name: 'Haircut',
        category: 'treatment',
        sortOrder: 0,
        isActive: true,
      },
      {
        id: 'svc_2',
        organizationId: 'org_123',
        name: 'Hair Coloring',
        category: 'treatment',
        sortOrder: 1,
        isActive: true,
      },
    ];

    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce(mockServices)
      .mockResolvedValueOnce([{ id: 'svc_1' }, { id: 'svc_2' }]);
    // The two media lookups run via Promise.all, media first then footage:
    //   .where #1 = listServiceIdsWithMedia        → svc_1 has graphic media
    //   .where #2 = listServiceIdsWithVideoFootage → svc_2 has video footage
    mockDb.where
      .mockResolvedValueOnce([{ serviceId: 'svc_1' }])
      .mockResolvedValueOnce([{ serviceId: 'svc_2' }]);

    const result = await listServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      const byId = Object.fromEntries(
        result.data.items.map((s) => [
          s.id,
          { graphic: s.hasGraphicMedia, video: s.hasVideoFootage },
        ])
      );
      expect(byId.svc_1).toEqual({ graphic: true, video: false });
      expect(byId.svc_2).toEqual({ graphic: false, video: true });
    }
  });

  it('should return empty list when no services exist', async () => {
    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should filter by category', async () => {
    const inputWithCategory = {
      ...validInput,
      category: 'treatment' as const,
    };

    const mockServices = [
      {
        id: 'svc_1',
        organizationId: 'org_123',
        name: 'Haircut',
        category: 'treatment',
        sortOrder: 0,
        isActive: true,
      },
    ];

    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce(mockServices)
      .mockResolvedValueOnce([{ id: 'svc_1' }]);

    const result = await listServices(mockDb as never, inputWithCategory);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
    }
  });

  it('should filter by isActive', async () => {
    const inputWithActive = {
      ...validInput,
      isActive: true,
    };

    const mockServices = [
      {
        id: 'svc_1',
        organizationId: 'org_123',
        name: 'Haircut',
        category: 'treatment',
        isActive: true,
      },
    ];

    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce(mockServices)
      .mockResolvedValueOnce([{ id: 'svc_1' }]);

    const result = await listServices(mockDb as never, inputWithActive);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
    }
  });

  it('should apply pagination with limit and offset', async () => {
    const inputWithPagination = {
      ...validInput,
      limit: 10,
      offset: 20,
    };

    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listServices(mockDb as never, inputWithPagination);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
    }
  });

  it('should use default pagination values', async () => {
    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      organizationId: '',
    };

    await expectResult(
      listServices(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.organizationService.findMany).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for limit below minimum', async () => {
    const invalidInput = {
      ...validInput,
      limit: 0,
    };

    await expectResult(
      listServices(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for limit above maximum', async () => {
    const invalidInput = {
      ...validInput,
      limit: 101,
    };

    await expectResult(
      listServices(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for negative offset', async () => {
    const invalidInput = {
      ...validInput,
      offset: -1,
    };

    await expectResult(
      listServices(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid category', async () => {
    const invalidInput = {
      ...validInput,
      category: 'invalid_category',
    };

    await expectResult(
      listServices(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organizationService.findMany.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(listServices(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });

  // ── Per-branch pricing ───────────────────────────────────────────────────
  // `context_listServices` — the tool Claire quotes prices from — reads THIS
  // service over HTTP. If the branch override is not applied here she quotes
  // the org price to a customer of a branch that charges something else, and
  // nothing about the response shape reveals it (plan §3.3, risk 1).

  it('applies branch price / duration overrides to the listed services', async () => {
    const services = [
      {
        id: 'svc_1',
        organizationId: 'org_123',
        name: 'Botox',
        category: 'treatment',
        priceCents: 25000,
        appointmentDuration: 45,
        sortOrder: 0,
        isActive: true,
        isCustom: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'svc_2',
        organizationId: 'org_123',
        name: 'Filler',
        category: 'treatment',
        priceCents: 30000,
        appointmentDuration: 60,
        sortOrder: 1,
        isActive: true,
        isCustom: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce(services as never)
      .mockResolvedValueOnce([{ id: 'svc_1' }, { id: 'svc_2' }] as never);
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValueOnce(
      [] as never
    );
    // `organizationServiceLocation` is read TWICE, in this order: first for the
    // branch links each listed service carries (unfiltered by branch), then by
    // `loadServiceLocationOverrides` for this branch's price / duration.
    mockDb.query.organizationServiceLocation.findMany
      .mockResolvedValueOnce([
        { serviceId: 'svc_1', locationId: 'loc_cork' },
        { serviceId: 'svc_2', locationId: 'loc_cork' },
      ] as never)
      // Only svc_1 is repriced at this branch; svc_2 has no row and must keep
      // the org price rather than falling to null/zero.
      .mockResolvedValueOnce([
        {
          serviceId: 'svc_1',
          priceCentsOverride: 22000,
          durationMinutesOverride: null,
        },
      ] as never);

    const result = await listServices(mockDb as never, {
      ...validInput,
      locationId: 'loc_cork',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const [first, second] = result.data.items;
      expect(first.priceCents).toBe(22000);
      // durationMinutesOverride was NULL = inherit, not "no duration".
      expect(first.appointmentDuration).toBe(45);
      expect(second.priceCents).toBe(30000);
      expect(second.appointmentDuration).toBe(60);
      // The branch links ride along, so a caller can group services by branch.
      expect(first.locationIds).toEqual(['loc_cork']);
    }
  });

  it('reports NO branch links as an empty list, not as missing', async () => {
    const services = [
      {
        id: 'svc_1',
        organizationId: 'org_123',
        name: 'Botox',
        category: 'treatment',
        priceCents: 25000,
        appointmentDuration: 45,
        sortOrder: 0,
        isActive: true,
        isCustom: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce(services as never)
      .mockResolvedValueOnce([{ id: 'svc_1' }] as never);
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValueOnce(
      [] as never
    );
    mockDb.query.organizationServiceLocation.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // EMPTY MEANS EVERYWHERE — a consumer must never read this as "offered
    // nowhere" and hide the service.
    if (result.success) expect(result.data.items[0].locationIds).toEqual([]);
  });

  it('never reads the override table when no location is in play', async () => {
    mockDb.query.organizationService.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValueOnce(
      [] as never
    );

    const result = await listServices(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(
      mockDb.query.organizationServiceLocation.findMany
    ).not.toHaveBeenCalled();
  });

  it('applies the branch price to VARIANTS, not just the service row', async () => {
    // The case that motivated the variant join table. `priceCents` on a
    // variant-priced service is a "from"; overriding only that would move the
    // headline while every option it summarises stayed at the org price — the
    // headline and the list openly disagreeing, which is worse than no
    // override at all.
    // `mockReset` first, then PERMANENT stubs. Two separate hazards:
    //  - earlier tests in this file leave unconsumed `mockResolvedValueOnce`
    //    values queued, and `clearAllMocks` does not drain that queue — they
    //    fire ahead of anything set here.
    //  - this service issues several queries against these tables (items,
    //    count, media lookups, branch links), so a one-shot stub is consumed
    //    by whichever call runs first and the rest fall through.
    mockDb.query.organizationService.findMany.mockReset();
    mockDb.query.organizationServiceVariant.findMany.mockReset();
    mockDb.query.organizationServiceLocation.findMany.mockReset();
    mockDb.query.organizationServiceVariantLocation.findMany.mockReset();
    mockDb.query.organizationService.findMany.mockResolvedValue([
      {
        id: 'svc_1',
        organizationId: 'org_123',
        name: 'Botox',
        category: 'treatment',
        priceType: 'from',
        priceCents: 25000,
        appointmentDuration: 45,
        sortOrder: 0,
        isActive: true,
        isCustom: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValue([
      { id: 'var_1', serviceId: 'svc_1', name: '1 Area', priceCents: 25000 },
      { id: 'var_2', serviceId: 'svc_1', name: '2 Areas', priceCents: 40000 },
    ] as never);
    // Cork reprices the "from" AND the first option; the second is untouched
    // and must keep the org price rather than falling to null.
    mockDb.query.organizationServiceLocation.findMany.mockResolvedValue([
      {
        serviceId: 'svc_1',
        priceCentsOverride: 22000,
        durationMinutesOverride: null,
      },
    ] as never);
    mockDb.query.organizationServiceVariantLocation.findMany.mockResolvedValue([
      { variantId: 'var_1', priceCentsOverride: 22000 },
    ] as never);

    const result = await listServices(mockDb as never, {
      ...validInput,
      locationId: 'loc_cork',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const service = result.data.items[0];
      expect(service.priceCents).toBe(22000);
      const [one, two] = service.variants;
      expect(one.priceCents).toBe(22000);
      expect(two.priceCents).toBe(40000);
    }
  });

  it('never reads the variant override table when no branch is in play', async () => {
    mockDb.query.organizationService.findMany.mockReset();
    mockDb.query.organizationServiceVariant.findMany.mockReset();
    mockDb.query.organizationServiceVariantLocation.findMany.mockReset();
    mockDb.query.organizationService.findMany.mockResolvedValue([] as never);
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValue(
      [] as never
    );

    await listServices(mockDb as never, validInput);

    expect(
      mockDb.query.organizationServiceVariantLocation.findMany
    ).not.toHaveBeenCalled();
  });
});
