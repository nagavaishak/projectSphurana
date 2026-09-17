import type {
  LeadFormBlockedReason,
  LeadFormQuestion,
} from '@borradh-workspace/contracts/ports';
import {
  type LeadFormFieldType,
  leadFormFieldTypeLabels,
  leadFormFieldTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * The lead-form row shape the `lead-forms` REST controller returns
 * (a subset of the DB row — the fields the tools read).
 */
export interface LeadFormApiResponse {
  id: string;
  name: string;
  status: 'draft' | 'synced' | 'error' | 'archived';
  metaFormId: string | null;
  followUpChannel: 'none' | 'messenger' | 'whatsapp' | null;
  whatsappNumber: string | null;
  questions: Array<{ type: LeadFormFieldType; label?: string }>;
  syncError?: string | null;
}

export interface LeadFormPreviewField {
  label: string;
  value: string;
}

/**
 * A field the model can ask for, shared by the create and update tools. A
 * standard field is just its type (`"PHONE"`). A CUSTOM question is an object
 * carrying the question TEXT (`label`) and, optionally, multiple-choice
 * `options`. Meta rejects a `label` on a standard type and rejects a CUSTOM
 * question WITHOUT one — which is exactly why "add a question asking X" used to
 * fail: the old schema accepted a bare type only, so the CUSTOM question
 * reached Meta with no label and was rejected.
 */
export const leadFormQuestionInputSchema = z.union([
  z.enum(leadFormFieldTypeValues),
  z.object({
    type: z.enum(leadFormFieldTypeValues),
    label: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'The question text. REQUIRED for CUSTOM questions (e.g. "Which ' +
          'stylist would you prefer?") — Meta rejects a CUSTOM question with ' +
          'no label.'
      ),
    options: z
      .array(z.string().min(1))
      .max(30)
      .optional()
      .describe(
        'Multiple-choice answers for a CUSTOM question. Omit for a free-text ' +
          'answer.'
      ),
  }),
]);

export type LeadFormQuestionInput = z.infer<typeof leadFormQuestionInputSchema>;

/** Slugify a label/answer into a stable Meta question/option key. */
function toLeadFormKey(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || 'custom_question';
}

/**
 * Normalize a model-supplied field spec into the port's `LeadFormQuestion`.
 *
 * Standard types carry nothing but their `type` (Meta rejects a label on
 * them). A CUSTOM question carries its `label`, a derived `key`, and any
 * `options` — this is what lets an added custom question actually reach Meta
 * instead of being rejected for a missing label. A CUSTOM with no label falls
 * back to a non-empty placeholder so Meta never receives an empty one.
 */
export function normalizeLeadFormQuestion(
  input: LeadFormQuestionInput
): LeadFormQuestion {
  const spec = typeof input === 'string' ? { type: input } : input;
  if (spec.type !== 'CUSTOM') return { type: spec.type };

  const rawLabel = 'label' in spec ? spec.label?.trim() : undefined;
  const label = rawLabel || leadFormFieldTypeLabels.CUSTOM;
  const question: LeadFormQuestion = {
    type: 'CUSTOM',
    label,
    key: toLeadFormKey(label),
  };
  const options = 'options' in spec ? spec.options : undefined;
  if (options?.length) {
    question.options = options.map((value) => ({
      value,
      key: toLeadFormKey(value),
    }));
  }
  return question;
}

/**
 * What the SERVER confirmed about the form this card describes.
 *
 * There is deliberately NO `ready` boolean here. `{ ready: false, status:
 * 'draft' }` shipped repeatedly in production and Claire reported the form as
 * live — a Meta instant form that never synced cannot receive a single lead.
 * Worse, the `reason` that was supposed to accompany it was always
 * `undefined`, because the create endpoint returns the row it captured BEFORE
 * the sync ran (see `lead-forms.port.ts`). These five states are mutually
 * exclusive and every one of them is a fact somebody read back:
 *
 *   - `synced`            — Meta minted a form id. The only live state.
 *   - `not_synced`        — confirmed NOT on Meta. Cannot receive leads.
 *   - `sync_unconfirmed`  — saved; the sync outcome could not be read back.
 *   - `no_form`           — nothing was saved / no such form.
 *   - `preview_only`      — a proposed form. Nothing exists yet, by design.
 */
export type LeadFormCardSyncState =
  | 'synced'
  | 'not_synced'
  | 'sync_unconfirmed'
  | 'no_form'
  | 'preview_only';

/**
 * Preview/created card for a lead form. Mirrors `previewCampaign`'s output
 * shape (`uiState:'created', variant:'preview'`) so the frontend renders it
 * via the same generic dispatch and it persists across refresh.
 */
export interface LeadFormPreviewOutput {
  uiState: 'created';
  variant: 'preview';
  title: string;
  fields: LeadFormPreviewField[];
  actions: [];
  syncState: LeadFormCardSyncState;
  /**
   * One sentence stating what is true, present in EVERY state — including the
   * happy one. An optional field cannot encode failure if it is never
   * optional.
   */
  statusMessage: string;
  leadFormId?: string;
  metaFormId?: string;
  /**
   * The Meta form id this form had before an edit. Meta instant forms are
   * immutable, so a successful re-sync mints a NEW id and any attached live
   * campaign keeps serving the OLD one until its ad is rebuilt. Both ids are
   * carried so the fact is checkable rather than asserted by a boolean.
   */
  previousMetaFormId?: string;
  name?: string;
  status?: LeadFormApiResponse['status'];
  followUpChannel?: 'none' | 'messenger' | 'whatsapp';
  nurtureChannelFlagged?: boolean;
  nurtureChannelReason?: string;
  questions?: Array<{ type: LeadFormFieldType; label: string }>;
}

