import { apiClient } from '@borradh-workspace/api-client';
import { practitionerWageConfigSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { PractitionerWageConfig } from '../types';

export const getWageConfigQueryOptions = (practitionerId: string) =>
  queryOptions({
    queryKey: ['wage-config', practitionerId],
    queryFn: () =>
      apiClient.get<PractitionerWageConfig>(`wage-configs/${practitionerId}`, {
        schema: practitionerWageConfigSchema,
      }),
    enabled: !!practitionerId,
    staleTime: 5 * 60 * 1000,
  });

export const useGetWageConfig = (practitionerId: string) => {
  const query = useQuery(getWageConfigQueryOptions(practitionerId));
  return {
    wageConfig: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
