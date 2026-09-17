import { apiClient } from '@borradh-workspace/api-client';
import type {
  AdjustGiftCardInput,
  GiftCard,
} from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseAdjustGiftCardOptions {
  onSuccess?: (giftCard: GiftCard) => void;
  onError?: (error: Error) => void;
}

export const useAdjustGiftCard = (
  giftCardId: string,
  options?: UseAdjustGiftCardOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: AdjustGiftCardInput) =>
      apiClient.post<GiftCard>(`gift-cards/${giftCardId}/adjust`, input),
    onSuccess: (giftCard) => {
      queryClient.invalidateQueries({ queryKey: ['gift-cards'] });
      toast.success('Gift card balance adjusted');
      options?.onSuccess?.(giftCard);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to adjust gift card');
      options?.onError?.(error);
    },
  });

  return {
    adjustGiftCard: mutation.mutate,
    adjustGiftCardAsync: mutation.mutateAsync,
    isAdjusting: mutation.isPending,
  };
};
