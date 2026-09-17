'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  type UpdateLocationVenueResponse,
  updateLocationVenueResponseSchema,
} from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface UpdateVenueInput {
  locationId: string;
  about?: string | null;
  slug?: string | null;
}

/**
 * Dashboard: edit one location's public venue details (about + slug).
 * The org is resolved server-side from the session; the locationId lives in the
 * path.
 */
export const useUpdateVenue = (options?: {
  onSuccess?: (venue: UpdateLocationVenueResponse) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ locationId, ...body }: UpdateVenueInput) =>
      apiClient.put<UpdateLocationVenueResponse>(
        `venue/${encodeURIComponent(locationId)}`,
        body,
        { schema: updateLocationVenueResponseSchema }
      ),
    onSuccess: (venue) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.venue.all() });
      toast.success('Venue details saved');
      options?.onSuccess?.(venue);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save venue details');
      options?.onError?.(error);
    },
  });

  return {
    updateVenue: mutation.mutate,
    updateVenueAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
};
