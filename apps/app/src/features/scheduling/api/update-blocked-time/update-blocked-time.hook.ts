import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  BlockedTimeEditScope,
  BlockedTimeWithPractitioners,
  UpdateBlockedTimeInput,
} from '../types';

interface UpdateBlockedTimeVariables extends UpdateBlockedTimeInput {
  id: string;
  /** Edit scope for recurring series; defaults to 'all' server-side. */
  scope?: BlockedTimeEditScope;
}

interface UseUpdateBlockedTimeOptions {
  onSuccess?: (blockedTime: BlockedTimeWithPractitioners) => void;
  onError?: (error: Error) => void;
}

export const useUpdateBlockedTime = (options?: UseUpdateBlockedTimeOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, scope, ...input }: UpdateBlockedTimeVariables) => {
      const qs = scope ? `?scope=${scope}` : '';
      return apiClient.put<BlockedTimeWithPractitioners>(
        `blocked-time/${id}${qs}`,
        input
      );
    },
    onSuccess: (blockedTime) => {
      queryClient.invalidateQueries({ queryKey: ['blocked-time'] });
      toast.success('Blocked time updated');
      options?.onSuccess?.(blockedTime);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update blocked time');
      options?.onError?.(error);
    },
  });

  return {
    updateBlockedTime: mutation.mutate,
    updateBlockedTimeAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
