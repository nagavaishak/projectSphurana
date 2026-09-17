import { apiClient } from '@borradh-workspace/api-client';
import { listGraphicsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { GraphicStatus, ListGraphicsResponse } from '../types';

interface ListGraphicsParams {
  status?: GraphicStatus;
  templateId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Query options for listing graphics
 */
export const listGraphicsQueryOptions = (params?: ListGraphicsParams) => {
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.set('status', params.status);
  if (params?.templateId) queryParams.set('templateId', params.templateId);
  if (params?.limit) queryParams.set('limit', params.limit.toString());
  if (params?.offset) queryParams.set('offset', params.offset.toString());
  const queryString = queryParams.toString();

  return queryOptions({
    queryKey: [
      'graphics',
      params?.status,
      params?.templateId,
      params?.limit,
      params?.offset,
    ],
    queryFn: async () => {
      return apiClient.get<ListGraphicsResponse>(
        `graphics${queryString ? `?${queryString}` : ''}`,
        { schema: listGraphicsResponseSchema }
      );
    },
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * List Graphics Hook
 * Returns all graphics for the current organization
 */
export const useListGraphics = (params?: ListGraphicsParams) => {
  const query = useQuery(listGraphicsQueryOptions(params));

  return {
    graphics: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
