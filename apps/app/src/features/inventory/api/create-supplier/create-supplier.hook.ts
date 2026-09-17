import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Supplier } from '../types';
import type { CreateSupplierIntent } from './create-supplier.input';
import { buildCreateSupplierPayload } from './create-supplier.payload';

interface UseCreateSupplierOptions {
  onSuccess?: (supplier: Supplier) => void;
  onError?: (error: Error) => void;
}

export const useCreateSupplier = (options?: UseCreateSupplierOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (intent: CreateSupplierIntent) =>
      apiClient.post<Supplier>('suppliers', buildCreateSupplierPayload(intent)),
    onSuccess: async (supplier) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier created');
      options?.onSuccess?.(supplier);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create supplier');
      options?.onError?.(error);
    },
  });

  return {
    createSupplier: mutation.mutate,
    createSupplierAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
