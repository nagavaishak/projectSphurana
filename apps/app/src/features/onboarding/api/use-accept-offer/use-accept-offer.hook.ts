import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AcceptIntroOfferInput,
  AcceptIntroOfferResponse,
} from '../../types';

interface UseAcceptOfferOptions {
  onSuccess?: (data: AcceptIntroOfferResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Accept the intro offer (creates the real offer row). The backend then
 * fire-and-forgets BOTH candidate generators, so the candidates poll starts
 * returning rows shortly after.
 */
export const useAcceptOffer = (options?: UseAcceptOfferOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: AcceptIntroOfferInput = {}) =>
      apiClient.post<AcceptIntroOfferResponse>(
        'onboarding/accept-offer',
        input
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'session'] });
      queryClient.invalidateQueries({
        queryKey: ['onboarding', 'candidates'],
      });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save the intro offer');
      options?.onError?.(error);
    },
  });

  return {
    acceptOffer: mutation.mutate,
    acceptOfferAsync: mutation.mutateAsync,
    isAccepting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
