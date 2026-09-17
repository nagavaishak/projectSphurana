import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { handleSmsStatusWebhook } from './handle-sms-status-webhook.service.js';

describe('handleSmsStatusWebhook', () => {
  const mockDb = createMockDatabase();

  const recipient = {
    id: 'rcpt_1',
    campaignId: 'camp_1',
    providerMessageId: 'SM123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('marks the recipient delivered and appends a delivered event', async () => {
    mockDb.query.campaignRecipient.findFirst.mockResolvedValueOnce(recipient);

    const result = await handleSmsStatusWebhook(mockDb as never, {
      messageSid: 'SM123',
      messageStatus: 'delivered',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action).toBe('delivered');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivered' })
    );
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('marks the recipient failed on an undelivered callback', async () => {
    mockDb.query.campaignRecipient.findFirst.mockResolvedValueOnce(recipient);

    const result = await handleSmsStatusWebhook(mockDb as never, {
      messageSid: 'SM123',
      messageStatus: 'undelivered',
      errorCode: '30003',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action).toBe('failed_30003');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('suppresses the number when the carrier rejects with STOP-filtered (21610)', async () => {
    mockDb.query.campaignRecipient.findFirst.mockResolvedValueOnce(recipient);
    mockDb.query.campaign.findFirst.mockResolvedValueOnce({
      organizationId: 'org_1',
    });

    const result = await handleSmsStatusWebhook(mockDb as never, {
      messageSid: 'SM123',
      messageStatus: 'undelivered',
      errorCode: '21610',
      to: '+1 (555) 010-1234',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action).toBe('failed_stop_filtered');
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        channel: 'sms',
        contact: '+15550101234',
        reason: 'stop',
      })
    );
  });

  it('ignores interim states so a late callback cannot regress delivered', async () => {
    const result = await handleSmsStatusWebhook(mockDb as never, {
      messageSid: 'SM123',
      messageStatus: 'sent',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action).toBe('ignored');
    expect(mockDb.query.campaignRecipient.findFirst).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('no-ops on an unknown message sid', async () => {
    mockDb.query.campaignRecipient.findFirst.mockResolvedValueOnce(undefined);

    const result = await handleSmsStatusWebhook(mockDb as never, {
      messageSid: 'SM_unknown',
      messageStatus: 'delivered',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action).toBe('unknown_recipient');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when messageStatus is missing', async () => {
    const result = await handleSmsStatusWebhook(mockDb as never, {
      messageSid: 'SM123',
      messageStatus: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
