import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockWhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { ErrorCodes } from '../../../shared/index.js';
import { createWhatsappTemplate } from './create-whatsapp-template.service.js';

const mockCreateTemplate = vi.mocked(mockWhatsAppCloudService.createTemplate);

const validInput = {
  organizationId: 'org-1',
  accountId: 'wa-1',
  name: 'welcome_message',
  category: 'MARKETING' as const,
  language: 'en',
  body: 'Hello {{1}}, welcome!',
};

describe('createWhatsappTemplate', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    mockDb._resetMocks();
    vi.mocked(decryptCredentials).mockReset();
    mockCreateTemplate.mockReset();
  });

  // --- Validation ---

  it('returns VALIDATION_ERROR for missing name', async () => {
    const result = await createWhatsappTemplate(mockDb as never, {
      ...validInput,
      name: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for uppercase name', async () => {
    const result = await createWhatsappTemplate(mockDb as never, {
      ...validInput,
      name: 'Welcome_Message',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for name with special chars', async () => {
    const result = await createWhatsappTemplate(mockDb as never, {
      ...validInput,
      name: 'welcome-message',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for body exceeding 1024 chars', async () => {
    const result = await createWhatsappTemplate(mockDb as never, {
      ...validInput,
      body: 'x'.repeat(1025),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for invalid category', async () => {
    const result = await createWhatsappTemplate(mockDb as never, {
      ...validInput,
      category: 'INVALID' as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for empty body', async () => {
    const result = await createWhatsappTemplate(mockDb as never, {
      ...validInput,
      body: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  // --- Account lookup ---

  it('returns NOT_FOUND when account does not exist', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await createWhatsappTemplate(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns NOT_FOUND when account belongs to different org', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await createWhatsappTemplate(mockDb as never, {
      ...validInput,
      organizationId: 'other-org',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  // --- Happy path ---

  it('creates template with all fields', async () => {
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
    mockCreateTemplate.mockResolvedValueOnce({
      id: 'template-1',
      status: 'PENDING',
    });

    const result = await createWhatsappTemplate(mockDb as never, {
      ...validInput,
      headerText: 'Welcome!',
      footerText: 'Reply STOP to opt out',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('template-1');
      expect(result.data.status).toBe('PENDING');
    }
    expect(mockCreateTemplate).toHaveBeenCalledWith('waba-1', {
      name: 'welcome_message',
      category: 'MARKETING',
      language: 'en',
      body: 'Hello {{1}}, welcome!',
      headerText: 'Welcome!',
      footerText: 'Reply STOP to opt out',
    });

    // The registered template is seeded into the campaign-side cache (as
    // `pending`) so the composer's picker sees it without a manual refresh.
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        name: 'welcome_message',
        languageCode: 'en',
        category: 'MARKETING',
        status: 'pending',
        body: 'Hello {{1}}, welcome!',
        metaTemplateId: 'template-1',
      })
    );
  });

  it('creates template without optional fields', async () => {
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
    mockCreateTemplate.mockResolvedValueOnce({
      id: 'template-2',
      status: 'APPROVED',
    });

    const result = await createWhatsappTemplate(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('template-2');
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

    const result = await createWhatsappTemplate(mockDb as never, validInput);

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
    mockCreateTemplate.mockRejectedValueOnce(
      new Error('WhatsApp API: Rate limit exceeded')
    );

    const result = await createWhatsappTemplate(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain('Rate limit exceeded');
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
    mockCreateTemplate.mockRejectedValueOnce('string error');

    const result = await createWhatsappTemplate(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain(
        'Failed to Create WhatsApp Template'
      );
    }
  });
});
