import { apiClient } from '@borradh-workspace/api-client';
import { contentItemSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ContentItem } from '../../types';
import {
  type AcceptBatchItemInput,
  buildAcceptBatchItemPayload,
} from './accept-batch-item.payload';

export type { AcceptBatchItemInput };

type UseAcceptBatchItemOptions = {
  onSuccess?: (item: ContentItem) => void;
  onError?: (error: Error) => void;
};

export const useAcceptBatchItem = (options?: UseAcceptBatchItemOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: async (input: AcceptBatchItemInput) => {
      return apiClient.post<ContentItem>(
        `content-batches/items/${input.itemId}/accept`,
        buildAcceptBatchItemPayload(input),
        { schema: contentItemSchema }
      );
    },
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: ['content-batches'] });
      options?.onSuccess?.(item);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to accept item');
      options?.onError?.(error);
    },
  });

  return {
    acceptBatchItem: mutation.mutate,
    acceptBatchItemAsync: mutation.mutateAsync,
    isAccepting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
