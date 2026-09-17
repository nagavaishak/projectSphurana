import { apiClient } from '@borradh-workspace/api-client';
import type {
  AddSalePaymentInput,
  AddSalePaymentResponse,
} from '@borradh-workspace/api-client/types';
import { addSalePaymentResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { syncSaleCaches } from '../sales-cache';

interface UseAddSalePaymentOptions {
  onSuccess?: (result: AddSalePaymentResponse) => void;
  onError?: (error: Error) => void;
}

export const useAddSalePayment = (
  saleId: string,
  options?: UseAddSalePaymentOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: AddSalePaymentInput) =>
      apiClient.post<AddSalePaymentResponse>(
        `sales/${saleId}/payments`,
        input,
        { schema: addSalePaymentResponseSchema }
      ),
    onSuccess: (result) => {
      syncSaleCaches(queryClient, result);
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Payment failed');
      options?.onError?.(error);
    },
  });

  return {
    addSalePayment: mutation.mutate,
    addSalePaymentAsync: mutation.mutateAsync,
    isPaying: mutation.isPending,
  };
};
