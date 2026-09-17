import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListGraphicTemplatesResponse } from '../types';

/**
 * Query options for the curated graphic style pick-list
 * (`GET /graphics/templates`). Registry-backed and static per deploy, so a
 * long staleTime is safe.
 */
export const listGraphicTemplatesQueryOptions = (
  usageType: 'organic' | 'ad' = 'organic'
) =>
  queryOptions({
    queryKey: queryKeys.graphics.templates(usageType),
    queryFn: async () =>
      apiClient.get<ListGraphicTemplatesResponse>(
        `graphics/templates?usageType=${usageType}`
      ),
    staleTime: 60 * 60 * 1000, // 1 hour — the registry only changes on deploy
  });

/**
 * List Graphic Templates Hook
 *
 * Curated style summaries for the generate-graphic dialog's style picker.
 */
export const useListGraphicTemplates = (
  usageType: 'organic' | 'ad' = 'organic'
) => {
  const query = useQuery(listGraphicTemplatesQueryOptions(usageType));

  return {
    templates: query.data?.templates ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
