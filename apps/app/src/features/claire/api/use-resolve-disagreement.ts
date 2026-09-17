import { apiClient } from '@borradh-workspace/api-client';
import type {
  BusinessProfile,
  ResolveDisagreementInput,
} from '@borradh-workspace/api-client/types';
import { businessProfileSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { adCreationContextQueryKey } from './use-ad-creation-context';

interface UseResolveDisagreementOptions {
  onSuccess?: (profile: BusinessProfile) => void;
  onError?: (error: Error) => void;
}

export const useResolveDisagreement = (
  options?: UseResolveDisagreementOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ResolveDisagreementInput) =>
      apiClient.post<BusinessProfile>(
        'claire/business-profile/resolve-disagreement',
        input,
        { schema: businessProfileSchema }
      ),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: adCreationContextQueryKey });
      options?.onSuccess?.(profile);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not save your response');
      options?.onError?.(error);
    },
  });

  return {
    resolveDisagreement: mutation.mutate,
    resolveDisagreementAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
};
