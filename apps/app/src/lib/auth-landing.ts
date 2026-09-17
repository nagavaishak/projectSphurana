import { apiClient } from '@borradh-workspace/api-client';

import { getPendingInviteToken } from '@/lib/pending-invite';
import type { SessionResponse } from '@/lib/session';

/** Mirrors `apps/web/src/lib/auth-server.ts` subscription shape (subset). */
interface Subscription {
  status: string;
  trialEnd: string | null;
}

interface SubscriptionResponse {
  subscription: Subscription | null;
}

/**
 * Active subscription or non-expired trial — same rules as
 * `apps/web/src/lib/auth-server.ts` `isSubscriptionActive`.
 */
export function isSubscriptionActive(
  subscription: Subscription | null
): boolean {
  if (!subscription) return false;
  if (subscription.status === 'active') return true;
  if (subscription.status === 'trialing') {
    if (subscription.trialEnd) {
      return new Date(subscription.trialEnd) > new Date();
    }
    return true;
  }
  return false;
}

/**
 * Where to send a signed-in user hitting a public auth route.
 * Matches `apps/web/src/app/(auth)/layout.tsx` (and auth-only billing layout intent).
 *
 * - Unverified email → stay on auth pages (`null`).
 * - No organizations → `/onboarding`.
 * - Subscription fetch failure → `/dashboard/home` (fail open, same as Next).
 * - Inactive subscription → `/billing`.
 * - Otherwise → `/dashboard/home`.
 */
export async function getPostAuthRedirect(
  session: SessionResponse
): Promise<string | null> {
  const user = session.user;
  if (!user) return null;

  if (!user.emailVerified) {
    return null;
  }

  let organizations: { id: string }[] = [];
  try {
    const data = await apiClient.get<{ organizations: { id: string }[] }>(
      'organizations'
    );
    organizations = data.organizations ?? [];
  } catch {
    organizations = [];
  }

  if (organizations.length === 0) {
    // Invited team member mid-accept: they have an account but belong to no org
    // yet. Send them back to finish accepting their invite rather than into the
    // *owner* onboarding flow (which would create a brand-new business for them).
    if (getPendingInviteToken()) {
      return '/accept-invitation';
    }
    // New user with no org yet → the LEGACY multi-step wizard, which is the
    // live onboarding flow. The Claire Typeform deck at /welcome is built and
    // reachable but is not the default; flip this (plus the sign-up and
    // verify-email redirects) to '/welcome' to switch over.
    return '/onboarding';
  }

  // Org exists but the Claire onboarding may have been abandoned mid-flow
  // (e.g. closed the tab at the ad picker). GET /onboarding/session is a
  // non-creating peek: null for legacy users, a row only if they actually
  // started the flow. Resume while it's active.
  try {
    const onboarding = await apiClient.get<{ status: string } | null>(
      'onboarding/session'
    );
    if (onboarding?.status === 'active') {
      return '/welcome';
    }
  } catch {
    // Peek is best-effort — fall through to the normal landing
  }

  try {
    const subData = await apiClient.get<SubscriptionResponse>(
      'billing/subscription'
    );
    if (!isSubscriptionActive(subData.subscription ?? null)) {
      return '/billing';
    }
  } catch {
    return '/dashboard/home';
  }

  return '/dashboard/home';
}
