import { inviteMemberRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for inviting a member to an organization.
 *
 * DERIVED from the canonical wire contract (`inviteMemberRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it: `organizationId` from the active-org session and `inviterId`
 * from the authenticated user. The invitable `role` set (`member` | `admin`,
 * never `owner`) and the `.email()` rule live in the contract; do not restate
 * or loosen them here.
 */
export const inviteMemberSchema = inviteMemberRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  inviterId: z.string().min(1, 'Inviter user ID is required'),
});

/**
 * Input type inferred from schema
 */
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
