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
import { deletePackage } from './delete-package.service.js';

describe('deletePackage', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('deletes a package', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_123',
    });

    const result = await deletePackage(mockDb as never, {
      id: 'pkg_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND for missing package', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deletePackage(mockDb as never, {
        id: 'pkg_missing',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });
});
