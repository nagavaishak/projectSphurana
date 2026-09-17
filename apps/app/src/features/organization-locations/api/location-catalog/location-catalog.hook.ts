'use client';

import { apiClient } from '@borradh-workspace/api-client';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { queryKeys } from '@/lib/query-keys';

/**
 * The ids EXPLICITLY assigned to one branch.
 *
 * An id being ABSENT here does not mean the entity is unavailable at the
 * branch: an entity assigned to no branch at all is available at every one.
 * That asymmetry is why the editor reads this rather than the location-filtered
 * list endpoints — saving those back would restrict the whole catalogue to this
 * branch. See `locationCatalogSeedRequestSchema`.
 */
export interface LocationCatalog {
  practitionerIds: string[];
  serviceIds: string[];
  productIds: string[];
  membershipPlanIds: string[];
  offerIds: string[];
}

export const locationCatalogQueryOptions = (locationId: string) =>
  queryOptions({
    queryKey: queryKeys.organizationLocations.catalog(locationId),
    queryFn: () =>
      apiClient.get<LocationCatalog>(
        `organization-locations/${locationId}/catalog`
      ),
    enabled: !!locationId,
  });

export const useGetLocationCatalog = (locationId: string) => {
  const query = useQuery(locationCatalogQueryOptions(locationId));
  return {
    catalog: query.data ?? null,
    isLoading: Boolean(locationId) && query.isLoading,
    isError: query.isError,
  };
};

export const useApplyLocationCatalog = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      locationId,
      ...body
    }: Partial<LocationCatalog> & {
      locationId: string;
      copyFromLocationId?: string | null;
    }) =>
      apiClient.put<unknown>(
        `organization-locations/${locationId}/catalog`,
        body
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizationLocations.catalog(variables.locationId),
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save the branch's catalogue");
    },
  });

  return {
    applyLocationCatalog: mutation.mutate,
    applyLocationCatalogAsync: mutation.mutateAsync,
    isApplying: mutation.isPending,
  };
};
