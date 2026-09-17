'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface FinalEdits {
  headline?: string;
  primaryText?: string;
}

/**
 * Save final field edits to a chat-owned draft ad without publishing.
 * The draft stays at `status='draft'` and remains editable.
 */
export const useSaveAdDraft = (draftId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (edits: FinalEdits) =>
      apiClient.put(`meta-ads/${draftId}`, edits),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      toast.success('Draft saved');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save draft');
    },
  });
};
