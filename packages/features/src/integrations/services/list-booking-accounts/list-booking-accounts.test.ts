import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listBookingAccounts } from './list-booking-accounts.service.js';

describe('listBookingAccounts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  it('returns booking accounts for organization', async () => {
    const mockAccounts = [
      {
        id: 'booking-1',
        provider: 'calendly',
        email: 'test@example.com',
        displayName: 'Calendly Account',
        isActive: true,
        lastSyncAt: null,
        tokenExpiresAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'booking-2',
        provider: 'phorest',
        email: 'salon@example.com',
        displayName: 'Phorest Account',
        isActive: true,
        lastSyncAt: new Date(),
        tokenExpiresAt: new Date(),
        createdAt: new Date(),
      },
    ];

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(mockAccounts),
          }),
        }),
      }),
    });

    const result = await listBookingAccounts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(2);
  });

  it('returns empty array when no accounts exist', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const result = await listBookingAccounts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listBookingAccounts(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
