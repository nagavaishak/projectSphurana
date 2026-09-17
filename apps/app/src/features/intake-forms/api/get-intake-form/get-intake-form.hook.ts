'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { IntakeForm } from '../types';

export const getIntakeFormQueryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.intakeForms.detail(id),
    queryFn: () => apiClient.get<IntakeForm>(`intake-forms/${id}`),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

export const useGetIntakeForm = (id: string) => {
  const query = useQuery(getIntakeFormQueryOptions(id));
  return {
    form: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
