import { apiClient } from '@borradh-workspace/api-client';

import { queryKeys } from '@/lib/query-keys';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface AddProductLocationsInput {
  productId: string;
  locationIds: string[];
}

interface UseAddProductLocationsOptions {
  onSuccess?: () => void;
}

/**
 * Make an existing product available at more branches — the write behind
 * "import from another location".
 *
 * POST, not the PUT beside it: the PUT REPLACES the whole assignment set, so a
 * client-side "existing ∪ target" has to resend state it may not hold. The
 * server merges instead.
 */
export const useAddProductLocations = (
  options?: UseAddProductLocationsOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ productId, locationIds }: AddProductLocationsInput) =>
      apiClient.post(`products/${productId}/locations`, { locationIds }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.products.detail(variables.productId),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to import');
    },
  });

  return {
    addProductLocations: mutation.mutate,
    addProductLocationsAsync: mutation.mutateAsync,
    isAdding: mutation.isPending,
  };
};
