import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { disconnectMetaIntegration } from './disconnect-meta-integration.service.js';

describe('disconnectMetaIntegration', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  it('disconnects meta integration successfully', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'meta-456',
      organizationId: 'org-123',
      adAccountId: 'act_123',
    });

    mockDb.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const result = await disconnectMetaIntegration(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when integration does not exist', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await disconnectMetaIntegration(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await disconnectMetaIntegration(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'meta-456',
      organizationId: 'org-123',
    });

    mockDb.delete.mockReturnValue({
      where: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await disconnectMetaIntegration(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
