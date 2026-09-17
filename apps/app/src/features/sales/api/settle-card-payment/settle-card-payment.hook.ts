import { apiClient } from '@borradh-workspace/api-client';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';
import { saleWithRelationsSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { syncSaleCaches } from '../sales-cache';

interface UseSettleCardPaymentOptions {
  onSuccess?: (sale: SaleWithRelations) => void;
  onError?: (error: Error) => void;
}

/**
 * Settle a manual-card tender the instant Stripe Elements confirms it, rather
 * than waiting on the async webhook. Returns the (usually completed) sale so
 * the checkout can advance to the receipt without a manual "Complete sale".
 */
export const useSettleCardPayment = (
  saleId: string,
  options?: UseSettleCardPaymentOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (paymentId: string) =>
      apiClient.post<SaleWithRelations>(
        `sales/${saleId}/payments/${paymentId}/settle-card`,
        {},
        { schema: saleWithRelationsSchema }
      ),
    onSuccess: (sale) => {
      syncSaleCaches(queryClient, sale);
      options?.onSuccess?.(sale);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });

  return {
    settleCardPayment: mutation.mutate,
    settleCardPaymentAsync: mutation.mutateAsync,
    isSettling: mutation.isPending,
  };
};
