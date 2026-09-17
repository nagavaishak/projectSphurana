import { z } from 'zod';

/**
 * Schema for looking up an invitation by its opaque token.
 *
 * The token IS the invitation id (see invite-member.service.ts where the
 * accept-invitation link is built as `?token=${invitationId}`). This lookup is
 * public / token-scoped: it takes only the opaque id, no org context.
 */
export const getInvitationByTokenSchema = z.object({
  token: z.string().min(1, 'Invitation token is required'),
});

export type GetInvitationByTokenInput = z.infer<
  typeof getInvitationByTokenSchema
>;
