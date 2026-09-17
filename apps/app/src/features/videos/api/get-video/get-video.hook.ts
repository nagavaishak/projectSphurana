import { apiClient } from '@borradh-workspace/api-client';
import { videoWithCreatorSchema } from '@borradh-workspace/contracts';
import { type Query, queryOptions, useQuery } from '@tanstack/react-query';
import type { Video } from '../types';

export const getVideoQueryOptions = (videoId: string) => {
  return queryOptions({
    queryKey: ['video', videoId],
    queryFn: async () =>
      apiClient.get<Video>(`videos/${videoId}`, {
        schema: videoWithCreatorSchema,
      }),
    enabled: !!videoId,
    staleTime: 30 * 1000,
  });
};

type GetVideoOptions = {
  enabled?: boolean;
  /**
   * Polling interval. Accepts the React Query function form so callers can
   * stop polling once the video reaches a terminal status without referencing
   * the query result before it's declared.
   */
  refetchInterval?:
    | number
    | false
    | ((query: Query<Video, Error, Video, string[]>) => number | false);
};

export const useGetVideo = (videoId: string, options?: GetVideoOptions) => {
  const query = useQuery({
    ...getVideoQueryOptions(videoId),
    enabled: options?.enabled ?? !!videoId,
    refetchInterval: options?.refetchInterval,
  });

  return {
    data: query.data ?? null,
    video: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
