'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface UpdatePendingAdInput {
  headline?: string;
  primaryText?: string;
  name?: string;
}

/**
 * Persists onBlur field edits to a chat-owned draft ad. Hits the
 * existing `PUT /meta-ads/:id` endpoint — `updateAd` already accepts
 * partial updates and works for `status='draft'` rows.
 */
export const useUpdatePendingAd = (draftId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdatePendingAdInput) =>
      apiClient.put(`meta-ads/${draftId}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads', draftId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save changes');
    },
  });
};
