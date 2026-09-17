import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateVideoInput, Video } from '../types';
import { buildCreateVideoPayload } from './create-video.payload';

export const useCreateVideo = (options?: {
  onSuccess?: (video: Video) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: async (input: CreateVideoInput) => {
      return apiClient.post<Video>('videos', buildCreateVideoPayload(input));
    },
    onSuccess: (video) => {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      toast.success('Video created successfully');
      options?.onSuccess?.(video);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create video');
      options?.onError?.(error);
    },
  });

  return {
    createVideo: mutation.mutate,
    createVideoAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
