import { z } from 'zod';
import { turnaroundMinutesSchema } from '../_shared/index.js';

export const setServiceResourceRequirementsSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1),
  /**
   * Absent leaves the service's turnaround untouched; `null` clears it.
   */
  turnaroundMinutes: turnaroundMinutesSchema.nullable().optional(),
  /**
   * The COMPLETE set — anything missing is removed. An EMPTY
   * `eligibleResourceIds` means "any resource in this category".
   */
  requirements: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        eligibleResourceIds: z
          .array(z.string().min(1))
          .default([])
          // A repeated id inside ONE list used to reach the INSERT, trip
          // `service_resource_eligibility`'s unique index and come back as an
          // INTERNAL_ERROR — a 500 for what is plainly a malformed request.
          // The transaction rolled back correctly; only the answer was wrong.
          .refine((ids) => new Set(ids).size === ids.length, {
            message: 'Each resource may appear only once in a category',
          }),
      })
    )
    .refine(
      (requirements) =>
        new Set(requirements.map((r) => r.categoryId)).size ===
        requirements.length,
      { message: 'Each category may appear only once' }
    ),
});

export type SetServiceResourceRequirementsInput = z.input<
  typeof setServiceResourceRequirementsSchema
>;
