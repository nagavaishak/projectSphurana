import { apiClient } from '@borradh-workspace/api-client';
import { conversationSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Conversation } from '../types';

export const useCloseConversation = (options?: {
  onSuccess?: (conversation: Conversation) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Conversation>(`conversations/${id}/close`, undefined, {
        schema: conversationSchema,
      }),
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Conversation closed');
      options?.onSuccess?.(conversation);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to close conversation');
    },
  });

  return {
    closeConversation: mutation.mutate,
    closeConversationAsync: mutation.mutateAsync,
    isClosing: mutation.isPending,
  };
};
