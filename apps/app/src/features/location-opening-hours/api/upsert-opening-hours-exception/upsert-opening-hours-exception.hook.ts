'use client';

import { apiClient } from '@borradh-workspace/api-client';
import type {
  OpeningHoursException,
  UpsertOpeningHoursExceptionInput,
} from '@borradh-workspace/api-client/types';
import { openingHoursExceptionSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseUpsertOpeningHoursExceptionOptions {
  onSuccess?: (exception: OpeningHoursException) => void;
  onError?: (error: Error) => void;
}

export const useUpsertOpeningHoursException = (
  options?: UseUpsertOpeningHoursExceptionOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      locationId,
      date,
      ...input
    }: {
      locationId: string;
      date: string;
    } & UpsertOpeningHoursExceptionInput) =>
      apiClient.put<OpeningHoursException>(
        `locations/${locationId}/opening-hours/exceptions/${date}`,
        input,
        { schema: openingHoursExceptionSchema }
      ),
    onSuccess: (exception) => {
      queryClient.invalidateQueries({ queryKey: ['location-opening-hours'] });
      toast.success('Opening hours updated for this day');
      options?.onSuccess?.(exception);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update opening hours');
      options?.onError?.(error);
    },
  });

  return {
    upsertOpeningHoursException: mutation.mutate,
    upsertOpeningHoursExceptionAsync: mutation.mutateAsync,
    isUpserting: mutation.isPending,
  };
};
