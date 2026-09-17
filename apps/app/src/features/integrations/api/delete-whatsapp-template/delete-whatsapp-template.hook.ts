import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listWhatsAppTemplatesQueryOptions } from '../list-whatsapp-templates';

export const useDeleteWhatsAppTemplate = (
  accountId: string,
  options?: { onSuccess?: () => void }
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (templateName: string) =>
      apiClient.delete<{ success: boolean }>(
        `integrations/whatsapp/accounts/${accountId}/templates/${encodeURIComponent(templateName)}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: listWhatsAppTemplatesQueryOptions(accountId).queryKey,
      });
      toast.success('Template deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete template');
    },
  });

  return {
    deleteTemplate: mutation.mutate,
    isDeleting: mutation.isPending,
    deletingTemplateName: mutation.isPending ? mutation.variables : undefined,
  };
};
