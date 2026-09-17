import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockOrderWithItems } from '../types';
import type { ReceiveStockOrderIntent } from './receive-stock-order.input';
import { buildReceiveStockOrderPayload } from './receive-stock-order.payload';

interface UseReceiveStockOrderOptions {
  onSuccess?: (stockOrder: StockOrderWithItems) => void;
  onError?: (error: Error) => void;
}

/**
 * Records a receipt event. Quantities are DELTAS received in this receipt,
 * not cumulative totals; the API increments product stock at the order's
 * destination location.
 */
export const useReceiveStockOrder = (options?: UseReceiveStockOrderOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      stockOrderId,
      ...intent
    }: ReceiveStockOrderIntent & { stockOrderId: string }) =>
      apiClient.post<StockOrderWithItems>(
        `stock-orders/${stockOrderId}/receive`,
        buildReceiveStockOrderPayload(intent)
      ),
    onSuccess: async (stockOrder) => {
      await queryClient.invalidateQueries({ queryKey: ['stock-orders'] });
      // Receiving increments product stock levels.
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Delivery received');
      options?.onSuccess?.(stockOrder);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to receive stock order');
      options?.onError?.(error);
    },
  });

  return {
    receiveStockOrder: mutation.mutate,
    receiveStockOrderAsync: mutation.mutateAsync,
    isReceiving: mutation.isPending,
  };
};
