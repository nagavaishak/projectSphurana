import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockTakeWithItems } from '../types';

interface UseCompleteStockTakeOptions {
  onSuccess?: (stockTake: StockTakeWithItems) => void;
  onError?: (error: Error) => void;
}

/** Completing writes counted quantities into product stock (absolute set). */
export const useCompleteStockTake = (options?: UseCompleteStockTakeOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (stockTakeId: string) =>
      apiClient.post<StockTakeWithItems>(
        `stock-takes/${stockTakeId}/complete`,
        {}
      ),
    onSuccess: async (stockTake) => {
      await queryClient.invalidateQueries({ queryKey: ['stock-takes'] });
      // Completing writes counted quantities into product stock.
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Stocktake completed');
      options?.onSuccess?.(stockTake);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to complete stocktake');
      options?.onError?.(error);
    },
  });

  return {
    completeStockTake: mutation.mutate,
    completeStockTakeAsync: mutation.mutateAsync,
    isCompleting: mutation.isPending,
  };
};
