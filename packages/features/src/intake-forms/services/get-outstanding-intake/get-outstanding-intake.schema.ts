import { z } from 'zod';
export const getOutstandingIntakeSchema = z.object({
  organizationId: z.string().min(1),
  appointmentId: z.string().min(1),
});
export type GetOutstandingIntakeInput = z.infer<
  typeof getOutstandingIntakeSchema
>;

export interface OutstandingIntake {
  /** Pending submissions on this appointment whose link is blocking. */
  blockingCount: number;
  /** All pending submissions (blocking or not). */
  pendingCount: number;
  /** True when a required (blocksBooking) form is still incomplete. */
  isBlocked: boolean;
}
