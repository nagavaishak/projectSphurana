import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  UpdateChatbotSettingsInput,
  UpdateChatbotSettingsResponse,
} from '../types';

export const useUpdateChatbotSettings = (options?: {
  onSuccess?: (response: UpdateChatbotSettingsResponse) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      organizationId,
      ...input
    }: UpdateChatbotSettingsInput & { organizationId: string }) =>
      apiClient.put<UpdateChatbotSettingsResponse>(
        `organizations/${organizationId}/chatbot-settings`,
        input
      ),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Chatbot settings updated');
      options?.onSuccess?.(response);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update chatbot settings');
    },
  });

  return {
    updateChatbotSettings: mutation.mutate,
    updateChatbotSettingsAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
