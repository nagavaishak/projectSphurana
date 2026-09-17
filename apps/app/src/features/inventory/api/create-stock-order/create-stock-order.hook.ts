import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockOrderWithItems } from '../types';
import type { CreateStockOrderIntent } from './create-stock-order.input';
import { buildCreateStockOrderPayload } from './create-stock-order.payload';

interface UseCreateStockOrderOptions {
  onSuccess?: (stockOrder: StockOrderWithItems) => void;
  onError?: (error: Error) => void;
}

export const useCreateStockOrder = (options?: UseCreateStockOrderOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (intent: CreateStockOrderIntent) =>
      apiClient.post<StockOrderWithItems>(
        'stock-orders',
        buildCreateStockOrderPayload(intent)
      ),
    onSuccess: async (stockOrder) => {
      await queryClient.invalidateQueries({ queryKey: ['stock-orders'] });
      toast.success('Stock order created');
      options?.onSuccess?.(stockOrder);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create stock order');
      options?.onError?.(error);
    },
  });

  return {
    createStockOrder: mutation.mutate,
    createStockOrderAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
