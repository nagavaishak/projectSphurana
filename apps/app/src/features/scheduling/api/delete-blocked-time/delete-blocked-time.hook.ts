import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BlockedTimeEditScope } from '../types';

export interface DeleteBlockedTimeVariables {
  id: string;
  /** Delete scope for recurring series; defaults to 'all' server-side. */
  scope?: BlockedTimeEditScope;
  /** Occurrence identifier (RECURRENCE-ID) for scope='this'/'following'. */
  originalStart?: string;
}

interface UseDeleteBlockedTimeOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteBlockedTime = (options?: UseDeleteBlockedTimeOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, scope, originalStart }: DeleteBlockedTimeVariables) => {
      const searchParams = new URLSearchParams();
      if (scope) searchParams.set('scope', scope);
      if (originalStart) searchParams.set('originalStart', originalStart);
      const qs = searchParams.toString();
      return apiClient.delete<{ success: true }>(
        `blocked-time/${id}${qs ? `?${qs}` : ''}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-time'] });
      toast.success('Blocked time deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete blocked time');
      options?.onError?.(error);
    },
  });

  return {
    deleteBlockedTime: mutation.mutate,
    deleteBlockedTimeAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
