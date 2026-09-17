import { z } from 'zod';

export const issueManageTokenSchema = z.object({
  organizationId: z.string().min(1),
  appointmentId: z.string().min(1),
  /** The appointment's end — the token expires a grace period after this. */
  appointmentEnd: z.date(),
  /**
   * Whether to drop any token already issued for this appointment.
   *
   * Defaults to true (one live capability per appointment) for the email paths
   * that own the patient's link. Callers that mint a token purely as an
   * internal, short-lived credential — the patient portal, which has already
   * proven ownership another way — must pass `false`, or they silently kill the
   * link in the confirmation and reminders the patient has already received.
   */
  replaceExisting: z.boolean().default(true),
});

// `z.input`, not `z.infer`: `replaceExisting` has a default, so the OUTPUT
// type marks it required while callers must be able to omit it.
export type IssueManageTokenInput = z.input<typeof issueManageTokenSchema>;
