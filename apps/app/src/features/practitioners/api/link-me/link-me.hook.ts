import { apiClient } from '@borradh-workspace/api-client';
import type { Practitioner } from '@borradh-workspace/api-client/types';
import { practitionerSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface UseLinkPractitionerToUserOptions {
  onSuccess?: (practitioner: Practitioner) => void;
  onError?: (error: Error) => void;
}

export const useLinkPractitionerToUser = (
  options?: UseLinkPractitionerToUserOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<Practitioner>(
        'practitioners/link-me',
        {},
        {
          schema: practitionerSchema,
        }
      ),
    onSuccess: (practitioner) => {
      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      options?.onSuccess?.(practitioner);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });

  return {
    linkMe: mutation.mutate,
    linkMeAsync: mutation.mutateAsync,
    isLinking: mutation.isPending,
  };
};
