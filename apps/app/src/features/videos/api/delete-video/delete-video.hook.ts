import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Video } from '../types';

/**
 * Delete Video Hook
 * Deletes a video
 */
export const useDeleteVideo = (options?: {
  onSuccess?: (video: Video) => void;
  onError?: (error: Error) => void;
  silent?: boolean;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (videoId: string) => {
      return apiClient.delete<Video>(`videos/${videoId}`);
    },
    onSuccess: (video) => {
      // Invalidate videos list
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      if (!options?.silent) toast.success('Video deleted successfully');
      options?.onSuccess?.(video);
    },
    onError: (error: Error) => {
      if (!options?.silent)
        toast.error(error.message || 'Failed to delete video');
      options?.onError?.(error);
    },
  });

  return {
    deleteVideo: mutation.mutate,
    deleteVideoAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
