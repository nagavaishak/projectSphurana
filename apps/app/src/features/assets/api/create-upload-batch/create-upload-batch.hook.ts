import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UploadBatch {
  id: string;
  totalAssets: number;
  status: string;
}

interface CreateUploadBatchInput {
  totalAssets: number;
}

export const useCreateUploadBatch = () => {
  const mutation = useMutation({
    mutationFn: (input: CreateUploadBatchInput) =>
      apiClient.post<UploadBatch>('assets/batch', input),
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create upload batch');
    },
  });

  return {
    createBatch: mutation.mutate,
    createBatchAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
