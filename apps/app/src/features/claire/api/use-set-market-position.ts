import { apiClient } from '@borradh-workspace/api-client';
import type {
  BusinessProfile,
  SetMarketPositionInput,
} from '@borradh-workspace/api-client/types';
import { businessProfileSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { adCreationContextQueryKey } from './use-ad-creation-context';

interface UseSetMarketPositionOptions {
  onSuccess?: (profile: BusinessProfile) => void;
  onError?: (error: Error) => void;
}

export const useSetMarketPosition = (options?: UseSetMarketPositionOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: SetMarketPositionInput) =>
      apiClient.post<BusinessProfile>(
        'claire/business-profile/set-market-position',
        input,
        { schema: businessProfileSchema }
      ),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: adCreationContextQueryKey });
      options?.onSuccess?.(profile);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not save your selection');
      options?.onError?.(error);
    },
  });

  return {
    setMarketPosition: mutation.mutate,
    setMarketPositionAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
};
