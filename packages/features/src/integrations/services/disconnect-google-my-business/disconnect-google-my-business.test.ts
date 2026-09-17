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
import { disconnectGoogleMyBusiness } from './disconnect-google-my-business.service.js';

describe('disconnectGoogleMyBusiness', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    accountId: 'gmb_123',
  };

  it('should disconnect account successfully', async () => {
    mockDb.delete.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([{ id: 'gmb_123' }]);

    const result = await disconnectGoogleMyBusiness(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when account does not exist', async () => {
    mockDb.delete.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      disconnectGoogleMyBusiness(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = { accountId: 'gmb_123' };

    await expectResult(
      disconnectGoogleMyBusiness(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.delete.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expectResult(
      disconnectGoogleMyBusiness(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
