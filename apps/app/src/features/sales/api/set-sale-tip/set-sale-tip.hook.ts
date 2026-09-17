import { apiClient } from '@borradh-workspace/api-client';
import type {
  SaleWithRelations,
  SetSaleTipInput,
} from '@borradh-workspace/api-client/types';
import { saleWithRelationsSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { syncSaleCaches } from '../sales-cache';

interface UseSetSaleTipOptions {
  onSuccess?: (sale: SaleWithRelations) => void;
  onError?: (error: Error) => void;
}

export const useSetSaleTip = (
  saleId: string,
  options?: UseSetSaleTipOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: SetSaleTipInput) =>
      apiClient.put<SaleWithRelations>(`sales/${saleId}/tip`, input, {
        schema: saleWithRelationsSchema,
      }),
    onSuccess: (sale) => {
      syncSaleCaches(queryClient, sale);
      options?.onSuccess?.(sale);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update tip');
      options?.onError?.(error);
    },
  });

  return {
    setSaleTip: mutation.mutate,
    setSaleTipAsync: mutation.mutateAsync,
    isSettingTip: mutation.isPending,
  };
};
