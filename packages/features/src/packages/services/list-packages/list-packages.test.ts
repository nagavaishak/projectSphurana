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
import { listPackages } from './list-packages.service.js';

describe('listPackages', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists packages with items', async () => {
    mockDb.query.organizationPackage.findMany.mockResolvedValueOnce([
      { id: 'p1', items: [] },
      { id: 'p2', items: [] },
    ]);

    const result = await listPackages(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(2);
  });

  it('returns VALIDATION_ERROR for missing org', async () => {
    await expectResult(
      listPackages(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
