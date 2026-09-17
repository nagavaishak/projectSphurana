import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ToggleWhatsappChatbotInput {
  accountId: string;
  enabled: boolean;
}

export const useToggleWhatsappChatbot = (options?: {
  onSuccess?: () => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ accountId, enabled }: ToggleWhatsappChatbotInput) =>
      apiClient.put<{ isChatbotActive: boolean }>(
        `integrations/whatsapp/${accountId}/chatbot`,
        { enabled }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      queryClient.invalidateQueries({ queryKey: ['organization'] });
      toast.success('WhatsApp chatbot updated');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update WhatsApp chatbot');
    },
  });

  return {
    toggleWhatsappChatbot: mutation.mutate,
    toggleWhatsappChatbotAsync: mutation.mutateAsync,
    isToggling: mutation.isPending,
  };
};
