import { logError } from '@/lib/log-error';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Asset } from '../types';
import {
  type CreateAssetIntent,
  buildCreateAssetPayload,
} from './create-asset.payload';

/**
 * Create Asset Hook
 * Creates a new asset entry
 */
export const useCreateAsset = (options?: {
  onSuccess?: (asset: Asset) => void;
  onError?: (error: Error) => void;
  showToast?: boolean;
}) => {
  const queryClient = useQueryClient();
  const showToast = options?.showToast !== false;

  const mutation = useMutation({
    // Accepts typed INTENT, never a pre-built body. buildCreateAssetPayload is
    // the single place the wire body is assembled — see create-asset.payload.ts.
    mutationFn: async (intent: CreateAssetIntent) => {
      return apiClient.post<Asset>('assets', buildCreateAssetPayload(intent));
    },
    onSuccess: (asset) => {
      // Invalidate assets list
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      if (showToast) toast.success('Asset uploaded successfully');
      options?.onSuccess?.(asset);
    },
    onError: (error: Error) => {
      logError('assets.create', error, { feature: 'assets' });
      if (showToast) toast.error(error.message || 'Failed to create asset');
      options?.onError?.(error);
    },
  });

  return {
    createAsset: mutation.mutate,
    createAssetAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
