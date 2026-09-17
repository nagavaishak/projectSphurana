import { z } from 'zod';

export const revokePatientSessionSchema = z.object({
  sessionToken: z.string().min(1, 'Session token is required'),
  /**
   * `this-device` (default) revokes only the presented session.
   *
   * `everywhere` revokes every live session for the account. Sessions last 30
   * days and are capped at 10, so a customer who suspects their mailbox or a
   * device is compromised otherwise had no way to invalidate the other nine —
   * and for a portal holding documents and signed consent forms, "sign out
   * everywhere" is the one control that makes a suspicion actionable.
   */
  scope: z.enum(['this-device', 'everywhere']).default('this-device'),
});

export type RevokePatientSessionInput = z.infer<
  typeof revokePatientSessionSchema
>;
