import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Supplier } from '../types';
import type { UpdateSupplierIntent } from './update-supplier.input';
import { buildUpdateSupplierPayload } from './update-supplier.payload';

interface UseUpdateSupplierOptions {
  onSuccess?: (supplier: Supplier) => void;
  onError?: (error: Error) => void;
}

export const useUpdateSupplier = (options?: UseUpdateSupplierOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      supplierId,
      ...intent
    }: UpdateSupplierIntent & { supplierId: string }) =>
      apiClient.put<Supplier>(
        `suppliers/${supplierId}`,
        buildUpdateSupplierPayload(intent)
      ),
    onSuccess: async (supplier) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier updated');
      options?.onSuccess?.(supplier);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update supplier');
      options?.onError?.(error);
    },
  });

  return {
    updateSupplier: mutation.mutate,
    updateSupplierAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
