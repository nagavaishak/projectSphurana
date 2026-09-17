import {
  GmailOAuthService,
  GmailSendService,
  OutlookOAuthService,
  OutlookSendService,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import { testEmail } from './test-email.service.js';

const gmailSendInstance = new GmailSendService() as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const outlookSendInstance = new OutlookSendService() as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const gmailOAuthInstance = new GmailOAuthService() as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const outlookOAuthInstance = new OutlookOAuthService() as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

const mockGmailSend = gmailSendInstance.sendEmail;
const mockOutlookSend = outlookSendInstance.sendEmail;
const mockGmailRefresh = gmailOAuthInstance.refreshAccessToken;
const mockOutlookRefresh = outlookOAuthInstance.refreshAccessToken;

describe('testEmail', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockGmailSend.mockReset();
    mockOutlookSend.mockReset();
    mockGmailRefresh.mockReset();
    mockOutlookRefresh.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'decrypted_access_token',
      refreshToken: 'decrypted_refresh_token',
    });
    vi.mocked(encryptCredentials).mockReturnValue('encrypted_credentials');
  });

  const validInput = {
    emailAccountId: 'email_123',
    to: 'recipient@example.com',
    subject: 'Test Email for {{lead.firstName}}',
    body: '<p>Hello {{lead.firstName}} {{lead.lastName}}!</p>',
    organizationId: 'org_123',
  };

  const gmailAccount = {
    id: 'email_123',
    organizationId: 'org_123',
    provider: 'gmail',
    email: 'sender@gmail.com',
    isActive: true,
    encryptedCredentials: 'encrypted_data',
    tokenExpiresAt: new Date(Date.now() + 3600000), // 1 hour from now
  };

  const outlookAccount = {
    ...gmailAccount,
    provider: 'outlook',
    email: 'sender@outlook.com',
  };

  it('should send test email via Gmail successfully', async () => {
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(gmailAccount);
    mockGmailSend.mockResolvedValueOnce({ messageId: 'gmail_msg_123' });

    const result = await testEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.messageId).toBe('gmail_msg_123');
    }
    expect(mockGmailSend).toHaveBeenCalledWith({
      to: 'recipient@example.com',
      subject: 'Test Email for John',
      body: '<p>Hello John Doe!</p>',
      bodyType: 'html',
    });
  });

  it('should send test email via Outlook successfully', async () => {
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(outlookAccount);
    mockOutlookSend.mockResolvedValueOnce({});

    const result = await testEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockOutlookSend).toHaveBeenCalled();
  });

  it('should replace all lead placeholders', async () => {
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(gmailAccount);
    mockGmailSend.mockResolvedValueOnce({ messageId: 'msg_123' });

    const inputWithPlaceholders = {
      ...validInput,
      subject: 'Hello {{lead.name}}',
      body: 'Contact: {{lead.email}} / {{lead.phone}}',
    };

    await testEmail(mockDb as never, inputWithPlaceholders);

    expect(mockGmailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Hello John Doe',
        body: 'Contact: john.doe@example.com / +1 (555) 123-4567',
      })
    );
  });

  it('should refresh expired Gmail token', async () => {
    const expiredAccount = {
      ...gmailAccount,
      tokenExpiresAt: new Date(Date.now() - 1000), // Expired
    };
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(expiredAccount);
    mockGmailRefresh.mockResolvedValueOnce({
      accessToken: 'new_access_token',
      expiresIn: 3600,
    });
    mockGmailSend.mockResolvedValueOnce({ messageId: 'msg_123' });
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await testEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockGmailRefresh).toHaveBeenCalledWith('decrypted_refresh_token');
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should refresh expired Outlook token', async () => {
    const expiredAccount = {
      ...outlookAccount,
      tokenExpiresAt: new Date(Date.now() - 1000), // Expired
    };
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(expiredAccount);
    mockOutlookRefresh.mockResolvedValueOnce({
      accessToken: 'new_access_token',
      expiresIn: 3600,
    });
    mockOutlookSend.mockResolvedValueOnce({});
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await testEmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockOutlookRefresh).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when email account does not exist', async () => {
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(null);

    const result = await testEmail(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toContain('Email account not found');
    }
  });

  it('should return INVALID_STATE when email account is not active', async () => {
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce({
      ...gmailAccount,
      isActive: false,
    });

    const result = await testEmail(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
      expect(result.error.message).toContain('not active');
    }
  });

  it('should return INVALID_INPUT for unsupported email provider', async () => {
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce({
      ...gmailAccount,
      provider: 'yahoo',
    });

    const result = await testEmail(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_INPUT);
      expect(result.error.message).toContain('Unsupported email provider');
    }
  });

  it('should return VALIDATION_ERROR for missing emailAccountId', async () => {
    const invalidInput = {
      to: 'recipient@example.com',
      subject: 'Test',
      body: 'Body',
      organizationId: 'org_123',
    };

    const result = await testEmail(mockDb as never, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing to', async () => {
    const invalidInput = {
      emailAccountId: 'email_123',
      subject: 'Test',
      body: 'Body',
      organizationId: 'org_123',
    };

    const result = await testEmail(mockDb as never, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing subject', async () => {
    const invalidInput = {
      emailAccountId: 'email_123',
      to: 'recipient@example.com',
      body: 'Body',
      organizationId: 'org_123',
    };

    const result = await testEmail(mockDb as never, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR when email service fails', async () => {
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(gmailAccount);
    mockGmailSend.mockRejectedValueOnce(new Error('Gmail API error'));

    const result = await testEmail(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain('Gmail API error');
    }
  });
});
