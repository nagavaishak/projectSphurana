import { apiClient } from '@borradh-workspace/api-client';
import { contentItemSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ContentItem } from '../../types';

type UseRejectBatchItemOptions = {
  onSuccess?: (item: ContentItem) => void;
  onError?: (error: Error) => void;
};

export const useRejectBatchItem = (options?: UseRejectBatchItemOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiClient.post<ContentItem>(
        `content-batches/items/${itemId}/reject`,
        undefined,
        { schema: contentItemSchema }
      );
    },
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: ['content-batches'] });
      toast.success('Item rejected');
      options?.onSuccess?.(item);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reject item');
      options?.onError?.(error);
    },
  });

  return {
    rejectBatchItem: mutation.mutate,
    rejectBatchItemAsync: mutation.mutateAsync,
    isRejecting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
