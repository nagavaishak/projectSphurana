import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockTakeWithItems } from '../types';
import type { CreateStockTakeIntent } from './create-stock-take.payload';
import { buildCreateStockTakePayload } from './create-stock-take.payload';

interface UseCreateStockTakeOptions {
  onSuccess?: (stockTake: StockTakeWithItems) => void;
  onError?: (error: Error) => void;
}

export const useCreateStockTake = (options?: UseCreateStockTakeOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (intent: CreateStockTakeIntent) =>
      apiClient.post<StockTakeWithItems>(
        'stock-takes',
        buildCreateStockTakePayload(intent)
      ),
    onSuccess: async (stockTake) => {
      await queryClient.invalidateQueries({ queryKey: ['stock-takes'] });
      toast.success('Stocktake started');
      options?.onSuccess?.(stockTake);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start stocktake');
      options?.onError?.(error);
    },
  });

  return {
    createStockTake: mutation.mutate,
    createStockTakeAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
