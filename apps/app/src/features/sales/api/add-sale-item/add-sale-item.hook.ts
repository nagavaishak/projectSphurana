import { apiClient } from '@borradh-workspace/api-client';
import type {
  AddSaleItemInput,
  SaleWithRelations,
} from '@borradh-workspace/api-client/types';
import { saleWithRelationsSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { syncSaleCaches } from '../sales-cache';

interface UseAddSaleItemOptions {
  onSuccess?: (sale: SaleWithRelations) => void;
  onError?: (error: Error) => void;
}

export const useAddSaleItem = (
  saleId: string,
  options?: UseAddSaleItemOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: AddSaleItemInput) =>
      apiClient.post<SaleWithRelations>(`sales/${saleId}/items`, input, {
        schema: saleWithRelationsSchema,
      }),
    onSuccess: (sale) => {
      syncSaleCaches(queryClient, sale);
      options?.onSuccess?.(sale);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add item');
      options?.onError?.(error);
    },
  });

  return {
    addSaleItem: mutation.mutate,
    addSaleItemAsync: mutation.mutateAsync,
    isAdding: mutation.isPending,
  };
};
