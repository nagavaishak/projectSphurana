import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BlockedTimeType } from '../types';
import {
  type CreateBlockedTimeTypeFormInput,
  buildCreateBlockedTimeTypePayload,
} from './create-blocked-time-type.payload';

interface UseCreateBlockedTimeTypeOptions {
  onSuccess?: (blockedTimeType: BlockedTimeType) => void;
  onError?: (error: Error) => void;
}

export const useCreateBlockedTimeType = (
  options?: UseCreateBlockedTimeTypeOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateBlockedTimeTypeFormInput) =>
      apiClient.post<BlockedTimeType>(
        'blocked-time-types',
        buildCreateBlockedTimeTypePayload(input)
      ),
    onSuccess: (blockedTimeType) => {
      queryClient.invalidateQueries({ queryKey: ['blocked-time-types'] });
      toast.success('Blocked time type created');
      options?.onSuccess?.(blockedTimeType);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create blocked time type');
      options?.onError?.(error);
    },
  });

  return {
    createBlockedTimeType: mutation.mutate,
    createBlockedTimeTypeAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
