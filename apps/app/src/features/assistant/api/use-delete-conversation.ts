import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';

interface UseDeleteConversationOptions {
  onSuccess?: () => void;
}

export const useDeleteConversation = (
  options?: UseDeleteConversationOptions
) => {
  const queryClient = useQueryClient();
  const onSuccessRef = useRef(options?.onSuccess);

  useEffect(() => {
    onSuccessRef.current = options?.onSuccess;
  }, [options?.onSuccess]);

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        assistantApiUrl(`conversations/${id}`),
        assistantRequestInit({ method: 'DELETE' })
      );
      if (!res.ok) throw new Error('Failed to delete conversation');
      return res.json();
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({
        queryKey: ['assistant', 'conversations', id],
      });
      queryClient.invalidateQueries({
        queryKey: ['assistant', 'conversations'],
      });
      toast.success('Conversation deleted');
      onSuccessRef.current?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete conversation');
    },
  });

  return {
    deleteConversation: mutation.mutate,
    deleteConversationAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
