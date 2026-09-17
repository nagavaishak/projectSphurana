import { ROUTES } from '@/lib/route-paths';
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { ImpersonationBanner, TwoFactorGate } from '@/features/admin-terminal';
import { authRedirectSearchValue } from '@/lib/auth-redirect';
import { ensureSession } from '@/lib/session';

/**
 * `_admin` pathless layout — admin-only guard.
 *
 * `beforeLoad` resolves the session and:
 *  - redirects to `/sign-in` (with `?redirect=<intended>`) if not authed
 *  - redirects to `/dashboard` if authed but `user.role !== 'admin'`
 *
 * `TwoFactorGate` then enforces a 2FA setup-or-verify flow before any admin
 * UI renders. The NestJS `GlobalAdminGuard` is the authoritative check
 * (ADMIN_USER_IDS membership + valid `admin_2fa_verified` cookie); the gate
 * is the matching UX so admins see a verify prompt instead of an empty table
 * when the cookie isn't present.
 */
export const Route = createFileRoute('/_admin')({
  beforeLoad: async ({ location }) => {
    const session = await ensureSession();
    if (!session.user) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: authRedirectSearchValue(location) },
      });
    }
    if (session.user.role !== 'admin') {
      throw redirect({ to: ROUTES.dashboard });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <>
      <ImpersonationBanner />
      <TwoFactorGate>
        <Outlet />
      </TwoFactorGate>
    </>
  );
}
