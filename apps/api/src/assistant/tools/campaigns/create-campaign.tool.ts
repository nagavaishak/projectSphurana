import { messagingCampaignSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const campaignChannelValues = ['email', 'sms', 'whatsapp'] as const;

const createCampaignInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe('Human-readable campaign name, e.g. "June Intro Offer".'),
  channels: z
    .array(z.enum(campaignChannelValues))
    .min(1)
    .describe('Channels to send on. At least one of: email, sms, whatsapp.'),
  segmentId: z
    .string()
    .optional()
    .describe(
      'ID of the saved audience segment to send to. Use `campaigns_segments_list` to find one. Optional — a campaign can be created without a segment and have one attached later.'
    ),
  type: z
    .enum(['intro_offer', 'gmb_review', 'custom'])
    .default('custom')
    .describe('Campaign type. Default: custom.'),
});

interface CreateCampaignOutput {
  campaignId: string;
  name: string;
  status: string;
  channels: string[];
  segmentId: string | null;
}

/**
 * `campaigns_create` — create a new messaging campaign as a DRAFT.
 *
 * Non-destructive: the campaign is created with status `draft` and sends
 * nothing until it is explicitly launched via `campaigns_launch` (which is
 * gated behind operator confirmation). So, mirroring the paused-ad-container
 * pattern, this tool builds the draft straight away with no confirm step.
 * Backed by `POST /campaigns`.
 */
export const createCampaignTool = defineTool<
  z.infer<typeof createCampaignInputSchema>,
  CreateCampaignOutput
>({
  feature: 'campaigns',
  action: 'create',
  description:
    'Create a new bulk message to your own contacts as a DRAFT. Requires a ' +
    'name and the channels to send on; optionally a segmentId (the audience ' +
    'to send to). Available channels are email and whatsapp — pass `["email"]`, ' +
    '`["whatsapp"]`, or both. Do NOT pass "sms" (SMS bulk messaging is paused). ' +
    'Call `campaigns_checkChannels` first to confirm the org can deliver on a ' +
    'channel. The draft sends nothing until launched, so no confirmation is ' +
    'needed here. To actually send, use `campaigns_launch`.',
  inputSchema: createCampaignInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Creating campaign' },
  additionalAllowedPaths: [/^campaigns$/],
  execute: async (input, ctx) => {
    const campaign = await ctx.apiFetch('campaigns', {
      schema: messagingCampaignSchema,
      method: 'POST',
      body: {
        name: input.name,
        channels: input.channels,
        segmentId: input.segmentId,
        type: input.type,
      },
    });

    return {
      data: {
        campaignId: campaign.id,
        name: campaign.name,
        status: campaign.status,
        channels: campaign.channels,
        segmentId: campaign.segmentId,
      },
    };
  },
});
