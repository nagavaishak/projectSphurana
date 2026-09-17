import { z } from 'zod';

export const listMembershipPlansSchema = z.object({
  organizationId: z.string().min(1),
  /** When set, filter by active/inactive; omit for all plans. */
  isActive: z.boolean().optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header. Zero join rows
   * means "available everywhere" — see `atLocationOrUnassigned`.
   */
  locationId: z.string().min(1).optional(),
});

export type ListMembershipPlansInput = z.infer<
  typeof listMembershipPlansSchema
>;
