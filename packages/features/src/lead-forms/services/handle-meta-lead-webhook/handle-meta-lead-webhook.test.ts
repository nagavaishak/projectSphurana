import crypto from 'node:crypto';
import {
  MetaApiError,
  decryptCredentials,
  mockMetaAdsService,
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

import {
  handleMetaLeadWebhook,
  verifyLeadWebhookChallenge,
} from './handle-meta-lead-webhook.service.js';

const mockGetLeadDetails = vi.mocked(mockMetaAdsService.getLeadDetails);

describe('handleMetaLeadWebhook', () => {
  const mockDb = createMockDatabase();
  const appSecret = 'test_app_secret';

  // Helper to create valid signature
  const createSignature = (payload: string, secret: string) => {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    return `sha256=${hash}`;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockGetLeadDetails.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'mock_access_token',
    });
    // A real INSERT ... RETURNING hands back the new row. The mock defaults to
    // `[]`, which `createMetaFormLead` correctly reads as "lost the insert
    // race" — so leaving it unstubbed would silently turn every creation into
    // a duplicate.
    mockDb.returning.mockResolvedValue([{ id: 'lead_inserted' }]);
  });

  const createValidPayload = (pageId: string, leadgenId: string) => ({
    object: 'page',
    entry: [
      {
        id: pageId,
        time: Date.now(),
        changes: [
          {
            field: 'leadgen',
            value: {
              form_id: 'form_123',
              leadgen_id: leadgenId,
              created_time: Date.now(),
              page_id: pageId,
            },
          },
        ],
      },
    ],
  });

  describe('validation', () => {
    it('should return VALIDATION_ERROR for missing payload', async () => {
      const input = { signature: 'sha256=abc' };

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        input as never,
        appSecret
      );

      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should return VALIDATION_ERROR for missing signature', async () => {
      const input = { payload: '{}' };

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        input as never,
        appSecret
      );

      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  describe('signature verification', () => {
    it('should return UNAUTHORIZED for invalid signature', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_123')
      );

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature: 'sha256=invalid' },
        appSecret
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
        expect(result.error.message).toBe('Invalid webhook signature');
      }
    });

    it('should return UNAUTHORIZED for signature without sha256 prefix', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_123')
      );

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature: 'invalid_signature' },
        appSecret
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
      }
    });
  });

  describe('payload parsing', () => {
    it('should return VALIDATION_ERROR for invalid JSON payload', async () => {
      const payload = 'not valid json';
      const signature = createSignature(payload, appSecret);

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toBe('Invalid JSON payload');
      }
    });

    it('should return VALIDATION_ERROR for invalid webhook format', async () => {
      const payload = JSON.stringify({ invalid: 'format' });
      const signature = createSignature(payload, appSecret);

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toBe('Invalid webhook payload format');
      }
    });
  });

  describe('lead processing', () => {
    it('should process valid lead webhook successfully', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_abc')
      );
      const signature = createSignature(payload, appSecret);

      // Mock: page found with integration (service uses metaAdsPage.findFirst with relation)
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });

      // Mock: no existing lead
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

      // Mock: no ad with assigned sequence
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

      // Mock: no active sequences with facebook_lead trigger
      mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

      // Mock: Meta API lead details
      mockGetLeadDetails.mockResolvedValueOnce({
        id: 'lead_abc',
        fieldData: [
          { name: 'first_name', values: ['John'] },
          { name: 'last_name', values: ['Doe'] },
          { name: 'email', values: ['john@example.com'] },
          { name: 'phone_number', values: ['+1234567890'] },
        ],
        createdTime: '2024-01-01T00:00:00Z',
        formId: 'form_123',
        adId: 'ad_123',
        campaignId: 'campaign_123',
      });

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(1);
        expect(result.data.processedLeads[0].facebookLeadId).toBe('lead_abc');
        expect(result.data.processedLeads[0].organizationId).toBe('org_123');
        expect(result.data.skippedCount).toBe(0);
      }
      expect(mockDb.insert).toHaveBeenCalled();
      // Verify the lead was created with meta_lead_form source
      const insertValues = mockDb.values.mock.calls[0][0];
      expect(insertValues.source).toBe('meta_lead_form');
    });

    // ENG-786: Meta sends `ad_id: null` / `adgroup_id: null` (an explicit null,
    // not an absent key) for organic submissions and for its own Test button.
    // `z.string().optional()` accepted undefined but REJECTED null, so the
    // strict payload parse failed, the controller returned 400, and the entire
    // webhook was dropped — Meta then retried for ~36h and gave up. Every
    // organic lead was lost this way, silently.
    it('should accept a leadgen payload with null ad_id/adgroup_id (ENG-786)', async () => {
      const payload = JSON.stringify({
        object: 'page',
        entry: [
          {
            id: 'page_123',
            time: Date.now(),
            changes: [
              {
                field: 'leadgen',
                value: {
                  form_id: 'form_123',
                  leadgen_id: 'lead_organic',
                  created_time: Date.now(),
                  page_id: 'page_123',
                  ad_id: null,
                  adgroup_id: null,
                },
              },
            ],
          },
        ],
      });
      const signature = createSignature(payload, appSecret);

      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
      mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

      mockGetLeadDetails.mockResolvedValueOnce({
        id: 'lead_organic',
        fieldData: [{ name: 'full_name', values: ['Organic Lead'] }],
        createdTime: '2024-01-01T00:00:00Z',
        formId: 'form_123',
      });

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(1);
      }
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should report the page ids Meta called us about (ENG-786)', async () => {
      const payload = JSON.stringify(
        createValidPayload('unknown_page', 'lead_x')
      );
      const signature = createSignature(payload, appSecret);

      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        // Silently `continue`ing on an unknown page is how the delivery gap
        // stayed invisible; the ids must reach the caller.
        expect(result.data.pageIds).toEqual(['unknown_page']);
        expect(result.data.unknownPageIds).toEqual(['unknown_page']);
      }
    });

    it('should skip lead if page is not connected to any organization', async () => {
      const payload = JSON.stringify(
        createValidPayload('unknown_page', 'lead_123')
      );
      const signature = createSignature(payload, appSecret);

      // Mock: no page found
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(0);
        expect(result.data.skippedCount).toBe(1);
      }
    });

    it('should skip lead if it already exists', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'existing_lead')
      );
      const signature = createSignature(payload, appSecret);

      // Mock: page found with integration
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });

      // Mock: existing lead found
      mockDb.query.lead.findFirst.mockResolvedValueOnce({
        id: 'lead_123',
        facebookLeadId: 'existing_lead',
        organizationId: 'org_123',
      });

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(0);
        expect(result.data.skippedCount).toBe(1);
      }
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should skip lead if Meta API fails to fetch details', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_abc')
      );
      const signature = createSignature(payload, appSecret);

      // Mock: page found with integration
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });

      // Mock: no existing lead
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

      // Mock: Meta API fails with an unclassified error
      mockGetLeadDetails.mockRejectedValueOnce(new Error('network exploded'));

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(0);
        expect(result.data.skippedCount).toBe(1);
      }
    });

    it('should skip lead and mark integration needs_reconnect on auth error (190)', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_abc')
      );
      const signature = createSignature(payload, appSecret);

      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
      // markMetaAdsNeedsReconnect looks the integration up before flipping it
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
        id: 'int_123',
        tokenStatus: 'valid',
      });

      mockGetLeadDetails.mockRejectedValueOnce(
        new MetaApiError({
          error: {
            message: 'Error validating access token',
            code: 190,
            error_subcode: 460,
          },
        })
      );

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(0);
        expect(result.data.skippedCount).toBe(1);
      }
      // The lead fetch was ATTEMPTED (no tokenStatus pre-skip)…
      expect(mockGetLeadDetails).toHaveBeenCalledTimes(1);
      // …and the integration was flipped to needs_reconnect afterwards.
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should skip remaining leads for a page after its token fails auth this run', async () => {
      const rawPayload = {
        object: 'page',
        entry: [
          {
            id: 'page_123',
            time: Date.now(),
            changes: [
              {
                field: 'leadgen',
                value: {
                  form_id: 'form_1',
                  leadgen_id: 'lead_1',
                  created_time: Date.now(),
                  page_id: 'page_123',
                },
              },
              {
                field: 'leadgen',
                value: {
                  form_id: 'form_2',
                  leadgen_id: 'lead_2',
                  created_time: Date.now(),
                  page_id: 'page_123',
                },
              },
            ],
          },
        ],
      };
      const payload = JSON.stringify(rawPayload);
      const signature = createSignature(payload, appSecret);

      mockDb.query.metaAdsPage.findFirst.mockResolvedValue({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValue(null);
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValue({
        id: 'int_123',
        tokenStatus: 'valid',
      });

      mockGetLeadDetails.mockRejectedValue(
        new MetaApiError({
          error: {
            message: 'Error validating access token',
            code: 190,
            error_subcode: 460,
          },
        })
      );

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(0);
        expect(result.data.skippedCount).toBe(2);
      }
      // Only the FIRST lead's fetch is attempted — the page is dead for the
      // rest of this run after the auth failure.
      expect(mockGetLeadDetails).toHaveBeenCalledTimes(1);
    });

    it('should warn-skip a deleted/unpermissioned lead (100/33) without failing', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_abc')
      );
      const signature = createSignature(payload, appSecret);

      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

      mockGetLeadDetails.mockRejectedValueOnce(
        new MetaApiError({
          error: {
            message: 'Unsupported get request. Object does not exist',
            code: 100,
            error_subcode: 33,
          },
        })
      );

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(0);
        expect(result.data.skippedCount).toBe(1);
      }
      // not_found is not an auth error — no needs_reconnect flip.
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should auto-assign sequence with facebook_lead trigger', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_abc')
      );
      const signature = createSignature(payload, appSecret);

      // Mock: page found with integration
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });

      // Mock: no existing lead
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

      // Mock: no ad with assigned sequence (leadData.adId lookup)
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

      // Mock: active sequence with facebook_lead trigger
      mockDb.query.sequence.findMany.mockResolvedValueOnce([
        {
          id: 'seq_123',
          name: 'Facebook Lead Sequence',
          organizationId: 'org_123',
          isActive: true,
          nodes: [
            {
              id: 'node_1',
              type: 'trigger',
              data: { metadata: { triggerType: 'facebook_lead' } },
            },
          ],
        },
      ]);

      // Mock: Meta API lead details
      mockGetLeadDetails.mockResolvedValueOnce({
        id: 'lead_abc',
        fieldData: [{ name: 'first_name', values: ['John'] }],
        createdTime: '2024-01-01T00:00:00Z',
        formId: 'form_123',
      });

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      expect(mockDb.insert).toHaveBeenCalled();
      // Verify sequence was assigned
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          sequenceId: 'seq_123',
          sequenceStatus: 'active',
        })
      );
    });

    it('should auto-consent based on provided contact fields', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_consent')
      );
      const signature = createSignature(payload, appSecret);

      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
      mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

      mockGetLeadDetails.mockResolvedValueOnce({
        id: 'lead_consent',
        fieldData: [
          { name: 'first_name', values: ['Alice'] },
          { name: 'email', values: ['alice@example.com'] },
          { name: 'phone_number', values: ['+1234567890'] },
        ],
        createdTime: '2024-01-01T00:00:00Z',
        formId: 'form_123',
      });

      await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          consentEmail: true,
          consentSms: true,
          consentVoice: true,
          consentSource: 'meta_form',
          consentedAt: expect.any(Date),
        })
      );
    });

    it('should not grant email consent when email is not provided', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_no_email')
      );
      const signature = createSignature(payload, appSecret);

      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
      mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

      mockGetLeadDetails.mockResolvedValueOnce({
        id: 'lead_no_email',
        fieldData: [
          { name: 'first_name', values: ['Bob'] },
          { name: 'phone_number', values: ['+1234567890'] },
        ],
        createdTime: '2024-01-01T00:00:00Z',
        formId: 'form_123',
      });

      await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          consentEmail: false,
          consentSms: true,
          consentVoice: true,
          consentSource: 'meta_form',
        })
      );
    });
  });

  describe('field extraction', () => {
    it('should not crash when a field has undefined values', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_no_values')
      );
      const signature = createSignature(payload, appSecret);

      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
      mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

      mockGetLeadDetails.mockResolvedValueOnce({
        id: 'lead_no_values',
        fieldData: [
          { name: 'first_name', values: undefined },
          { name: 'email', values: ['test@example.com'] },
        ],
        createdTime: '2024-01-01T00:00:00Z',
        formId: 'form_123',
      });

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(1);
      }
    });

    it('should not crash when field_data is entirely undefined (ENG-367)', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_no_fielddata')
      );
      const signature = createSignature(payload, appSecret);

      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
      mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

      // Meta lead detail with a missing field_data array — the exact shape
      // that produced "Cannot read properties of undefined (reading '0')".
      mockGetLeadDetails.mockResolvedValueOnce({
        id: 'lead_no_fielddata',
        fieldData: undefined,
        createdTime: '2024-01-01T00:00:00Z',
        formId: 'form_123',
      } as never);

      const result = await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      // Must ack (success) and still create the lead rather than crash/drop.
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedLeads).toHaveLength(1);
      }
      expect(mockDb.insert).toHaveBeenCalled();
      const insertValues = mockDb.values.mock.calls[0][0];
      expect(insertValues.firstName).toBe('Unknown');
    });

    it('should extract full_name and split into first/last', async () => {
      const payload = JSON.stringify(
        createValidPayload('page_123', 'lead_abc')
      );
      const signature = createSignature(payload, appSecret);

      // Mock: page found with integration
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
        id: 'page_1',
        pageId: 'page_123',
        integration: {
          id: 'int_123',
          organizationId: 'org_123',
          pageId: 'page_123',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted',
        },
      });
      mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

      // Mock: no ad with assigned sequence
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

      mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

      mockGetLeadDetails.mockResolvedValueOnce({
        id: 'lead_abc',
        fieldData: [{ name: 'full_name', values: ['John Doe Smith'] }],
        createdTime: '2024-01-01T00:00:00Z',
        formId: 'form_123',
      });

      await handleMetaLeadWebhook(
        mockDb as never,
        { payload, signature },
        appSecret
      );

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'John',
          lastName: 'Doe Smith',
        })
      );
    });
  });
});

describe('verifyLeadWebhookChallenge', () => {
  const verifyToken = 'my_verify_token';

  it('should return challenge when mode is subscribe and token matches', () => {
    const result = verifyLeadWebhookChallenge(
      'subscribe',
      verifyToken,
      'challenge_123',
      verifyToken
    );

    expect(result).toBe('challenge_123');
  });

  it('should return null when mode is not subscribe', () => {
    const result = verifyLeadWebhookChallenge(
      'other_mode',
      verifyToken,
      'challenge_123',
      verifyToken
    );

    expect(result).toBeNull();
  });

  it('should return null when token does not match', () => {
    const result = verifyLeadWebhookChallenge(
      'subscribe',
      'wrong_token',
      'challenge_123',
      verifyToken
    );

    expect(result).toBeNull();
  });
});
