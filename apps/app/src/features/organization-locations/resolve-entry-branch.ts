import type { QueryClient } from '@tanstack/react-query';

import { listLocationsQueryOptions } from './api/list-locations/list-locations.hook.js';
import type { OrganizationLocation } from './api/types.js';

/**
 * Which branch should a URL with no branch in it resolve to?
 *
 * Answers for two entry points that both need it and must agree: `/dashboard`
 * itself, and the compatibility splat that catches every legacy
 * `/dashboard/<something>` path (plan §4.1). Getting a different answer from
 * each would mean a bookmark and a bare `/dashboard` landing on different
 * branches in the same session.
 *
 * Order: the branch you were last in, then the org's primary, then simply the
 * first. Last-used wins because for the ~95% of orgs with ONE branch it is the
 * same answer as primary, and for the rest it is the only answer that does not
 * yank a multi-branch user back to head office on every cold start.
 *
 * A remembered id that no longer resolves (branch deleted, shared machine) is
 * skipped rather than honoured — this returns something valid or nothing.
 */
export async function resolveEntryBranch(
  queryClient: QueryClient,
  rememberedId: string | null
): Promise<OrganizationLocation | null> {
  const data = await queryClient.ensureQueryData(listLocationsQueryOptions());
  const locations = data.items;
  if (locations.length === 0) return null;

  const remembered = rememberedId
    ? locations.find((l) => l.id === rememberedId)
    : undefined;

  return remembered ?? locations.find((l) => l.isPrimary) ?? locations[0];
}
