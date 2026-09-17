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
import { disconnectInstagram } from './disconnect-instagram.service.js';

describe('disconnectInstagram', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123' };

  it('should disconnect Instagram successfully', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig_123',
      organizationId: 'org_123',
    });

    const mockTxDelete = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.transaction.mockImplementationOnce(
      async (fn: (...args: unknown[]) => Promise<void>) => {
        await fn({ delete: mockTxDelete });
      }
    );

    const result = await disconnectInstagram(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.success).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when integration does not exist', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      disconnectInstagram(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      disconnectInstagram(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig_123',
      organizationId: 'org_123',
    });
    mockDb.transaction.mockRejectedValueOnce(new Error('DB error'));

    await expectResult(
      disconnectInstagram(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
