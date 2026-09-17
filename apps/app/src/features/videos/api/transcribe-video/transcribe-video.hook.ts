import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

interface TranscribeVideoResponse {
  text: string;
}

export const useTranscribeVideo = (options?: {
  onSuccess?: (data: TranscribeVideoResponse) => void;
  onError?: (error: Error) => void;
}) => {
  const mutation = useMutation({
    mutationFn: (videoId: string) =>
      apiClient.post<TranscribeVideoResponse>(
        `videos/${videoId}/transcribe`,
        undefined,
        { timeout: 120_000 }
      ),
    onSuccess: (data) => {
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Transcription failed');
      options?.onError?.(error);
    },
  });

  return {
    transcribe: mutation.mutate,
    transcribeAsync: mutation.mutateAsync,
    isTranscribing: mutation.isPending,
    transcript: mutation.data?.text ?? null,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
