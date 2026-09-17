'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteServiceVariantOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  showSuccessToast?: boolean;
}

export const useDeleteServiceVariant = (
  options?: UseDeleteServiceVariantOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (variantId: string) =>
      apiClient.delete(`organization-services/variants/${variantId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organizationServices.all(),
      });
      if (options?.showSuccessToast) toast.success('Option removed');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove option');
      options?.onError?.(error);
    },
  });

  return {
    deleteVariant: mutation.mutate,
    deleteVariantAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
