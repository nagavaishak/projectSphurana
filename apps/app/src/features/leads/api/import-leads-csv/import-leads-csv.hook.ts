import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import type {
  ImportLeadsCsvInput,
  ImportLeadsCsvResponse,
} from '@borradh-workspace/api-client/types';
import { importLeadsCsvResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseImportLeadsCsvOptions {
  onSuccess?: (result: ImportLeadsCsvResponse) => void;
  onError?: (error: Error) => void;
}

export const useImportLeadsCsv = (options?: UseImportLeadsCsvOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: ImportLeadsCsvInput) => {
      // The CSV import summary is validated against the projection (report mode).
      return apiClient.post<ImportLeadsCsvResponse>('leads/import-csv', input, {
        schema: importLeadsCsvResponseSchema,
      });
    },
    onSuccess: (result) => {
      trackEvent('leads_imported_csv', {
        imported: result.imported,
        skipped: result.skipped,
        rowsInFile: result.rowsInFile,
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
      toast.error(error.message || 'Failed to import the file');
      options?.onError?.(error);
    },
  });

  return {
    importCsv: mutation.mutate,
    importCsvAsync: mutation.mutateAsync,
    isImporting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
