import { apiClient } from '@borradh-workspace/api-client';
import { listConversationsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type {
  ListConversationsParams,
  ListConversationsResponse,
} from '../types';

type ListConversationsHookParams = Partial<ListConversationsParams>;

export const listConversationsQueryOptions = (
  params: ListConversationsHookParams = {}
) => {
  const resolved: ListConversationsParams = {
    ...params,
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
  };
  const searchParams = new URLSearchParams();
  if (resolved.status) searchParams.set('status', resolved.status);
  if (resolved.limit) searchParams.set('limit', String(resolved.limit));
  if (resolved.offset) searchParams.set('offset', String(resolved.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['conversations', 'list', resolved],
    queryFn: () =>
      apiClient.get<ListConversationsResponse>(
        `conversations${qs ? `?${qs}` : ''}`,
        { schema: listConversationsResponseSchema }
      ),
    staleTime: 30 * 1000,
  });
};

export const useListConversations = (
  params: ListConversationsHookParams = {},
  options: { enabled?: boolean } = {}
) => {
  const query = useQuery({
    ...listConversationsQueryOptions(params),
    enabled: options.enabled,
  });
  return {
    conversations: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};
