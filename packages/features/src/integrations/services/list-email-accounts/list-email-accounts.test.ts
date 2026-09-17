import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listEmailAccounts } from './list-email-accounts.service.js';

describe('listEmailAccounts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  it('returns email accounts for organization', async () => {
    const mockAccounts = [
      {
        id: 'email-1',
        provider: 'gmail',
        email: 'test@gmail.com',
        displayName: 'Test User',
        isActive: true,
        lastSyncAt: null,
        tokenExpiresAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'email-2',
        provider: 'outlook',
        email: 'test@outlook.com',
        displayName: 'Test User 2',
        isActive: true,
        lastSyncAt: new Date(),
        tokenExpiresAt: new Date(),
        createdAt: new Date(),
      },
    ];

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(mockAccounts),
      }),
    });

    const result = await listEmailAccounts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].email).toBe('test@gmail.com');
    }
  });

  it('returns empty array when no accounts exist', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await listEmailAccounts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listEmailAccounts(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
