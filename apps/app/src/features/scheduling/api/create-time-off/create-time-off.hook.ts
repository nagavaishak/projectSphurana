import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TimeOff } from '../types';
import {
  type CreateTimeOffFormInput,
  buildCreateTimeOffPayload,
} from './create-time-off.payload';

interface UseCreateTimeOffOptions {
  onSuccess?: (timeOff: TimeOff) => void;
  onError?: (error: Error) => void;
}

export const useCreateTimeOff = (options?: UseCreateTimeOffOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateTimeOffFormInput) =>
      apiClient.post<TimeOff>('time-off', buildCreateTimeOffPayload(input)),
    onSuccess: (timeOff) => {
      queryClient.invalidateQueries({ queryKey: ['time-off'] });
      toast.success('Time off added');
      options?.onSuccess?.(timeOff);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add time off');
      options?.onError?.(error);
    },
  });

  return {
    createTimeOff: mutation.mutate,
    createTimeOffAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
