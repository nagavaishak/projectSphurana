import { apiClient } from '@borradh-workspace/api-client';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';
import { saleWithRelationsSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { syncSaleCaches } from '../sales-cache';

interface UseCancelSalePaymentOptions {
  onSuccess?: (sale: SaleWithRelations) => void;
  onError?: (error: Error) => void;
}

/**
 * Abandon a pending Stripe tender the cashier gave up on (closed the QR /
 * manual-card / terminal dialog, or switched methods). Cancels the Stripe side
 * server-side and frees the sale's remaining balance so the next tender isn't
 * rejected as "exceeds the remaining balance". Best-effort — a failure is
 * swallowed by the caller (the sale still completes/voids-cleans up later).
 */
export const useCancelSalePayment = (
  saleId: string,
  options?: UseCancelSalePaymentOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (paymentId: string) =>
      apiClient.post<SaleWithRelations>(
        `sales/${saleId}/payments/${paymentId}/cancel`,
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
    cancelSalePayment: mutation.mutate,
    cancelSalePaymentAsync: mutation.mutateAsync,
    isCanceling: mutation.isPending,
  };
};
