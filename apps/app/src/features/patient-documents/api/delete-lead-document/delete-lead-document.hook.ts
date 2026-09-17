import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { queryKeys } from '@/lib/query-keys';

import { patientDocumentKeys } from '../keys';

/**
 * Staff-only soft delete. Patients cannot delete vault entries in v1 — the
 * patient API has no delete route.
 */
export const useDeleteLeadDocument = (
  leadId: string,
  options?: { onSuccess?: () => void; onError?: (error: Error) => void }
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (documentId: string) =>
      apiClient.delete(`leads/${leadId}/documents/${documentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: patientDocumentKeys.lead(leadId),
      });
      // The staff Documents tab renders from the lead PROFILE query — without
      // this the deleted row stays on screen until a manual reload.
      queryClient.invalidateQueries({
        queryKey: queryKeys.leads.profile(leadId),
      });
      toast.success('Document deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete document');
      options?.onError?.(error);
    },
  });

  return {
    deleteDocument: mutation.mutate,
    deleteDocumentAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
