'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type { ServiceVariantResponse } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Body for `POST /organization-services/:serviceId/variants`. `serviceId` is a
 * per-call field (not hook-bound) so the service form can create variants
 * against a service whose id only exists AFTER the service itself is created.
 */
export interface CreateServiceVariantInput {
  serviceId: string;
  name: string;
  priceCents?: number | null;
  durationMinutes?: number | null;
  sortOrder?: number;
  isActive?: boolean;
}

interface UseCreateServiceVariantOptions {
  onSuccess?: (variant: ServiceVariantResponse) => void;
  onError?: (error: Error) => void;
  /** Silence the toast — the service form batches many variant writes. */
  showSuccessToast?: boolean;
}

export const useCreateServiceVariant = (
  options?: UseCreateServiceVariantOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ serviceId, ...input }: CreateServiceVariantInput) =>
      apiClient.post<ServiceVariantResponse>(
        `organization-services/${serviceId}/variants`,
        input
      ),
    onSuccess: async (variant) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organizationServices.all(),
      });
      if (options?.showSuccessToast) toast.success('Option added');
      options?.onSuccess?.(variant);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add option');
      options?.onError?.(error);
    },
  });

  return {
    createVariant: mutation.mutate,
    createVariantAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
