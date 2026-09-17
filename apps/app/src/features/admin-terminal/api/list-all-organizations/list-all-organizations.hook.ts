import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  memberCount: number;
  createdAt: string;
}

interface ListAllOrganizationsResponse {
  items: AdminOrganization[];
  total: number;
  limit: number;
  offset: number;
}

interface ListAllOrganizationsParams {
  search?: string;
  limit?: number;
  offset?: number;
}

export const listAllOrganizationsQueryOptions = (
  params: ListAllOrganizationsParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set('search', params.search);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['admin-terminal', 'organizations', params],
    queryFn: () =>
      apiClient.get<ListAllOrganizationsResponse>(
        `admin-terminal/organizations${qs ? `?${qs}` : ''}`
      ),
    staleTime: 30 * 1000,
  });
};

export const useListAllOrganizations = (
  params: ListAllOrganizationsParams = {}
) => {
  const query = useQuery(listAllOrganizationsQueryOptions(params));
  return {
    organizations: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export type { AdminOrganization, ListAllOrganizationsParams };
