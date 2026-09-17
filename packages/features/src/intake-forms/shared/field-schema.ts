import { intakeFieldTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * One question, as accepted from the form builder. `id` is the stable answer
 * key; the builder generates it and it must never be reused for a different
 * question (answers are keyed by it). Options are required — and non-empty —
 * exactly for the field types that choose from a list, so a dropdown can't be
 * saved with nothing to pick.
 */
export const intakeFormFieldSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(intakeFieldTypeValues),
    label: z.string().min(1, 'Every question needs a label'),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1)).optional(),
    helpText: z.string().optional(),
  })
  .superRefine((field, ctx) => {
    const needsOptions =
      field.type === 'dropdown' ||
      field.type === 'single_select' ||
      field.type === 'multi_select';
    if (needsOptions && (!field.options || field.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${field.label}" is a choice field and needs at least one option`,
        path: ['options'],
      });
    }
  });

export const intakeFormFieldsSchema = z.array(intakeFormFieldSchema);
