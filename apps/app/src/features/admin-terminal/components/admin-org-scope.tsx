import { setAdminOrgOverride } from '@borradh-workspace/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo } from 'react';

import { makeQueryClient } from '@/lib/query-client';

/**
 * Scopes its subtree to view a single organization's data as a platform admin,
 * without swapping the admin's session.
 *
 * - Sets the api-client org-override so every request inside carries
 *   `X-Admin-Organization-Id` (honored by the backend only for verified
 *   admins). Cleared on unmount so the rest of the app is unaffected.
 * - Provides a fresh, isolated `QueryClient` keyed by `organizationId`. The
 *   inbox/campaign hooks use shared query keys (e.g. `['conversations','list']`)
 *   that don't include the org, so switching orgs would otherwise serve another
 *   org's cached data. A new client per org guarantees no cross-org bleed and
 *   leaves the main app's cache untouched.
 *
 * The override is set during render (before child queries fire) AND cleared via
 * an unmount effect — both are needed: render-time set ensures the very first
 * child request is scoped; the effect cleanup restores normal behavior on exit.
 */
export function AdminOrgScope({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  // New client whenever the selected org changes — isolates the cache per org.
  // biome-ignore lint/correctness/useExhaustiveDependencies: organizationId is intentional — a fresh client per org is what isolates the cache.
  const client = useMemo(() => makeQueryClient(), [organizationId]);

  // Set synchronously so child queries rendered this pass are already scoped.
  setAdminOrgOverride(organizationId);

  useEffect(() => {
    setAdminOrgOverride(organizationId);
    return () => setAdminOrgOverride(null);
  }, [organizationId]);

  return (
    <QueryClientProvider client={client} key={organizationId}>
      {children}
    </QueryClientProvider>
  );
}
