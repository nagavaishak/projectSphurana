import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import { practitionerWithRelationsSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getPractitionerQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['practitioners', id],
    queryFn: () =>
      apiClient.get<PractitionerWithRelations>(`practitioners/${id}`, {
        schema: practitionerWithRelationsSchema,
      }),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

type UseGetPractitionerOptions = {
  id: string;
  queryConfig?: QueryConfig<typeof getPractitionerQueryOptions>;
};

export const useGetPractitioner = ({
  id,
  queryConfig,
}: UseGetPractitionerOptions) => {
  const query = useQuery({
    ...getPractitionerQueryOptions(id),
    ...queryConfig,
  });

  return {
    practitioner: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
