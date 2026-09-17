import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { documentImportKeys } from '../keys';

/**
 * Clear the documents already dealt with (ENG-784).
 *
 * Only matched and failed rows go — the list is append-only otherwise, so the
 * few that need a decision end up buried under every import ever made. The
 * filed copies in each client's documents are untouched.
 */
export const useClearDocumentImports = (options?: {
  onSuccess?: () => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.delete<{ cleared: number }>('document-imports/settled'),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: documentImportKeys.all });
      const cleared = result?.cleared ?? 0;
      toast.success(
        cleared === 1 ? 'Cleared 1 document' : `Cleared ${cleared} documents`
      );
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not clear the list');
    },
  });

  return {
    clearDocumentImports: mutation.mutate,
    isClearing: mutation.isPending,
  };
};
