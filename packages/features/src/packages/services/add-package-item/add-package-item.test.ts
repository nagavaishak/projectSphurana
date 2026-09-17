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
import { addPackageItem } from './add-package-item.service.js';

describe('addPackageItem', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    packageId: 'pkg_123',
    organizationId: 'org_123',
    serviceId: 'svc_1',
    quantity: 1,
    sortOrder: 0,
  };

  it('adds a package item', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_123',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
    });
    mockDb.query.organizationPackageItem.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'pi_1', packageId: 'pkg_123', serviceId: 'svc_1' },
    ]);

    const result = await addPackageItem(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('returns CONFLICT when service already in package', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_123',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
    });
    mockDb.query.organizationPackageItem.findFirst.mockResolvedValueOnce({
      id: 'pi_existing',
    });

    await expectResult(
      addPackageItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT);
  });

  it('returns NOT_FOUND for missing package', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      addPackageItem(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });
});
