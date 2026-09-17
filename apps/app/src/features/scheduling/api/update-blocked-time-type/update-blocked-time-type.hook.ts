import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BlockedTimeType } from '../types';
import {
  type UpdateBlockedTimeTypeFormInput,
  buildUpdateBlockedTimeTypePayload,
} from './update-blocked-time-type.payload';

interface UseUpdateBlockedTimeTypeOptions {
  onSuccess?: (blockedTimeType: BlockedTimeType) => void;
  onError?: (error: Error) => void;
}

export const useUpdateBlockedTimeType = (
  options?: UseUpdateBlockedTimeTypeOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdateBlockedTimeTypeFormInput) => {
      const { id, body } = buildUpdateBlockedTimeTypePayload(input);
      return apiClient.put<BlockedTimeType>(`blocked-time-types/${id}`, body);
    },
    onSuccess: (blockedTimeType) => {
      queryClient.invalidateQueries({ queryKey: ['blocked-time-types'] });
      queryClient.invalidateQueries({ queryKey: ['blocked-time'] });
      toast.success('Blocked time type updated');
      options?.onSuccess?.(blockedTimeType);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update blocked time type');
      options?.onError?.(error);
    },
  });

  return {
    updateBlockedTimeType: mutation.mutate,
    updateBlockedTimeTypeAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
