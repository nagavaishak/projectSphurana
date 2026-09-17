import { apiClient } from '@borradh-workspace/api-client';
import { assetLinkedServicesResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LinkedService, UpdateAssetServicesInput } from '../types';

interface UseLinkAssetServicesOptions {
  onSuccess?: (linkedServices: LinkedService[]) => void;
  onError?: (error: Error) => void;
}

interface UseUnlinkAssetServicesOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Hook to link services to an asset
 */
export const useLinkAssetServices = (options?: UseLinkAssetServicesOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      assetId,
      serviceIds,
    }: UpdateAssetServicesInput & { assetId: string }) =>
      apiClient.post<LinkedService[]>(
        `assets/${assetId}/services`,
        { serviceIds },
        { schema: assetLinkedServicesResponseSchema }
      ),
    onSuccess: (linkedServices, { assetId }) => {
      queryClient.invalidateQueries({
        queryKey: ['assets', assetId, 'analysis'],
      });
      queryClient.invalidateQueries({ queryKey: ['assets', assetId] });
      toast.success('Services linked to asset');
      options?.onSuccess?.(linkedServices);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to link services');
      options?.onError?.(error);
    },
  });

  return {
    linkServices: mutation.mutate,
    linkServicesAsync: mutation.mutateAsync,
    isLinking: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};

/**
 * Hook to unlink services from an asset
 */
export const useUnlinkAssetServices = (
  options?: UseUnlinkAssetServicesOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      assetId,
      serviceIds,
    }: UpdateAssetServicesInput & { assetId: string }) =>
      apiClient.delete(`assets/${assetId}/services`, { serviceIds }),
    onSuccess: (_, { assetId }) => {
      queryClient.invalidateQueries({
        queryKey: ['assets', assetId, 'analysis'],
      });
      queryClient.invalidateQueries({ queryKey: ['assets', assetId] });
      toast.success('Services unlinked from asset');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to unlink services');
      options?.onError?.(error);
    },
  });

  return {
    unlinkServices: mutation.mutate,
    unlinkServicesAsync: mutation.mutateAsync,
    isUnlinking: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};

interface UseSetAssetServiceOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Set an asset's assigned service to a single service — the gallery preview
 * combobox uses this to "change the service" an asset is for. The link
 * endpoint only appends, so we first unlink any other currently-assigned
 * services, then link the chosen one. One toast, then refresh the assets list
 * (so tile badges update) and the asset's analysis (linked-services panel).
 */
export const useSetAssetService = (options?: UseSetAssetServiceOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      assetId,
      serviceId,
      previousServiceIds,
    }: {
      assetId: string;
      serviceId: string;
      previousServiceIds: string[];
    }) => {
      const toRemove = previousServiceIds.filter((id) => id !== serviceId);
      if (toRemove.length > 0) {
        await apiClient.delete(`assets/${assetId}/services`, {
          serviceIds: toRemove,
        });
      }
      return apiClient.post<LinkedService[]>(
        `assets/${assetId}/services`,
        { serviceIds: [serviceId] },
        { schema: assetLinkedServicesResponseSchema }
      );
    },
    onSuccess: (_linkedServices, { assetId }) => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({
        queryKey: ['assets', assetId, 'analysis'],
      });
      toast.success('Service updated');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update service');
      options?.onError?.(error);
    },
  });

  return {
    setService: mutation.mutate,
    setServiceAsync: mutation.mutateAsync,
    isSettingService: mutation.isPending,
  };
};
