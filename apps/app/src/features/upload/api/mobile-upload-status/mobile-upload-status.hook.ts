import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface MobileUploadStatusResponse {
  status: 'pending' | 'completed';
  url?: string;
}

export const mobileUploadStatusQueryOptions = (videoId: string | null) =>
  queryOptions({
    queryKey: ['upload', 'mobile-status', videoId],
    queryFn: () =>
      apiClient.get<MobileUploadStatusResponse>(
        `upload/mobile-status/${videoId}`
      ),
    enabled: !!videoId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling once upload is completed
      if (data?.status === 'completed') return false;
      return 3000; // Poll every 3 seconds
    },
  });

export const useMobileUploadStatus = (videoId: string | null) => {
  const query = useQuery(mobileUploadStatusQueryOptions(videoId));

  return {
    status: query.data?.status ?? 'pending',
    url: query.data?.url ?? null,
    isLoading: query.isLoading,
  };
};
