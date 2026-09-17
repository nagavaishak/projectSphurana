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
import { disconnectWhatsAppAccount } from './disconnect-whatsapp-account.service.js';

describe('disconnectWhatsAppAccount', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    accountId: 'wa_123',
  };

  it('should disconnect WhatsApp account successfully', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa_123',
      organizationId: 'org_123',
      phoneNumber: '+1 555 123 4567',
    });
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await disconnectWhatsAppAccount(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when account does not exist', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      disconnectWhatsAppAccount(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain('WhatsApp account not found');
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      accountId: 'wa_123',
    };

    await expectResult(
      disconnectWhatsAppAccount(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing accountId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      disconnectWhatsAppAccount(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa_123',
      organizationId: 'org_123',
    });
    mockDb.delete.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Database error'));

    await expectResult(
      disconnectWhatsAppAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
