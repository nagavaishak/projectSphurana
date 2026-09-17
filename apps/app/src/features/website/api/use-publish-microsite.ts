'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { micrositeQueryKey } from './use-microsite';

/**
 * `POST microsites/:id/publish` (§4).
 *
 * The draft is NEVER live: publishing is the only thing that moves
 * `publishedRevisionId`, and it only ever happens from this explicit action.
 */
export function usePublishMicrosite(
  micrositeId: string | null,
  options?: { onSuccess?: () => void }
) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => apiClient.post(`microsites/${micrositeId}/publish`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: micrositeQueryKey });
      toast.success('Website published');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Publish failed');
    },
  });

  return {
    publish: mutation.mutate,
    isPublishing: mutation.isPending,
  };
}
