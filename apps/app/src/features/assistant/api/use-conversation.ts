import { queryOptions, useQuery } from '@tanstack/react-query';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';
import type { ConversationWithMessages } from '../types';

export const conversationQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['assistant', 'conversations', id],
    queryFn: async (): Promise<ConversationWithMessages> => {
      const res = await fetch(
        assistantApiUrl(`conversations/${id}`),
        assistantRequestInit()
      );
      if (!res.ok) throw new Error('Failed to load conversation');
      return res.json();
    },
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
