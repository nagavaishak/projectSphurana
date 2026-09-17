import { z } from 'zod';

export const discardItemVideoEditsSchema = z.object({
  itemId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type DiscardItemVideoEditsInput = z.infer<
  typeof discardItemVideoEditsSchema
>;

export interface DiscardItemVideoEditsResponse {
  /** False when there was nothing staged — a second Reject, most often. */
  discarded: boolean;
}
