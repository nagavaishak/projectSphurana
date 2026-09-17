import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import type {
  ListPractitionersParams,
  ListPractitionersResponse,
  PractitionerWithRelations,
} from '@borradh-workspace/api-client/types';
import { listPractitionersResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const listPractitionersQueryOptions = (
  params: Partial<ListPractitionersParams> = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.isActive !== undefined)
    searchParams.set('isActive', String(params.isActive));
  // Booking surfaces opt in; team management and the shift roster do not, so
  // an invited member stays visible where you manage them and disappears where
  // you would book against them (ENG-794).
  if (params.bookable !== undefined)
    searchParams.set('bookable', String(params.bookable));
  if (params.search) searchParams.set('search', params.search);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['practitioners', 'list', params],
    queryFn: () =>
      apiClient.get<ListPractitionersResponse>(
        `practitioners${qs ? `?${qs}` : ''}`,
        { schema: listPractitionersResponseSchema }
      ),
    staleTime: 60 * 1000,
  });
};

type UseListPractitionersOptions = {
  params?: Partial<ListPractitionersParams>;
  queryConfig?: QueryConfig<typeof listPractitionersQueryOptions>;
};

export const useListPractitioners = ({
  params = {},
  queryConfig,
}: UseListPractitionersOptions = {}) => {
  const query = useQuery({
    ...listPractitionersQueryOptions(params),
    ...queryConfig,
  });

  return {
    practitioners: query.data?.items ?? ([] as PractitionerWithRelations[]),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
