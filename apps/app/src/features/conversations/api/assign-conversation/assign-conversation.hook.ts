import { apiClient } from '@borradh-workspace/api-client';
import { conversationSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Conversation } from '../types';

export const useAssignConversation = (options?: {
  onSuccess?: (conversation: Conversation) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      id,
      assignToUserId,
    }: {
      id: string;
      assignToUserId: string;
    }) =>
      apiClient.post<Conversation>(
        `conversations/${id}/assign`,
        { assignToUserId },
        { schema: conversationSchema }
      ),
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({
        queryKey: ['conversations', conversation.id],
      });
      toast.success('Conversation assigned');
      options?.onSuccess?.(conversation);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to assign conversation');
    },
  });

  return {
    assignConversation: mutation.mutate,
    assignConversationAsync: mutation.mutateAsync,
    isAssigning: mutation.isPending,
  };
};
