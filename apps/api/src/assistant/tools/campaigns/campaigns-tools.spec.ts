import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { checkChannelsTool } from './check-channels.tool.js';
import { createCampaignTool } from './create-campaign.tool.js';
import { createSegmentTool } from './create-segment.tool.js';
import { campaignsTools } from './index.js';
import { launchCampaignTool } from './launch-campaign.tool.js';
import { listCampaignsTool } from './list-campaigns.tool.js';
import { listWhatsappTemplatesTool } from './list-whatsapp-templates.tool.js';
import { setCampaignMessageTool } from './set-campaign-message.tool.js';
import { showCampaignPreviewTool } from './show-campaign-preview.tool.js';

// Short-circuit the database barrel — it transitively pulls in
// `@paralleldrive/cuid2` (ESM-only) which the api/jest swc transform doesn't
// handle. The tools never touch `db`; confirmation hooks are injected via ctx.
jest.mock('@borradh-workspace/database', () => ({
  db: {},
}));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
}));

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
  callCounter?: { count: number; max: number };
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation:
      overrides.createConfirmation ??
      (jest.fn(async () => ({
        id: 'token-abc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })) as never),
    verifyConfirmation:
      overrides.verifyConfirmation ??
      (jest.fn(async () => ({ valid: true, payload: null })) as never),
  };
}

describe('messaging-campaigns tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registry', () => {
    it('exposes the messaging-campaigns tools with canonical names', () => {
      expect(campaignsTools).toHaveLength(10);
      expect(campaignsTools.map((t) => t.name)).toEqual([
        'campaigns_checkChannels',
        'campaigns_list',
        'campaigns_segments_list',
        'campaigns_createSegment',
        'campaigns_create',
        'campaigns_setMessage',
        'campaigns_previewAudience',
        'campaigns_listWhatsappTemplates',
        'campaigns_showCampaignPreview',
        'campaigns_launch',
      ]);
    });

    it('marks only campaigns_launch as destructive', () => {
      for (const tool of campaignsTools) {
        expect(tool.destructive).toBe(tool.name === 'campaigns_launch');
      }
      expect(launchCampaignTool.destructiveAction).toBe('launch_campaign');
    });
  });

  describe('campaigns_list', () => {
    it('lists campaigns and returns the page slice', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'c1',
            name: 'June Offer',
            type: 'custom',
            status: 'draft',
            channels: ['sms'],
            segmentId: 's1',
            scheduledAt: null,
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      })) as never;

      const result = await listCampaignsTool.execute(
        { limit: 50, offset: 0 },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.campaigns).toHaveLength(1);
        expect(result.data.campaigns[0]?.name).toBe('June Offer');
        expect(result.data.pageCount).toBe(1);
      }
    });
  });

  describe('campaigns_create', () => {
    it('creates a draft campaign without confirmation', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'c2',
        name: 'New Blast',
        type: 'custom',
        status: 'draft',
        channels: ['email'],
        segmentId: 's1',
      })) as never;

      const result = await createCampaignTool.execute(
        { name: 'New Blast', channels: ['email'], type: 'custom' },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.campaignId).toBe('c2');
        expect(result.data.status).toBe('draft');
      }
    });
  });

  describe('campaigns_checkChannels', () => {
    it('reports per-channel readiness from entitlements + setup', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'campaigns/entitlements') {
          return {
            allowed: ['email'],
            blocked: [{ channel: 'sms', reason: 'plan' }],
          };
        }
        if (path === 'campaigns/sms-number') return null;
        if (path === 'integrations/whatsapp/accounts') {
          return { accounts: [{ id: 'wa1', isActive: true }] };
        }
        throw new Error(`unexpected path ${path}`);
      }) as never;

      const result = await checkChannelsTool.execute(
        {},
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.availableChannels).toEqual(['email', 'whatsapp']);
        const sms = result.data.channels.find((c) => c.channel === 'sms');
        expect(sms?.available).toBe(false);
        expect(sms?.reason).toContain('plan');
      }
    });

    it('treats setup-lookup failures as not connected', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'campaigns/entitlements') {
          return { allowed: ['email', 'sms', 'whatsapp'], blocked: [] };
        }
        throw new Error('boom');
      }) as never;

      const result = await checkChannelsTool.execute(
        {},
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.availableChannels).toEqual(['email']);
      }
    });
  });

  describe('campaigns_createSegment', () => {
    it('creates a segment from filters and returns live reach', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'campaigns/segments') {
          return { id: 's9', name: 'Quiet 30+ days', isDynamic: true };
        }
        return {
          total: 42,
          reachable: 30,
          channels: { email: 28, sms: 12, whatsapp: 30 },
        };
      }) as never;

      const result = await createSegmentTool.execute(
        {
          name: 'Quiet 30+ days',
          statuses: ['booked'],
          lastContactedBefore: '2026-06-22T00:00:00.000Z',
          isDynamic: true,
        },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.segmentId).toBe('s9');
        expect(result.data.total).toBe(42);
        expect(result.data.perChannel.whatsapp).toBe(30);
      }
      // Only the provided filters land in filterJson.
      const createCall = (apiFetch as jest.Mock).mock.calls.find(
        ([path]) => path === 'campaigns/segments'
      );
      expect(createCall?.[1]?.body?.filterJson).toEqual({
        status: ['booked'],
        lastContactedBefore: '2026-06-22T00:00:00.000Z',
      });
    });
  });

  describe('campaigns_setMessage', () => {
    it('upserts free-form content for a channel', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'm1',
        campaignId: 'c2',
        channel: 'sms',
        subject: null,
        body: 'Hi {{firstName|there}}!',
        whatsappTemplateId: null,
      })) as never;

      const result = await setCampaignMessageTool.execute(
        { campaignId: 'c2', channel: 'sms', body: 'Hi {{firstName|there}}!' },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.bodyPreview).toBe('Hi {{firstName|there}}!');
        expect(result.data.whatsappTemplateName).toBeNull();
      }
    });

    it('resolves an approved WhatsApp template and stores a filled preview body', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'campaigns/whatsapp-templates') {
          return {
            templates: [
              {
                id: 'tpl_1',
                name: 'june_offer',
                status: 'approved',
                body: 'Hi {{1}}, enjoy {{2}}!',
              },
            ],
          };
        }
        return {
          id: 'm2',
          campaignId: 'c2',
          channel: 'whatsapp',
          subject: null,
          body: 'Hi {{firstName|there}}, enjoy 20% off!',
          whatsappTemplateId: 'tpl_1',
        };
      }) as never;

      const result = await setCampaignMessageTool.execute(
        {
          campaignId: 'c2',
          channel: 'whatsapp',
          whatsappTemplateId: 'tpl_1',
          whatsappTemplateParams: ['{{firstName|there}}', '20% off'],
        },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.whatsappTemplateName).toBe('june_offer');
      }
      // The upsert body was the filled-in template, params passed through.
      const upsertCall = (apiFetch as jest.Mock).mock.calls.find(
        ([path]) => path === 'campaigns/c2/messages'
      );
      expect(upsertCall?.[1]?.body?.body).toBe(
        'Hi {{firstName|there}}, enjoy 20% off!'
      );
      expect(upsertCall?.[1]?.body?.whatsappTemplateParams).toEqual([
        '{{firstName|there}}',
        '20% off',
      ]);
    });

    it('rejects an unapproved template', async () => {
      const apiFetch = jest.fn(async () => ({
        templates: [
          { id: 'tpl_1', name: 'june_offer', status: 'paused', body: 'x' },
        ],
      })) as never;

      const result = await setCampaignMessageTool.execute(
        { campaignId: 'c2', channel: 'whatsapp', whatsappTemplateId: 'tpl_1' },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(false);
    });
  });

  describe('campaigns_listWhatsappTemplates', () => {
    it('lists templates with a derived parameter count', async () => {
      const apiFetch = jest.fn(async () => ({
        templates: [
          {
            id: 'tpl_1',
            name: 'june_offer',
            languageCode: 'en',
            category: 'MARKETING',
            status: 'approved',
            body: 'Hi {{1}}, enjoy {{2}} until {{3}}!',
          },
        ],
        synced: false,
      })) as never;

      const result = await listWhatsappTemplatesTool.execute(
        { refresh: false },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.templates[0]?.parameterCount).toBe(3);
      }
    });
  });

  describe('campaigns_showCampaignPreview', () => {
    it('aggregates campaign, audience and blockers into the embed payload', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'campaigns/c9') {
          return {
            id: 'c9',
            name: 'June Blast',
            type: 'custom',
            status: 'draft',
            channels: ['email', 'whatsapp'],
            segmentId: 's1',
            scheduledAt: null,
            messages: [
              {
                channel: 'email',
                subject: 'June offer inside',
                body: 'Hello {{firstName|there}}',
                whatsappTemplateId: null,
                whatsappTemplateParams: null,
              },
            ],
          };
        }
        if (path === 'campaigns/segments/s1') {
          return {
            id: 's1',
            name: 'VIP Clients',
            isDynamic: true,
            filterJson: { status: ['booked'] },
          };
        }
        if (path === 'campaigns/segments/preview') {
          return {
            total: 150,
            reachable: 120,
            channels: { email: 110, sms: 0, whatsapp: 90 },
          };
        }
        if (path === 'campaigns/entitlements') {
          return { allowed: ['email', 'sms', 'whatsapp'], blocked: [] };
        }
        throw new Error(`unexpected path ${path}`);
      }) as never;

      const result = await showCampaignPreviewTool.execute(
        { campaignId: 'c9' },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.name).toBe('June Blast');
        expect(result.data.audience?.reachable).toBe(120);
        expect(result.data.segment?.name).toBe('VIP Clients');
        // WhatsApp channel selected but no message written → blocker.
        expect(result.data.blockers).toEqual([
          { channel: 'whatsapp', message: 'No whatsapp message written yet.' },
        ]);
        expect(result.data.readyToLaunch).toBe(false);
      }
    });
  });

  describe('campaigns_launch', () => {
    it('returns a confirmation card on the first (token-less) call', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'c3',
        name: 'Launch Me',
        status: 'draft',
        channels: ['whatsapp'],
        segmentId: 's1',
      })) as never;

      const result = await launchCampaignTool.execute(
        { campaignId: 'c3' },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      expect(result.presentation?.type).toBe('confirmation_required');
    });

    it('sends the campaign on the second (confirmed) call', async () => {
      const apiFetch = jest.fn(async () => ({
        campaignId: 'c3',
        materialized: 12,
        enqueued: 12,
      })) as never;

      const result = await launchCampaignTool.execute(
        { campaignId: 'c3', confirmationToken: 'token-abc' },
        buildCtx({ apiFetch })
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.messagesEnqueued).toBe(12);
        expect(result.data.recipientsMaterialized).toBe(12);
      }
    });
  });
});
