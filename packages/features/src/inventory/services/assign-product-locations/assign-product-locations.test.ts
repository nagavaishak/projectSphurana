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
import { assignProductLocations } from './assign-product-locations.service.js';

describe('assignProductLocations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    productId: 'prod-1',
    organizationId: 'org-1',
    locationIds: ['loc-1'],
  };

  it('replaces the assignments', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce({
      id: 'prod-1',
    } as never);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);

    const result = await assignProductLocations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith([
      { productId: 'prod-1', locationId: 'loc-1' },
    ]);
  });

  it('an EMPTY array clears the rows — which means "stocked at everywhere"', async () => {
    // Zero join rows is the "available at every branch" default the read path
    // is built on, so `[]` RESTORES availability rather than removing it.
    mockDb.query.product.findFirst.mockResolvedValueOnce({
      id: 'prod-1',
    } as never);

    const result = await assignProductLocations(mockDb as never, {
      ...validInput,
      locationIds: [],
    });

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('de-duplicates a repeated branch instead of hitting the unique index', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce({
      id: 'prod-1',
    } as never);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);

    await assignProductLocations(mockDb as never, {
      ...validInput,
      locationIds: ['loc-1', 'loc-1'],
    });

    expect(mockDb.values).toHaveBeenCalledWith([
      { productId: 'prod-1', locationId: 'loc-1' },
    ]);
  });

  it('refuses a branch belonging to another org, and writes nothing', async () => {
    // The cross-tenant WRITE — the ids arrive in a request body.
    mockDb.query.product.findFirst.mockResolvedValueOnce({
      id: 'prod-1',
    } as never);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);

    await expectResult(
      assignProductLocations(mockDb as never, {
        ...validInput,
        locationIds: ['loc-1', 'loc-belonging-to-org-2'],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the parent belongs to another org', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce(undefined as never);

    await expectResult(
      assignProductLocations(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
