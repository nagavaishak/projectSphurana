import { apiClient } from '@borradh-workspace/api-client';
import type { Practitioner } from '@borradh-workspace/api-client/types';
import { practitionerForUserResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/** Practitioner with nested service relations from GET /practitioners/me */
interface PractitionerForUser extends Practitioner {
  services?: { service: { id: string; name: string } }[];
  calendarAccount?: { id: string; email: string } | null;
}

export const getPractitionerForUserQueryOptions = () =>
  queryOptions({
    queryKey: ['practitioners', 'me'],
    queryFn: () =>
      apiClient.get<PractitionerForUser>('practitioners/me', {
        schema: practitionerForUserResponseSchema,
      }),
    retry: false,
  });

export const useGetPractitionerForUser = () => {
  const query = useQuery(getPractitionerForUserQueryOptions());
  return {
    practitioner: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
