import { consentFormFieldTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/** One extra field a clinic adds to a template (rendered in order). */
export const consentFormFieldSchema = z.object({
  type: z.enum(consentFormFieldTypeValues),
  label: z.string().min(1, 'Field label is required').max(200),
});

export type ConsentFormFieldInput = z.infer<typeof consentFormFieldSchema>;

/**
 * A patient's answers, keyed by field label.
 *
 * Bounded on both axes. Unbounded, this was a JSONB column a signed-in
 * patient could fill with arbitrary keys and arbitrarily long values, capped
 * only by the global 1MB body-parser limit — and every answer is rendered
 * into the archived PDF, synchronously, on the download path.
 *
 * The limits are far above any real form: a consent form with more than 100
 * fields is not a consent form, and a 5k-character answer is not an answer.
 */
export const consentFormFieldDataSchema = z
  .record(z.string().max(200), z.union([z.string().max(5_000), z.boolean()]))
  .refine((data) => Object.keys(data).length <= 100, {
    message: 'Too many answers for one form',
  });

export type ConsentFormFieldDataInput = z.infer<
  typeof consentFormFieldDataSchema
>;
