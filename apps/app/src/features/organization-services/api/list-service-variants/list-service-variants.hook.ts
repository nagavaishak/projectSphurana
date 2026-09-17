'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  type ListServiceVariantsResponseShape,
  listServiceVariantsResponseSchema,
} from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const listServiceVariantsQueryOptions = (serviceId: string) =>
  queryOptions({
    queryKey: queryKeys.organizationServices.variants(serviceId),
    queryFn: () =>
      apiClient.get<ListServiceVariantsResponseShape>(
        `organization-services/${serviceId}/variants`,
        { schema: listServiceVariantsResponseSchema }
      ),
    enabled: !!serviceId,
    staleTime: 5 * 60 * 1000,
  });

export const useListServiceVariants = (serviceId: string) => {
  const query = useQuery(listServiceVariantsQueryOptions(serviceId));
  return {
    variants: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
