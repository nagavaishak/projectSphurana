import { apiClient } from '@borradh-workspace/api-client';
import type { Offer } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type OfferFormIntent,
  buildCreateOfferPayload,
} from '../offer-payload';

interface UseCreateOfferOptions {
  onSuccess?: (offer: Offer) => void;
  onError?: (error: Error) => void;
}

export const useCreateOffer = (options?: UseCreateOfferOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: OfferFormIntent) =>
      apiClient.post<Offer>('offers', buildCreateOfferPayload(input)),
    onSuccess: (offer) => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      toast.success('Offer created');
      options?.onSuccess?.(offer);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create offer');
      options?.onError?.(error);
    },
  });

  return {
    createOffer: mutation.mutate,
    createOfferAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
