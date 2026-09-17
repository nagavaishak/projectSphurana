import { apiClient } from '@borradh-workspace/api-client';
import type { Lead, LeadStatus } from '@borradh-workspace/api-client/types';
import { leadSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Update Lead Status Hook
 * Updates the status of a lead (for kanban drag & drop)
 */
export const useUpdateLeadStatus = (options?: {
  onSuccess?: (lead: Lead) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      leadId,
      status,
    }: {
      leadId: string;
      status: LeadStatus;
    }) => {
      // The updated lead is validated against the lead atom schema (report mode).
      return apiClient.patch<Lead>(
        `leads/${leadId}/status`,
        { status },
        { schema: leadSchema }
      );
    },
    onSuccess: (lead) => {
      // Invalidate leads list and specific lead
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', lead.id] });
      toast.success('Client status updated');
      options?.onSuccess?.(lead);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update client status');
      options?.onError?.(error);
    },
  });

  return {
    updateLeadStatus: mutation.mutate,
    updateLeadStatusAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
