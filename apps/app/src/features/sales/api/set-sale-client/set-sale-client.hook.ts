import { apiClient } from '@borradh-workspace/api-client';
import type {
  SaleWithRelations,
  SetSaleClientInput,
} from '@borradh-workspace/api-client/types';
import { saleWithRelationsSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { syncSaleCaches } from '../sales-cache';

interface UseSetSaleClientOptions {
  onSuccess?: (sale: SaleWithRelations) => void;
  onError?: (error: Error) => void;
}

/** Attach (or clear, with `leadId: null`) the client on an open sale. */
export const useSetSaleClient = (
  saleId: string,
  options?: UseSetSaleClientOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: SetSaleClientInput) =>
      apiClient.put<SaleWithRelations>(`sales/${saleId}/client`, input, {
        schema: saleWithRelationsSchema,
      }),
    onSuccess: (sale) => {
      syncSaleCaches(queryClient, sale);
      options?.onSuccess?.(sale);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update client');
      options?.onError?.(error);
    },
  });

  return {
    setSaleClient: mutation.mutate,
    setSaleClientAsync: mutation.mutateAsync,
    isSettingClient: mutation.isPending,
  };
};
