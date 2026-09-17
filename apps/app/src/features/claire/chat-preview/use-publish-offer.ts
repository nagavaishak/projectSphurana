'use client';

import {
  type OfferDraftEditIntent,
  buildUpdateOfferPayload,
} from '@/features/offers/api';
import { apiClient } from '@borradh-workspace/api-client';
import type { OfferDiscountType } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Publish a chat-owned draft offer. Persists the final field edits via the
 * shared `PUT /offers/:id` builder (`buildUpdateOfferPayload`), then promotes
 * the draft state from `'draft'` to `'active'` via `/offers/:id/promote-draft`.
 */
export const usePublishOffer = (
  draftId: string,
  discountType: OfferDiscountType,
  options?: { onSuccess?: () => void }
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (edits: OfferDraftEditIntent) => {
      const body = buildUpdateOfferPayload({
        source: 'draft',
        discountType,
        edits,
      });
      if (Object.keys(body).length > 0) {
        await apiClient.put(`offers/${draftId}`, body);
      }
      return apiClient.post(`offers/${draftId}/promote-draft`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      toast.success('Offer is live');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to publish');
    },
  });
};
