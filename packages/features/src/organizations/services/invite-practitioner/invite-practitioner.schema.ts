import { invitePractitionerRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for sending (or re-sending) a team member's invitation.
 *
 * DERIVED from the canonical wire contract (`invitePractitionerRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it: `practitionerId` from the route, `organizationId` from the active-org
 * session, `inviterId` from the authenticated user.
 */
export const invitePractitionerSchema = invitePractitionerRequestBase.extend({
  practitionerId: z.string().min(1, 'Practitioner ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  inviterId: z.string().min(1, 'Inviter user ID is required'),
});

export type InvitePractitionerInput = z.infer<typeof invitePractitionerSchema>;
