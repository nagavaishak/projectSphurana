import {
  channelEntitlementsResponseSchema,
  listWhatsappTemplatesResponseSchema,
  messagingCampaignWithMessagesSchema,
  segmentPreviewResponseSchema,
  segmentSchema,
} from '@borradh-workspace/contracts';
import { campaignChannelValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const showCampaignPreviewInputSchema = z.object({
  campaignId: z
    .string()
    .min(1)
    .describe(
      'ID of the campaign to preview (from `campaigns_list` or after `campaigns_create`).'
    ),
});

type Channel = 'email' | 'sms' | 'whatsapp';

/**
 * `campaign.channels` is a bare `text[]` in the DB (see `campaigns.ts`:
 * `channels: text('channels').array().notNull()`), so the wire type is
 * `string[]` — this tool used to ASSERT `Channel[]`. The write paths all
 * validate against the three channels, so nothing unexpected is expected in
 * practice, but the column cannot guarantee it. Rather than silently drop an
 * unrecognized value, it is surfaced as a launch blocker below.
 */
const isChannel = (value: string): value is Channel =>
  (campaignChannelValues as readonly string[]).includes(value);

/**
 * The flat output contract the Claire chat embed renders from. The frontend
 * `CampaignPreviewCard` / `CampaignEmbedModal` read exactly this shape off
 * `toolPart.output` — change it in lockstep with
 * `apps/app/src/features/assistant/_components/rich/campaign-preview-card.tsx`.
 */
export interface CampaignPreviewEmbedOutput {
  campaignId: string;
  name: string;
  status: string;
  type: string;
  channels: Channel[];
  scheduledAt: string | null;
  segment: { id: string; name: string; isDynamic: boolean } | null;
  audience: {
    total: number;
    reachable: number;
    perChannel: Record<string, number>;
  } | null;
  messages: Array<{
    channel: Channel;
    subject: string | null;
    body: string;
    whatsappTemplate: { id: string; name: string; status: string } | null;
  }>;
  blockers: Array<{ channel: Channel | null; message: string }>;
  readyToLaunch: boolean;
}

/**
 * `campaigns_showCampaignPreview` — render the interactive campaign review
 * card in chat.
 *
 * Read-only aggregation over the campaign, its per-channel messages, the
 * audience segment (with live reachability counts), plan entitlements, and
 * WhatsApp template approval — everything the operator needs to decide
 * whether to launch. The frontend renders this as a rich card with a
 * "Review & launch" modal; launching itself still goes through the
 * `campaigns_launch` confirmation gate.
 */
export const showCampaignPreviewTool = defineTool<
  z.infer<typeof showCampaignPreviewInputSchema>,
  CampaignPreviewEmbedOutput
>({
  feature: 'campaigns',
  action: 'showCampaignPreview',
  description:
    'Show the user an interactive preview card of a messaging campaign in ' +
    'chat: audience size and per-channel reach, the message content for each ' +
    'channel, and anything blocking a launch. ALWAYS call this after ' +
    'building or editing a campaign, and before proposing a launch, so the ' +
    'user reviews what will be sent. Read-only — launching still requires ' +
    '`campaigns_launch` and its confirmation.',
  inputSchema: showCampaignPreviewInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Preparing campaign preview' },
  additionalAllowedPaths: [
    /^campaigns\/[a-zA-Z0-9_-]+$/,
    /^campaigns\/segments\/[a-zA-Z0-9_-]+$/,
    /^campaigns\/segments\/preview$/,
    /^campaigns\/entitlements$/,
    /^campaigns\/whatsapp-templates$/,
  ],
  execute: async (input, ctx) => {
    const campaign = await ctx.apiFetch(`campaigns/${input.campaignId}`, {
      schema: messagingCampaignWithMessagesSchema,
    });
    const messages = campaign.messages;
    const blockers: CampaignPreviewEmbedOutput['blockers'] = [];

    // `channels` is `text[]` on the wire — narrow to the channels this tool
    // (and the embed) can actually render, and blocker anything else rather
    // than dropping it silently.
    const channels = campaign.channels.filter(isChannel);
    for (const raw of campaign.channels.filter((c) => !isChannel(c))) {
      blockers.push({
        channel: null,
        message: `Campaign targets an unrecognized channel "${raw}".`,
      });
    }

    // Audience — resolve the segment and compute live reachability.
    let segment: CampaignPreviewEmbedOutput['segment'] = null;
    let audience: CampaignPreviewEmbedOutput['audience'] = null;
    if (campaign.segmentId) {
      const seg = await ctx.apiFetch(
        `campaigns/segments/${campaign.segmentId}`,
        { schema: segmentSchema }
      );
      segment = { id: seg.id, name: seg.name, isDynamic: seg.isDynamic };
      const preview = await ctx.apiFetch('campaigns/segments/preview', {
        schema: segmentPreviewResponseSchema,
        method: 'POST',
        body: { filterJson: seg.filterJson, channels },
      });
      audience = {
        total: preview.total,
        reachable: preview.reachable,
        perChannel: preview.channels,
      };
    } else {
      blockers.push({
        channel: null,
        message: 'No audience segment selected yet.',
      });
    }

    // Plan entitlements — SMS/WhatsApp are paid channels.
    const entitlements = await ctx.apiFetch('campaigns/entitlements', {
      schema: channelEntitlementsResponseSchema,
    });
    for (const blocked of entitlements.blocked) {
      if (channels.includes(blocked.channel)) {
        blockers.push({
          channel: blocked.channel,
          message: `Your plan doesn't include ${blocked.channel} campaigns.`,
        });
      }
    }

    // Content — every selected channel needs a saved message.
    const byChannel = new Map(messages.map((m) => [m.channel, m]));
    let templates:
      | z.infer<typeof listWhatsappTemplatesResponseSchema>['templates']
      | null = null;
    const outMessages: CampaignPreviewEmbedOutput['messages'] = [];
    for (const channel of channels) {
      const message = byChannel.get(channel);
      if (!message || message.body.trim().length === 0) {
        blockers.push({
          channel,
          message: `No ${channel} message written yet.`,
        });
        continue;
      }
      if (channel === 'email' && !(message.subject ?? '').trim()) {
        blockers.push({ channel, message: 'Email subject line is missing.' });
      }

      let whatsappTemplate: (typeof outMessages)[number]['whatsappTemplate'] =
        null;
      if (channel === 'whatsapp' && message.whatsappTemplateId) {
        templates ??= (
          await ctx.apiFetch('campaigns/whatsapp-templates', {
            schema: listWhatsappTemplatesResponseSchema,
          })
        ).templates;
        const template = templates.find(
          (t) => t.id === message.whatsappTemplateId
        );
        whatsappTemplate = template
          ? { id: template.id, name: template.name, status: template.status }
          : {
              id: message.whatsappTemplateId,
              name: 'unknown',
              status: 'missing',
            };
        if (!template || template.status !== 'approved') {
          blockers.push({
            channel,
            message: 'The selected WhatsApp template is not approved.',
          });
        }
      }

      outMessages.push({
        channel,
        subject: message.subject,
        body: message.body,
        whatsappTemplate,
      });
    }

    const launchableStatus =
      campaign.status === 'draft' || campaign.status === 'scheduled';
    if (!launchableStatus) {
      blockers.push({
        channel: null,
        message: `Campaign is ${campaign.status} — only drafts or scheduled campaigns can launch.`,
      });
    }

    return {
      // The discriminator only — the card reads the rest off `data`, which is
      // the shape it has always read. Naming the card is the part that was
      // missing; restating its payload here would be two copies to keep in step.
      presentation: {
        type: 'campaign_preview' as const,
        campaignId: campaign.id,
      },
      data: {
        campaignId: campaign.id,
        name: campaign.name,
        status: campaign.status,
        type: campaign.type,
        channels,
        scheduledAt: campaign.scheduledAt,
        segment,
        audience,
        messages: outMessages,
        blockers,
        readyToLaunch: blockers.length === 0,
      },
    };
  },
});
