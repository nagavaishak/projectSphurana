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
import { reorderPackageItems } from './reorder-package-items.service.js';

describe('reorderPackageItems', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('reorders items in transaction', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_123',
    });
    mockDb.query.organizationPackageItem.findMany.mockResolvedValueOnce([
      { id: 'pi_1' },
      { id: 'pi_2' },
    ]);

    const result = await reorderPackageItems(mockDb as never, {
      packageId: 'pkg_123',
      organizationId: 'org_123',
      orderedIds: ['pi_2', 'pi_1'],
    });

    expect(result.success).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it('returns NOT_FOUND for missing package', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      reorderPackageItems(mockDb as never, {
        packageId: 'pkg_missing',
        organizationId: 'org_123',
        orderedIds: ['pi_1'],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });
});
