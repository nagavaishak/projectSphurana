import type { LeadFormQuestion } from '@borradh-workspace/contracts/ports';
import { db } from '@borradh-workspace/database';
import {
  findSimilarLeadForms,
  recordActionIntent,
} from '@borradh-workspace/features/assistant';
import { resolveOrgPrivacyPolicyUrl } from '@borradh-workspace/features/organizations';
import {
  defaultLeadFormQuestions,
  leadFormFieldTypeLabels,
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
  defaultLeadFormName,
  describeLeadFormBlocked,
  leadFormBlockedCard,
  leadFormQuestionInputSchema,
  normalizeLeadFormQuestion,
} from './_shared.js';

const createLeadFormInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Internal name for the form (the owner sees it in the dashboard). ' +
        'Optional — a dated default is generated if omitted.'
    ),
  questions: z
    .array(leadFormQuestionInputSchema)
    .min(1)
    .optional()
    .describe(
      'The fields the lead fills in, in order. Defaults to full name, email ' +
        'and phone. Only pass this when the owner wants different fields. A ' +
        'standard field is just its type ("PHONE"). A custom question is an ' +
        'object: { type: "CUSTOM", label: "<question text>", options: ["A", ' +
        '"B"] } — label is required for CUSTOM, options make it ' +
        'multiple-choice (omit for free text).'
    ),
  createAnyway: z
    .boolean()
    .optional()
    .describe(
      'Set true ONLY after the tool returned existing_candidates and the owner ' +
        'confirmed they want a NEW lead form anyway. Leaving it unset lets the ' +
        'tool surface a recently-created similar form first so the same request ' +
        'does not spawn several duplicate forms (#79).'
    ),
});

interface LeadFormCandidate {
  id: string;
  name: string;
  createdAt: string;
  matchReasons: string[];
}

interface LeadFormExistingCandidatesOutput {
  uiState: 'existing_candidates';
  title: string;
  message: string;
  proposedName: string;
  existingCandidates: LeadFormCandidate[];
}

/**
 * `lead_forms_createLeadForm` — create a Meta instant lead form and sync it to
 * Meta so it can be attached to a lead-form campaign.
 *
 * Non-destructive single create (no confirmation token): the owner has already
 * approved the campaign verbally in the create-campaign flow. The nurturing
 * follow-up channel (Messenger/WhatsApp) is resolved from the org country, so
 * the model never picks it. Requires the org to have a privacy-policy URL on
 * file (Meta hard-requires it) — otherwise returns a `no_form` card.
 *
 * The outcome is reported as `syncState`, never as a `ready` boolean. Only
 * `synced` means the form exists on Meta; `not_synced` means it was saved but
 * Meta has no copy and it will collect nothing.
 */
export const createLeadFormTool = defineTool<
  z.infer<typeof createLeadFormInputSchema>,
  LeadFormPreviewOutput | LeadFormExistingCandidatesOutput
