import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listCalendarAccounts } from './list-calendar-accounts.service.js';

describe('listCalendarAccounts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  it('returns calendar accounts for organization', async () => {
    const mockAccounts = [
      {
        id: 'cal-1',
        provider: 'google',
        email: 'test@gmail.com',
        displayName: 'Test Calendar',
        isActive: true,
        lastSyncAt: null,
        tokenExpiresAt: new Date(),
        createdAt: new Date(),
      },
    ];

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockAccounts),
        }),
      }),
    });

    const result = await listCalendarAccounts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].provider).toBe('google');
    }
  });

  it('returns empty array when no accounts exist', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await listCalendarAccounts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listCalendarAccounts(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
