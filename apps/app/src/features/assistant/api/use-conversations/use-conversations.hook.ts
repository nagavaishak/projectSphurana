import { apiClient } from '@borradh-workspace/api-client';
import { listAssistantConversationsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

import type { ConversationSummary } from '../../types';

interface ConversationsResponse {
  conversations: ConversationSummary[];
}

export const conversationsQueryOptions = () =>
  queryOptions({
    queryKey: ['assistant', 'conversations'],
    queryFn: () =>
      apiClient.get<ConversationsResponse>('assistant/conversations', {
        schema: listAssistantConversationsResponseSchema,
      }),
    staleTime: 30 * 1000,
  });

export const useConversations = () => {
  const query = useQuery(conversationsQueryOptions());
  return {
    conversations: query.data?.conversations ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
