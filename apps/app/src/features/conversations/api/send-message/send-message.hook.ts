import { apiClient } from '@borradh-workspace/api-client';
import { conversationMessageSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ConversationMessage, SendMessageInput } from '../types';

export const useSendMessage = (options?: {
  onSuccess?: (message: ConversationMessage) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      conversationId,
      ...input
    }: SendMessageInput & { conversationId: string }) =>
      apiClient.post<ConversationMessage>(
        `conversations/${conversationId}/messages`,
        input,
        { schema: conversationMessageSchema }
      ),
    onSuccess: (message, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['conversations', variables.conversationId, 'messages'],
      });
      queryClient.invalidateQueries({
        queryKey: ['conversations', 'list'],
      });
      options?.onSuccess?.(message);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to send message');
    },
  });

  return {
    sendMessage: mutation.mutate,
    sendMessageAsync: mutation.mutateAsync,
    isSending: mutation.isPending,
  };
};
