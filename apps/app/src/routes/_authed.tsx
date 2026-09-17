import { AssistantProductLayout } from '@/components/dashboard/assistant-product-layout';
import {
  type ErrorComponentProps,
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect } from 'react';

import { IdleTimeoutGuard } from '@/components/app/idle-timeout-guard';
import { FunnelTransition, routeZone } from '@/components/app/route-transition';
import { StateError } from '@/components/app/state-error';
import { identifyUser } from '@/components/posthog-provider';
import { ImpersonationBanner } from '@/features/admin-terminal/components/impersonation-banner';
import { BackgroundAnalysisProvider } from '@/features/assets/background-analysis';
import { ClaireWidgetRoot } from '@/features/claire/components/claire-widget-root';
import { ClaireWalkthroughProvider } from '@/features/claire/lib/walkthrough-provider';
import { MetaSyncProvider } from '@/features/meta-sync';
import { ActiveLocationScope } from '@/features/organization-locations';
import { setActiveOrganizationIfNeeded } from '@/features/organization/api/set-active-organization';
import { authRedirectSearchValue } from '@/lib/auth-redirect';
import { setCapgoCustomId } from '@/lib/capgo';
import { intercomLogin } from '@/lib/intercom';
import { ensureSession, refetchSession, useSession } from '@/lib/session';

/**
 * `_authed` route context is empty for now. `beforeLoad` guards every child by
 * resolving the session and redirecting to `/sign-in` (with the intended URL
 * preserved via `?redirect=`) when there is no signed-in user. Child routes
 * (2B–2F) can read the session via `useSession()` directly.
 */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const session = await ensureSession();

    // The API could not be reached (it already retried). This is NOT a sign-out
    // — `auth/session` returns 200 `{ user: null }` for that — so bouncing to
    // /sign-in here would throw away a valid session on a transient blip. Fail
    // into `AuthedRouteError`, which offers a retry and keeps the session.
    if (session.unavailable) {
      throw new Error('Could not load your session');
    }

    if (!session.user) {
      // Auth-free record hand-off: a valid upload token (magic link scanned on
      // a phone that isn't logged in) grants scoped access to the record
      // screen, which validates the token itself. Let it through instead of
      // bouncing to /sign-in.
      const search = location.search as { uploadToken?: unknown };
      const hasUploadToken =
        typeof search?.uploadToken === 'string' &&
        search.uploadToken.length > 0;
      if (location.pathname.startsWith('/record/') && hasUploadToken) {
        return;
      }

      throw redirect({
        to: '/sign-in',
        search: { redirect: authRedirectSearchValue(location) },
      });
    }

    // Recover from a missing active organization. Onboarding sets the active
    // org, but that call is best-effort and can fail silently (flaky network),
    // and a user who abandons onboarding then relaunches lands here with none.
    // Without an active org every org-scoped endpoint returns 400, which the UI
    // surfaces as "Failed to load/create conversation". accept-invitation runs
    // before the user belongs to any org, so it is exempt.
    if (
      !session.session?.activeOrganizationId &&
      !location.pathname.startsWith('/accept-invitation')
    ) {
      await setActiveOrganizationIfNeeded();
      const refreshed = await refetchSession();
      if (!refreshed.session?.activeOrganizationId) {
        throw redirect({ to: '/onboarding' });
      }
    }
  },
  errorComponent: AuthedRouteError,
  component: AuthedLayout,
});

function AuthedRouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <StateError
        className="w-full max-w-lg"
        message="We could not load your session. Please try again."
        onRetry={retry}
      />
    </div>
  );
}

function AuthedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data } = useSession();
  const user = data?.user;
  const intercomJwt = data?.session?.intercomJwt;

  // Identify the user in Intercom once the authenticated session lands. Re-runs
  // when the JWT changes (e.g., session refresh). On cold start the bearer is
  // rehydrated from secure storage in `main.tsx`, so this effect fires before
  // the user can open the support widget.
  useEffect(() => {
    if (user) {
      // Tie PostHog events to the real user. The `organization` group is set
      // separately by the dashboard layouts once the active org resolves.
      identifyUser(user.id, { email: user.email, name: user.name });
      void intercomLogin(user.id, user.email, user.name, intercomJwt);
    }
  }, [user, intercomJwt]);

  // Tag the device in Capgo with the user's email so internal testers can
  // find it in the Capgo dashboard's device list (native only; no-op on web).
  useEffect(() => {
    if (user?.email) void setCapgoCustomId(user.email);
  }, [user?.email]);

  // Match Next `(protected)/*`: only `/dashboard/*` gets the app sidebar
  // (added by `DashboardLayoutShell` inside the dashboard route). `/assistant`
  // has its own product layout. Everything else — `/connect`, `/create-video`,
  // `/sequences`, `/record`, `/ads`, `/settings`,
  // `/accept-invitation` — renders bare; each route owns its chrome.
  const chrome = pathname.startsWith('/assistant') ? (
    <AssistantProductLayout />
  ) : (
    <Outlet />
  );

  // The floating Claire widget is currently disabled everywhere. Previously it
  // was hidden only on surfaces that already host the assistant experience —
  // the assistant routes (where Claire IS the page), the home screen, and
  // billing — but it is now suppressed on all paths.
  const hideClaireWidget = true;

  return (
    <MetaSyncProvider>
      {/* Publishes the active branch to the api-client before any child query
          fires. Everything below this point is branch-scoped. */}
      <ActiveLocationScope>
        <BackgroundAnalysisProvider>
          <ImpersonationBanner />
          <IdleTimeoutGuard />
          <ClaireWalkthroughProvider handlers={{}}>
            {!hideClaireWidget && <ClaireWidgetRoot />}
            {/* Entering and leaving a create/edit editor swaps the whole screen,
              so it cross-fades. Moving between dashboard pages does not change
              zone, so the shell is never torn down for it. */}
            <FunnelTransition zone={routeZone(pathname)}>
              {chrome}
            </FunnelTransition>
          </ClaireWalkthroughProvider>
        </BackgroundAnalysisProvider>
      </ActiveLocationScope>
    </MetaSyncProvider>
  );
}
