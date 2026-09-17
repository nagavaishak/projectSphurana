import { acceptInvitationRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for accepting an organization invitation.
 *
 * DERIVED from the canonical wire contract (`acceptInvitationRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it: `invitationId` is the route param and `userId` is the
 * authenticated user. Neither is ever taken from the body — the client cannot
 * name which invitation, or which user, it is accepting for.
 */
export const acceptInvitationSchema = acceptInvitationRequestBase.extend({
  invitationId: z.string().min(1, 'Invitation ID is required'),
  userId: z.string().min(1, 'User ID is required'),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
