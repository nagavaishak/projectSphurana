import { listWhatsappTemplatesResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const listWhatsappTemplatesInputSchema = z.object({
  refresh: z
    .boolean()
    .default(false)
    .describe(
      'Re-sync the template list from Meta before returning. Use when the ' +
        'user just created/edited a template or the cached list looks stale.'
    ),
});

interface ListWhatsappTemplatesOutput {
  templates: Array<{
    id: string;
    name: string;
    languageCode: string;
    category: string | null;
    status: string;
    body: string;
    /** Number of {{n}} placeholders the template body expects. */
    parameterCount: number;
  }>;
  synced: boolean;
}

const countPlaceholders = (body: string): number => {
  const nums = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) =>
    Number(m[1])
  );
  return nums.length === 0 ? 0 : Math.max(...nums);
};

/**
 * `campaigns_listWhatsappTemplates` — list the org's WhatsApp message
 * templates (from the linked WhatsApp Business Account).
 *
 * Read-only. Backed by `GET /campaigns/whatsapp-templates`. Only `approved`
 * templates can be used for business-initiated campaign sends; the others are
 * returned so the model can explain why a template isn't usable yet.
 */
export const listWhatsappTemplatesTool = defineTool<
  z.infer<typeof listWhatsappTemplatesInputSchema>,
  ListWhatsappTemplatesOutput
>({
  feature: 'campaigns',
  action: 'listWhatsappTemplates',
  description:
    "List the organization's WhatsApp message templates from its linked " +
    'WhatsApp Business account. Campaign sends outside the 24h window MUST ' +
    'use an APPROVED template — use this to pick one (and its parameter ' +
    'count) before setting a WhatsApp campaign message. Set refresh=true to ' +
    're-sync from Meta. Read-only.',
  inputSchema: listWhatsappTemplatesInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing WhatsApp templates' },
  additionalAllowedPaths: [/^campaigns\/whatsapp-templates$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams();
    if (input.refresh) params.set('refresh', 'true');
    const qs = params.toString();

    const data = await ctx.apiFetch(
      `campaigns/whatsapp-templates${qs ? `?${qs}` : ''}`,
      { schema: listWhatsappTemplatesResponseSchema }
    );

    return {
      data: {
        templates: data.templates.map((t) => ({
          id: t.id,
          name: t.name,
          languageCode: t.languageCode,
          category: t.category,
          status: t.status,
          body: t.body,
          parameterCount: countPlaceholders(t.body),
        })),
        synced: data.synced,
      },
    };
  },
});
