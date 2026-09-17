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
import { listDriveAccounts } from './list-drive-accounts.service.js';

describe('listDriveAccounts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  it('returns drive accounts for organization', async () => {
    const mockAccounts = [
      {
        id: 'drive-1',
        email: 'user1@gmail.com',
        displayName: 'User One',
        profilePicture: null,
        isActive: true,
        lastSyncAt: null,
        tokenExpiresAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'drive-2',
        email: 'user2@gmail.com',
        displayName: 'User Two',
        profilePicture: 'https://example.com/photo.jpg',
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

    const result = await listDriveAccounts(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].email).toBe('user1@gmail.com');
    }
  });

  it('returns empty array when no accounts exist', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await listDriveAccounts(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listDriveAccounts(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
