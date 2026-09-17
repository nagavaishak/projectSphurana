import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import { practitionersForServiceResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const listPractitionersForServiceQueryOptions = (serviceId: string) =>
  queryOptions({
    queryKey: ['practitioners', 'for-service', serviceId],
    queryFn: () =>
      apiClient.get<PractitionerWithRelations[]>(
        `practitioners/for-service/${serviceId}`,
        { schema: practitionersForServiceResponseSchema }
      ),
    enabled: !!serviceId,
    staleTime: 60 * 1000,
  });

type UseListPractitionersForServiceOptions = {
  serviceId: string;
  queryConfig?: QueryConfig<typeof listPractitionersForServiceQueryOptions>;
};

export const useListPractitionersForService = ({
  serviceId,
  queryConfig,
}: UseListPractitionersForServiceOptions) => {
  const query = useQuery({
    ...listPractitionersForServiceQueryOptions(serviceId),
    ...queryConfig,
  });

  return {
    practitioners: query.data ?? ([] as PractitionerWithRelations[]),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
