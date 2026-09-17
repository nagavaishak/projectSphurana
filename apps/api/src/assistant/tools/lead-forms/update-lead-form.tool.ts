import type { LeadFormQuestion } from '@borradh-workspace/contracts/ports';
import {
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
  leadFormQuestionInputSchema,
  normalizeLeadFormQuestion,
} from './_shared.js';

const updateLeadFormInputSchema = z.object({
  leadFormId: z
    .string()
    .min(1)
    .describe('The lead form to edit (from listLeadForms / previewLeadForm).'),
  name: z.string().min(1).max(100).optional().describe('Rename the form.'),
  addFields: z
    .array(leadFormQuestionInputSchema)
    .optional()
    .describe(
      'Fields to ADD to the form, merged onto the current fields. A standard ' +
        'field is just its type ("PHONE"); a standard type already on the ' +
        'form is ignored. A custom question is an object: { type: "CUSTOM", ' +
        'label: "<question text>", options: ["A", "B"] } — label is required ' +
        'for CUSTOM, options make it multiple-choice (omit for free text).'
    ),
  removeFields: z
    .array(z.enum(leadFormFieldTypeValues))
    .optional()
    .describe('Field types to REMOVE from the form (e.g. ["COMPANY_NAME"]).'),
  questions: z
    .array(leadFormQuestionInputSchema)
    .min(1)
    .optional()
    .describe(
      'Replace the ENTIRE field list, in order. Use instead of ' +
        'addFields/removeFields when reordering or rebuilding from scratch. ' +
        'Same format as addFields (custom questions carry a label + options).'
    ),
  followUpChannel: z
    .enum(['none', 'messenger', 'whatsapp', 'auto'])
    .optional()
    .describe(
      'Change the follow-up chat channel. "auto" re-resolves it from the ' +
        'clinic country (US → Messenger, UK/Ireland → WhatsApp).'
    ),
});

/**
 * `lead_forms_updateLeadForm` — edit an existing lead form (add/remove/reorder
 * fields, rename, change the follow-up channel) and re-sync it to Meta.
 *
 * Meta instant forms are immutable, so editing a SYNCED form flips it back to
 * draft and re-sync mints a NEW Meta form id. If the form is already attached
 * to a live campaign, that campaign keeps the OLD form until its ad is rebuilt
 * — both `metaFormId` and `previousMetaFormId` are on the output so that fact
 * is checkable, and it is spelled out in `statusMessage`.
 *
 * As with create, the outcome is `syncState`, not a `ready` boolean. A failed
 * re-sync is the dangerous case here: the edit is saved, the NEW version is not
 * on Meta, and the OLD form may still be live collecting leads with the old
 * fields. That is now three distinct facts on the result instead of one
 * `ready: false`.
 */
export const updateLeadFormTool = defineTool<
  z.infer<typeof updateLeadFormInputSchema>,
  LeadFormPreviewOutput
