import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { Logo } from '@/components/global/logo';
import { ImpersonationBanner } from '@/features/admin-terminal/components/impersonation-banner';
import { SignedInIndicator } from '@/features/auth/components/signed-in-indicator';
import { authRedirectSearchValue } from '@/lib/auth-redirect';
import { ensureSession } from '@/lib/session';

/**
 * Pathless layout for onboarding pages. Requires auth but renders without the
 * sidebar. Mirrors `apps/web/src/app/(onboarding)/layout.tsx` (session + email
 * verification + chrome).
 */
export const Route = createFileRoute('/_onboarding')({
  beforeLoad: async ({ location }) => {
    const session = await ensureSession();
    if (!session.user) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: authRedirectSearchValue(location) },
      });
    }
    // NO email-verification gate here, deliberately.
    //
    // Accounts on the sales-led path are created by an onboarding specialist
    // and onboarded on the customer's behalf, so the person completing this
    // wizard is routinely not the person who can open the mailbox — the gate
    // stopped the flow dead for exactly the people it was meant to serve.
    //
    // It was also frontend-only theatre: `requireEmailVerification` is off in
    // packages/auth/src/server.ts, so the API has never required a verified
    // address for any of this. Removing the redirect closes that gap rather
    // than opening one.
    //
    // The verification email is still sent on sign-up, and the account page
    // still offers to resend it, so a customer who wants a verified address
    // can have one at any point.
  },
  component: OnboardingLayout,
});

function OnboardingLayout() {
  return (
    <>
      <ImpersonationBanner />
      <div className="flex min-h-svh flex-col items-center px-6 md:px-10">
        <div className="flex w-full items-center justify-between gap-2 py-6">
          <Logo />
          <SignedInIndicator />
        </div>
        <div className="flex w-full max-w-4xl flex-1 items-center justify-center pb-16">
          <div className="w-full">
            <Outlet />
          </div>
        </div>
      </div>
    </>
  );
}
