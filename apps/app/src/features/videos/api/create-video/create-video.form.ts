import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import {
  aiVoiceIdLabels,
  aiVoiceIdValues,
} from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * The `POST videos` form, declared ONCE — across BOTH of its creation flows.
 *
 * `POST videos` is written by two genuinely different flows, and each owns a
 * different slice of the body (see the surfaces in
 * `create-video.contract.test.tsx`):
 *
 *  - THE CREATE-VIDEO WIZARD writes the draft the moment the user leaves the
 *    service step (the script step needs a video id for the mobile-record QR
 *    code), so the only fields it can put in the body are `serviceId` +
 *    `offerId`. Title, template, variation and the minimal draftConfig are
 *    derived from the route, the variation and the org's brand defaults.
 *
 *  - THE CREATE-FROM-CLIENT WIZARD builds the whole thing on one screen: the
 *    user types a title, picks the variation, the narration mode, the AI voice
 *    and the script, and presses "Create & Render". Its `serviceId` comes from
 *    the face group, not from a control.
 *
 * Declaring both slices in one form is what lets the harness prove that no
 * field falls off EVERY surface — `owns` narrows which surface must render a
 * field; it can never make a field render nowhere.
 */
export const createVideoForm = defineForm({
  fields: {
    // ---- create-video wizard (service step)
    serviceId: {
      // A grid of service cards behind a Yes/No toggle, not a labelled control.
      schema: z.string().optional(),
      label: 'Select a service',
      control: 'custom',
      default: '',
      sample: 'svc-1',
    },
    offerId: {
      // A Radix Select with a placeholder rather than a bound <label>.
      schema: z.string().optional(),
      label: 'Link to an offer (optional)',
      control: 'custom',
      default: '',
      sample: 'offer-1',
    },

    // ---- create-from-client wizard (configure step)
    title: {
      schema: z.string().optional(),
      label: 'Video Title',
      control: 'text',
      default: '',
      sample: "Alice's transformation",
    },
    variationId: {
      schema: z.string().optional(),
      label: 'Template Variation',
      control: 'select',
      default: 'before-after-1',
      sample: 'before-after-2',
      sampleLabel:
        'The Reveal — Build suspense before showing the transformation',
    },
    narrationType: {
      // Folded into `draftConfig.narrationType`.
      schema: z.enum(['ai_voiceover', 'recorded']),
      label: 'Narration',
      control: 'select',
      default: 'ai_voiceover',
      sample: 'ai_voiceover',
      sampleLabel: 'AI Voiceover',
      derived: true,
    },
    aiVoiceId: {
      // Folded into `draftConfig.aiVoiceId`.
      schema: z.enum(aiVoiceIdValues),
      label: 'Voice',
      control: 'select',
      default: aiVoiceIdValues[0],
      sample: aiVoiceIdValues[1] ?? aiVoiceIdValues[0],
      sampleLabel: aiVoiceIdLabels[aiVoiceIdValues[1] ?? aiVoiceIdValues[0]],
      derived: true,
    },
    scriptText: {
      // Folded into `draftConfig.scriptText`.
      schema: z.string().optional(),
      label: 'Script',
      control: 'textarea',
      default: '',
      sample: 'Look at this transformation.',
      derived: true,
    },
  },
});

export const createVideoFields = createVideoForm.fields;

export type CreateVideoFormValues = InferFormValues<typeof createVideoForm>;
