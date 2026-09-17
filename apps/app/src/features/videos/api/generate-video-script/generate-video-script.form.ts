import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The script-generator's form, declared ONCE.
 *
 * `POST videos/generate-script` is fired from four places, but three of them
 * (the create-video wizard's context, generate-video-dialog, new-post-dialog)
 * generate REACTIVELY from state the user set elsewhere — there is no
 * "generate a script" form on those screens, so they build the body from the
 * template/variation/service/narration they already hold.
 *
 * The one surface where a user makes a choice specifically to steer the script
 * and then presses Generate is the create-from-client wizard's Configure step:
 * they pick the TEMPLATE VARIATION and hit "AI Generate". That choice — which
 * maps 1:1 to the wire's `variationId` — is this form. `templateId` is pinned
 * to `before-after` by that flow (it is a before/after wizard), and
 * `refinementInstruction` / `priorScriptText` belong to the re-roll path, whose
 * body is deliberately different.
 */
export const generateVideoScriptForm = defineForm({
  fields: {
    variationId: {
      schema: z.string().min(1),
      label: 'Template Variation',
      control: 'select',
      default: 'before-after-1',
      sample: 'before-after-2',
      sampleLabel:
        'The Reveal — Build suspense before showing the transformation',
    },
  },
});

export const generateVideoScriptFields = generateVideoScriptForm.fields;

export type GenerateVideoScriptFormValues = InferFormValues<
  typeof generateVideoScriptForm
>;
