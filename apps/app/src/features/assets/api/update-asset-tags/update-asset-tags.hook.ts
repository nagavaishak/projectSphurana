import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Asset, UpdateAssetTagsInput } from '../types';

interface UseUpdateAssetTagsOptions {
  onSuccess?: (asset: Asset) => void;
  onError?: (error: Error) => void;
  showToast?: boolean;
}

/**
 * Hook to replace all tags on an asset
 */
export const useReplaceAssetTags = (options?: UseUpdateAssetTagsOptions) => {
  const queryClient = useQueryClient();
  const showToast = options?.showToast !== false;

  const mutation = useMutation({
    mutationFn: ({
      assetId,
      tags,
    }: UpdateAssetTagsInput & { assetId: string }) =>
      apiClient.put<Asset>(`assets/${assetId}/tags`, { tags }),
    onSuccess: (asset, { assetId }) => {
      queryClient.invalidateQueries({ queryKey: ['assets', assetId] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      if (showToast) toast.success('Asset tags updated');
      options?.onSuccess?.(asset);
    },
    onError: (error: Error) => {
      if (showToast) toast.error(error.message || 'Failed to update tags');
      options?.onError?.(error);
    },
  });

  return {
    replaceTags: mutation.mutate,
    replaceTagsAsync: mutation.mutateAsync,
    isReplacing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};

/**
 * Hook to add tags to an asset (merge with existing)
 */
export const useAddAssetTags = (options?: UseUpdateAssetTagsOptions) => {
  const queryClient = useQueryClient();
  const showToast = options?.showToast !== false;

  const mutation = useMutation({
    mutationFn: ({
      assetId,
      tags,
    }: UpdateAssetTagsInput & { assetId: string }) =>
      apiClient.post<Asset>(`assets/${assetId}/tags`, { tags }),
    onSuccess: (asset, { assetId }) => {
      queryClient.invalidateQueries({ queryKey: ['assets', assetId] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      if (showToast) toast.success('Tags added');
      options?.onSuccess?.(asset);
    },
    onError: (error: Error) => {
      if (showToast) toast.error(error.message || 'Failed to add tags');
      options?.onError?.(error);
    },
  });

  return {
    addTags: mutation.mutate,
    addTagsAsync: mutation.mutateAsync,
    isAdding: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};

/**
 * Hook to remove tags from an asset
 */
export const useRemoveAssetTags = (options?: UseUpdateAssetTagsOptions) => {
  const queryClient = useQueryClient();
  const showToast = options?.showToast !== false;

  const mutation = useMutation({
    mutationFn: ({
      assetId,
      tags,
    }: UpdateAssetTagsInput & { assetId: string }) =>
      apiClient.delete<Asset>(`assets/${assetId}/tags`, {
        body: JSON.stringify({ tags }),
      }),
    onSuccess: (asset, { assetId }) => {
      queryClient.invalidateQueries({ queryKey: ['assets', assetId] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      if (showToast) toast.success('Tags removed');
      options?.onSuccess?.(asset);
    },
    onError: (error: Error) => {
      if (showToast) toast.error(error.message || 'Failed to remove tags');
      options?.onError?.(error);
    },
  });

  return {
    removeTags: mutation.mutate,
    removeTagsAsync: mutation.mutateAsync,
    isRemoving: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
