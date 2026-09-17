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
 * Save final field edits to a chat-owned draft offer without
 * publishing. The offer stays at `state='draft'`. The body is built by
 * the shared `buildUpdateOfferPayload` — the single `PUT /offers/:id`
 * builder.
 */
export const useSaveOfferDraft = (
  draftId: string,
  discountType: OfferDiscountType
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (edits: OfferDraftEditIntent) =>
      apiClient.put(
        `offers/${draftId}`,
        buildUpdateOfferPayload({ source: 'draft', discountType, edits })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      toast.success('Draft saved');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save draft');
    },
  });
};
