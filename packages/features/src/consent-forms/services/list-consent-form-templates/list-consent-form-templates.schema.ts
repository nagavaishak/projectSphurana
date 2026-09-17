import { z } from 'zod';

export const listConsentFormTemplatesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * When true, only active templates are returned (service-settings picker).
   * Backs a `@Query()` DTO, so the value arrives as the STRING "true"/"false".
   * `z.coerce.boolean()` is NOT the fix — it makes "false" TRUE. Same
   * preprocess as `list-intake-forms.schema.ts`.
   */
  activeOnly: z
    .preprocess(
      (v) => (v === 'true' ? true : v === 'false' ? false : v),
      z.boolean()
    )
    .default(false),
});

export type ListConsentFormTemplatesInput = z.infer<
  typeof listConsentFormTemplatesSchema
>;
