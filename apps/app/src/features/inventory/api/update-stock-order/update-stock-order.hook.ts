import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockOrderWithItems, UpdateStockOrderInput } from '../types';

interface UseUpdateStockOrderOptions {
  /** Override the default "Stock order updated" toast. */
  successMessage?: string;
  onSuccess?: (stockOrder: StockOrderWithItems) => void;
  onError?: (error: Error) => void;
}

export const useUpdateStockOrder = (options?: UseUpdateStockOrderOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      stockOrderId,
      ...input
    }: UpdateStockOrderInput & { stockOrderId: string }) =>
      apiClient.put<StockOrderWithItems>(`stock-orders/${stockOrderId}`, input),
    onSuccess: async (stockOrder) => {
      await queryClient.invalidateQueries({ queryKey: ['stock-orders'] });
      toast.success(options?.successMessage ?? 'Stock order updated');
      options?.onSuccess?.(stockOrder);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update stock order');
      options?.onError?.(error);
    },
  });

  return {
    updateStockOrder: mutation.mutate,
    updateStockOrderAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
