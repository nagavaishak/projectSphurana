import {
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import type { ChannelSenders } from './channel-senders.js';
import { sendCampaignMessage } from './send-campaign-message.service.js';

const noopSenders: ChannelSenders = {
  email: async () => ({ messageId: '', success: false }),
  sms: async () => ({ messageId: '', success: false }),
  whatsapp: async () => ({ messageId: '', success: false }),
};

describe('sendCampaignMessage', () => {
  it('rejects invalid input with VALIDATION_ERROR before any IO', async () => {
    const mockDb = createMockDatabase();
    const result = await sendCampaignMessage(
      mockDb as never,
      { organizationId: 'org_1', recipientId: '' } as never,
      noopSenders
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('fails the recipient when the WhatsApp template is not approved', async () => {
    const mockDb = createMockDatabase();
    mockDb.query.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: 'r1',
      campaignId: 'c1',
      leadId: 'l1',
      channel: 'whatsapp',
      status: 'queued',
    });
    mockDb.query.campaignMessage.findFirst.mockResolvedValueOnce({
      id: 'm1',
      campaignId: 'c1',
      channel: 'whatsapp',
      subject: null,
      body: 'Hi {{firstName|there}}',
      whatsappTemplateId: 'tpl_1',
      whatsappTemplateParams: ['{{firstName|there}}'],
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'l1',
      firstName: 'Jane',
      whatsapp: '+15550101234',
      consentSms: true,
    });
    // Template got paused on Meta after the campaign was configured.
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValueOnce({
      id: 'tpl_1',
      name: 'june_offer',
      languageCode: 'en',
      status: 'paused',
    });

    const result = await sendCampaignMessage(
      mockDb as never,
      { organizationId: 'org_1', recipientId: 'r1' },
      noopSenders
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CHANNEL_NOT_CONFIGURED');
    }
    // Recipient marked failed with the template reason, not left queued.
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      status: 'failed',
      error: 'whatsapp_template_not_approved',
    });
  });

  it('releases the claim back to queued and retries on a retryable send failure (e.g. provider rate limit)', async () => {
    const mockDb = createMockDatabase();
    mockDb.query.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: 'r1',
      campaignId: 'c1',
      leadId: 'l1',
      channel: 'email',
      status: 'queued',
    });
    mockDb.query.campaignMessage.findFirst.mockResolvedValueOnce({
      id: 'm1',
      campaignId: 'c1',
      channel: 'email',
      subject: 'Hi {{firstName|there}}',
      body: 'Body',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'l1',
      firstName: 'Jane',
      email: 'jane@example.com',
      consentEmail: true,
    });
    mockDb.query.suppression.findMany.mockResolvedValueOnce([]);
    // Atomic claim succeeds (queued → sending).
    mockDb.returning.mockResolvedValueOnce([{ id: 'r1' }]);

    const rateLimitedSenders: ChannelSenders = {
      ...noopSenders,
      email: async () => ({
        messageId: '',
        success: false,
        error: 'Failed to send HTML email: Too many requests.',
        retryable: true,
      }),
    };

    const result = await sendCampaignMessage(
      mockDb as never,
      { organizationId: 'org_1', recipientId: 'r1' },
      rateLimitedSenders
    );

    // Reported as INTERNAL_ERROR — the shape the worker maps to a throw, so
    // BullMQ retries the job via its existing attempts/backoff.
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
    // Claim released back to 'queued' — NOT 'failed' — so the retried job
    // re-claims and re-sends instead of being skipped by the idempotency gate.
    expect(mockDb.set).toHaveBeenCalledWith({
      status: 'queued',
      error: 'Failed to send HTML email: Too many requests.',
    });
    expect(mockDb.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('still records a permanent failure when the send error is not retryable', async () => {
    const mockDb = createMockDatabase();
    mockDb.query.campaignRecipient.findFirst.mockResolvedValueOnce({
      id: 'r1',
      campaignId: 'c1',
      leadId: 'l1',
      channel: 'email',
      status: 'queued',
    });
    mockDb.query.campaignMessage.findFirst.mockResolvedValueOnce({
      id: 'm1',
      campaignId: 'c1',
      channel: 'email',
      subject: 'Hi {{firstName|there}}',
      body: 'Body',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'l1',
      firstName: 'Jane',
      email: 'jane@example.com',
      consentEmail: true,
    });
    mockDb.query.suppression.findMany.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([{ id: 'r1' }]);

    const invalidAddressSenders: ChannelSenders = {
      ...noopSenders,
      email: async () => ({
        messageId: '',
        success: false,
        error: 'Invalid `to` field',
      }),
    };

    const result = await sendCampaignMessage(
      mockDb as never,
      { organizationId: 'org_1', recipientId: 'r1' },
      invalidAddressSenders
    );

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith({
      status: 'failed',
      error: 'Invalid `to` field',
    });
  });
});
