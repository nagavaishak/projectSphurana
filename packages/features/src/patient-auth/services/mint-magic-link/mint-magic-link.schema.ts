import { z } from 'zod';

/**
 * Staff-side "Copy portal link" + emailed sign-in links: both ids come from the
 * STAFF session/route (or the server-side email composer), never from a
 * patient.
 */
export const mintMagicLinkSchema = z.object({
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * The STAFF user who asked for this link, when a human did.
   *
   * Recorded so a mint is attributable: this hands out a working sign-in
   * credential for another person, and without an actor nothing ties "who now
   * has portal access to this patient" back to who granted it. Absent for the
   * server-composed emails (reminders, consent requests), where no human made
   * the request.
   */
  actingUserId: z.string().min(1).optional(),
});

export type MintMagicLinkInput = z.infer<typeof mintMagicLinkSchema>;
