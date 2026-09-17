import { ROUTES } from '@/lib/route-paths';
import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router';

import { getOnboardingSessionQueryOptions } from '@/features/onboarding/api';
import { queryClient } from '@/lib/query-client';
import { ensureSession } from '@/lib/session';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const session = await ensureSession();
    if (!session.user) {
      throw redirect({ to: '/sign-in' });
    }

    // A user who is still mid-funnel must not escape into the dashboard via the
    // Borradh logo (which links here). Bounce them back to the onboarding deck.
    // Only an ACTIVE session traps: `completed`/`abandoned` (and legacy users
    // with no session at all) fall through to the dashboard. Never let a failed
    // peek strand the user on a blank redirect — fall through on error.
    try {
      const onboarding = await queryClient.ensureQueryData(
        getOnboardingSessionQueryOptions()
      );
      if (onboarding?.status === 'active') {
        throw redirect({ to: '/welcome' });
      }
    } catch (error) {
      // Re-throw the /welcome redirect above; swallow only a failed peek.
      if (isRedirect(error)) throw error;
    }

    throw redirect({ to: ROUTES.dashboard });
  },
});
