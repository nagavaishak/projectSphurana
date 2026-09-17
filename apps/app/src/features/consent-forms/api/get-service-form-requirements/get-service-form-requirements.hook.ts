import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

import type {
  ServiceFormRequirement,
  ServiceFormRequirementsResponse,
} from '../types';

/** Backend built in parallel — if the path moves, adjust it here only. */
const endpoint = (serviceId: string) =>
  `consent-form-templates/organization-services-form-requirements/${serviceId}`;

/**
 * Stable empty fallback. Returning a fresh `[]` on every render (while the
 * query is loading) gives `requirements` a new identity each time, which
 * cascades through a `useMemo([requirements])` → `useEffect([serverIds])` →
 * `setState` in the consumer and spins an infinite render loop. One shared
 * reference keeps identity stable until real data arrives.
 */
const EMPTY_REQUIREMENTS: ServiceFormRequirement[] = [];

export const getServiceFormRequirementsQueryOptions = (serviceId: string) =>
  queryOptions({
    queryKey: queryKeys.consentFormTemplates.serviceRequirements(serviceId),
    queryFn: () =>
      apiClient.get<ServiceFormRequirementsResponse>(endpoint(serviceId)),
    enabled: !!serviceId,
    staleTime: 60 * 1000,
  });

export const useGetServiceFormRequirements = (serviceId: string) => {
  const query = useQuery(getServiceFormRequirementsQueryOptions(serviceId));

  return {
    requirements: query.data?.items ?? EMPTY_REQUIREMENTS,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
