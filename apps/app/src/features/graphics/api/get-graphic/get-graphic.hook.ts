import { apiClient } from '@borradh-workspace/api-client';
import { graphicSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Graphic } from '../types';

/**
 * Query options for getting a single graphic
 */
export const getGraphicQueryOptions = (id: string) => {
  return queryOptions({
    queryKey: ['graphics', id],
    queryFn: async () => {
      return apiClient.get<Graphic>(`graphics/${id}`, {
        schema: graphicSchema,
      });
    },
    enabled: !!id,
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Get Graphic Hook
 * Returns a single graphic by ID
 */
export const useGetGraphic = (id: string) => {
  const query = useQuery(getGraphicQueryOptions(id));

  return {
    graphic: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
