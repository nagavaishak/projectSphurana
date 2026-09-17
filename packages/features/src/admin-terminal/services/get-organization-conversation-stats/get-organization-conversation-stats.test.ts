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
import { getOrganizationConversationStats } from './get-organization-conversation-stats.service.js';

describe('getOrganizationConversationStats', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_1' };

  /**
   * Each of the three count queries terminates at `.where()`, resolving to a
   * `[{ value }]` row. Order matches the service: total, today, last7Days.
   */
  function setupCountMocks(total: number, today: number, last7Days: number) {
    mockDb.where
      .mockResolvedValueOnce([{ value: total }])
      .mockResolvedValueOnce([{ value: today }])
      .mockResolvedValueOnce([{ value: last7Days }]);
  }

  it('should return today / last7Days / total counts', async () => {
    setupCountMocks(42, 3, 12);

    const result = await getOrganizationConversationStats(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(42);
      expect(result.data.today).toBe(3);
      expect(result.data.last7Days).toBe(12);
    }
  });

  it('should return zeros when the org has no conversations', async () => {
    setupCountMocks(0, 0, 0);

    const result = await getOrganizationConversationStats(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(0);
      expect(result.data.today).toBe(0);
      expect(result.data.last7Days).toBe(0);
    }
  });

  it('should handle a count row being undefined', async () => {
    mockDb.where
      .mockResolvedValueOnce([undefined])
      .mockResolvedValueOnce([undefined])
      .mockResolvedValueOnce([undefined]);

    const result = await getOrganizationConversationStats(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(0);
      expect(result.data.today).toBe(0);
      expect(result.data.last7Days).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR when organizationId is missing', async () => {
    await expectResult(
      getOrganizationConversationStats(mockDb as never, {
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should propagate database errors', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('Database connection failed'));

    await expect(
      getOrganizationConversationStats(mockDb as never, validInput)
    ).rejects.toThrow('Database connection failed');
  });
});
