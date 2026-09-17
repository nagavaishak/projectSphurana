import { queryOptions, useQuery } from '@tanstack/react-query';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';
import type { ConversationSummary } from '../types';

interface ConversationsResponse {
  conversations: ConversationSummary[];
}

export const conversationsQueryOptions = () =>
  queryOptions({
    queryKey: ['assistant', 'conversations'],
    queryFn: async (): Promise<ConversationsResponse> => {
      const res = await fetch(
        assistantApiUrl('conversations'),
        assistantRequestInit()
      );
      if (!res.ok) throw new Error('Failed to load conversations');
      return res.json();
    },
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
