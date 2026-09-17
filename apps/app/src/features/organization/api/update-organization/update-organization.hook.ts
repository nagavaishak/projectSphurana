import { apiClient } from '@borradh-workspace/api-client';
// Import from /schemas to avoid pulling in server-side dependencies
import type { OrganizationSettingsResponse } from '@borradh-workspace/features/organizations/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { UpdateOrganizationIntent } from './update-organization.input';
import { buildUpdateOrganizationPayload } from './update-organization.payload';

/**
 * Update Organization Hook
 * Updates the current organization settings via NestJS API.
 *
 * Every settings surface passes its typed {@link UpdateOrganizationIntent};
 * the single {@link buildUpdateOrganizationPayload} builder assembles the
 * strict PATCH body so no two surfaces can drift.
 */
export const useUpdateOrganization = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (intent: UpdateOrganizationIntent) => {
      // organizationId is resolved from the session on the server.
      return await apiClient.patch<OrganizationSettingsResponse>(
        'organization/active',
        buildUpdateOrganizationPayload(intent)
      );
    },
    onSuccess: () => {
      // Invalidate organization queries to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Organization settings updated');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update organization settings');
    },
  });

  return {
    execute: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
  };
};
