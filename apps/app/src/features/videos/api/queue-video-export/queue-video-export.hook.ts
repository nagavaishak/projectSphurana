import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Video } from '../types';

export const useQueueVideoExport = (options?: {
  onSuccess?: (video: Video) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      videoId,
      allowStockFootage,
    }: { videoId: string; allowStockFootage?: boolean }) => {
      return apiClient.post<Video>(`videos/${videoId}/export`, {
        allowStockFootage,
      });
    },
    onSuccess: (video) => {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      queryClient.invalidateQueries({ queryKey: ['video', video.id] });
      options?.onSuccess?.(video);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to export video');
      options?.onError?.(error);
    },
  });

  return {
    queueExport: mutation.mutate,
    queueExportAsync: mutation.mutateAsync,
    isQueuing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
