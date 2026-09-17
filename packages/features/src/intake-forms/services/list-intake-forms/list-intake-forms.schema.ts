import { z } from 'zod';

export const listIntakeFormsSchema = z.object({
  organizationId: z.string().min(1),
  /**
   * `z.boolean()` here was a live 400 in production. `main.ts` registers
   * nestjs-zod's `ZodValidationPipe` globally, and this schema backs a whole-
   * object `@Query() dto` binding — so `GET /intake-forms?includeInactive=true`
   * handed the STRING "true" to a boolean schema and was rejected at the
   * boundary. Only the default path (param omitted) ever worked.
   *
   * The integration harness could not show this: it registered only the stock
   * class-validator pipe, which validates nothing on a `createZodDto`, so the
   * string reached the service and was re-parsed there.
   *
   * `z.coerce.boolean()` is NOT the fix — it makes the string "false" TRUE.
   * This is the same preprocess `list-services.schema.ts` already uses.
   */
  includeInactive: z
    .preprocess(
      (v) => (v === 'true' ? true : v === 'false' ? false : v),
      z.boolean()
    )
    .default(false),
});
export type ListIntakeFormsInput = z.infer<typeof listIntakeFormsSchema>;
