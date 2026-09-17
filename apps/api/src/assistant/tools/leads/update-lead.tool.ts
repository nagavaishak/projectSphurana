import { leadDetailSchema, leadSchema } from '@borradh-workspace/contracts';
import { leadStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const updateLeadInputSchema = z.object({
  leadId: z.string().min(1).describe('ID of the lead to update.'),
  firstName: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('Updated first name.'),
  lastName: z.string().max(100).optional().describe('Updated last name.'),
  email: z.string().email().optional().describe('Updated email address.'),
  phone: z.string().max(30).optional().describe('Updated phone number.'),
  status: z
    .enum(leadStatusValues)
    .optional()
    .describe('New status for this lead.'),
  notes: z.string().max(2000).optional().describe('Updated notes.'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface UpdateLeadOutput {
  leadId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  status: string;
}

/**
 * `leads_updateLead` — update an existing lead's details.
 *
 * Destructive (modifies DB). Uses the factory two-call confirmation flow.
 * Only the provided fields are updated (PATCH semantics).
 *
 * Common use cases:
 *   - Operator learned a new phone number mid-conversation.
 *   - Moving a lead from "contacted" to "booked" after a call.
 *   - Correcting a typo in the name or email.
 *
 * Valid statuses: new | contacted | booked | lost.
 */
export const updateLeadTool = defineTool<
  z.infer<typeof updateLeadInputSchema>,
  UpdateLeadOutput
>({
  feature: 'leads',
  action: 'updateLead',
  description:
    "Update an existing lead's details (name, email, phone, status, notes). " +
    'Only provided fields are changed (PATCH). Requires operator confirmation. ' +
    'To find the leadId, use `listLeads` or `searchLeads`.',
  inputSchema: updateLeadInputSchema,
  destructive: true,
  destructiveAction: 'update_lead',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating lead' },
  additionalAllowedPaths: [/^leads\/[a-zA-Z0-9_-]+$/],
  summarizeForConfirmation: async (input, ctx) => {
    const lead = await ctx.apiFetch(`leads/${input.leadId}`, {
      schema: leadDetailSchema,
    });
    const currentName = [lead.firstName, lead.lastName]
      .filter(Boolean)
      .join(' ');

    const changes: Array<{ label: string; value: string }> = [];
    if (input.firstName !== undefined || input.lastName !== undefined) {
      const newName = [
        input.firstName ?? lead.firstName,
        input.lastName ?? lead.lastName,
      ]
        .filter(Boolean)
        .join(' ');
      changes.push({ label: 'Name', value: `${currentName} → ${newName}` });
    }
    if (input.email !== undefined)
      changes.push({ label: 'Email', value: input.email });
    if (input.phone !== undefined)
      changes.push({ label: 'Phone', value: input.phone });
    if (input.status !== undefined)
      changes.push({
        label: 'Status',
        value: `${lead.status} → ${input.status}`,
      });

    return {
      title: `Update lead "${currentName}"`,
      fields: [{ label: 'Lead', value: currentName }, ...changes],
      resourceId: input.leadId,
      payload: {
        leadId: input.leadId,
        ...Object.fromEntries(
          Object.entries(input).filter(
            ([k, v]) =>
              k !== 'leadId' && k !== 'confirmationToken' && v !== undefined
          )
        ),
      },
    };
  },
  execute: async (input, ctx) => {
    const updateBody: Record<string, unknown> = {};
    if (input.firstName !== undefined) updateBody.firstName = input.firstName;
    if (input.lastName !== undefined) updateBody.lastName = input.lastName;
    if (input.email !== undefined) updateBody.email = input.email;
    if (input.phone !== undefined) updateBody.phone = input.phone;
    if (input.status !== undefined) updateBody.status = input.status;
    if (input.notes !== undefined) updateBody.notes = input.notes;

    // PUT, not PATCH — the controller exposes `@Put(':id')` for full
    // field-level updates and `@Patch(':id/status')` only for the
    // status-only fast path. PUT against `:id` already takes a partial
    // `UpdateLeadDto` body so partial-update semantics are preserved.
    const lead = await ctx.apiFetch(`leads/${input.leadId}`, {
      schema: leadSchema,
      method: 'PUT',
      body: updateBody,
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
