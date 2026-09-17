import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { patientDocumentKeys } from '@/features/patient-documents/api/keys';
import { queryKeys } from '@/lib/query-keys';

import { documentImportKeys } from '../keys';
import type { DocumentImportItem } from '../types';

/**
 * Staff pick the client for an import the matcher declined. On success the
 * file is in that client's vault, so the vault + profile caches are
 * invalidated alongside the import list.
 */
export const useAssignDocumentImport = (options?: {
  onSuccess?: (item: DocumentImportItem) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ importId, leadId }: { importId: string; leadId: string }) =>
      apiClient.post<DocumentImportItem>(
        `document-imports/${importId}/assign`,
        { leadId }
      ),
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: documentImportKeys.all });
      if (item.matchedLeadId) {
        queryClient.invalidateQueries({
          queryKey: patientDocumentKeys.lead(item.matchedLeadId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.leads.profile(item.matchedLeadId),
        });
      }
      toast.success(
        item.matchedLeadName
          ? `Attached to ${item.matchedLeadName}`
          : 'Document attached'
      );
      options?.onSuccess?.(item);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to attach document');
    },
  });

  return {
    assignDocumentImport: mutation.mutate,
    assignDocumentImportAsync: mutation.mutateAsync,
    isAssigning: mutation.isPending,
    assigningId: mutation.isPending ? mutation.variables?.importId : null,
  };
};
