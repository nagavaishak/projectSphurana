import { invitation, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  internalError,
  ok,
} from '../../../shared/index.js';
import {
  type InviteMemberInput,
  inviteMemberSchema,
} from './invite-member.schema.js';
import { sendInvitationEmail } from './send-invitation-email.js';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Invitation response type
 */
export interface InviteMemberResponse {
  /**
   * Whether the invitation email was actually accepted by the mail provider.
   * The invitation row is created either way — callers that surface a
   * user-triggered send (e.g. `invitePractitioner`) read this so a silent
   * delivery failure isn't reported to the user as a success.
   */
  emailSent: boolean;
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  inviterId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneCountry: string | null;
  country: string | null;
}

/**
 * Internal implementation of invite member
 */
const inviteMemberImpl = async (
  db: DbConnection,
  input: InviteMemberInput
): Promise<Result<InviteMemberResponse>> => {
  // Validate input
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    email,
    role,
    inviterId,
    firstName,
    lastName,
    phone,
    phoneCountry,
    country,
  } = parsed.data;

  // Check if organization exists
  const org = await db.query.organization.findFirst({
    where: (o, { and, eq, isNull }) =>
      and(eq(o.id, organizationId), isNull(o.deletedAt)),
  });

  if (!org) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Organization with ID ${organizationId} not found`,
        {
          organizationId,
        }
      )
    );
  }

  // Check if inviter is a member of the organization and get their details
  const inviterMember = await db.query.member.findFirst({
    where: (m, { and, eq }) =>
      and(eq(m.organizationId, organizationId), eq(m.userId, inviterId)),
    with: {
      user: true,
    },
  });

  if (!inviterMember) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'You are not a member of this organization',
        {
          organizationId,
          userId: inviterId,
        }
      )
    );
  }

  // Only owners and admins can invite
  if (inviterMember.role !== 'owner' && inviterMember.role !== 'admin') {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'Only owners and admins can invite members',
        {
          organizationId,
          role: inviterMember.role,
        }
      )
    );
  }

  // Check if user is already a member
  const existingUser = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, email),
  });

  if (existingUser) {
    const existingMember = await db.query.member.findFirst({
      where: (m, { and, eq }) =>
        and(
          eq(m.organizationId, organizationId),
          eq(m.userId, existingUser.id)
        ),
    });

    if (existingMember) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'User is already a member of this organization',
          {
            email,
            organizationId,
          }
        )
      );
    }
  }

  // Check if there's already a pending invitation
  const existingInvitation = await db.query.invitation.findFirst({
    where: (i, { and, eq }) =>
      and(
        eq(i.organizationId, organizationId),
        eq(i.email, email),
        eq(i.status, 'pending')
      ),
  });

  if (existingInvitation) {
    return err(
      new FeatureError(
        ErrorCodes.ALREADY_EXISTS,
        'An invitation is already pending for this email',
        {
          email,
          organizationId,
        }
      )
    );
  }

  // Create invitation (expires in 7 days)
  const invitationId = generateId();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  try {
    const [newInvitation] = await db
      .insert(invitation)
      .values({
        id: invitationId,
        organizationId,
        email,
        role,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        phone: phone ?? null,
        phoneCountry: phoneCountry ?? null,
        country: country ?? null,
        status: 'pending',
        expiresAt,
        inviterId,
      })
      .returning();

    // A delivery failure is logged inside the helper and reported back on
    // `emailSent`, but never fails the invitation: a flaky mailer must not
    // undo a row the caller can still act on (`invitePractitioner` re-sends
    // against exactly this row).
    const emailSent = await sendInvitationEmail({
      invitationId,
      email,
      organizationId,
      organizationName: org.name,
      inviterName: inviterMember.user?.name ?? 'A team member',
      role,
      firstName: newInvitation.firstName,
      expiresAt: newInvitation.expiresAt,
    });

    return ok({
      emailSent,
      id: newInvitation.id,
      organizationId: newInvitation.organizationId,
      email: newInvitation.email,
      role: newInvitation.role,
      status: newInvitation.status,
      expiresAt: newInvitation.expiresAt,
      inviterId: newInvitation.inviterId,
      firstName: newInvitation.firstName ?? null,
      lastName: newInvitation.lastName ?? null,
      phone: newInvitation.phone ?? null,
      phoneCountry: newInvitation.phoneCountry ?? null,
      country: newInvitation.country ?? null,
    });
  } catch (error) {
    return internalError(
      'An error occurred while creating the invitation. Please try again.',
      error
    );
  }
};

/**
 * Invite a member to an organization
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Invitation data
 * @returns Result with created invitation or error
 *
 * @example
 * ```ts
 * const result = await inviteMember(db, {
 *   organizationId: 'org-123',
 *   email: 'newmember@example.com',
 *   role: 'member',
 *   inviterId: 'user-456',
 * });
 *
 * if (result.success) {
 *   console.log('Invitation sent:', result.data);
 * }
 * ```
 */
export const inviteMember = (db: DbConnection, input: InviteMemberInput) =>
  trackedResult(
    'organizations.inviteMember',
    () => withOrgScope((tx) => inviteMemberImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId, email: input.email },
    }
  );

/**
 * Result type for inviteMember
 */
export type InviteMemberResult = Awaited<ReturnType<typeof inviteMember>>;
