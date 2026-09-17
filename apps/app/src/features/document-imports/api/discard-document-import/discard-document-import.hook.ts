import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { documentImportKeys } from '../keys';

export const useDiscardDocumentImport = (options?: {
  onSuccess?: () => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (importId: string) =>
      apiClient.delete<{ success: true }>(`document-imports/${importId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentImportKeys.all });
      toast.success('Document discarded');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to discard document');
    },
  });

  return {
    discardDocumentImport: mutation.mutate,
    isDiscarding: mutation.isPending,
    discardingId: mutation.isPending ? mutation.variables : null,
  };
};
