import { apiClient } from '@borradh-workspace/api-client';
import { conversationSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Conversation } from '../types';

export const getConversationQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['conversations', id],
    queryFn: () =>
      apiClient.get<Conversation>(`conversations/${id}`, {
        schema: conversationSchema,
      }),
    enabled: !!id,
    staleTime: 30 * 1000,
  });

export const useGetConversation = (id: string) => {
  const query = useQuery(getConversationQueryOptions(id));
  return {
    conversation: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
