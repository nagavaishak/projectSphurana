import { apiClient } from '@borradh-workspace/api-client';
import type { Lead } from '@borradh-workspace/api-client/types';
import { leadSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type UpdateLeadIntent,
  buildUpdateLeadPayload,
} from './update-lead.payload';

/**
 * Update Lead Hook
 * Updates an existing lead
 */
export const useUpdateLead = (options?: {
  onSuccess?: (lead: Lead) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Surfaces pass the shared form intent; the one builder assembles the body.
    //
    // The intent is a PARTIAL: a surface that edits one field passes one field
    // and the rest are left untouched server-side. A surface that edits the
    // whole record passes the whole record, exactly as before. See
    // `buildUpdateLeadPayload` for why sending fields you are not editing is
    // not a harmless no-op (ENG-791).
    mutationFn: async ({
      leadId,
      input,
    }: {
      leadId: string;
      input: UpdateLeadIntent;
    }) => {
      // Backend exposes the full-update route as PUT /leads/:id (PATCH is only
      // for /:id/status), so a PATCH here 404s with "Cannot PATCH /leads/...".
      // The updated lead is validated against the lead atom schema (report mode).
      return apiClient.put<Lead>(
        `leads/${leadId}`,
        buildUpdateLeadPayload(input),
        {
          schema: leadSchema,
        }
      );
    },
    onSuccess: (lead) => {
      // Invalidate leads list and specific lead
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', lead.id] });
      toast.success('Client updated successfully');
      options?.onSuccess?.(lead);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update client');
      options?.onError?.(error);
    },
  });

  return {
    updateLead: mutation.mutate,
    updateLeadAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
