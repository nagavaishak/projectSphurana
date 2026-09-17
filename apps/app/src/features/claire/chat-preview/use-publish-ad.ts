'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface FinalEdits {
  headline?: string;
  primaryText?: string;
}

interface PublishAdResult {
  ad: { id: string };
  metaCampaignId?: string;
  metaAdSetId?: string;
}

/**
 * Publish a chat-owned draft ad. Persists the final headline/caption
 * edits via the standard PUT, then calls `/meta-ads/:id/promote-draft`
 * which launches the campaign on Meta via `promoteDraftAd`.
 */
export const usePublishAd = (
  draftId: string,
  options?: { onSuccess?: (result: PublishAdResult) => void }
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (edits: FinalEdits) => {
      const hasEdits = Object.values(edits).some((v) => v !== undefined);
      if (hasEdits) {
        await apiClient.put(`meta-ads/${draftId}`, edits);
      }
      return apiClient.post<PublishAdResult>(
        `meta-ads/${draftId}/promote-draft`
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      toast.success('Your ad is live');
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to publish');
    },
  });
};
