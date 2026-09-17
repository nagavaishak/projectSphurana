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
import { getPackage } from './get-package.service.js';

describe('getPackage', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns package with items', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce({
      id: 'pkg_123',
      organizationId: 'org_123',
      items: [
        {
          id: 'pi_1',
          variantId: 'v1',
          variant: { id: 'v1', name: 'Standard' },
        },
      ],
    });

    const result = await getPackage(mockDb as never, {
      id: 'pkg_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
    }
  });

  it('returns NOT_FOUND for missing package', async () => {
    mockDb.query.organizationPackage.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getPackage(mockDb as never, {
        id: 'pkg_missing',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });
});
