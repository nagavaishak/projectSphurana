import { apiClient } from '@borradh-workspace/api-client';
import type {
  CreateSaleInput,
  Sale,
} from '@borradh-workspace/api-client/types';
import { saleSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseCreateSaleOptions {
  onSuccess?: (sale: Sale) => void;
  onError?: (error: Error) => void;
}

export const useCreateSale = (options?: UseCreateSaleOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateSaleInput = {}) =>
      apiClient.post<Sale>('sales', input, { schema: saleSchema }),
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: ['sales', 'list'] });
      options?.onSuccess?.(sale);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start sale');
      options?.onError?.(error);
    },
  });

  return {
    createSale: mutation.mutate,
    createSaleAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
