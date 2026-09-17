import { z } from 'zod';

// Answers arrive as an opaque map; each value is validated against the field
// snapshot at runtime (validateIntakeAnswers), so the zod shape here is loose.
export const submitIntakeFormSchema = z.object({
  organizationSlug: z.string().min(1),
  token: z.string().min(1),
  answers: z.record(z.string(), z.unknown()).default({}),
});
export type SubmitIntakeFormInput = z.infer<typeof submitIntakeFormSchema>;
