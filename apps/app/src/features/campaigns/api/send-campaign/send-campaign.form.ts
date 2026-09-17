import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

import { campaignChannelValues } from '../types';

/**
 * The campaign composer's form, declared ONCE.
 *
 * The composer is a one-screen flow (who → what → channels → send) whose Send
 * action runs `useSendCampaign`: create-or-reuse the segment, `POST campaigns`,
 * one message per active channel, then launch. The four wire bodies are built by
 * four payload builders; the composer only ever passes typed intent.
 *
 * The registered operation is `POST campaigns`, and NONE of that body's keys is
 * typed literally by the user — they are all DERIVED from the composer's state:
 *
 *   - `audience`  → the segment is created (or reused) first, and its id lands
 *                   on the body as `segmentId`.
 *   - `channels`  → the one field that reaches `POST campaigns` verbatim.
 *   - `subject` / `body` → carried to `POST campaigns/:id/messages`, not here.
 *   - `name` / `type` → stamped by the send flow ("Message — <date>", 'custom').
 *
 * `audience` and `channels` are chip rows rather than labelled controls, so they
 * declare `control: 'custom'` and the contract drives them with a `fills`
 * override. See `@/lib/form-contract/define-form` for why the shape is this way.
 */
export const sendCampaignForm = defineForm({
  fields: {
    audience: {
      // The composer holds the whole AudienceOption; the key that matters for
      // the contract is which preset/saved segment is selected.
      schema: z.string().min(1),
      label: 'Send to',
      control: 'custom',
      default: 'everyone',
      sample: 'new',
      // Reaches the wire as the created segment's id, not as this key.
      derived: true,
    },
    body: {
      schema: z.string().min(1, 'Write a message first'),
      label: 'Message',
      control: 'textarea',
      default: '',
      sample: 'Book now and save 20% on your next visit',
      // Sent on `POST campaigns/:id/messages`, not on `POST campaigns`.
      derived: true,
    },
    subject: {
      schema: z.string(),
      label: 'Email subject',
      control: 'text',
      default: '',
      sample: 'Book now and save 20%',
      // Sent on `POST campaigns/:id/messages` (email only), not on this body.
      derived: true,
    },
    channels: {
      // Auto-included wherever the audience is reachable AND the org can
      // deliver; the chips toggle one off. No labelled control — chips only.
      schema: z.array(z.enum(campaignChannelValues)).min(1),
      label: 'Channels',
      control: 'custom',
      default: [],
      sample: ['email'],
    },
    // ── WhatsApp template ───────────────────────────────────────────────────
    // Bulk WhatsApp is template-only (no free-form). The picker only renders
    // when WhatsApp is deliverable and the list is the org's Meta-synced WABA
    // templates, which the harness has no fixtures to drive. The selection
    // never reaches `POST campaigns` — it's carried to
    // `POST campaigns/:id/messages` as `whatsappTemplateId` +
    // `whatsappTemplateParams` by the upsert payload builder.
    whatsappTemplateId: {
      schema: z.string(),
      default: '',
      exempt:
        'Options come from the Meta-synced WABA templates — no harness fixture.',
    },
    whatsappTemplateParams: {
      schema: z.array(z.string()),
      default: [],
      exempt:
        'Inputs render per {{n}} placeholder of the selected Meta template.',
    },
  },
});

export const sendCampaignFormSchema = sendCampaignForm.schema;
export const sendCampaignFormDefaults = sendCampaignForm.defaults;
export const sendCampaignFields = sendCampaignForm.fields;

export type SendCampaignFormValues = InferFormValues<typeof sendCampaignForm>;
