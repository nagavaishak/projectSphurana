import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import type { Lead } from '@borradh-workspace/api-client/types';
import { leadSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateLeadFormValues } from '../../components/create-lead-schema';
import { buildCreateLeadPayload } from './create-lead.payload';

/**
 * Create Lead Hook
 * Creates a new lead entry
 */
export const useCreateLead = (options?: {
  onSuccess?: (lead: Lead) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Surfaces pass the shared form intent; the one builder assembles the body.
    mutationFn: async (input: CreateLeadFormValues) => {
      // The created lead is validated against the lead atom schema (report mode).
      return apiClient.post<Lead>('leads', buildCreateLeadPayload(input), {
        schema: leadSchema,
      });
    },
    onSuccess: (lead) => {
      trackEvent('lead_created');
      // Invalidate leads list
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Client created successfully');
      options?.onSuccess?.(lead);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create client');
      options?.onError?.(error);
    },
  });

  return {
    createLead: mutation.mutate,
    createLeadAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
