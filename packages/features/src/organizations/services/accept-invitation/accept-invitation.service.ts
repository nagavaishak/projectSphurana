import {
  countryCodeValues,
  invitation,
  member,
  practitioner,
  user as userTable,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { linkPractitionerToUser } from '../../../practitioners/services/link-practitioner-to-user/link-practitioner-to-user.service.js';
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
  type AcceptInvitationInput,
  acceptInvitationSchema,
} from './accept-invitation.schema.js';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Accept invitation response type
 */
export interface AcceptInvitationResponse {
  memberId: string;
  organizationId: string;
  userId: string;
  role: string;
  practitionerId?: string;
}

/**
 * Internal implementation of accept invitation
 */
const acceptInvitationImpl = async (
  db: DbConnection,
  input: AcceptInvitationInput
): Promise<Result<AcceptInvitationResponse>> => {
  // Validate input
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { invitationId, userId, acceptedTerms } = parsed.data;

  // Find the invitation
  const inv = await db.query.invitation.findFirst({
    where: (i, { eq }) => eq(i.id, invitationId),
    with: {
      organization: true,
    },
  });

  if (!inv) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Invitation not found', {
        invitationId,
      })
    );
  }

  // Check if invitation is still pending
  if (inv.status !== 'pending') {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'This invitation has already been used or cancelled',
        {
          invitationId,
          status: inv.status,
        }
      )
    );
  }

  // Check if invitation has expired
  if (new Date() > inv.expiresAt) {
    return err(
      new FeatureError(ErrorCodes.CONFLICT, 'This invitation has expired', {
        invitationId,
        expiresAt: inv.expiresAt,
      })
    );
  }

  // Get the user accepting the invitation
  const user = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });

  if (!user) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'User not found', {
        userId,
      })
    );
  }

  // Check if user email matches invitation email
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'This invitation was sent to a different email address',
        {
          invitationEmail: inv.email,
          userEmail: user.email,
        }
      )
    );
  }

  // Check if user is already a member
  const existingMember = await db.query.member.findFirst({
    where: (m, { and, eq }) =>
      and(eq(m.organizationId, inv.organizationId), eq(m.userId, userId)),
  });

  if (existingMember) {
    // Mark invitation as accepted anyway
    await db
      .update(invitation)
      .set({ status: 'accepted' })
      .where(eq(invitation.id, invitationId));

    return err(
      new FeatureError(
        ErrorCodes.ALREADY_EXISTS,
        'You are already a member of this organization',
        {
          organizationId: inv.organizationId,
          userId,
        }
      )
    );
  }

  try {
    // Create the member record
    const memberId = generateId();
    const role = inv.role ?? 'member';

    const [newMember] = await db
      .insert(member)
      .values({
        id: memberId,
        organizationId: inv.organizationId,
        userId,
        role,
        termsAcceptedAt: acceptedTerms ? new Date() : null,
        createdAt: new Date(),
      })
      .returning();

    // Update invitation status to accepted
    await db
      .update(invitation)
      .set({ status: 'accepted' })
      .where(eq(invitation.id, invitationId));

    // Accepting an invitation proves the user controls the invited email
    // address (the invite link was delivered there), so mark it verified —
    // invited users don't go through a separate email-verification step.
    if (!user.emailVerified) {
      await db
        .update(userTable)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(userTable.id, userId));
    }

    // Auto-link practitioner to user (non-critical)
    let practitionerId: string | undefined;
    try {
      const linkResult = await linkPractitionerToUser(db, {
        userId,
        organizationId: inv.organizationId,
        email: user.email,
      });
      if (linkResult.success) {
        practitionerId = linkResult.data.id;

        // Best-effort: copy the invitation prefill onto the linked
        // practitioner. Only set fields the owner provided; coerce the plain
        // `invitation.country` text into the practitioner `country` enum and
        // skip it if it isn't a valid enum value.
        const prefill: Record<string, unknown> = {};
        if (inv.firstName) prefill.firstName = inv.firstName;
        if (inv.lastName) prefill.lastName = inv.lastName;
        if (inv.phone) prefill.phone = inv.phone;
        if (
          inv.country &&
          (countryCodeValues as readonly string[]).includes(inv.country)
        ) {
          prefill.country = inv.country;
        }

        if (Object.keys(prefill).length > 0) {
          try {
            await db
              .update(practitioner)
              .set(prefill)
              .where(eq(practitioner.id, practitionerId));
          } catch (prefillError) {
            logError(
              'organizations.acceptInvitation.copyPrefill',
              prefillError,
              {
                feature: 'organizations',
                extra: { userId, practitionerId },
              }
            );
          }
        }
      }
    } catch (linkError) {
      logError('organizations.acceptInvitation.linkPractitioner', linkError, {
        feature: 'organizations',
        extra: {
          userId,
          organizationId: inv.organizationId,
          email: user.email,
        },
      });
    }

    return ok({
      memberId: newMember.id,
      organizationId: newMember.organizationId,
      userId: newMember.userId,
      role: newMember.role,
      practitionerId,
    });
  } catch (error) {
    logError('organizations.acceptInvitation', error, {
      feature: 'organizations',
      extra: { invitationId, userId },
    });
    return internalError(
      'An error occurred while accepting the invitation. Please try again.',
      error
    );
  }
};

/**
 * Accept an invitation to join an organization
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Invitation acceptance data
 * @returns Result with member info or error
 *
 * @example
 * ```ts
 * const result = await acceptInvitation(db, {
 *   invitationId: 'inv-123',
 *   userId: 'user-456',
 * });
 *
 * if (result.success) {
 *   console.log('Joined organization:', result.data.organizationId);
 * }
 * ```
 */
export const acceptInvitation = (
  db: DbConnection,
  input: AcceptInvitationInput
) =>
  trackedResult(
    'organizations.acceptInvitation',
    () => acceptInvitationImpl(db, input),
    {
      properties: { invitationId: input.invitationId },
    }
  );

/**
 * Result type for acceptInvitation
 */
export type AcceptInvitationResult = Awaited<
  ReturnType<typeof acceptInvitation>
>;
