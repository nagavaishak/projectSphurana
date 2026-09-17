import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProductBrand } from '../types';
import type { UpdateProductBrandIntent } from './update-product-brand.input';
import { buildUpdateProductBrandPayload } from './update-product-brand.payload';

interface UseUpdateProductBrandOptions {
  onSuccess?: (brand: ProductBrand) => void;
  onError?: (error: Error) => void;
}

export const useUpdateProductBrand = (
  options?: UseUpdateProductBrandOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      brandId,
      ...intent
    }: UpdateProductBrandIntent & { brandId: string }) =>
      apiClient.put<ProductBrand>(
        `product-brands/${brandId}`,
        buildUpdateProductBrandPayload(intent)
      ),
    onSuccess: async (brand) => {
      await queryClient.invalidateQueries({ queryKey: ['product-brands'] });
      toast.success('Brand updated');
      options?.onSuccess?.(brand);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update brand');
      options?.onError?.(error);
    },
  });

  return {
    updateProductBrand: mutation.mutate,
    updateProductBrandAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
