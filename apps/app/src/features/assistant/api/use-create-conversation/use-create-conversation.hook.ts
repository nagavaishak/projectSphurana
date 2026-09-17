import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface CreateConversationResult {
  id: string;
}

interface UseCreateConversationOptions {
  onSuccess?: (result: CreateConversationResult) => void;
}

export const useCreateConversation = (
  options?: UseCreateConversationOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input?: { title?: string }) =>
      apiClient.post<CreateConversationResult>(
        'assistant/conversations',
        input ?? {}
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ['assistant', 'conversations'],
      });
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create conversation');
    },
  });

  return {
    createConversation: mutation.mutate,
    createConversationAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
