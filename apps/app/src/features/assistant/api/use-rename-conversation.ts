import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';
import type { ConversationSummary } from '../types';

interface RenameInput {
  id: string;
  title: string;
}

interface UseRenameConversationOptions {
  onSuccess?: () => void;
}

export const useRenameConversation = (
  options?: UseRenameConversationOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ id, title }: RenameInput) => {
      const res = await fetch(
        assistantApiUrl(`conversations/${id}`),
        assistantRequestInit({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })
      );
      if (!res.ok) throw new Error('Failed to rename conversation');
      return res.json();
    },
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({
        queryKey: ['assistant', 'conversations'],
      });

      const previous = queryClient.getQueryData<{
        conversations: ConversationSummary[];
      }>(['assistant', 'conversations']);

      queryClient.setQueryData<{ conversations: ConversationSummary[] }>(
        ['assistant', 'conversations'],
        (old) => {
          if (!old) return old;
          return {
            conversations: old.conversations.map((c) =>
              c.id === id ? { ...c, title } : c
            ),
          };
        }
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ['assistant', 'conversations'],
          context.previous
        );
      }
      toast.error('Failed to rename conversation');
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['assistant', 'conversations'],
      });
      options?.onSuccess?.();
    },
  });

  return {
    renameConversation: mutation.mutate,
    renameConversationAsync: mutation.mutateAsync,
    isRenaming: mutation.isPending,
  };
};
