import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getService } from './get-service.service.js';

describe('getService', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'svc_123',
    organizationId: 'org_123',
  };

  it('should return service when found', async () => {
    const mockService = {
      id: 'svc_123',
      organizationId: 'org_123',
      name: 'Haircut',
      description: 'A standard haircut',
      category: 'treatment',
      sortOrder: 0,
      isCustom: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      mockService
    );

    const result = await getService(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(validInput.id);
      expect(result.data.name).toBe('Haircut');
      expect(result.data.organizationId).toBe(validInput.organizationId);
    }
  });

  it('should return NOT_FOUND when service does not exist', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(getService(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain('not found');
      }
    );
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      getService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.organizationService.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'svc_123',
    };

    await expectResult(
      getService(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.organizationService.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(
      getService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      id: 'svc_123',
      organizationId: '',
    };

    await expectResult(
      getService(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organizationService.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(getService(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });

  // ── Per-branch pricing ───────────────────────────────────────────────────
  // This is the Claire-safety case from the location redesign (plan §3.3):
  // once a service can be priced per branch, a read that ignores the override
  // quotes the WRONG PRICE to a real customer. The failure is silent — the
  // response shape is identical — so it can only be caught here.

  const baseService = {
    id: 'svc_123',
    organizationId: 'org_123',
    name: 'Botox',
    priceCents: 25000,
    appointmentDuration: 45,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('applies the branch price and duration override when a location is given', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      baseService as never
    );
    mockDb.query.organizationServiceLocation.findMany.mockResolvedValueOnce([
      {
        serviceId: 'svc_123',
        priceCentsOverride: 22000,
        durationMinutesOverride: 30,
      },
    ] as never);

    const result = await getService(mockDb as never, {
      ...validInput,
      locationId: 'loc_cork',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priceCents).toBe(22000);
      expect(result.data.appointmentDuration).toBe(30);
    }
  });

  it('inherits the org price where the override column is NULL', async () => {
    // NULL means "inherit", not "free" — a row can override duration only.
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      baseService as never
    );
    mockDb.query.organizationServiceLocation.findMany.mockResolvedValueOnce([
      {
        serviceId: 'svc_123',
        priceCentsOverride: null,
        durationMinutesOverride: 60,
      },
    ] as never);

    const result = await getService(mockDb as never, {
      ...validInput,
      locationId: 'loc_cork',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priceCents).toBe(25000);
      expect(result.data.appointmentDuration).toBe(60);
    }
  });

  it('returns the org price when the branch has no join row at all', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      baseService as never
    );
    mockDb.query.organizationServiceLocation.findMany.mockResolvedValueOnce(
      [] as never
    );

    const result = await getService(mockDb as never, {
      ...validInput,
      locationId: 'loc_cork',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priceCents).toBe(25000);
  });

  it('never reads the override table when no location is in play', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      baseService as never
    );

    const result = await getService(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priceCents).toBe(25000);
    expect(
      mockDb.query.organizationServiceLocation.findMany
    ).not.toHaveBeenCalled();
  });
});
