import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TimeOff } from '../types';
import {
  type UpdateTimeOffFormInput,
  buildUpdateTimeOffPayload,
} from './update-time-off.payload';

interface UseUpdateTimeOffOptions {
  onSuccess?: (timeOff: TimeOff) => void;
  onError?: (error: Error) => void;
}

export const useUpdateTimeOff = (options?: UseUpdateTimeOffOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdateTimeOffFormInput) => {
      const { id, body } = buildUpdateTimeOffPayload(input);
      return apiClient.put<TimeOff>(`time-off/${id}`, body);
    },
    onSuccess: (timeOff) => {
      queryClient.invalidateQueries({ queryKey: ['time-off'] });
      toast.success('Time off updated');
      options?.onSuccess?.(timeOff);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update time off');
      options?.onError?.(error);
    },
  });

  return {
    updateTimeOff: mutation.mutate,
    updateTimeOffAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