>({
  feature: 'lead-forms',
  action: 'createLeadForm',
  description:
    'Create a Meta lead form (instant form) and sync it to Meta. Defaults to ' +
    'full name, email and phone. The follow-up chat channel is set ' +
    'automatically from the clinic country (US → Messenger, UK/Ireland → ' +
    'WhatsApp). Use in the campaign flow before createCampaign, then pass the ' +
    'returned leadFormId to createCampaign with followUpType "lead_form". ' +
    'Check syncState on the result: ONLY "synced" means the form is live on ' +
    'Meta and can receive leads. With "not_synced" or "sync_unconfirmed" you ' +
    'must NOT tell the owner the form is live or attach it to a campaign — ' +
    'relay statusMessage instead.',
  inputSchema: createLeadFormInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Building lead form' },
  additionalAllowedPaths: [
    /^lead-forms$/,
    /^organizations$/,
    /^organizations\/[a-zA-Z0-9_-]+$/,
    WHATSAPP_ACCOUNTS_PATH,
  ],
  execute: async (input, ctx) => {
    // Meta requires a privacy-policy URL on every lead form. Rather than block
    // the owner when they haven't set a dedicated policy, fall back to their
    // website / Facebook Page, and finally the org's own connected Facebook
    // Page (resolveOrgPrivacyPolicyUrl). Only when Meta isn't connected at all
    // (no page anywhere) do we stop and route to a message-us campaign instead.
    let privacyPolicyUrl: string | null = null;
    try {
      privacyPolicyUrl = await resolveOrgPrivacyPolicyUrl(
        db,
        ctx.organizationId
      );
    } catch {
      // fall through — treated as missing below
    }
    if (!privacyPolicyUrl) {
      return leadFormBlockedCard(
        "I can't build a lead form yet — Meta requires a privacy-policy link " +
          'and I could not find your website or Facebook Page to use. Add a ' +
          'website or privacy-policy URL in Settings → Business (or paste me ' +
          'the link), or I can run a message-us campaign instead.'
      );
    }

    const nurture = await resolveOrgNurtureChannel(ctx);
    // The model passes a field list only when the owner wants different fields;
    // otherwise we use the rich default set (which includes the multiple-choice
    // treatment-timing question). Normalizing carries a CUSTOM question's label
    // (and options) through to Meta instead of dropping it.
    const questions: LeadFormQuestion[] = input.questions
      ? input.questions.map(normalizeLeadFormQuestion)
      : defaultLeadFormQuestions;
    const name = input.name?.trim() || defaultLeadFormName();

    // Pre-create dedupe (Phase 4 #79): a single "set up a lead-form campaign"
    // request used to spawn three forms. Before creating, check the recent
    // action-intent log for a near-duplicate form and surface it instead.
    // Best-effort — never block a legitimate create on a lookup failure.
    if (!input.createAnyway) {
      try {
        const similar = await findSimilarLeadForms(db, {
          organizationId: ctx.organizationId,
          name,
        });
        if (similar.success && similar.data.candidates.length > 0) {
          const existingCandidates: LeadFormCandidate[] =
            similar.data.candidates.map((c) => ({
              id: c.resourceId ?? c.id,
              name: c.displayName ?? 'Untitled form',
              createdAt: c.createdAt,
              matchReasons: c.matchReasons,
            }));
          return {
            data: {
              uiState: 'existing_candidates',
              title: 'You may already have this lead form',
              message: `You created ${existingCandidates.length} similar lead form${existingCandidates.length === 1 ? '' : 's'} recently. Reuse one of those, or create a new one anyway? I will not create a duplicate unless you confirm.`,
              proposedName: name,
              existingCandidates,
            },
            presentation: {
              type: 'existing_candidates',
              kind: 'lead_form',
              proposedName: name,
              candidates: existingCandidates,
            },
          };
        }
      } catch {
        // Non-fatal — proceed with creation.
      }
    }

    // Everything about creating the form now goes through the capability port.
    // The tool cannot see the HTTP response, so it cannot re-invent a `ready`
    // flag from a body that is stale on precisely the failure path that
    // mattered — it gets a union it has to branch on.
    const result = await ctx.ports.leadForms.create({
      name,
      questions,
      privacyPolicyUrl,
      followUpChannel: nurture.channel,
      whatsappNumber:
        nurture.channel === 'whatsapp' ? nurture.whatsappNumber : null,
    });

    if (result.status === 'not_created') {
      const message = describeLeadFormBlocked(result.reason);
      if (result.reason.kind === 'server_error') {
        ctx.reportIssue('Failed to create lead form', {
          extra: { reason: result.reason },
        });
      }
      return leadFormBlockedCard(message);
    }

    const { form } = result;
    const fields = buildLeadFormFields({
      questions,
      channel: nurture.channel,
      status: form.status,
      flaggedReason: nurture.flagged ? nurture.reason : undefined,
    });

    if (
      result.status === 'not_synced' &&
      result.reason.kind === 'server_error'
    ) {
      ctx.reportIssue('Lead form sync failed', {
        extra: { reason: result.reason, leadFormId: form.leadFormId },
      });
    }

    // The title and the sentence say only what was confirmed. "Created" is not
    // "live on Meta", and a form Meta never received collects nothing. The
    // switch returns in every branch and has no `default`, so a new member on
    // `CreateLeadFormResult` is a compile error rather than a silent fall-back.
    const { title, statusMessage } = ((): {
      title: string;
      statusMessage: string;
    } => {
      switch (result.status) {
        case 'synced':
          return {
            title: 'Lead form live on Meta',
            statusMessage:
              'The form is published on Meta and can receive leads. Attach it to a lead-form campaign.',
          };
        case 'not_synced':
          return {
            title: 'Lead form saved — NOT live on Meta',
            statusMessage: `The form is saved but Meta has no copy of it, so it cannot collect any leads and must not be attached to a campaign yet. ${describeLeadFormBlocked(
              result.reason
            )}`,
          };
        case 'sync_unconfirmed':
          return {
            title: 'Lead form saved — sync unconfirmed',
            statusMessage:
              "The form is saved, but I couldn't check whether it reached Meta. Ask me to preview it before you attach it to a campaign.",
          };
      }
    })();

    // Record the created form as an action intent so a repeat request resolves
    // to THIS form instead of spawning another (Phase 4 #79). Best-effort.
    try {
      await recordActionIntent(db, {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        action: 'create_lead_form',
        key: form.name,
        resourceId: form.leadFormId,
        displayName: form.name,
      });
    } catch {
      // Non-fatal.
    }

    return {
      data: {
        uiState: 'created',
        variant: 'preview',
        title,
        fields,
        actions: [],
        syncState: result.status,
        statusMessage,
        leadFormId: form.leadFormId,
        metaFormId: form.metaFormId ?? undefined,
        name: form.name,
        status: form.status,
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
