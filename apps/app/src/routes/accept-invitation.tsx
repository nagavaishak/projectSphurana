import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AcceptInvitationFlow } from '@/features/onboarding/team-member-accept';
import { getPendingInviteToken } from '@/lib/pending-invite';

const acceptInvitationSearchSchema = z.object({
  token: z.string().optional(),
});

/**
 * PUBLIC invite-aware accept route. Unlike the old `_authed/accept-invitation`
 * (which assumed a session), this sits at the top level so an invited person
 * with no account can create one and accept in a single flow. The token comes
 * from the invite link's `?token`; if absent (e.g. a mid-flow auth bounce that
 * `getPostAuthRedirect` sends here) it falls back to the parked pending token.
 */
export const Route = createFileRoute('/accept-invitation')({
  validateSearch: acceptInvitationSearchSchema,
  component: AcceptInvitationPage,
});

function AcceptInvitationPage() {
  const { token } = Route.useSearch();
  const resolvedToken = token ?? getPendingInviteToken() ?? undefined;
  return <AcceptInvitationFlow token={resolvedToken} />;
}