function channelLabel(channel: 'none' | 'messenger' | 'whatsapp'): string {
  if (channel === 'whatsapp') return 'WhatsApp';
  if (channel === 'messenger') return 'Messenger';
  return 'No follow-up chat';
}

/** Default lead-form name when the owner didn't name one. Date + time keeps it
 *  unique against the per-org unique-name constraint. */
export function defaultLeadFormName(now: Date = new Date()): string {
  const datePart = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(now);
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  return `Lead form — ${datePart} ${hh}:${mm}`;
}

/** Build the human-readable card fields for a lead form. */
export function buildLeadFormFields(args: {
  questions: Array<{ type: LeadFormFieldType; label?: string }>;
  channel: 'none' | 'messenger' | 'whatsapp';
  status?: LeadFormApiResponse['status'];
  flaggedReason?: string;
}): LeadFormPreviewField[] {
  const fieldList = args.questions
    .map((q) =>
      q.type === 'CUSTOM'
        ? q.label?.trim() || leadFormFieldTypeLabels.CUSTOM
        : leadFormFieldTypeLabels[q.type]
    )
    .join(', ');
  const fields: LeadFormPreviewField[] = [
    { label: 'Fields', value: fieldList || '(none)' },
    {
      label: 'Follow-up chat',
      value: args.flaggedReason
        ? `${channelLabel(args.channel)} — ${args.flaggedReason}`
        : channelLabel(args.channel),
    },
  ];
  if (args.status) {
    fields.push({ label: 'Status', value: STATUS_LABELS[args.status] });
  }
  return fields;
}

/**
 * Status wording for the card. `draft` and `error` both mean "Meta has no copy
 * of this form", and both used to render as the bare enum value next to a
 * title that said the form was ready.
 */
const STATUS_LABELS: Record<LeadFormApiResponse['status'], string> = {
  synced: 'Live on Meta',
  draft: 'Not on Meta yet — it cannot receive leads',
  error: 'Not on Meta — the sync failed',
  archived: 'Archived',
};

/**
 * A card for "there is no form" — a pre-flight refusal (no privacy-policy URL,
 * last field removed) or a form that could not be found. `syncState: 'no_form'`
 * is the whole claim; there is no `ready: false` to be mistaken for a form that
 * merely needs a nudge.
 */
export function leadFormBlockedCard(message: string): {
  data: LeadFormPreviewOutput;
} {
  return {
    data: {
      uiState: 'created',
      variant: 'preview',
      title: "Can't build the lead form yet",
      fields: [{ label: 'Reason', value: message }],
      actions: [],
      syncState: 'no_form',
      statusMessage: message,
    },
  };
}

/**
 * Human sentence for every blocked reason the port can return.
 *
 * The `switch` is exhaustive over `kind` with no `default`, so adding a member
 * to `LeadFormSyncBlockedReason` / `LeadFormWriteBlockedReason` is a compile
 * error here rather than a silent fall-through to "something went wrong".
 * (Destined for `apps/api/src/assistant/ports/reason-messages.ts` alongside the
 * videos and meta-ads describers.)
 */
export function describeLeadFormBlocked(reason: LeadFormBlockedReason): string {
  switch (reason.kind) {
    case 'meta_not_connected':
      return "Your Meta Ads account isn't connected, so I couldn't publish the form to Facebook. Reconnect Meta in Settings → Integrations and I'll sync it.";
    case 'no_meta_page':
      return "There's no Facebook Page selected for your ads, and a lead form has to live on a Page. Pick one in Settings → Integrations and I'll sync the form.";
    case 'meta_page_unusable':
      return "I couldn't publish the form because your Facebook Page connection has expired. Reconnect the Page in Settings → Integrations, then ask me to sync the form again.";
    case 'no_ad_account':
      return "Your Meta integration has no ad account set, so the form can't be published. Add one in Settings → Integrations and I'll retry.";
    case 'meta_token_expired':
      return "Your Meta connection has expired, so I couldn't publish the form to Meta — it isn't live and can't collect leads yet. Reconnect Meta in Settings → Integrations, then ask me to sync the form again.";
    case 'meta_rejected':
      // Meta's own words. Rewriting them would lose the only actionable
      // detail the owner has.
      return `Meta rejected the form: ${reason.message}`;
    case 'sync_not_attempted':
      return "The form is saved but it never reached Meta, and no reason was recorded. It can't collect leads until it syncs.";
    case 'duplicate_name':
      return `You already have a lead form called "${reason.name}". Pick a different name, or edit the existing one.`;
    case 'privacy_policy_missing':
      return 'Meta requires a privacy-policy link on every lead form, and I could not find a website or Facebook Page to use. Add one in Settings → Business.';
    case 'lead_form_not_found':
      return "I couldn't find that lead form — it may have been deleted. Ask me to list your forms and pick one.";
    case 'other':
      return reason.message;
    case 'server_error':
      return 'Something went wrong on our side while saving the lead form. Try again in a moment.';
  }
}
