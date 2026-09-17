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
import { createPackage } from './create-package.service.js';

describe('createPackage', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Bridal Bundle',
    priceCents: 30000,
    items: [
      { serviceId: 'svc_1', quantity: 1, sortOrder: 0 },
      { serviceId: 'svc_2', quantity: 2, sortOrder: 1 },
    ],
  };

  it('creates a package and items in a transaction', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce(null);
    // db.select({...}).from(organizationService).where(...) returns the service id/org rows
    mockDb.where.mockResolvedValueOnce([
      { serviceId: 'svc_1', organizationId: 'org_123' },
      { serviceId: 'svc_2', organizationId: 'org_123' },
    ]);
    mockDb.returning
      .mockResolvedValueOnce([
        {
          id: 'pkg_123',
          name: validInput.name,
          organizationId: validInput.organizationId,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'pi_1', packageId: 'pkg_123', serviceId: 'svc_1' },
        { id: 'pi_2', packageId: 'pkg_123', serviceId: 'svc_2' },
      ]);

    const result = await createPackage(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
    }
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it('returns ALREADY_EXISTS when package name already exists', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_existing',
    });

    await expectResult(
      createPackage(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns VALIDATION_ERROR for empty items', async () => {
    await expectResult(
      createPackage(mockDb as never, {
        ...validInput,
        items: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for duplicate services', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createPackage(mockDb as never, {
        ...validInput,
        items: [
          { serviceId: 'svc_1', quantity: 1, sortOrder: 0 },
          { serviceId: 'svc_1', quantity: 2, sortOrder: 1 },
        ],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when services belong to a different org', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce(null);
    mockDb.where.mockResolvedValueOnce([
      { serviceId: 'svc_1', organizationId: 'org_other' },
      { serviceId: 'svc_2', organizationId: 'org_123' },
    ]);

    await expectResult(
      createPackage(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
