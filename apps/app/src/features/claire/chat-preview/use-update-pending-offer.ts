'use client';

import {
  type OfferDraftEditIntent,
  buildUpdateOfferPayload,
} from '@/features/offers/api';
import { apiClient } from '@borradh-workspace/api-client';
import type { OfferDiscountType } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export type UpdatePendingOfferInput = OfferDraftEditIntent;

/**
 * Persists onBlur field edits to a chat-owned draft offer. Hits the
 * shared `PUT /offers/:id` builder (`buildUpdateOfferPayload`) so the
 * preview card and the offer-form-dialog can never drift.
 */
export const useUpdatePendingOffer = (
  draftId: string,
  discountType: OfferDiscountType
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdatePendingOfferInput) =>
      apiClient.put(
        `offers/${draftId}`,
        buildUpdateOfferPayload({ source: 'draft', discountType, edits: input })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save changes');
    },
  });
};
