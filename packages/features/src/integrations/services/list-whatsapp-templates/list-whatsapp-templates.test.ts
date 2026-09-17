import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockWhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { ErrorCodes } from '../../../shared/index.js';
import { listWhatsappTemplates } from './list-whatsapp-templates.service.js';

const mockListTemplates = vi.mocked(mockWhatsAppCloudService.listTemplates);

const validInput = {
  organizationId: 'org-1',
  accountId: 'wa-1',
};

describe('listWhatsappTemplates', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    mockDb._resetMocks();
    vi.mocked(decryptCredentials).mockReset();
    mockListTemplates.mockReset();
  });

  // --- Validation ---

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listWhatsappTemplates(mockDb as never, {
      ...validInput,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing accountId', async () => {
    const result = await listWhatsappTemplates(mockDb as never, {
      ...validInput,
      accountId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  // --- Account lookup ---

  it('returns NOT_FOUND when account does not exist', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await listWhatsappTemplates(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toContain('WhatsApp account not found');
    }
  });

  // --- Happy path ---

  it('lists templates successfully', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      organizationId: 'org-1',
      encryptedCredentials: 'encrypted-token',
      phoneNumberId: 'phone-1',
      wabaId: 'waba-1',
    });
    vi.mocked(decryptCredentials).mockReturnValueOnce({
      accessToken: 'decrypted-token',
    } as never);

    const mockTemplates = [
      { id: 'tmpl-1', name: 'welcome', status: 'APPROVED' },
      { id: 'tmpl-2', name: 'followup', status: 'PENDING' },
    ];
    mockListTemplates.mockResolvedValueOnce(mockTemplates);

    const result = await listWhatsappTemplates(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe('welcome');
    }
    expect(mockListTemplates).toHaveBeenCalledWith('waba-1');
  });

  it('returns empty array when no templates exist', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      organizationId: 'org-1',
      encryptedCredentials: 'encrypted-token',
      phoneNumberId: 'phone-1',
      wabaId: 'waba-1',
    });
    vi.mocked(decryptCredentials).mockReturnValueOnce({
      accessToken: 'decrypted-token',
    } as never);
    mockListTemplates.mockResolvedValueOnce([]);

    const result = await listWhatsappTemplates(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  // --- Error cases ---

  it('returns INTERNAL_ERROR when decryption fails', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      organizationId: 'org-1',
      encryptedCredentials: 'bad-encrypted',
      phoneNumberId: 'phone-1',
      wabaId: 'waba-1',
    });
    vi.mocked(decryptCredentials).mockImplementationOnce(() => {
      throw new Error('Decryption failed');
    });

    const result = await listWhatsappTemplates(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('returns INTERNAL_ERROR when API call fails', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      organizationId: 'org-1',
      encryptedCredentials: 'encrypted-token',
      phoneNumberId: 'phone-1',
      wabaId: 'waba-1',
    });
    vi.mocked(decryptCredentials).mockReturnValueOnce({
      accessToken: 'decrypted-token',
    } as never);
    mockListTemplates.mockRejectedValueOnce(
      new Error('WhatsApp API: Unauthorized')
    );

    const result = await listWhatsappTemplates(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain(
        'Failed to List WhatsApp Templates'
      );
    }
  });
});
