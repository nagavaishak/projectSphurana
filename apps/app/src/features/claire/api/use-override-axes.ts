import { apiClient } from '@borradh-workspace/api-client';
import type {
  BusinessProfile,
  OverrideAxesInput,
} from '@borradh-workspace/api-client/types';
import { businessProfileSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { adCreationContextQueryKey } from './use-ad-creation-context';

interface UseOverrideAxesOptions {
  onSuccess?: (profile: BusinessProfile) => void;
  onError?: (error: Error) => void;
}

export const useOverrideAxes = (options?: UseOverrideAxesOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: OverrideAxesInput) =>
      apiClient.post<BusinessProfile>(
        'claire/business-profile/override-axes',
        input,
        { schema: businessProfileSchema }
      ),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: adCreationContextQueryKey });
      options?.onSuccess?.(profile);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not save your classification');
      options?.onError?.(error);
    },
  });

  return {
    overrideAxes: mutation.mutate,
    overrideAxesAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
};
