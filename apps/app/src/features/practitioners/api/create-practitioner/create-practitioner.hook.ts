import { apiClient } from '@borradh-workspace/api-client';
import type {
  CreatePractitionerInput,
  Practitioner,
} from '@borradh-workspace/api-client/types';
import { practitionerSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseCreatePractitionerOptions {
  onSuccess?: (practitioner: Practitioner) => void;
  onError?: (error: Error) => void;
}

export const useCreatePractitioner = (
  options?: UseCreatePractitionerOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreatePractitionerInput) =>
      apiClient.post<Practitioner>('practitioners', input, {
        schema: practitionerSchema,
      }),
    onSuccess: (practitioner) => {
      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      toast.success('Practitioner created');
      options?.onSuccess?.(practitioner);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create practitioner');
      options?.onError?.(error);
    },
  });

  return {
    createPractitioner: mutation.mutate,
    createPractitionerAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
