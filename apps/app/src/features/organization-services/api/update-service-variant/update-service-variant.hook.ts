'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type { ServiceVariantResponse } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/** Body for `PUT /organization-services/variants/:variantId`. */
export interface UpdateServiceVariantInput {
  id: string;
  name?: string;
  priceCents?: number | null;
  durationMinutes?: number | null;
  sortOrder?: number;
  isActive?: boolean;
}

interface UseUpdateServiceVariantOptions {
  onSuccess?: (variant: ServiceVariantResponse) => void;
  onError?: (error: Error) => void;
  showSuccessToast?: boolean;
}

export const useUpdateServiceVariant = (
  options?: UseUpdateServiceVariantOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...input }: UpdateServiceVariantInput) =>
      apiClient.put<ServiceVariantResponse>(
        `organization-services/variants/${id}`,
        input
      ),
    onSuccess: async (variant) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organizationServices.all(),
      });
      if (options?.showSuccessToast) toast.success('Option updated');
      options?.onSuccess?.(variant);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update option');
      options?.onError?.(error);
    },
  });

  return {
    updateVariant: mutation.mutate,
    updateVariantAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
