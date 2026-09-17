import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { LeadFormStatus, ListLeadFormsResponse } from '../types';

interface ListLeadFormsParams {
  limit?: number;
  offset?: number;
  status?: LeadFormStatus;
}

export const listLeadFormsQueryOptions = (params?: ListLeadFormsParams) => {
  const queryParams = new URLSearchParams();
  if (params?.limit) queryParams.set('limit', params.limit.toString());
  if (params?.offset) queryParams.set('offset', params.offset.toString());
  if (params?.status) queryParams.set('status', params.status);
  const queryString = queryParams.toString();

  return queryOptions({
    queryKey: ['lead-forms', params?.limit, params?.offset, params?.status],
    queryFn: async () => {
      return apiClient.get<ListLeadFormsResponse>(
        `lead-forms${queryString ? `?${queryString}` : ''}`
      );
    },
    staleTime: 30 * 1000,
  });
};

export const useListLeadForms = (params?: ListLeadFormsParams) => {
  const query = useQuery(listLeadFormsQueryOptions(params));

  return {
    leadForms: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
