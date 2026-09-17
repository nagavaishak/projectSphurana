import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listActiveMetaIntegrations } from './list-active-meta-integrations.service.js';

describe('listActiveMetaIntegrations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('should return active integrations', async () => {
    mockDb.query.metaAdsIntegration.findMany.mockResolvedValueOnce([
      { organizationId: 'org_1' },
      { organizationId: 'org_2' },
    ]);

    const result = await listActiveMetaIntegrations(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].organizationId).toBe('org_1');
    }
  });

  it('should return empty array when none found', async () => {
    mockDb.query.metaAdsIntegration.findMany.mockResolvedValueOnce([]);

    const result = await listActiveMetaIntegrations(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.query.metaAdsIntegration.findMany.mockRejectedValueOnce(
      new Error('DB error')
    );

    const result = await listActiveMetaIntegrations(mockDb as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
