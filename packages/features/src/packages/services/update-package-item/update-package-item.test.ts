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
import { updatePackageItem } from './update-package-item.service.js';

describe('updatePackageItem', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('updates an item quantity', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_123',
    });
    mockDb.query.organizationPackageItem.findFirst.mockResolvedValueOnce({
      id: 'pi_1',
      quantity: 1,
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'pi_1', quantity: 5 }]);

    const result = await updatePackageItem(mockDb as never, {
      packageId: 'pkg_123',
      itemId: 'pi_1',
      organizationId: 'org_123',
      quantity: 5,
    });

    expect(result.success).toBe(true);
  });

  it('returns NOT_FOUND for missing item', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_123',
    });
    mockDb.query.organizationPackageItem.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updatePackageItem(mockDb as never, {
        packageId: 'pkg_123',
        itemId: 'pi_missing',
        organizationId: 'org_123',
        quantity: 5,
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });
});
