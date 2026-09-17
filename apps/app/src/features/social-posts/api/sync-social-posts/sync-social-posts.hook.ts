import { apiClient } from '@borradh-workspace/api-client';
import {
  type SyncSocialPostsResponse,
  syncSocialPostsResponseSchema,
} from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

type SyncResult = SyncSocialPostsResponse;

export const useSyncSocialPosts = (options?: {
  onSuccess?: (result: SyncResult) => void;
  onError?: (error: Error) => void;
  /** Suppress toasts when no posts were deleted (useful for auto-sync on mount) */
  silent?: boolean;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      return apiClient.post<SyncResult>('social-posts/sync', undefined, {
        schema: syncSocialPostsResponseSchema,
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['social-posts'] });

      if (result.deleted > 0) {
        toast.info(
          `Sync complete: ${result.deleted} post${result.deleted > 1 ? 's' : ''} removed (deleted on Meta)`
        );
      } else if (!options?.silent) {
        toast.success('All posts are in sync with Meta');
      }

      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      if (!options?.silent) {
        toast.error(error.message || 'Failed to sync posts with Meta');
      }
      options?.onError?.(error);
    },
  });

  return {
    syncSocialPosts: mutation.mutate,
    syncSocialPostsAsync: mutation.mutateAsync,
    isSyncing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
