import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Logo } from '@/components/global/logo';
import { Button } from '@/components/ui/button';
import { useResetOnboarding } from '@/features/onboarding/api';

/**
 * Layout for the Typeform-style /welcome/* onboarding slides.
 *
 * Currently unreachable — see the redirect below. When the deck is switched
 * back on it gates on session presence ONLY (no email-verification
 * requirement), because the first slide (website capture) intentionally runs
 * pre-verification and later slides self-gate on `emailVerified`.
 */
export const Route = createFileRoute('/welcome')({
  /**
   * The Claire Typeform deck is built but is NOT the live onboarding — the
   * legacy wizard at /onboarding is (see `getPostAuthRedirect`). It stayed
   * reachable by URL, so a user could drop into a second, parallel flow that
   * creates its own organization.
   *
   * Closed off here rather than by deleting the deck: to switch the product
   * over to it, drop this redirect and point `getPostAuthRedirect` (plus the
   * sign-up and verify-email redirects) at '/welcome'. The previous session
   * and completed-status gating is in git history.
   */
  beforeLoad: () => {
    throw redirect({ to: '/onboarding' });
  },
  component: WelcomeLayout,
});

function WelcomeLayout() {
  const navigate = useNavigate();
  const { resetOnboarding, isResetting } = useResetOnboarding({
    onSuccess: () => navigate({ to: '/welcome' }),
  });

  // Full reset: deletes the org the flow created and rewinds to slide 1 so the
  // user lands exactly where a brand-new sign-up does.
  const handleRestart = () => {
    if (isResetting) return;
    resetOnboarding();
  };

  return (
    <div className="bg-background relative min-h-svh">
      <div className="absolute top-6 left-6 z-20">
        <Logo />
      </div>
      <div className="absolute top-6 right-6 z-20">
        <ConfirmDeleteDialog
          confirmLabel="Start over"
          description="This deletes the business this flow created and everything in it, and takes you back to the first step."
          icon={RotateCcw}
          isPending={isResetting}
          onConfirm={handleRestart}
          title="Start over from scratch?"
          trigger={
            <Button
              className="text-muted-foreground hover:text-foreground gap-2"
              disabled={isResetting}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw className="size-4" />
              {isResetting ? 'Restarting…' : 'Start over'}
            </Button>
          }
        />
      </div>
      <Outlet />
    </div>
  );
}
