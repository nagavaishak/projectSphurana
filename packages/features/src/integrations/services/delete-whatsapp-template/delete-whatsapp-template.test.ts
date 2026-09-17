import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockWhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { ErrorCodes } from '../../../shared/index.js';
import { deleteWhatsappTemplate } from './delete-whatsapp-template.service.js';

const mockDeleteTemplate = vi.mocked(mockWhatsAppCloudService.deleteTemplate);

const validInput = {
  organizationId: 'org-1',
  accountId: 'wa-1',
  templateName: 'welcome_message',
};

describe('deleteWhatsappTemplate', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    mockDb._resetMocks();
    vi.mocked(decryptCredentials).mockReset();
    mockDeleteTemplate.mockReset();
  });

  // --- Validation ---

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await deleteWhatsappTemplate(mockDb as never, {
      ...validInput,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing accountId', async () => {
    const result = await deleteWhatsappTemplate(mockDb as never, {
      ...validInput,
      accountId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing templateName', async () => {
    const result = await deleteWhatsappTemplate(mockDb as never, {
      ...validInput,
      templateName: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  // --- Account lookup ---

  it('returns NOT_FOUND when account does not exist', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await deleteWhatsappTemplate(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toContain('WhatsApp account not found');
    }
  });

  // --- Happy path ---

  it('deletes template successfully', async () => {
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
    mockDeleteTemplate.mockResolvedValueOnce(undefined);

    const result = await deleteWhatsappTemplate(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockDeleteTemplate).toHaveBeenCalledWith(
      'waba-1',
      'welcome_message'
    );
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

    const result = await deleteWhatsappTemplate(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('returns INTERNAL_ERROR with API error message', async () => {
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
    mockDeleteTemplate.mockRejectedValueOnce(
      new Error('Template not found in WABA')
    );

    const result = await deleteWhatsappTemplate(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain('Template not found in WABA');
    }
  });

  it('returns INTERNAL_ERROR with generic message for non-Error throws', async () => {
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
    mockDeleteTemplate.mockRejectedValueOnce('string error');

    const result = await deleteWhatsappTemplate(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain(
        'Failed to Delete WhatsApp Template'
      );
    }
  });
});
