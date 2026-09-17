import { apiClient } from '@borradh-workspace/api-client';
import type { Offer } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type OfferFormIntent,
  buildUpdateOfferPayload,
} from '../offer-payload';

interface UseUpdateOfferOptions {
  onSuccess?: (offer: Offer) => void;
  onError?: (error: Error) => void;
}

export const useUpdateOffer = (options?: UseUpdateOfferOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...values }: OfferFormIntent & { id: string }) =>
      apiClient.put<Offer>(
        `offers/${id}`,
        buildUpdateOfferPayload({ source: 'form', values })
      ),
    onSuccess: (offer) => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      queryClient.invalidateQueries({ queryKey: ['offers', offer.id] });
      toast.success('Offer updated');
      options?.onSuccess?.(offer);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update offer');
      options?.onError?.(error);
    },
  });

  return {
    updateOffer: mutation.mutate,
    updateOfferAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
