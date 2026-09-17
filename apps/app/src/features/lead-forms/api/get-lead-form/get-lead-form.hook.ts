import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { LeadForm } from '../types';

export const getLeadFormQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['lead-forms', id],
    queryFn: async () => {
      return apiClient.get<LeadForm>(`lead-forms/${id}`);
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

export const useGetLeadForm = (id: string) => {
  const query = useQuery(getLeadFormQueryOptions(id));

  return {
    leadForm: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
