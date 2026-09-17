import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface TogglePageChatbotInput {
  pageId: string;
  enabled: boolean;
}

export const useTogglePageChatbot = (options?: {
  onSuccess?: () => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ pageId, enabled }: TogglePageChatbotInput) =>
      apiClient.put<{ isChatbotActive: boolean }>(
        `integrations/meta-ads-pages/${pageId}/chatbot`,
        { enabled }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      queryClient.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Page chatbot updated');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update page chatbot');
    },
  });

  return {
    togglePageChatbot: mutation.mutate,
    togglePageChatbotAsync: mutation.mutateAsync,
    isToggling: mutation.isPending,
  };
};
