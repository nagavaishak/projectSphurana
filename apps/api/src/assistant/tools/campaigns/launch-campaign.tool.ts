import {
  launchCampaignResponseSchema,
  messagingCampaignWithMessagesSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const launchCampaignInputSchema = z.object({
  campaignId: z
    .string()
    .min(1)
    .describe('ID of the campaign to launch. Find it via `campaigns_list`.'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface LaunchCampaignOutput {
  campaignId: string;
  recipientsMaterialized: number;
  messagesEnqueued: number;
}

/**
 * `campaigns_launch` — launch a messaging campaign (SENDS REAL MESSAGES).
 *
 * Destructive: launching materializes the audience and enqueues real
 * SMS / email / WhatsApp sends to every recipient. This is an irreversible,
 * customer-facing action, so it goes through the factory's two-call
 * confirmation flow (mirrors `leads_createLead` / the ads launch gate):
 *   - First call (no token) → factory persists a confirmation token bound to
 *     `launch_campaign` + the campaignId and returns a `confirmation_required`
 *     card.
 *   - Second call (with the echoed token) → factory verifies it, then this
 *     `execute` runs `POST /campaigns/:id/launch`.
 */
export const launchCampaignTool = defineTool<
  z.infer<typeof launchCampaignInputSchema>,
  LaunchCampaignOutput
>({
  feature: 'campaigns',
  action: 'launch',
  description:
    'Launch a messaging campaign — this materializes the audience and SENDS ' +
    'real SMS/email/WhatsApp messages to every recipient. Irreversible and ' +
    'customer-facing, so it REQUIRES operator confirmation. Pass the ' +
    'campaignId; on the first call you get a confirmation card, then call ' +
    'again with the returned confirmationToken to actually send.',
  inputSchema: launchCampaignInputSchema,
  destructive: true,
  destructiveAction: 'launch_campaign',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Launching campaign' },
  additionalAllowedPaths: [
    /^campaigns\/[a-zA-Z0-9_-]+$/,
    /^campaigns\/[a-zA-Z0-9_-]+\/launch$/,
  ],
  summarizeForConfirmation: async (input, ctx) => {
    // Pull the campaign so the confirmation card shows real details (name,
    // channels) rather than an opaque id. If the read fails the factory
    // surfaces the error; we never fabricate a summary.
    const campaign = await ctx.apiFetch(`campaigns/${input.campaignId}`, {
      schema: messagingCampaignWithMessagesSchema,
    });

    const fields = [
      { label: 'Campaign', value: campaign.name },
      { label: 'Channels', value: campaign.channels.join(', ') || '(none)' },
      { label: 'Current status', value: campaign.status },
    ];

    return {
      title: `Launch campaign "${campaign.name}" and send messages`,
      fields,
      resourceId: campaign.id,
      payload: { campaignId: campaign.id },
    };
  },
  execute: async (input, ctx) => {
    const result = await ctx.apiFetch(`campaigns/${input.campaignId}/launch`, {
      schema: launchCampaignResponseSchema,
      method: 'POST',
    });

    return {
      data: {
        campaignId: result.campaignId,
        recipientsMaterialized: result.materialized,
        messagesEnqueued: result.enqueued,
      },
    };
  },
});
