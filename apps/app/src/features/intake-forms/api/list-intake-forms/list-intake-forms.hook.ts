'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListIntakeFormsResponse } from '../types';

interface ListIntakeFormsParams {
  includeInactive?: boolean;
}

export const listIntakeFormsQueryOptions = (
  params: ListIntakeFormsParams = {}
) => {
  const search = new URLSearchParams();
  if (params.includeInactive) search.set('includeInactive', 'true');
  const qs = search.toString();

  return queryOptions({
    queryKey: queryKeys.intakeForms.list(params),
    queryFn: () =>
      apiClient.get<ListIntakeFormsResponse>(
        `intake-forms${qs ? `?${qs}` : ''}`
      ),
    staleTime: 60 * 1000,
  });
};

export const useListIntakeForms = (params: ListIntakeFormsParams = {}) => {
  const query = useQuery(listIntakeFormsQueryOptions(params));
  return {
    forms: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
