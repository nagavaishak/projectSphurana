import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { AssignPractitionerServicesIntent } from './assign-practitioner-services.payload';
import { buildAssignPractitionerServicesPayload } from './assign-practitioner-services.payload';

interface UseAssignPractitionerServicesOptions {
  onSuccess?: () => void;
}

export const useAssignPractitionerServices = (
  options?: UseAssignPractitionerServicesOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      practitionerId,
      ...intent
    }: AssignPractitionerServicesIntent & { practitionerId: string }) =>
      apiClient.put(
        `practitioners/${practitionerId}/services`,
        buildAssignPractitionerServicesPayload(intent)
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      queryClient.invalidateQueries({
        queryKey: ['practitioners', variables.practitionerId],
      });
      toast.success('Services updated');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to assign services');
    },
  });

  return {
    assignServices: mutation.mutate,
    assignServicesAsync: mutation.mutateAsync,
    isAssigning: mutation.isPending,
  };
};
