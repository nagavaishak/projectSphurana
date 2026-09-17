import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProductBrand } from '../types';
import type { CreateProductBrandIntent } from './create-product-brand.input';
import { buildCreateProductBrandPayload } from './create-product-brand.payload';

interface UseCreateProductBrandOptions {
  onSuccess?: (brand: ProductBrand) => void;
  onError?: (error: Error) => void;
}

export const useCreateProductBrand = (
  options?: UseCreateProductBrandOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (intent: CreateProductBrandIntent) =>
      apiClient.post<ProductBrand>(
        'product-brands',
        buildCreateProductBrandPayload(intent)
      ),
    onSuccess: async (brand) => {
      await queryClient.invalidateQueries({ queryKey: ['product-brands'] });
      toast.success('Brand created');
      options?.onSuccess?.(brand);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create brand');
      options?.onError?.(error);
    },
  });

  return {
    createProductBrand: mutation.mutate,
    createProductBrandAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
