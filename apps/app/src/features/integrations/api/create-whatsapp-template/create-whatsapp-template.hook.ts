import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface CreateWhatsAppTemplateInput {
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  body: string;
  headerText?: string;
  footerText?: string;
}

export const useCreateWhatsAppTemplate = (
  accountId: string,
  options?: { onSuccess?: () => void }
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateWhatsAppTemplateInput) =>
      apiClient.post<{ template: { id: string; status: string } }>(
        `integrations/whatsapp/accounts/${accountId}/templates`,
        input
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['integrations', 'whatsapp', 'templates', accountId],
      });
      toast.success('Template created');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create template');
    },
  });

  return {
    createTemplate: mutation.mutate,
    isCreating: mutation.isPending,
  };
};