>({
  feature: 'lead-forms',
  action: 'updateLeadForm',
  description:
    'Edit a lead form: add/remove/reorder fields, rename it, or change the ' +
    'follow-up chat channel, then re-sync to Meta. Editing a form that is ' +
    'already live mints a new form on Meta — warn the owner that an attached ' +
    'live campaign keeps the old form until its ad is rebuilt.',
  inputSchema: updateLeadFormInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating lead form' },
  additionalAllowedPaths: [
    /^lead-forms\/[a-zA-Z0-9_-]+$/,
    WHATSAPP_ACCOUNTS_PATH,
    /^organizations$/,
    /^organizations\/[a-zA-Z0-9_-]+$/,
  ],
  execute: async (input, ctx) => {
    const existing = await ctx.ports.leadForms.get(input.leadFormId);
    if (existing.status === 'not_found') {
      return leadFormBlockedCard(
        "I couldn't find that lead form to edit — ask me to list your forms."
      );
    }
    if (existing.status === 'unavailable') {
      // A broken API is not a missing form. The old code caught both and told
      // the owner the form did not exist.
      if (existing.reason.kind === 'server_error') {
        ctx.reportIssue('Failed to read lead form before update', {
          extra: { reason: existing.reason, leadFormId: input.leadFormId },
        });
      }
      return leadFormBlockedCard(describeLeadFormBlocked(existing.reason));
    }
    const current = existing.form;

    // Resolve the desired field list as full questions (so a CUSTOM question's
    // label + options survive to Meta). Explicit `questions` wins; otherwise
    // merge add/remove against the current fields. The current fields already
    // carry their labels/keys/options from the port `get`.
    let nextQuestions: LeadFormQuestion[] = [...current.questions];
    if (input.questions) {
      nextQuestions = input.questions.map(normalizeLeadFormQuestion);
    } else {
      if (input.removeFields?.length) {
        const remove = new Set(input.removeFields);
        nextQuestions = nextQuestions.filter((q) => !remove.has(q.type));
      }
      if (input.addFields?.length) {
        for (const spec of input.addFields) {
          const q = normalizeLeadFormQuestion(spec);
          // A standard type is single-instance; skip it if already present.
          // CUSTOM questions are free-form, so multiple are allowed.
          if (
            q.type !== 'CUSTOM' &&
            nextQuestions.some((e) => e.type === q.type)
          ) {
            continue;
          }
          nextQuestions.push(q);
        }
      }
    }
    if (nextQuestions.length === 0) {
      return leadFormBlockedCard(
        'A lead form needs at least one field — I can’t remove them all.'
      );
    }

    // Resolve the channel + whatsapp number if changing it.
    let followUpChannel = input.followUpChannel;
    let whatsappNumber: string | null | undefined;
    let flaggedReason: string | undefined;
    if (followUpChannel === 'auto') {
      const nurture = await resolveOrgNurtureChannel(ctx);
      followUpChannel = nurture.channel;
      whatsappNumber =
        nurture.channel === 'whatsapp' ? nurture.whatsappNumber : null;
      flaggedReason = nurture.flagged ? nurture.reason : undefined;
    } else if (followUpChannel === 'whatsapp') {
      const nurture = await resolveOrgNurtureChannel(ctx);
      whatsappNumber = nurture.whatsappNumber;
    } else if (followUpChannel === 'messenger' || followUpChannel === 'none') {
      whatsappNumber = null;
    }

    const result = await ctx.ports.leadForms.update({
      leadFormId: input.leadFormId,
      questions: nextQuestions,
      ...(input.name ? { name: input.name } : {}),
      ...(followUpChannel ? { followUpChannel } : {}),
      ...(whatsappNumber !== undefined ? { whatsappNumber } : {}),
    });

    if (result.status === 'not_updated') {
      const message = describeLeadFormBlocked(result.reason);
      if (result.reason.kind === 'server_error') {
        ctx.reportIssue('Failed to update lead form', {
          extra: { reason: result.reason, leadFormId: input.leadFormId },
        });
      }
      return leadFormBlockedCard(message);
    }

    const { form, previousMetaFormId } = result;
    const effectiveChannel = form.followUpChannel;

    // Meta instant forms are immutable, so a re-sync mints a NEW id. Derived
    // from the two ids the tool actually read — both are on the output, so the
    // claim is checkable rather than a boolean nobody can verify.
    const relinkNeeded =
      !!previousMetaFormId &&
      !!form.metaFormId &&
      form.metaFormId !== previousMetaFormId;
    const relinkNote = relinkNeeded
      ? ' Any live campaign using this form keeps the OLD version until its ad is rebuilt.'
      : '';

    if (
      result.status === 'not_synced' &&
      result.reason.kind === 'server_error'
    ) {
      ctx.reportIssue('Lead form re-sync failed', {
        extra: { reason: result.reason, leadFormId: form.leadFormId },
      });
    }

    // Exhaustive over `UpdateLeadFormResult` with no `default` — a new member
    // fails to compile here instead of silently reading as a success.
    const { title, statusMessage } = ((): {
      title: string;
      statusMessage: string;
    } => {
      switch (result.status) {
        case 'synced':
          return {
            title: 'Lead form updated and live on Meta',
            statusMessage: `The edited form is published on Meta.${relinkNote}`,
          };
        case 'not_synced':
          return {
            title: 'Lead form updated — NOT live on Meta',
            statusMessage: `The edit was saved but the new version never reached Meta, so it cannot collect leads. ${describeLeadFormBlocked(
              result.reason
            )}${
              previousMetaFormId
                ? ' The previous version is still live on Meta with the old fields.'
                : ''
            }`,
          };
        case 'sync_unconfirmed':
          return {
            title: 'Lead form updated — sync unconfirmed',
            statusMessage:
              "The edit was saved, but I couldn't check whether the new version reached Meta. Ask me to preview the form before relying on it.",
          };
      }
    })();

    return {
      data: {
        uiState: 'created',
        variant: 'preview',
        title,
        fields: buildLeadFormFields({
          questions: nextQuestions,
          channel: effectiveChannel,
          status: form.status,
          flaggedReason,
        }),
        actions: [],
        syncState: result.status,
        statusMessage,
        leadFormId: form.leadFormId,
        metaFormId: form.metaFormId ?? undefined,
        previousMetaFormId: previousMetaFormId ?? undefined,
        name: form.name,
        status: form.status,
        followUpChannel: effectiveChannel,
        questions: nextQuestions.map((q) => ({
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
