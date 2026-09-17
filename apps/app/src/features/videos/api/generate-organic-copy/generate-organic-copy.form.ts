import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

import { organicVariationIds } from './generate-organic-copy.input';

/**
 * The organic-copy generator's form, declared ONCE.
 *
 * `POST videos/generate-organic-copy` has no text inputs of its own — the AI
 * writes the copy — so the form is exactly the two choices the user makes
 * before pressing Generate: WHICH TEMPLATE (which maps 1:1 to the wire's
 * `variationId`) and WHICH SERVICE the copy is about.
 *
 * `refinementInstruction` / `priorCopy` are NOT part of this form: they are only
 * ever sent by the review modal's re-roll ("change request"), which is a
 * different body built from an already-generated video's context, not from
 * these fields.
 */
export const generateOrganicCopyForm = defineForm({
  fields: {
    variationId: {
      // A grid of template cards, not a labelled control — the contract drives
      // it with a `fills.variationId` override.
      schema: z.enum(organicVariationIds),
      label: 'Template',
      control: 'custom',
      default: 'caption-tease-1',
      sample: 'improves-1',
    },
    serviceId: {
      schema: z.string().optional(),
      label: 'Service',
      control: 'select',
      default: '',
      sample: 'svc-1',
      sampleLabel: 'Lip Filler',
    },
  },
});

export const generateOrganicCopyFields = generateOrganicCopyForm.fields;

export type GenerateOrganicCopyFormValues = InferFormValues<
  typeof generateOrganicCopyForm
>;
