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
import { removePackageItem } from './remove-package-item.service.js';

describe('removePackageItem', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('removes a package item', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_123',
    });
    mockDb.query.organizationPackageItem.findFirst.mockResolvedValueOnce({
      id: 'pi_1',
    });

    const result = await removePackageItem(mockDb as never, {
      packageId: 'pkg_123',
      itemId: 'pi_1',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND for missing item', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_123',
    });
    mockDb.query.organizationPackageItem.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      removePackageItem(mockDb as never, {
        packageId: 'pkg_123',
        itemId: 'pi_missing',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });
});
