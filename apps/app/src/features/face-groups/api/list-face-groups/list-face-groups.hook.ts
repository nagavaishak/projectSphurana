import { apiClient } from '@borradh-workspace/api-client';
import { listFaceGroupsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface FaceGroupListItem {
  id: string;
  clientName: string | null;
  clientNotes: string | null;
  serviceId: string | null;
  serviceName: string | null;
  createdAt: string;
}

interface ListFaceGroupsResponse {
  items: FaceGroupListItem[];
  total: number;
  limit: number;
  offset: number;
}

interface ListFaceGroupsParams {
  serviceId?: string;
  limit?: number;
  offset?: number;
}

export const listFaceGroupsQueryOptions = (
  params: ListFaceGroupsParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.serviceId) searchParams.set('serviceId', params.serviceId);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['face-groups', 'list', params],
    queryFn: () =>
      apiClient.get<ListFaceGroupsResponse>(
        `face-groups${qs ? `?${qs}` : ''}`,
        {
          schema: listFaceGroupsResponseSchema,
        }
      ),
    staleTime: 30 * 1000,
  });
};

export const useListFaceGroups = (params: ListFaceGroupsParams = {}) => {
  const query = useQuery(listFaceGroupsQueryOptions(params));
  return {
    faceGroups: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export type { FaceGroupListItem, ListFaceGroupsResponse };
