import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type { Organization } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Input type for set active organization
 */
export interface SetActiveOrganizationInput {
  organizationId: string;
}

/**
 * Set Active Organization Hook
 * Sets the current user's active organization via NestJS API
 */
export const useSetActiveOrganization = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (data: SetActiveOrganizationInput) => {
      return await apiClient.post<Organization>('organization/active', data);
    },
    onSuccess: () => {
      // The session carries `activeOrganizationId`, so it MUST be refetched
      // here — until it is, every consumer keeps reading the previous tenant's
      // org id as fresh (30s staleTime). This used to invalidate `['session']`,
      // a key no query has, so it silently did nothing.
      invalidateKeys(
        queryClient,
        queryKeys.organization.all(),
        queryKeys.auth.session()
      );
    },
  });

  return {
    execute: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    reset: mutation.reset,
  };
};

/**
 * Helper function to set active organization if needed (non-hook usage)
 * Sets the first organization as active if user has no active organization
 * or if the current active org is stale (deleted but still in session)
 *
 * @param forceSet - If true, always set the first org as active (for stale cache recovery)
 * @param organizationId - If provided, set this specific organization as active
 */
export async function setActiveOrganizationIfNeeded(
  forceSet = false,
  organizationId?: string
): Promise<void> {
  try {
    // Get user's organizations first
    const data = await apiClient.get<{ organizations: Organization[] }>(
      'organizations'
    );
    const organizations = data.organizations;

    // No organizations to set
    if (organizations.length === 0) {
      return;
    }

    // Determine which org to set as active
    const targetOrgId = organizationId || organizations[0].id;

    // If not forcing, check if user already has a valid active organization
    if (!forceSet && !organizationId) {
      try {
        const activeOrg = await apiClient.get<Organization | null>(
          'organization/active'
        );

        // Check if active org exists in user's actual organizations
        const activeOrgExists =
          activeOrg && organizations.some((org) => org.id === activeOrg.id);

        if (activeOrgExists) {
          // Already has a valid active organization
          return;
        }
      } catch {
        // No active org or unauthorized - that's fine, we'll set one
      }
    }

    // Set the target organization as active
    await apiClient.post<Organization>('organization/active', {
      organizationId: targetOrgId,
    });
  } catch (error) {
    // Don't throw - this is a best-effort function
    console.warn('Failed to set active organization:', error);
  }
}
