import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';

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
    mutationFn: async (input?: {
      title?: string;
    }): Promise<CreateConversationResult> => {
      const res = await fetch(
        assistantApiUrl('conversations'),
        assistantRequestInit({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input ?? {}),
        })
      );
      if (!res.ok) throw new Error('Failed to create conversation');
      return res.json();
    },
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
