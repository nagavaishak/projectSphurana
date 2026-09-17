import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockTake } from '../types';

interface UseCancelStockTakeOptions {
  onSuccess?: (stockTake: StockTake) => void;
  onError?: (error: Error) => void;
}

export const useCancelStockTake = (options?: UseCancelStockTakeOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (stockTakeId: string) =>
      apiClient.post<StockTake>(`stock-takes/${stockTakeId}/cancel`, {}),
    onSuccess: async (stockTake) => {
      await queryClient.invalidateQueries({ queryKey: ['stock-takes'] });
      toast.success('Stocktake cancelled');
      options?.onSuccess?.(stockTake);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to cancel stocktake');
      options?.onError?.(error);
    },
  });

  return {
    cancelStockTake: mutation.mutate,
    cancelStockTakeAsync: mutation.mutateAsync,
    isCancelling: mutation.isPending,
  };
};
