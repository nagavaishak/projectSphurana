import { apiClient } from '@borradh-workspace/api-client';
import type { Sale } from '@borradh-workspace/api-client/types';
import { saleSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseVoidSaleOptions {
  onSuccess?: (sale: Sale) => void;
  onError?: (error: Error) => void;
}

export const useVoidSale = (saleId: string, options?: UseVoidSaleOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<Sale>(`sales/${saleId}/void`, {}, { schema: saleSchema }),
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast.success('Sale voided');
      options?.onSuccess?.(sale);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to void sale');
      options?.onError?.(error);
    },
  });

  return {
    voidSale: mutation.mutate,
    voidSaleAsync: mutation.mutateAsync,
    isVoiding: mutation.isPending,
  };
};
