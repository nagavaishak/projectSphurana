import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockOrder } from '../types';

interface UseCancelStockOrderOptions {
  onSuccess?: (stockOrder: StockOrder) => void;
  onError?: (error: Error) => void;
}

export const useCancelStockOrder = (options?: UseCancelStockOrderOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (stockOrderId: string) =>
      apiClient.post<StockOrder>(`stock-orders/${stockOrderId}/cancel`, {}),
    onSuccess: async (stockOrder) => {
      await queryClient.invalidateQueries({ queryKey: ['stock-orders'] });
      toast.success('Stock order cancelled');
      options?.onSuccess?.(stockOrder);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to cancel stock order');
      options?.onError?.(error);
    },
  });

  return {
    cancelStockOrder: mutation.mutate,
    cancelStockOrderAsync: mutation.mutateAsync,
    isCancelling: mutation.isPending,
  };
};
