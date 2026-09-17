import {
  campaignMessageSchema,
  listWhatsappTemplatesResponseSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const campaignChannelValues = ['email', 'sms', 'whatsapp'] as const;

const setCampaignMessageInputSchema = z.object({
  campaignId: z
    .string()
    .min(1)
    .describe('ID of the draft campaign to set content on.'),
  channel: z
    .enum(campaignChannelValues)
    .describe('Which channel this content is for.'),
  subject: z
    .string()
    .max(200)
    .optional()
    .describe('Email subject line (required for the email channel).'),
  body: z
    .string()
    .max(5000)
    .optional()
    .describe(
      'Message body. Supports merge tags like {{firstName|there}}. Required ' +
        'unless a whatsappTemplateId is given (then the template body is used).'
    ),
  whatsappTemplateId: z
    .string()
    .optional()
    .describe(
      'WhatsApp only — ID of an APPROVED template (from ' +
        '`campaigns_listWhatsappTemplates`). Required for sends outside the ' +
        '24h window.'
    ),
  whatsappTemplateParams: z
    .array(z.string().max(500))
    .max(20)
    .optional()
    .describe(
      "Ordered values for the template's {{1}}..{{n}} placeholders. Each " +
        'value may contain merge tags ({{firstName|there}}) interpolated per ' +
        'recipient.'
    ),
});

interface SetCampaignMessageOutput {
  campaignId: string;
  channel: string;
  subject: string | null;
  bodyPreview: string;
  whatsappTemplateName: string | null;
}

/** Substitute {{1}}..{{n}} placeholders with the authored param values. */
const fillTemplateBody = (body: string, params: string[]): string =>
  body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, n: string) => {
    const value = params[Number(n) - 1];
    return value !== undefined && value !== '' ? value : match;
  });

/**
 * `campaigns_setMessage` — write the per-channel content of a draft campaign.
 *
 * Non-destructive: content on a draft sends nothing until `campaigns_launch`.
 * Backed by `POST /campaigns/:id/messages` (upsert keyed on campaign+channel).
 * For WhatsApp template sends the tool resolves the template body and stores
 * a filled-in preview as the message body (the send itself dispatches the
 * approved template with per-recipient interpolated parameters).
 */
export const setCampaignMessageTool = defineTool<
  z.infer<typeof setCampaignMessageInputSchema>,
  SetCampaignMessageOutput
>({
  feature: 'campaigns',
  action: 'setMessage',
  description:
    'Set the per-channel content for a DRAFT bulk message (upsert — replaces ' +
    'the previous content for that channel). For "email", pass a subject and a ' +
    'body. For "whatsapp", pass an APPROVED whatsappTemplateId (from ' +
    '`campaigns_listWhatsappTemplates`) plus whatsappTemplateParams for its ' +
    '{{1}}..{{n}} placeholders — a template is required to reach contacts ' +
    'outside the 24h window. Do NOT set content for "sms" (SMS is paused). ' +
    'Bodies and params support merge tags like {{firstName|there}} — always ' +
    'give a fallback. Nothing sends until `campaigns_launch`.',
  inputSchema: setCampaignMessageInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Writing campaign message' },
  additionalAllowedPaths: [
    /^campaigns\/[a-zA-Z0-9_-]+\/messages$/,
    /^campaigns\/whatsapp-templates$/,
  ],
  execute: async (input, ctx) => {
    let body = input.body ?? '';
    let templateName: string | null = null;

    if (input.channel === 'whatsapp' && input.whatsappTemplateId) {
      const { templates } = await ctx.apiFetch('campaigns/whatsapp-templates', {
        schema: listWhatsappTemplatesResponseSchema,
      });
      const template = templates.find((t) => t.id === input.whatsappTemplateId);
      if (!template) {
        throw new Error(
          'WhatsApp template not found. Call `campaigns_listWhatsappTemplates` and use one of the returned template IDs.'
        );
      }
      if (template.status !== 'approved') {
        throw new Error(
          `WhatsApp template "${template.name}" is ${template.status}, not approved. Only approved templates can be sent in campaigns.`
        );
      }
      templateName = template.name;
      // Store the filled-in template body as the message body — it doubles as
      // the human-readable preview and satisfies the non-empty body rule.
      body = fillTemplateBody(
        template.body,
        input.whatsappTemplateParams ?? []
      );
    }

    if (body.trim().length === 0) {
      throw new Error(
        'A message body is required (or, for WhatsApp, a whatsappTemplateId).'
      );
    }
    if (input.channel === 'email' && !(input.subject ?? '').trim()) {
      throw new Error('An email subject is required for the email channel.');
    }

    const message = await ctx.apiFetch(
      `campaigns/${input.campaignId}/messages`,
      {
        schema: campaignMessageSchema,
        method: 'POST',
        body: {
          channel: input.channel,
          subject: input.subject,
          body,
          whatsappTemplateId: input.whatsappTemplateId,
          whatsappTemplateParams: input.whatsappTemplateParams,
        },
      }
    );

    return {
      data: {
        campaignId: message.campaignId,
        channel: message.channel,
        subject: message.subject,
        bodyPreview: message.body,
        whatsappTemplateName: templateName,
      },
    };
  },
});
