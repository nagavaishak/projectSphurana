import { leadFormAtomSchema } from '@borradh-workspace/contracts';
import { leadFormStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import type { LeadFormApiResponse } from './_shared.js';

const listLeadFormsInputSchema = z.object({
  status: z
    .enum(leadFormStatusValues)
    .optional()
    .describe(
      'Filter by status. "synced" forms are the ones live on Meta and usable ' +
        'in a campaign.'
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Max forms to return (default 20).'),
});

/**
 * `GET /lead-forms` — the six columns the summary below reads, `.pick()`ed from
 * the `lead_form` atom.
 *
 * `listLeadForms` returns `{ items, total, limit, offset }` (a bare `findMany`
 * with a `metaPage` join), never a bare array — the union the previous
 * assertion carried had no branch the endpoint can take.
 *
 * `followUpChannel` is narrowed back to its DB `$type<LeadFormFollowUpChannel>`
 * (the generator widens `text().$type<>()` to `z.string()`), which is what makes
 * `LeadFormSummary.followUpChannel` typecheck without a cast.
 */
const listLeadFormsResponseSchema = z.object({
  items: z.array(
    leadFormAtomSchema
      .pick({
        id: true,
        name: true,
        status: true,
        metaFormId: true,
        questions: true,
      })
      .extend({
        followUpChannel: z.enum(['none', 'messenger', 'whatsapp']),
      })
  ),
});

interface LeadFormSummary {
  leadFormId: string;
  name: string;
  status: LeadFormApiResponse['status'];
  metaFormId: string | null;
  followUpChannel: 'none' | 'messenger' | 'whatsapp' | null;
  fieldCount: number;
}

interface ListLeadFormsOutput {
  leadForms: LeadFormSummary[];
  count: number;
}

/**
 * `lead_forms_listLeadForms` — list the org's lead forms so Claire can reuse or
 * edit an existing one instead of always creating a new form. Read-only.
 */
export const listLeadFormsTool = defineTool<
  z.infer<typeof listLeadFormsInputSchema>,
  ListLeadFormsOutput
>({
  feature: 'lead-forms',
  action: 'listLeadForms',
  description:
    "List the organisation's lead forms (name, status, fields, follow-up " +
    'channel). Use to find an existing form to reuse or edit. Pass ' +
    'status:"synced" to see only forms that are live on Meta.',
  inputSchema: listLeadFormsInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing lead forms' },
  additionalAllowedPaths: [/^lead-forms$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams();
    if (input.status) params.set('status', input.status);
    if (input.limit) params.set('limit', String(input.limit));
    const qs = params.toString();

    const { items } = await ctx.apiFetch(`lead-forms${qs ? `?${qs}` : ''}`, {
      schema: listLeadFormsResponseSchema,
    });

    const leadForms: LeadFormSummary[] = items.map((f) => ({
      leadFormId: f.id,
      name: f.name,
      status: f.status,
      metaFormId: f.metaFormId,
      followUpChannel: f.followUpChannel,
      fieldCount: Array.isArray(f.questions) ? f.questions.length : 0,
    }));

    return { data: { leadForms, count: leadForms.length } };
  },
});
