import { apiClient } from '@borradh-workspace/api-client';
import type { Practitioner } from '@borradh-workspace/api-client/types';
import { practitionerSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseCompletePractitionerProfileSetupOptions {
  onSuccess?: (practitioner: Practitioner) => void;
  onError?: (error: Error) => void;
}

export const useCompletePractitionerProfileSetup = (
  options?: UseCompletePractitionerProfileSetupOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (practitionerId: string) =>
      apiClient.post<Practitioner>(
        `practitioners/${practitionerId}/complete-profile-setup`,
        {},
        { schema: practitionerSchema }
      ),
    onSuccess: (practitioner) => {
      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      options?.onSuccess?.(practitioner);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to complete profile setup');
      options?.onError?.(error);
    },
  });

  return {
    completeProfileSetup: mutation.mutate,
    completeProfileSetupAsync: mutation.mutateAsync,
    isCompleting: mutation.isPending,
  };
};
