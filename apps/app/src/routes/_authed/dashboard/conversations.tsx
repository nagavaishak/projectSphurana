import { createFileRoute, redirect } from '@tanstack/react-router';

import {
  branchHandle,
  branchPath,
} from '@/features/organization-locations/branch-path';
import { resolveEntryBranch } from '@/features/organization-locations/resolve-entry-branch';
import { readRememberedLocationId } from '@/features/organization-locations/use-active-location';
import { z } from 'zod';

/**
 * Conversations moved to the clients inbox. Kept as a redirect for old links;
 * the selected-conversation search param is forwarded.
 */
const legacyConversationsSearchSchema = z.object({
  id: z.string().optional(),
});

export const Route = createFileRoute('/_authed/dashboard/conversations')({
  validateSearch: legacyConversationsSearchSchema,
  beforeLoad: async ({ search, context }) => {
    // Hand-rolled rather than `redirectToBranch` because the selected
    // conversation rides along in `search`, and dropping it would land the user
    // on the inbox with nothing open — the exact thing the shim exists to
    // prevent.
    const branch = await resolveEntryBranch(
      context.queryClient,
      readRememberedLocationId()
    );
    if (!branch) return;
    throw redirect({
      to: branchPath(branchHandle(branch), '/clients/inbox'),
      search,
    });
  },
});
