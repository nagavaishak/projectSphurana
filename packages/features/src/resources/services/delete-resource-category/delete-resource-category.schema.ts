import { z } from 'zod';

export const deleteResourceCategorySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  /**
   * The branch the operator was looking at, from the validated
   * `X-Location-Id` header.
   *
   * Does NOT scope the delete — a category is org-wide, and so is the guard
   * that refuses to remove one that still has resources. It only shapes the
   * REFUSAL: the settings list counts what is at this branch, so without it an
   * operator at Cork reads "Lasers: 0", presses delete, and is told to move
   * three resources they cannot see.
   */
  locationId: z.string().min(1).optional(),
});

export type DeleteResourceCategoryInput = z.infer<
  typeof deleteResourceCategorySchema
>;
