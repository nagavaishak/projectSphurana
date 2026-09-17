import { InvitationEmail, sendEmail } from '@borradh-workspace/email';
import { authEnv } from '@borradh-workspace/env/auth';
import { logError } from '@borradh-workspace/observability';

/**
 * The one place the invitation email is composed and sent.
 *
 * Two callers need it and must not drift: `inviteMember` (first send, when the
 * invitation row is created) and `invitePractitioner` (re-send, for a team
 * member who already has a pending invitation — or who was created during
 * onboarding and never got one at all). Both must produce the same link, the
 * same subject and the same expiry wording, so both come through here.
 *
 * Returns whether the send succeeded instead of throwing. Delivery failure is
 * not the same event for both callers: `inviteMember` keeps the invitation (a
 * flaky mailer must not roll back a valid invite), whereas a user who just
 * pressed "Send invitation" is owed the truth. Handing back a boolean lets each
 * caller decide, and keeps the failure logged exactly once, here.
 */
export async function sendInvitationEmail(input: {
  invitationId: string;
  email: string;
  organizationId: string;
  organizationName: string;
  inviterName: string;
  role: string | null;
  firstName: string | null;
  expiresAt: Date;
}): Promise<boolean> {
  // /accept-invitation lives in the dashboard SPA (APP_URL, app.borradh.io),
  // NOT the marketing site (WEB_URL, www.borradh.io) — building the link from
  // WEB_URL lands every invitee on the marketing 404. Same fallback order as
  // the verification and password-reset links in packages/auth/src/server.ts.
  const appUrl = authEnv.APP_URL ?? authEnv.WEB_URL;
  const invitationUrl = `${appUrl}/accept-invitation?token=${input.invitationId}`;

  try {
    await sendEmail({
      to: input.email,
      subject: `You've been invited to join ${input.organizationName}`,
      template: InvitationEmail,
      props: {
        inviterName: input.inviterName,
        organizationName: input.organizationName,
        invitationUrl,
        role: input.role ?? 'member',
        firstName: input.firstName ?? undefined,
        // Explicitly UTC, and deliberately NOT the org's zone.
        //
        // This is a courtesy line in an email to someone who is not yet a
        // member: the org's zone is not theirs, and nothing they do depends on
        // which side of midnight this lands. Expiry is enforced by comparing
        // `invitation.expiresAt` server-side, so the printed date can never
        // disagree with the actual behaviour — at worst it is a day out on a
        // seven-day window, for a reader in a zone we do not know.
        //
        // Naming the zone is still worth doing. It costs nothing, states that
        // the omission was a decision rather than an oversight, and stops this
        // line reading as one more unzoned `toLocaleDateString` to be swept up
        // by the next pass. Threading a real zone in would mean a lookup (or a
        // new argument) at both call sites — `inviteMember` and
        // `invitePractitioner` — to buy a string nobody acts on.
        expiresAt: input.expiresAt.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC',
        }),
      },
    });
    return true;
  } catch (error) {
    logError('organizations.inviteMember.sendEmail', error, {
      feature: 'organizations',
      extra: {
        email: input.email,
        organizationId: input.organizationId,
        invitationId: input.invitationId,
      },
    });
    return false;
  }
}
