import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import type {
  ImportLeadsInput,
  ImportLeadsResponse,
} from '@borradh-workspace/api-client/types';
import { importLeadsResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseImportLeadsOptions {
  onSuccess?: (result: ImportLeadsResponse) => void;
  onError?: (error: Error) => void;
}

export const useImportLeads = (options?: UseImportLeadsOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: ImportLeadsInput) => {
      // The import summary is validated against the projection (report mode).
      return apiClient.post<ImportLeadsResponse>('leads/import', input, {
        schema: importLeadsResponseSchema,
      });
    },
    onSuccess: (result) => {
      trackEvent('leads_imported', {
        imported: result.imported,
        skipped: result.skipped,
      });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      const parts: string[] = [];
      if (result.imported > 0) parts.push(`${result.imported} imported`);
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.errors.length > 0)
        parts.push(`${result.errors.length} errors`);
      toast.success(`Import complete: ${parts.join(', ')}`);
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to import clients');
      options?.onError?.(error);
    },
  });

  return {
    importLeads: mutation.mutate,
    importLeadsAsync: mutation.mutateAsync,
    isImporting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
