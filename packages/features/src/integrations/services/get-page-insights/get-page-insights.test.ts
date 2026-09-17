import { decryptCredentials } from '@borradh-workspace/integrations';
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

const hoisted = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

const mocks = {
  mockFetch: hoisted.mockFetch,
  mockDecryptCredentials: vi.mocked(decryptCredentials),
};

// Mock global fetch
vi.stubGlobal('fetch', mocks.mockFetch);

import { getPageInsights } from './get-page-insights.service.js';

describe('getPageInsights', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123' };

  it('should return page insights successfully', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      organizationId: 'org_123',
      isActive: true,
      defaultPageId: 'page_db_1',
    });
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page_db_1',
      pageId: 'page_fb_123',
      pageName: 'Test Page',
      pageAccessToken: 'encrypted_page_token',
      isActive: true,
    });
    mocks.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'page_access_token',
    });

    // Mock fetch for insights metrics
    mocks.mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                name: 'page_post_engagements',
                period: 'day',
                values: [{ value: 10, end_time: '2024-01-01T00:00:00' }],
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                name: 'page_daily_follows_unique',
                period: 'day',
                values: [{ value: 5, end_time: '2024-01-01T00:00:00' }],
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ followers_count: 1000 }),
      });

    const result = await getPageInsights(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageId).toBe('page_fb_123');
      expect(result.data.pageName).toBe('Test Page');
      expect(result.data.totalFollowers).toBe(1000);
      expect(result.data.engagements).toBe(10);
      expect(result.data.views).toBe(5);
    }
  });

  it('should return FORBIDDEN when no Meta integration', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getPageInsights(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);
  });

  it('should return FORBIDDEN when no page connected', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      organizationId: 'org_123',
      isActive: true,
      defaultPageId: null,
    });
    mockDb.query.metaAdsPage.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expectResult(
      getPageInsights(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);
  });

  it('should return INTERNAL_ERROR when decryption fails', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      organizationId: 'org_123',
      isActive: true,
      defaultPageId: 'page_db_1',
    });
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page_db_1',
      pageId: 'page_fb_123',
      pageAccessToken: 'encrypted_token',
    });
    mocks.mockDecryptCredentials.mockImplementationOnce(() => {
      throw new Error('Decryption failed');
    });

    await expectResult(
      getPageInsights(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      getPageInsights(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
