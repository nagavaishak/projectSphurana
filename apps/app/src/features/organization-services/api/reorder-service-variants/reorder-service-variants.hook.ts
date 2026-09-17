'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Body for `PUT /organization-services/:serviceId/variants/reorder`. `serviceId`
 * is a per-call field so the same hook instance can reorder any service.
 */
export interface ReorderServiceVariantsInput {
  serviceId: string;
  orderedIds: string[];
}

interface UseReorderServiceVariantsOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useReorderServiceVariants = (
  options?: UseReorderServiceVariantsOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ serviceId, orderedIds }: ReorderServiceVariantsInput) =>
      apiClient.put(`organization-services/${serviceId}/variants/reorder`, {
        orderedIds,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organizationServices.all(),
      });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reorder options');
      options?.onError?.(error);
    },
  });

  return {
    reorderVariants: mutation.mutate,
    reorderVariantsAsync: mutation.mutateAsync,
    isReordering: mutation.isPending,
  };
};
