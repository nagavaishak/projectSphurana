import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listWhatsAppAccounts } from './list-whatsapp-accounts.service.js';

describe('listWhatsAppAccounts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  it('returns whatsapp accounts for organization', async () => {
    const mockAccounts = [
      {
        id: 'wa-1',
        provider: 'whatsapp_business',
        phoneNumber: '+1234567890',
        displayName: 'Business WhatsApp',
        isActive: true,
        lastSyncAt: null,
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

    const result = await listWhatsAppAccounts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(1);
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

    const result = await listWhatsAppAccounts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listWhatsAppAccounts(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
