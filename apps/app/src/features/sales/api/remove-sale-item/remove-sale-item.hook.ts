import { apiClient } from '@borradh-workspace/api-client';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';
import { saleWithRelationsSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { syncSaleCaches } from '../sales-cache';

interface UseRemoveSaleItemOptions {
  onSuccess?: (sale: SaleWithRelations) => void;
  onError?: (error: Error) => void;
}

export const useRemoveSaleItem = (
  saleId: string,
  options?: UseRemoveSaleItemOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (itemId: string) =>
      apiClient.delete<SaleWithRelations>(
        `sales/${saleId}/items/${itemId}`,
        undefined,
        { schema: saleWithRelationsSchema }
      ),
    onSuccess: (sale) => {
      syncSaleCaches(queryClient, sale);
      options?.onSuccess?.(sale);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove item');
      options?.onError?.(error);
    },
  });

  return {
    removeSaleItem: mutation.mutate,
    removeSaleItemAsync: mutation.mutateAsync,
    isRemoving: mutation.isPending,
  };
};
