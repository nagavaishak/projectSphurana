import {
  invitation,
  organization,
  practitioner,
  withOrgScope,
} from '@borradh-workspace/database';
import { permissionLevelToRole } from '@borradh-workspace/labels';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { inviteMember } from '../invite-member/invite-member.service.js';
import { sendInvitationEmail } from '../invite-member/send-invitation-email.js';
import {
  type InvitePractitionerInput,
  invitePractitionerSchema,
} from './invite-practitioner.schema.js';

/** How long a freshly sent or re-sent invitation stays valid. */
const INVITATION_TTL_DAYS = 7;

export interface InvitePractitionerData {
  invitationId: string;
  email: string;
  /** True when an existing pending invitation was re-sent rather than created. */
  resent: boolean;
}

/**
 * Send — or re-send — a team member's invitation.
 *
 * Two situations produce a practitioner with no usable invitation, and the
 * Members list renders both identically as "Invited" (the badge is derived from
 * `practitioner.userId == null`, not from any invitation row):
 *
 *  1. The member was created by the onboarding wizard, which writes the
 *     practitioner row via `createPractitioner` and never invites anyone. These
 *     people have NEVER been emailed, despite the badge.
 *  2. The member was invited properly, but the email was lost, expired, or
 *     never opened.
 *
 * Both are the same request from the owner's side — "send this person their
 * invite" — so this is one operation. An existing pending invitation is re-used
 * rather than replaced, so any link already in the invitee's inbox keeps
 * working; only its expiry is pushed out.
 */
const invitePractitionerImpl = async (
  db: DbConnection,
  input: InvitePractitionerInput
): Promise<Result<InvitePractitionerData>> => {
  const parsed = invitePractitionerSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { practitionerId, organizationId, inviterId, permissionLevel } =
    parsed.data;

  // The practitioner row is the ONLY source of the invitee's address — the
  // request body carries no email, so this cannot be aimed elsewhere.
  const prac = await db.query.practitioner.findFirst({
    where: and(
      eq(practitioner.id, practitionerId),
      eq(practitioner.organizationId, organizationId),
      notDeleted(practitioner)
    ),
  });

  if (!prac) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Team member not found'));
  }

  if (prac.userId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'This team member has already accepted their invitation'
      )
    );
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

  const existing = await db.query.invitation.findFirst({
    where: and(
      eq(invitation.organizationId, organizationId),
      eq(invitation.email, prac.email),
      eq(invitation.status, 'pending')
    ),
  });

  // No pending invitation: create one. `inviteMember` owns the guards that
  // matter here (inviter is a member and an owner/admin, the address isn't
  // already a member) and sends the email as part of creating the row.
  if (!existing) {
    const created = await inviteMember(db, {
      organizationId,
      inviterId,
      email: prac.email,
      role: permissionLevelToRole[permissionLevel ?? 'low'],
      firstName: prac.firstName ?? undefined,
      lastName: prac.lastName ?? undefined,
      phone: prac.phone ?? undefined,
      phoneCountry: prac.phoneCountry ?? undefined,
      country: prac.country ?? undefined,
    });

    if (!created.success) {
      return err(
        new FeatureError(
          created.error.code,
          created.error.message,
          created.error.details
        )
      );
    }

    // Unlike `createTeamMember` — where a flaky mailer must not undo a whole
    // add — this call IS the send. Reporting success for an email that never
    // left is exactly the failure this feature exists to end.
    if (!created.data.emailSent) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'The invitation was saved but the email could not be sent. Please try again.'
        )
      );
    }

    return ok({
      invitationId: created.data.id,
      email: prac.email,
      resent: false,
    });
  }

  // A pending invitation already exists. Keep its id so any link already sitting
  // in the invitee's inbox still resolves, and only push the expiry out. The
  // role is left alone unless the caller explicitly asked for a new one.
  const role = permissionLevel
    ? permissionLevelToRole[permissionLevel]
    : existing.role;

  const [refreshed] = await db
    .update(invitation)
    .set({ expiresAt, role })
    .where(eq(invitation.id, existing.id))
    .returning();

  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { name: true },
  });
  const inviter = await db.query.user.findFirst({
    where: (u, { eq: equals }) => equals(u.id, inviterId),
    columns: { name: true },
  });

  const emailSent = await sendInvitationEmail({
    invitationId: refreshed.id,
    email: refreshed.email,
    organizationId,
    organizationName: org?.name ?? 'The Team',
    inviterName: inviter?.name ?? 'A team member',
    role: refreshed.role,
    firstName: refreshed.firstName,
    expiresAt: refreshed.expiresAt,
  });

  if (!emailSent) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'The invitation could not be sent. Please try again.'
      )
    );
  }

  return ok({
    invitationId: refreshed.id,
    email: refreshed.email,
    resent: true,
  });
};

export const invitePractitioner = (
  db: DbConnection,
  input: InvitePractitionerInput
) =>
  trackedResult(
    'practitioners.invitePractitioner',
    () => withOrgScope((tx) => invitePractitionerImpl(tx, input), { db }),
    {
      properties: {
        practitionerId: input.practitionerId,
        organizationId: input.organizationId,
      },
    }
  );

export type InvitePractitionerResult = Awaited<
  ReturnType<typeof invitePractitioner>
>;
