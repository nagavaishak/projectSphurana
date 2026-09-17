import { apiClient } from '@borradh-workspace/api-client';
import { listVideosResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListVideosResponse, VideoStatus } from '../types';

/**
 * Statuses the worker still moves a video out of. `draft` is deliberately
 * excluded: it waits on the user, not the worker, so it would poll forever.
 */
const IN_FLIGHT_STATUSES: readonly VideoStatus[] = ['queued', 'processing'];

export const isVideoInFlight = (status: VideoStatus): boolean =>
  IN_FLIGHT_STATUSES.includes(status);

/**
 * Upper bound on how long we keep polling a single in-flight video. The worker
 * bumps `updatedAt` as it progresses; a render wedged past this (e.g. a dead
 * worker) stops refreshing it, so we stop polling rather than refetch forever.
 * Generous relative to the 1-2 min render so a slow queue is never cut off.
 */
const STALL_THRESHOLD_MS = 15 * 60 * 1000;

export const listVideosQueryOptions = (params?: {
  limit?: number;
  offset?: number;
}) => {
  const queryParams = new URLSearchParams();
  if (params?.limit) queryParams.set('limit', params.limit.toString());
  if (params?.offset) queryParams.set('offset', params.offset.toString());
  const queryString = queryParams.toString();

  return queryOptions({
    queryKey: ['videos', params?.limit, params?.offset],
    queryFn: async () => {
      return apiClient.get<ListVideosResponse>(
        `videos${queryString ? `?${queryString}` : ''}`,
        { schema: listVideosResponseSchema }
      );
    },
    staleTime: 5 * 60 * 1000,
    // The worker writes `thumbnailUrl` in the same update that flips a video to
    // `ready`, so an in-flight video is listed with no poster and its tile
    // paints a placeholder. Renders finish well inside `staleTime`, so without
    // polling the list keeps serving that poster-less row until a manual
    // refresh. Stop once everything settles — `ready`/`failed` rows never change.
    refetchInterval: (query) => {
      const items = query.state.data?.items;
      if (!items) return false;
      const now = Date.now();
      const hasActiveInFlight = items.some(
        (v) =>
          isVideoInFlight(v.status) &&
          now - new Date(v.updatedAt).getTime() < STALL_THRESHOLD_MS
      );
      return hasActiveInFlight ? 5000 : false;
    },
  });
};

export const useListVideos = (params?: { limit?: number; offset?: number }) => {
  const query = useQuery(listVideosQueryOptions(params));

  return {
    videos: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
