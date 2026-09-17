import { queryKeys } from '@/lib/query-keys';
import { trackEvent } from '@/lib/track-event';
import { apiClient } from '@borradh-workspace/api-client';
import type {
  ImportServicesCsvInput,
  ImportServicesCsvResponse,
} from '@borradh-workspace/api-client/types';
import { importServicesCsvResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseImportServicesCsvOptions {
  onSuccess?: (result: ImportServicesCsvResponse) => void;
  onError?: (error: Error) => void;
}

export const useImportServicesCsv = (options?: UseImportServicesCsvOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: ImportServicesCsvInput) =>
      apiClient.post<ImportServicesCsvResponse>(
        'organization-services/import-csv',
        input,
        { schema: importServicesCsvResponseSchema }
      ),
    onSuccess: (result) => {
      trackEvent('services_imported_csv', {
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        rowsInFile: result.rowsInFile,
      });
      // The import can also CREATE categories, and the services page renders
      // its category chips from a separate query — invalidating only
      // `services` would leave those chips naming nothing.
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizationServices.all(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.serviceCategories.all(),
      });

      const parts: string[] = [];
      if (result.imported > 0) parts.push(`${result.imported} added`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.skipped > 0) parts.push(`${result.skipped} already existed`);
      if (result.errors.length > 0)
        parts.push(`${result.errors.length} failed`);
      toast.success(
        parts.length > 0
          ? `Import complete: ${parts.join(', ')}`
          : 'Import complete'
      );
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to import the file');
      options?.onError?.(error);
    },
  });

  return {
    importServicesCsv: mutation.mutate,
    importServicesCsvAsync: mutation.mutateAsync,
    isImporting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
