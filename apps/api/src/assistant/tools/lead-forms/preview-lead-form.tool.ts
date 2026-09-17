import {
  type LeadFormDefaultQuestion,
  defaultLeadFormQuestions,
  leadFormFieldTypeLabels,
  leadFormFieldTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import {
  WHATSAPP_ACCOUNTS_PATH,
  resolveOrgNurtureChannel,
} from './_nurture.js';
import {
  type LeadFormPreviewOutput,
  buildLeadFormFields,
  describeLeadFormBlocked,
  leadFormBlockedCard,
} from './_shared.js';

const previewLeadFormInputSchema = z.object({
  leadFormId: z
    .string()
    .optional()
    .describe(
      'Preview an EXISTING form by id (from listLeadForms). Omit to preview a ' +
        'PROPOSED form from the questions below before creating it.'
    ),
  questions: z
    .array(z.enum(leadFormFieldTypeValues))
    .min(1)
    .optional()
    .describe(
      'For a proposed-form preview: the fields, in order. Defaults to full ' +
        'name, email and phone. Ignored when leadFormId is set.'
    ),
});

/**
 * `lead_forms_previewLeadForm` — render a lead form as a card so the owner can
 * eyeball the fields and follow-up channel before anything is created or
 * launched. Read-only. Two modes:
 *   - leadFormId set → preview an existing form (via GET /lead-forms/:id)
 *   - no id          → preview a proposed form (questions + resolved channel)
 */
export const previewLeadFormTool = defineTool<
  z.infer<typeof previewLeadFormInputSchema>,
  LeadFormPreviewOutput
>({
  feature: 'lead-forms',
  action: 'previewLeadForm',
  description:
    'Show a lead form as a preview card (fields + follow-up chat channel). ' +
    'Pass leadFormId to preview an existing form, or omit it (with optional ' +
    'questions) to preview the form you would build. Read-only — creates ' +
    'nothing.',
  inputSchema: previewLeadFormInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Previewing lead form' },
  additionalAllowedPaths: [
    /^lead-forms\/[a-zA-Z0-9_-]+$/,
    WHATSAPP_ACCOUNTS_PATH,
    /^organizations$/,
    /^organizations\/[a-zA-Z0-9_-]+$/,
  ],
  execute: async (input, ctx) => {
    // Mode A: existing form.
    if (input.leadFormId) {
      const existing = await ctx.ports.leadForms.get(input.leadFormId);
      if (existing.status === 'not_found') {
        return leadFormBlockedCard(
          "I couldn't find that lead form — it may have been deleted. Ask me " +
            'to list your lead forms and pick one.'
        );
      }
      if (existing.status === 'unavailable') {
        if (existing.reason.kind === 'server_error') {
          ctx.reportIssue('Failed to read lead form for preview', {
            extra: { reason: existing.reason, leadFormId: input.leadFormId },
          });
        }
        return leadFormBlockedCard(describeLeadFormBlocked(existing.reason));
      }

      const form = existing.form;
      const types = form.questions.map((q) => q.type);
      const channel = form.followUpChannel;
      // The card reports the form's REAL Meta state. The old version set
      // `ready: true` to mean "the preview rendered", which read as "the form
      // is live" for a form sitting in draft or error.
      const isLive = form.status === 'synced' && !!form.metaFormId;
      return {
        data: {
          uiState: 'created',
          variant: 'preview',
          title: form.name,
          fields: buildLeadFormFields({
            questions: form.questions,
            channel,
            status: form.status,
          }),
          actions: [],
          syncState: isLive ? 'synced' : 'not_synced',
          statusMessage: isLive
            ? 'This form is live on Meta and can receive leads.'
            : 'This form is not on Meta, so it cannot receive leads. Ask me to update it and I will re-sync it.',
          leadFormId: form.leadFormId,
          metaFormId: form.metaFormId ?? undefined,
          name: form.name,
          status: form.status,
          followUpChannel: channel,
          questions: types.map((type) => ({
            type,
            label: leadFormFieldTypeLabels[type],
          })),
        },
      };
    }

    // Mode B: proposed form — resolve the country-driven channel for the card.
    const nurture = await resolveOrgNurtureChannel(ctx);
    const questions: LeadFormDefaultQuestion[] = input.questions
      ? input.questions.map((type) => ({ type }))
      : defaultLeadFormQuestions;
    return {
      data: {
        uiState: 'created',
        variant: 'preview',
        title: 'Lead form preview',
        fields: buildLeadFormFields({
          questions,
          channel: nurture.channel,
          flaggedReason: nurture.flagged ? nurture.reason : undefined,
        }),
        actions: [],
        // Nothing exists yet — that is the point of this mode, and it is a
        // state of its own rather than a `ready` flag that means "the card
        // rendered".
        syncState: 'preview_only',
        statusMessage:
          'This is a preview only — nothing has been created yet. Say the word and I will build it.',
        followUpChannel: nurture.channel,
        nurtureChannelFlagged: nurture.flagged,
        nurtureChannelReason: nurture.flagged ? nurture.reason : undefined,
        questions: questions.map((q) => ({
          type: q.type,
          label:
            q.type === 'CUSTOM'
              ? (q.label ?? leadFormFieldTypeLabels.CUSTOM)
              : leadFormFieldTypeLabels[q.type],
        })),
      },
    };
  },
});
