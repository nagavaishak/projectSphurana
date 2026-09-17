import { invitation } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, gt } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListPendingInvitationsInput,
  listPendingInvitationsSchema,
} from './list-pending-invitations.schema.js';

/**
 * Pending invitation response type
 */
export interface PendingInvitationResponse {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  inviterName: string | null;
}

/**
 * Internal implementation of list pending invitations
 */
const listPendingInvitationsImpl = async (
  db: DbConnection,
  input: ListPendingInvitationsInput
): Promise<Result<PendingInvitationResponse[]>> => {
  // Validate input
  const parsed = listPendingInvitationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { email } = parsed.data;

  // Find all pending invitations for this email that haven't expired
  const invitations = await db.query.invitation.findMany({
    where: and(
      eq(invitation.email, email.toLowerCase()),
      eq(invitation.status, 'pending'),
      gt(invitation.expiresAt, new Date())
    ),
    with: {
      organization: true,
      inviter: true,
    },
  });

  const response: PendingInvitationResponse[] = invitations.map((inv) => ({
    id: inv.id,
    organizationId: inv.organizationId,
    organizationName: inv.organization?.name ?? 'Unknown',
    email: inv.email,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt,
    inviterName: inv.inviter?.name ?? null,
  }));

  return ok(response);
};

/**
 * List pending invitations for a user by email
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Email to look up invitations for
 * @returns Result with list of pending invitations or error
 *
 * @example
 * ```ts
 * const result = await listPendingInvitations(db, {
 *   email: 'user@example.com',
 * });
 *
 * if (result.success) {
 *   console.log('Pending invitations:', result.data.length);
 * }
 * ```
 */
export const listPendingInvitations = (
  db: DbConnection,
  input: ListPendingInvitationsInput
) =>
  trackedResult(
    'organizations.listPendingInvitations',
    () => listPendingInvitationsImpl(db, input),
    {
      properties: { email: input.email },
    }
  );

/**
 * Result type for listPendingInvitations
 */
export type ListPendingInvitationsResult = Awaited<
  ReturnType<typeof listPendingInvitations>
>;
