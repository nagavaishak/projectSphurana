import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

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
    mutationFn: (id: string) =>
      apiClient.delete(`assistant/conversations/${id}`),
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
