import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ServiceResourceRequirements,
  SetServiceResourceRequirementsInput,
} from '../types';

/** `serviceId` is per-call so one hook instance can write any service's rules. */
export type SetServiceResourceRequirementsVariables =
  SetServiceResourceRequirementsInput & { serviceId: string };

interface UseSetServiceResourceRequirementsOptions {
  onSuccess?: (requirements: ServiceResourceRequirements) => void;
  onError?: (error: Error) => void;
}

/**
 * Replace a service's ENTIRE requirement set (plus its turnaround buffer).
 *
 * Invalidates `['organization-services']` as well as the requirement key:
 * `turnaroundMinutes` lives ON the service row, so the services list and the
 * service form would otherwise keep showing the pre-save buffer.
 */
export const useSetServiceResourceRequirements = (
  options?: UseSetServiceResourceRequirementsOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      serviceId,
      ...input
    }: SetServiceResourceRequirementsVariables) =>
      apiClient.put<ServiceResourceRequirements>(
        `resources/requirements/${serviceId}`,
        input
      ),
    // Async so `mutateAsync` waits for both refetches before the form closes.
    onSuccess: async (requirements, { serviceId }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.resources.requirements(serviceId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.organizationServices.all(),
        }),
      ]);
      toast.success('Resource requirements saved');
      options?.onSuccess?.(requirements);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save resource requirements');
      options?.onError?.(error);
    },
  });

  return {
    setRequirements: mutation.mutate,
    setRequirementsAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
