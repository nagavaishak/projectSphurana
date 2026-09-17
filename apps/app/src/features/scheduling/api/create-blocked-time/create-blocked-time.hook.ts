import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  BlockedTimeWithPractitioners,
  CreateBlockedTimeInput,
} from '../types';

interface UseCreateBlockedTimeOptions {
  onSuccess?: (blockedTime: BlockedTimeWithPractitioners) => void;
  onError?: (error: Error) => void;
}

export const useCreateBlockedTime = (options?: UseCreateBlockedTimeOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateBlockedTimeInput) =>
      apiClient.post<BlockedTimeWithPractitioners>('blocked-time', input),
    onSuccess: (blockedTime) => {
      queryClient.invalidateQueries({ queryKey: ['blocked-time'] });
      toast.success('Blocked time added');
      options?.onSuccess?.(blockedTime);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add blocked time');
      options?.onError?.(error);
    },
  });

  return {
    createBlockedTime: mutation.mutate,
    createBlockedTimeAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
