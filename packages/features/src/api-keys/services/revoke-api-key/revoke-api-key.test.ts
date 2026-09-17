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
import { revokeApiKey } from './revoke-api-key.service.js';

describe('revokeApiKey', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    keyId: 'key_123',
    organizationId: 'org_123',
  };

  it('should revoke an existing key', async () => {
    // Chain 1: select().from().where().limit() → resolves at limit
    mockDb.limit.mockResolvedValueOnce([{ id: 'key_123' }]);
    // Chain 2: delete().where() → resolves at where (second where call)
    // "once" queue is consumed in order, so:
    //   1st where() → returns mockDb (for .limit() chain) via mockImplementationOnce
    //   2nd where() → resolves [] (terminal of delete chain) via mockResolvedValueOnce
    mockDb.where
      .mockImplementationOnce(() => mockDb) // select chain: where() → this → .limit()
      .mockResolvedValueOnce([]); // delete chain: where() → resolves

    const result = await revokeApiKey(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when key does not exist', async () => {
    // select().from().where().limit() → empty means not found
    mockDb.where.mockImplementationOnce(() => mockDb);
    mockDb.limit.mockResolvedValueOnce([]);

    await expectResult(
      revokeApiKey(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND for key belonging to another organization', async () => {
    mockDb.where.mockImplementationOnce(() => mockDb);
    mockDb.limit.mockResolvedValueOnce([]);

    await expectResult(
      revokeApiKey(mockDb as never, {
        keyId: 'key_123',
        organizationId: 'other_org',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing keyId', async () => {
    await expectResult(
      revokeApiKey(mockDb as never, { organizationId: 'org_123' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      revokeApiKey(mockDb as never, { keyId: 'key_123' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty keyId', async () => {
    await expectResult(
      revokeApiKey(mockDb as never, { keyId: '', organizationId: 'org_123' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
