import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { UpdateVideoInput, Video } from '../types';
import { buildUpdateVideoPayload } from './update-video.payload';

export const useUpdateVideo = (options?: {
  onSuccess?: (video: Video) => void;
  onError?: (error: Error) => void;
  silent?: boolean;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: async (input: UpdateVideoInput & { id: string }) =>
      apiClient.put<Video>(
        `videos/${input.id}`,
        buildUpdateVideoPayload(input)
      ),
    onSuccess: (video) => {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      queryClient.invalidateQueries({ queryKey: ['video', video.id] });
      if (!options?.silent) toast.success('Video updated successfully');
      options?.onSuccess?.(video);
    },
    onError: (error: Error) => {
      if (!options?.silent) {
        toast.error(error.message || 'Failed to update video');
      }
      options?.onError?.(error);
    },
  });

  return {
    updateVideo: mutation.mutate,
    updateVideoAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
