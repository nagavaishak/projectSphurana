import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProductStock } from '../types';

interface AdjustProductStockVariables {
  productId: string;
  locationId: string;
  /** Absolute quantity for this product at this location. */
  quantity: number;
}

interface UseAdjustProductStockOptions {
  onSuccess?: (stock: ProductStock) => void;
  onError?: (error: Error) => void;
}

export const useAdjustProductStock = (
  options?: UseAdjustProductStockOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      productId,
      locationId,
      quantity,
    }: AdjustProductStockVariables) =>
      apiClient.put<ProductStock>(`products/${productId}/stock/${locationId}`, {
        quantity,
      }),
    onSuccess: async (stock, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['products', variables.productId, 'stock'],
      });
      toast.success('Stock updated');
      options?.onSuccess?.(stock);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update stock');
      options?.onError?.(error);
    },
  });

  return {
    adjustProductStock: mutation.mutate,
    adjustProductStockAsync: mutation.mutateAsync,
    isAdjusting: mutation.isPending,
  };
};
