import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StockTakeWithItems } from '../types';
import type { RecordStockTakeCountsIntent } from './record-stock-take-counts.input';
import { buildRecordStockTakeCountsPayload } from './record-stock-take-counts.payload';

interface UseRecordStockTakeCountsOptions {
  onSuccess?: (stockTake: StockTakeWithItems) => void;
  onError?: (error: Error) => void;
}

export const useRecordStockTakeCounts = (
  options?: UseRecordStockTakeCountsOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      stockTakeId,
      ...intent
    }: RecordStockTakeCountsIntent & { stockTakeId: string }) =>
      apiClient.put<StockTakeWithItems>(
        `stock-takes/${stockTakeId}/items`,
        buildRecordStockTakeCountsPayload(intent)
      ),
    onSuccess: async (stockTake) => {
      await queryClient.invalidateQueries({ queryKey: ['stock-takes'] });
      toast.success('Counts saved');
      options?.onSuccess?.(stockTake);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save counts');
      options?.onError?.(error);
    },
  });

  return {
    recordStockTakeCounts: mutation.mutate,
    recordStockTakeCountsAsync: mutation.mutateAsync,
    isRecording: mutation.isPending,
  };
};
