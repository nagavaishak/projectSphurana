import { mockSNSSMSService } from '@borradh-workspace/integrations';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import { testSms } from './test-sms.service.js';

const mockSendSMS = vi.mocked(mockSNSSMSService.sendSMS);

describe('testSms', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockSendSMS.mockReset();
  });

  const validInput = {
    to: '+1234567890',
    message: 'Hello {{lead.firstName}}, this is a test message!',
    organizationId: 'org_123',
  };

  it('should send test SMS successfully', async () => {
    mockSendSMS.mockResolvedValueOnce({
      success: true,
      messageId: 'msg_123',
    });

    const result = await testSms(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.messageId).toBe('msg_123');
    }
    expect(mockSendSMS).toHaveBeenCalledWith({
      phoneNumber: '+1234567890',
      message: 'Hello John, this is a test message!',
      senderId: undefined,
      smsType: 'Transactional',
    });
  });

  it('should replace all lead placeholders', async () => {
    mockSendSMS.mockResolvedValueOnce({
      success: true,
      messageId: 'msg_123',
    });

    const inputWithPlaceholders = {
      ...validInput,
      message:
        'Hi {{lead.firstName}} {{lead.lastName}}, call us at {{lead.phone}} or email {{lead.email}}',
    };

    await testSms(mockDb as never, inputWithPlaceholders);

    expect(mockSendSMS).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Hi John Doe, call us at +1 (555) 123-4567 or email john.doe@example.com',
      })
    );
  });

  it('should normalize phone number to E.164 format', async () => {
    mockSendSMS.mockResolvedValueOnce({ success: true, messageId: 'msg_123' });

    await testSms(mockDb as never, {
      ...validInput,
      to: '(555) 123-4567',
    });

    expect(mockSendSMS).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: '+5551234567',
      })
    );
  });

  it('should preserve leading plus in phone number', async () => {
    mockSendSMS.mockResolvedValueOnce({ success: true, messageId: 'msg_123' });

    await testSms(mockDb as never, {
      ...validInput,
      to: '+1 (555) 123-4567',
    });

    expect(mockSendSMS).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: '+15551234567',
      })
    );
  });

  it('should return VALIDATION_ERROR for missing to', async () => {
    const invalidInput = {
      message: 'Test message',
      organizationId: 'org_123',
    };

    const result = await testSms(mockDb as never, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing message', async () => {
    const invalidInput = {
      to: '+1234567890',
      organizationId: 'org_123',
    };

    const result = await testSms(mockDb as never, invalidInput as never);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR when SMS service fails', async () => {
    mockSendSMS.mockRejectedValueOnce(new Error('SMS delivery failed'));

    const result = await testSms(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain('SMS delivery failed');
    }
  });

  it('should return unsuccessful result when SMS returns failure', async () => {
    mockSendSMS.mockResolvedValueOnce({
      success: false,
      messageId: undefined,
    });

    const result = await testSms(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(false);
    }
  });
});
