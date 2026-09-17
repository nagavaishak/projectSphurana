import { apiClient } from '@borradh-workspace/api-client';
import type { Practitioner } from '@borradh-workspace/api-client/types';
import { practitionerSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { UpdatePractitionerIntent } from './update-practitioner.input';
import { buildUpdatePractitionerPayload } from './update-practitioner.payload';

interface UseUpdatePractitionerOptions {
  onSuccess?: (practitioner: Practitioner) => void;
}

export const useUpdatePractitioner = (
  options?: UseUpdatePractitionerOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Surfaces pass typed INTENT (the fields they edit); the single shared
    // builder turns it into the wire body so no two surfaces can drift.
    mutationFn: ({
      id,
      ...intent
    }: UpdatePractitionerIntent & { id: string }) =>
      apiClient.put<Practitioner>(
        `practitioners/${id}`,
        buildUpdatePractitionerPayload(intent),
        { schema: practitionerSchema }
      ),
    onSuccess: (practitioner) => {
      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      queryClient.invalidateQueries({
        queryKey: ['practitioners', practitioner.id],
      });
      toast.success('Practitioner updated');
      options?.onSuccess?.(practitioner);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update practitioner');
    },
  });

  return {
    updatePractitioner: mutation.mutate,
    updatePractitionerAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
