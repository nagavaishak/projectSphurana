import { apiClient } from '@borradh-workspace/api-client';
import { assistantConversationWithMessagesSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

import type { ConversationWithMessages } from '../../types';

export const conversationQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['assistant', 'conversations', id],
    queryFn: () =>
      apiClient.get<ConversationWithMessages>(`assistant/conversations/${id}`, {
        schema: assistantConversationWithMessagesSchema,
      }),
    enabled: !!id,
    staleTime: 60 * 1000,
  });

export const useConversation = (id: string) => {
  const query = useQuery(conversationQueryOptions(id));
  return {
    conversation: query.data ?? null,
    messages: query.data?.messages ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
