import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * One-click escalation of an assistant conversation to Borradh staff.
 * After this returns, `/assistant/chat` refuses further messages on the
 * conversation (see W3 controller guard). Banner + disabled input is W11's job.
 */
export const useEscalateConversation = (options?: {
  onSuccess?: (conversationId: string) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (conversationId: string) => {
      await apiClient.post(
        `assistant/conversations/${conversationId}/escalate`
      );
      return conversationId;
    },
    onSuccess: (conversationId) => {
      queryClient.invalidateQueries({
        queryKey: ['assistant', 'conversations', conversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ['assistant', 'conversations'],
      });
      options?.onSuccess?.(conversationId);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to escalate conversation');
      options?.onError?.(error);
    },
  });

  return {
    escalateConversation: mutation.mutate,
    escalateConversationAsync: mutation.mutateAsync,
    isEscalating: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
};
