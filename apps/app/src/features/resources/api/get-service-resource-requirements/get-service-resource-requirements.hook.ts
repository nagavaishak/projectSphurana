import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ServiceResourceRequirements } from '../types';

export const serviceResourceRequirementsQueryOptions = (serviceId: string) =>
  queryOptions({
    queryKey: queryKeys.resources.requirements(serviceId),
    queryFn: () =>
      apiClient.get<ServiceResourceRequirements>(
        `resources/requirements/${serviceId}`
      ),
    enabled: !!serviceId,
    staleTime: 5 * 60 * 1000,
  });

/**
 * The resource requirements for one service ("a Facial needs a Treatment Room
 * from {A, B}"), plus its turnaround buffer.
 *
 * An EMPTY `eligibleResourceIds` on a requirement means "any resource in this
 * category" — not "none". See the note on
 * `SetServiceResourceRequirementsInput` in api-client.
 */
export const useServiceResourceRequirements = (serviceId: string) => {
  const query = useQuery(serviceResourceRequirementsQueryOptions(serviceId));
  return {
    requirements: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
