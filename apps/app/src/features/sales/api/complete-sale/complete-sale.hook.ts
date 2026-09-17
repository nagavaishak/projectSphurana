import { apiClient } from '@borradh-workspace/api-client';
import type { Sale } from '@borradh-workspace/api-client/types';
import { saleSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseCompleteSaleOptions {
  onSuccess?: (sale: Sale) => void;
  onError?: (error: Error) => void;
}

export const useCompleteSale = (
  saleId: string,
  options?: UseCompleteSaleOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<Sale>(
        `sales/${saleId}/complete`,
        {},
        { schema: saleSchema }
      ),
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      options?.onSuccess?.(sale);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to complete sale');
      options?.onError?.(error);
    },
  });

  return {
    completeSale: mutation.mutate,
    completeSaleAsync: mutation.mutateAsync,
    isCompleting: mutation.isPending,
  };
};
