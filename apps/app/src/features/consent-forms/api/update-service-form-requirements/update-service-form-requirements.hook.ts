import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/** Backend built in parallel — if the path moves, adjust it here only. */
const endpoint = (serviceId: string) =>
  `consent-form-templates/organization-services-form-requirements/${serviceId}`;

export const useUpdateServiceFormRequirements = (options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      serviceId,
      templateIds,
    }: {
      serviceId: string;
      templateIds: string[];
    }) => apiClient.put(endpoint(serviceId), { templateIds }),
    onSuccess: (_data, { serviceId }) => {
      // Only this service's requirements — the template list itself is
      // unchanged, so the breadth stays exactly as narrow as it was.
      invalidateKeys(
        queryClient,
        queryKeys.consentFormTemplates.serviceRequirements(serviceId)
      );
      toast.success('Required forms updated');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update required forms');
      options?.onError?.(error);
    },
  });

  return {
    updateRequirements: mutation.mutate,
    updateRequirementsAsync: mutation.mutateAsync,
    isUpdatingRequirements: mutation.isPending,
  };
};
