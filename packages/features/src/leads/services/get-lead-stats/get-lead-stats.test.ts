import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getLeadStats } from './get-lead-stats.service.js';

describe('getLeadStats', () => {
  const mocks = {
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockGroupBy: vi.fn(),
  };

  const mockDb = { select: mocks.mockSelect } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ groupBy: mocks.mockGroupBy });
  });

  const validInput = { organizationId: 'org_123' };

  it('should return lead stats grouped by status', async () => {
    mocks.mockGroupBy.mockResolvedValueOnce([
      { status: 'new', count: 10 },
      { status: 'contacted', count: 5 },
      { status: 'booked', count: 3 },
      { status: 'lost', count: 2 },
    ]);

    const result = await getLeadStats(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalLeads).toBe(20);
      expect(result.data.newLeads).toBe(10);
      expect(result.data.contactedLeads).toBe(5);
      expect(result.data.bookedLeads).toBe(3);
      expect(result.data.lostLeads).toBe(2);
      expect(result.data.conversionRate).toBe(15);
    }
  });

  it('should return zero stats when no leads', async () => {
    mocks.mockGroupBy.mockResolvedValueOnce([]);

    const result = await getLeadStats(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalLeads).toBe(0);
      expect(result.data.conversionRate).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      getLeadStats(mockDb, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
