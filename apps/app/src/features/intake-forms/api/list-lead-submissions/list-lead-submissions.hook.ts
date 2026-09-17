'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListLeadSubmissionsResponse } from '../types';

export const listLeadSubmissionsQueryOptions = (leadId: string) =>
  queryOptions({
    queryKey: queryKeys.intakeForms.leadSubmissions(leadId),
    queryFn: () =>
      apiClient.get<ListLeadSubmissionsResponse>(
        `intake-forms/submissions/lead/${leadId}`
      ),
    enabled: !!leadId,
    staleTime: 60 * 1000,
  });

export const useListLeadSubmissions = (leadId: string) => {
  const query = useQuery(listLeadSubmissionsQueryOptions(leadId));
  return {
    submissions: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
