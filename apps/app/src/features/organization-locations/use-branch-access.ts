'use client';

import { useMemo } from 'react';

// DIRECT module imports, not the feature barrels. `@/features/practitioners`
// re-exports its route-bound components, so importing the barrel here drags the
// router tree into every spec that renders a page using this hook — four of
// them failed to even collect on `createRootRouteWithContext`. A hook that
// three pages and the sidebar depend on has to stay cheap to import.
import { useGetSession } from '@/features/auth/api/get-session/get-session.hook';
import { useActiveOrganization } from '@/features/organization/api/get-active-organization/get-active-organization.hook';
import { useGetOrganizationMembers } from '@/features/organization/api/get-organization-members/get-organization-members.hook';
import { useListPractitioners } from '@/features/practitioners/api/list-practitioners/list-practitioners.hook';

/**
 * Which branches the SIGNED-IN person is themselves attached to.
 *
 * The switcher lists every branch the business has — a practitioner should be
 * able to SEE that the Cork branch exists — but only the ones they work at are
 * theirs to open. The rest are shown disabled, with the one thing they can
 * actually do about it: ask their manager.
 *
 * WHO IS RESTRICTED. Only a member who is (a) not an admin or owner and (b)
 * linked to a practitioner record with an explicit branch set. Three misses,
 * each deliberate:
 *
 *   - admins/owners run the business across branches; restricting them would
 *     lock the person who fixes the assignment out of the fix.
 *   - a member with no practitioner record (a receptionist, a bookkeeper) has
 *     no "works at" to read, and inventing one from silence would strand them
 *     with no branches at all.
 *   - a practitioner with ZERO location rows works EVERYWHERE — the
 *     empty-junction convention the whole read path uses. Reading that as
 *     "nowhere" would empty the switcher for every org that has never assigned
 *     anyone, which today is all of them.
 *
 * This is a VISIBILITY rule, not an authorization one: it shapes the menu, and
 * the API still decides what any request may do.
 */
export function useBranchAccess(): {
  /** True when the menu should grey out branches outside `allowedLocationIds`. */
  isRestricted: boolean;
  allowedLocationIds: string[];
  /**
   * Admin or owner of the ACTIVE org — the gate on branch administration
   * (editing a branch, managing the list).
   *
   * FALSE WHILE LOADING, deliberately: a control that appears a beat after the
   * menu opens is worse than one that appears on the second open.
   */
  isAdmin: boolean;
  /**
   * Whether the role could be READ at all — false while loading and, more
   * importantly, when the members request failed.
   *
   * Callers must hide administration on `roleKnown && !isAdmin`, never on
   * `!isAdmin` alone. An unreadable role is not evidence of a practitioner:
   * a 403 during an org switch, or any blip on that request, would otherwise
   * strand a real admin with the controls removed and nothing explaining why —
   * including, on an org with no branches yet, the only route to adding one.
   * Showing a control the API then refuses is a recoverable annoyance; hiding
   * the only way out is not.
   */
  roleKnown: boolean;
  isLoading: boolean;
} {
  const { user, isLoading: sessionLoading } = useGetSession();
  const { data: activeOrg } = useActiveOrganization();
  const {
    members,
    isLoading: membersLoading,
    isError: membersError,
  } = useGetOrganizationMembers(activeOrg?.id ?? '');
  const { practitioners, isLoading: practitionersLoading } =
    useListPractitioners();

  return useMemo(() => {
    const isLoading = sessionLoading || membersLoading || practitionersLoading;
    const open = {
      isRestricted: false,
      allowedLocationIds: [],
      isAdmin: false,
      roleKnown: false,
      isLoading,
    };

    if (isLoading || !user) return open;

    const myRole = members.find((m) => m.userId === user.id)?.role;
    // A failed members request leaves the role UNREADABLE, which is not the
    // same as "not an admin" — see `roleKnown`.
    const roleKnown = !membersError && myRole !== undefined;
    const isAdmin = myRole === 'admin' || myRole === 'owner';
    if (isAdmin) return { ...open, isAdmin: true, roleKnown };

    const me = practitioners.find((p) => p.userId === user.id);
    if (!me) return { ...open, roleKnown };

    const mine = (me.locations ?? []).map((l) => l.locationId);
    if (mine.length === 0) return { ...open, roleKnown };

    return {
      isRestricted: true,
      allowedLocationIds: mine,
      isAdmin: false,
      roleKnown,
      isLoading,
    };
  }, [
    user,
    members,
    membersError,
    practitioners,
    sessionLoading,
    membersLoading,
    practitionersLoading,
  ]);
}
