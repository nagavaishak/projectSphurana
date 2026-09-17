import { leadSchema } from '@borradh-workspace/contracts';
import { leadSourceValues, leadStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const createLeadInputSchema = z.object({
  firstName: z.string().min(1).max(100).describe("Lead's first name."),
  lastName: z.string().max(100).optional().describe("Lead's last name."),
  email: z.string().email().optional().describe("Lead's email address."),
  phone: z
    .string()
    .max(30)
    .optional()
    .describe("Lead's phone number in any format."),
  whatsapp: z
    .string()
    .max(30)
    .optional()
    .describe(
      "Lead's WhatsApp number, if different from their primary phone. Any format."
    ),
  source: z
    .enum(leadSourceValues)
    .default('manual')
    .describe(
      'How this lead was acquired. Default: manual (operator entered).'
    ),
  status: z
    .enum(leadStatusValues)
    .default('new')
    .describe('Initial status for this lead. Default: new.'),
  tags: z
    .array(z.string().min(1).max(50))
    .optional()
    .describe(
      'Tags to attach to this lead for segmentation (e.g. "vip", "summer-campaign"). Each tag is a short label.'
    ),
  notes: z
    .string()
    .max(2000)
    .optional()
    .describe('Any notes about this lead (interest, prior contact, etc.).'),
  consentEmail: z
    .boolean()
    .optional()
    .describe(
      'Whether the lead has consented to be contacted by email. Defaults to false if omitted.'
    ),
  consentSms: z
    .boolean()
    .optional()
    .describe(
      'Whether the lead has consented to be contacted by SMS. Defaults to false if omitted.'
    ),
  consentVoice: z
    .boolean()
    .optional()
    .describe(
      'Whether the lead has consented to be contacted by voice/phone call. Defaults to false if omitted.'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface CreateLeadOutput {
  leadId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  status: string;
}

/**
 * `leads_createLead` — add a new lead record for the active organization.
 *
 * Destructive (writes to DB). Uses the factory two-call confirmation flow.
 * At minimum either email or phone should be provided so the lead is
 * reachable; the tool allows both to be omitted in case the operator only
 * has a name (walk-in, for example).
 */
export const createLeadTool = defineTool<
  z.infer<typeof createLeadInputSchema>,
  CreateLeadOutput
>({
  feature: 'leads',
  action: 'createLead',
  description:
    'Create a new lead record for the organization. Requires operator ' +
    'confirmation. Provide at least email or phone so the lead is reachable. ' +
    'Source defaults to "manual" for operator-entered leads.',
  inputSchema: createLeadInputSchema,
  destructive: true,
  destructiveAction: 'create_lead',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Creating lead' },
  additionalAllowedPaths: [/^leads$/, /^leads\/[a-zA-Z0-9_-]+$/],
  summarizeForConfirmation: async (input) => {
    const fullName = [input.firstName, input.lastName]
      .filter(Boolean)
      .join(' ');
    const contact =
      [
        input.email,
        input.phone,
        input.whatsapp && `WhatsApp: ${input.whatsapp}`,
      ]
        .filter(Boolean)
        .join(' · ') || '(no contact details)';
    const consentChannels = [
      input.consentEmail && 'email',
      input.consentSms && 'sms',
      input.consentVoice && 'voice',
    ].filter(Boolean) as string[];

    const fields = [
      { label: 'Name', value: fullName },
      { label: 'Contact', value: contact },
      { label: 'Source', value: input.source },
      { label: 'Initial status', value: input.status },
    ];
    if (input.tags && input.tags.length > 0) {
      fields.push({ label: 'Tags', value: input.tags.join(', ') });
    }
    if (consentChannels.length > 0) {
      fields.push({
        label: 'Consented channels',
        value: consentChannels.join(', '),
      });
    }

    return {
      title: `Create lead "${fullName}"`,
      fields,
      resourceId: `lead:${fullName}`,
      payload: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        whatsapp: input.whatsapp,
        source: input.source,
        status: input.status,
        tags: input.tags,
        consentEmail: input.consentEmail,
        consentSms: input.consentSms,
        consentVoice: input.consentVoice,
      },
    };
  },
  execute: async (input, ctx) => {
    const hasAnyConsent =
      input.consentEmail === true ||
      input.consentSms === true ||
      input.consentVoice === true;

    const lead = await ctx.apiFetch('leads', {
      schema: leadSchema,
      method: 'POST',
      body: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        whatsapp: input.whatsapp,
        source: input.source,
        status: input.status,
        tags: input.tags,
        notes: input.notes,
        consentEmail: input.consentEmail,
        consentSms: input.consentSms,
        consentVoice: input.consentVoice,
        // Tag any explicit consent as manual_entry (operator-entered via Claire).
        consentSource: hasAnyConsent ? 'manual_entry' : undefined,
      },
    });

    return {
      data: {
        leadId: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        status: lead.status,
      },
    };
  },
});
