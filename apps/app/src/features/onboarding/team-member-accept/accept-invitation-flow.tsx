import type { CountryCode } from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSignUp } from '@/features/auth/use-sign-up';
import {
  useAcceptInvitation,
  useInvitationByToken,
} from '@/features/organization/api';
import { setActiveOrganizationIfNeeded } from '@/features/organization/api/set-active-organization';
import {
  clearPendingInviteToken,
  setPendingInviteToken,
} from '@/lib/pending-invite';
import { refetchSession, useSession } from '@/lib/session';
import { useResolvedRoutes } from '@/lib/use-routes';

import { TeamMemberWizard } from '../team-member-wizard';
import { JoinScreen } from './join-screen';
import { PasswordStep } from './password-step';
import { ReviewStep, type ReviewValues } from './review-step';

type Stage = 'join' | 'review' | 'password' | 'wizard';

interface AcceptInvitationFlowProps {
  token: string | undefined;
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

/**
 * Public, invite-aware accept flow (the invited-member counterpart to the
 * owner's "Add team member" editor). Bridges account creation + invite
 * acceptance without an existing session:
 *
 *   Join → Review-and-confirm (prefilled) → Password → accept → wizard.
 *
 * An already-authenticated visitor skips the password step and accepts directly.
 * On accept the org is set active and the member drops into the skippable
 * public-profile wizard.
 */
export function AcceptInvitationFlow({ token }: AcceptInvitationFlowProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { data: sessionData } = useSession();
  const isAuthenticated = !!sessionData?.user;

  const { invitation, isLoading, isError, error } = useInvitationByToken(token);
  const { signUpAsync } = useSignUp({ onSuccess: () => {} });
  const { acceptInvitationAsync } = useAcceptInvitation();

  const [stage, setStage] = useState<Stage>('join');
  const [review, setReview] = useState<ReviewValues | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Park the token so a mid-flow auth-route bounce (getPostAuthRedirect) routes
  // this org-less signup back here instead of into owner onboarding.
  useEffect(() => {
    if (token) setPendingInviteToken(token);
  }, [token]);

  if (!token) {
    return (
      <CenteredCard>
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertTitle>Invalid invitation</AlertTitle>
          <AlertDescription>
            This invitation link is invalid or missing its token.
          </AlertDescription>
        </Alert>
      </CenteredCard>
    );
  }

  if (isLoading) {
    return (
      <CenteredCard>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CenteredCard>
    );
  }

  const isExpired =
    !!invitation && new Date(invitation.expiresAt).getTime() < Date.now();
  const isNotPending = !!invitation && invitation.status !== 'pending';

  if (isError || !invitation || isExpired || isNotPending) {
    const message = isExpired
      ? 'This invitation has expired. Ask your team admin to send a new one.'
      : isNotPending
        ? 'This invitation is no longer available.'
        : (error?.message ??
          'We could not find this invitation. The link may be invalid or expired.');
    return (
      <CenteredCard>
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertTitle>Invitation unavailable</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          className="mt-4 w-full"
          onClick={() => navigate({ to: '/sign-in' })}
        >
          Go to sign in
        </Button>
      </CenteredCard>
    );
  }

  const enterWizard = async (organizationId: string) => {
    // Ensure the freshly-joined org is active so the wizard's practitioner
    // writes (org-scoped) resolve, then refresh the session snapshot.
    await setActiveOrganizationIfNeeded(true, organizationId);
    await refetchSession();
    clearPendingInviteToken();
    setStage('wizard');
  };

  const acceptForExistingSession = async (values: ReviewValues) => {
    setIsSubmitting(true);
    try {
      const res = await acceptInvitationAsync({
        invitationId: invitation.id,
        acceptedTerms: values.acceptedTerms,
      });
      await enterWizard(res.organizationId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to accept invitation'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReviewContinue = (values: ReviewValues) => {
    setReview(values);
    if (isAuthenticated) {
      void acceptForExistingSession(values);
    } else {
      setStage('password');
    }
  };

  const handlePasswordSubmit = async (password: string) => {
    if (!review) return;
    setIsSubmitting(true);
    try {
      const name = `${review.firstName} ${review.lastName}`.trim();
      await signUpAsync({ name, email: invitation.email, password });
      const res = await acceptInvitationAsync({
        invitationId: invitation.id,
        acceptedTerms: review.acceptedTerms,
      });
      await enterWizard(res.organizationId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create your account'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (stage === 'wizard') {
    return (
      <TeamMemberWizard onComplete={() => navigate({ to: routes.home })} />
    );
  }

  const reviewDefaults: Omit<ReviewValues, 'acceptedTerms'> = {
    firstName: review?.firstName ?? invitation.firstName ?? '',
    lastName: review?.lastName ?? invitation.lastName ?? '',
    phone: review?.phone ?? invitation.phone ?? '',
    country:
      review?.country ?? (invitation.country as CountryCode | null) ?? '',
  };

  return (
    <CenteredCard>
      {stage === 'join' && (
        <JoinScreen
          organizationName={invitation.organizationName}
          inviterName={invitation.inviterName}
          email={invitation.email}
          isAuthenticated={isAuthenticated}
          onContinue={() => setStage('review')}
        />
      )}

      {stage === 'review' && (
        <ReviewStep
          email={invitation.email}
          defaults={reviewDefaults}
          onBack={() => setStage('join')}
          onContinue={handleReviewContinue}
        />
      )}

      {stage === 'password' && (
        <PasswordStep
          isSubmitting={isSubmitting}
          onBack={() => setStage('review')}
          onSubmit={handlePasswordSubmit}
        />
      )}
    </CenteredCard>
  );
}
