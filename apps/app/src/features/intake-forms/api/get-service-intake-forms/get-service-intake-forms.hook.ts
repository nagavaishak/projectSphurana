'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import type { GetServiceIntakeFormsResponse } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getServiceIntakeFormsQueryOptions = (serviceId: string) =>
  queryOptions({
    // Under the intake-forms root, so a set-service mutation's invalidation of
    // `intakeForms.all()` also refreshes a service's links.
    queryKey: queryKeys.intakeForms.serviceForms(serviceId),
    queryFn: () =>
      apiClient.get<GetServiceIntakeFormsResponse>(
        `intake-forms/services/${serviceId}/forms`
      ),
    enabled: !!serviceId,
    staleTime: 0,
  });

export const useGetServiceIntakeForms = (serviceId: string) => {
  const query = useQuery(getServiceIntakeFormsQueryOptions(serviceId));
  return {
    links: query.data?.forms ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
};
